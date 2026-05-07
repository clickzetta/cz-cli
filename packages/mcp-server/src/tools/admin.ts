/**
 * Admin tools — port of cz-mcp-server/cz_mcp/tools/admin_tools.py
 *
 * Python → TS mapping:
 *   admin_tools.py:1-105   get_admin_tools()           → registerAdminTools()
 *   object_management.py:18-135  handle_show_object_list     → handleShowObjectList()
 *   object_management.py:229-311 _handle_special_table_types → handleSpecialTableTypes()
 *   object_management.py:314-365 _handle_functions_special   → handleFunctionsSpecial()
 *   object_management.py:368-437 handle_tables_with_type_filter → handleTablesWithTypeFilter()
 *   object_management.py:442-528 handle_desc_object          → handleDescObject()
 *   object_management.py:531-601 handle_desc_history         → handleDescHistory()
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"

// ---------------------------------------------------------------------------
// Default limits — object_management.py:38-44
// ---------------------------------------------------------------------------
const DEFAULT_LIMITS: Record<string, number> = {
  FUNCTIONS: 25,
  TABLES: 20,
  VIEWS: 25,
  SCHEMAS: 20,
  CONNECTIONS: 20,
  VOLUMES: 15,
  PIPES: 20,
  STREAMS: 20,
  CATALOGS: 10,
  WORKSPACES: 10,
  VCLUSTERS: 15,
  USERS: 30,
  ROLES: 20,
  SHARES: 15,
  DYNAMIC_TABLES: 25,
  INDEXES: 40,
  MATERIALIZED_VIEWS: 20,
}

// object types that do NOT support IN SCHEMA — object_management.py:72-75
const NO_IN_SCHEMA_TYPES = new Set([
  "WORKSPACES",
  "FUNCTIONS",
  "EXTERNAL FUNCTIONS",
  "VOLUMES",
  "CATALOGS",
  "CONNECTIONS",
  "USERS",
  "ROLES",
  "SHARES",
  "NETWORK_POLICY",
  "VCLUSTERS",
  "JOBS",
])

// ---------------------------------------------------------------------------
// handleSpecialTableTypes — object_management.py:229-311
// ---------------------------------------------------------------------------
async function handleSpecialTableTypes(
  objectType: string,
  params: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const schemaName = params["in_schema"] as string | undefined
  const pattern = params["like_pattern"] as string | undefined
  const limit = (params["limit"] as number | undefined) ?? 25

  // object_management.py:236-249 — WHERE condition per type
  let whereCondition: string
  if (objectType === "TABLES") {
    whereCondition =
      "is_view=false AND is_dynamic=false AND is_materialized_view=false AND is_external=false"
  } else if (objectType === "VIEWS") {
    whereCondition = "is_view=true"
  } else if (objectType === "DYNAMIC_TABLES") {
    whereCondition = "is_dynamic=true"
  } else if (objectType === "MATERIALIZED_VIEWS") {
    whereCondition = "is_materialized_view=true"
  } else if (objectType === "EXTERNAL_TABLES") {
    whereCondition = "is_external=true"
  } else {
    whereCondition = "1=1"
  }

  const queryParts: string[] = ["SHOW TABLES"]
  if (schemaName) {
    queryParts.push("IN", schemaName)
  }

  const whereClauses: string[] = [whereCondition]
  if (pattern) {
    whereClauses.push(`table_name LIKE '${pattern}'`)
  }
  queryParts.push("WHERE", whereClauses.join(" AND "))
  if (limit) {
    queryParts.push("LIMIT", String(limit))
  }

  const query = queryParts.join(" ")

  try {
    const [resultData] = await db.executeQuery(query + ";")
    const response: Record<string, unknown> = {
      sql_query_executed: query,
      result: resultData,
      result_count: resultData.length,
      object_type: objectType,
      note: `使用SHOW TABLES WHERE ${whereCondition}查询${objectType}`,
    }
    if (limit && resultData.length >= limit) {
      response["truncated"] = true
      response["hint"] = `结果已限制为前 ${limit} 个对象`
    }
    return { success: true, data: response }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e)
    const suggestions: string[] = []
    if (errorMsg.toLowerCase().includes("permission")) {
      suggestions.push(`没有查看${objectType}的权限`)
      suggestions.push("请检查用户权限设置")
    } else if (errorMsg.toLowerCase().includes("not exist")) {
      if (schemaName) {
        suggestions.push(`Schema '${schemaName}' 不存在或无访问权限`)
        suggestions.push("使用 show_object_list(object_type='SCHEMAS') 查看可用Schema")
      }
    }
    return {
      success: false,
      data: {
        success: false,
        error: errorMsg,
        object_type: objectType,
        sql_query_attempted: query,
        suggestions,
      },
    }
  }
}

// ---------------------------------------------------------------------------
// handleFunctionsSpecial — object_management.py:314-365
// ---------------------------------------------------------------------------
async function handleFunctionsSpecial(
  params: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const objectType = params["object_type"] as string
  let limit = (params["limit"] as number | undefined) ?? 25
  if (!limit || typeof limit !== "number") limit = 25
  const pattern = params["like_pattern"] as string | undefined

  const queryParts: string[] =
    objectType === "FUNCTIONS" ? ["SHOW FUNCTIONS"] : ["SHOW EXTERNAL FUNCTIONS"]

  if (pattern) {
    queryParts.push("LIKE", `'${pattern}'`)
  }
  queryParts.push("LIMIT", String(limit))
  const query = queryParts.join(" ")

  try {
    const [resultData] = await db.executeQuery(query + ";")
    const response: Record<string, unknown> = {
      sql_query_executed: query,
      result: resultData,
      result_count: resultData.length,
      object_type: objectType,
      note: "函数列表已按类型筛选",
    }
    if (resultData.length >= limit) {
      response["truncated"] = true
      response["hint"] = `结果已限制为前 ${limit} 个函数`
    }
    return { success: true, data: response }
  } catch (e) {
    return {
      success: false,
      data: {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        object_type: objectType,
        sql_query_attempted: query,
        suggestion: "请检查是否有查看函数的权限",
      },
    }
  }
}

// ---------------------------------------------------------------------------
// handleTablesWithTypeFilter — object_management.py:368-437
// ---------------------------------------------------------------------------
async function handleTablesWithTypeFilter(
  params: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const tableTypeFilters = params["table_type_filters"] as string[] | undefined
  const limit = (params["limit"] as number | undefined) ?? 50
  const schemaName = params["in_schema"] as string | undefined

  let query: string
  if (!tableTypeFilters || tableTypeFilters.length === 0) {
    query = "SHOW TABLES"
  } else if (tableTypeFilters.length === 1) {
    const f = tableTypeFilters[0]
    if (f === "VIEWS") query = "SHOW TABLES WHERE is_view=true"
    else if (f === "DYNAMIC_TABLES") query = "SHOW TABLES WHERE is_dynamic=true"
    else if (f === "MATERIALIZED_VIEWS") query = "SHOW TABLES WHERE is_materialized_view=true"
    else if (f === "EXTERNAL_TABLES") query = "SHOW TABLES WHERE is_external=true"
    else if (f === "REGULAR_TABLES")
      query =
        "SHOW TABLES WHERE is_view=false AND is_dynamic=false AND is_materialized_view=false AND is_external=false"
    else query = "SHOW TABLES"
  } else {
    const conditions: string[] = []
    if (tableTypeFilters.includes("VIEWS")) conditions.push("is_view=true")
    if (tableTypeFilters.includes("DYNAMIC_TABLES")) conditions.push("is_dynamic=true")
    if (tableTypeFilters.includes("MATERIALIZED_VIEWS")) conditions.push("is_materialized_view=true")
    if (tableTypeFilters.includes("EXTERNAL_TABLES")) conditions.push("is_external=true")
    query = conditions.length > 0 ? `SHOW TABLES WHERE ${conditions.join(" OR ")}` : "SHOW TABLES"
  }

  if (schemaName) {
    if (query.includes("WHERE")) {
      query += ` AND schema_name = '${schemaName}'`
    } else {
      query += ` IN SCHEMA ${schemaName}`
    }
  }
  query += ` LIMIT ${limit}`

  try {
    const [resultData] = await db.executeQuery(query + ";")
    return {
      success: true,
      data: {
        sql_query_executed: query,
        result: resultData,
        result_count: resultData.length,
        table_type_filters: tableTypeFilters,
        filtered_by: "SQL指令直接过滤",
      },
    }
  } catch (e) {
    return {
      success: false,
      data: {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        table_type_filters: tableTypeFilters,
        sql_query_attempted: query,
        suggestion: "请检查表类型过滤参数和权限",
      },
    }
  }
}

// ---------------------------------------------------------------------------
// handleShowObjectList — object_management.py:18-135
// ---------------------------------------------------------------------------
async function handleShowObjectList(
  arguments_: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  try {
    const objectType = arguments_["object_type"] as string
    if (!objectType) {
      return { success: false, error: "object_type is required", operation: "SHOW OBJECT LIST" }
    }

    const objectTypeNormalized = objectType.toUpperCase().replace(/ /g, "_")
    const schemaName = arguments_["in_schema"] as string | undefined
    const pattern = arguments_["like_pattern"] as string | undefined
    let limit = arguments_["limit"] as number | undefined
    const tableTypeFilters = arguments_["table_type_filters"] as string[] | undefined

    if (limit == null) {
      limit = DEFAULT_LIMITS[objectTypeNormalized] ?? 20
    }

    // object_management.py:53-61 — dispatch to special handlers
    if (objectTypeNormalized === "FUNCTIONS" || objectTypeNormalized === "EXTERNAL_FUNCTIONS") {
      const result = await handleFunctionsSpecial({ ...arguments_, object_type: objectTypeNormalized }, db)
      return result["data"] as Record<string, unknown>
    }

    if (objectTypeNormalized === "TABLES" && tableTypeFilters && tableTypeFilters.length > 0) {
      const result = await handleTablesWithTypeFilter({ ...arguments_ }, db)
      return result["data"] as Record<string, unknown>
    }

    if (
      ["TABLES", "VIEWS", "DYNAMIC_TABLES", "MATERIALIZED_VIEWS", "EXTERNAL_TABLES"].includes(
        objectTypeNormalized,
      )
    ) {
      const result = await handleSpecialTableTypes(objectTypeNormalized, arguments_, db)
      return result["data"] as Record<string, unknown>
    }

    // Standard SHOW statement — object_management.py:63-86
    const queryParts: string[] = ["SHOW", objectTypeNormalized]

    if (schemaName && !NO_IN_SCHEMA_TYPES.has(objectTypeNormalized)) {
      queryParts.push("IN", "SCHEMA", schemaName)
    }

    if (pattern && ["USERS", "GRANTS", "EXTERNAL SCHEMAS"].includes(objectTypeNormalized)) {
      queryParts.push("LIKE", `'${pattern}'`)
    }

    if (limit) {
      queryParts.push("LIMIT", String(limit))
    }

    const query = queryParts.join(" ")

    try {
      const [resultData] = await db.executeQuery(query + ";")
      const response: Record<string, unknown> = {
        sql_query_executed: query,
        result: limit ? resultData.slice(0, limit) : resultData,
        result_count: resultData.length,
        object_type: objectType,
      }
      if (limit && resultData.length >= limit) {
        response["truncated"] = true
        response["hint"] = `结果已限制为前 ${limit} 个对象`
      }
      return response
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      const suggestions: string[] = []
      if (errorMsg.toLowerCase().includes("permission")) {
        suggestions.push("没有查看此对象类型的权限")
        suggestions.push("请检查用户权限设置")
      } else if (
        errorMsg.toLowerCase().includes("not exist") ||
        errorMsg.toLowerCase().includes("invalid")
      ) {
        if (schemaName) {
          suggestions.push(`Schema '${schemaName}' 不存在或无访问权限`)
          suggestions.push("使用 show_object_list(object_type='SCHEMAS') 查看可用Schema")
        } else {
          suggestions.push(`对象类型 '${objectType}' 不受支持`)
        }
      }
      return {
        success: false,
        error: errorMsg,
        object_type: objectType,
        sql_query_attempted: query,
        suggestions,
      }
    }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      operation: "SHOW OBJECT LIST",
      suggestion: "请检查参数是否正确",
    }
  }
}

// ---------------------------------------------------------------------------
// handleDescObject — object_management.py:442-528
// ---------------------------------------------------------------------------
async function handleDescObject(
  arguments_: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  try {
    const objectType = arguments_["object_type"] as string
    const objectName = arguments_["object_name"] as string
    const extended = (arguments_["extended"] as boolean | undefined) ?? false

    if (!objectType || !objectName) {
      return { success: false, error: "object_type and object_name are required" }
    }

    const objectTypeNormalized = objectType.toUpperCase().replace(/ /g, "_")
    const queryParts: string[] = ["DESC"]

    // object_management.py:461-476 — special type handling
    if (
      (objectTypeNormalized === "EXTERNAL_FUNCTION" || objectTypeNormalized === "FUNCTION") &&
      extended
    ) {
      queryParts.push("FUNCTION", "EXTENDED", objectName)
    } else if (
      objectTypeNormalized === "EXTERNAL_FUNCTION" ||
      objectTypeNormalized === "FUNCTION"
    ) {
      queryParts.push("FUNCTION", objectName)
    } else if (
      ["TABLE", "EXTERNAL_TABLE", "DYNAMIC_TABLE", "MATERIALIZED_VIEW"].includes(
        objectTypeNormalized,
      ) &&
      extended
    ) {
      queryParts.push("TABLE", "EXTENDED", objectName)
    } else if (
      ["TABLE", "EXTERNAL_TABLE", "VIEW", "DYNAMIC_TABLE", "MATERIALIZED_VIEW"].includes(
        objectTypeNormalized,
      )
    ) {
      queryParts.push("TABLE", objectName)
    } else {
      queryParts.push(objectTypeNormalized, objectName)
    }

    const query = queryParts.join(" ")

    try {
      const [resultData] = await db.executeQuery(query + ";")
      const response: Record<string, unknown> = {
        query_type: "DESCRIBE",
        object_type: objectType,
        object_name: objectName,
        sql_query_executed: query,
        result: resultData,
      }
      if (extended) {
        response["extended_info"] = true
        response["note"] = "包含扩展属性信息"
      }
      return response
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      const suggestions: string[] = []
      if (
        errorMsg.toLowerCase().includes("does not exist") ||
        errorMsg.toLowerCase().includes("not found")
      ) {
        suggestions.push(`对象 '${objectName}' 不存在`)
        suggestions.push(`使用 show_object_list(object_type='${objectType}S') 查看可用对象`)
      } else if (errorMsg.toLowerCase().includes("permission")) {
        suggestions.push("没有访问此对象的权限")
        suggestions.push("请检查用户权限设置")
      } else if (errorMsg.toLowerCase().includes("invalid")) {
        suggestions.push(`对象类型 '${objectType}' 可能不支持DESC操作`)
        suggestions.push("请确认对象类型是否正确")
      }
      return {
        error: errorMsg,
        object_type: objectType,
        object_name: objectName,
        sql_query_attempted: query,
        suggestions,
      }
    }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      operation: "DESCRIBE OBJECT",
      suggestion: "请检查对象名称和类型参数",
    }
  }
}

// ---------------------------------------------------------------------------
// handleDescHistory — object_management.py:531-601
// ---------------------------------------------------------------------------
async function handleDescHistory(
  arguments_: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  try {
    const objectName = arguments_["object_name"] as string
    const objectType = arguments_["object_type"] as string
    const limit = (arguments_["limit"] as number | undefined) ?? 10

    if (!objectName || !objectType) {
      return { success: false, error: "object_name and object_type are required" }
    }

    let query = `DESC HISTORY ${objectType} ${objectName}`
    if (limit && limit > 0) {
      query += ` LIMIT ${limit}`
    }

    try {
      const [resultData] = await db.executeQuery(query + ";")
      const response: Record<string, unknown> = {
        query_type: "DESCRIBE HISTORY",
        object_name: objectName,
        object_type: objectType,
        limit_applied: limit,
        sql_query_executed: query,
        history_count: resultData.length,
        result: resultData,
      }
      response["note"] =
        resultData.length === 0
          ? "此对象没有历史版本记录"
          : `找到 ${resultData.length} 个历史版本`
      return response
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      const suggestions: string[] = []
      if (errorMsg.toLowerCase().includes("does not exist")) {
        suggestions.push(`对象 '${objectName}' 不存在`)
        suggestions.push("请检查对象名称是否正确")
      } else if (errorMsg.toLowerCase().includes("not supported")) {
        suggestions.push("此对象类型不支持历史查询")
        suggestions.push("只有TABLE、VIEW等支持历史记录")
      } else if (errorMsg.toLowerCase().includes("permission")) {
        suggestions.push("没有查看对象历史的权限")
      }
      return {
        error: errorMsg,
        object_name: objectName,
        object_type: objectType,
        limit_requested: limit,
        sql_query_attempted: query,
        suggestions,
      }
    }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      operation: "DESCRIBE HISTORY",
      suggestion: "请检查对象名称参数",
    }
  }
}

// ---------------------------------------------------------------------------
// registerAdminTools — admin_tools.py:5-105
// ---------------------------------------------------------------------------
export function registerAdminTools(registry: ToolRegistry, db: LakehouseDB): void {
  const tools: ToolDefinition[] = [
    // admin_tools.py:6-104 — LH-show_object_list
    {
      name: "LH-show_object_list",
      description:
        "Lakehouse SDK low-level query tool that bypasses Studio to directly query the Lakehouse SQL engine.\n" +
        "Lists Lakehouse database objects without needing to construct SQL, avoiding query failures due to SQL " +
        "dialect issues. Supports intelligent filtering, statistical analysis, and filter suggestions. JOBS " +
        "refers to Lakehouse SQL job concept, not to be confused with Studio tasks. If the user only needs to " +
        "switch objects without actually querying, just return the recorded information without executing USE. " +
        "You should use precise queries as much as possible to avoid too many objects.\n" +
        "Main Features:\n" +
        "• Smart Analysis: Analyzes all data and suggests useful filters\n" +
        "• Accurate Statistics: Shows real counts in the database, not just displayed records\n" +
        "• Filter Discovery: Informs about available fields and their possible values\n" +
        "• Smart Suggestions: Recommends filters for hidden important objects\n" +
        "• Two-Step Workflow: First call shows overview and suggestions, second call applies precise filtering\n" +
        "Default Limits: FUNCTIONS(25), TABLES(50), SCHEMAS(20), maximum 100",
      inputSchema: {
        type: "object",
        properties: {
          show_command: {
            type: "string",
            description:
              "Legacy parameter (backward compatible). You can use the following syntax to construct the SHOW command:\n" +
              "SHOW <object_type_plural>  [ IN <scope_object> ] [ LIKE '<pattern>' | WHERE <expr>] [LIMIT num];\n" +
              "Examples: SHOW tables LIKE 'user%'; SHOW tables WHERE is_view=true; SHOW tables IN public; SHOW volumes WHERE workspace_name='public'; SHOW jobs in VCLUSTER default;",
          },
          object_type: {
            type: "string",
            enum: [
              "WORKSPACES",
              "TABLES",
              "VIEWS",
              "SCHEMAS",
              "CATALOGS",
              "FUNCTIONS",
              "EXTERNAL FUNCTIONS",
              "VOLUMES",
              "CONNECTIONS",
              "VCLUSTERS",
              "JOBS",
              "PIPES",
              "USERS",
              "ROLES",
              "GRANTS",
              "SHARES",
              "TABLE STREAMS",
              "DYNAMIC TABLES",
              "MATERIALIZED VIEWS",
              "EXTERNAL TABLES",
              "EXTERNAL SCHEMAS",
              "NETWORK POLICY",
            ],
            description: "Type of objects to list (recommended over show_command)",
          },
          in_schema: {
            type: "string",
            description:
              "Optional schema name to filter objects within. Note: VOLUMES does not support IN syntax currently, use WHERE workspace_name = 'schema' instead",
          },
          like_pattern: {
            type: "string",
            description: "Optional LIKE pattern for filtering object names (e.g., 'user%')",
          },
          where_condition: {
            type: "string",
            description:
              "Optional WHERE clause for advanced filtering (e.g., 'is_external = true')",
          },
          table_type_filters: {
            type: "object",
            description: "Quick filters for table types (only for TABLES)",
            properties: {
              is_view: { type: "boolean", description: "Filter views" },
              is_external: { type: "boolean", description: "Filter external tables" },
              is_dynamic: { type: "boolean", description: "Filter dynamic tables" },
              is_stream: { type: "boolean", description: "Filter table streams" },
            },
          },
          limit: {
            type: "integer",
            description:
              "Maximum number of results to return (default varies by object type)",
            minimum: 1,
            maximum: 20,
          },
          smart_defaults: {
            type: "boolean",
            default: true,
            description: "Apply smart defaults (e.g., auto-limit for JOBS)",
          },
        },
        required: ["object_type"],
      },
      handler: async (args: Record<string, unknown>) => {
        return handleShowObjectList(args, db)
      },
      tags: ["read"],
      samples: [
        { description: "List all workspaces", query: { object_type: "WORKSPACES" } },
        {
          description: "List tables in public schema",
          query: { object_type: "TABLES", in_schema: "public" },
        },
        {
          description: "Find tables with names starting with 'user'",
          query: { object_type: "TABLES", like_pattern: "user%" },
        },
      ],
    },
    // object_management.py:442-528 — LH-desc_object
    {
      name: "LH-desc_object",
      description:
        "Describe a Lakehouse object (table, view, function, schema, connection, vcluster, etc.). " +
        "Returns detailed metadata including column definitions, properties, and configuration. " +
        "Supports EXTENDED mode for additional details on tables and functions.",
      inputSchema: {
        type: "object",
        properties: {
          object_type: {
            type: "string",
            enum: [
              "TABLE",
              "VIEW",
              "EXTERNAL_TABLE",
              "DYNAMIC_TABLE",
              "MATERIALIZED_VIEW",
              "FUNCTION",
              "EXTERNAL_FUNCTION",
              "SCHEMA",
              "CONNECTION",
              "VCLUSTER",
              "VOLUME",
              "PIPE",
            ],
            description: "Type of the object to describe",
          },
          object_name: {
            type: "string",
            description: "Fully qualified name of the object (e.g., schema.table_name)",
          },
          extended: {
            type: "boolean",
            default: false,
            description: "Return extended information (supported for TABLE and FUNCTION types)",
          },
        },
        required: ["object_type", "object_name"],
      },
      handler: async (args: Record<string, unknown>) => {
        return handleDescObject(args, db)
      },
      tags: ["read"],
      samples: [
        {
          description: "Describe a table",
          query: { object_type: "TABLE", object_name: "public.my_table" },
        },
        {
          description: "Describe a table with extended info",
          query: { object_type: "TABLE", object_name: "public.my_table", extended: true },
        },
      ],
    },
    // object_management.py:531-601 — LH-desc_history
    {
      name: "LH-desc_history",
      description:
        "Describe the history of a Lakehouse object (table, view, etc.). " +
        "Returns historical version information for time-travel and audit purposes.",
      inputSchema: {
        type: "object",
        properties: {
          object_type: {
            type: "string",
            description: "Type of the object (e.g., TABLE, VIEW)",
          },
          object_name: {
            type: "string",
            description: "Fully qualified name of the object",
          },
          limit: {
            type: "integer",
            default: 10,
            description: "Maximum number of history records to return",
          },
        },
        required: ["object_type", "object_name"],
      },
      handler: async (args: Record<string, unknown>) => {
        return handleDescHistory(args, db)
      },
      tags: ["read"],
      samples: [
        {
          description: "Get history of a table",
          query: { object_type: "TABLE", object_name: "public.my_table", limit: 10 },
        },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering admin tools")
  registry.registerTools(tools)
}
