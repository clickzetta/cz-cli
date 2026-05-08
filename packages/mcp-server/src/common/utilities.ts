/**
 * utilities.ts — port of cz_mcp/common/utilities.py
 *
 * Python → TS mapping:
 *   utilities.py:31-70    json_serializer()              → jsonSerializer()
 *   utilities.py:73-120   convert_df_to_dict()           → convertDfToDict()
 *   utilities.py:123-142  to_builtin_type()              → toBuiltinType()
 *   utilities.py:145-158  data_to_yaml()                 → dataToYaml()
 *   utilities.py:161-214  types_compatible()             → typesCompatible()
 *   utilities.py:217-233  ResponseOptimizationConfig     → ResponseOptimizationConfig
 *   utilities.py:236-290  ResponseBuilder._optimize_data → _optimizeData()
 *   utilities.py:293-532  create_data_intensive_response → createDataIntensiveResponse()
 *   utilities.py:534-547  create_compact_response        → createCompactResponse()
 *   utilities.py:549-577  create_unoptimized_response    → createUnoptimizedResponse()
 *   utilities.py:581-592  create_text_response           → createTextResponse()
 *   utilities.py:594-625  create_sql_result_response     → createSqlResultResponse()
 *   utilities.py:627-751  _format_user_friendly_error    → formatUserFriendlyError()
 *   utilities.py:753-851  _clean_backend_error           → cleanBackendError()
 *   utilities.py:853-895  _clean_error_data              → cleanErrorData()
 *   utilities.py:897-915  create_error_response          → createErrorResponse()
 *   utilities.py:917-988  wrap_text_contents_with_config → wrapTextContentsWithConfig()
 *   utilities.py:990-1018 create_yaml_json_response      → createYamlJsonResponse()
 *   utilities.py:1020-1024 safe_get_config_attr          → safeGetConfigAttr()
 *
 * Divergences:
 *   - Python uses numpy/pandas; TS uses plain objects/arrays.
 *   - Python uses yaml.dump; TS uses a simple YAML serializer (no new deps).
 *   - Python's mcp.types.TextContent/EmbeddedResource → plain TS objects.
 *   - ResponseBuilder static methods are exported as standalone functions.
 *   - MCP_VERBOSE env var check is preserved.
 */

import { randomUUID } from "node:crypto"
import type { StudioConfig } from "../config/profile.js"

// ---------------------------------------------------------------------------
// MCP content types (mirrors mcp.types in Python)
// ---------------------------------------------------------------------------
export interface TextContent {
  type: "text"
  text: string
}

export interface EmbeddedResource {
  type: "resource"
  resource: {
    uri: string
    text: string
    mimeType: string
  }
}

export type McpContent = TextContent | EmbeddedResource

// ---------------------------------------------------------------------------
// Response config helpers — utilities.py:17-28
// ---------------------------------------------------------------------------
function shouldIncludeSql(): boolean {
  return (process.env["MCP_VERBOSE"] ?? "false").toLowerCase() === "true"
}

function getWarning(warningType: string, context: Record<string, unknown> = {}): string | null {
  if (warningType === "result_truncated") {
    const limit = context["limit"] ?? 50
    const maxLimit = context["max_limit"] ?? 100
    return `Results truncated to ${limit} rows. Use limit parameter (max ${maxLimit}) for more.`
  }
  return null
}

// ---------------------------------------------------------------------------
// utilities.py:31-70 — json_serializer
// ---------------------------------------------------------------------------
export function jsonSerializer(obj: unknown): unknown {
  if (obj instanceof Date) return obj.toISOString()
  if (obj instanceof Uint8Array || obj instanceof ArrayBuffer) {
    return Buffer.from(obj as Uint8Array).toString("utf-8")
  }
  if (obj instanceof Set || obj instanceof Map) {
    return Array.from(obj as Set<unknown>)
  }
  if (typeof obj === "bigint") return Number(obj)
  return String(obj)
}

// ---------------------------------------------------------------------------
// utilities.py:73-120 — convert_df_to_dict
// ---------------------------------------------------------------------------
export function convertDfToDict(
  data: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return data.map((row) => {
    const converted: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      converted[key] = _convertValue(value)
    }
    return converted
  })
}

function _convertValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value
  if (typeof value === "string") {
    if (value === "True") return true
    if (value === "False") return false
    return value
  }
  if (Array.isArray(value)) return value
  return String(value)
}

// ---------------------------------------------------------------------------
// utilities.py:123-142 — to_builtin_type
// ---------------------------------------------------------------------------
export function toBuiltinType(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(toBuiltinType)
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = toBuiltinType(v)
    }
    return result
  }
  return obj
}

// ---------------------------------------------------------------------------
// utilities.py:145-158 — data_to_yaml (simple serializer, no new deps)
// ---------------------------------------------------------------------------
export function dataToYaml(data: unknown, indent = 0): string {
  const pad = "  ".repeat(indent)
  if (data === null || data === undefined) return `${pad}null`
  if (typeof data === "boolean") return `${pad}${data}`
  if (typeof data === "number") return `${pad}${data}`
  if (typeof data === "string") {
    if (data.includes("\n")) {
      const lines = data.split("\n").map((l) => `${pad}  ${l}`)
      return `${pad}|-\n${lines.join("\n")}`
    }
    if (
      /[:{}\[\],&*#?|<>=!%@`]/.test(data) ||
      data === "" ||
      /^(true|false|null|yes|no)$/i.test(data)
    ) {
      return `${pad}"${data.replace(/"/g, '\\"')}"`
    }
    return `${pad}${data}`
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return `${pad}[]`
    return data
      .map((item) => {
        const rendered = dataToYaml(item, indent + 1).trimStart()
        return `${pad}- ${rendered}`
      })
      .join("\n")
  }
  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0) return `${pad}{}`
    return entries
      .map(([k, v]) => {
        const isSimple = typeof v !== "object" || v === null
        if (isSimple) {
          return `${pad}${k}: ${dataToYaml(v, indent + 1).trimStart()}`
        }
        return `${pad}${k}:\n${dataToYaml(v, indent + 1)}`
      })
      .join("\n")
  }
  return `${pad}${String(data)}`
}

// ---------------------------------------------------------------------------
// utilities.py:161-214 — types_compatible
// ---------------------------------------------------------------------------
export function typesCompatible(existingType: string, newType: string): boolean {
  const a = existingType.toLowerCase().trim()
  const b = newType.toLowerCase().trim()
  if (a === b) return true

  const compatMap: Record<string, string[]> = {
    int: ["bigint", "integer", "smallint", "tinyint", "int64", "int32", "int16", "int8"],
    bigint: ["int", "integer", "smallint", "tinyint", "int64", "int32", "int16", "int8"],
    integer: ["int", "bigint", "smallint", "tinyint", "int64", "int32", "int16", "int8"],
    float: ["double", "decimal", "numeric", "real", "float64", "float32"],
    double: ["float", "decimal", "numeric", "real", "float64", "float32"],
    decimal: ["float", "double", "numeric", "real", "float64", "float32"],
    string: ["varchar", "char", "text", "clob"],
    varchar: ["string", "char", "text", "clob"],
    char: ["string", "varchar", "text", "clob"],
    text: ["string", "varchar", "char", "clob"],
    timestamp: ["datetime", "timestamptz"],
    datetime: ["timestamp", "timestamptz"],
    date: ["timestamp", "datetime"],
    boolean: ["bool", "bit"],
    bool: ["boolean", "bit"],
  }

  if (compatMap[a]?.includes(b)) return true
  if (compatMap[b]?.includes(a)) return true
  return false
}

// ---------------------------------------------------------------------------
// utilities.py:217-233 — ResponseOptimizationConfig
// ---------------------------------------------------------------------------
export class ResponseOptimizationConfig {
  static readonly COMPRESSION_LEVEL = "smart"
  static readonly PRESERVE_ALL_DATA = true
  static readonly MAX_ITEMS_DISPLAY = -1

  static getConfig(): { level: string; preserveData: boolean; maxItems: number } {
    const level = (process.env["MCP_RESPONSE_COMPRESSION"] ?? "smart").toLowerCase()
    return {
      level,
      preserveData: level !== "aggressive",
      maxItems: level !== "aggressive" ? -1 : 50,
    }
  }
}

// ---------------------------------------------------------------------------
// Shared sets — utilities.py:243-254
// ---------------------------------------------------------------------------
const ALWAYS_REMOVE_FIELDS = new Set([
  "execution_time",
  "server_version",
  "request_id",
  "session_id",
  "query_id",
  "timestamp",
  "response_time",
  "trace_id",
  "span_id",
  "correlation_id",
  "api_version",
  "sdk_version",
  "client_version",
  "host",
  "port",
  "process_id",
  "thread_id",
  "memory_usage",
  "cpu_usage",
])

const IMPORTANT_FIELDS = new Set([
  "sql_conversion",
  "sql_conversion_note",
  "sql_query_executed",
])

// ---------------------------------------------------------------------------
// utilities.py:256-290 — ResponseBuilder._optimize_data
// ---------------------------------------------------------------------------
export function _optimizeData(data: unknown): unknown {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    const optimized: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj)) {
      if (ALWAYS_REMOVE_FIELDS.has(key)) continue

      if (typeof value === "object" && value !== null) {
        const optimizedValue = _optimizeData(value)
        const isEmpty = Array.isArray(optimizedValue)
          ? (optimizedValue as unknown[]).length === 0
          : Object.keys(optimizedValue as object).length === 0
        if (!isEmpty || IMPORTANT_FIELDS.has(key)) {
          optimized[key] = optimizedValue
        }
      } else {
        optimized[key] = value
      }
    }

    const keys = Object.keys(optimized)
    if (keys.length === 1 && keys[0] === "data") {
      return optimized["data"]
    }
    return optimized
  }

  if (Array.isArray(data)) {
    return (data as unknown[])
      .map(_optimizeData)
      .filter((item) => {
        if (item === null || item === undefined) return false
        if (typeof item === "object") return Object.keys(item as object).length > 0
        return true
      })
  }

  return data
}

// ---------------------------------------------------------------------------
// ResponseBuilder — utilities.py:236-1018
// ---------------------------------------------------------------------------
export class ResponseBuilder {
  static createDataIntensiveResponse(data: unknown, toolName?: string): McpContent[] {
    if (typeof data !== "object" || data === null) {
      return ResponseBuilder.createYamlJsonResponse(data)
    }

    // read_query special handling
    if (toolName === "read_query" && Array.isArray(data) && data.length > 0) {
      const queryResult = typeof data[0] === "object" && data[0] !== null ? data[0] as Record<string, unknown> : data
      const resultData = (queryResult as Record<string, unknown>)["result"] ?? []
      const coreData: Record<string, unknown> = {
        data: resultData,
        count: (queryResult as Record<string, unknown>)["count"] ?? (Array.isArray(resultData) ? resultData.length : 0),
      }
      if ((queryResult as Record<string, unknown>)["truncated"]) {
        coreData["truncated"] = true
        coreData["limit"] = (queryResult as Record<string, unknown>)["limit"] ?? 50
        const warning = getWarning("result_truncated", { limit: coreData["limit"], max_limit: 100 })
        if (warning) coreData["hint"] = warning
        else if ((queryResult as Record<string, unknown>)["hint"]) coreData["hint"] = (queryResult as Record<string, unknown>)["hint"]
      }
      if (shouldIncludeSql() && (queryResult as Record<string, unknown>)["sql_executed"]) {
        coreData["sql"] = (queryResult as Record<string, unknown>)["sql_executed"]
      }
      return ResponseBuilder.createYamlJsonResponse(coreData)
    }

    // show_object_list special handling
    if (toolName === "show_object_list" && Array.isArray(data) && data.length > 0) {
      const resultInfo = (typeof data[0] === "object" && data[0] !== null ? data[0] : data) as Record<string, unknown>
      if (resultInfo["type"] === "FUNCTIONS" || resultInfo["object_type"] === "FUNCTIONS") {
        return ResponseBuilder.createYamlJsonResponse(resultInfo)
      }
      const coreData: Record<string, unknown> = {
        type: resultInfo["object_type"] ?? "UNKNOWN",
        count: resultInfo["result_count"] ?? (Array.isArray(resultInfo["result"]) ? (resultInfo["result"] as unknown[]).length : 0),
        data: resultInfo["result"] ?? [],
      }
      if (resultInfo["truncated"]) {
        coreData["note"] = "Data was truncated by the query, use limit parameter for more"
      }
      return ResponseBuilder.createYamlJsonResponse(coreData)
    }

    // desc_object special handling
    if (toolName === "desc_object" && Array.isArray(data) && data.length > 0) {
      const descInfo = (typeof data[0] === "object" && data[0] !== null ? data[0] : data) as Record<string, unknown>
      const coreData: Record<string, unknown> = {
        object: descInfo["object_name"] ?? "UNKNOWN",
        type: descInfo["object_type"] ?? "UNKNOWN",
        columns: descInfo["result"] ?? [],
      }
      return ResponseBuilder.createYamlJsonResponse(coreData)
    }

    return ResponseBuilder.createYamlJsonResponse(data)
  }

  static createCompactResponse(data: unknown): TextContent[] {
    if (typeof data === "object" && data !== null && !Array.isArray(data) && Object.keys(data).length <= 3) {
      const lines = Object.entries(data as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`)
      return ResponseBuilder.createTextResponse(lines.join("\n"))
    }
    return ResponseBuilder.createYamlJsonResponse(data) as TextContent[]
  }

  static createUnoptimizedResponse(data: unknown, dataId?: string): McpContent[] {
    const id = dataId ?? randomUUID()
    const output = { success: true, type: "data", data_id: id, data }
    const yamlOutput = dataToYaml(output)
    const jsonOutput = JSON.stringify(output, (_, v) => jsonSerializer(v))
    return [
      { type: "text", text: yamlOutput },
      { type: "resource", resource: { uri: `data://${id}`, text: jsonOutput, mimeType: "application/json" } },
    ]
  }

  static createTextResponse(content: string): TextContent[] {
    return [{ type: "text", text: content }]
  }

  static createSqlResultResponse(
    sql: string, resultData: unknown, dataId?: string, error?: Error,
  ): McpContent[] {
    const id = dataId ?? randomUUID()
    if (error) {
      const friendly = ResponseBuilder.formatUserFriendlyError(error, sql)
      return ResponseBuilder.createYamlJsonResponse([{ SQL: sql, Error: friendly, Success: false }], id)
    }
    const processed = Array.isArray(resultData) ? convertDfToDict(resultData as Array<Record<string, unknown>>) : resultData
    return ResponseBuilder.createYamlJsonResponse([{ SQL: sql, "SQL Result": processed, Success: true }], id)
  }

  static formatUserFriendlyError(error: Error | unknown, sql?: string | null): Record<string, unknown> {
    const errorMsg = String(error)
    const errorType = error instanceof Error ? error.constructor.name : "Error"
    const errorPatterns: Record<string, { message: string; suggestion: string }> = {
      "malformed credential config": { message: "API连接配置错误：凭据格式不正确", suggestion: "请检查provider、region、role_arn等参数" },
      "table already exists": { message: "表已存在", suggestion: "请使用不同的表名或添加IF NOT EXISTS子句" },
      "already exists": { message: "对象已存在", suggestion: "请使用不同的名称或添加IF NOT EXISTS子句" },
      "permission denied": { message: "权限不足：无法执行该操作", suggestion: "请联系管理员获取必要的权限" },
      "syntax error": { message: "SQL语法错误", suggestion: "请检查SQL语句的语法是否正确" },
      "access denied": { message: "访问被拒绝", suggestion: "请确认access_key、secret_key等凭据是否正确" },
      "File not found": { message: "Volume中找不到指定文件", suggestion: "请确认文件路径正确" },
      "unsupported": { message: "使用了不支持的SQL功能或语法", suggestion: "请使用get_product_knowledge工具查询支持的功能" },
    }

    let userMessage = "操作失败，请检查输入参数或稍后重试"
    let suggestion = "如需帮助，请联系技术支持"
    for (const [pattern, info] of Object.entries(errorPatterns)) {
      if (errorMsg.toLowerCase().includes(pattern.toLowerCase())) {
        userMessage = info.message
        suggestion = info.suggestion
        break
      }
    }
    return { user_message: userMessage, suggestion, error_type: errorType, timestamp: new Date().toISOString() }
  }

  static cleanBackendError(errorMsg: string): string {
    if (!errorMsg) return "操作执行失败"
    let cleaned = errorMsg
      .replace(/backtrace:\s*\n[\s\S]*?(?=\n\n|$)/g, "")
      .replace(/Traceback \(most recent call last\):[\s\S]*/g, "")
      .replace(/0x[0-9a-fA-F]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (!cleaned || cleaned.length < 10) return "操作执行失败"
    if (cleaned.length > 500) cleaned = cleaned.slice(0, 500) + "..."
    return cleaned
  }

  static cleanErrorData(data: unknown): unknown {
    if (data !== null && typeof data === "object" && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>
      const cleaned: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        if (["error", "error_message", "detail", "details", "reason", "cause"].includes(key.toLowerCase()) && typeof value === "string") {
          cleaned[key] = ResponseBuilder.cleanBackendError(value)
        } else {
          cleaned[key] = ResponseBuilder.cleanErrorData(value)
        }
      }
      return cleaned
    }
    if (Array.isArray(data)) return data.map((item) => ResponseBuilder.cleanErrorData(item))
    if (typeof data === "string" && ["backtrace:", "0x", "/home/jenkins/"].some((p) => data.includes(p))) {
      return ResponseBuilder.cleanBackendError(data)
    }
    return data
  }

  static createErrorResponse(error: Error | unknown, context?: string, dataId?: string): McpContent[] {
    const id = dataId ?? randomUUID()
    const friendly = ResponseBuilder.formatUserFriendlyError(error, context)
    return ResponseBuilder.createYamlJsonResponse([{ operation: context ?? "unknown", error: friendly, success: false }], id)
  }

  static wrapTextContentsWithConfig(
    contents: McpContent[], studioConfig?: StudioConfig | null, dataId?: string, additionalPrefs?: Record<string, unknown>,
  ): McpContent[] {
    if (!contents || !studioConfig) return contents ?? []
    const id = dataId ?? randomUUID()
    const prefs: Record<string, unknown> = {
      use_region: studioConfig.env ?? "",
      instance_name: studioConfig.instance ?? "",
      workspace_name: studioConfig.workspace ?? "",
      vcluster: studioConfig.vcluster ?? "",
      schema: studioConfig.schema ?? "",
      username: studioConfig.username ?? "",
      ...additionalPrefs,
    }
    const configData = { type: "user_preferences", data_id: id, _basic_user_preferences: prefs }
    const configJson = JSON.stringify(configData)
    const configResource: EmbeddedResource = {
      type: "resource",
      resource: { uri: `config://${id}`, text: configJson, mimeType: "application/json" },
    }
    return [...contents, configResource]
  }

  static createYamlJsonResponse(
    data: unknown, dataId?: string, studioConfig?: StudioConfig | null, additionalPrefs?: Record<string, unknown>,
  ): McpContent[] {
    const optimized = _optimizeData(data)
    if (typeof optimized === "string" || typeof optimized === "number" || typeof optimized === "boolean") {
      return ResponseBuilder.createTextResponse(String(optimized))
    }
    const output = { type: "data", data_id: dataId, data: optimized }
    const yamlOutput = dataToYaml(output)
    return ResponseBuilder.wrapTextContentsWithConfig(
      [{ type: "text", text: yamlOutput }], studioConfig, dataId, additionalPrefs,
    )
  }
}

// ---------------------------------------------------------------------------
// utilities.py:1020-1024 — safe_get_config_attr
// ---------------------------------------------------------------------------
export function safeGetConfigAttr(config: unknown, attrName: string, defaultValue: unknown = null): unknown {
  if (config === null || config === undefined) return defaultValue
  return (config as Record<string, unknown>)[attrName] ?? defaultValue
}
