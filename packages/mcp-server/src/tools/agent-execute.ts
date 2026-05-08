/**
 * agent-execute.ts — port of cz_mcp/tools/agent/LH_execute_tools.py
 * Agent-mode SQL execution tool (LH_execute_query) and show_object_list_v2.
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import { ResponseBuilder } from "../common/utilities.js"
import { SQLIntelligence } from "../query/sql-intelligence.js"

// ---------------------------------------------------------------------------
// Constants for show_object_list_v2
// ---------------------------------------------------------------------------
const DEFAULT_LIMITS: Record<string, number> = {
  FUNCTIONS: 25, TABLES: 20, VIEWS: 25, SCHEMAS: 20, CONNECTIONS: 20,
  VOLUMES: 15, PIPES: 20, STREAMS: 20, CATALOGS: 10, WORKSPACES: 10,
  VCLUSTERS: 15, USERS: 30, ROLES: 20, SHARES: 15, DYNAMIC_TABLES: 25,
  INDEXES: 40, MATERIALIZED_VIEWS: 20,
}

const NO_IN_SCHEMA_TYPES = new Set([
  "WORKSPACES", "FUNCTIONS", "EXTERNAL_FUNCTIONS", "VOLUMES", "CATALOGS",
  "CONNECTIONS", "USERS", "ROLES", "SHARES", "NETWORK_POLICY", "VCLUSTERS", "JOBS",
])

// ---------------------------------------------------------------------------
// handleShowObjectListV2 — show_object.py:handle_show_object_list_v2
// ---------------------------------------------------------------------------
async function handleShowObjectListV2(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  try {
    const objectType = args["object_type"] as string
    if (!objectType) return { success: false, error: "object_type is required" }

    const objectTypeNormalized = objectType.toUpperCase().replace(/ /g, "_")
    const schemaName = args["in_schema"] as string | undefined
    const pattern = args["like_pattern"] as string | undefined
    const tableTypeFilters = args["table_type_filters"] as Record<string, boolean> | undefined
    let limit = args["limit"] as number | undefined
    if (limit == null) limit = DEFAULT_LIMITS[objectTypeNormalized] ?? 20

    let query: string

    // Functions special handling
    if (objectTypeNormalized === "FUNCTIONS" || objectTypeNormalized === "EXTERNAL_FUNCTIONS") {
      const parts = objectTypeNormalized === "FUNCTIONS" ? ["SHOW FUNCTIONS"] : ["SHOW EXTERNAL FUNCTIONS"]
      if (pattern) parts.push("LIKE", `'${pattern}'`)
      parts.push("LIMIT", String(limit))
      query = parts.join(" ")
    }
    // Tables with type filter
    else if (objectTypeNormalized === "TABLES" && tableTypeFilters && Object.keys(tableTypeFilters).length > 0) {
      const conditions: string[] = []
      if (tableTypeFilters.is_view) conditions.push("is_view=true")
      if (tableTypeFilters.is_external) conditions.push("is_external=true")
      if (tableTypeFilters.is_dynamic) conditions.push("is_dynamic=true")
      if (tableTypeFilters.is_stream) conditions.push("is_stream=true")
      query = conditions.length > 0 ? `SHOW TABLES WHERE ${conditions.join(" OR ")}` : "SHOW TABLES"
      if (schemaName) { query += query.includes("WHERE") ? ` AND schema_name = '${schemaName}'` : ` IN SCHEMA ${schemaName}` }
      query += ` LIMIT ${limit}`
    }
    // Special table types (VIEWS, DYNAMIC_TABLES, etc.)
    else if (["TABLES", "VIEWS", "DYNAMIC_TABLES", "MATERIALIZED_VIEWS", "EXTERNAL_TABLES"].includes(objectTypeNormalized)) {
      let whereCondition: string
      if (objectTypeNormalized === "TABLES") whereCondition = "is_view=false AND is_dynamic=false AND is_materialized_view=false AND is_external=false"
      else if (objectTypeNormalized === "VIEWS") whereCondition = "is_view=true"
      else if (objectTypeNormalized === "DYNAMIC_TABLES") whereCondition = "is_dynamic=true"
      else if (objectTypeNormalized === "MATERIALIZED_VIEWS") whereCondition = "is_materialized_view=true"
      else if (objectTypeNormalized === "EXTERNAL_TABLES") whereCondition = "is_external=true"
      else whereCondition = "1=1"
      const parts = ["SHOW TABLES"]
      if (schemaName) parts.push("IN", schemaName)
      const whereClauses = [whereCondition]
      if (pattern) whereClauses.push(`table_name LIKE '${pattern}'`)
      parts.push("WHERE", whereClauses.join(" AND "))
      if (limit) parts.push("LIMIT", String(limit))
      query = parts.join(" ")
    }
    // Standard SHOW
    else {
      const parts = ["SHOW", objectTypeNormalized]
      if (schemaName && !NO_IN_SCHEMA_TYPES.has(objectTypeNormalized)) parts.push("IN", "SCHEMA", schemaName)
      if (pattern && ["USERS", "GRANTS", "EXTERNAL_SCHEMAS"].includes(objectTypeNormalized)) parts.push("LIKE", `'${pattern}'`)
      if (limit) parts.push("LIMIT", String(limit))
      query = parts.join(" ")
    }

    const [resultData] = await db.executeQuery(query + ";")
    const response: Record<string, unknown> = {
      result: resultData,
      result_count: resultData.length,
    }
    if (limit && resultData.length >= limit) {
      response["truncated"] = true
      response["hint"] = `结果已限制为前 ${limit} 个对象`
    }
    return response
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e), operation: "SHOW OBJECT LIST", suggestion: "请检查参数是否正确" }
  }
}

// ---------------------------------------------------------------------------
// handleExecuteSql — LH_execute_tools.py:18-85
// ---------------------------------------------------------------------------
async function handleExecuteSql(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const config = db.getConnectionInfo()
  const sql = args["sql"] as string | undefined
  if (!sql) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, result_set: "Missing required parameter: sql" }) }] }
  }

  try {
    const [rows] = await db.executeQuery(sql + ";")
    const resultSet = rows ?? []
    return { content: [{ type: "text", text: JSON.stringify({ success: true, result_set: resultSet }) }] }
  } catch (e) {
    const errorMsg = String(e)
    logger.error(`handle_execute_sql error: ${errorMsg}`)
    const analysis = SQLIntelligence.analyzeSqlError(errorMsg, sql)
    const errResponse: Record<string, unknown> = {
      success: false,
      error_type: analysis.error_type,
      friendly_message: analysis.friendly_message || errorMsg,
      suggestions: analysis.suggestions.slice(0, 3),
    }
    return { content: [{ type: "text", text: JSON.stringify(errResponse) }] }
  }
}

// ---------------------------------------------------------------------------
// registerAgentExecuteTools — agent_execute_query_tool()
// ---------------------------------------------------------------------------
export function registerAgentExecuteTools(registry: ToolRegistry, db: LakehouseDB): void {
  const tools: ToolDefinition[] = [
    {
      name: "LH_execute_query",
      description:
        "Execute SQL query on a specified datasource to verify SQL correctness. " +
        "This tool allows agents to execute SQL queries against a datasource. " +
        "If datasource_name is not provided, it will default to the workspace's Lakehouse datasource. " +
        "The tool returns query results in a structured format. " +
        "Compatible with most basic Spark SQL syntax. " +
        "CRITICAL: Use two-part qualified names (schema.table format).",
      inputSchema: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "SQL query statement to execute. MUST use two-part qualified names (schema.table).",
          },
          datasource_name: {
            type: "string",
            description: "Name of the datasource. Defaults to LAKEHOUSE_{workspace}.",
          },
        },
        required: ["sql"],
      },
      handler: (args) => handleExecuteSql(args, db),
      tags: ["agent", "query", "execute"],
      samples: [
        { description: "Execute a SELECT query", query: { sql: "SELECT * FROM public.my_table LIMIT 10" } },
      ],
    },
    {
      name: "LH_show_object_list_v2",
      description:
        "Lakehouse SDK low-level query tool that bypasses Studio to directly query the Lakehouse SQL engine.\n" +
        "Lists Lakehouse database objects without needing to construct SQL, avoiding query failures due to SQL " +
        "dialect issues. Supports intelligent filtering, statistical analysis, and filter suggestions.\n" +
        "Object Hierarchy: Instance → Workspace → Schema → Objects\n" +
        "Schema-level objects (TABLES, VIEWS, DYNAMIC TABLES, etc.) MUST specify in_schema.\n" +
        "Default Limits: FUNCTIONS(25), TABLES(20), SCHEMAS(20), maximum 100",
      inputSchema: {
        type: "object",
        properties: {
          object_type: {
            type: "string",
            enum: [
              "WORKSPACES", "TABLES", "VIEWS", "SCHEMAS", "CATALOGS", "FUNCTIONS",
              "EXTERNAL FUNCTIONS", "VOLUMES", "CONNECTIONS", "VCLUSTERS", "JOBS", "PIPES",
              "USERS", "ROLES", "GRANTS", "SHARES", "TABLE STREAMS", "DYNAMIC TABLES",
              "MATERIALIZED VIEWS", "EXTERNAL TABLES", "EXTERNAL SCHEMAS", "NETWORK POLICY",
            ],
            description: "Type of objects to list",
          },
          in_schema: { type: "string", description: "Schema name (REQUIRED for schema-level objects)" },
          like_pattern: { type: "string", description: "LIKE pattern for filtering (e.g., 'user%')" },
          where_condition: { type: "string", description: "WHERE clause for advanced filtering" },
          table_type_filters: {
            type: "object",
            properties: {
              is_view: { type: "boolean" }, is_external: { type: "boolean" },
              is_dynamic: { type: "boolean" }, is_stream: { type: "boolean" },
            },
          },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          smart_defaults: { type: "boolean", default: true },
        },
        required: ["object_type"],
      },
      handler: (args) => handleShowObjectListV2(args, db),
      tags: ["read"],
      samples: [
        { description: "List tables in public schema", query: { object_type: "TABLES", in_schema: "public" } },
        { description: "List all schemas", query: { object_type: "SCHEMAS" } },
      ],
    },
  ]

  registry.registerTools(tools)
}
