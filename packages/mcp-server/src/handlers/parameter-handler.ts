/**
 * parameter-handler.ts — port of cz-mcp-server/cz_mcp/handlers/parameter_handler.py (2739 lines)
 *
 * Python → TS mapping:
 *   parameter_handler.py:13-57   _normalize_db_type       → normalizeDbType
 *   parameter_handler.py:59-63   ParamType enum           → ParamType
 *   parameter_handler.py:65-74   ParamDefinition          → ParamDefinition
 *   parameter_handler.py:76-225  Validators               → Validators class
 *   parameter_handler.py:227-250 ResponseControlMixin     → ResponseControlMixin
 *   parameter_handler.py:252-350 ParameterHandler         → ParameterHandler
 *   parameter_handler.py:352-2717 HandlerFactory          → HandlerFactory
 *   parameter_handler.py:2718-2739 with_parameter_handler → withParameterHandler
 *
 * Notice: Current function is deprecated. Should not edit.
 */

// ---------------------------------------------------------------------------
// Transformers — port of transformer.py
// ---------------------------------------------------------------------------

export class Transformers {
  static toInt(value: unknown): number | null {
    if (value === null || value === undefined) return null
    if (typeof value === "number") return Math.trunc(value)
    if (typeof value === "string") return parseInt(value, 10)
    throw new Error(`Cannot convert ${value} to int`)
  }

  static toFloat(value: unknown): number | null {
    if (value === null || value === undefined) return null
    if (typeof value === "number") return value
    if (typeof value === "string") return parseFloat(value)
    throw new Error(`Cannot convert ${value} to float`)
  }

  static toBool(value: unknown): boolean | null {
    if (value === null || value === undefined) return null
    if (typeof value === "boolean") return value
    if (typeof value === "string") return ["true", "1", "yes", "on"].includes(value.toLowerCase())
    if (typeof value === "number") return Boolean(value)
    throw new Error(`Cannot convert ${value} to bool`)
  }

  static toBoolOrNone(value: unknown): boolean | null {
    if (value === null || value === undefined) return null
    if (typeof value === "boolean") return value
    if (typeof value === "string") {
      if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true
      if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false
      return null
    }
    if (typeof value === "number") return Boolean(value)
    return null
  }

  static toUpper(value: unknown): string | null {
    if (value === null || value === undefined) return null
    return String(value).toUpperCase()
  }

  static toLower(value: unknown): string | null {
    if (value === null || value === undefined) return null
    return String(value).toLowerCase()
  }

  static toString(value: unknown): string | null {
    if (value === null || value === undefined) return null
    return String(value)
  }

  static stripString(value: unknown): string | null {
    if (value === null || value === undefined) return null
    return String(value).trim()
  }

  static toIntOrNone(value: unknown): number | null {
    if (value === null || value === undefined) return null
    return Transformers.toInt(value)
  }

  static validateAndFixHandlerFormat(value: unknown): string | null {
    if (value === null || value === undefined) return null
    const v = String(value).trim()
    if (!v) return v
    if (!v.includes(".")) return `${v}.${v}`
    const parts = v.split(".")
    if (parts.length >= 2 && parts.every((p) => p.trim())) return v
    throw new Error(
      `Handler格式错误: '${v}'\n正确格式应为: 'module.class'，如 'my_function.MyFunction'\n如果只有类名，请使用: '${v}.${v}'`
    )
  }

  static normalizeObjectType(value: unknown): string | null {
    if (value === null || value === undefined) return null
    let v = String(value).trim()
    if (!v) return v
    // camelCase → spaced
    v = v.replace(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, " ")
    v = v.replace(/_/g, " ").toUpperCase().replace(/\s+/g, " ").trim()
    const singularToPlural: Record<string, string> = {
      TABLE: "TABLES", VIEW: "VIEWS", SCHEMA: "SCHEMAS", FUNCTION: "FUNCTIONS",
      VOLUME: "VOLUMES", CONNECTION: "CONNECTIONS", VCLUSTER: "VCLUSTERS",
      JOB: "JOBS", PIPE: "PIPES", INDEX: "INDEXES", USER: "USERS",
      ROLE: "ROLES", GRANT: "GRANTS", SHARE: "SHARES", CATALOG: "CATALOGS",
      WORKSPACE: "WORKSPACES", "TABLE STREAM": "TABLE STREAMS",
      "DYNAMIC TABLE": "DYNAMIC TABLES", "MATERIALIZED VIEW": "MATERIALIZED VIEWS",
      "EXTERNAL TABLE": "EXTERNAL TABLES", "EXTERNAL SCHEMA": "EXTERNAL SCHEMAS",
      "EXTERNAL FUNCTION": "EXTERNAL FUNCTIONS",
    }
    return singularToPlural[v] ?? v
  }

  static normalizeObjectTypeNoPlural(value: unknown): string | null {
    if (value === null || value === undefined) return null
    let v = String(value).trim()
    if (!v) return v
    v = v.replace(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, " ")
    return v.replace(/_/g, " ").toUpperCase().replace(/\s+/g, " ").trim()
  }

  static toList(value: unknown): string[] | null {
    if (value === null || value === undefined) return null
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
    if (typeof value === "string") {
      const parts = value.split(",").map((p) => p.trim()).filter(Boolean)
      return parts.length ? parts : null
    }
    const s = String(value).trim()
    return s ? [s] : null
  }

  static parseFunctionParameters(value: unknown): Array<{ name: string; type: string }> {
    if (value === null || value === undefined) return []
    if (Array.isArray(value)) return value as Array<{ name: string; type: string }>
    if (typeof value === "string") {
      const v = value.trim()
      if (!v) return []
      const parts = splitByCommaRespectingBrackets(v)
      return parts.map((part) => {
        const m = part.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+)$/)
        if (!m) throw new Error(`无效的参数格式: '${part}'. 期望格式: 'name TYPE'`)
        return { name: m[1], type: m[2].trim().toUpperCase() }
      })
    }
    throw new Error(`参数格式不支持: ${typeof value}. 支持字符串或列表格式`)
  }

  static parseTableColumns(value: unknown): Array<{ name: string; type: string }> {
    if (value === null || value === undefined) return []
    if (Array.isArray(value)) return value as Array<{ name: string; type: string }>
    if (typeof value === "string") {
      const v = value.trim()
      if (!v) return []
      const parts = splitByCommaRespectingBrackets(v)
      return parts.map((part) => {
        const m = part.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+)$/)
        if (!m) throw new Error(`无效的列定义格式: '${part}'. 期望格式: 'column_name DATA_TYPE'`)
        return { name: m[1], type: m[2].trim().toUpperCase() }
      })
    }
    throw new Error(`列定义格式不支持: ${typeof value}. 支持字符串或列表格式`)
  }

  static parseResourceUris(value: unknown): Array<{ type: string; uri: string }> {
    if (value === null || value === undefined) return []
    if (Array.isArray(value)) return value as Array<{ type: string; uri: string }>
    if (typeof value === "string") {
      const v = value.trim()
      if (!v) return []
      if (!v.startsWith("[") && !v.startsWith("{")) {
        const resourceType = v.endsWith(".zip") ? "ARCHIVE" : v.endsWith(".jar") ? "JAR" : "FILE"
        return [{ type: resourceType, uri: v }]
      }
      const parsed = JSON.parse(v)
      const inferType = (uri: string) => uri.endsWith(".zip") ? "ARCHIVE" : uri.endsWith(".jar") ? "JAR" : "FILE"
      if (Array.isArray(parsed)) {
        return parsed.map((item: Record<string, string>) => {
          if (!item.uri) throw new Error(`资源项必须包含'uri'字段: ${JSON.stringify(item)}`)
          return { type: item.type ?? inferType(item.uri), uri: item.uri }
        })
      }
      if (typeof parsed === "object" && parsed !== null) {
        const item = parsed as Record<string, string>
        if (!item.uri) throw new Error("资源项必须包含'uri'字段")
        return [{ type: item.type ?? inferType(item.uri), uri: item.uri }]
      }
      throw new Error("JSON必须解析为数组或对象格式")
    }
    throw new Error(`resource_uris格式不支持: ${typeof value}`)
  }
}

// ---------------------------------------------------------------------------
// Helper — split string by comma respecting brackets/angle-brackets
// ---------------------------------------------------------------------------
function splitByCommaRespectingBrackets(value: string): string[] {
  const parts: string[] = []
  let current = ""
  let parenDepth = 0
  let angleDepth = 0
  for (const ch of value) {
    if (ch === "(") { parenDepth++; current += ch }
    else if (ch === ")") { parenDepth--; current += ch }
    else if (ch === "<") { angleDepth++; current += ch }
    else if (ch === ">") { angleDepth--; current += ch }
    else if (ch === "," && parenDepth === 0 && angleDepth === 0) {
      parts.push(current.trim()); current = ""
    } else { current += ch }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

// ---------------------------------------------------------------------------
// normalizeDbType — parameter_handler.py:13-57
// ---------------------------------------------------------------------------
export function normalizeDbType(dbType: string): string {
  if (!dbType) return dbType
  const lower = dbType.toLowerCase()
  const mapping: Record<string, string> = {
    mysql: "mysql", mariadb: "mysql",
    postgresql: "postgresql", postgres: "postgresql", pgsql: "postgresql",
    sqlserver: "sqlserver", mssql: "sqlserver", "sql server": "sqlserver",
    "microsoft sql server": "sqlserver",
    oracle: "oracle", "oracle database": "oracle",
    clickhouse: "clickhouse", "click house": "clickhouse",
    hive: "hive", spark: "spark", sqlite: "sqlite", sqlite3: "sqlite",
  }
  return mapping[lower] ?? lower
}

// ---------------------------------------------------------------------------
// ParamType enum — parameter_handler.py:59-63
// ---------------------------------------------------------------------------
export enum ParamType {
  REQUIRED = "required",
  OPTIONAL = "optional",
  ENV_FALLBACK = "env_fallback",
}

// ---------------------------------------------------------------------------
// ParamDefinition — parameter_handler.py:65-74
// ---------------------------------------------------------------------------
export interface ParamDefinition {
  name: string
  paramType: ParamType
  defaultValue?: unknown
  envVar?: string
  validator?: (value: unknown) => boolean
  transformer?: (value: unknown) => unknown
  errorMessage?: string
}

// ---------------------------------------------------------------------------
// Validators — parameter_handler.py:76-225
// ---------------------------------------------------------------------------
export class Validators {
  static isListOrNone(value: unknown): boolean {
    return value === null || value === undefined || Array.isArray(value)
  }

  static positiveNumber(value: unknown): boolean {
    return typeof value === "number" && value > 0
  }

  static rangeValidator(minVal: number, maxVal: number): (value: unknown) => boolean {
    return (value: unknown) => {
      if (typeof value !== "number") return false
      return value >= minVal && value <= maxVal
    }
  }

  static nonEmptyString(value: unknown): boolean {
    return typeof value === "string" && value.trim() !== ""
  }

  static positiveInteger(value: unknown): boolean {
    return typeof value === "number" && Number.isInteger(value) && value > 0
  }

  static nonNegativeInteger(value: unknown): boolean {
    return typeof value === "number" && Number.isInteger(value) && value >= 0
  }

  static isBoolOrNone(value: unknown): boolean {
    return value === null || value === undefined || typeof value === "boolean"
  }

  static handlerFormatValidator(value: unknown): boolean {
    if (typeof value !== "string" || !value.trim()) return false
    const v = value.trim()
    if (!v.includes(".")) return true
    const parts = v.split(".")
    if (parts.length < 2) return false
    return parts.every((p) => p.trim())
  }

  static isDict(value: unknown): boolean {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  static isDictOrNone(value: unknown): boolean {
    return value === null || value === undefined || (typeof value === "object" && !Array.isArray(value))
  }

  static inChoices(choices: string[]): (value: unknown) => boolean {
    const fn = (value: unknown) => choices.includes(value as string)
    ;(fn as unknown as Record<string, unknown>)._choices = choices
    return fn
  }

  static inChoicesCaseInsensitive(choices: string[]): (value: unknown) => boolean {
    const lower = choices.map((c) => c.toLowerCase())
    const fn = (value: unknown) => {
      if (typeof value === "string") return lower.includes(value.toLowerCase())
      return choices.includes(value as string)
    }
    ;(fn as unknown as Record<string, unknown>)._choices = choices
    return fn
  }

  static regex(pattern: string, flags = ""): (value: unknown) => boolean {
    try {
      const re = new RegExp(pattern, flags)
      return (value: unknown) => typeof value === "string" && re.test(value)
    } catch {
      return () => false
    }
  }

  static connectionName(value: unknown): boolean {
    if (typeof value !== "string") return false
    return /^[a-zA-Z0-9_]+$/.test(value)
  }

  static nonEmptyStringOrNone(value: unknown): boolean {
    if (value === null || value === undefined) return true
    return typeof value === "string" && value.trim() !== ""
  }

  static isBooleanOrNone(value: unknown): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === "boolean") return true
    if (typeof value === "string") return ["true", "false"].includes(value.toLowerCase())
    return false
  }

  static resourceUrisList(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) && parsed.length > 0
      } catch {
        return false
      }
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// ResponseControlMixin — parameter_handler.py:227-250
// ---------------------------------------------------------------------------
export class ResponseControlMixin {
  static addResponseControlParams(handler: ParameterHandler): ParameterHandler {
    return handler
      .defineParam("verbose", ParamType.OPTIONAL, {
        defaultValue: null,
        transformer: Transformers.toBool,
        description: "是否返回详细信息（包括SQL、日志等）",
      })
      .defineParam("include_sql", ParamType.OPTIONAL, {
        defaultValue: null,
        transformer: Transformers.toBool,
        description: "是否在响应中包含执行的SQL语句",
      })
  }
}

// ---------------------------------------------------------------------------
// ParameterHandler — parameter_handler.py:252-350
// ---------------------------------------------------------------------------
export class ParameterHandler {
  toolName: string
  paramDefinitions: ParamDefinition[] = []

  constructor(toolName: string) {
    this.toolName = toolName
  }

  defineParam(
    name: string,
    paramType: ParamType,
    opts: {
      defaultValue?: unknown
      envVar?: string
      validator?: (value: unknown) => boolean
      transformer?: (value: unknown) => unknown
      errorMessage?: string
      description?: string
    } = {}
  ): this {
    this.paramDefinitions.push({
      name,
      paramType,
      defaultValue: opts.defaultValue,
      envVar: opts.envVar,
      validator: opts.validator,
      transformer: opts.transformer,
      errorMessage: opts.errorMessage,
    })
    return this
  }

  processArguments(arguments_: Record<string, unknown> | null | undefined): Record<string, unknown> {
    const args: Record<string, unknown> = arguments_ ?? {}
    const result: Record<string, unknown> = {}
    const missingRequired: string[] = []

    for (const paramDef of this.paramDefinitions) {
      let value: unknown = undefined
      try {
        if (paramDef.paramType === ParamType.REQUIRED) {
          if (!(paramDef.name in args)) {
            missingRequired.push(paramDef.name)
            continue
          }
          value = args[paramDef.name]
        } else if (paramDef.paramType === ParamType.OPTIONAL) {
          value = paramDef.name in args ? args[paramDef.name] : paramDef.defaultValue
        } else if (paramDef.paramType === ParamType.ENV_FALLBACK) {
          if (paramDef.name in args) {
            value = args[paramDef.name]
          } else if (paramDef.envVar) {
            value = process.env[paramDef.envVar] ?? paramDef.defaultValue
          } else {
            value = paramDef.defaultValue
          }
        }

        if (value !== null && value !== undefined && paramDef.transformer) {
          try {
            value = paramDef.transformer(value)
          } catch (e) {
            throw new Error(`参数 '${paramDef.name}' 转换失败: ${e}`)
          }
        }

        if (paramDef.validator && value !== null && value !== undefined) {
          try {
            if (!paramDef.validator(value)) {
              const choices = (paramDef.validator as unknown as Record<string, unknown>)._choices as string[] | undefined
              const errMsg = paramDef.errorMessage ??
                (choices
                  ? `参数 '${paramDef.name}' 值 '${value}' 无效，支持的值: ${choices.join(", ")}`
                  : `参数 '${paramDef.name}' 验证失败`)
              throw new Error(errMsg)
            }
          } catch (e) {
            const msg = String(e)
            if (msg.includes("null") || msg.includes("undefined")) {
              if (paramDef.defaultValue !== null && paramDef.defaultValue !== undefined) {
                value = paramDef.defaultValue
              } else {
                throw new Error(`参数 '${paramDef.name}' 不能为空`)
              }
            } else {
              throw e
            }
          }
        }

        result[paramDef.name] = value
      } catch (e) {
        throw new Error(`处理参数 '${paramDef.name}' 时发生错误: ${e}`)
      }
    }

    if (missingRequired.length > 0) {
      throw new Error(`${this.toolName} 缺少必需参数: ${missingRequired.join(", ")}`)
    }

    return result
  }
}
// ---------------------------------------------------------------------------
