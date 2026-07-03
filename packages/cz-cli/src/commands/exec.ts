import { resolveConnectionConfig, type CliArgs } from "../connection/config.js"
import {
  getToken,
  clearTokenCache,
  toServiceUrl,
  newJobId,
  submitJob,
  pollJobResult,
  parseJobResponse,
  isRetryableErrorCode,
  isVolumeSql,
  processVolumeSql,
  ClickZettaApiError,
  type ClientOptions,
  type ConnectionConfig,
  type AuthToken,
  type QueryResult,
  JobStatus,
} from "@clickzetta/sdk"
import { currentTraceContext, defaultQueryTag } from "../trace.js"
import { patchProfileUserId } from "../connection/profile-store.js"
import { getCookieToken } from "../connection/cookie-token.js"

export interface ExecContext {
  config: ConnectionConfig
  token: AuthToken
  clientOpts: ClientOptions
}

export async function getExecContext(args: Partial<CliArgs>): Promise<ExecContext> {
  const config = resolveConnectionConfig(args)
  if (!config.instance) {
    throw new Error("Instance is required. Provide --instance or configure it in your profile.")
  }
  if (!config.workspace) {
    throw new Error("Workspace is required. Provide --workspace or configure it in your profile.")
  }
  const token = await getCookieToken(config) ?? await (async () => {
    if (!config.pat && !(config.username && config.password)) {
      throw new Error("Authentication required. Provide --pat, --username/--password, or profile header.Cookie.")
    }
    return getToken(config)
  })()
  // Persist userId to profile for telemetry (enduser.id). Fire-and-forget.
  if (token.userId) patchProfileUserId(args.profile, token.userId)
  const clientOpts: ClientOptions = {
    baseUrl: toServiceUrl(config.service, config.protocol),
    token: token.token,
    customHeaders: { ...config.customHeaders, instanceName: config.instance },
    config,
  }
  return { config, token, clientOpts }
}

export interface ExecResult {
  jobId: string
  status: "RUNNING"
}

export function buildExecHints(
  hints?: Record<string, string>,
  traceContext = currentTraceContext(),
) {
  if (Object.prototype.hasOwnProperty.call(hints ?? {}, "query_tag")) {
    return hints
  }
  return { query_tag: defaultQueryTag(traceContext), ...hints } satisfies Record<string, string>
}

function submitMaxRetries(hints?: Record<string, string>): number {
  const parsed = Number.parseInt(hints?.["sdk.query.max.retries"] ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10
}

function retryableSubmitCode(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const status = (raw as { status?: { errorCode?: unknown } }).status
  if (typeof status?.errorCode === "string" && status.errorCode) return status.errorCode
  const respStatus = (raw as { respStatus?: { errorCode?: unknown } }).respStatus
  return typeof respStatus?.errorCode === "string" && respStatus.errorCode ? respStatus.errorCode : undefined
}

export async function execSql(
  ctx: ExecContext,
  sql: string,
  opts?: {
    hints?: Record<string, string>
    asynchronous?: boolean
    timeoutMs?: number
    configStatements?: string[]
    onJobId?: (id: string) => void
  },
): Promise<QueryResult | ExecResult> {
  const normalizedSql = sql + "\n;"
  const timezone = opts?.hints?.["cz.sql.timezone"]
  const jobId = newJobId(ctx.config.workspace, ctx.token.instanceId)
  opts?.onJobId?.(jobId.id)
  const traceContext = currentTraceContext()
  const submitResp = await submitJob(ctx.clientOpts, {
    sql: normalizedSql,
    workspace: ctx.config.workspace,
    schema: ctx.config.schema,
    vcluster: ctx.config.vcluster,
    instanceName: ctx.config.instance,
    instanceId: ctx.token.instanceId,
    jobId,
    hints: buildExecHints(opts?.hints, traceContext),
    asynchronous: opts?.asynchronous,
    configStatements: opts?.configStatements,
    traceparent: traceContext.traceparent,
    maxRetries: submitMaxRetries(opts?.hints),
  })
  if (opts?.asynchronous) {
    return { jobId: jobId.id, status: "RUNNING" as const }
  }
  // HYBRID mode: submitJob may return the result directly if the query
  // finished within hybridPollingTimeout. Check for a terminal state.
  const raw = submitResp as { status?: { state?: string } }
  let result: QueryResult
  if (raw?.status?.state && ["SUCCEED", "FAILED", "CANCELLED"].includes(raw.status.state)) {
    const errorCode = retryableSubmitCode(submitResp)
    if (isRetryableErrorCode(errorCode)) {
      result = await pollJobResult(ctx.clientOpts, jobId, { jobTimeoutMs: opts?.timeoutMs, timezone })
    } else {
      result = await parseJobResponse(submitResp as Parameters<typeof parseJobResponse>[0], jobId, timezone)
    }
  } else {
    result = await pollJobResult(ctx.clientOpts, jobId, { jobTimeoutMs: opts?.timeoutMs, timezone })
  }

  // Volume SQL (PUT/GET): process file transfers after getting the job result
  if (isVolumeSql(normalizedSql) && result.status === JobStatus.SUCCEEDED) {
    return processVolumeSql(
      { clientOpts: ctx.clientOpts, workspace: ctx.config.workspace, instanceId: ctx.token.instanceId },
      jobId,
      result,
      normalizedSql,
    )
  }

  return result
}

function isAuthError(err: unknown): boolean {
  if (err instanceof ClickZettaApiError && err.statusCode === 401) return true
  if (err instanceof Error && err.message.includes("401")) return true
  return false
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes("socket") ||
    msg.includes("connection") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("timeout")
  )
}

/**
 * Classify an error into a structured { code, message, aiMessage } tuple
 * suitable for passing directly to the output error() function.
 */
export function classifyExecError(err: unknown): { code: string; message: string; aiMessage: string; jobId?: string } {
  const message = err instanceof Error ? err.message : String(err)
  const code = errorCode(err)
  const jobId = (err as { jobId?: string })?.jobId
  if (isAuthError(err)) {
    return {
      code: "AUTH_ERROR",
      message,
      aiMessage: "Authentication failed. The API key may be invalid or expired. Ask the user to run: cz-cli setup --credential <base64_string>",
      jobId,
    }
  }
  if (err instanceof Error && err.message.startsWith("Authentication required")) {
    return {
      code: "NO_CREDENTIALS",
      message,
      aiMessage: "No credentials configured. Ask the user to run: cz-cli setup --credential <base64_string>",
      jobId,
    }
  }
  if (jobId && /timed out/i.test(message)) {
    return {
      code: "JOB_TIMEOUT",
      message,
      aiMessage: `Job ${jobId} timed out waiting for results. For long-running queries, use --async to submit without waiting: cz-cli sql "<SQL>" --async. Then check status with: cz-cli job status ${jobId}. To cancel: cz-cli job cancel ${jobId}`,
      jobId,
    }
  }
  if (isNetworkError(err)) {
    return {
      code: "CONNECTION_ERROR",
      message,
      aiMessage: "Cannot connect to ClickZetta. Check network connectivity and verify the instance/service URL in the profile.",
      jobId,
    }
  }
  return {
    code: code ?? "EXEC_ERROR",
    message,
    aiMessage: "",
    jobId,
  }
}

function errorCode(err: unknown) {
  if (!err || typeof err !== "object" || !("code" in err)) return undefined
  const code = (err as { code?: unknown }).code
  return typeof code === "string" && code.trim() ? code : undefined
}

/**
 * Execute SQL with automatic 401 retry. On auth failure, clears the token
 * cache, re-authenticates, and retries the operation once with a fresh token.
 */
export async function execSqlWithRetry(
  ctx: ExecContext,
  sql: string,
  opts?: {
    hints?: Record<string, string>
    asynchronous?: boolean
    timeoutMs?: number
    configStatements?: string[]
    onJobId?: (id: string) => void
  },
): Promise<QueryResult | ExecResult> {
  try {
    return await execSql(ctx, sql, opts)
  } catch (err) {
    if (!isAuthError(err)) throw err
    // Clear stale token and re-authenticate
    clearTokenCache()
    const freshToken = await getToken(ctx.config)
    ctx.token = freshToken
    ctx.clientOpts.token = freshToken.token
    return await execSql(ctx, sql, opts)
  }
}

export function isQueryResult(r: QueryResult | ExecResult): r is QueryResult {
  return "columns" in r
}

export function throwOnFailure(result: QueryResult, sql: string): void {
  if (result.status === JobStatus.FAILED) {
    throw new SqlError(
      result.errorCode ?? "SQL_ERROR",
      result.errorMessage ?? "Query failed",
      sql,
    )
  }
}

export class SqlError extends Error {
  constructor(
    public code: string,
    message: string,
    public sql: string,
  ) {
    super(message)
    this.name = "SqlError"
  }
}

const SAFE_IDENT_RE = /^[\w][\w.]*$/
export function validateIdentifier(name: string, label: string): string {
  if (!SAFE_IDENT_RE.test(name)) {
    throw new Error(`Invalid ${label}: ${name}`)
  }
  return name
}

/** Convert array-based rows to Record objects for named column access. */
export function rowsToRecords(result: QueryResult): Record<string, unknown>[] {
  const colNames = result.columns.map((c) => c.name)
  return result.rows.map((row) => {
    const record: Record<string, unknown> = {}
    for (let i = 0; i < colNames.length; i++) {
      record[colNames[i]] = (row as unknown[])[i]
    }
    return record
  })
}
