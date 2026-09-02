import { resolveConnectionConfig, type CliArgs } from "../connection/config.js"
import {
  getToken,
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
import { legacyOAuthInstanceId, numericField, patchProfileInstanceId, patchProfileUserId, readProfileEntry } from "../connection/profile-store.js"
import * as Profile from "../connection/profile-context.js"
import { resolveInstanceIdByName } from "../connection/instance-id.js"
import { getCookieToken, hasCookieToken } from "../connection/cookie-token.js"
import { profileTokenSource } from "../connection/token-source.js"

export interface ExecContext {
  config: ConnectionConfig
  token: AuthToken
  clientOpts: ClientOptions
}

/**
 * Single source of truth for "does this profile carry enough to authenticate":
 * a profile cookie, an explicit pat, a username/password pair, OR a persisted
 * (cross-process) OAuth token loadable from the profile-backed tokenStore.
 * A pure-OAuth profile (no pat/username, but a valid login token) is therefore
 * usable for SQL (requirement 11.8).
 *
 * cz-cli merge note: replaces the pre-OAuth inline guard. The token acquisition
 * below routes through getCookieToken / getToken (getToken itself consults
 * config.tokenStore for OAuth), so this guard and the acquisition agree on what
 * counts as a credential — no second, divergent check.
 */
export function hasUsableCredentials(config: ConnectionConfig): boolean {
  if (hasCookieToken(config)) return true
  if (config.pat) return true
  if (config.username && config.password) return true
  return config.tokenStore?.load() !== undefined
}

export function execInstanceId(ctx: ExecContext): number {
  return ctx.config.instanceId ?? 0
}

export async function getExecContext(args: Partial<CliArgs>): Promise<ExecContext> {
  const config = resolveConnectionConfig(args)
  if (!hasUsableCredentials(config)) {
    throw new Error("Authentication required. Run `cz-cli auth login <name>` to sign in (browser OAuth by default; see `cz-cli auth login --help` for credential/PAT/password methods).")
  }
  if (!config.instance) {
    throw new Error("Instance is required. Provide --instance or configure it in your profile.")
  }
  if (!config.workspace) {
    throw new Error("Workspace is required. Provide --workspace or configure it in your profile.")
  }
  const token = await getCookieToken(config) ?? await getToken(config)
  // Resolved once and reused: passing `undefined` here would let these writes land on
  // `default_profile` while the config above came from Profile.current() (CZ_PROFILE first).
  const activeProfile = args.profile ?? Profile.current()
  // Persist userId to profile for telemetry (enduser.id). Fire-and-forget.
  if (token.userId) patchProfileUserId(activeProfile, token.userId)
  // The instance id the wire needs belongs to the CONNECTION, not the credential — see
  // ConnectionConfig.instanceId. A profile written before that carries no `instance_id`, so
  // resolve it from the name the profile does carry and cache it back. One extra portal
  // call, once per stale profile; a login records it up front.
  if (!config.instanceId) {
    // activeProfile, never `undefined`: readProfileEntry(undefined) and
    // patchProfileInstanceId(undefined) both fall back to `default_profile`, while the
    // config above came from Profile.current(), which prefers CZ_PROFILE. With the two
    // disagreeing this read the account id off one profile and cached it onto another.
    const entry = readProfileEntry(activeProfile)
    const accountId = numericField(entry?.account_id) ?? 0
    // Whether the name we are resolving is the PROFILE's own. It may instead have come from
    // --instance, CZ_INSTANCE or --jdbc-url, and an id resolved for one of those must never
    // be cached: patchProfileInstanceId only writes when absent, so a single overridden
    // invocation would pin the profile to another instance's id permanently, with no path
    // back. Same wrong-instance defect this change exists to remove, reached from a third
    // direction — after the guard that compared a value to itself and the layer that
    // cleared unconditionally.
    const nameIsProfiles = typeof entry?.instance === "string" && entry.instance === config.instance
    // Separated from "no match" so the two cannot be reported as the same thing: a portal
    // that could not be reached says nothing about which instance the name belongs to.
    let lookupError: unknown
    let notListed = false
    // Read once: each call re-reads and re-parses profiles.toml, and this is already the
    // slow path.
    const legacyId = legacyOAuthInstanceId(activeProfile)
    const resolved = accountId
      ? await resolveInstanceIdByName(
          toServiceUrl(config.service, config.protocol),
          profileTokenSource(config),
          accountId,
          config.instance,
          {
            customHeaders: config.customHeaders,
            onError: (err) => { lookupError = err },
            onNotFound: () => { notListed = true },
          },
        )
      : 0
    if (resolved) {
      config.instanceId = resolved
      if (nameIsProfiles) patchProfileInstanceId(activeProfile, resolved)
    } else if (notListed && !nameIsProfiles) {
      // Fatal only for a name the caller supplied — --instance, CZ_INSTANCE, --jdbc-url.
      // There, "this account does not list it" contradicts something explicit and falling
      // back to a credential's id would silently run against a DIFFERENT instance than the
      // one named; that was the silent case worth closing.
      //
      // A name that came from the PROFILE is not fatal, because the credential's id can be
      // just as definitive: cookie auth derives it from the cookie's own JWT payload
      // (cookie-token.ts), and that cookie is scoped to an instance. Failing there would
      // discard an authoritative answer over a lookup that can also miss for reasons other
      // than ownership — a renamed instance, or one that is not serviceId 1.
      throw new Error(
        `Instance '${config.instance}' is not listed for this account on ${config.service}. ` +
          `Check the name (\`cz-cli profile list\`), or set instance_id in the profile.`,
      )
    } else if (token.instanceId) {
      // Reached only when the lookup could not answer — it failed, or there was no
      // account_id to ask with. Never on a definitive "no such instance": that is the throw
      // above. Only a PAT/password credential carries an id (from its own login response);
      // an OAuth one does not, so it goes to the legacy read or the throw below.
      config.instanceId = token.instanceId
      // Warned when a lookup was ATTEMPTED and could not answer, not when none was possible.
      // The definitive "this account has no such instance" is the throw above, so what is
      // left here is a portal that failed — worth saying — and a profile with no account_id
      // to ask with, which is not anomalous at all: a PAT/password profile has always used
      // the id from its own login response, and warning there would put a line on every
      // command for every such profile. The first version of this warning was conditional
      // for the wrong reason (it skipped the no-match case, which is now fatal); making it
      // unconditional then put it on the wrong cases instead.
      if (lookupError) {
        process.stderr.write(
          `Warning: could not verify the instance id for '${config.instance}' ` +
            `(${lookupError instanceof Error ? lookupError.message : String(lookupError)}); ` +
            `using the credential's ${token.instanceId}, which may belong to a different instance.\n`,
        )
      }
    } else if (legacyId) {
      // Last resort, and only to preserve what used to work: an OAuth profile with no
      // cached id and no usable lookup. The value comes from the shared `[oauth.<id>]`
      // section an older version wrote — per-profile data in a shared place, i.e. the very
      // thing this change removes — so it is used but never cached, and never quietly.
      config.instanceId = legacyId
      process.stderr.write(
        `Warning: could not resolve the instance id for '${config.instance}'` +
          (lookupError ? ` (${lookupError instanceof Error ? lookupError.message : String(lookupError)})` : "") +
          `; falling back to ${legacyId} from this login's shared OAuth section, which may belong to a different instance. ` +
          `Re-run \`cz-cli auth login\` to record the right one per profile.\n`,
      )
    } else {
      throw new Error(
        `Could not determine the instance id for '${config.instance}'.` +
          (!accountId
            ? ` The profile has no account_id to look it up with — run \`cz-cli auth login\` to refresh it, or set instance_id in the profile.`
            : notListed
              ? ` ${config.service} does not list it for this account — check the instance name, re-run \`cz-cli auth login\`, or set instance_id in the profile.`
              : ` The lookup against ${config.service} failed${lookupError ? ` (${lookupError instanceof Error ? lookupError.message : String(lookupError)})` : ""} — this may be transient; retry, or set instance_id in the profile.`),
      )
    }
  }

  const clientOpts: ClientOptions = {
    baseUrl: toServiceUrl(config.service, config.protocol),
    tokens: profileTokenSource(config),
    customHeaders: { ...config.customHeaders, instanceName: config.instance },
    context: { service: config.service, instance: config.instance, username: config.username },
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
  const jobId = newJobId(ctx.config.workspace, execInstanceId(ctx))
  opts?.onJobId?.(jobId.id)
  const traceContext = currentTraceContext()
  const submitResp = await submitJob(ctx.clientOpts, {
    sql: normalizedSql,
    workspace: ctx.config.workspace,
    schema: ctx.config.schema,
    vcluster: ctx.config.vcluster,
    instanceName: ctx.config.instance,
    instanceId: execInstanceId(ctx),
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
      { clientOpts: ctx.clientOpts, workspace: ctx.config.workspace, instanceId: execInstanceId(ctx) },
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
      aiMessage: "Authentication failed. The token may be invalid or expired. Ask the user to re-run: cz-cli auth login <name> (see `cz-cli auth login --help` for all sign-in methods).",
      jobId,
    }
  }
  if (err instanceof Error && err.message.startsWith("Authentication required")) {
    return {
      code: "NO_CREDENTIALS",
      message,
      aiMessage: "No credentials configured. Ask the user to run: cz-cli auth login <name> (see `cz-cli auth login --help` for all sign-in methods).",
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
    // The SQL gateway reports some auth failures in the body rather than as a
    // 401, so the transport's own rotation never sees them; rotate explicitly
    // and retry once. clientOpts needs no patching: its source re-reads the
    // rotated token on the next request.
    //
    // Rotation goes through the context's OWN source, not forceRefreshToken(config):
    // a cookie-pinned profile has no rotation path, and handing its config to the
    // refresh engine drives a full login with empty credentials (no pat, no
    // username/password, no token store) — ~6s of retries ending in a misleading
    // "Login failed" that hides the server's actual 401.
    const source = ctx.clientOpts.tokens
    const fresh = await source.rotate(await source.get())
    if (!fresh) throw err
    // Only the identity ids are carried over; the wire credential itself is read
    // from the source on each request.
    ctx.token = {
      ...ctx.token,
      token: fresh.token,
      userId: fresh.userId || ctx.token.userId,
    }
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
