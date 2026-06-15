import type { Argv } from "yargs"
import { createTraceparent } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { commandGroup } from "../command-group.js"
import { readAgentEndpoint } from "../connection/profile-store.js"
import { success, error, handledError, isHandledCliError } from "../output/index.js"
import { getStudioContext } from "./studio-context.js"
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
  datagptEnabled: { method: "GET", path: "/open/api/v1/analytics-agent/datagpt/enabled" },
  domainList: { method: "GET", path: "/open/api/v1/analytics-agent/domains" },
  domainCreate: { method: "POST", path: "/open/api/v1/analytics-agent/domains" },
  domainUpdate: { method: "PUT", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}` },
  domainDetail: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}` },
  domainDelete: { method: "DELETE", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}` },
  domainTableAdd: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/tables` },
  domainTableRemove: { method: "DELETE", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/tables/${encodePath(argv["table-id"])}` },
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

async function requestAnalytics(
  argv: Record<string, unknown>,
  route: AnalyticsRoute,
  body: Record<string, unknown>,
  query: Record<string, unknown> = {},
): Promise<unknown> {
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

async function executeAnalyticsCommand(
  name: string,
  argv: Record<string, unknown>,
  route: AnalyticsRoute,
  body: Record<string, unknown>,
  query: Record<string, unknown> = {},
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
    success(unwrapResponse(payload), { format, timeMs: Date.now() - t0 })
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
  const format = typeof argv.format === "string" ? argv.format : "json"
  const timeoutMs = typeof argv["timeout-ms"] === "number" ? argv["timeout-ms"] : 360_000
  const intervalMs = typeof argv["interval-ms"] === "number" ? argv["interval-ms"] : 2_000
  const t0 = Date.now()
  try {
    const deadline = Date.now() + timeoutMs
    const poll = async (): Promise<unknown> => {
      const payload = await requestAnalytics(argv, route, body, query)
      if (isTerminalResponse(payload) || Date.now() >= deadline) return payload
      await Bun.sleep(intervalMs)
      return poll()
    }
    const payload = await poll()
    logOperation(name, { ok: true, timeMs: Date.now() - t0 })
    success(unwrapResponse(payload), { format, timeMs: Date.now() - t0 })
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
        return commandGroup(domain, "analytics-agent domain")
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
              await executeAnalyticsCommand("analytics-agent session create", argv as Record<string, unknown>, ROUTES.sessionCreate, body)
            },
          )
          .command(
            "run [session-id]",
            "Start a text2insight query in a session",
            (y) =>
              y
                .positional("session-id", { type: "number", describe: "Session ID" })
                .option("domain-id", { type: "number", describe: "Domain ID" })
                .option("msg", { type: "string", describe: "Question text" })
                .option("model-name", { type: "string", describe: "Model name" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const modelSettings = undefinedIfEmpty(mergeBody({}, {
                model_name: argv["model-name"],
              }))
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                domainId: argv["domain-id"],
                sessionId: argv["session-id"],
                msg: argv.msg,
                modelSettings,
              })
              await executeAnalyticsCommand("analytics-agent session run", argv as Record<string, unknown>, ROUTES.sessionRun, body)
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
