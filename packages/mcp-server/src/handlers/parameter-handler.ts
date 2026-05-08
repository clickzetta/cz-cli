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

// ---------------------------------------------------------------------------
// HandlerFactory — parameter_handler.py:352-2717
// ---------------------------------------------------------------------------
export class HandlerFactory {
  static getProductKnowledge(): ParameterHandler {
    return new ParameterHandler("get_product_knowledge")
      .defineParam("question", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "用户问题或搜索关键词",
      })
      .defineParam("vector_search_limit_n", ParamType.OPTIONAL, {
        defaultValue: 3,
        transformer: Transformers.toInt,
        validator: Validators.rangeValidator(1, 20),
        description: "返回结果数量限制",
      })
      .defineParam("table_name", ParamType.OPTIONAL, {
        defaultValue: "knowledge_base",
        validator: Validators.nonEmptyString,
        description: "知识库表名",
      })
      .defineParam("embedding_column_name", ParamType.OPTIONAL, {
        defaultValue: "embeddings",
        validator: Validators.nonEmptyString,
        description: "向量列名",
      })
      .defineParam("content_column_name", ParamType.OPTIONAL, {
        defaultValue: "text",
        validator: Validators.nonEmptyString,
        description: "内容列名",
      })
      .defineParam("other_columns", ParamType.OPTIONAL, {
        defaultValue: "",
        description: "其他要返回的列名",
      })
      .defineParam("partition_scope", ParamType.OPTIONAL, {
        defaultValue: "",
        description: "分区范围过滤条件",
      })
  }

  static createExternalCatalog(): ParameterHandler {
    return new ParameterHandler("create_external_catalog")
      .defineParam("catalog_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "外部目录名称",
      })
      .defineParam("connection", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "目录连接名称",
      })
      .defineParam("options", ParamType.OPTIONAL, {
        defaultValue: {},
        validator: Validators.isDictOrNone,
        description: "其他选项",
      })
  }

  static createExternalSchema(): ParameterHandler {
    return new ParameterHandler("create_external_schema")
      .defineParam("schema_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "外部Schema名称",
      })
      .defineParam("connection", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "连接名称",
      })
      .defineParam("database", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "外部数据库名称",
      })
      .defineParam("options", ParamType.OPTIONAL, {
        defaultValue: {},
        validator: Validators.isDictOrNone,
        description: "其他选项",
      })
  }

  static createFunction(): ParameterHandler {
    return new ParameterHandler("create_function")
      .defineParam("function_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "函数名称",
      })
      .defineParam("parameters", ParamType.OPTIONAL, {
        defaultValue: [],
        transformer: Transformers.parseFunctionParameters,
        validator: Validators.isListOrNone,
        description: "函数参数列表",
      })
      .defineParam("returns_type", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.toUpper,
        description: "标量函数返回类型",
      })
      .defineParam("return_type", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.toUpper,
        description: "标量函数返回类型的别名",
      })
      .defineParam("returns_table", ParamType.OPTIONAL, {
        validator: Validators.isListOrNone,
        description: "表函数返回结构",
      })
      .defineParam("function_body", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "函数体",
      })
      .defineParam("or_replace", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否替换已存在的函数",
      })
      .defineParam("if_not_exists", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "仅在函数不存在时创建",
      })
      .defineParam("comment", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "函数注释",
      })
      .defineParam("language", ParamType.OPTIONAL, {
        transformer: Transformers.toUpper,
        description: "已废弃：CREATE FUNCTION只支持SQL",
      })
  }

  static runHappyPaths(): ParameterHandler {
    return new ParameterHandler("run_happy_paths")
      .defineParam("language", ParamType.OPTIONAL, {
        defaultValue: "中文",
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "演示语言",
      })
  }

  static addDataInsight(): ParameterHandler {
    return new ParameterHandler("add_data_insight")
      .defineParam("insight", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "数据洞察内容",
      })
  }

  static readQuery(): ParameterHandler {
    return new ParameterHandler("read_query")
      .defineParam("query", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "SELECT查询语句",
      })
      .defineParam("verbose", ParamType.OPTIONAL, {
        defaultValue: null,
        transformer: Transformers.toBool,
        description: "是否返回详细信息",
      })
      .defineParam("include_sql", ParamType.OPTIONAL, {
        defaultValue: null,
        transformer: Transformers.toBool,
        description: "是否在响应中包含执行的SQL",
      })
      .defineParam("response_format", ParamType.OPTIONAL, {
        validator: Validators.inChoices(["minimal", "standard", "detailed"]),
        transformer: Transformers.toLower,
        description: "响应格式级别",
      })
  }

  static writeQuery(): ParameterHandler {
    return new ParameterHandler("write_query")
      .defineParam("query", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "INSERT/UPDATE/DELETE查询语句",
      })
      .defineParam("verbose", ParamType.OPTIONAL, {
        defaultValue: null,
        transformer: Transformers.toBool,
        description: "是否返回详细信息",
      })
      .defineParam("include_sql", ParamType.OPTIONAL, {
        defaultValue: null,
        transformer: Transformers.toBool,
        description: "是否返回执行的SQL语句",
      })
  }

  static switchContext(): ParameterHandler {
    return HandlerFactory.switchContextUnified()
  }

  static switchVclusterSchema(): ParameterHandler {
    return new ParameterHandler("switch_vcluster_schema")
      .defineParam("schema_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "要切换到的schema名称",
      })
      .defineParam("vcluster_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "要切换到的vcluster名称",
      })
  }

  static switchWorkspace(): ParameterHandler {
    return new ParameterHandler("switch_workspace")
      .defineParam("workspace_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "目标workspace名称",
      })
      .defineParam("list_workspaces", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否列出所有可用workspace",
      })
      .defineParam("update_config", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否永久更新配置文件",
      })
  }

  static switchContextUnified(): ParameterHandler {
    return new ParameterHandler("switch_context_unified")
      .defineParam("connection", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "目标连接名称",
      })
      .defineParam("workspace", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "目标workspace名称",
      })
      .defineParam("schema", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "目标schema名称",
      })
      .defineParam("vcluster", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "目标vcluster名称",
      })
      .defineParam("show_current", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "显示当前上下文信息",
      })
      .defineParam("update_config", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否永久更新配置文件",
      })
  }

  static createVcluster(): ParameterHandler {
    return new ParameterHandler("create_vcluster")
      .defineParam("cluster_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "计算集群名称",
      })
      .defineParam("if_not_exists", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "如果集群已存在是否跳过创建",
      })
      .defineParam("vcluster_type", ParamType.OPTIONAL, {
        defaultValue: "GENERAL",
        validator: Validators.inChoices(["GENERAL", "ANALYTICS", "INTEGRATION"]),
        transformer: Transformers.toUpper,
        description: "计算集群类型",
      })
      .defineParam("vcluster_size", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "计算集群规格(1-256 CRU)",
      })
      .defineParam("min_vcluster_size", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "最小集群规格(GENERAL类型)",
      })
      .defineParam("max_vcluster_size", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "最大集群规格(GENERAL类型)",
      })
      .defineParam("min_replicas", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "最小实例数(ANALYTICS类型)",
      })
      .defineParam("max_replicas", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "最大实例数(ANALYTICS类型)",
      })
      .defineParam("auto_suspend_in_second", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        description: "自动暂停时间(秒)",
      })
      .defineParam("auto_resume", ParamType.OPTIONAL, {
        defaultValue: true,
        transformer: Transformers.toBool,
        description: "是否自动恢复",
      })
      .defineParam("max_concurrency", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "最大并发数(ANALYTICS类型)",
      })
      .defineParam("query_runtime_limit_in_second", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "查询运行时间限制(秒)",
      })
      .defineParam("preload_tables", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "预加载表(ANALYTICS类型)",
      })
      .defineParam("query_resource_limit_ratio", ParamType.OPTIONAL, {
        description: "单作业资源占比阈值(0.0-1.0)",
      })
      .defineParam("comment", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "集群注释",
      })
  }

  static alterVcluster(): ParameterHandler {
    return new ParameterHandler("alter_vcluster")
      .defineParam("cluster_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "计算集群名称",
      })
      .defineParam("operation", ParamType.REQUIRED, {
        validator: Validators.inChoices(["RESUME", "SUSPEND", "CANCEL_ALL_JOBS", "SET", "SET_COMMENT"]),
        transformer: Transformers.toUpper,
        description: "操作类型",
      })
      .defineParam("if_exists", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "如果集群不存在是否跳过操作",
      })
      .defineParam("force", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否强制操作(SUSPEND时使用)",
      })
      .defineParam("vcluster_size", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "计算集群规格(1-256 CRU)",
      })
      .defineParam("min_vcluster_size", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "最小集群规格(GENERAL类型)",
      })
      .defineParam("max_vcluster_size", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "最大集群规格(GENERAL类型)",
      })
      .defineParam("min_replicas", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "最小实例数(ANALYTICS类型)",
      })
      .defineParam("max_replicas", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "最大实例数(ANALYTICS类型)",
      })
      .defineParam("auto_suspend_in_second", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        description: "自动暂停时间(秒)",
      })
      .defineParam("auto_resume", ParamType.OPTIONAL, {
        transformer: Transformers.toBool,
        description: "是否自动恢复",
      })
      .defineParam("max_concurrency", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "最大并发数(ANALYTICS类型)",
      })
      .defineParam("query_runtime_limit_in_second", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "查询运行时间限制(秒)",
      })
      .defineParam("preload_tables", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "预加载表(ANALYTICS类型)",
      })
      .defineParam("query_resource_limit_ratio", ParamType.OPTIONAL, {
        description: "单作业资源占比阈值(0.0-1.0)",
      })
      .defineParam("vcluster_type", ParamType.OPTIONAL, {
        validator: Validators.inChoices(["GENERAL", "ANALYTICS", "INTEGRATION"]),
        transformer: Transformers.toUpper,
        description: "计算集群类型",
      })
      .defineParam("comment", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "集群注释",
      })
  }

  static addKnowledgeEntry(): ParameterHandler {
    return new ParameterHandler("add_knowledge_entry")
      .defineParam("knowledge_table_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "知识表名称",
      })
      .defineParam("knowledge", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "知识内容",
      })
  }

  static vectorSearch(): ParameterHandler {
    return new ParameterHandler("vector_search")
      .defineParam("question", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        errorMessage: "question 参数不能为空",
      })
      .defineParam("table_name", ParamType.OPTIONAL, {
        defaultValue: "",
        description: "表名称",
      })
      .defineParam("embedding_column_name", ParamType.OPTIONAL, {
        defaultValue: "",
        description: "向量列名",
      })
      .defineParam("content_column_name", ParamType.OPTIONAL, {
        defaultValue: "",
        description: "内容列名",
      })
      .defineParam("partition_scope", ParamType.OPTIONAL, {
        defaultValue: "",
        description: "分区范围条件",
      })
      .defineParam("other_columns", ParamType.OPTIONAL, {
        defaultValue: "",
        description: "其他要查询的列",
      })
      .defineParam("vector_search_limit_n", ParamType.OPTIONAL, {
        defaultValue: 1,
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "返回结果数量限制",
      })
      .defineParam("distance_threshold", ParamType.OPTIONAL, {
        defaultValue: 0.8,
        transformer: Transformers.toFloat,
        validator: Validators.rangeValidator(0.0, 2.0),
        description: "向量距离阈值",
      })
  }

  static matchAll(): ParameterHandler {
    return new ParameterHandler("match_all")
      .defineParam("question", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
      })
      .defineParam("table_name", ParamType.OPTIONAL, {
        defaultValue: "knowledge_base",
        description: "要搜索的表名",
      })
      .defineParam("content_column_name", ParamType.OPTIONAL, {
        defaultValue: "",
        description: "内容列名",
      })
      .defineParam("other_columns", ParamType.OPTIONAL, {
        defaultValue: "",
        description: "其他要选择的列",
      })
      .defineParam("match_limit_n", ParamType.OPTIONAL, {
        defaultValue: 10,
        validator: Validators.positiveInteger,
        description: "匹配结果的限制数量",
      })
      .defineParam("partition_scope", ParamType.OPTIONAL, {
        defaultValue: "",
        description: "分区范围条件",
      })
      .defineParam("verbose", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否返回详细信息",
      })
  }

  static describeTable(): ParameterHandler {
    return new ParameterHandler("describe_table")
      .defineParam("table_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
  }

  static showObjectList(): ParameterHandler {
    return new ParameterHandler("show_object_list")
      .defineParam("show_command", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: (x: unknown) => String(x).trim().toUpperCase(),
        description: "完整的SHOW命令（向后兼容）",
      })
      .defineParam("object_type", ParamType.REQUIRED, {
        validator: Validators.inChoices([
          "WORKSPACES", "TABLES", "VIEWS", "SCHEMAS", "CATALOGS", "FUNCTIONS",
          "EXTERNAL FUNCTIONS", "VOLUMES", "CONNECTIONS", "VCLUSTERS", "JOBS",
          "PIPES", "USERS", "ROLES", "GRANTS", "SHARES", "TABLE STREAMS",
          "DYNAMIC TABLES", "MATERIALIZED VIEWS", "EXTERNAL TABLES",
          "EXTERNAL SCHEMAS", "NETWORK POLICY",
        ]),
        transformer: Transformers.normalizeObjectType,
        description: "对象类型",
      })
      .defineParam("in_schema", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "在指定Schema中查找",
      })
      .defineParam("like_pattern", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "LIKE模式匹配",
      })
      .defineParam("where_condition", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "WHERE条件",
      })
      .defineParam("limit", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
        description: "限制返回数量",
      })
      .defineParam("in_vcluster", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "在指定VCluster中查找（仅JOBS支持）",
      })
      .defineParam("to_user", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "查看特定用户的权限（仅GRANTS支持）",
      })
      .defineParam("table_type_filters", ParamType.OPTIONAL, {
        validator: Validators.isDictOrNone,
        description: "表类型过滤器",
      })
      .defineParam("smart_defaults", ParamType.OPTIONAL, {
        defaultValue: true,
        transformer: Transformers.toBool,
        description: "是否应用智能默认值",
      })
      .defineParam("include_suggestions", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否包含过滤建议和提示信息",
      })
      .defineParam("include_field_analysis", ParamType.OPTIONAL, {
        defaultValue: false,
        description: "是否包含字段级别的详细分析",
      })
      .defineParam("show_builtin_functions", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否显示内置函数详情",
      })
      .defineParam("function_type", ParamType.OPTIONAL, {
        validator: Validators.inChoices(["ALL", "BUILTIN", "EXTERNAL", "UDF"]),
        transformer: Transformers.toUpper,
        description: "函数类型过滤",
      })
      .defineParam("detailed_analysis", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否返回详细的数据分析",
      })
  }

  static descObject(): ParameterHandler {
    return new ParameterHandler("desc_object")
      .defineParam("object_type", ParamType.REQUIRED, {
        validator: Validators.inChoices([
          "WORKSPACE", "TABLE", "VCLUSTER", "VOLUME", "EXTERNAL VOLUME",
          "CONNECTION", "STORAGE CONNECTION", "API CONNECTION", "CATALOG CONNECTION",
          "SCHEMA", "EXTERNAL SCHEMA", "FUNCTION", "EXTERNAL FUNCTION",
          "VIEW", "MATERIALIZED VIEW", "DYNAMIC TABLE", "EXTERNAL TABLE",
          "PIPE", "INDEX", "BLOOMFILTER", "INVERTED", "VECTOR",
          "USER", "ROLE", "GRANT", "SHARE", "TABLE STREAM", "NETWORK POLICY", "SYNONYM",
        ]),
        transformer: Transformers.normalizeObjectTypeNoPlural,
        description: "对象类型(单数)",
      })
      .defineParam("object_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "对象名称",
      })
      .defineParam("extended", ParamType.OPTIONAL, {
        defaultValue: true,
        transformer: Transformers.toBool,
        description: "是否显示详细信息",
      })
      .defineParam("show_history", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否显示历史信息",
      })
      .defineParam("show_indexes", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否显示索引信息",
      })
      .defineParam("show_grants", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否显示权限信息",
      })
      .defineParam("show_sensitive", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否显示敏感数据",
      })
  }

  static importDataSrc(): ParameterHandler {
    const handler = new ParameterHandler("import_data_src")
      .defineParam("from_url", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "数据源URL",
      })
      .defineParam("dest_table", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "目标表名称",
      })
      .defineParam("write_mode", ParamType.OPTIONAL, {
        defaultValue: "overwrite",
        validator: Validators.inChoices(["create", "overwrite", "append"]),
        transformer: Transformers.toLower,
        description: "写入模式",
      })
    return ResponseControlMixin.addResponseControlParams(handler)
  }

  static importDataFromDb(): ParameterHandler {
    const handler = new ParameterHandler("import_data_from_db")
      .defineParam("db_type", ParamType.REQUIRED, {
        validator: Validators.inChoices([
          "mysql", "postgresql", "oracle", "sqlserver", "mssql",
          "clickhouse", "hive", "spark", "sqlite",
        ]),
        transformer: (x: unknown) => x ? normalizeDbType(String(x)) : x,
        description: "数据库类型",
      })
      .defineParam("host", ParamType.OPTIONAL, { description: "数据库主机地址" })
      .defineParam("port", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        description: "数据库端口",
      })
      .defineParam("database", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "数据库名称",
      })
      .defineParam("username", ParamType.OPTIONAL, { description: "用户名" })
      .defineParam("password", ParamType.OPTIONAL, { description: "密码" })
      .defineParam("source_table", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "源表名称",
      })
      .defineParam("dest_table", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "目标表名称",
      })
      .defineParam("write_mode", ParamType.OPTIONAL, {
        defaultValue: "overwrite",
        validator: Validators.inChoices(["create", "overwrite", "append"]),
        transformer: Transformers.toLower,
        description: "数据写入模式",
      })
    return ResponseControlMixin.addResponseControlParams(handler)
  }

  static previewVolumeData(): ParameterHandler {
    const handler = new ParameterHandler("preview_volume_data")
      .defineParam("source_volume", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("format", ParamType.REQUIRED, {
        validator: Validators.inChoices(["csv", "parquet", "orc", "bson", "json"]),
        transformer: Transformers.toLower,
      })
      .defineParam("files", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
      })
      .defineParam("mode", ParamType.OPTIONAL, { defaultValue: "preview" })
      .defineParam("target_table", ParamType.OPTIONAL, {})
      .defineParam("columns", ParamType.OPTIONAL, {
        defaultValue: "*",
        transformer: Transformers.stripString,
      })
      .defineParam("limit", ParamType.OPTIONAL, {
        defaultValue: 3,
        transformer: Transformers.toInt,
      })
      .defineParam("where", ParamType.OPTIONAL, {})
      .defineParam("options", ParamType.OPTIONAL, {
        defaultValue: {},
        validator: Validators.isDictOrNone,
      })
    return ResponseControlMixin.addResponseControlParams(handler)
  }

  static createExternalTable(): ParameterHandler {
    return new ParameterHandler("create_external_table")
      .defineParam("table_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "外部表名称",
      })
      .defineParam("table_format", ParamType.OPTIONAL, {
        defaultValue: "DELTA",
        validator: Validators.inChoices(["DELTA", "HUDI"]),
        transformer: Transformers.toUpper,
        description: "外部表格式类型",
      })
      .defineParam("columns", ParamType.OPTIONAL, {
        transformer: Transformers.parseTableColumns,
        description: "列定义",
      })
      .defineParam("connection", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "连接名称",
      })
      .defineParam("location", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "数据文件路径",
      })
      .defineParam("kafka_options", ParamType.OPTIONAL, {
        validator: Validators.isDictOrNone,
        description: "Kafka特定选项",
      })
      .defineParam("if_not_exists", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "如果表已存在则跳过创建",
      })
      .defineParam("partitioned_by", ParamType.OPTIONAL, {
        description: "分区列定义",
      })
      .defineParam("comment", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "表注释说明",
      })
  }

  static createApiConnection(): ParameterHandler {
    return new ParameterHandler("create_api_connection")
      .defineParam("connection_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "API CONNECTION名称",
      })
      .defineParam("architecture", ParamType.OPTIONAL, {
        defaultValue: "CLOUD_FUNCTION",
        validator: Validators.inChoices(["CLOUD_FUNCTION", "LEGACY_API"]),
        transformer: Transformers.toUpper,
        description: "API连接架构类型",
      })
      .defineParam("provider", ParamType.REQUIRED, {
        validator: Validators.inChoices(["aliyun", "tencent", "aws"]),
        transformer: Transformers.toLower,
        description: "云函数提供商",
      })
      .defineParam("region", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "云服务区域",
      })
      .defineParam("role_arn", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "角色ARN授权信息",
      })
      .defineParam("namespace", ParamType.REQUIRED, {
        defaultValue: "default",
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "命名空间",
      })
      .defineParam("code_bucket", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "代码存储桶名称",
      })
      .defineParam("type", ParamType.OPTIONAL, {
        defaultValue: "REST",
        validator: Validators.inChoices(["REST", "HTTP", "OPENAPI"]),
        transformer: Transformers.toUpper,
        description: "API类型",
      })
      .defineParam("endpoint", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "API端点地址",
      })
      .defineParam("api_key", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "API密钥",
      })
      .defineParam("secret_key", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "API密钥",
      })
      .defineParam("format", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "数据格式",
      })
      .defineParam("headers", ParamType.OPTIONAL, { description: "HTTP头部信息" })
      .defineParam("comment", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "连接注释",
      })
  }

  static createStorageConnection(): ParameterHandler {
    return new ParameterHandler("create_storage_connection")
      .defineParam("connection_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "存储连接名称",
      })
      .defineParam("connection_type", ParamType.REQUIRED, {
        validator: Validators.inChoices(["HDFS", "OSS", "COS", "S3", "KAFKA"]),
        transformer: Transformers.toUpper,
        description: "存储连接类型",
      })
      .defineParam("access_id", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "OSS访问ID",
      })
      .defineParam("access_key", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "访问密钥",
      })
      .defineParam("secret_key", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "密钥（仅S3/COS使用）",
      })
      .defineParam("endpoint", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: (x: unknown) => x ? String(x).trim().replace(/^https?:\/\//, "") : x,
        description: "服务端点",
      })
      .defineParam("region", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "服务区域",
      })
      .defineParam("role_arn", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "角色ARN",
      })
      .defineParam("app_id", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "腾讯云APP_ID",
      })
      .defineParam("name_node", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "HDFS NameNode地址",
      })
      .defineParam("name_node_rpc_addresses", ParamType.OPTIONAL, {
        description: "HDFS NameNode RPC地址列表",
      })
      .defineParam("bootstrap_servers", ParamType.OPTIONAL, {
        description: "Kafka服务器列表",
      })
      .defineParam("security_protocol", ParamType.OPTIONAL, {
        validator: Validators.inChoices(["PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"]),
        transformer: Transformers.toUpper,
        defaultValue: "PLAINTEXT",
        description: "Kafka安全协议",
      })
      .defineParam("use_ssl", ParamType.OPTIONAL, {
        transformer: Transformers.toBool,
        description: "是否启用SSL",
      })
      .defineParam("path_style_access", ParamType.OPTIONAL, {
        transformer: Transformers.toBool,
        description: "是否使用路径样式访问",
      })
      .defineParam("session_token", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "临时会话令牌",
      })
  }

  static smartCrawlToVolume(): ParameterHandler {
    return new ParameterHandler("smart_crawl_to_volume")
      .defineParam("url", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "起始抓取URL",
      })
      .defineParam("volume", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "目标Volume根路径",
      })
      .defineParam("volume_dir", ParamType.OPTIONAL, {
        defaultValue: "/",
        transformer: Transformers.stripString,
        description: "写入的子目录",
      })
      .defineParam("max_depth", ParamType.OPTIONAL, {
        defaultValue: 3,
        transformer: Transformers.toInt,
        description: "递归抓取最大深度",
      })
      .defineParam("max_concurrent", ParamType.OPTIONAL, {
        defaultValue: 10,
        transformer: Transformers.toInt,
        description: "最大并发请求数",
      })
      .defineParam("max_pages", ParamType.OPTIONAL, {
        defaultValue: 20,
        transformer: Transformers.toInt,
        description: "最多抓取页面数量",
      })
      .defineParam("crawler", ParamType.OPTIONAL, {
        defaultValue: "default_crawler",
        transformer: Transformers.stripString,
        description: "爬虫策略占位",
      })
      .defineParam("css_selector", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
        description: "CSS选择器",
      })
      .defineParam("word_count_threshold", ParamType.OPTIONAL, {
        validator: Validators.positiveInteger,
        transformer: Transformers.toIntOrNone,
        defaultValue: "10",
        description: "分块最小词数阈值",
      })
      .defineParam("extraction_strategy", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
        defaultValue: "LLMExtractionStrategy",
        description: "提取策略",
      })
      .defineParam("chunking_strategy", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
        defaultValue: "RegexChunking",
        description: "分块策略",
      })
      .defineParam("bypass_cache", ParamType.OPTIONAL, {
        validator: Validators.isBooleanOrNone,
        transformer: Transformers.toBoolOrNone,
        defaultValue: "false",
        description: "是否忽略内部缓存",
      })
      .defineParam("include_raw_html", ParamType.OPTIONAL, {
        validator: Validators.isBooleanOrNone,
        transformer: Transformers.toBoolOrNone,
        defaultValue: "false",
        description: "是否同时保存原始HTML",
      })
      .defineParam("include_patterns", ParamType.OPTIONAL, {
        validator: Validators.isListOrNone,
        transformer: Transformers.toList,
        description: "URL包含过滤",
      })
      .defineParam("exclude_patterns", ParamType.OPTIONAL, {
        validator: Validators.isListOrNone,
        transformer: Transformers.toList,
        description: "URL排除过滤",
      })
  }

  static smartCrawlUrl(): ParameterHandler {
    return new ParameterHandler("smart_crawl_url")
      .defineParam("url", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "要抓取的网页URL",
      })
      .defineParam("css_selector", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
        description: "CSS选择器",
      })
      .defineParam("word_count_threshold", ParamType.OPTIONAL, {
        validator: Validators.positiveInteger,
        transformer: Transformers.toIntOrNone,
        defaultValue: "10",
        description: "内容块的最小词数阈值",
      })
      .defineParam("extraction_strategy", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
        defaultValue: "LLMExtractionStrategy",
        description: "提取策略名称",
      })
      .defineParam("chunking_strategy", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
        defaultValue: "RegexChunking",
        description: "分块策略名称",
      })
      .defineParam("bypass_cache", ParamType.OPTIONAL, {
        validator: Validators.isBooleanOrNone,
        transformer: Transformers.toBoolOrNone,
        defaultValue: "false",
        description: "是否跳过缓存",
      })
      .defineParam("max_depth", ParamType.OPTIONAL, {
        transformer: Transformers.toIntOrNone,
        defaultValue: "1",
        description: "递归抓取最大深度",
      })
      .defineParam("max_concurrent", ParamType.OPTIONAL, {
        transformer: Transformers.toIntOrNone,
        defaultValue: "5",
        description: "最大并发",
      })
      .defineParam("max_pages", ParamType.OPTIONAL, {
        transformer: Transformers.toIntOrNone,
        defaultValue: "20",
        description: "最多抓取页面数",
      })
      .defineParam("include_raw_html", ParamType.OPTIONAL, {
        validator: Validators.isBooleanOrNone,
        transformer: Transformers.toBoolOrNone,
        defaultValue: "false",
        description: "是否包含原始HTML",
      })
      .defineParam("include_patterns", ParamType.OPTIONAL, {
        validator: Validators.isListOrNone,
        transformer: Transformers.toList,
        description: "URL包含过滤",
      })
      .defineParam("exclude_patterns", ParamType.OPTIONAL, {
        validator: Validators.isListOrNone,
        transformer: Transformers.toList,
        description: "URL排除过滤",
      })
  }

  static smartCrawlUrlDirect(): ParameterHandler {
    return HandlerFactory.smartCrawlUrl()
  }

  static createCatalogConnection(): ParameterHandler {
    return new ParameterHandler("create_catalog_connection")
      .defineParam("connection_name", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("catalog_type", ParamType.REQUIRED, {
        validator: Validators.inChoices(["HIVE", "OSS_CATALOG", "DATABRICKS"]),
        transformer: Transformers.toUpper,
      })
      .defineParam("endpoint", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("access_key", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("secret_key", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("region", ParamType.OPTIONAL, {})
      .defineParam("database", ParamType.OPTIONAL, {})
      .defineParam("client_id", ParamType.OPTIONAL, {})
      .defineParam("client_secret", ParamType.OPTIONAL, {})
      .defineParam("host", ParamType.OPTIONAL, {})
      .defineParam("metastore_uris", ParamType.OPTIONAL, {})
  }

  static createSchema(): ParameterHandler {
    return new ParameterHandler("create_schema")
      .defineParam("schema_name", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("if_not_exists", ParamType.OPTIONAL, { defaultValue: false })
      .defineParam("comment", ParamType.OPTIONAL, { defaultValue: "" })
  }

  static switchLakehouseInstance(): ParameterHandler {
    return new ParameterHandler("switch_lakehouse_instance")
      .defineParam("instance_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "要切换到的实例名称",
      })
      .defineParam("connection_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "要切换到的连接名称",
      })
      .defineParam("set_as_default", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否将此连接设置为默认连接",
      })
      .defineParam("force", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否强制重建底层物理连接",
      })
      .defineParam("list_instances", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否列出所有可用实例",
      })
      .defineParam("reload", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否重新加载配置文件",
      })
  }

  static createLakehouseInstance(): ParameterHandler {
    return new ParameterHandler("create_lakehouse_instance")
      .defineParam("instance_name", ParamType.OPTIONAL, {
        validator: (x: unknown) => x === null || x === undefined || (typeof x === "string" && x.trim().length > 0),
        transformer: Transformers.stripString,
        description: "实例名称（留空自动生成）",
      })
      .defineParam("instance_id", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "实例标识",
      })
      .defineParam("username", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "用户名",
      })
      .defineParam("password", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "密码",
      })
      .defineParam("workspace", ParamType.OPTIONAL, {
        defaultValue: "quick_start",
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "工作空间",
      })
      .defineParam("schema", ParamType.OPTIONAL, {
        defaultValue: "public",
        validator: Validators.nonEmptyString,
        description: "Schema",
      })
      .defineParam("vcluster", ParamType.OPTIONAL, {
        defaultValue: "default_ap",
        validator: Validators.nonEmptyString,
        description: "虚拟集群",
      })
      .defineParam("environment", ParamType.OPTIONAL, {
        validator: Validators.inChoices(["dev", "test", "uat", "prod"]),
        transformer: Transformers.toLower,
        description: "环境类型",
      })
      .defineParam("purpose", ParamType.OPTIONAL, {
        defaultValue: "general",
        validator: Validators.inChoices(["general", "etl", "analytics", "streaming"]),
        transformer: Transformers.toLower,
        description: "实例用途",
      })
      .defineParam("activate", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否立即激活",
      })
      .defineParam("set_as_default", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "设为默认实例",
      })
      .defineParam("validate_before_save", ParamType.OPTIONAL, {
        defaultValue: true,
        transformer: Transformers.toBool,
        description: "保存前验证实例",
      })
      .defineParam("description", ParamType.OPTIONAL, {
        transformer: Transformers.stripString,
        description: "实例描述",
      })
      .defineParam("platform", ParamType.OPTIONAL, {
        validator: Validators.inChoices(["yunqi", "singdata"]),
        transformer: Transformers.toLower,
        description: "平台类型",
      })
      .defineParam("region_key", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "地域键值",
      })
  }

  static getOperationGuide(): ParameterHandler {
    return new ParameterHandler("get_operation_guide")
      .defineParam("to_do_something", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "要执行的操作",
      })
  }

  static descObjectHistory(): ParameterHandler {
    return new ParameterHandler("desc_object_history")
      .defineParam("object_name", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("object_type", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("limit", ParamType.OPTIONAL, {
        defaultValue: 10,
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
      })
  }

  static undropObject(): ParameterHandler {
    return new ParameterHandler("undrop_object")
      .defineParam("object_name", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("object_type", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
  }

  static dropObject(): ParameterHandler {
    return new ParameterHandler("drop_object")
      .defineParam("object_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "要删除的对象名称",
      })
      .defineParam("object_type", ParamType.REQUIRED, {
        validator: Validators.inChoices([
          "SCHEMA", "EXTERNAL SCHEMA", "TABLE", "VIEW", "DYNAMIC TABLE",
          "MATERIALIZED VIEW", "EXTERNAL TABLE", "TABLE STREAM",
          "INDEX", "BLOOMFILTER", "INVERTED", "VECTOR",
          "CONNECTION", "STORAGE CONNECTION", "API CONNECTION", "CATALOG CONNECTION",
          "VOLUME", "EXTERNAL VOLUME", "VCLUSTER",
          "USER", "ROLE", "SHARE", "NETWORK POLICY", "PIPE",
          "FUNCTION", "EXTERNAL FUNCTION", "SYNONYM",
        ]),
        transformer: (x: unknown) => x ? String(x).trim().toUpperCase() : x,
        description: "对象类型",
      })
      .defineParam("if_exists", ParamType.OPTIONAL, {
        defaultValue: true,
        transformer: Transformers.toBool,
        description: "是否使用IF EXISTS",
      })
      .defineParam("cascade", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否级联删除依赖对象",
      })
      .defineParam("restrict", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否限制删除",
      })
      .defineParam("force", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "是否强制删除",
      })
      .defineParam("confirm_delete", ParamType.OPTIONAL, {
        defaultValue: false,
        transformer: Transformers.toBool,
        description: "确认删除操作",
      })
  }

  static restoreObject(): ParameterHandler {
    return new ParameterHandler("restore_object")
      .defineParam("object_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "要恢复的对象名称",
      })
      .defineParam("object_type", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.toUpper,
        description: "对象类型",
      })
      .defineParam("timestamp", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
        description: "恢复到的时间点",
      })
  }

  static createExternalFunction(): ParameterHandler {
    const handler = new ParameterHandler("create_external_function")
    handler.defineParam("function_name", ParamType.REQUIRED, {
      validator: Validators.nonEmptyString,
      transformer: Transformers.stripString,
      description: "外部函数名称",
    })
    handler.defineParam("class_name", ParamType.REQUIRED, {
      validator: Validators.handlerFormatValidator,
      transformer: Transformers.validateAndFixHandlerFormat,
      description: "函数Handler，支持module.class格式",
    })
    handler.defineParam("resource_uris", ParamType.REQUIRED, {
      validator: Validators.resourceUrisList,
      transformer: Transformers.parseResourceUris,
      description: "资源文件列表（仅支持.zip压缩包）",
    })
    handler.defineParam("connection_name", ParamType.REQUIRED, {
      validator: Validators.nonEmptyString,
      transformer: Transformers.stripString,
      description: "API连接名称",
    })
    handler.defineParam("schema_name", ParamType.OPTIONAL, {
      defaultValue: null,
      validator: Validators.nonEmptyStringOrNone,
      transformer: Transformers.stripString,
      description: "Schema名称",
    })
    handler.defineParam("if_not_exists", ParamType.OPTIONAL, {
      defaultValue: false,
      transformer: Transformers.toBool,
    })
    handler.defineParam("language", ParamType.OPTIONAL, {
      defaultValue: "python",
      validator: Validators.inChoicesCaseInsensitive(["python", "java"]),
      transformer: Transformers.toLower,
      description: "编程语言类型",
    })
    handler.defineParam("comment", ParamType.OPTIONAL, {
      validator: Validators.nonEmptyStringOrNone,
      transformer: Transformers.stripString,
    })
    handler.defineParam("validate_code", ParamType.OPTIONAL, {
      defaultValue: true, transformer: Transformers.toBool,
    })
    handler.defineParam("enforce_zip", ParamType.OPTIONAL, {
      defaultValue: true, transformer: Transformers.toBool,
    })
    handler.defineParam("auto_package", ParamType.OPTIONAL, {
      defaultValue: false, transformer: Transformers.toBool,
    })
    handler.defineParam("auto_test", ParamType.OPTIONAL, {
      defaultValue: false, transformer: Transformers.toBool,
    })
    handler.defineParam("test_sql", ParamType.OPTIONAL, {
      validator: Validators.nonEmptyStringOrNone,
      transformer: Transformers.stripString,
    })
    handler.defineParam("suggest_volume", ParamType.OPTIONAL, {
      defaultValue: true, transformer: Transformers.toBool,
    })
    handler.defineParam("include_precheck", ParamType.OPTIONAL, {
      defaultValue: true, transformer: Transformers.toBool,
    })
    handler.defineParam("include_usage_examples", ParamType.OPTIONAL, {
      defaultValue: true, transformer: Transformers.toBool,
    })
    handler.defineParam("include_sql", ParamType.OPTIONAL, {
      defaultValue: true, transformer: Transformers.toBool,
    })
    handler.defineParam("zip_structure", ParamType.OPTIONAL, {
      validator: Validators.nonEmptyStringOrNone,
      transformer: Transformers.stripString,
    })
    handler.defineParam("include_structure_scan", ParamType.OPTIONAL, {
      defaultValue: true, transformer: Transformers.toBool,
    })
    handler.defineParam("strict_naming", ParamType.OPTIONAL, {
      defaultValue: true, transformer: Transformers.toBool,
    })
    handler.defineParam("auto_correct_handler_path", ParamType.OPTIONAL, {
      defaultValue: true, transformer: Transformers.toBool,
    })
    return handler
  }

  static createTable(): ParameterHandler {
    return new ParameterHandler("create_table")
      .defineParam("table_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("if_not_exists", ParamType.OPTIONAL, {
        defaultValue: false, transformer: Transformers.toBool,
      })
      .defineParam("creation_method", ParamType.OPTIONAL, {
        defaultValue: "standard",
        validator: Validators.inChoices(["standard", "like", "ctas", "raw_sql"]),
        transformer: Transformers.toLower,
      })
      .defineParam("columns", ParamType.OPTIONAL, {
        validator: (x: unknown) => x === null || x === undefined || typeof x === "string" || Array.isArray(x),
      })
      .defineParam("indexes", ParamType.OPTIONAL, { validator: Validators.isListOrNone })
      .defineParam("partition", ParamType.OPTIONAL, { validator: Validators.isDictOrNone })
      .defineParam("clustering", ParamType.OPTIONAL, { validator: Validators.isDictOrNone })
      .defineParam("table_sorted_by", ParamType.OPTIONAL, { validator: Validators.isListOrNone })
      .defineParam("properties", ParamType.OPTIONAL, { validator: Validators.isDictOrNone })
      .defineParam("source_table", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("select_statement", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("raw_sql", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("comment", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("verbose", ParamType.OPTIONAL, {
        defaultValue: null, transformer: Transformers.toBool,
      })
      .defineParam("include_sql", ParamType.OPTIONAL, {
        defaultValue: null, transformer: Transformers.toBool,
      })
  }

  static createDynamicTable(): ParameterHandler {
    const handler = new ParameterHandler("create_dynamic_table")
    handler.defineParam("table_name", ParamType.REQUIRED, {
      validator: Validators.nonEmptyString,
      transformer: Transformers.stripString,
    })
    handler.defineParam("select_sql", ParamType.REQUIRED, {
      validator: Validators.nonEmptyString,
      transformer: Transformers.stripString,
    })
    handler.defineParam("replace", ParamType.OPTIONAL, {
      defaultValue: false, transformer: Transformers.toBool,
    })
    handler.defineParam("if_not_exists", ParamType.OPTIONAL, {
      defaultValue: false, transformer: Transformers.toBool,
    })
    handler.defineParam("partition_by", ParamType.OPTIONAL, {
      validator: Validators.nonEmptyStringOrNone,
      transformer: Transformers.stripString,
    })
    handler.defineParam("refresh_interval", ParamType.OPTIONAL, {
      validator: Validators.nonEmptyStringOrNone,
      transformer: Transformers.stripString,
    })
    handler.defineParam("comment", ParamType.OPTIONAL, {
      validator: Validators.nonEmptyStringOrNone,
      transformer: Transformers.stripString,
    })
    handler.defineParam("refresh_option", ParamType.OPTIONAL, {
      validator: Validators.nonEmptyStringOrNone,
      transformer: Transformers.stripString,
    })

    const originalProcess = handler.processArguments.bind(handler)
    handler.processArguments = (arguments_: Record<string, unknown> | null | undefined) => {
      const args = { ...(arguments_ ?? {}) }
      if ("query" in args && !("select_sql" in args)) {
        args["select_sql"] = args["query"]
      }
      return originalProcess(args)
    }
    return handler
  }

  static refreshDynamicTable(): ParameterHandler {
    return new ParameterHandler("refresh_dynamic_table")
      .defineParam("table_name", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
  }

  static alterDynamicTable(): ParameterHandler {
    return new ParameterHandler("alter_dynamic_table")
      .defineParam("table_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("operation", ParamType.REQUIRED, {
        validator: Validators.inChoices([
          "suspend", "resume", "set_comment", "rename_column", "set_column_comment",
          "add_column", "drop_column", "alter_column", "set_refresh_interval", "set_select",
        ]),
        transformer: Transformers.toLower,
      })
      .defineParam("column_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("new_column_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("comment", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
  }

  static modifyDynamicTableData(): ParameterHandler {
    return new ParameterHandler("modify_dynamic_table_data")
      .defineParam("sql", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        description: "要执行的SQL语句",
      })
      .defineParam("table_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        description: "目标表名",
      })
      .defineParam("auto_cast", ParamType.OPTIONAL, {
        validator: Validators.isBoolOrNone,
        defaultValue: true,
        description: "是否自动将日期/时间字面量包装为DATE()/TIMESTAMP()",
      })
  }

  static createPipe(): ParameterHandler {
    return new ParameterHandler("create_pipe")
      .defineParam("pipe_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("target_table", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("source_volume", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("file_format", ParamType.OPTIONAL, {
        defaultValue: "CSV",
        validator: Validators.inChoices(["CSV", "JSON", "PARQUET", "ORC", "AVRO"]),
        transformer: Transformers.toUpper,
      })
      .defineParam("source_path", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("debug", ParamType.OPTIONAL, {
        validator: Validators.isBoolOrNone,
        transformer: Transformers.toBool,
      })
      .defineParam("step_by_step", ParamType.OPTIONAL, {
        validator: Validators.isBoolOrNone,
        transformer: Transformers.toBool,
        defaultValue: false,
      })
      .defineParam("smart_fallback", ParamType.OPTIONAL, {
        defaultValue: "abort",
        validator: Validators.inChoices(["abort", "skeleton"]),
        transformer: Transformers.toLower,
      })
      .defineParam("schema_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("virtual_cluster", ParamType.OPTIONAL, {
        defaultValue: "default",
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("ingest_mode", ParamType.OPTIONAL, {
        defaultValue: "LIST_PURGE",
        validator: Validators.inChoices(["LIST_PURGE", "EVENT_NOTIFICATION"]),
        transformer: Transformers.toUpper,
      })
      .defineParam("copy_statement", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("if_not_exists", ParamType.OPTIONAL, {
        defaultValue: false, transformer: Transformers.toBool,
      })
      .defineParam("copy_job_hint", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("auto_purge", ParamType.OPTIONAL, {
        validator: Validators.isBoolOrNone,
        transformer: Transformers.toBool,
      })
      .defineParam("batch_interval_in_seconds", ParamType.OPTIONAL, {
        validator: Validators.positiveInteger,
        transformer: Transformers.toInt,
      })
      .defineParam("batch_size_per_kafka_partition", ParamType.OPTIONAL, {
        validator: Validators.positiveInteger,
        transformer: Transformers.toInt,
      })
      .defineParam("max_skip_batch_count_on_error", ParamType.OPTIONAL, {
        validator: Validators.positiveInteger,
        transformer: Transformers.toInt,
      })
      .defineParam("reset_kafka_group_offsets", ParamType.OPTIONAL, {
        validator: Validators.inChoices(["latest", "earliest", "none", "valid"]),
        transformer: Transformers.toLower,
      })
      .defineParam("initial_delay_in_seconds", ParamType.OPTIONAL, {
        validator: Validators.nonNegativeInteger,
        transformer: Transformers.toInt,
      })
      .defineParam("current_schema", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
  }

  static createTableStream(): ParameterHandler {
    return new ParameterHandler("create_table_stream")
      .defineParam("stream_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("table_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("table_stream_mode", ParamType.OPTIONAL, {
        defaultValue: "STANDARD",
        validator: Validators.inChoices(["APPEND_ONLY", "STANDARD"]),
        transformer: Transformers.toUpper,
      })
      .defineParam("with_options", ParamType.OPTIONAL, { defaultValue: {} })
      .defineParam("start_from", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("comment", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
  }

  static listFilesOnVolume(): ParameterHandler {
    const handler = new ParameterHandler("list_files_on_volume")
      .defineParam("target_volume", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("regexp", ParamType.OPTIONAL, {})
      .defineParam("target_subdirectory", ParamType.OPTIONAL, {})
      .defineParam("target_schema", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
    return ResponseControlMixin.addResponseControlParams(handler)
  }

  static putFileToVolume(): ParameterHandler {
    const handler = new ParameterHandler("put_file_to_volume")
      .defineParam("source_path", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("content", ParamType.OPTIONAL, {})
      .defineParam("target_volume", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("target_filename", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("target_subdirectory", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("validate_format", ParamType.OPTIONAL, {
        defaultValue: false, transformer: Transformers.toBool,
      })
      .defineParam("overwrite", ParamType.OPTIONAL, {
        defaultValue: true, transformer: Transformers.toBool,
      })
      .defineParam("python_version", ParamType.OPTIONAL, {
        defaultValue: "python3.10",
        validator: (v: unknown) => ["python3.10", "python3.9", "python3.8", "python3.11"].includes(v as string),
      })
      .defineParam("options", ParamType.OPTIONAL, { defaultValue: {} })
      .defineParam("target_schema", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("current_schema", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
    return ResponseControlMixin.addResponseControlParams(handler)
  }

  static getFileFromVolume(): ParameterHandler {
    const handler = new ParameterHandler("get_file_from_volume")
      .defineParam("source_file", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("source_volume", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("target_local_path", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
      })
      .defineParam("source_schema", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("overwrite", ParamType.OPTIONAL, {
        defaultValue: false, transformer: Transformers.toBool,
      })
      .defineParam("target_is_directory", ParamType.OPTIONAL, { defaultValue: null })
      .defineParam("options", ParamType.OPTIONAL, { defaultValue: {} })
    return ResponseControlMixin.addResponseControlParams(handler)
  }

  static removeFileFromVolume(): ParameterHandler {
    return new ParameterHandler("remove_file_from_volume")
      .defineParam("target_volume", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("target_file", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("target_subdirectory", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("target_schema", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
  }

  static createVolume(): ParameterHandler {
    const handler = new ParameterHandler("create_volume")
      .defineParam("volume_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("volume_type", ParamType.OPTIONAL, {
        defaultValue: "external",
        validator: Validators.inChoices(["oss", "cos", "s3", "external", "internal"]),
        transformer: Transformers.toLower,
      })
      .defineParam("bucket", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("path", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("connection", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("directory_options", ParamType.OPTIONAL, {
        defaultValue: {},
        validator: Validators.isDictOrNone,
      })
      .defineParam("recursive", ParamType.OPTIONAL, {
        defaultValue: true, transformer: Transformers.toBool,
      })
      .defineParam("validate_after_creation", ParamType.OPTIONAL, {
        defaultValue: true, transformer: Transformers.toBool,
      })

    const originalProcess = handler.processArguments.bind(handler)
    handler.processArguments = (arguments_: Record<string, unknown> | null | undefined) => {
      const params = originalProcess(arguments_)
      const volumeType = params["volume_type"] as string
      if (["oss", "cos", "s3"].includes(volumeType)) {
        params["storage_type"] = volumeType
        params["volume_type"] = "external"
      } else if (volumeType === "external") {
        params["storage_type"] = (params["storage_type"] as string) ?? "oss"
      }
      return params
    }
    return handler
  }

  static createKnowledgeBase(): ParameterHandler {
    return new ParameterHandler("create_knowledge_base")
      .defineParam("knowledge_name", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("documents_source_type", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("documents_source_path", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("volume_name", ParamType.OPTIONAL, {})
      .defineParam("processing_options", ParamType.OPTIONAL, { defaultValue: {} })
  }

  static createExternalVolume(): ParameterHandler {
    return new ParameterHandler("create_external_volume")
      .defineParam("volume_name", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("bucket", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("connection", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("path", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("volume_type", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("recursive", ParamType.OPTIONAL, { defaultValue: true })
  }

  static modifyDynamicTable(): ParameterHandler {
    return new ParameterHandler("modify_dynamic_table")
      .defineParam("table_name", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("operation", ParamType.REQUIRED, {
        validator: Validators.inChoices(["INSERT", "UPDATE", "DELETE", "MERGE"]),
      })
      .defineParam("sql", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
  }

  static packageExternalFunction(): ParameterHandler {
    return new ParameterHandler("package_external_function")
      .defineParam("source_file", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
      })
      .defineParam("source_content", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
      })
      .defineParam("module_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
      })
      .defineParam("dependencies", ParamType.OPTIONAL, {
        defaultValue: [],
        validator: Validators.isListOrNone,
      })
      .defineParam("output_path", ParamType.OPTIONAL, {
        defaultValue: "function.zip",
        validator: Validators.nonEmptyString,
      })
      .defineParam("packaging_mode", ParamType.OPTIONAL, {
        defaultValue: "development",
        validator: (v: unknown) => !v || ["production", "development", "docker"].includes(v as string),
      })
      .defineParam("use_docker", ParamType.OPTIONAL, {
        defaultValue: false, transformer: Transformers.toBool,
      })
      .defineParam("force_python_version", ParamType.OPTIONAL, {
        validator: (v: unknown) => !v || ["3.8", "3.9", "3.10", "3.11"].includes(v as string),
      })
      .defineParam("auto_annotate", ParamType.OPTIONAL, {
        defaultValue: true, transformer: Transformers.toBool,
      })
      .defineParam("structure_scan", ParamType.OPTIONAL, {
        defaultValue: true, transformer: Transformers.toBool,
      })
      .defineParam("force_json_return", ParamType.OPTIONAL, {
        defaultValue: false, transformer: Transformers.toBool,
      })
  }

  static buildKnowledgeBase(): ParameterHandler {
    return new ParameterHandler("build_knowledge_base")
      .defineParam("knowledge_name", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("documents_source_type", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("documents_source_path", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("if_exists", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
      .defineParam("documents_original_source", ParamType.OPTIONAL, {})
      .defineParam("volume_name", ParamType.OPTIONAL, {})
      .defineParam("volume_regexp", ParamType.OPTIONAL, {})
  }

  static alterPipe(): ParameterHandler {
    return new ParameterHandler("alter_pipe")
      .defineParam("pipe_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("operation", ParamType.REQUIRED, {
        validator: Validators.inChoices([
          "suspend", "resume", "set_virtual_cluster", "set_batch_interval",
          "set_batch_size", "set_max_skip_batch_count", "set_copy_job_hint",
        ]),
        transformer: Transformers.toLower,
      })
      .defineParam("virtual_cluster", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("batch_interval_in_seconds", ParamType.OPTIONAL, {
        validator: Validators.positiveInteger,
        transformer: Transformers.toInt,
      })
      .defineParam("batch_size_per_kafka_partition", ParamType.OPTIONAL, {
        validator: Validators.positiveInteger,
        transformer: Transformers.toInt,
      })
      .defineParam("max_skip_batch_count_on_error", ParamType.OPTIONAL, {
        validator: Validators.positiveInteger,
        transformer: Transformers.toInt,
      })
      .defineParam("copy_job_hint", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("paused", ParamType.OPTIONAL, { transformer: Transformers.toBool })
      .defineParam("error_handling", ParamType.OPTIONAL, {
        validator: Validators.inChoices(["CONTINUE", "ABORT_STATEMENT", "SKIP_FILE"]),
        transformer: Transformers.toUpper,
      })
  }

  static createIndex(): ParameterHandler {
    return new ParameterHandler("create_index")
      .defineParam("index_type", ParamType.OPTIONAL, {
        validator: Validators.inChoices(["VECTOR", "INVERTED", "BLOOMFILTER"]),
        transformer: Transformers.toUpper,
      })
      .defineParam("index_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("table_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("column_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("indexes", ParamType.OPTIONAL, { validator: Validators.isListOrNone })
      .defineParam("auto_recommend", ParamType.OPTIONAL, {
        defaultValue: false, transformer: Transformers.toBool,
      })
      .defineParam("query_patterns", ParamType.OPTIONAL, { validator: Validators.isListOrNone })
      .defineParam("if_not_exists", ParamType.OPTIONAL, {
        defaultValue: false, transformer: Transformers.toBool,
      })
      .defineParam("build_immediately", ParamType.OPTIONAL, {
        defaultValue: false, transformer: Transformers.toBool,
      })
      .defineParam("comment", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("distance_function", ParamType.OPTIONAL, {
        defaultValue: "COSINE",
        validator: Validators.inChoices(["COSINE", "L2", "JACCARD", "HAMMING"]),
        transformer: Transformers.toUpper,
      })
      .defineParam("dimension", ParamType.OPTIONAL, {
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
      })
      .defineParam("index_type_param", ParamType.OPTIONAL, {
        defaultValue: "HNSW",
        validator: Validators.inChoices(["HNSW", "IVF", "FLAT"]),
        transformer: Transformers.toUpper,
      })
      .defineParam("scalar_type", ParamType.OPTIONAL, {
        defaultValue: "f32",
        validator: Validators.inChoices(["f32", "f16", "i8", "b1"]),
        transformer: Transformers.toLower,
      })
      .defineParam("ef_construction", ParamType.OPTIONAL, {
        defaultValue: 200,
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
      })
      .defineParam("M", ParamType.OPTIONAL, {
        defaultValue: 16,
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
      })
      .defineParam("analyzer", ParamType.OPTIONAL, {
        defaultValue: "chinese",
        validator: Validators.inChoices(["chinese", "english", "keyword", "unicode"]),
        transformer: Transformers.toLower,
      })
      .defineParam("properties", ParamType.OPTIONAL, { validator: Validators.isDictOrNone })
  }

  static showJobHistory(): ParameterHandler {
    return new ParameterHandler("show_job_history")
      .defineParam("limit", ParamType.OPTIONAL, {
        defaultValue: 10,
        validator: Validators.positiveInteger,
        transformer: Transformers.toInt,
      })
      .defineParam("virtual_cluster", ParamType.OPTIONAL, { validator: Validators.nonEmptyString })
      .defineParam("start_time", ParamType.OPTIONAL, { validator: Validators.nonEmptyString })
      .defineParam("end_time", ParamType.OPTIONAL, { validator: Validators.nonEmptyString })
      .defineParam("status", ParamType.OPTIONAL, { validator: Validators.nonEmptyString })
  }

  static showTableLoadHistory(): ParameterHandler {
    return new ParameterHandler("show_table_load_history")
      .defineParam("table_name", ParamType.REQUIRED, { validator: Validators.nonEmptyString })
  }

  static auditTableSchemaHistory(): ParameterHandler {
    return new ParameterHandler("audit_table_schema_history")
      .defineParam("target_type", ParamType.REQUIRED, {
        transformer: Transformers.toUpper,
        validator: Validators.inChoices(["TABLE", "SCHEMA", "DYNAMIC_TABLE"]),
      })
      .defineParam("table_name", ParamType.OPTIONAL, { validator: Validators.nonEmptyString })
      .defineParam("schema_name", ParamType.OPTIONAL, { validator: Validators.nonEmptyString })
      .defineParam("like_pattern", ParamType.OPTIONAL, { validator: Validators.nonEmptyString })
      .defineParam("limit", ParamType.OPTIONAL, {
        defaultValue: 20,
        transformer: Transformers.toInt,
        validator: Validators.positiveInteger,
      })
      .defineParam("audit_type", ParamType.OPTIONAL, {
        defaultValue: "table_overview",
        transformer: Transformers.toLower,
        validator: Validators.inChoices([
          "table_overview", "table_lifecycle", "table_changes", "table_loads",
          "dynamic_refresh", "deleted_objects", "schema_overview",
        ]),
      })
  }

  static getCurrentContext(): ParameterHandler {
    return new ParameterHandler("get_current_context")
  }

  static analyzeFunctionPackage(): ParameterHandler {
    return new ParameterHandler("analyze_function_package")
      .defineParam("resource_uri", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("language", ParamType.OPTIONAL, {
        defaultValue: "auto",
        validator: Validators.inChoices(["python", "java", "auto"]),
        transformer: Transformers.toLower,
      })
  }

  static manageShare(): ParameterHandler {
    return new ParameterHandler("manage_share")
      .defineParam("operation", ParamType.REQUIRED, {
        validator: Validators.inChoices([
          "create", "drop", "add_instance", "remove_instance",
          "grant_table", "grant_view", "grant_schema_tables", "grant_schema_views",
          "revoke_table", "revoke_view", "describe", "list",
        ]),
        transformer: Transformers.stripString,
      })
      .defineParam("share_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("table_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("view_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("schema_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("instance_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("provider_instance", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("filter_kind", ParamType.OPTIONAL, {
        validator: (v: unknown) => v === null || v === undefined || ["INBOUND", "OUTBOUND"].includes(String(v).toUpperCase()),
        transformer: (v: unknown) => v ? String(v).toUpperCase() : null,
      })
      .defineParam("limit", ParamType.OPTIONAL, {
        validator: (v: unknown) => v === null || v === undefined || (typeof v === "number" && v > 0),
        transformer: Transformers.toIntOrNone,
      })
      .defineParam("new_schema_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("source_schema", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
  }

  static crawlSinglePageDirect(): ParameterHandler {
    return new ParameterHandler("crawl_single_page_direct")
      .defineParam("url", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("css_selector", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyStringOrNone,
        transformer: Transformers.stripString,
      })
      .defineParam("word_count_threshold", ParamType.OPTIONAL, {
        validator: Validators.positiveInteger,
        transformer: Transformers.toIntOrNone,
        defaultValue: "10",
      })
      .defineParam("bypass_cache", ParamType.OPTIONAL, {
        validator: Validators.isBooleanOrNone,
        transformer: Transformers.toBoolOrNone,
        defaultValue: "false",
      })
      .defineParam("include_raw_html", ParamType.OPTIONAL, {
        validator: Validators.isBooleanOrNone,
        transformer: Transformers.toBoolOrNone,
        defaultValue: "false",
      })
  }

  static getExternalFunctionGuide(): ParameterHandler {
    return new ParameterHandler("get_external_function_guide")
      .defineParam("topic", ParamType.OPTIONAL, {
        defaultValue: "overview",
        validator: (v: unknown) => [
          "knowledge_hub", "overview", "python_spec", "packaging",
          "debugging", "best_practices", "common_errors", "null_handling",
        ].includes(v as string),
      })
      .defineParam("format", ParamType.OPTIONAL, {
        defaultValue: "markdown",
        validator: (v: unknown) => ["markdown", "structured"].includes(v as string),
      })
  }

  static getExternalFunctionTemplate(): ParameterHandler {
    return new ParameterHandler("get_external_function_template")
      .defineParam("example_type", ParamType.OPTIONAL, {
        defaultValue: "basic",
        validator: (v: unknown) => [
          "basic", "with_dependencies", "api_integration",
          "data_processing", "ml_inference",
        ].includes(v as string),
      })
      .defineParam("python_version", ParamType.OPTIONAL, {
        defaultValue: "python3.10",
        validator: (v: unknown) => ["python3.10", "python3.9", "python3.8", "python3.11"].includes(v as string),
      })
      .defineParam("include_tests", ParamType.OPTIONAL, {
        defaultValue: true, transformer: Transformers.toBool,
      })
  }

  static generateExternalFunctionTemplate(): ParameterHandler {
    return new ParameterHandler("generate_external_function_template")
      .defineParam("function_name", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("template_type", ParamType.OPTIONAL, {
        defaultValue: "simple_function",
        validator: (v: unknown) => ["ai_text_processing", "data_processing", "simple_function"].includes(v as string),
      })
      .defineParam("system_prompt", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
      })
      .defineParam("output_dir", ParamType.OPTIONAL, {
        defaultValue: ".",
        validator: Validators.nonEmptyString,
      })
      .defineParam("custom_parameters", ParamType.OPTIONAL, { defaultValue: {} })
  }

  static testExternalFunctionLocally(): ParameterHandler {
    return new ParameterHandler("test_external_function_locally")
      .defineParam("python_file", ParamType.REQUIRED, {
        validator: Validators.nonEmptyString,
        transformer: Transformers.stripString,
      })
      .defineParam("function_name", ParamType.OPTIONAL, {
        validator: Validators.nonEmptyString,
      })
      .defineParam("test_cases", ParamType.OPTIONAL, { defaultValue: [] })
  }
}

// ---------------------------------------------------------------------------
// withParameterHandler — parameter_handler.py:2718-2739
// ---------------------------------------------------------------------------
export function withParameterHandler(
  handlerFactoryMethod: () => ParameterHandler
) {
  return function decorator<T extends (...args: unknown[]) => Promise<unknown>>(fn: T) {
    return async function wrapper(arguments_: Record<string, unknown>, ...rest: unknown[]) {
      const handler = handlerFactoryMethod()
      const params = handler.processArguments(arguments_)
      return fn(params, ...rest)
    } as unknown as T
  }
}
