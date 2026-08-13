import { stat } from "node:fs/promises"
import { basename, posix, resolve } from "node:path"
import type { Argv } from "yargs"
import { createTraceparent, mergeHeaders } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { commandGroup } from "../command-group.js"
import { readAgentEndpoint } from "../connection/profile-store.js"
import { success, error, handledError, isHandledCliError, shouldColorize, renderOutput, EXIT_BIZ_ERROR } from "../output/index.js"
import { formatMarkdown } from "../output/formatter.js"
import { getProfileAgentContext, getStudioContext, type StudioContext } from "./studio-context.js"
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
  domainPromptGet: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/prompt` },
  domainPromptSet: { method: "PUT", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/prompt` },
  domainPromptClear: { method: "DELETE", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/prompt` },
  domainTableAdd: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/tables` },
  domainTableRemove: { method: "DELETE", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/tables/${encodePath(argv["table-id"])}` },
  domainJoinDiscover: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/joins/discover` },
  domainJoinResult: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/joins/tasks/${encodePath(argv["task-id"])}` },
  domainJoinApply: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/domains/${encodePath(argv["domain-id"])}/joins/apply` },
  tableSemanticsList: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/datasets/${encodePath(argv["dataset-id"])}/semantics` },
  tableSemanticsGet: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/datasets/${encodePath(argv["dataset-id"])}/semantics/${encodePath(argv["attr-id"])}` },
  tableSemanticsSet: { method: "PUT", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/datasets/${encodePath(argv["dataset-id"])}/semantics/${encodePath(argv["attr-id"])}` },
  tableSemanticsProp: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/datasets/${encodePath(argv["dataset-id"])}/semantics/${encodePath(argv["attr-id"])}/prop` },
  datasetDetail: { method: "GET", path: "/open/api/v1/analytics-agent/datasets/detail" },
  datasetList: { method: "POST", path: "/open/api/v1/analytics-agent/datasets/list" },
  datasetUpdate: { method: "POST", path: "/open/api/v1/analytics-agent/datasets/update" },
  columnVirtualCompile: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/datasets/${encodePath(argv["dataset-id"])}/virtual-columns/compile` },
  columnVirtualSet: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/datasets/${encodePath(argv["dataset-id"])}/virtual-columns` },
  columnVirtualList: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/datasets/${encodePath(argv["dataset-id"])}/virtual-columns` },
  columnVirtualDelete: { method: "DELETE", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/datasets/${encodePath(argv["dataset-id"])}/virtual-columns/${encodePath(argv["attr-id"])}` },
  knowledgeEntryList: { method: "GET", path: "/open/api/v1/analytics-agent/knowledge/entries" },
  knowledgeEntryDetail: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/entries/${encodePath(argv["knowledge-id"])}` },
  knowledgeEntryCreate: { method: "POST", path: "/open/api/v1/analytics-agent/knowledge/entries" },
  knowledgeEntryUpdate: { method: "PUT", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/entries/${encodePath(argv["knowledge-id"])}` },
  knowledgeEntryDelete: { method: "DELETE", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/entries/${encodePath(argv["knowledge-id"])}` },
  knowledgeSpaceList: { method: "GET", path: "/open/api/v1/analytics-agent/knowledge/spaces" },
  knowledgeSpaceCreate: { method: "POST", path: "/open/api/v1/analytics-agent/knowledge/spaces" },
  knowledgeSpaceRename: { method: "PUT", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}` },
  knowledgeSpaceDelete: { method: "DELETE", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}` },
  knowledgeFolderCreate: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}/folders` },
  knowledgeNodeRename: { method: "PUT", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}/nodes/${encodePath(argv["node-id"])}` },
  knowledgeNodeMove: { method: "PUT", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}/nodes/${encodePath(argv["node-id"])}/move` },
  knowledgeNodeCopy: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}/nodes/${encodePath(argv["node-id"])}/copy` },
  knowledgeNodeList: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}/nodes` },
  knowledgeNodeSearch: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}/nodes/search` },
  knowledgeNodeSort: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}/nodes/sort` },
  knowledgeNodeContent: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}/nodes/${encodePath(argv["node-id"])}/content` },
  knowledgeNodeDelete: { method: "DELETE", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}/nodes/${encodePath(argv["node-id"])}` },
  knowledgeNodeByPath: { method: "GET", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}/nodes/by-path` },
  knowledgeUploadUrl: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}/nodes/upload-url` },
  knowledgeUploadComplete: { method: "POST", path: (argv: Record<string, unknown>) => `/open/api/v1/analytics-agent/knowledge/spaces/${encodePath(argv["space-id"])}/nodes/${encodePath(argv["node-id"])}/upload-complete` },
  sessionList: { method: "POST", path: "/open/session/list" },
  sessionCreate: { method: "POST", path: "/open/session/safe_new", openSessionAuth: true },
  sessionDelete: { method: "POST", path: "/open/datagpt/deleteSession", openSessionAuth: true },
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

class AnalyticsBusinessError extends Error {
  constructor(
    readonly code: string,
    message: string,
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

function validateAnswerBuilderMetricNames(dsl: Record<string, unknown>, format: string): void {
  const outputColumns = dsl.outputColumns
  if (!Array.isArray(outputColumns) || outputColumns.length === 0) {
    handledError("USAGE_ERROR", "--content outputColumns must include at least one non-empty metricName", { format })
  }
  const invalidIndex = (outputColumns as unknown[]).findIndex((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true
    const metricName = (item as Record<string, unknown>).metricName
    return typeof metricName !== "string" || metricName.trim() === ""
  })
  if (invalidIndex >= 0) {
    handledError("USAGE_ERROR", `--content outputColumns[${invalidIndex}].metricName must be non-empty`, { format })
  }
}

// Resolve the answer-builder `content` DSL string. `--content` carries the DSL
// JSON (chartParams/outputColumns/relatedTables/…). `--sql`, when given, is
// injected as the top-level `sql` field so the caller does not have to escape
// SQL quotes inside the JSON string. Returns the final JSON string to POST.
function resolveAnswerBuilderContent(argv: Record<string, unknown>, format: string): string {
  const rawContent = typeof argv.content === "string" ? argv.content : undefined
  const sql = typeof argv.sql === "string" ? argv.sql : undefined

  if (rawContent === undefined && sql === undefined) {
    handledError("USAGE_ERROR", "Provide --content (DSL JSON) or --sql.", { format })
  }

  let dsl: Record<string, unknown>
  try {
    dsl = rawContent ? parseJsonObject(rawContent, "--content") : {}
  } catch (err) {
    return handledError("USAGE_ERROR", err instanceof Error ? err.message : String(err), { format })
  }
  if (sql !== undefined) dsl.sql = sql
  validateAnswerBuilderMetricNames(dsl, format)
  return sql === undefined ? rawContent as string : JSON.stringify(dsl)
}

// Syntax reference shown in the epilogue of answer-builder create/validate.
// Derived from hands-on authoring: the DSL shape, the ${placeholder} rule, the
// required+domain-unique metricName, and the window/CTE subquery-wrap trick.
const ANSWER_BUILDER_DSL_HELP = [
  "DSL (--content) structure:",
  "  {",
  '    "chartParams": [        // interactive inputs; reference in SQL as ${name}',
  '      {"name":"dims","type":"dimension","allowMulti":true,   // -> GROUP BY ${dims}',
  '       "fromTableRefs":[{"tableName":"cat.schema.table","columns":["region"]}]},',
  '      {"name":"filters","type":"filter","allowMulti":true,   // -> WHERE ${filters}',
  '       "fromTableRefs":[{"tableName":"cat.schema.table","columns":["channel"]}]}',
  "    ],",
  '    "outputColumns": [      // one per SELECT output column',
  '      {"name":"total_amt",           // MUST match the SQL AS alias',
  '       "metricName":"区域销售额",     // REQUIRED, and UNIQUE within the domain',
  '       "type":"decimal","stdTypeName":"double",  // type required; stdTypeName optional',
  '       "alias":["销售额"],            // optional display aliases',
  '       "description":"..."}           // optional',
  "    ],",
  '    "relatedTables": ["cat.schema.table", ...]   // every table the SQL touches',
  "  }",
  "  (Pass the SQL via --sql instead of embedding it in --content to avoid quote escaping.)",
  "",
  "Rules:",
  "  - Shell quoting: wrap --sql in single quotes so bash/zsh won't expand ${...} to empty",
  "    (an expanded placeholder yields `SELECT ,` -> CZLH-42000 at ','); or escape as \\${name}",
  "    inside double quotes. The ${...} must reach the CLI intact.",
  "  - Every ${name} in the SQL MUST have a matching chartParams entry, else CZLH-42000 syntax error.",
  "  - outputColumns[].metricName is REQUIRED and must be UNIQUE within the domain",
  "    (prefix generic names, e.g. 区域销售额 vs 行业销售额).",
  "  - Window/ROLLUP whose PARTITION BY / ORDER BY references a ${dims} column: compute in an",
  "    inner subquery with fixed column names, then `SELECT ${dims}, ...` in the outer query.",
  "  - Always run `answer-builder validate` (dry-run) before create.",
].join("\n")

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return value === undefined ? undefined : [String(value)]
  return value.map((item) => String(item))
}

function numberArray(value: unknown): number[] | undefined {
  const values = stringArray(value)
  if (!values) return undefined
  return values.map((item) => Number(item))
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function positiveIntegerValue(
  value: unknown,
  optionName: string,
  format: string,
): number | undefined {
  if (value === undefined) return undefined
  const parsed = numberValue(value)
  if (parsed !== undefined && Number.isInteger(parsed) && parsed > 0) return parsed
  handledError("USAGE_ERROR", `${optionName} must be a positive integer`, { format })
}

function requiredPositiveIntegerValue(value: unknown, optionName: string, format: string): number {
  if (value === undefined) handledError("USAGE_ERROR", `${optionName} is required`, { format })
  return positiveIntegerValue(value, optionName, format) as number
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

function parseLooseJsonValue(raw: string): unknown {
  const value = raw.trim()
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null") return null
  if (value.startsWith("{") || value.startsWith("[") || value.startsWith("\"")) {
    try {
      return JSON.parse(value)
    } catch {
      return raw
    }
  }
  return raw
}

function resolveTableSemanticsSetBody(argv: Record<string, unknown>): Record<string, unknown> {
  return mergeBody(parseJsonObject(typeof argv.body === "string" ? argv.body : undefined, "--body"), {
    alias: typeof argv.alias === "string" ? parseJsonArray(argv.alias, "--alias") : undefined,
    description: argv.description,
    semanticType: argv["semantic-type"],
    semanticTypeProperties: typeof argv["semantic-type-properties"] === "string"
      ? parseOptionalJsonObject(argv["semantic-type-properties"], "--semantic-type-properties")
      : undefined,
    intendedTypes: typeof argv["intended-types"] === "string" ? parseJsonArray(argv["intended-types"], "--intended-types") : undefined,
    hidden: argv.hidden,
    dimension: argv.dimension,
    index: argv.index,
    dictCode: argv["dict-code"],
  })
}

function pickTableSemanticsFields(value: unknown): Record<string, unknown> {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {}
  return {
    attrId: item.attrId,
    datasetId: item.datasetId,
    attrCode: item.attrCode,
    alias: item.alias,
    description: item.description,
    semanticType: item.semanticType,
    semanticTypeProperties: item.semanticTypeProperties,
    intendedTypes: item.intendedTypes,
    hidden: item.hidden,
    dimension: item.dimension,
    index: item.index,
    dictCode: item.dictCode,
  }
}

function resolveColumnVirtualBody(argv: Record<string, unknown>): Record<string, unknown> {
  return mergeBody(parseJsonObject(typeof argv.body === "string" ? argv.body : undefined, "--body"), {
    name: argv.name,
    type: argv.type,
    expression: argv.expression,
    logicRule: argv["logic-rule"],
  })
}

function resolveColumnVirtualDatasetId(argv: Record<string, unknown>): number | undefined {
  return typeof argv["dataset-id"] === "number" ? argv["dataset-id"] : undefined
}

function pickDomainPromptFields(value: unknown): Record<string, unknown> {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {}
  return {
    domainId: item.domainId,
    prompt: item.prompt ?? null,
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
  const studio = getProfileAgentContext(argv) ?? await getStudioContext(argv, { allowMissingWorkspace: true })
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
  const headers = mergeHeaders(
    {
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
    },
    studio.customHeaders,
  )
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

async function requestAnalyticsData(
  argv: Record<string, unknown>,
  route: AnalyticsRoute,
  body: Record<string, unknown>,
  query: Record<string, unknown> = {},
  ctx?: ResolvedContext,
): Promise<unknown> {
  const payload = await requestAnalytics(argv, route, body, query, ctx)
  const bizErr = extractBusinessError(payload)
  if (bizErr) {
    throw new AnalyticsBusinessError(bizErr.code, bizErr.message)
  }
  return unwrapResponse(payload)
}

function unwrapResponse(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const data = (payload as Record<string, unknown>).data
  return data ?? payload
}

interface PageInfo {
  total: number
  page_num: number
  page_size: number
  page_count: number
  has_more: boolean
}

// The backend list envelope carries total/pageNum/pageSize/pageCount alongside
// `data`. unwrapResponse() keeps only `data`, so `count` (= data.length) reflects
// the current page, not the total — hiding that more pages exist. Extract the
// pagination fields so list commands can surface them and warn on truncation.
function extractPageInfo(payload: unknown): PageInfo | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const p = payload as Record<string, unknown>
  const total = numberValue(p.total)
  const pageNum = numberValue(p.pageNum)
  const pageSize = numberValue(p.pageSize)
  const pageCount = numberValue(p.pageCount)
  if (total === undefined || pageSize === undefined) return undefined
  const num = pageNum ?? 1
  const count = pageCount ?? (pageSize > 0 ? Math.ceil(total / pageSize) : 1)
  return { total, page_num: num, page_size: pageSize, page_count: count, has_more: num < count }
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

function domainIdsFromObject(value: unknown): number[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const direct = numberArray(item.domainIds)
  if (direct && direct.length > 0) return direct
  const domains = item.domains
  if (!Array.isArray(domains)) return undefined
  const ids = domains
    .map((domain) => {
      if (!domain || typeof domain !== "object" || Array.isArray(domain)) return undefined
      const raw = (domain as Record<string, unknown>).id ?? (domain as Record<string, unknown>).domainId
      return numberValue(raw)
    })
    .filter((id): id is number => id !== undefined)
  return ids.length > 0 ? ids : undefined
}

function shouldFallbackStatusCommand(err: { code: string; message: string }): boolean {
  return /not found/i.test(err.message) || /不存在/.test(err.message)
}

function buildMetricUpdateBodyFromDetail(detail: unknown, status: "ENABLE" | "DISABLE"): Record<string, unknown> | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null
  const item = detail as Record<string, unknown>
  const domainIds = domainIdsFromObject(item)
  if (!domainIds || domainIds.length === 0) return null
  const names = stringArray(item.names) ?? (typeof item.name === "string" ? [item.name] : undefined)
  if (!names || names.length === 0) return null
  return mergeBody({}, {
    id: item.id,
    datasourceId: item.datasourceId,
    tableName: item.tableName,
    names,
    aggExpr: item.aggExpr,
    alias: stringArray(item.alias),
    description: item.description,
    domainIds,
    ext: item.ext,
    status,
  })
}

function buildAnswerBuilderUpdateBodyFromDetail(detail: unknown, status: "ENABLE" | "DISABLE"): Record<string, unknown> | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null
  const item = detail as Record<string, unknown>
  const domainIds = domainIdsFromObject(item)
  if (!domainIds || domainIds.length === 0) return null
  if (typeof item.analysisName !== "string" || item.analysisName.trim() === "") return null
  if (item.datasourceId === undefined || typeof item.content !== "string" || item.content.trim() === "") return null
  return mergeBody({}, {
    id: item.id,
    analysisName: item.analysisName,
    analysisDesc: item.analysisDesc,
    datasourceId: item.datasourceId,
    domainIds,
    content: item.content,
    extObj: item.extObj,
    status,
  })
}

async function executeStatusCommandWithUpdateFallback(
  name: string,
  argv: Record<string, unknown>,
  primaryRoute: AnalyticsRoute,
  primaryBody: Record<string, unknown>,
  detailRoute: AnalyticsRoute,
  detailBody: Record<string, unknown>,
  updateRoute: AnalyticsRoute,
  buildUpdateBody: (detail: unknown) => Record<string, unknown> | null,
): Promise<void> {
  const format = typeof argv.format === "string" ? argv.format : "json"
  const t0 = Date.now()
  const ctx = await resolveAnalyticsContext(argv)
  try {
    try {
      const payload = await requestAnalytics(argv, primaryRoute, primaryBody, {}, ctx)
      const bizErr = extractBusinessError(payload)
      if (!bizErr) {
        logOperation(name, { ok: true, timeMs: Date.now() - t0 })
        success(unwrapResponse(payload), { format, timeMs: Date.now() - t0 })
        return
      }
      if (!shouldFallbackStatusCommand(bizErr)) {
        logOperation(name, { ok: false, timeMs: Date.now() - t0 })
        error(bizErr.code, bizErr.message, { format })
        return
      }
    } catch (err) {
      if (!(err instanceof AnalyticsHttpError)) throw err
      if ((err.request.status ?? 0) < 500) throw err
    }

    const detailPayload = await requestAnalytics(argv, detailRoute, detailBody, {}, ctx)
    const detailErr = extractBusinessError(detailPayload)
    if (detailErr) {
      logOperation(name, { ok: false, timeMs: Date.now() - t0 })
      error(detailErr.code, detailErr.message, { format })
      return
    }
    const updateBody = buildUpdateBody(unwrapResponse(detailPayload))
    if (!updateBody) {
      logOperation(name, { ok: false, timeMs: Date.now() - t0 })
      error("ANALYTICS_AGENT_ERROR", `${name} fallback could not build update payload from detail response`, { format })
      return
    }
    const updatePayload = await requestAnalytics(argv, updateRoute, updateBody, {}, ctx)
    const updateErr = extractBusinessError(updatePayload)
    if (updateErr) {
      logOperation(name, { ok: false, timeMs: Date.now() - t0 })
      error(updateErr.code, updateErr.message, { format })
      return
    }
    logOperation(name, { ok: true, timeMs: Date.now() - t0 })
    success(unwrapResponse(updatePayload), { format, timeMs: Date.now() - t0 })
  } catch (err) {
    logOperation(name, { ok: false, timeMs: Date.now() - t0 })
    if (isHandledCliError(err)) return
    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
      format,
      ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
    })
  }
}

type StatusChangeMode =
  | { mode: "single"; id: number }
  | { mode: "batch"; domainId: number; datasourceId: number | undefined }

// Decide whether an enable/disable invocation targets one id (positional) or a
// whole domain (--all --domain-id). The two are mutually exclusive; one is
// required. Prints USAGE_ERROR and throws the handled sentinel on misuse.
function resolveStatusChangeMode(
  argv: Record<string, unknown>,
  positionalKey: string,
  format: string,
): StatusChangeMode {
  const rawId = argv[positionalKey]
  const hasId = rawId !== undefined
  const all = argv.all === true
  const domainIdRaw = argv["domain-id"]

  if (hasId && all) {
    handledError("USAGE_ERROR", `Pass either a single <${positionalKey}> or --all, not both.`, { format })
  }
  if (hasId) {
    return { mode: "single", id: positiveIntegerValue(rawId, `--${positionalKey}`, format) as number }
  }
  if (all) {
    if (domainIdRaw === undefined) {
      handledError("USAGE_ERROR", "--all requires --domain-id to scope the batch.", { format })
    }
    return {
      mode: "batch",
      domainId: requiredPositiveIntegerValue(domainIdRaw, "--domain-id", format),
      datasourceId: positiveIntegerValue(argv["datasource-id"], "--datasource-id", format),
    }
  }
  return handledError("USAGE_ERROR", `Provide a <${positionalKey}> or use --all --domain-id <id> for a batch.`, { format })
}

interface BatchTargetItem {
  id: number
  name: string
  status: string
}

function extractBatchTargets(data: unknown, nameKey: string): BatchTargetItem[] {
  if (!Array.isArray(data)) return []
  const targets: BatchTargetItem[] = []
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const id = numberValue(record.id)
    if (id === undefined) continue
    const rawName = record[nameKey]
    const name = typeof rawName === "string"
      ? rawName
      : Array.isArray(rawName) && typeof rawName[0] === "string"
        ? rawName[0]
        : String(id)
    const status = typeof record.status === "string" ? record.status : ""
    targets.push({ id, name, status })
  }
  return targets
}

// Per-item status change that throws on failure (for batch use), mirroring the
// single-item disable's primary→detail→update fallback: some ids reject the
// direct enable/disable endpoint and must be flipped via a full update payload.
async function applyStatusChangeWithFallback(
  argv: Record<string, unknown>,
  id: number,
  status: "ENABLE" | "DISABLE",
  ctx: ResolvedContext,
  primaryRoute: AnalyticsRoute,
  detailRoute: AnalyticsRoute,
  updateRoute: AnalyticsRoute,
  buildUpdateBody: (detail: unknown, status: "ENABLE" | "DISABLE") => Record<string, unknown> | null,
): Promise<void> {
  const body = { id }
  try {
    await requestAnalyticsData(argv, primaryRoute, body, {}, ctx)
    return
  } catch (err) {
    const isNotFound = err instanceof AnalyticsBusinessError && shouldFallbackStatusCommand(err)
    const isServerErr = err instanceof AnalyticsHttpError && (err.request.status ?? 0) >= 500
    if (!isNotFound && !isServerErr) throw err
  }
  const detail = await requestAnalyticsData(argv, detailRoute, body, {}, ctx)
  const updateBody = buildUpdateBody(detail, status)
  if (!updateBody) {
    throw new AnalyticsBusinessError("ANALYTICS_AGENT_ERROR", `could not build update payload for id ${id}`)
  }
  await requestAnalyticsData(argv, updateRoute, updateBody, {}, ctx)
}

async function runBatchStatusChange(
  name: string,
  argv: Record<string, unknown>,
  targetStatus: "ENABLE" | "DISABLE",
  listRoute: AnalyticsRoute,
  listBody: Record<string, unknown>,
  nameKey: string,
  applyOne: (id: number, ctx: ResolvedContext) => Promise<void>,
): Promise<void> {
  const format = typeof argv.format === "string" ? argv.format : "json"
  const t0 = Date.now()
  try {
    const ctx = await resolveAnalyticsContext(argv)

    // Paginate the list so `--all` covers every item, not just the API's
    // default first page. Loop until a page returns fewer than pageSize rows.
    // Dedup by id and cap the page count so a backend that ignores pageNum
    // (returning the same page forever) can't cause an infinite loop.
    const pageSize = 200
    const maxPages = 1000
    const targets: BatchTargetItem[] = []
    const seen = new Set<number>()
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const pageData = await requestAnalyticsData(
        argv,
        listRoute,
        mergeBody({ ...listBody }, { pageNum, pageSize }),
        {},
        ctx,
      )
      const pageItems = extractBatchTargets(pageData, nameKey)
      let added = 0
      for (const item of pageItems) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        targets.push(item)
        added++
      }
      const pageLen = Array.isArray(pageData) ? pageData.length : pageItems.length
      // Stop on a short page (last page) or when a full page contributed no new
      // ids (backend ignored pageNum and returned a duplicate page).
      if (pageLen < pageSize || added === 0) break
    }

    const results: Array<Record<string, unknown>> = []
    let succeeded = 0
    let failed = 0
    let skipped = 0

    for (const target of targets) {
      if (target.status === targetStatus) {
        skipped++
        results.push({ id: target.id, name: target.name, result: "skipped", reason: `already ${targetStatus}` })
        continue
      }
      try {
        await applyOne(target.id, ctx)
        succeeded++
        results.push({ id: target.id, name: target.name, result: "succeeded" })
      } catch (err) {
        failed++
        const message = err instanceof AnalyticsBusinessError
          ? `${err.code}: ${err.message}`
          : err instanceof Error ? err.message : String(err)
        results.push({ id: target.id, name: target.name, result: "failed", error: message })
      }
    }

    logOperation(name, { ok: failed === 0, timeMs: Date.now() - t0 })
    success(
      { total: targets.length, succeeded, failed, skipped, results },
      { format, timeMs: Date.now() - t0 },
    )
    // success() resets exitCode to EXIT_OK; override AFTER it so a partial
    // failure surfaces as a non-zero exit for scripts.
    if (failed > 0) process.exitCode = EXIT_BIZ_ERROR
  } catch (err) {
    logOperation(name, { ok: false, timeMs: Date.now() - t0 })
    if (isHandledCliError(err)) return
    const message = err instanceof AnalyticsBusinessError ? err.message : err instanceof Error ? err.message : String(err)
    const code = err instanceof AnalyticsBusinessError ? err.code : "ANALYTICS_AGENT_ERROR"
    error(code, message, {
      format,
      ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
    })
  }
}

// Read every dataset in a domain via `dataset/list`, paginating until exhausted.
// The list defaults to pageSize 10, so a single-page read misses datasets past
// the first page — the cause of spurious "not found in domain" on tables 11+.
// Dedup by datasetId and cap page count so a backend that ignores pageNum can't
// loop forever.
async function fetchAllDatasetsInDomain(
  argv: Record<string, unknown>,
  domainId: number,
  ctx: ResolvedContext,
): Promise<Record<string, unknown>[]> {
  const pageSize = 200
  const maxPages = 1000
  const all: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const pageData = await requestAnalyticsData(argv, ROUTES.datasetList, { domainIds: [domainId], pageNum, pageSize }, {}, ctx)
    const pageItems = Array.isArray(pageData) ? pageData as Record<string, unknown>[] : []
    let added = 0
    for (const item of pageItems) {
      const key = String(item.datasetId)
      if (seen.has(key)) continue
      seen.add(key)
      all.push(item)
      added++
    }
    if (pageItems.length < pageSize || added === 0) break
  }
  return all
}

// Update a dataset's display name and/or description through the open dataset
// API. The list step verifies the dataset belongs to the requested domain; the
// open update endpoint supports partial updates, so only changed fields are sent.
async function runTableUpdate(argv: Record<string, unknown>): Promise<void> {
  const format = typeof argv.format === "string" ? argv.format : "json"
  const t0 = Date.now()
  const datasetId = positiveIntegerValue(argv["dataset-id"], "--dataset-id", format)
  const domainId = requiredPositiveIntegerValue(argv["domain-id"], "--domain-id", format)
  const hasName = typeof argv.name === "string"
  const hasDesc = typeof argv.description === "string"
  if (!hasName && !hasDesc) {
    error("USAGE_ERROR", "Provide at least one of --name or --description", { format })
    return
  }
  if (hasName && (argv.name as string).trim() === "") {
    error("USAGE_ERROR", "--name must be non-empty", { format })
    return
  }
  try {
    const ctx = await resolveAnalyticsContext(argv)
    const items = await fetchAllDatasetsInDomain(argv, domainId, ctx)
    const current = items.find((d) => String(d.datasetId) === String(datasetId))
    if (!current) {
      error("ANALYTICS_AGENT_ERROR", `dataset ${datasetId} not found in domain ${domainId}`, { format })
      return
    }
    const body: Record<string, unknown> = { datasetId }
    if (hasName) body.displayName = (argv.name as string).trim()
    if (hasDesc) body.description = argv.description
    const updated = await requestAnalyticsData(argv, ROUTES.datasetUpdate, body, {}, ctx)
    logOperation("analytics-agent table update", { ok: true, timeMs: Date.now() - t0 })
    success(updated, { format, timeMs: Date.now() - t0 })
  } catch (err) {
    logOperation("analytics-agent table update", { ok: false, timeMs: Date.now() - t0 })
    if (isHandledCliError(err)) return
    const code = err instanceof AnalyticsBusinessError ? err.code : "ANALYTICS_AGENT_ERROR"
    error(code, err instanceof Error ? err.message : String(err), {
      format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
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
    const page = extractPageInfo(payload)
    const customAi = buildAiMessage?.(data)
    const pageAi = page?.has_more
      ? `Showing ${Array.isArray(data) ? data.length : 0} of ${page.total} (page ${page.page_num}/${page.page_count}). Pass --page-num/--page-size to fetch the rest.`
      : undefined
    success(data, {
      format,
      timeMs: Date.now() - t0,
      aiMessage: customAi ?? pageAi,
      ...(page ? { extra: { total: page.total, page_num: page.page_num, page_size: page.page_size, page_count: page.page_count, has_more: page.has_more } } : {}),
    })
  } catch (err) {
    logOperation(name, { ok: false, timeMs: Date.now() - t0 })
    if (isHandledCliError(err)) return
    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
      format,
      ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
    })
  }
}

async function executeKnowledgeNodeListCommand(
  name: string,
  argv: Record<string, unknown>,
  nodeTypeLabel: "file" | "folder" | undefined,
): Promise<void> {
  const format = typeof argv.format === "string" ? argv.format : "json"
  const t0 = Date.now()
  try {
    const payload = await requestAnalytics(argv, ROUTES.knowledgeNodeList, {}, {
      parentId: argv["parent-id"],
      domainId: argv["domain-id"],
    })
    const bizErr = extractBusinessError(payload)
    if (bizErr) {
      logOperation(name, { ok: false, timeMs: Date.now() - t0 })
      error(bizErr.code, bizErr.message, { format })
      return
    }
    const data = unwrapResponse(payload)
    const filtered = Array.isArray(data) && nodeTypeLabel
      ? data.filter((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false
        return (item as Record<string, unknown>).nodeTypeLabel === nodeTypeLabel
      })
      : data
    logOperation(name, { ok: true, timeMs: Date.now() - t0 })
    success(filtered, { format, timeMs: Date.now() - t0 })
  } catch (err) {
    logOperation(name, { ok: false, timeMs: Date.now() - t0 })
    if (isHandledCliError(err)) return
    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
      format,
      ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
    })
  }
}

async function executeKnowledgeNodeByPathCommand(
  name: string,
  argv: Record<string, unknown>,
  nodeTypeLabel: "file" | "folder" | undefined,
): Promise<void> {
  const format = typeof argv.format === "string" ? argv.format : "json"
  const t0 = Date.now()
  try {
    const pathValue = normalizedRemotePath(typeof argv.path === "string" ? argv.path : undefined)
    const payload = await requestAnalytics(argv, ROUTES.knowledgeNodeByPath, {}, {
      path: pathValue,
    })
    const bizErr = extractBusinessError(payload)
    if (bizErr) {
      logOperation(name, { ok: false, timeMs: Date.now() - t0 })
      error(bizErr.code, bizErr.message, { format })
      return
    }
    const data = unwrapResponse(payload)
    let normalized = data
    if (nodeTypeLabel && data && typeof data === "object" && !Array.isArray(data)) {
      const lookup = data as Record<string, unknown>
      const found = lookup.found === true
      const node = lookup.node
      if (found && node && typeof node === "object" && !Array.isArray(node)) {
        const nodeRecord = node as Record<string, unknown>
        if (nodeRecord.nodeTypeLabel !== nodeTypeLabel) {
          normalized = { found: false, node: null }
        }
      }
    }
    logOperation(name, { ok: true, timeMs: Date.now() - t0 })
    success(normalized, { format, timeMs: Date.now() - t0 })
  } catch (err) {
    logOperation(name, { ok: false, timeMs: Date.now() - t0 })
    if (isHandledCliError(err)) return
    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
      format,
      ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
    })
  }
}

async function executeKnowledgeNodeSearchCommand(
  name: string,
  argv: Record<string, unknown>,
  nodeTypeLabel: "file" | "folder",
): Promise<void> {
  const format = typeof argv.format === "string" ? argv.format : "json"
  const t0 = Date.now()
  try {
    const payload = await requestAnalytics(argv, ROUTES.knowledgeNodeSearch, {}, {
      keyword: argv.keyword,
      nodeType: nodeTypeLabel,
      pageNum: argv["page-num"],
      pageSize: argv["page-size"],
    })
    const bizErr = extractBusinessError(payload)
    if (bizErr) {
      logOperation(name, { ok: false, timeMs: Date.now() - t0 })
      error(bizErr.code, bizErr.message, { format })
      return
    }
    const data = unwrapResponse(payload) as Record<string, unknown>
    const list = Array.isArray(data?.list) ? data.list : []
    logOperation(name, { ok: true, timeMs: Date.now() - t0 })
    success(list, {
      format,
      timeMs: Date.now() - t0,
      extra: { count: typeof data?.total === "number" ? data.total : list.length },
    })
  } catch (err) {
    logOperation(name, { ok: false, timeMs: Date.now() - t0 })
    if (isHandledCliError(err)) return
    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
      format,
      ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
    })
  }
}

function knowledgeEntryBody(argv: Record<string, unknown>): Record<string, unknown> {
  return mergeBody(parseJsonObject(argv.body as string | undefined, "--body"), {
    aliases: stringArray(argv.alias),
    content: argv.content,
    dictionary: parseOptionalJsonObject(argv.dictionary as string | undefined, "--dictionary"),
    type: argv.type,
    domainIds: numberArray(argv["domain-id"]),
  })
}

async function knowledgeCreateBody(argv: Record<string, unknown>): Promise<Record<string, unknown>> {
  const content = typeof argv.content === "string"
    ? argv.content
    : typeof argv.file === "string"
      ? await Bun.file((await collectKnowledgeLocalFile(argv.file)).absolutePath).text()
      : undefined
  return mergeBody(parseJsonObject(argv.body as string | undefined, "--body"), {
    aliases: stringArray(argv.alias),
    content,
    dictionary: parseOptionalJsonObject(argv.dictionary as string | undefined, "--dictionary"),
    type: argv.type,
    domainIds: numberArray(argv["domain-id"]),
  })
}

function normalizedRemotePath(pathValue: string | undefined): string {
  if (!pathValue) return ""
  const normalized = pathValue.replaceAll("\\", "/").split("/").filter(Boolean).join("/")
  return normalized === "." ? "" : normalized
}

function joinRemotePath(...parts: Array<string | undefined>): string {
  return normalizedRemotePath(parts.filter(Boolean).join("/"))
}

async function collectKnowledgeLocalFile(localPath: string): Promise<{ absolutePath: string; filename: string }> {
  const absolutePath = resolve(localPath)
  let fileStat
  try {
    fileStat = await stat(absolutePath)
  } catch {
    throw new Error(`local path does not exist: ${localPath}`)
  }
  if (!fileStat.isFile()) {
    throw new Error(`local path must be a file: ${localPath}`)
  }
  return { absolutePath, filename: basename(absolutePath) }
}

async function lookupKnowledgeNode(
  argv: Record<string, unknown>,
  ctx: ResolvedContext,
  spaceId: number,
  pathValue: string,
): Promise<Record<string, unknown> | undefined> {
  if (!pathValue) return undefined
  const result = await requestAnalyticsData(
    { ...argv, "space-id": spaceId },
    ROUTES.knowledgeNodeByPath,
    {},
    { path: pathValue },
    ctx,
  ) as Record<string, unknown>
  return result.found ? result.node as Record<string, unknown> : undefined
}

async function ensureKnowledgeFolder(
  argv: Record<string, unknown>,
  ctx: ResolvedContext,
  spaceId: number,
  folderCache: Map<string, Record<string, unknown>>,
  createdFolders: string[],
  pathValue: string,
): Promise<number | undefined> {
  const normalized = normalizedRemotePath(pathValue)
  if (!normalized) return undefined
  const cached = folderCache.get(normalized)
  if (cached) return Number(cached.id)
  const existing = await lookupKnowledgeNode(argv, ctx, spaceId, normalized)
  if (existing) {
    if (existing.nodeTypeLabel !== "folder") {
      throw new Error(`target path is not a folder: ${normalized}`)
    }
    folderCache.set(normalized, existing)
    return Number(existing.id)
  }
  const parentPath = posix.dirname(normalized)
  const parentId = await ensureKnowledgeFolder(argv, ctx, spaceId, folderCache, createdFolders, parentPath === "." ? "" : parentPath)
  const created = await requestAnalyticsData(
    { ...argv, "space-id": spaceId },
    ROUTES.knowledgeFolderCreate,
    { parentId, name: basename(normalized) },
    {},
    ctx,
  ) as Record<string, unknown>
  folderCache.set(normalized, created)
  createdFolders.push(normalized)
  return Number(created.id)
}

async function uploadKnowledgeFile(
  argv: Record<string, unknown>,
  ctx: ResolvedContext,
  spaceId: number,
  folderCache: Map<string, Record<string, unknown>>,
  createdFolders: string[],
  absolutePath: string,
  remoteDir: string,
  remoteName: string,
  domainIds: number[] | undefined,
): Promise<{ remoteFilePath: string; overwritten: boolean; asyncTaskId?: number; nodeId: number }> {
  const parentId = await ensureKnowledgeFolder(argv, ctx, spaceId, folderCache, createdFolders, remoteDir)
  const remoteFilePath = joinRemotePath(remoteDir, remoteName)
  const existing = await lookupKnowledgeNode(argv, ctx, spaceId, remoteFilePath)
  if (existing && existing.nodeTypeLabel !== "file") {
    throw new Error(`remote path already exists as a folder: ${remoteFilePath}`)
  }

  const uploadUrl = await requestAnalyticsData(
    { ...argv, "space-id": spaceId },
    ROUTES.knowledgeUploadUrl,
    {
      parentId,
      filename: remoteName,
      domainIds,
      nodeId: existing?.id,
    },
    {},
    ctx,
  ) as Record<string, unknown>

  const uploadResponse = await fetch(String(uploadUrl.uploadUrl), {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: await Bun.file(absolutePath).arrayBuffer(),
  })
  if (!uploadResponse.ok) {
    throw new Error(`upload failed for ${remoteName}: HTTP ${uploadResponse.status}`)
  }

  const completed = await requestAnalyticsData(
    { ...argv, "space-id": spaceId, "node-id": uploadUrl.nodeId },
    ROUTES.knowledgeUploadComplete,
    {},
    {},
    ctx,
  ) as Record<string, unknown>

  return {
    remoteFilePath,
    overwritten: Boolean(existing),
    asyncTaskId: numberValue(completed.asyncTaskId),
    nodeId: Number(uploadUrl.nodeId),
  }
}

async function executeKnowledgeFileUploadCommand(argv: Record<string, unknown>): Promise<void> {
  const format = typeof argv.format === "string" ? argv.format : "json"
  const t0 = Date.now()
  try {
    const spaceId = Number(argv["space-id"])
    if (!spaceId) {
      throw new Error("--space-id is required")
    }
    const localFile = String(argv["local-file"] ?? "")
    const file = await collectKnowledgeLocalFile(localFile)
    const targetPath = normalizedRemotePath(typeof argv["target-path"] === "string" ? argv["target-path"] : undefined)
    const remoteName = normalizedRemotePath(typeof argv.name === "string" ? argv.name : undefined) || file.filename
    const domainIds = numberArray(argv["domain-id"])
    const ctx = await resolveAnalyticsContext(argv)
    const folderCache = new Map<string, Record<string, unknown>>()
    const createdFolders: string[] = []

    if (targetPath) {
      const targetNode = await lookupKnowledgeNode(argv, ctx, spaceId, targetPath)
      if (targetNode && targetNode.nodeTypeLabel !== "folder") {
        throw new Error(`target path must be a folder path: ${targetPath}`)
      }
    }

    const uploaded = await uploadKnowledgeFile(argv, ctx, spaceId, folderCache, createdFolders, file.absolutePath, targetPath, remoteName, domainIds)

    logOperation("analytics-agent knowledge file upload", { ok: true, timeMs: Date.now() - t0 })
    success({
      local_path: file.absolutePath,
      space_id: spaceId,
      target_path: targetPath,
      remote_name: remoteName,
      remote_file_path: uploaded.remoteFilePath,
      overwritten: uploaded.overwritten,
      created_folders: createdFolders,
      async_task_id: uploaded.asyncTaskId,
      node_id: uploaded.nodeId,
    }, { format, timeMs: Date.now() - t0 })
  } catch (err) {
    logOperation("analytics-agent knowledge file upload", { ok: false, timeMs: Date.now() - t0 })
    if (isHandledCliError(err)) return
    if (err instanceof AnalyticsBusinessError) {
      error(err.code, err.message, { format })
      return
    }
    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), { format })
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
            "prompt",
            "Manage domain custom prompt",
            (prompt) => {
              prompt.command(
                "get <domain-id>",
                "Get current domain prompt",
                (y) => y.positional("domain-id", { type: "number", demandOption: true, describe: "Domain ID" }),
                async (argv) => {
                  const format = typeof argv.format === "string" ? argv.format : "json"
                  const t0 = Date.now()
                  try {
                    const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.domainPromptGet, {})
                    const bizErr = extractBusinessError(payload)
                    if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                    success(pickDomainPromptFields(unwrapResponse(payload)), { format, timeMs: Date.now() - t0 })
                  } catch (err) {
                    if (isHandledCliError(err)) return
                    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                      format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                    })
                  }
                },
              )
              prompt.command(
                "set <domain-id>",
                "Set domain custom prompt",
                (y) =>
                  y
                    .positional("domain-id", { type: "number", demandOption: true, describe: "Domain ID" })
                    .option("prompt", { type: "string", describe: "Domain custom prompt" }),
                async (argv) => {
                  const format = typeof argv.format === "string" ? argv.format : "json"
                  if (typeof argv.prompt !== "string" || argv.prompt.trim() === "") {
                    error("USAGE_ERROR", "prompt is required", { format })
                    return
                  }
                  const t0 = Date.now()
                  try {
                    const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.domainPromptSet, {
                      prompt: argv.prompt.trim(),
                    })
                    const bizErr = extractBusinessError(payload)
                    if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                    success(pickDomainPromptFields(unwrapResponse(payload)), { format, timeMs: Date.now() - t0 })
                  } catch (err) {
                    if (isHandledCliError(err)) return
                    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                      format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                    })
                  }
                },
              )
              prompt.command(
                "clear <domain-id>",
                "Clear domain custom prompt",
                (y) => y.positional("domain-id", { type: "number", demandOption: true, describe: "Domain ID" }),
                async (argv) => {
                  const format = typeof argv.format === "string" ? argv.format : "json"
                  const t0 = Date.now()
                  try {
                    const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.domainPromptClear, {})
                    const bizErr = extractBusinessError(payload)
                    if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                    success(pickDomainPromptFields(unwrapResponse(payload)), { format, timeMs: Date.now() - t0 })
                  } catch (err) {
                    if (isHandledCliError(err)) return
                    error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                      format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                    })
                  }
                },
              )
              return commandGroup(prompt, "analytics-agent domain prompt")
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
      .command("table", "Manage Analytics Agent table semantics", (table) => {
        table.command("semantics", "Manage dataset column semantics", (semantics) => {
          semantics
            .command(
              "list <dataset-id>",
              "List semantics for all columns in a dataset",
              (y) => y.positional("dataset-id", { type: "number", demandOption: true, describe: "Dataset ID" }),
              async (argv) => {
                const format = typeof argv.format === "string" ? argv.format : "json"
                const t0 = Date.now()
                try {
                  const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.tableSemanticsList, {})
                  const bizErr = extractBusinessError(payload)
                  if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                  const data = unwrapResponse(payload)
                  const items = Array.isArray(data) ? data : []
                  success(items.map((item) => pickTableSemanticsFields(item)), { format, timeMs: Date.now() - t0 })
                } catch (err) {
                  if (isHandledCliError(err)) return
                  error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                    format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                  })
                }
              },
            )
            .command(
              "get <dataset-id> <attr-id>",
              "Show semantics detail of one dataset column",
              (y) =>
                y
                  .positional("dataset-id", { type: "number", demandOption: true, describe: "Dataset ID" })
                  .positional("attr-id", { type: "number", demandOption: true, describe: "Column attribute ID" }),
              async (argv) => {
                const format = typeof argv.format === "string" ? argv.format : "json"
                const t0 = Date.now()
                try {
                  const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.tableSemanticsGet, {})
                  const bizErr = extractBusinessError(payload)
                  if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                  success(pickTableSemanticsFields(unwrapResponse(payload)), { format, timeMs: Date.now() - t0 })
                } catch (err) {
                  if (isHandledCliError(err)) return
                  error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                    format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                  })
                }
              },
            )
            .command(
              "set <dataset-id> <attr-id>",
              "Update semantics of one dataset column",
              (y) =>
                y
                  .positional("dataset-id", { type: "number", demandOption: true, describe: "Dataset ID" })
                  .positional("attr-id", { type: "number", demandOption: true, describe: "Column attribute ID" })
                  .option("alias", { type: "string", describe: "Alias JSON array" })
                  .option("description", { type: "string", describe: "Column description" })
                  .option("semantic-type", { type: "string", describe: "Semantic type" })
                  .option("semantic-type-properties", { type: "string", describe: "Semantic type properties JSON object" })
                  .option("intended-types", { type: "string", describe: "Intended types JSON array" })
                  .option("hidden", { type: "boolean", describe: "Whether the column is hidden" })
                  .option("dimension", { type: "boolean", describe: "Whether the column is a dimension" })
                  .option("index", { type: "boolean", describe: "Whether the column is indexed" })
                  .option("dict-code", { type: "string", describe: "Dictionary code" })
                  .option("body", { type: "string", describe: "Full request body as JSON object" }),
              async (argv) => {
                const format = typeof argv.format === "string" ? argv.format : "json"
                let body: Record<string, unknown>
                try {
                  body = resolveTableSemanticsSetBody(argv as Record<string, unknown>)
                } catch (err) {
                  error("USAGE_ERROR", err instanceof Error ? err.message : String(err), { format })
                  return
                }
                if (Object.keys(body).length === 0) {
                  error("USAGE_ERROR", "At least one semantics field is required", { format })
                  return
                }
                const t0 = Date.now()
                try {
                  const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.tableSemanticsSet, body)
                  const bizErr = extractBusinessError(payload)
                  if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                  success(pickTableSemanticsFields(unwrapResponse(payload)), { format, timeMs: Date.now() - t0 })
                } catch (err) {
                  if (isHandledCliError(err)) return
                  error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                    format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                  })
                }
              },
            )
            .command(
              "prop <dataset-id> <attr-id>",
              "Update one semantics property of a dataset column",
              (y) =>
                y
                  .positional("dataset-id", { type: "number", demandOption: true, describe: "Dataset ID" })
                  .positional("attr-id", { type: "number", demandOption: true, describe: "Column attribute ID" })
                  .option("property", { type: "string", demandOption: true, describe: "Property name" })
                  .option("value", { type: "string", demandOption: true, describe: "Property value, JSON is accepted" }),
              async (argv) => {
                const format = typeof argv.format === "string" ? argv.format : "json"
                const t0 = Date.now()
                try {
                  const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.tableSemanticsProp, {
                    property: argv.property,
                    value: parseLooseJsonValue(String(argv.value)),
                  })
                  const bizErr = extractBusinessError(payload)
                  if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                  success(pickTableSemanticsFields(unwrapResponse(payload)), { format, timeMs: Date.now() - t0 })
                } catch (err) {
                  if (isHandledCliError(err)) return
                  error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                    format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                  })
                }
              },
            )
          return commandGroup(semantics, "analytics-agent table semantics")
        })
        table.command(
          "update",
          "Update a dataset's display name and/or description",
          (y) =>
            y
              .option("dataset-id", { type: "number", demandOption: true, describe: "Dataset ID" })
              .option("domain-id", { type: "number", demandOption: true, describe: "Domain ID the dataset belongs to" })
              .option("name", { type: "string", describe: "New display name" })
              .option("description", { type: "string", describe: "New description" }),
          async (argv) => runTableUpdate(argv as Record<string, unknown>),
        )
        return commandGroup(table, "analytics-agent table")
      })

      .command("column", "Manage Analytics Agent columns", (column) => {
        column.command("virtual", "Manage dataset virtual columns", (virtual) => {
          virtual
            .command(
              "list [dataset-id]",
              "List virtual columns of a dataset",
              (y) =>
                y
                  .positional("dataset-id", { type: "number", describe: "Dataset ID" })
                  .option("dataset-id", { type: "number", describe: "Dataset ID" }),
              async (argv) => {
                const format = typeof argv.format === "string" ? argv.format : "json"
                const datasetId = resolveColumnVirtualDatasetId(argv as Record<string, unknown>)
                if (datasetId === undefined) {
                  error("USAGE_ERROR", "dataset-id is required", { format })
                  return
                }
                const t0 = Date.now()
                try {
                  const payload = await requestAnalytics(
                    { ...(argv as Record<string, unknown>), "dataset-id": datasetId },
                    ROUTES.columnVirtualList,
                    {},
                  )
                  const bizErr = extractBusinessError(payload)
                  if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                  const data = unwrapResponse(payload)
                  const items = Array.isArray(data) ? data as Record<string, unknown>[] : []
                  success(items.map((item) => ({
                    attrId: item.attrId,
                    datasetId: item.datasetId,
                    name: item.name,
                    type: item.type,
                    expression: item.expression,
                  })), { format, timeMs: Date.now() - t0 })
                } catch (err) {
                  if (isHandledCliError(err)) return
                  error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                    format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                  })
                }
              },
            )
            .command(
              "compile",
              "Compile a virtual column expression without persisting it",
              (y) =>
                y
                  .option("dataset-id", { type: "number", demandOption: true, describe: "Dataset ID" })
                  .option("name", { type: "string", demandOption: true, describe: "Virtual column name" })
                  .option("type", { type: "string", demandOption: true, describe: "Virtual column type" })
                  .option("expression", { type: "string", describe: "Virtual column expression" })
                  .option("logic-rule", { type: "string", describe: "Raw logicRule JSON object" })
                  .option("body", { type: "string", describe: "Full request body as JSON object" }),
              async (argv) => {
                const format = typeof argv.format === "string" ? argv.format : "json"
                let body: Record<string, unknown>
                try {
                  body = resolveColumnVirtualBody(argv as Record<string, unknown>)
                } catch (err) {
                  error("USAGE_ERROR", err instanceof Error ? err.message : String(err), { format })
                  return
                }
                if (body.expression === undefined && body.logicRule === undefined) {
                  error("USAGE_ERROR", "Either --expression or --logic-rule is required", { format })
                  return
                }
                const t0 = Date.now()
                try {
                  const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.columnVirtualCompile, body)
                  const bizErr = extractBusinessError(payload)
                  if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                  const data = unwrapResponse(payload) as Record<string, unknown> | null
                  success(data ? {
                    datasetId: data.datasetId,
                    name: data.name,
                    type: data.type,
                    expression: data.expression,
                    sampleValues: data.sampleValues,
                  } : {}, { format, timeMs: Date.now() - t0 })
                } catch (err) {
                  if (isHandledCliError(err)) return
                  error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                    format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                  })
                }
              },
            )
            .command(
              "set",
              "Create and persist a virtual column",
              (y) =>
                y
                  .option("dataset-id", { type: "number", demandOption: true, describe: "Dataset ID" })
                  .option("name", { type: "string", demandOption: true, describe: "Virtual column name" })
                  .option("type", { type: "string", demandOption: true, describe: "Virtual column type" })
                  .option("expression", { type: "string", describe: "Virtual column expression" })
                  .option("logic-rule", { type: "string", describe: "Raw logicRule JSON object" })
                  .option("body", { type: "string", describe: "Full request body as JSON object" }),
              async (argv) => {
                const format = typeof argv.format === "string" ? argv.format : "json"
                let body: Record<string, unknown>
                try {
                  body = resolveColumnVirtualBody(argv as Record<string, unknown>)
                } catch (err) {
                  error("USAGE_ERROR", err instanceof Error ? err.message : String(err), { format })
                  return
                }
                if (body.expression === undefined && body.logicRule === undefined) {
                  error("USAGE_ERROR", "Either --expression or --logic-rule is required", { format })
                  return
                }
                const t0 = Date.now()
                try {
                  const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.columnVirtualSet, body)
                  const bizErr = extractBusinessError(payload)
                  if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                  const data = unwrapResponse(payload) as Record<string, unknown> | null
                  success(data ? {
                    attrId: data.attrId,
                    datasetId: data.datasetId,
                    name: data.name,
                    type: data.type,
                    expression: data.expression,
                  } : {}, { format, timeMs: Date.now() - t0 })
                } catch (err) {
                  if (isHandledCliError(err)) return
                  error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                    format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                  })
                }
              },
            )
            .command(
              "delete",
              "Delete a persisted virtual column",
              (y) =>
                y
                  .option("dataset-id", { type: "number", demandOption: true, describe: "Dataset ID" })
                  .option("attr-id", { type: "number", demandOption: true, describe: "Virtual column attribute ID" }),
              async (argv) => {
                const format = typeof argv.format === "string" ? argv.format : "json"
                const t0 = Date.now()
                try {
                  const payload = await requestAnalytics(argv as Record<string, unknown>, ROUTES.columnVirtualDelete, {})
                  const bizErr = extractBusinessError(payload)
                  if (bizErr) { error(bizErr.code, bizErr.message, { format }); return }
                  success({}, { format, timeMs: Date.now() - t0 })
                } catch (err) {
                  if (isHandledCliError(err)) return
                  error("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                    format, ...(err instanceof AnalyticsHttpError ? { extra: { request: err.request } } : {}),
                  })
                }
              },
            )
          return commandGroup(virtual, "analytics-agent column virtual")
        })
        return commandGroup(column, "analytics-agent column")
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
            "enable [metric-id]",
            "Enable one metric, or all metrics in a domain with --all --domain-id",
            (y) =>
              y
                .positional("metric-id", { type: "number", describe: "Metric ID (omit and use --all --domain-id for a batch)" })
                .option("all", { type: "boolean", describe: "Enable every metric in --domain-id" })
                .option("domain-id", { type: "number", describe: "Domain ID (required with --all)" })
                .option("datasource-id", { type: "number", describe: "Filter the batch to one datasource" })
                .example("cz-cli analytics-agent metric enable 197", "Enable a single metric")
                .example("cz-cli analytics-agent metric enable --all --domain-id 27", "Enable all metrics in a domain"),
            async (argv) => {
              const format = typeof argv.format === "string" ? argv.format : "json"
              let target: StatusChangeMode
              try {
                target = resolveStatusChangeMode(argv as Record<string, unknown>, "metric-id", format)
              } catch (err) {
                if (isHandledCliError(err)) return
                throw err
              }
              if (target.mode === "single") {
                const body = mergeBody({}, { id: target.id })
                await executeAnalyticsCommand("analytics-agent metric enable", argv as Record<string, unknown>, ROUTES.simpleMetricEnable, body)
                return
              }
              await runBatchStatusChange(
                "analytics-agent metric enable --all",
                argv as Record<string, unknown>,
                "ENABLE",
                ROUTES.simpleMetricList,
                mergeBody({}, { domainIds: [target.domainId], datasourceId: target.datasourceId }),
                "names",
                (id, ctx) => requestAnalyticsData(argv as Record<string, unknown>, ROUTES.simpleMetricEnable, { id }, {}, ctx).then(() => {}),
              )
            },
          )
          .command(
            "disable [metric-id]",
            "Disable one metric, or all metrics in a domain with --all --domain-id",
            (y) =>
              y
                .positional("metric-id", { type: "number", describe: "Metric ID (omit and use --all --domain-id for a batch)" })
                .option("all", { type: "boolean", describe: "Disable every metric in --domain-id" })
                .option("domain-id", { type: "number", describe: "Domain ID (required with --all)" })
                .option("datasource-id", { type: "number", describe: "Filter the batch to one datasource" })
                .example("cz-cli analytics-agent metric disable 197", "Disable a single metric")
                .example("cz-cli analytics-agent metric disable --all --domain-id 27", "Disable all metrics in a domain"),
            async (argv) => {
              const format = typeof argv.format === "string" ? argv.format : "json"
              let target: StatusChangeMode
              try {
                target = resolveStatusChangeMode(argv as Record<string, unknown>, "metric-id", format)
              } catch (err) {
                if (isHandledCliError(err)) return
                throw err
              }
              if (target.mode === "single") {
                const body = mergeBody({}, { id: target.id })
                await executeStatusCommandWithUpdateFallback(
                  "analytics-agent metric disable",
                  argv as Record<string, unknown>,
                  ROUTES.simpleMetricDisable,
                  body,
                  ROUTES.simpleMetricDetail,
                  body,
                  ROUTES.simpleMetricUpdate,
                  (detail) => buildMetricUpdateBodyFromDetail(detail, "DISABLE"),
                )
                return
              }
              await runBatchStatusChange(
                "analytics-agent metric disable --all",
                argv as Record<string, unknown>,
                "DISABLE",
                ROUTES.simpleMetricList,
                mergeBody({}, { domainIds: [target.domainId], datasourceId: target.datasourceId }),
                "names",
                (id, ctx) => applyStatusChangeWithFallback(
                  argv as Record<string, unknown>, id, "DISABLE", ctx,
                  ROUTES.simpleMetricDisable, ROUTES.simpleMetricDetail, ROUTES.simpleMetricUpdate,
                  buildMetricUpdateBodyFromDetail,
                ),
              )
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
                .option("content", { type: "string", describe: "Analysis DSL JSON (chartParams/outputColumns/relatedTables/sql) — see the syntax reference below" })
                .option("sql", { type: "string", describe: "SQL body, injected into content.sql. Single-quote it so the shell keeps ${...} placeholders intact (see notes below)" })
                .option("body", { type: "string", describe: "Full request body as JSON object" })
                .epilogue(ANSWER_BUILDER_DSL_HELP),
            async (argv) => {
              const format = typeof argv.format === "string" ? argv.format : "json"
              const content = resolveAnswerBuilderContent(argv as Record<string, unknown>, format)
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                analysisName: argv["analysis-name"],
                analysisDesc: argv["analysis-desc"],
                datasourceId: argv["datasource-id"],
                domainIds: [argv["domain-id"]],
                content,
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
                .option("content", { type: "string", describe: "Analysis DSL JSON (chartParams/outputColumns/relatedTables/sql) — see the syntax reference below" })
                .option("sql", { type: "string", describe: "SQL body, injected into content.sql. Single-quote it so the shell keeps ${...} placeholders intact (see notes below)" })
                .option("body", { type: "string", describe: "Full request body as JSON object" })
                .epilogue(ANSWER_BUILDER_DSL_HELP),
            async (argv) => {
              const format = typeof argv.format === "string" ? argv.format : "json"
              const content = resolveAnswerBuilderContent(argv as Record<string, unknown>, format)
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                id: argv["analysis-id"],
                analysisName: argv["analysis-name"],
                analysisDesc: argv["analysis-desc"],
                datasourceId: argv["datasource-id"],
                domainIds: [argv["domain-id"]],
                content,
              })
              await executeAnalyticsCommand("analytics-agent answer-builder update", argv as Record<string, unknown>, ROUTES.answerBuilderUpdate, body)
            },
          )
          .command(
            "enable [analysis-id]",
            "Enable one answer builder, or all in a domain with --all --domain-id",
            (y) =>
              y
                .positional("analysis-id", { type: "number", describe: "Answer builder ID (omit and use --all --domain-id for a batch)" })
                .option("all", { type: "boolean", describe: "Enable every answer builder in --domain-id" })
                .option("domain-id", { type: "number", describe: "Domain ID (required with --all)" })
                .option("datasource-id", { type: "number", describe: "Filter the batch to one datasource" })
                .example("cz-cli analytics-agent answer-builder enable 9", "Enable a single answer builder")
                .example("cz-cli analytics-agent answer-builder enable --all --domain-id 27", "Enable all answer builders in a domain"),
            async (argv) => {
              const format = typeof argv.format === "string" ? argv.format : "json"
              let target: StatusChangeMode
              try {
                target = resolveStatusChangeMode(argv as Record<string, unknown>, "analysis-id", format)
              } catch (err) {
                if (isHandledCliError(err)) return
                throw err
              }
              if (target.mode === "single") {
                const body = mergeBody({}, { id: target.id })
                await executeAnalyticsCommand("analytics-agent answer-builder enable", argv as Record<string, unknown>, ROUTES.answerBuilderEnable, body)
                return
              }
              await runBatchStatusChange(
                "analytics-agent answer-builder enable --all",
                argv as Record<string, unknown>,
                "ENABLE",
                ROUTES.answerBuilderList,
                mergeBody({}, { domainIds: [target.domainId], datasourceId: target.datasourceId }),
                "analysisName",
                (id, ctx) => requestAnalyticsData(argv as Record<string, unknown>, ROUTES.answerBuilderEnable, { id }, {}, ctx).then(() => {}),
              )
            },
          )
          .command(
            "disable [analysis-id]",
            "Disable one answer builder, or all in a domain with --all --domain-id",
            (y) =>
              y
                .positional("analysis-id", { type: "number", describe: "Answer builder ID (omit and use --all --domain-id for a batch)" })
                .option("all", { type: "boolean", describe: "Disable every answer builder in --domain-id" })
                .option("domain-id", { type: "number", describe: "Domain ID (required with --all)" })
                .option("datasource-id", { type: "number", describe: "Filter the batch to one datasource" })
                .example("cz-cli analytics-agent answer-builder disable 9", "Disable a single answer builder")
                .example("cz-cli analytics-agent answer-builder disable --all --domain-id 27", "Disable all answer builders in a domain"),
            async (argv) => {
              const format = typeof argv.format === "string" ? argv.format : "json"
              let target: StatusChangeMode
              try {
                target = resolveStatusChangeMode(argv as Record<string, unknown>, "analysis-id", format)
              } catch (err) {
                if (isHandledCliError(err)) return
                throw err
              }
              if (target.mode === "single") {
                const body = mergeBody({}, { id: target.id })
                await executeStatusCommandWithUpdateFallback(
                  "analytics-agent answer-builder disable",
                  argv as Record<string, unknown>,
                  ROUTES.answerBuilderDisable,
                  body,
                  ROUTES.answerBuilderDetail,
                  body,
                  ROUTES.answerBuilderUpdate,
                  (detail) => buildAnswerBuilderUpdateBodyFromDetail(detail, "DISABLE"),
                )
                return
              }
              await runBatchStatusChange(
                "analytics-agent answer-builder disable --all",
                argv as Record<string, unknown>,
                "DISABLE",
                ROUTES.answerBuilderList,
                mergeBody({}, { domainIds: [target.domainId], datasourceId: target.datasourceId }),
                "analysisName",
                (id, ctx) => applyStatusChangeWithFallback(
                  argv as Record<string, unknown>, id, "DISABLE", ctx,
                  ROUTES.answerBuilderDisable, ROUTES.answerBuilderDetail, ROUTES.answerBuilderUpdate,
                  buildAnswerBuilderUpdateBodyFromDetail,
                ),
              )
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
                .option("content", { type: "string", describe: "Analysis DSL JSON (chartParams/outputColumns/relatedTables/sql) — see the syntax reference below" })
                .option("sql", { type: "string", describe: "SQL body, injected into content.sql. Single-quote it so the shell keeps ${...} placeholders intact (see notes below)" })
                .option("body", { type: "string", describe: "Full request body as JSON object" })
                .epilogue(ANSWER_BUILDER_DSL_HELP),
            async (argv) => {
              const format = typeof argv.format === "string" ? argv.format : "json"
              const content = resolveAnswerBuilderContent(argv as Record<string, unknown>, format)
              const body = mergeBody(parseJsonObject(argv.body, "--body"), {
                analysisName: argv["analysis-name"],
                analysisDesc: argv["analysis-desc"],
                datasourceId: argv["datasource-id"],
                domainIds: [argv["domain-id"]],
                content,
              })
              await executeAnalyticsCommand("analytics-agent answer-builder validate", argv as Record<string, unknown>, ROUTES.answerBuilderValidate, body)
            },
          )
        return commandGroup(answerBuilder, "analytics-agent answer-builder")
      })
      .command("knowledge", "Manage Analytics Agent knowledge", (knowledge) => {
        knowledge
          .command(
            "list",
            "List structured knowledge entries",
            (y) =>
              y
                .option("keyword", { type: "string", describe: "Keyword for fuzzy search" })
                .option("domain-id", { type: "number", describe: "Bound domain ID" })
                .option("type", { type: "string", choices: ["text", "dictionary"], describe: "Knowledge type" })
                .option("page-num", { type: "number", describe: "Page number" })
                .option("page-size", { type: "number", describe: "Page size" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent knowledge list", argv as Record<string, unknown>, ROUTES.knowledgeEntryList, {}, {
                keyword: argv.keyword,
                domainId: argv["domain-id"],
                type: argv.type,
                pageNum: argv["page-num"],
                pageSize: argv["page-size"],
              })
            },
          )
          .command(
            "get <knowledge-id>",
            "Show structured knowledge detail",
            (y) => y.positional("knowledge-id", { type: "number", demandOption: true, describe: "Knowledge ID" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent knowledge get", argv as Record<string, unknown>, ROUTES.knowledgeEntryDetail, {})
            },
          )
          .command(
            "create",
            "Create structured knowledge",
            (y) =>
              y
                .option("alias", { type: "string", array: true, describe: "Knowledge alias, can be repeated" })
                .option("content", { type: "string", describe: "Text knowledge content" })
                .option("file", { type: "string", describe: "Local file path to load as text knowledge content" })
                .option("dictionary", { type: "string", describe: "Dictionary JSON object" })
                .option("type", { type: "string", choices: ["text", "dictionary"], describe: "Knowledge type" })
                .option("domain-id", { type: "number", array: true, describe: "Bound domain ID, can be repeated" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              const type = typeof argv.type === "string" ? argv.type : "text"
              if (type === "dictionary" && !argv.dictionary) {
                handledError("USAGE_ERROR", "dictionary knowledge requires --dictionary", { format: typeof argv.format === "string" ? argv.format : "json" })
              }
              if (type !== "dictionary" && !argv.content && !argv.file && !argv.dictionary) {
                handledError("USAGE_ERROR", "text knowledge requires --content or --file", { format: typeof argv.format === "string" ? argv.format : "json" })
              }
              let body: Record<string, unknown>
              try {
                body = await knowledgeCreateBody(argv as Record<string, unknown>)
              } catch (err) {
                handledError("ANALYTICS_AGENT_ERROR", err instanceof Error ? err.message : String(err), {
                  format: typeof argv.format === "string" ? argv.format : "json",
                })
              }
              await executeAnalyticsCommand("analytics-agent knowledge create", argv as Record<string, unknown>, ROUTES.knowledgeEntryCreate, body)
            },
          )
          .command(
            "update <knowledge-id>",
            "Update structured knowledge",
            (y) =>
              y
                .positional("knowledge-id", { type: "number", demandOption: true, describe: "Knowledge ID" })
                .option("alias", { type: "string", array: true, describe: "Knowledge alias, can be repeated" })
                .option("content", { type: "string", describe: "Text knowledge content" })
                .option("dictionary", { type: "string", describe: "Dictionary JSON object" })
                .option("type", { type: "string", choices: ["text", "dictionary"], describe: "Knowledge type" })
                .option("domain-id", { type: "number", array: true, describe: "Bound domain ID, can be repeated" })
                .option("body", { type: "string", describe: "Full request body as JSON object" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent knowledge update", argv as Record<string, unknown>, ROUTES.knowledgeEntryUpdate, knowledgeEntryBody(argv as Record<string, unknown>))
            },
          )
          .command(
            "delete <knowledge-id>",
            "Delete structured knowledge",
            (y) => y.positional("knowledge-id", { type: "number", demandOption: true, describe: "Knowledge ID" }),
            async (argv) => {
              await executeAnalyticsCommand("analytics-agent knowledge delete", argv as Record<string, unknown>, ROUTES.knowledgeEntryDelete, {})
            },
          )
          .command(
            "space",
            "Manage knowledge spaces",
            (space) => {
              space
                .command(
                  "list",
                  "List knowledge spaces",
                  (y) => y.option("domain-id", { type: "number", describe: "Bound domain ID" }),
                  async (argv) => {
                    await executeAnalyticsCommand("analytics-agent knowledge space list", argv as Record<string, unknown>, ROUTES.knowledgeSpaceList, {}, {
                      domainId: argv["domain-id"],
                    })
                  },
                )
                .command(
                  "create",
                  "Create a knowledge space",
                  (y) =>
                    y
                      .option("name", { type: "string", demandOption: true, describe: "Space name" })
                      .option("description", { type: "string", describe: "Space description" })
                      .option("ocr-model-identifier", { type: "string", describe: "OCR model identifier" })
                      .option("body", { type: "string", describe: "Full request body as JSON object" }),
                  async (argv) => {
                    const body = mergeBody(parseJsonObject(argv.body as string | undefined, "--body"), {
                      name: argv.name,
                      description: argv.description,
                      ocrModelIdentifier: argv["ocr-model-identifier"],
                    })
                    await executeAnalyticsCommand("analytics-agent knowledge space create", argv as Record<string, unknown>, ROUTES.knowledgeSpaceCreate, body)
                  },
                )
                .command(
                  "rename <space-id>",
                  "Rename a knowledge space",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .option("name", { type: "string", demandOption: true, describe: "New space name" })
                      .option("body", { type: "string", describe: "Full request body as JSON object" }),
                  async (argv) => {
                    const body = mergeBody(parseJsonObject(argv.body as string | undefined, "--body"), {
                      name: argv.name,
                    })
                    await executeAnalyticsCommand("analytics-agent knowledge space rename", argv as Record<string, unknown>, ROUTES.knowledgeSpaceRename, body)
                  },
                )
                .command(
                  "delete <space-id>",
                  "Delete a knowledge space",
                  (y) => y.positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" }),
                  async (argv) => {
                    await executeAnalyticsCommand("analytics-agent knowledge space delete", argv as Record<string, unknown>, ROUTES.knowledgeSpaceDelete, {})
                  },
                )
              return commandGroup(space, "analytics-agent knowledge space")
            },
          )
          .command(
            "folder",
            "Manage knowledge folders",
            (folder) => {
              folder
                .command(
                  "list <space-id>",
                  "List folder children in a knowledge space",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .option("parent-id", { type: "number", describe: "Parent folder node ID" })
                      .option("domain-id", { type: "number", describe: "Bound domain ID filter" }),
                  async (argv) => {
                    await executeKnowledgeNodeListCommand("analytics-agent knowledge folder list", argv as Record<string, unknown>, undefined)
                  },
                )
                .command(
                  "create <space-id>",
                  "Create a folder in a knowledge space",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .option("parent-id", { type: "number", describe: "Parent folder node ID" })
                      .option("name", { type: "string", demandOption: true, describe: "Folder name" }),
                  async (argv) => {
                    await executeAnalyticsCommand("analytics-agent knowledge folder create", argv as Record<string, unknown>, ROUTES.knowledgeFolderCreate, {
                      parentId: argv["parent-id"],
                      name: argv.name,
                    })
                  },
                )
                .command(
                  "by-path <space-id>",
                  "Find a folder node by remote path",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .option("path", { type: "string", demandOption: true, describe: "Remote folder path" }),
                  async (argv) => {
                    await executeKnowledgeNodeByPathCommand("analytics-agent knowledge folder by-path", argv as Record<string, unknown>, "folder")
                  },
                )
                .command(
                  "search <space-id>",
                  "Search folder nodes by name in a knowledge space",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .option("keyword", { type: "string", demandOption: true, describe: "Search keyword" })
                      .option("page-num", { type: "number", describe: "Page number" })
                      .option("page-size", { type: "number", describe: "Page size" }),
                  async (argv) => {
                    await executeKnowledgeNodeSearchCommand("analytics-agent knowledge folder search", argv as Record<string, unknown>, "folder")
                  },
                )
                .command(
                  "sort <space-id>",
                  "Update folder child order in a knowledge space",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .option("node-id", { type: "number", array: true, demandOption: true, describe: "Ordered child node ID, repeat for each node" })
                      .option("parent-id", { type: "number", describe: "Parent folder node ID, use 0 for root" })
                      .option("body", { type: "string", describe: "Full request body as JSON object" }),
                  async (argv) => {
                    const body = mergeBody(parseJsonObject(argv.body as string | undefined, "--body"), {
                      parentId: argv["parent-id"],
                      nodeIds: numberArray(argv["node-id"]),
                    })
                    await executeAnalyticsCommand("analytics-agent knowledge folder sort", argv as Record<string, unknown>, ROUTES.knowledgeNodeSort, body)
                  },
                )
                .command(
                  "delete <space-id> <node-id>",
                  "Delete one folder node",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .positional("node-id", { type: "number", demandOption: true, describe: "Knowledge folder node ID" }),
                  async (argv) => {
                    await executeAnalyticsCommand("analytics-agent knowledge folder delete", argv as Record<string, unknown>, ROUTES.knowledgeNodeDelete, {})
                  },
                )
                .command(
                  "rename <space-id> <node-id>",
                  "Rename one folder node",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .positional("node-id", { type: "number", demandOption: true, describe: "Knowledge folder node ID" })
                      .option("name", { type: "string", demandOption: true, describe: "New folder name" })
                      .option("body", { type: "string", describe: "Full request body as JSON object" }),
                  async (argv) => {
                    const body = mergeBody(parseJsonObject(argv.body as string | undefined, "--body"), {
                      name: argv.name,
                    })
                    await executeAnalyticsCommand("analytics-agent knowledge folder rename", argv as Record<string, unknown>, ROUTES.knowledgeNodeRename, body)
                  },
                )
                .command(
                  "move <space-id> <node-id>",
                  "Move one folder node",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .positional("node-id", { type: "number", demandOption: true, describe: "Knowledge folder node ID" })
                      .option("parent-id", { type: "number", demandOption: true, describe: "Target parent folder node ID, use 0 for root" })
                      .option("body", { type: "string", describe: "Full request body as JSON object" }),
                  async (argv) => {
                    const body = mergeBody(parseJsonObject(argv.body as string | undefined, "--body"), {
                      parentId: argv["parent-id"],
                    })
                    await executeAnalyticsCommand("analytics-agent knowledge folder move", argv as Record<string, unknown>, ROUTES.knowledgeNodeMove, body)
                  },
                )
                .command(
                  "copy <space-id> <node-id>",
                  "Copy one folder node",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .positional("node-id", { type: "number", demandOption: true, describe: "Knowledge folder node ID" })
                      .option("parent-id", { type: "number", demandOption: true, describe: "Target parent folder node ID, use 0 for root" })
                      .option("body", { type: "string", describe: "Full request body as JSON object" }),
                  async (argv) => {
                    const body = mergeBody(parseJsonObject(argv.body as string | undefined, "--body"), {
                      parentId: argv["parent-id"],
                    })
                    await executeAnalyticsCommand("analytics-agent knowledge folder copy", argv as Record<string, unknown>, ROUTES.knowledgeNodeCopy, body)
                  },
                )
              return commandGroup(folder, "analytics-agent knowledge folder")
            },
          )
          .command(
            "file",
            "Manage knowledge files",
            (file) => {
              file
                .command(
                  "list <space-id>",
                  "List file nodes in a knowledge space",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .option("parent-id", { type: "number", describe: "Parent folder node ID" })
                      .option("domain-id", { type: "number", describe: "Bound domain ID filter" }),
                  async (argv) => {
                    await executeKnowledgeNodeListCommand("analytics-agent knowledge file list", argv as Record<string, unknown>, "file")
                  },
                )
                .command(
                  "get <space-id> <node-id>",
                  "Read one knowledge file",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .positional("node-id", { type: "number", demandOption: true, describe: "Knowledge file node ID" })
                      .option("offset-line", { type: "number", describe: "Read from line offset" })
                      .option("limit-line", { type: "number", describe: "Read max line count" }),
                  async (argv) => {
                    await executeAnalyticsCommand("analytics-agent knowledge file get", argv as Record<string, unknown>, ROUTES.knowledgeNodeContent, {}, {
                      offsetLine: argv["offset-line"],
                      limitLine: argv["limit-line"],
                    })
                  },
                )
                .command(
                  "delete <space-id> <node-id>",
                  "Delete one knowledge file node",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .positional("node-id", { type: "number", demandOption: true, describe: "Knowledge file node ID" }),
                  async (argv) => {
                    await executeAnalyticsCommand("analytics-agent knowledge file delete", argv as Record<string, unknown>, ROUTES.knowledgeNodeDelete, {})
                  },
                )
                .command(
                  "rename <space-id> <node-id>",
                  "Rename one knowledge file node",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .positional("node-id", { type: "number", demandOption: true, describe: "Knowledge file node ID" })
                      .option("name", { type: "string", demandOption: true, describe: "New file name" })
                      .option("body", { type: "string", describe: "Full request body as JSON object" }),
                  async (argv) => {
                    const body = mergeBody(parseJsonObject(argv.body as string | undefined, "--body"), {
                      name: argv.name,
                    })
                    await executeAnalyticsCommand("analytics-agent knowledge file rename", argv as Record<string, unknown>, ROUTES.knowledgeNodeRename, body)
                  },
                )
                .command(
                  "move <space-id> <node-id>",
                  "Move one knowledge file node",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .positional("node-id", { type: "number", demandOption: true, describe: "Knowledge file node ID" })
                      .option("parent-id", { type: "number", demandOption: true, describe: "Target parent folder node ID, use 0 for root" })
                      .option("body", { type: "string", describe: "Full request body as JSON object" }),
                  async (argv) => {
                    const body = mergeBody(parseJsonObject(argv.body as string | undefined, "--body"), {
                      parentId: argv["parent-id"],
                    })
                    await executeAnalyticsCommand("analytics-agent knowledge file move", argv as Record<string, unknown>, ROUTES.knowledgeNodeMove, body)
                  },
                )
                .command(
                  "copy <space-id> <node-id>",
                  "Copy one knowledge file node",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .positional("node-id", { type: "number", demandOption: true, describe: "Knowledge file node ID" })
                      .option("parent-id", { type: "number", demandOption: true, describe: "Target parent folder node ID, use 0 for root" })
                      .option("body", { type: "string", describe: "Full request body as JSON object" }),
                  async (argv) => {
                    const body = mergeBody(parseJsonObject(argv.body as string | undefined, "--body"), {
                      parentId: argv["parent-id"],
                    })
                    await executeAnalyticsCommand("analytics-agent knowledge file copy", argv as Record<string, unknown>, ROUTES.knowledgeNodeCopy, body)
                  },
                )
                .command(
                  "upload <space-id> <local-file>",
                  "Upload one local file into a knowledge space",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .positional("local-file", { type: "string", demandOption: true, describe: "Local file path" })
                      .option("target-path", { type: "string", describe: "Remote target folder path" })
                      .option("name", { type: "string", describe: "Remote file name override" })
                      .option("domain-id", { type: "number", array: true, describe: "Bound domain ID, can be repeated" }),
                  async (argv) => {
                    await executeKnowledgeFileUploadCommand(argv as Record<string, unknown>)
                  },
                )
                .command(
                  "by-path <space-id>",
                  "Find a file node by remote path",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .option("path", { type: "string", demandOption: true, describe: "Remote file path" }),
                  async (argv) => {
                    await executeKnowledgeNodeByPathCommand("analytics-agent knowledge file by-path", argv as Record<string, unknown>, "file")
                  },
                )
                .command(
                  "search <space-id>",
                  "Search file nodes by name in a knowledge space",
                  (y) =>
                    y
                      .positional("space-id", { type: "number", demandOption: true, describe: "Knowledge space ID" })
                      .option("keyword", { type: "string", demandOption: true, describe: "Search keyword" })
                      .option("page-num", { type: "number", describe: "Page number" })
                      .option("page-size", { type: "number", describe: "Page size" }),
                  async (argv) => {
                    await executeKnowledgeNodeSearchCommand("analytics-agent knowledge file search", argv as Record<string, unknown>, "file")
                  },
                )
              return commandGroup(file, "analytics-agent knowledge file")
            },
          )
        return commandGroup(knowledge, "analytics-agent knowledge")
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
            "delete",
            "Delete a text2insight session by session ID",
            (y) =>
              y
                .option("session-id", { type: "number", demandOption: true, describe: "Session ID" }),
            async (argv) => {
              const format = typeof argv.format === "string" ? argv.format : "json"
              const sessionId = requiredPositiveIntegerValue(argv["session-id"], "--session-id", format)
              const body = mergeBody({}, { sessionId })
              await executeAnalyticsCommand(
                "analytics-agent session delete",
                argv as Record<string, unknown>,
                ROUTES.sessionDelete,
                body,
                {},
                () => `Session deleted (id=${sessionId}).`,
              )
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
