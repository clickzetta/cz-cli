import { resolveConnectionConfig, type CliArgs } from "../connection/config.js"
import { VERSION } from "../version.js"
import {
  getToken,
  clearTokenCache,
  toServiceUrl,
  newJobId,
  submitJob,
  pollJobResult,
  parseJobResponse,
  isVolumeSql,
  processVolumeSql,
  ClickZettaApiError,
  type ClientOptions,
  type ConnectionConfig,
  type AuthToken,
  type QueryResult,
  JobStatus,
} from "@clickzetta/sdk"

export interface ExecContext {
  config: ConnectionConfig
  token: AuthToken
  clientOpts: ClientOptions
}

export async function getExecContext(args: Partial<CliArgs>): Promise<ExecContext> {
  const config = resolveConnectionConfig(args)
  if (!config.pat && !(config.username && config.password)) {
    throw new Error("Authentication required. Provide --pat or --username/--password, or run `cz-cli setup` to configure a connection profile.")
  }
  if (!config.instance) {
    throw new Error("Instance is required. Provide --instance or configure it in your profile.")
  }
  if (!config.workspace) {
    throw new Error("Workspace is required. Provide --workspace or configure it in your profile.")
  }
  const token = await getToken(config)
  const clientOpts: ClientOptions = {
    baseUrl: toServiceUrl(config.service, config.protocol),
    token: token.token,
    customHeaders: { ...config.customHeaders, instanceName: config.instance },
  }
  return { config, token, clientOpts }
}

export interface ExecResult {
  jobId: string
  status: "RUNNING"
}

export async function execSql(
  ctx: ExecContext,
  sql: string,
  opts?: {
    hints?: Record<string, string>
    asynchronous?: boolean
    timeoutMs?: number
  },
): Promise<QueryResult | ExecResult> {
  const normalizedSql = sql.trimEnd().endsWith(";") ? sql : sql + ";"
  const jobId = newJobId(ctx.config.workspace, ctx.token.instanceId)
  const submitResp = await submitJob(ctx.clientOpts, {
    sql: normalizedSql,
    workspace: ctx.config.workspace,
    schema: ctx.config.schema,
    vcluster: ctx.config.vcluster,
    instanceName: ctx.config.instance,
    instanceId: ctx.token.instanceId,
    jobId,
    hints: opts?.hints?.query_tag ? opts.hints : { query_tag: `cz-cli@v${VERSION}`, ...opts?.hints },
    asynchronous: opts?.asynchronous,
  })
  if (opts?.asynchronous) {
    return { jobId: jobId.id, status: "RUNNING" as const }
  }
  // HYBRID mode: submitJob may return the result directly if the query
  // finished within hybridPollingTimeout. Check for a terminal state.
  const raw = submitResp as { status?: { state?: string } }
  let result: QueryResult
  if (raw?.status?.state && ["SUCCEED", "FAILED", "CANCELLED"].includes(raw.status.state)) {
    result = await parseJobResponse(submitResp as Parameters<typeof parseJobResponse>[0], jobId)
  } else {
    result = await pollJobResult(ctx.clientOpts, jobId, { jobTimeoutMs: opts?.timeoutMs })
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
export function classifyExecError(err: unknown): { code: string; message: string; aiMessage: string } {
  const message = err instanceof Error ? err.message : String(err)
  if (isAuthError(err)) {
    return {
      code: "AUTH_ERROR",
      message,
      aiMessage: "Authentication failed. The API key may be invalid or expired. Ask the user to run: cz-cli setup --credential <base64_string>",
    }
  }
  if (err instanceof Error && err.message.startsWith("Authentication required")) {
    return {
      code: "NO_CREDENTIALS",
      message,
      aiMessage: "No credentials configured. Ask the user to run: cz-cli setup --credential <base64_string>",
    }
  }
  if (isNetworkError(err)) {
    return {
      code: "CONNECTION_ERROR",
      message,
      aiMessage: "Cannot connect to ClickZetta. Check network connectivity and verify the instance/service URL in the profile.",
    }
  }
  return {
    code: "EXEC_ERROR",
    message,
    aiMessage: "",
  }
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
