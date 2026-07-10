import { requestRaw, type ClientOptions } from "../client.js"
import { ClickZettaApiError } from "../types/api.js"
import { lh_code } from "./errors.js"
import type { JobID } from "./types.js"

export interface SubmitJobParams {
  sql: string
  workspace: string
  schema: string
  vcluster: string
  instanceName: string
  instanceId: number
  jobId: JobID
  /** Service host (e.g. "uat-api.clickzetta.com"). Sent in contextJson. */
  host?: string
  /** Username for contextJson audit trail. */
  user?: string
  /**
   * SQL hints forwarded as `sqlJob.sqlConfig.hint`. The Python connector
   * passes the merged `connect_context.configs` dict here
   * (client.py:645 `SQLJobConfig(0, "0", "0", self.connect_context.configs)`),
   * so callers should pass the final session configs map.
   */
  hints?: Record<string, string>
  asynchronous?: boolean
  /**
   * Maps to `JobDesc.jobTimeoutMs` (enums.py:350-351). Only emitted when > 0.
   * Unit: milliseconds.
   */
  jobTimeoutMs?: number
  /**
   * Maps to `JobDesc.hybridPollingTimeout` (enums.py:341). When omitted,
   * defaults to 0 for asynchronous submits and 30 for synchronous.
   * The SqlSession layer applies the DEFAULT_MAXIMUM_TIMEOUT=60 clamp
   * before calling submitJob (client.py:641-644).
   */
  pollingTimeout?: number
  /**
   * Maps to `JobDesc.priority` (enums.py:344). Defaults to 0. priorityString
   * is always "NORMAL" (client.py:674).
   */
  priority?: number
  /**
   * Maps to `clientContext.configStatements` (enums.py:173). SET/USE
   * statements the session accumulated via `process_use_cmd`
   * (client.py:541, 556). Defaults to [].
   */
  configStatements?: string[]
  /**
   * Overrides the `clientContext.contextJson` payload. When present, the
   * value is serialized with JSON.stringify. When omitted, a minimal
   * legacy payload with just `configs` is emitted for backwards
   * compatibility with callers that don't run through SqlSession.
   */
  contextJson?: Record<string, unknown>
  /**
   * Reuses a single trace context for both request headers and SQL hints.
   * When omitted, the HTTP client derives its own traceparent as usual.
   */
  traceparent?: string
  maxRetries?: number
}

export function normalizeServiceEndpoint(value: string | undefined): { host: string | null; endpoint: string | null } {
  if (!value) return { host: null, endpoint: null }
  const trimmed = value.trim()
  if (!trimmed) return { host: null, endpoint: null }
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(withScheme)
    const endpoint = `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "")}`
    return { host: parsed.host || null, endpoint: endpoint || parsed.host || null }
  } catch {
    const normalized = trimmed.replace(/^https?:\/\//, "").replace(/\/+$/, "")
    const host = normalized.split("/", 1)[0] ?? ""
    return { host: host || null, endpoint: normalized || null }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nextRetrySleepMs(current: number): number {
  return current < 3000 ? current * 2 : current
}

function submitErrorCode(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const status = (raw as { status?: { errorCode?: unknown } }).status
  if (typeof status?.errorCode === "string" && status.errorCode) return status.errorCode
  const respStatus = (raw as { respStatus?: { errorCode?: unknown } }).respStatus
  if (typeof respStatus?.errorCode === "string" && respStatus.errorCode) return respStatus.errorCode
  return undefined
}

function shouldRetrySubmitError(error: unknown): boolean {
  if (!(error instanceof ClickZettaApiError)) return true
  return ![400, 401, 403, 404, 409, 422].includes(error.statusCode ?? 0)
}

export async function submitJob(
  opts: ClientOptions,
  params: SubmitJobParams,
): Promise<unknown> {
  const {
    sql,
    workspace,
    schema,
    vcluster,
    instanceName,
    jobId,
    host,
    user,
    hints = {},
    asynchronous = false,
    jobTimeoutMs,
    pollingTimeout,
    configStatements = [],
    contextJson,
    traceparent,
    maxRetries = 1,
  } = params
  const serviceInfo = normalizeServiceEndpoint(opts.config?.service ?? opts.baseUrl)
  const resolvedHost = host ?? serviceInfo.endpoint ?? serviceInfo.host
  const resolvedUser = (user ?? opts.config?.username) || null
  const resolvedContextJson = contextJson ? { ...contextJson } : {}
  if (resolvedContextJson.host == null) resolvedContextJson.host = resolvedHost
  if (resolvedContextJson.instance == null) resolvedContextJson.instance = instanceName ?? null
  if (resolvedContextJson.user == null || resolvedContextJson.user === "") resolvedContextJson.user = resolvedUser
  if (resolvedContextJson.workspace == null) resolvedContextJson.workspace = workspace
  if (resolvedContextJson.schema == null) resolvedContextJson.schema = schema
  if (resolvedContextJson.vc == null) resolvedContextJson.vc = vcluster
  if (resolvedContextJson.maxRowSize == null) resolvedContextJson.maxRowSize = 0
  if (resolvedContextJson.priority == null) resolvedContextJson.priority = ""
  if (resolvedContextJson.configs == null) {
    resolvedContextJson.configs = {
      "cz.sql.adhoc.result.type": "embedded",
      "cz.sql.adhoc.default.format": "ARROW",
      "cz.sql.job.result.file.presigned.url.enabled": "true",
      "cz.sql.job.result.file.presigned.url.ttl": "3600",
      ...hints,
    }
  }

  const hybridPollingTimeout =
    pollingTimeout !== undefined ? pollingTimeout : asynchronous ? 0 : 30

  const jobDesc: Record<string, unknown> = {
    virtualCluster: vcluster,
    type: "SQL_JOB",
    jobId: {
      id: jobId.id,
      workspace: jobId.workspace,
    },
    requestMode: "HYBRID",
    hybridPollingTimeout,
    sqlJob: {
      query: [sql],
      defaultNamespace: [workspace, schema],
      sqlConfig: {
        hint: {
          "cz.sql.adhoc.result.type": "embedded",
          "cz.sql.adhoc.default.format": "ARROW",
          "cz.sql.job.result.file.presigned.url.enabled": "true",
          "cz.sql.job.result.file.presigned.url.ttl": "3600",
          ...hints,
        },
      },
    },
    priorityString: "NORMAL",
    userAgent: "",
    clientContext: {
      configStatements,
      contextJson: JSON.stringify(resolvedContextJson),
    },
  }

  // enums.py:348-349 — when hint has "query_tag", surface it on JobDesc.
  if (Object.prototype.hasOwnProperty.call(hints, "query_tag")) {
    jobDesc.queryTag = hints.query_tag
  }
  // enums.py:350-351 — only emit jobTimeoutMs when > 0.
  if (jobTimeoutMs !== undefined && jobTimeoutMs > 0) {
    jobDesc.jobTimeoutMs = jobTimeoutMs
  }
  if (serviceInfo.endpoint) {
    jobDesc.jdbcDomain = serviceInfo.endpoint
  }
  const accessToken = typeof resolvedContextJson.configs === "object" && resolvedContextJson.configs
    ? (resolvedContextJson.configs as Record<string, unknown>).access_token
    : undefined
  if (typeof accessToken === "string" && accessToken) {
    jobDesc.account = { accessToken }
  }

  const body = { jobDesc }

  let sleepMs = 500
  let lastError: unknown = new Error(`submitJob failed for ${jobId.id}`)
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await requestRaw({
        ...opts,
        traceparent,
        customHeaders: {
          ...opts.customHeaders,
          ...(instanceName ? { instanceName } : {}),
          jobId: jobId.id,
        },
      }, "/lh/submitJob", body)
      if (submitErrorCode(resp) === lh_code.JOB_NOT_SUBMITTED && attempt < maxRetries) {
        await sleep(sleepMs)
        sleepMs = nextRetrySleepMs(sleepMs)
        continue
      }
      return resp
    } catch (error) {
      lastError = error
      if (attempt >= maxRetries || !shouldRetrySubmitError(error)) throw error
      await sleep(sleepMs)
      sleepMs = nextRetrySleepMs(sleepMs)
    }
  }
  throw lastError
}
