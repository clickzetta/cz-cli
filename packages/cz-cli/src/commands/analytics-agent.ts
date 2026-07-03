import type { Argv } from "yargs"
import { createTraceparent } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { commandGroup } from "../command-group.js"
import { readAgentEndpoint } from "../connection/profile-store.js"
import { success, error, handledError, isHandledCliError, shouldColorize, renderOutput } from "../output/index.js"
import { formatMarkdown } from "../output/formatter.js"
import { getStudioContext, type StudioContext } from "./studio-context.js"
import { logOperation } from "../logger.js"

const ROUTES = {
  datasourceTypes: { method: "GET", path: "/open/api/v1/datasources/types" },
  datasourceSchema: { method: "GET", path: "/open/api/v1/datasources/schema" },
  datasourceList: { method: "GET", path: "/open/api/v1/datasources" },
  datasourceMeta: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/datasources/${encodePath(argv["datasource-id"])}/meta` },
  datasourceBrowse: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/datasources/${encodePath(argv["datasource-id"])}/browse` },
  datasourceSearchTables: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/datasources/${encodePath(argv["datasource-id"])}/tables/search` },
  datasourceShowTable: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/datasources/${encodePath(argv["datasource-id"])}/tables/${encodePath(argv["table-name"])}` },
  datasourceLoad: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/datasources/${encodePath(argv["datasource-id"])}/load` },
  datasourceCreate: { method: "POST", path: "/open/api/v1/datasources" },
  datasourceUpdate: { method: "PUT", path: (argv: Record<string, unknown>) => `/open/api/v1/datasources/${encodePath(argv["datasource-id"])}` },
  datasourceDelete: { method: "DELETE", path: (argv: Record<string, unknown>) => `/open/api/v1/datasources/${encodePath(argv["datasource-id"])}` },
  simpleMetricList: { method: "POST", path: "/open/api/v1/analytics-agent/metrics/list" },
  simpleMetricCreate: { method: "POST", path: "/open/api/v1/analytics-agent/metrics/create" },
  simpleMetricUpdate: { method: "POST", path: "/open/api/v1/analytics-agent/metrics/update" },
  simpleMetricDelete: { method: "POST", path: "/open/api/v1/analytics-agent/metrics/delete" },
  simpleMetricDetail: { method: "POST", path: "/open/api/v1/analytics-agent/metrics/detail" },
  simpleMetricValidate: { method: "POST", path: "/open/api/v1/analytics-agent/metrics/validate" },
  simpleMetricEnable: { method: "POST", path: "/open/api/v1/analytics-agent/metrics/enable" },
  simpleMetricDisable: { method: "POST", path: "/open/api/v1/analytics-agent/metrics/disable" },
  answerBuilderCreate: { method: "POST", path: "/open/api/v1/analytics-agent/answer-builders/create" },
  answerBuilderUpdate: { method: "POST", path: "/open/api/v1/analytics-agent/answer-builders/update" },
  answerBuilderDelete: { method: "POST", path: "/open/api/v1/analytics-agent/answer-builders/delete" },
  answerBuilderDetail: { method: "POST", path: "/open/api/v1/analytics-agent/answer-builders/detail" },
  answerBuilderList: { method: "POST", path: "/open/api/v1/analytics-agent/answer-builders/list" },
  answerBuilderValidate: { method: "POST", path: "/open/api/v1/analytics-agent/answer-builders/validate" },
  answerBuilderEnable: { method: "POST", path: "/open/api/v1/analytics-agent/answer-builders/enable" },
  answerBuilderDisable: { method: "POST", path: "/open/api/v1/analytics-agent/answer-builders/disable" },
  datagptEnabled: { method: "GET", path: "/open/api/v1/analytics-agent/datagpt/enabled" },
  domainList: { method: "GET", path: "/open/api/v1/analytics-agent/domains" },
  domainCreate: { method: "POST", path: "/open/api/v1/analytics-agent/domains" },
  domainUpdate: { method: "PUT", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}` },
  domainDetail: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}` },
  domainDelete: { method: "DELETE", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}` },
  domainTableAdd: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/tables` },
  domainTableRemove: { method: "DELETE", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/tables/${encodePath(argv["table-id"])}` },
  domainJoinDiscover: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/joins/discover` },
  domainJoinResult: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/joins/tasks/${encodePath(argv["task-id"])}` },
  domainJoinApply: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/joins/apply` },
  sessionList: { method: "POST", path: "/open/session/list" },
  sessionCreate: { method: "POST", path: "/open/session/safe_new", openSessionAuth: true },
  sessionRun: { method: "POST", path: "/open/text2insight/query", openSessionAuth: true },
  sessionResult: { method: "POST", path: "/open/safe_question_poll", openSessionAuth: true },
  sessionStop: { method: "POST", path: "/open/text2insight/stop", openSessionAuth: true },
} as const

type AnalyticsRoute = {
  method: string
  path: string | ((argv: Record<string, unknown>) => string)
  tenantIdQuery?: boolean
  openSessionAuth?: boolean
}

interface AnalyticsRequestInfo {
  method: string
  path: string
  query: Record<string, string>
  tenantId: number | string
  status?: number
  requestId?: string
}

class AnalyticsHttpError extends Error {
  constructor(
    message: string,
    readonly request: AnalyticsRequestInfo,
  ) {
    super(message)
  }
}

function parseJsonObject(raw: string | undefined, fieldName: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${fieldName} must be a JSON object`)
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    throw new Error(`Invalid ${fieldName}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function parseOptionalJsonObject(raw: string | undefined, fieldName: string): Record<string, unknown> | undefined {
  if (!raw) return undefined
  return parseJsonObject(raw, fieldName)
}

function parseJsonArray(raw: string | undefined, fieldName: string): unknown[] | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error(`${fieldName} must be a JSON array`)
    }
    return parsed
  } catch (err) {
    throw new Error(`Invalid ${fieldName}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function parseStringList(raw: unknown, fieldName: string): string[] | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined
  if (Array.isArray(raw)) {
    const values = raw.flatMap((item) => parseStringList(item, fieldName) ?? [])
    return values.length > 0 ? values : undefined
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) return undefined
    if (trimmed.startsWith("[")) {
      const parsed = parseJsonArray(trimmed, fieldName)
      const values = (parsed ?? []).map((item) => String(item).trim()).filter(Boolean)
      return values.length > 0 ? values : undefined
    }
    const values = trimmed.split(",").map((item) => item.trim()).filter(Boolean)
    return values.length > 0 ? values : undefined
  }
  return [String(raw)]
}

function mergeBody(
  body: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return Object.entries(extra).reduce<Record<string, unknown>>(
    (result, [key, value]) => (value === undefined ? result : { ...result, [key]: value }),
    { ...body },
  )
}

function undefinedIfEmpty(value: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(value).length === 0 ? undefined : value
}

function encodePath(value: unknown): string {
  return encodeURIComponent(String(value ?? ""))
}

/**
 * Parses a --join flag value into a DatasetJoinDTO-shaped object.
 * Format: <datasetId>:<tableName>.<attrCode>=<joinDatasetId>:<joinTableName>.<joinAttrCode>@<relation>
 * Example: 101:orders.user_id=202:users.id@n:1
 */
function parseJoinFlag(raw: string): Record<string, unknown> {
  const atIdx = raw.lastIndexOf("@")
  if (atIdx === -1) throw new Error(`Invalid --join value "${raw}": missing "@" before relation`)
  const relation = raw.slice(atIdx + 1)
  if (!["n:1", "1:1", "1:n"].includes(relation)) {
    throw new Error(`Invalid --join value "${raw}": relation must be one of n:1, 1:1, 1:n (got "${relation}")`)
  }
  const rest = raw.slice(0, atIdx)
  const eqIdx = rest.indexOf("=")
  if (eqIdx === -1) throw new Error(`Invalid --join value "${raw}": missing "=" between left and right side`)
  const left = rest.slice(0, eqIdx)
  const right = rest.slice(eqIdx + 1)

  function parseSide(s: string, label: string) {
    const colonIdx = s.indexOf(":")
    if (colonIdx === -1) throw new Error(`Invalid --join value "${raw}": ${label} missing ":"`)
    const datasetId = Number(s.slice(0, colonIdx))
    if (!Number.isFinite(datasetId)) throw new Error(`Invalid --join value "${raw}": ${label} datasetId is not a number`)
    const rest2 = s.slice(colonIdx + 1)
    const dotIdx = rest2.lastIndexOf(".")
    if (dotIdx === -1) throw new Error(`Invalid --join value "${raw}": ${label} missing "." between tableName and attrCode`)
    const tableName = rest2.slice(0, dotIdx)
    const attrCode = rest2.slice(dotIdx + 1)
    if (!tableName) throw new Error(`Invalid --join value "${raw}": ${label} tableName is empty`)
    if (!attrCode) throw new Error(`Invalid --join value "${raw}": ${label} attrCode is empty`)
    return { datasetId, tableName, attrCode }
  }

  const l = parseSide(left, "left")
  const r = parseSide(right, "right")
  return {
    datasetId: l.datasetId,
    tableName: l.tableName,
    attrCode: l.attrCode,
    joinDatasetId: r.datasetId,
    joinTableName: r.tableName,
    joinAttrCode: r.attrCode,
    relation,
  }
}

function normalizeEndpoint(value: string): string {
  return value.replace(/\/+$/, "")
}

function routePath(route: AnalyticsRoute, argv: Record<string, unknown>): string {
  return typeof route.path === "string" ? route.path : route.path(argv)
}

function buildUrl(
  endpoint: string,
  route: AnalyticsRoute,
  argv: Record<string, unknown>,
  query: Record<string, unknown>,
  tenantId: number | string,
): string {
  const url = new URL(normalizeEndpoint(endpoint) + routePath(route, argv))
  Object.entries({ ...(route.tenantIdQuery === false ? {} : { tenantId }), ...query }).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value))
  })
  return url.toString()
}

function requestInfo(
  url: string,
  route: AnalyticsRoute,
  argv: Record<string, unknown>,
  tenantId: number | string,
  status?: number,
  requestId?: string,
): AnalyticsRequestInfo {
  return {
    method: route.method,
    path: routePath(route, argv),
    query: Object.fromEntries(new URL(url).searchParams.entries()),
    tenantId,
    ...(status !== undefined ? { status } : {}),
    ...(requestId ? { requestId } : {}),
  }
}

function responseRequestId(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    return typeof parsed.requestId === "string" ? parsed.requestId : undefined
  } catch {
    return undefined
  }
}

interface ResolvedContext {
  endpoint: string
  studio: StudioContext
}

async function resolveAnalyticsContext(argv: Record<string, unknown>): Promise<ResolvedContext> {
  const format = typeof argv.format === "string" ? argv.format : "json"
  const endpoint = readAgentEndpoint(typeof argv.profile === "string" ? argv.profile : undefined)
  if (!endpoint) {
    handledError(
      "NO_ANALYSIS_AGENT_ENDPOINT",
      "No analysis agent endpoint configured for the active profile. Set profiles.<name>.analysis_agent_endpoint first.",
      {
        format,
        extra: {
          next_steps: [
            "cz-cli profile update <profile> analysis_agent_endpoint <URL>",
            "cz-cli profile create <name> ... --analysis-agent-endpoint <URL>",
          ],
        },
      },
    )
  }
  const studio = await getStudioContext(argv)
  return { endpoint: endpoint!, studio }
}

async function requestAnalytics(
  argv: Record<string, unknown>,
  route: AnalyticsRoute,
  body: Record<string, unknown>,
  query: Record<string, unknown> = {},
  ctx?: ResolvedContext,
): Promise<unknown> {
  const { endpoint, studio } = ctx ?? await resolveAnalyticsContext(argv)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-clickzetta-token": studio.token,
    Authorization: studio.token,
    traceparent: createTraceparent(),
    userId: String(studio.userId),
    instanceId: String(studio.instanceId),
    accountId: String(studio.tenantId),
    tenantId: String(studio.tenantId),
    instanceName: studio.instanceName,
    workspaceName: studio.workspaceName,
    workspaceId: String(studio.workspaceId),
    projectId: String(studio.projectId),
    ...studio.customHeaders,
  }
  const url = buildUrl(endpoint, route, argv, query, studio.tenantId)
  const requestBody = route.openSessionAuth
    ? mergeBody(body, { tenantId: studio.tenantId, userId: studio.userId, loginToken: studio.token })
    : body
  const response = await fetch(url, {
    method: route.method,
    headers,
    ...(route.method === "GET" ? {} : { body: JSON.stringify(requestBody) }),
    signal: AbortSignal.timeout(300_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new AnalyticsHttpError(
      `HTTP ${response.status}: ${text.slice(0, 500)}`,
      requestInfo(url, route, argv, studio.tenantId, response.status, responseRequestId(text)),
    )
  }
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`Invalid JSON response: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function unwrapResponse(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const data = (payload as Record<string, unknown>).data
  return data ?? payload
}

/**
 * Analytics Agent backend always returns HTTP 200, using `success: false`
 * inside the envelope to signal business errors. Detect that here so callers
 * can route to the error path instead of the success path.
 *
 * The response can be either:
 *   - `{data: {code, message, success: false, ...}}` (domain/datasource APIs)
 *   - `{code, message, success: false, ...}` (already unwrapped by some routes)
 */
function extractBusinessError(payload: unknown): { code: string; message: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const p = payload as Record<string, unknown>

  // Case 1: top-level envelope — {data: {success: false, code, message}}
  const inner = p.data
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const d = inner as Record<string, unknown>
    if (d.success === false) {
      return {
        code: typeof d.code === "string" ? d.code : "ANALYTICS_AGENT_ERROR",
        message: typeof d.message === "string" ? d.message : "Unknown error",
      }
    }
  }

  // Case 2: already-unwrapped — {success: false, code, message}
  if (p.success === false) {
    return {
      code: typeof p.code === "string" ? p.code : "ANALYTICS_AGENT_ERROR",
      message: typeof p.message === "string" ? p.message : "Unknown error",
    }
  }

  return null
}

function latestResponseDataType(payload: unknown): string {
  const data = unwrapResponse(payload)
  if (!data || typeof data !== "object" || Array.isArray(data)) return ""
  const responses = (data as Record<string, unknown>).responses
  if (!Array.isArray(responses) || responses.length === 0) return ""
  const latest = responses.at(-1)
  if (!latest || typeof latest !== "object" || Array.isArray(latest)) return ""
  const dataType = (latest as Record<string, unknown>).dataType
  return typeof dataType === "string" ? dataType : ""
}

function isTerminalResponse(payload: unknown): boolean {
  return ["finish", "finish_stop", "error"].includes(latestResponseDataType(payload))
}

function extractModelMessage(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined
  const e = entry as Record<string, unknown>
  const modelRes = e.modelRes
  if (!modelRes || typeof modelRes !== "object" || Array.isArray(modelRes)) return undefined
  const data = (modelRes as Record<string, unknown>).data
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined
  const message = (data as Record<string, unknown>).message
  return typeof message === "string" ? message : undefined
}

/**
 * Extract the final text summary from a completed session run response.
 *
 * Strategy:
 * 1. Group responses by resGroupId, take the entries belonging to the latest group.
 * 2. Within that group, prefer the last entry whose dataType is "summary".
 *    Fall back to the last entry whose dataType is "message".
 * 3. Return the modelRes.data.message string from that entry.
 */
function extractFinalSummary(payload: unknown): string | undefined {
  const data = unwrapResponse(payload)
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined
  const responses = (data as Record<string, unknown>).responses
  if (!Array.isArray(responses) || responses.length === 0) return undefined

  // Find the latest resGroupId
  let latestGroupId: unknown
  for (const entry of responses) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      latestGroupId = (entry as Record<string, unknown>).resGroupId
    }
  }

  // Filter to only entries in the latest group
  const latestGroup = responses.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).resGroupId === latestGroupId,
  )

  // Prefer last "summary" entry, fall back to last "message" entry
  let summaryEntry: unknown
  let messageEntry: unknown
  for (const entry of latestGroup) {
    const dataType = (entry as Record<string, unknown>).dataType
    if (dataType === "summary") summaryEntry = entry
    if (dataType === "message") messageEntry = entry
  }

  const target = summaryEntry ?? messageEntry
  return extractModelMessage(target)
}

/** Extract summary when the payload is simply {data: "<string>"}. */
function extractSummaryString(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const data = (payload as Record<string, unknown>).data
  return typeof data === "string" ? data : undefined
}

function renderSummary(summary: string): string {
  // The backend encodes newlines as literal "\n" (two chars) inside the JSON string.
  const text = summary.replace(/\\n/g, "\n")
  if (shouldColorize()) return formatMarkdown(text)
  // Non-TTY: strip markdown syntax, keep plain text
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/^#{1,6}\s+/gm, "")
}

function writeRenderedPayload(payload: unknown, format: string | undefined, field: string | undefined): void {
  const output = renderOutput(payload, format, field)
  if (output !== "") process.stdout.write(output + "\n")
  ;(process as unknown as Record<string, unknown>).responseBytes = Buffer.byteLength(output, "utf-8")
  process.exitCode = 0
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function startSpinner(label: string): { stop: () => void } {
  if (!process.stderr.isTTY) return { stop: () => {} }
  let frame = 0
  const t0 = Date.now()
  const write = (text: string) => process.stderr.write(text)
  const render = () => {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    const line = `\r${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${label} (${elapsed}s)`
    write(line)
    frame++
  }
  render()
  const id = setInterval(render, 100)
  return {
    stop: () => {
      clearInterval(id)
      write("\r\x1b[K") // clear the spinner line
    },
  }
}

async function executeSessionRunCommand(
  name: string,
  argv: Record<string, unknown>,
  body: Record<string, unknown>,
): Promise<void> {
  const format = typeof argv.format === "string" ? argv.format : undefined
  const field = typeof argv.field === "string" ? argv.field : undefined
  const summaryOnly = argv.summary === true
  const timeoutMs = typeof argv["timeout-ms"] === "number" ? argv["timeout-ms"] : 360_000
  const intervalMs = typeof argv["interval-ms"] === "number" ? argv["interval-ms"] : 2_000
  const t0 = Date.now()
  try {
    const ctx = await resolveAnalyticsContext(argv)
    const runPayload = await requestAnalytics(argv, ROUTES.sessionRun, body, {}, ctx)
    const bizErr = extractBusinessError(runPayload)
    if (bizErr) {
      logOperation(name, { ok: false, timeMs: Date.now() - t0 })
      error(bizErr.code, bizErr.message, { format })
      return
    }
    const runData = unwrapResponse(runPayload) as Record<string, unknown>
    const questionId = runData.questionId
    if (!questionId) {
      logOperation(name, { ok: false, timeMs: Date.now() - t0 })
      error("ANALYTICS_AGENT_ERROR", "session run did not return a questionId", { format, extra: { response: runData } })
      return
    }
    const pollBody = { questionId }
    const deadline = Date.now() + timeoutMs
    let payload: unknown
    const spinner = startSpinner("Agent 正在分析")
    try {
      do {
        payload = await requestAnalytics(argv, ROUTES.sessionResult, pollBody, {}, ctx)
        if (isTerminalResponse(payload) || Date.now() >= deadline) break
        await Bun.sleep(intervalMs)
      } while (true)
    } finally {
      spinner.stop()
    }
    const pollErr = extractBusinessError(payload)
    if (pollErr) {
      logOperation(name, { ok: false, timeMs: Date.now() - t0 })
      error(pollErr.code, pollErr.message, { format })
      return
    }
    logOperation(name, { ok: true, timeMs: Date.now() - t0 })
    if (!summaryOnly) {
      writeRenderedPayload(payload, format, field)
      return
    }
    const summary = extractSummaryString(payload) ?? extractFinalSummary(payload)
    if (summary) {
      if (format === "json") {
        process.stdout.write(summary + "\n")
      } else {
        process.stdout.write(renderSummary(summary) + "\n")
      }
    } else {
      success(null, { format, timeMs: Date.now() - t0 })
    }
  } catch (err) {
    logOperation(name, { ok: false, timeMs: Date.now() - t0 })
    if (isHandledCliError(err)) return
    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
      format,
      ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
    })
  }
}

async function executeAnalyticsCommand(
  name: string,
  argv: Record<string, unknown>,
  route: AnalyticsRoute,
  body: Record<string, unknown>,
  query: Record<string, unknown> = {},
  buildAiMessage?: (data: unknown) => string | undefined,
): Promise<void> {
  const format = typeof argv.format === "string" ? argv.format : "json"
  const t0 = Date.now()
  try {
    const payload = await requestAnalytics(argv, route, body, query)
    const bizErr = extractBusinessError(payload)
    if (bizErr) {
      logOperation(name, { ok: false, timeMs: Date.now() - t0 })
      error(bizErr.code, bizErr.message, { format })
      return
    }
    logOperation(name, { ok: true, timeMs: Date.now() - t0 })
    const data = unwrapResponse(payload)
    success(data, { format, timeMs: Date.now() - t0, aiMessage: buildAiMessage?.(data) })
  } catch (err) {
    logOperation(name, { ok: false, timeMs: Date.now() - t0 })
    if (isHandledCliError(err)) return
    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
      format,
      ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
    })
  }
}

async function executeAnalyticsPollCommand(
  name: string,
  argv: Record<string, unknown>,
  route: AnalyticsRoute,
  body: Record<string, unknown>,
  query: Record<string, unknown> = {},
): Promise<void> {
  const format = typeof argv.format === "string" ? argv.format : undefined
  const timeoutMs = typeof argv["timeout-ms"] === "number" ? argv["timeout-ms"] : 360_000
  const intervalMs = typeof argv["interval-ms"] === "number" ? argv["interval-ms"] : 2_000
  const t0 = Date.now()
  try {
    const ctx = await resolveAnalyticsContext(argv)
    const deadline = Date.now() + timeoutMs
    let payload: unknown
    do {
      payload = await requestAnalytics(argv, route, body, query, ctx)
      if (isTerminalResponse(payload) || Date.now() >= deadline) break
      await Bun.sleep(intervalMs)
    } while (true)
    logOperation(name, { ok: true, timeMs: Date.now() - t0 })
    const summary = extractSummaryString(payload) ?? extractFinalSummary(payload)
    if (summary) {
      if (format === "json") {
        process.stdout.write(summary + "\n")
      } else {
        process.stdout.write(renderSummary(summary) + "\n")
      }
    } else {
      success(null, { format, timeMs: Date.now() - t0 })
    }
  } catch (err) {
    logOperation(name, { ok: false, timeMs: Date.now() - t0 })
    if (isHandledCliError(err)) return
    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
      format,
      ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
    })
  }
}

export function registerAnalyticsAgentCommand(cli: Argv<GlobalArgs>): void {
  cli.command("analytics-agent", "Analytics Agent APIs", (yargs) => {
    yargs
      .command("datasource", "Manage Analytics Agent datasources", (datasource) => {
        datasource
          .command(
            "types",
            "List supported datasource types",
            (y) => y,
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent datasource types", argv as Record<string, unknown>, ROUTES.datasourceTypes, {})
            },
          )
          .command(
            "schema",
            "Show datasource connection schema",
            (y) =>
              y.option("type", { type: "string", demandOption: true, describe: "Datasource type" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent datasource schema", argv as Record<string, unknown>, ROUTES.datasourceSchema, {}, {
                type: argv.type,
              })
            },
          )
          .command(
            "list",
            "List datasources",
            (y) =>
              y
                .option("name", { type: "string", describe: "Filter by datasource name" })
                .option("with-detail", { type: "boolean", describe: "Include datasource detail" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent datasource list", argv as Record<string, unknown>, ROUTES.datasourceList, {}, {
                name: argv.name,
                withDetail: argv["with-detail"],
              })
            },
          )
          .command(
            "meta <datasource-id>",
            "Show datasource browse metadata",
            (y) => y.positional("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent datasource meta", argv as Record<string, unknown>, ROUTES.datasourceMeta, {})
            },
          )
          .command(
            "browse <datasource-id>",
            "Browse datasource children",
            (y) =>
              y
                .positional("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" })
                .option("path", { type: "string", describe: "Browse path, for example workspace:w/schema:s" })
                .option("name", { type: "string", describe: "Filter child names" })
                .option("page-num", { type: "number", describe: "Page number" })
                .option("page-size", { type: "number", describe: "Page size" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent datasource browse", argv as Record<string, unknown>, ROUTES.datasourceBrowse, {}, {
                path: argv.path,
                name: argv.name,
                pageNum: argv["page-num"],
                pageSize: argv["page-size"],
              })
            },
          )
          .command(
            "search-tables <datasource-id>",
            "Search tables in a datasource",
            (y) =>
              y
                .positional("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" })
                .option("keyword", { type: "string", demandOption: true, describe: "Table search keyword" })
                .option("path", { type: "string", describe: "Search path" })
                .option("page-num", { type: "number", describe: "Page number" })
                .option("page-size", { type: "number", describe: "Page size" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent datasource search-tables", argv as Record<string, unknown>, ROUTES.datasourceSearchTables, {}, {
                keyword: argv.keyword,
                path: argv.path,
                pageNum: argv["page-num"],
                pageSize: argv["page-size"],
              })
            },
          )
          .command(
            "show-table <datasource-id> <table-name>",
            "Show datasource table metadata",
            (y) =>
              y
                .positional("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" })
                .positional("table-name", { type: "string", demandOption: true, describe: "Table name" })
                .option("path", { type: "string", describe: "Table path" })
                .option("include-columns", { type: "boolean", describe: "Include column metadata" })
                .option("include-preview", { type: "boolean", describe: "Include preview rows" })
                .option("preview-size", { type: "number", describe: "Preview row count" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent datasource show-table", argv as Record<string, unknown>, ROUTES.datasourceShowTable, {}, {
                path: argv.path,
                includeColumns: argv["include-columns"],
                includePreview: argv["include-preview"],
                previewSize: argv["preview-size"],
              })
            },
          )
          .command(
            "create",
            "Create datasource",
            (y) =>
              y
                .option("name", { type: "string", describe: "Datasource name" })
                .option("type", { type: "string", describe: "Datasource type" })
                .option("connection", { type: "string", describe: "Datasource connection JSON object" })
                .option("validate-only", { type: "boolean", describe: "Validate connection without creating datasource" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                name: argv.name,
                type: argv.type,
                connection: parseOptionalJsonObject(argv.connection, "--connection"),
                validateOnly: argv["validate-only"],
              })
              await executeAnalyticsCommand("analytics-agent datasource create", argv as Record<string, unknown>, ROUTES.datasourceCreate, body)
            },
          )
          .command(
            "update <datasource-id>",
            "Update datasource",
            (y) =>
              y
                .positional("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" })
                .option("name", { type: "string", describe: "Datasource name" })
                .option("type", { type: "string", describe: "Datasource type" })
                .option("connection", { type: "string", describe: "Datasource connection JSON object" })
                .option("validate-only", { type: "boolean", describe: "Validate connection without updating datasource" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                name: argv.name,
                type: argv.type,
                connection: parseOptionalJsonObject(argv.connection, "--connection"),
                validateOnly: argv["validate-only"],
              })
              await executeAnalyticsCommand("analytics-agent datasource update", argv as Record<string, unknown>, ROUTES.datasourceUpdate, body)
            },
          )
          .command(
            "delete <datasource-id>",
            "Delete datasource",
            (y) => y.positional("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent datasource delete", argv as Record<string, unknown>, ROUTES.datasourceDelete, {})
            },
          )
          .command(
            "load <datasource-id>",
            "Load datasource table into Analytics Agent",
            (y) =>
              y
                .positional("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" })
                .option("path", { type: "string", describe: "Table path" })
                .option("table-name", { type: "string", describe: "Table name" })
                .option("display-name", { type: "string", describe: "Dataset display name" })
                .option("description", { type: "string", describe: "Dataset description" })
                .option("domain-ids", { type: "string", describe: "Domain IDs JSON array" })
                .option("mode", { type: "number", describe: "Dataset mode" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                path: argv.path,
                tableName: argv["table-name"],
                displayName: argv["display-name"],
                description: argv.description,
                domainIds: parseJsonArray(argv["domain-ids"], "--domain-ids"),
                mode: argv.mode,
              })
              await executeAnalyticsCommand("analytics-agent datasource load", argv as Record<string, unknown>, ROUTES.datasourceLoad, body)
            },
          )
        return commandGroup(datasource, "analytics-agent datasource")
      })
      .command("domain", "Manage Analytics Agent domains", (domain) => {
        domain
          .command(
            "list",
            "List domains",
            (y) => y.option("with-tables", { type: "boolean", describe: "Include bound tables" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent domain list", argv as Record<string, unknown>, ROUTES.domainList, {}, {
                withTables: argv["with-tables"],
              })
            },
          )
          .command(
            "create",
            "Create domain",
            (y) =>
              y
                .option("name", { type: "string", describe: "Domain name" })
                .option("description", { type: "string", describe: "Domain description" })
                .option("datasource-id", { type: "number", describe: "Datasource ID" })
                .option("sample-questions", { type: "string", describe: "Sample questions JSON array" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                name: argv.name,
                description: argv.description,
                datasourceId: argv["datasource-id"],
                sampleQuestions: parseJsonArray(argv["sample-questions"], "--sample-questions"),
              })
              await executeAnalyticsCommand("analytics-agent domain create", argv as Record<string, unknown>, ROUTES.domainCreate, body)
            },
          )
          .command(
            "update <domain-id>",
            "Update domain",
            (y) =>
              y
                .positional("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                .option("name", { type: "string", describe: "Domain name" })
                .option("description", { type: "string", describe: "Domain description" })
                .option("datasource-id", { type: "number", describe: "Datasource ID" })
                .option("sample-questions", { type: "string", describe: "Sample questions JSON array" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                name: argv.name,
                description: argv.description,
                datasourceId: argv["datasource-id"],
                sampleQuestions: parseJsonArray(argv["sample-questions"], "--sample-questions"),
              })
              await executeAnalyticsCommand("analytics-agent domain update", argv as Record<string, unknown>, ROUTES.domainUpdate, body)
            },
          )
          .command(
            "detail <domain-id>",
            "Show domain detail",
            (y) =>
              y
                .positional("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                .option("with-tables", { type: "boolean", describe: "Include bound tables" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent domain detail", argv as Record<string, unknown>, ROUTES.domainDetail, {}, {
                withTables: argv["with-tables"],
              })
            },
          )
          .command(
            "delete <domain-id>",
            "Delete domain",
            (y) => y.positional("domain-id", { type: "number", demandOption: true, describe: "Domain ID" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent domain delete", argv as Record<string, unknown>, ROUTES.domainDelete, {})
            },
          )
          .command(
            "table",
            "Manage domain tables",
            (table) => {
              table.command(
                "add <domain-id>",
                "Add table to domain",
                (y) =>
                  y
                    .positional("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                    .option("datasource-id", { type: "number", describe: "Datasource ID" })
                    .option("path", { type: "string", describe: "Table path" })
                    .option("table-name", { type: "string", describe: "Table name" })
                    .option("display-name", { type: "string", describe: "Dataset display name" })
                    .option("description", { type: "string", describe: "Dataset description" })
                    .option("body", { type: "string", describe: "Full request body as JSON object" }),
                async (argv) => {
                  const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                    datasourceId: argv["datasource-id"],
                    path: argv.path,
                    tableName: argv["table-name"],
                    displayName: argv["display-name"],
                    description: argv.description,
                  })
                  await executeAnalyticsCommand("analytics-agent domain table add", argv as Record<string, unknown>, ROUTES.domainTableAdd, body)
                },
              )
              table.command(
                "remove <domain-id> <table-id>",
                "Remove table from domain",
                (y) =>
                  y
                    .positional("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                    .positional("table-id", { type: "number", demandOption: true, describe: "Table ID" }),
                async (argv) => {
                  await executeAnalyticsCommand("analytics-agent domain table remove", argv as Record<string, unknown>, ROUTES.domainTableRemove, {})
                },
              )
              return commandGroup(table, "analytics-agent domain table")
            },
          )
          .command("joins", "Discover and apply domain join relations", (joins) => {
            joins
              .command(
                "discover",
                "Start async join discovery for a domain",
                (y) =>
                  y.option("domain-id", { type: "number", demandOption: true, describe: "Domain ID" }),
                async (argv) => {
                  const format = typeof argv.format === "string" ? argv.format : "json"
                  const t0 = Date.now()
                  try {
                    const ctx = await resolveAnalyticsContext(argv as Record<string, unknown>)
                    const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.domainJoinDiscover, {}, {}, ctx)
                    const bizErr = extractBusinessError(payload)
                    if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                    const data = unwrapResponse(payload) as Record<string, unknown> | null
                    success(data ? { taskId: data.taskId, status: data.status } : {}, { format, timeMs: Date.now() - t0 })
                  } catch (err) {
                    if (isHandledCliError(err)) return
                    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                      format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                    })
                  }
                },
              )
              .command(
                "result",
                "Poll the result of a join discovery task",
                (y) =>
                  y.option("task-id", { type: "string", demandOption: true, describe: "Task ID returned by discover" }),
                async (argv) => {
                  const format = typeof argv.format === "string" ? argv.format : "json"
                  const t0 = Date.now()
                  try {
                    const ctx = await resolveAnalyticsContext(argv as Record<string, unknown>)
                    const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.domainJoinResult, {}, {}, ctx)
                    const bizErr = extractBusinessError(payload)
                    if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                    const data = unwrapResponse(payload) as Record<string, unknown> | null
                    if (!data) { success({}, { format, timeMs: Date.now() - t0 }); return }
                    const resultJoins = (data.joins as Record<string, unknown>[] | null) ?? []
                    success({
                      taskId: data.taskId,
                      status: data.status,
                      joinCount: data.joinCount ?? resultJoins.length,
                      joins: resultJoins.map((j) => ({
                        datasetId: j.datasetId,
                        tableName: j.tableName,
                        attrCode: j.attrCode,
                        joinDatasetId: j.joinDatasetId,
                        joinTableName: j.joinTableName,
                        joinAttrCode: j.joinAttrCode,
                        relation: j.relation,
                      })),
                    }, { format, timeMs: Date.now() - t0 })
                  } catch (err) {
                    if (isHandledCliError(err)) return
                    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                      format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                    })
                  }
                },
              )
              .command(
                "apply",
                "Apply discovered join relations",
                (y) =>
                  y.option("join", {
                    type: "string",
                    demandOption: true,
                    describe:
                      "Join relation in format: <datasetId>:<table>.<attr>=<joinDatasetId>:<joinTable>.<joinAttr>@<relation>  (e.g. 101:orders.user_id=202:users.id@n:1). Repeat for multiple joins.",
                  }).option("domain-id", { type: "number", demandOption: true, describe: "Domain ID" }),
                async (argv) => {
                  const format = typeof argv.format === "string" ? argv.format : "json"
                  const t0 = Date.now()
                  const rawJoins = Array.isArray(argv["join"]) ? argv["join"] : [argv["join"]]
                  let joins: Record<string, unknown>[]
                  try {
                    joins = (rawJoins as string[]).map((r) => parseJoinFlag(r))
                  } catch (err) {
                    error("USAGE_ERROR", err instanceof Error ? err.message : String(err), { format })
                    return
                  }
                  try {
                    const ctx = await resolveAnalyticsContext(argv as Record<string, unknown>)
                    const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.domainJoinApply, { joins }, {}, ctx)
                    const bizErr = extractBusinessError(payload)
                    if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                    success({ submittedCount: joins.length, status: "ok" }, { format, timeMs: Date.now() - t0 })
                  } catch (err) {
                    if (isHandledCliError(err)) return
                    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                      format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                    })
                  }
                },
              )
            return commandGroup(joins, "analytics-agent domain joins")
          })
        return commandGroup(domain, "analytics-agent domain")
      })
      .command("metric", "Manage Analytics Agent metrics", (metric) => {
        metric
          .command(
            "list",
            "List metrics for one or more domains",
            (y) =>
              y
                .option("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                .option("datasource-id", { type: "number", describe: "Datasource ID" })
                .option("table-name", { type: "string", describe: "Filter by table name" })
                .option("page-num", { type: "number", describe: "Page number" })
                .option("page-size", { type: "number", describe: "Page size" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                domainIds: [argv["domain-id"]],
                datasourceId: argv["datasource-id"],
                tableName: argv["table-name"],
                pageNum: argv["page-num"],
                pageSize: argv["page-size"],
              })
              await executeAnalyticsCommand("analytics-agent metric list", argv as Record<string, unknown>, ROUTES.simpleMetricList, body)
            },
          )
          .command(
            "create",
            "Create a simple metric",
            (y) =>
              y
                .option("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                .option("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" })
                .option("table-name", { type: "string", demandOption: true, describe: "Table name" })
                .option("name", { type: "string", demandOption: true, describe: "Metric name" })
                .option("expression", { type: "string", demandOption: true, describe: "Metric aggregate expression" })
                .option("alias", { type: "string", describe: "Metric alias list, JSON array or comma-separated list" })
                .option("description", { type: "string", describe: "Metric description" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                datasourceId: argv["datasource-id"],
                tableName: argv["table-name"],
                names: [argv.name],
                aggExpr: argv.expression,
                alias: parseStringList(argv.alias, "--alias"),
                description: argv.description,
                domainIds: [argv["domain-id"]],
              })
              await executeAnalyticsCommand("analytics-agent metric create", argv as Record<string, unknown>, ROUTES.simpleMetricCreate, body)
            },
          )
          .command(
            "update <metric-id>",
            "Update a metric",
            (y) =>
              y
                .positional("metric-id", { type: "number", demandOption: true, describe: "Metric ID" })
                .option("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                .option("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" })
                .option("table-name", { type: "string", demandOption: true, describe: "Table name" })
                .option("name", { type: "string", demandOption: true, describe: "Metric name" })
                .option("expression", { type: "string", demandOption: true, describe: "Metric aggregate expression" })
                .option("alias", { type: "string", describe: "Metric alias list, JSON array or comma-separated list" })
                .option("description", { type: "string", describe: "Metric description" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                id: argv["metric-id"],
                datasourceId: argv["datasource-id"],
                tableName: argv["table-name"],
                names: [argv.name],
                aggExpr: argv.expression,
                alias: parseStringList(argv.alias, "--alias"),
                description: argv.description,
                domainIds: [argv["domain-id"]],
              })
              await executeAnalyticsCommand("analytics-agent metric update", argv as Record<string, unknown>, ROUTES.simpleMetricUpdate, body)
            },
          )
          .command(
            "detail <metric-id>",
            "Show metric detail",
            (y) =>
              y.positional("metric-id", { type: "number", demandOption: true, describe: "Metric ID" }),
            async (argv) => {
              const body = mergeBody({}, { id: argv["metric-id"] })
              await executeAnalyticsCommand("analytics-agent metric detail", argv as Record<string, unknown>, ROUTES.simpleMetricDetail, body)
            },
          )
          .command(
            "validate",
            "Validate a metric definition",
            (y) =>
              y
                .option("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                .option("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" })
                .option("table-name", { type: "string", demandOption: true, describe: "Table name" })
                .option("name", { type: "string", demandOption: true, describe: "Metric name" })
                .option("expression", { type: "string", demandOption: true, describe: "Metric aggregate expression" })
                .option("alias", { type: "string", describe: "Metric alias list, JSON array or comma-separated list" })
                .option("description", { type: "string", describe: "Metric description" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                datasourceId: argv["datasource-id"],
                tableName: argv["table-name"],
                names: [argv.name],
                aggExpr: argv.expression,
                alias: parseStringList(argv.alias, "--alias"),
                description: argv.description,
                domainIds: [argv["domain-id"]],
              })
              await executeAnalyticsCommand("analytics-agent metric validate", argv as Record<string, unknown>, ROUTES.simpleMetricValidate, body)
            },
          )
          .command(
            "enable <metric-id>",
            "Enable a metric",
            (y) =>
              y.positional("metric-id", { type: "number", demandOption: true, describe: "Metric ID" }),
            async (argv) => {
              const body = mergeBody({}, { id: argv["metric-id"] })
              await executeAnalyticsCommand("analytics-agent metric enable", argv as Record<string, unknown>, ROUTES.simpleMetricEnable, body)
            },
          )
          .command(
            "disable <metric-id>",
            "Disable a metric",
            (y) =>
              y.positional("metric-id", { type: "number", demandOption: true, describe: "Metric ID" }),
            async (argv) => {
              const body = mergeBody({}, { id: argv["metric-id"] })
              await executeAnalyticsCommand("analytics-agent metric disable", argv as Record<string, unknown>, ROUTES.simpleMetricDisable, body)
            },
          )
          .command(
            "delete <metric-id>",
            "Delete a metric",
            (y) =>
              y.positional("metric-id", { type: "number", demandOption: true, describe: "Metric ID" }),
            async (argv) => {
              const body = mergeBody({}, { id: argv["metric-id"] })
              await executeAnalyticsCommand("analytics-agent metric delete", argv as Record<string, unknown>, ROUTES.simpleMetricDelete, body)
            },
          )
        return commandGroup(metric, "analytics-agent metric")
      })
      .command("answer-builder", "Manage Analytics Agent answer builders", (answerBuilder) => {
        answerBuilder
          .command(
            "create",
            "Create an answer builder",
            (y) =>
              y
                .option("analysis-name", { type: "string", demandOption: true, describe: "Answer builder name" })
                .option("analysis-desc", { type: "string", describe: "Answer builder description" })
                .option("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" })
                .option("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                .option("content", { type: "string", demandOption: true, describe: "Analysis DSL JSON string" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                analysisName: argv["analysis-name"],
                analysisDesc: argv["analysis-desc"],
                datasourceId: argv["datasource-id"],
                domainIds: [argv["domain-id"]],
                content: argv.content,
              })
              await executeAnalyticsCommand("analytics-agent answer-builder create", argv as Record<string, unknown>, ROUTES.answerBuilderCreate, body)
            },
          )
          .command(
            "update <analysis-id>",
            "Update an answer builder",
            (y) =>
              y
                .positional("analysis-id", { type: "number", demandOption: true, describe: "Answer builder ID" })
                .option("analysis-name", { type: "string", demandOption: true, describe: "Answer builder name" })
                .option("analysis-desc", { type: "string", describe: "Answer builder description" })
                .option("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" })
                .option("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                .option("content", { type: "string", demandOption: true, describe: "Analysis DSL JSON string" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                id: argv["analysis-id"],
                analysisName: argv["analysis-name"],
                analysisDesc: argv["analysis-desc"],
                datasourceId: argv["datasource-id"],
                domainIds: [argv["domain-id"]],
                content: argv.content,
              })
              await executeAnalyticsCommand("analytics-agent answer-builder update", argv as Record<string, unknown>, ROUTES.answerBuilderUpdate, body)
            },
          )
          .command(
            "enable <analysis-id>",
            "Enable an answer builder",
            (y) =>
              y.positional("analysis-id", { type: "number", demandOption: true, describe: "Answer builder ID" }),
            async (argv) => {
              const body = mergeBody({}, { id: argv["analysis-id"] })
              await executeAnalyticsCommand("analytics-agent answer-builder enable", argv as Record<string, unknown>, ROUTES.answerBuilderEnable, body)
            },
          )
          .command(
            "disable <analysis-id>",
            "Disable an answer builder",
            (y) =>
              y.positional("analysis-id", { type: "number", demandOption: true, describe: "Answer builder ID" }),
            async (argv) => {
              const body = mergeBody({}, { id: argv["analysis-id"] })
              await executeAnalyticsCommand("analytics-agent answer-builder disable", argv as Record<string, unknown>, ROUTES.answerBuilderDisable, body)
            },
          )
          .command(
            "delete <analysis-id>",
            "Delete an answer builder",
            (y) =>
              y.positional("analysis-id", { type: "number", demandOption: true, describe: "Answer builder ID" }),
            async (argv) => {
              const body = mergeBody({}, { id: argv["analysis-id"] })
              await executeAnalyticsCommand("analytics-agent answer-builder delete", argv as Record<string, unknown>, ROUTES.answerBuilderDelete, body)
            },
          )
          .command(
            "detail <analysis-id>",
            "Show answer builder detail",
            (y) =>
              y.positional("analysis-id", { type: "number", demandOption: true, describe: "Answer builder ID" }),
            async (argv) => {
              const body = mergeBody({}, { id: argv["analysis-id"] })
              await executeAnalyticsCommand("analytics-agent answer-builder detail", argv as Record<string, unknown>, ROUTES.answerBuilderDetail, body)
            },
          )
          .command(
            "list",
            "List answer builders",
            (y) =>
              y
                .option("domain-id", { type: "number", describe: "Domain ID" })
                .option("datasource-id", { type: "number", describe: "Datasource ID" })
                .option("page-num", { type: "number", describe: "Page number" })
                .option("page-size", { type: "number", describe: "Page size" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                domainIds: argv["domain-id"] === undefined ? undefined : [argv["domain-id"]],
                datasourceId: argv["datasource-id"],
                pageNum: argv["page-num"],
                pageSize: argv["page-size"],
              })
              await executeAnalyticsCommand("analytics-agent answer-builder list", argv as Record<string, unknown>, ROUTES.answerBuilderList, body)
            },
          )
          .command(
            "validate",
            "Validate an answer builder definition",
            (y) =>
              y
                .option("analysis-name", { type: "string", demandOption: true, describe: "Answer builder name" })
                .option("analysis-desc", { type: "string", describe: "Answer builder description" })
                .option("datasource-id", { type: "number", demandOption: true, describe: "Datasource ID" })
                .option("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                .option("content", { type: "string", demandOption: true, describe: "Analysis DSL JSON string" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                analysisName: argv["analysis-name"],
                analysisDesc: argv["analysis-desc"],
                datasourceId: argv["datasource-id"],
                domainIds: [argv["domain-id"]],
                content: argv.content,
              })
              await executeAnalyticsCommand("analytics-agent answer-builder validate", argv as Record<string, unknown>, ROUTES.answerBuilderValidate, body)
            },
          )
        return commandGroup(answerBuilder, "analytics-agent answer-builder")
      })
      .command("service", "Check Analytics Agent service capability", (service) => {
        service.command(
          "enabled",
          "Check whether the current tenant has Analytics Agent enabled",
          (y) => y,
          async (argv) => {
            await executeAnalyticsCommand("analytics-agent service enabled", argv as Record<string, unknown>, ROUTES.datagptEnabled, {})
          },
        )
        return commandGroup(service, "analytics-agent service")
      })
      .command("session", "Manage Analytics Agent text2insight sessions", (session) => {
        session
          .command(
            "list",
            "List text2insight sessions",
            (y) =>
              y
                .option("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                .option("source-type", { type: "string", describe: "Session sourceType" })
                .option("source-id", { type: "number", describe: "Session sourceId" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                domainId: argv["domain-id"],
                sourceType: argv["source-type"],
                sourceId: argv["source-id"],
              })
              await executeAnalyticsCommand("analytics-agent session list", argv as Record<string, unknown>, ROUTES.sessionList, body)
            },
          )
          .command(
            "create",
            "Create a safe text2insight session",
            (y) =>
              y
                .option("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                .option("title", { type: "string", describe: "Session title" })
                .option("source-type", { type: "string", describe: "Session sourceType" })
                .option("source-id", { type: "number", describe: "Session sourceId" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                domainId: argv["domain-id"],
                title: argv.title,
                sourceType: argv["source-type"],
                sourceId: argv["source-id"],
              })
              await executeAnalyticsCommand("analytics-agent session create", argv as Record<string, unknown>, ROUTES.sessionCreate, body, {}, (data) => {
                const id = typeof data === "string" || typeof data === "number"
                  ? data
                  : (data as Record<string, unknown>)?.sessionId ?? (data as Record<string, unknown>)?.id
                return id
                  ? `Session created (id=${id}). Ask a question with: cz-cli analytics-agent session run --session-id ${id} --msg "<your question>"`
                  : undefined
              })
            },
          )
          .command(
            "run",
            "Start a text2insight query and wait for the result",
            (y) =>
              y
                .option("session-id", { type: "number", describe: "Session ID (creates a new session if omitted)" })
                .option("domain-id", { type: "number", describe: "Domain ID (required when --session-id is omitted)" })
                .option("msg", { type: "string", describe: "Question text" })
                .option("model-name", { type: "string", describe: "Model name" })
                .option("interval-ms", { type: "number", describe: "Polling interval in milliseconds" })
                .option("timeout-ms", { type: "number", describe: "Polling timeout in milliseconds" })
                .option("summary", { type: "boolean", default: false, describe: "Show the final answer instead of the full poll payload" })
                .option("body", { type: "string", describe: "Full request body as JSON object" })
                .check((argv) => {
                  if (!argv["session-id"] && !argv["domain-id"]) {
                    throw new Error("--domain-id is required when --session-id is not provided")
                  }
                  return true
                }),
            async (argv) => {
              const argvRec = argv as Record<string, unknown>
              const format = typeof argv.format === "string" ? argv.format : undefined
              const modelSettings = undefinedIfEmpty(mergeBody({}, {
                model_name: argv["model-name"],
              }))
              let sessionId: number | undefined = argv["session-id"]
              if (!sessionId) {
                try {
                  const createPayload = await requestAnalytics(argvRec, ROUTES.sessionCreate, { domainId: argv["domain-id"] })
                  const bizErr = extractBusinessError(createPayload)
                  if (bizErr) {
                    error(bizErr.code, bizErr.message, { format })
                    return
                  }
                  const rawData = unwrapResponse(createPayload)
                  // session create returns {data: "<sessionId string>"}
                  const id = typeof rawData === "string" || typeof rawData === "number"
                    ? rawData
                    : (rawData as Record<string, unknown>)?.sessionId ?? (rawData as Record<string, unknown>)?.id
                  if (!id) {
                    error("ANALYTICS_AGENT_ERROR", "session create did not return a sessionId", { format })
                    return
                  }
                  sessionId = Number(id)
                } catch (err) {
                  if (isHandledCliError(err)) return
                  error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), { format })
                  return
                }
              }
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                domainId: argv["domain-id"],
                sessionId,
                msg: argv.msg,
                modelSettings,
              })
              await executeSessionRunCommand("analytics-agent session run", argvRec, body)
            },
          )
          .command(
            "result <question-id>",
            "Poll a text2insight question result",
            (y) =>
              y
                .positional("question-id", { type: "number", demandOption: true, describe: "Question ID" })
                .option("wait", { type: "boolean", describe: "Poll until finish, finish_stop, error, or timeout" })
                .option("interval-ms", { type: "number", describe: "Polling interval in milliseconds" })
                .option("timeout-ms", { type: "number", describe: "Polling timeout in milliseconds" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                questionId: argv["question-id"],
              })
              if (argv.wait) {
                await executeAnalyticsPollCommand("analytics-agent session result", argv as Record<string, unknown>, ROUTES.sessionResult, body)
                return
              }
              await executeAnalyticsCommand("analytics-agent session result", argv as Record<string, unknown>, ROUTES.sessionResult, body)
            },
          )
          .command(
            "stop [session-id] [question-id]",
            "Stop a running text2insight question",
            (y) =>
              y
                .positional("session-id", { type: "number", describe: "Session ID" })
                .positional("question-id", { type: "number", describe: "Question ID" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                sessionId: argv["session-id"],
                questionId: argv["question-id"],
              })
              await executeAnalyticsCommand("analytics-agent session stop", argv as Record<string, unknown>, ROUTES.sessionStop, body)
            },
          )
        return commandGroup(session, "analytics-agent session")
      })
    return commandGroup(yargs, "analytics-agent")
  })
}
