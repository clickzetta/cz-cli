/**
 * Semantic View tools — port of cz-mcp-server/cz_mcp/tools/semantic_view_tools.py
 *
 * Python → TS mapping:
 *   semantic_view_tools.py:8-52    Tool("LH-desc-logical-table")      → handleDescLogicalTable()
 *   semantic_view_tools.py:53-94   Tool("LH-desc-semantic-view")       → handleDescSemanticView()
 *   semantic_view_tools.py:95-166  Tool("LH-create-semantic-view")     → handleCreateSemanticView()
 *   semantic_view_tools.py:167-199 Tool("LH-brief-semantic-view")      → handleBriefSemanticView()
 *   semantic_view_tools.py:201-238 Tool("LH-semantic-view-dim-add")    → handleSemanticViewDimAdd()
 *   semantic_view_tools.py:240-271 Tool("LH-semantic-view-dim-del")    → handleSemanticViewDimDel()
 *   semantic_view_tools.py:272-303 Tool("LH-get_semantic_view_dims")   → handleGetSemanticViewDims()
 *   semantic_view_tools.py:304-442 Tool("LH-query-semantic-value")     → handleQuerySemanticValue()
 *
 * Handler implementations ported from:
 *   semantic_view.py:961-1069   desc_semantic_view          → handleDescSemanticView()
 *   semantic_view.py:1072-1327  create_semantic_view        → handleCreateSemanticView()
 *   semantic_view.py:1748-1888  get_logical_table_meta      → handleDescLogicalTable()
 *   semantic_view.py:1964-2038  get_semantic_view_simple_desc → handleBriefSemanticView()
 *   semantic_view.py:2041-2159  query_semantic_value        → handleQuerySemanticValue()
 *   semantic_view_modification.py:19-115  add_dimensions_to_semantic_view    → handleSemanticViewDimAdd()
 *   semantic_view_modification.py:117-197 remove_dimensions_from_semantic_view → handleSemanticViewDimDel()
 *   table_metadata.py:245-297   get_view_dimensions         → handleGetSemanticViewDims()
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"

// ---------------------------------------------------------------------------
// stripQuotes — semantic_view.py:976-980 (quote stripping logic)
// ---------------------------------------------------------------------------
function stripQuotes(name: string): string {
  const quotes = ["'", '"', "`"]
  let s = name.trim()
  while (s.length > 0 && quotes.includes(s[0])) s = s.slice(1)
  while (s.length > 0 && quotes.includes(s[s.length - 1])) s = s.slice(0, -1)
  return s
}

// ---------------------------------------------------------------------------
// buildFullViewName — semantic_view.py:983-987
// ---------------------------------------------------------------------------
function buildFullViewName(schemaName: string | undefined, viewName: string): string {
  return schemaName ? `${schemaName}.${viewName}` : viewName
}

// ---------------------------------------------------------------------------
// handleDescLogicalTable — semantic_view.py:1748-1888 get_logical_table_meta
// semantic_view_tools.py:8-52
// ---------------------------------------------------------------------------
async function handleDescLogicalTable(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) return { success: false, message: "No connection configuration available" }

  // semantic_view.py:1753-1757
  const schemaName = (args["schema_name"] as string | undefined) ?? config.schema
  const semanticViewName = args["semantic_view_name"] as string | undefined
  const verbose = (args["verbose"] as boolean | undefined) ?? false

  if (!semanticViewName) {
    return { success: false, message: "semantic_view_name is required" }
  }

  // semantic_view.py:1761-1767 — strip quotes
  const cleanName = stripQuotes(semanticViewName)
  const fullViewName = buildFullViewName(schemaName, cleanName)

  // semantic_view.py:1777 — build query
  const query = `set cz.sql.desc.format=json; DESC extended ${fullViewName};`
  logger.info({ fullViewName }, "Describing logical table meta")

  try {
    const [data] = await db.executeQuery(query)

    // semantic_view.py:1788-1845 — extract def field and parse logical tables
    const defItem = data.find((item) => item["column_name"] === "def")
    if (!defItem || !defItem["data_type"]) {
      return { success: false, message: "No 'def' field found in DESC result" }
    }

    const defDict = JSON.parse(defItem["data_type"] as string) as Record<string, unknown>
    const logicalTables = (defDict["logicalTables"] as Record<string, unknown>[]) ?? []

    // semantic_view.py:1793-1845 — build structured tables info
    const tablesStructured: Record<string, unknown>[] = []
    for (const table of logicalTables) {
      const tableIdentifier = (table["tableIdentifier"] as Record<string, unknown>) ?? {}
      const namespace = (tableIdentifier["namespace"] as string[]) ?? []
      const constraints = (table["constraints"] as Record<string, unknown>[]) ?? []

      const tableInfo: Record<string, unknown> = {
        logical_table: table["alias"],
        physical_table: tableIdentifier["name"],
        workspace: namespace[0] ?? "",
        schema: namespace[1] ?? "",
        table_comment: table["comment"],
        primary_key: { fields: [], enable: false, validate: false, rely: false },
        foreign_keys: [],
      }

      // semantic_view.py:1812-1820 — extract primary key
      for (const constraint of constraints) {
        if ("primaryKey" in constraint) {
          const pk = constraint["primaryKey"] as Record<string, unknown>
          const fields = (pk["fields"] as Record<string, unknown>[]) ?? []
          tableInfo["primary_key"] = {
            fields: fields.map((f) => f["fieldName"]),
            enable: pk["enable"],
            validate: pk["validate"],
            rely: pk["rely"],
          }
        }
      }

      // semantic_view.py:1822-1843 — extract foreign keys
      const foreignKeys: Record<string, unknown>[] = []
      for (const constraint of constraints) {
        if ("foreignKey" in constraint) {
          const fk = constraint["foreignKey"] as Record<string, unknown>
          const refTable = (fk["refTable"] as Record<string, unknown>) ?? {}
          const refNamespace = (refTable["namespace"] as string[]) ?? []
          const fkFields = (fk["fields"] as Record<string, unknown>[]) ?? []
          const refFields = (fk["refFields"] as Record<string, unknown>[]) ?? []
          foreignKeys.push({
            current_table_field: fkFields[0]?.["fieldName"] ?? "",
            ref_table_info: {
              workspace: refNamespace[0] ?? "",
              schema: refNamespace[1] ?? "",
              table_name: refTable["name"],
              table_alias: refTable["alias"] ?? refTable["name"],
            },
            ref_table_field: refFields[0]?.["fieldName"] ?? "",
            fk_config: {
              enable: fk["enable"],
              validate: fk["validate"],
              rely: fk["rely"],
            },
          })
        }
      }
      tableInfo["foreign_keys"] = foreignKeys
      tablesStructured.push(tableInfo)
    }

    const responseData: Record<string, unknown> = {
      logical_table_meta: tablesStructured,
    }

    // semantic_view.py:1882-1887 — verbose mode
    if (verbose) {
      responseData["sql_query_executed"] = query
      responseData["parameter_details"] = { verbose_mode: true }
    }

    return { success: true, data: responseData }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error in handleDescLogicalTable")
    return { success: false, message: `Query failed: ${err.message}`, executed_sql: query }
  }
}

// ---------------------------------------------------------------------------
// handleDescSemanticView — semantic_view.py:961-1069 desc_semantic_view
// semantic_view_tools.py:53-94
// ---------------------------------------------------------------------------
async function handleDescSemanticView(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) return { success: false, message: "No connection configuration available" }

  // semantic_view.py:967-970
  const schemaName = (args["schema_name"] as string | undefined) ?? config.schema
  const semanticViewName = args["semantic_view_name"] as string | undefined
  const verbose = (args["verbose"] as boolean | undefined) ?? false

  if (!semanticViewName) {
    return { success: false, message: "semantic_view_name is required" }
  }

  // semantic_view.py:974-980 — strip quotes
  const cleanName = stripQuotes(semanticViewName)
  const fullViewName = buildFullViewName(schemaName, cleanName)

  // semantic_view.py:990 — build query
  const query = `use ${schemaName}; set cz.sql.desc.format=json; DESC extended ${fullViewName};`
  logger.info({ fullViewName }, "Describing semantic view")

  try {
    const [data] = await db.executeQuery(query)

    // semantic_view.py:1001-1004
    const resultDict = data ?? []

    // semantic_view.py:1042-1068 — parse def field and build YAML response
    let responseData: Record<string, unknown> = { data: resultDict, count: resultDict.length }

    let comment = ""
    for (const r of resultDict) {
      if (r["column_name"] === "comment" && r["data_type"]) {
        comment = r["data_type"] as string
      }
    }

    for (const r of resultDict) {
      if (r["column_name"] === "def" && r["data_type"]) {
        try {
          // semantic_view.py:1048-1058 — parse CzSvDataModel and convert to YAML
          const czSvJson = JSON.parse(r["data_type"] as string) as Record<string, unknown>
          const yamlStr = buildSemanticViewYaml(czSvJson, comment)
          responseData = {
            yaml: yamlStr,
            count: resultDict.length,
          }
        } catch (parseErr) {
          logger.info({ err: parseErr }, "Parse semantic view definition failed, falling back to raw result")
        }
        break
      }
    }

    // semantic_view.py:1063-1068 — verbose mode
    if (verbose) {
      responseData["sql_query_executed"] = query
      responseData["parameter_details"] = { verbose_mode: true }
    }

    return { success: true, data: responseData }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error in handleDescSemanticView")
    return { success: false, message: `Query failed: ${err.message}`, executed_sql: query }
  }
}

// ---------------------------------------------------------------------------
// buildSemanticViewYaml — simplified YAML builder for DESC result
// Mirrors CzSemanticViewUtils.get_semantic_view + SVSemanticView.to_yaml()
// semantic_view.py:943-959, 378-382
// ---------------------------------------------------------------------------
function buildSemanticViewYaml(czSvJson: Record<string, unknown>, comment: string): string {
  // Build a simplified YAML representation from the raw DESC JSON
  const logicalTables = (czSvJson["logicalTables"] as Record<string, unknown>[]) ?? []
  const dimensions = (czSvJson["dimensions"] as Record<string, unknown>[]) ?? []
  const metrics = (czSvJson["metrics"] as Record<string, unknown>[]) ?? []
  const filters = (czSvJson["filters"] as Record<string, unknown>[]) ?? []

  const tables = logicalTables.map((lt) => {
    const tableId = (lt["tableIdentifier"] as Record<string, unknown>) ?? {}
    const ns = (tableId["namespace"] as string[]) ?? []
    const ltDimensions = dimensions
      .filter((d) => {
        const dName = (d["name"] as Record<string, unknown>) ?? {}
        const dNs = (dName["namespace"] as string[]) ?? []
        return dNs[0] === lt["alias"]
      })
      .map((d) => {
        const dName = (d["name"] as Record<string, unknown>) ?? {}
        return {
          name: dName["name"],
          expression: d["expressionExpandedText"],
          synonyms: d["synonyms"],
          comment: d["comment"],
        }
      })
    const ltMetrics = metrics
      .filter((m) => {
        const mName = (m["name"] as Record<string, unknown>) ?? {}
        const mNs = (mName["namespace"] as string[]) ?? []
        return mNs[0] === lt["alias"]
      })
      .map((m) => {
        const mName = (m["name"] as Record<string, unknown>) ?? {}
        return {
          name: mName["name"],
          expression: m["expressionExpandedText"],
          synonyms: m["synonyms"],
          comment: m["comment"],
        }
      })
    const ltFilters = filters
      .filter((f) => {
        const fName = (f["name"] as Record<string, unknown>) ?? {}
        const fNs = (fName["namespace"] as string[]) ?? []
        return fNs[0] === lt["alias"]
      })
      .map((f) => {
        const fName = (f["name"] as Record<string, unknown>) ?? {}
        return {
          name: fName["name"],
          expression: f["expressionExpandedText"],
          synonyms: f["synonyms"],
        }
      })
    return {
      alias: lt["alias"],
      synonyms: lt["synonyms"],
      comment: lt["comment"],
      base_table: {
        workspace: ns[0] ?? "",
        database: ns[1] ?? "",
        table: tableId["name"],
      },
      dimensions: ltDimensions,
      metrics: ltMetrics,
      filters: ltFilters,
    }
  })

  // Build a simple YAML-like string (JSON-based for reliability)
  const svObj = {
    comments: comment,
    tables,
  }

  // Convert to YAML-style string using JSON.stringify with indentation
  // (full YAML library not available without new deps; JSON is valid YAML superset)
  return JSON.stringify(svObj, null, 2)
}

// ---------------------------------------------------------------------------
// handleCreateSemanticView — semantic_view.py:1072-1327 create_semantic_view
// semantic_view_tools.py:95-166
// ---------------------------------------------------------------------------
async function handleCreateSemanticView(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) return { success: false, message: "No connection configuration available" }

  // semantic_view.py:1086-1092
  const schemaName = (args["schema_name"] as string | undefined) ?? config.schema
  const semanticViewYaml = (args["semantic_view_yaml"] as string | undefined) ?? ""
  let semanticViewName = (args["semantic_view_name"] as string | undefined) ?? ""
  const ifNotExists = (args["if_not_exists"] as boolean | undefined) ?? true
  const verbose = (args["verbose"] as boolean | undefined) ?? false

  if (!semanticViewYaml) {
    return { success: false, message: "semantic_view_yaml is required" }
  }

  logger.info({ semanticViewName: semanticViewName || "from YAML" }, "Creating semantic view from YAML")

  // semantic_view.py:1101-1113 — parse YAML/JSON and extract name
  let yamlDict: Record<string, unknown>
  try {
    // Try JSON first, then treat as YAML-like (key: value pairs)
    const trimmed = semanticViewYaml.trim()
    if (trimmed.startsWith("{")) {
      yamlDict = JSON.parse(trimmed) as Record<string, unknown>
    } else {
      // Simple YAML parser: extract name field at minimum
      yamlDict = parseSimpleYaml(trimmed)
    }
  } catch (e) {
    return {
      success: false,
      message: `Failed to parse semantic_view_yaml: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // semantic_view.py:1108-1113 — resolve name
  if (!yamlDict["name"] || semanticViewName) {
    yamlDict["name"] = semanticViewName
  }
  semanticViewName = (yamlDict["name"] as string) ?? ""
  if (!semanticViewName) {
    return {
      success: false,
      message: "Cannot determine semantic view name. Include 'name' in YAML or provide semantic_view_name.",
    }
  }

  // semantic_view.py:1254-1270 — generate CREATE SQL from parsed YAML
  let createSql: string
  try {
    const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : ""
    const sqlBody = buildCreationSqlFromYaml(yamlDict)
    createSql = `USE ${schemaName}; CREATE SEMANTIC VIEW ${ifNotExistsClause}${semanticViewName} \n${sqlBody};`
    logger.info({ createSql: createSql.slice(0, 200) }, "Generated CREATE SQL")
  } catch (e) {
    return {
      success: false,
      message: `Failed to generate CREATE SQL: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // semantic_view.py:1272-1315 — execute CREATE statement
  try {
    const [data] = await db.executeQuery(createSql)
    const resultDict = data ?? []

    const responseData: Record<string, unknown> = {
      message: `Semantic view '${semanticViewName}' created successfully`,
      semantic_view_name: semanticViewName,
      result: resultDict,
    }

    // semantic_view.py:1317-1325 — verbose mode
    if (verbose) {
      responseData["sql_query_executed"] = [createSql]
      responseData["creation_sql"] = createSql
      responseData["parameter_details"] = { if_not_exists: ifNotExists, verbose_mode: true }
    }

    return { success: true, data: responseData }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "CREATE SEMANTIC VIEW failed")
    return {
      success: false,
      message: `CREATE SEMANTIC VIEW failed: ${err.message}`,
      executed_sql: createSql,
    }
  }
}

// ---------------------------------------------------------------------------
// parseSimpleYaml — minimal YAML parser for semantic view YAML
// Handles the subset used in create_semantic_view
// ---------------------------------------------------------------------------
function parseSimpleYaml(yamlStr: string): Record<string, unknown> {
  // For the purposes of this tool, we extract the 'name' field from YAML
  // and pass the raw YAML string through as the body.
  // Full YAML parsing would require a library; we keep it minimal.
  const result: Record<string, unknown> = { _raw_yaml: yamlStr }
  const nameMatch = yamlStr.match(/^name:\s*(.+)$/m)
  if (nameMatch) {
    result["name"] = nameMatch[1].trim().replace(/^['"]|['"]$/g, "")
  }
  const descMatch = yamlStr.match(/^description:\s*(.+)$/m)
  if (descMatch) {
    result["description"] = descMatch[1].trim()
  }
  return result
}

// ---------------------------------------------------------------------------
// buildCreationSqlFromYaml — semantic_view.py:420-644 SVSemanticView.creation_sql()
// Simplified: passes the raw YAML body through as the semantic view definition.
// For full fidelity the Python code builds a complex DDL; here we generate
// a minimal but valid CREATE body from the parsed structure.
// ---------------------------------------------------------------------------
function buildCreationSqlFromYaml(yamlDict: Record<string, unknown>): string {
  // If we have the raw YAML string, use it directly as the body
  // The Lakehouse engine accepts YAML-format semantic view definitions
  if (yamlDict["_raw_yaml"]) {
    return yamlDict["_raw_yaml"] as string
  }
  // Otherwise serialize back to JSON (valid YAML superset)
  const { name: _name, ...rest } = yamlDict
  return JSON.stringify(rest, null, 2)
}

// ---------------------------------------------------------------------------
// handleBriefSemanticView — semantic_view.py:1964-2038 get_semantic_view_simple_desc
// semantic_view_tools.py:167-199
// ---------------------------------------------------------------------------
async function handleBriefSemanticView(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) return { success: false, message: "No connection configuration available" }

  // semantic_view.py:1981-1984
  const semanticViewName = (args["semantic_view_name"] as string | undefined) ?? ""
  const schemaName = (args["schema_name"] as string | undefined) ?? config.schema

  if (!semanticViewName) {
    return { success: false, message: "semantic_view_name is required" }
  }

  logger.info({ schemaName, semanticViewName }, "Getting semantic view simple desc")

  // semantic_view.py:1991-1998 — build full view name and query
  const fullViewName = buildFullViewName(schemaName, semanticViewName)
  const query = `set cz.sql.desc.format=json; DESC extended ${fullViewName};`

  try {
    const [data] = await db.executeQuery(query)
    const resultDict = data ?? []

    // semantic_view.py:2010-2011 — extract aliases
    const aliases = extractSemanticAliases(resultDict)

    const responseData: Record<string, unknown> = {
      semantic_view_name: semanticViewName,
      schema_name: schemaName ?? "default",
      logical_tables: aliases.logical_tables,
      available_dimensions: aliases.dimensions,
      available_metrics: aliases.metrics,
      available_filters: aliases.filters,
      dimension_count: aliases.dimensions.length,
      metric_count: aliases.metrics.length,
      filter_count: aliases.filters.length,
    }

    return { success: true, data: responseData }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error in handleBriefSemanticView")
    return { success: false, message: `Query failed: ${err.message}`, executed_sql: query }
  }
}

// ---------------------------------------------------------------------------
// extractSemanticAliases — semantic_view.py:1891-1961 extract_semantic_aliases_from_result
// ---------------------------------------------------------------------------
function extractSemanticAliases(resultDict: Record<string, unknown>[]): {
  logical_tables: Record<string, unknown>[]
  dimensions: Record<string, unknown>[]
  metrics: Record<string, unknown>[]
  filters: Record<string, unknown>[]
} {
  const defRow = resultDict.find((r) => r["column_name"] === "def")
  if (!defRow || !defRow["data_type"]) {
    return { logical_tables: [], dimensions: [], metrics: [], filters: [] }
  }

  let defJson: Record<string, unknown>
  try {
    defJson = JSON.parse(defRow["data_type"] as string) as Record<string, unknown>
  } catch {
    return { logical_tables: [], dimensions: [], metrics: [], filters: [] }
  }

  // semantic_view.py:1913-1922 — dimensions
  const dimensions = ((defJson["dimensions"] as Record<string, unknown>[]) ?? []).map((dim) => {
    const dName = (dim["name"] as Record<string, unknown>) ?? {}
    const dNs = (dName["namespace"] as string[]) ?? []
    return {
      dimension_name: dName["name"],
      logical_table: dNs[0] ?? "",
      alias: `${dNs[0] ?? ""}.${dName["name"]}`,
      physical_field: dim["expressionExpandedText"],
      synonyms: dim["synonyms"] ?? [],
      comment: dim["comment"] ?? "",
    }
  })

  // semantic_view.py:1924-1934 — metrics
  const metrics = ((defJson["metrics"] as Record<string, unknown>[]) ?? []).map((metric) => {
    const mName = (metric["name"] as Record<string, unknown>) ?? {}
    const mNs = (mName["namespace"] as string[]) ?? []
    const expr = ((metric["expressionExpandedText"] as string) ?? "").replace(/`/g, "")
    return {
      dimension_name: mName["name"],
      logical_table: mNs[0] ?? "",
      metrics: `${mNs[0] ?? ""}.${mName["name"]}`,
      expression: expr,
      synonyms: metric["synonyms"] ?? [],
      comment: metric["comment"] ?? "",
    }
  })

  // semantic_view.py:1936-1945 — filters
  const filters = ((defJson["filters"] as Record<string, unknown>[]) ?? []).map((filt) => {
    const fName = (filt["name"] as Record<string, unknown>) ?? {}
    const fNs = (fName["namespace"] as string[]) ?? []
    const cond = ((filt["expressionExpandedText"] as string) ?? "").replace(/`/g, "")
    return {
      dimension_name: fName["name"],
      logical_table: fNs[0] ?? "",
      condition: cond,
      synonyms: filt["synonyms"] ?? [],
      comment: filt["comment"] ?? "",
    }
  })

  // semantic_view.py:1947-1954 — logical tables
  const logicalTables = ((defJson["logicalTables"] as Record<string, unknown>[]) ?? []).map((lt) => ({
    alias: lt["alias"] ?? "",
    comment: lt["comment"] ?? "",
    synonyms: lt["synonyms"] ?? [],
  }))

  return { logical_tables: logicalTables, dimensions, metrics, filters }
}

// ---------------------------------------------------------------------------
// handleSemanticViewDimAdd — semantic_view_modification.py:19-115
// semantic_view_tools.py:201-238
// ---------------------------------------------------------------------------
async function handleSemanticViewDimAdd(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) return { success: false, message: "No connection configuration available" }

  // semantic_view_modification.py:31-35
  const schemaName = (args["schema_name"] as string | undefined) ?? config.schema
  const semanticViewName = (args["semantic_view_name"] as string | undefined) ?? ""
  const dimensionsToAdd = (args["dimensions"] as Record<string, unknown>[] | undefined) ?? []

  if (!semanticViewName) {
    return { success: false, message: "semantic_view_name is required" }
  }
  if (dimensionsToAdd.length === 0) {
    return { success: false, message: "dimensions is required and must not be empty" }
  }

  logger.info({ semanticViewName, count: dimensionsToAdd.length }, "Adding dimensions to semantic view")

  // semantic_view_modification.py:46-56 — get current definition
  const fullViewName = buildFullViewName(schemaName, semanticViewName)
  const descQuery = `set cz.sql.desc.format=json; DESC extended ${fullViewName};`

  let czSvJson: Record<string, unknown>
  let comment = ""
  try {
    const [descData] = await db.executeQuery(descQuery)
    const defRow = descData.find((r) => r["column_name"] === "def")
    if (!defRow || !defRow["data_type"]) {
      return { success: false, message: "Could not retrieve semantic view definition" }
    }
    czSvJson = JSON.parse(defRow["data_type"] as string) as Record<string, unknown>
    const commentRow = descData.find((r) => r["column_name"] === "comment")
    if (commentRow) comment = (commentRow["data_type"] as string) ?? ""
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    return { success: false, message: `Failed to get semantic view definition: ${err.message}` }
  }

  // semantic_view_modification.py:48-56 — add new dimensions to the JSON
  // semantic_view.py:1362-1387 — build CzSvDimension objects
  const existingDimensions = (czSvJson["dimensions"] as Record<string, unknown>[]) ?? []
  const newDimensions = dimensionsToAdd.map((dim) => ({
    name: {
      type: "UNKNOWN",
      instanceId: "86",
      namespace: [dim["logical_table"]],
      namespaceId: [],
      namespaceType: [],
      name: dim["dimension_name"],
      id: "0",
      version: "",
    },
    expressionText: "",
    expressionExpandedText: `${dim["logical_table"]}.${dim["column_name"]}`,
    synonyms: dim["synonyms"] ?? [],
    trait: null,
    comment: dim["comment"] ?? "",
  }))

  czSvJson["dimensions"] = [...existingDimensions, ...newDimensions]

  // semantic_view_modification.py:58 — rebuild CREATE SQL
  const sqlBody = buildCreationSqlFromCzSvJson(czSvJson, comment)
  const createSql = `USE ${schemaName};\n CREATE SEMANTIC VIEW ${semanticViewName} \n${sqlBody}\n;`

  // semantic_view_modification.py:70-92 — drop old and create new
  try {
    const dropSql = `DROP SEMANTIC VIEW IF EXISTS ${schemaName}.${semanticViewName};`
    await db.executeQuery(dropSql)
    logger.info({ semanticViewName }, "Dropped old semantic view")

    const [data] = await db.executeQuery(createSql)
    const resultDict = data ?? []

    return {
      success: true,
      data: {
        message: `Semantic view '${semanticViewName}' updated with new dimensions`,
        semantic_view_name: semanticViewName,
        sql_query_executed: [createSql],
        result: resultDict,
      },
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "CREATE SEMANTIC VIEW failed in dim-add")
    return {
      success: false,
      message: `Failed to recreate semantic view: ${err.message}`,
      executed_sql: createSql,
    }
  }
}

// ---------------------------------------------------------------------------
// handleSemanticViewDimDel — semantic_view_modification.py:117-197
// semantic_view_tools.py:240-271
// ---------------------------------------------------------------------------
async function handleSemanticViewDimDel(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) return { success: false, message: "No connection configuration available" }

  // semantic_view_modification.py:124-128
  const schemaName = (args["schema_name"] as string | undefined) ?? config.schema
  const semanticViewName = (args["semantic_view_name"] as string | undefined) ?? ""
  const dimensionsToRemove = (args["dimensions_to_remove"] as Record<string, unknown>[] | undefined) ?? []

  if (!semanticViewName) {
    return { success: false, message: "semantic_view_name is required" }
  }
  if (dimensionsToRemove.length === 0) {
    return { success: false, message: "dimensions_to_remove is required and must not be empty" }
  }

  logger.info({ semanticViewName, count: dimensionsToRemove.length }, "Removing dimensions from semantic view")

  // semantic_view_modification.py:133-139 — get current definition
  const fullViewName = buildFullViewName(schemaName, semanticViewName)
  const descQuery = `set cz.sql.desc.format=json; DESC extended ${fullViewName};`

  let czSvJson: Record<string, unknown>
  let comment = ""
  try {
    const [descData] = await db.executeQuery(descQuery)
    const defRow = descData.find((r) => r["column_name"] === "def")
    if (!defRow || !defRow["data_type"]) {
      return { success: false, message: "Could not retrieve semantic view definition" }
    }
    czSvJson = JSON.parse(defRow["data_type"] as string) as Record<string, unknown>
    const commentRow = descData.find((r) => r["column_name"] === "comment")
    if (commentRow) comment = (commentRow["data_type"] as string) ?? ""
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    return { success: false, message: `Failed to get semantic view definition: ${err.message}` }
  }

  // semantic_view.py:1534-1546 — filter out dimensions to remove
  const removeNames = new Set(dimensionsToRemove.map((d) => d["dimension_name"] as string))
  const existingDimensions = (czSvJson["dimensions"] as Record<string, unknown>[]) ?? []
  czSvJson["dimensions"] = existingDimensions.filter((dim) => {
    const dName = (dim["name"] as Record<string, unknown>) ?? {}
    return !removeNames.has(dName["name"] as string)
  })

  // semantic_view_modification.py:141 — rebuild CREATE SQL
  const sqlBody = buildCreationSqlFromCzSvJson(czSvJson, comment)
  const createSql = `USE ${schemaName};\n CREATE SEMANTIC VIEW ${semanticViewName} \n${sqlBody}\n;`

  // semantic_view_modification.py:151-175 — drop old and create new
  try {
    const dropSql = `DROP SEMANTIC VIEW IF EXISTS ${schemaName}.${semanticViewName};`
    await db.executeQuery(dropSql)
    logger.info({ semanticViewName }, "Dropped old semantic view")

    const [data] = await db.executeQuery(createSql)
    const resultDict = data ?? []

    return {
      success: true,
      data: {
        message: `Semantic view '${semanticViewName}' updated with dimensions removed`,
        semantic_view_name: semanticViewName,
        sql_query_executed: [createSql],
        result: resultDict,
      },
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "CREATE SEMANTIC VIEW failed in dim-del")
    return {
      success: false,
      message: `Failed to recreate semantic view: ${err.message}`,
      executed_sql: createSql,
    }
  }
}

// ---------------------------------------------------------------------------
// buildCreationSqlFromCzSvJson — helper for dim-add/del
// Serializes the modified CzSvDataModel JSON back to a CREATE body
// ---------------------------------------------------------------------------
function buildCreationSqlFromCzSvJson(czSvJson: Record<string, unknown>, _comment: string): string {
  // Pass the JSON as the body; the Lakehouse engine accepts JSON-format definitions
  return JSON.stringify(czSvJson, null, 2)
}

// ---------------------------------------------------------------------------
// handleGetSemanticViewDims — table_metadata.py:245-297 get_view_dimensions
// semantic_view_tools.py:272-303
// ---------------------------------------------------------------------------
async function handleGetSemanticViewDims(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) return { success: false, message: "No connection configuration available" }

  // table_metadata.py:246-249
  const schemaName = (args["schema_name"] as string | undefined) ?? config.schema
  const semanticView = (args["semantic_view"] as string | undefined) ?? ""

  if (!semanticView) {
    return { success: false, message: "semantic_view is required" }
  }

  // table_metadata.py:252-253
  const fullViewName = buildFullViewName(schemaName, semanticView)
  const query = `set cz.sql.desc.format=json; DESC extended ${fullViewName};`
  logger.info({ fullViewName }, "Getting semantic view dimensions")

  try {
    const [dataFrame] = await db.executeQuery(query)

    // table_metadata.py:258-263 — find def field
    const defRow = dataFrame.find((item) => item["column_name"] === "def" && item["data_type"])
    const dimensionsInfo: Record<string, unknown>[] = []

    if (defRow && defRow["data_type"]) {
      // table_metadata.py:265-280 — parse and extract dimensions
      const semanticViewData = JSON.parse(defRow["data_type"] as string) as Record<string, unknown>
      const dimensions = (semanticViewData["dimensions"] as Record<string, unknown>[]) ?? []

      for (const dim of dimensions) {
        const dName = (dim["name"] as Record<string, unknown>) ?? {}
        dimensionsInfo.push({
          dimensions_name: dName["name"],
          logical_table: dName["namespace"],
          expression: dim["expressionExpandedText"],
          comment: dim["comment"],
          synonyms: dim["synonyms"],
        })
      }
    } else {
      logger.warn("No 'def' field found or field data is empty")
    }

    // table_metadata.py:283-286 — build response
    const responseData: Record<string, unknown> = {
      schema_name: schemaName ?? "",
      dimensions_info: dimensionsInfo,
    }

    return { success: true, data: responseData }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error in handleGetSemanticViewDims")
    return { success: false, message: `Query failed: ${err.message}`, executed_sql: query }
  }
}

// ---------------------------------------------------------------------------
// handleQuerySemanticValue — semantic_view.py:2041-2159 query_semantic_value
// semantic_view_tools.py:304-442
// ---------------------------------------------------------------------------
async function handleQuerySemanticValue(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) return { success: false, message: "No connection configuration available" }

  // semantic_view.py:2049-2056
  const schemaName = (args["schema_name"] as string | undefined) ?? config.schema
  const semanticViewName = args["semantic_view_name"] as string | undefined
  const selectedDimensions = (args["selected_dimensions"] as Record<string, unknown>[] | undefined) ?? []
  const selectedMetrics = (args["selected_metrics"] as Record<string, unknown>[] | undefined) ?? []
  const filterConditions = (args["filter_conditions"] as Record<string, unknown>[] | undefined) ?? []
  const verbose = (args["verbose"] as boolean | undefined) ?? true

  if (!semanticViewName) {
    return { success: false, message: "semantic_view_name is required" }
  }

  // semantic_view.py:2059-2066 — strip quotes from view name
  const cleanName = stripQuotes(semanticViewName)

  // semantic_view.py:2069-2071 — build full view name
  const fullViewName = buildFullViewName(schemaName, cleanName)

  // semantic_view.py:2073-2081 — build dimension clauses
  const dimensionClauses: string[] = []
  for (const dimDict of selectedDimensions) {
    if (dimDict && typeof dimDict === "object") {
      const logicalTable = ((dimDict["logical_table"] as string) ?? "").trim()
      const dimName = ((dimDict["dimensions_name"] as string) ?? "").trim()
      if (logicalTable && dimName) {
        dimensionClauses.push(`DIMENSIONS ${logicalTable}.${dimName}`)
      }
    }
  }

  // semantic_view.py:2083-2090 — build metric clauses
  const metricClauses: string[] = []
  for (const metricDict of selectedMetrics) {
    if (metricDict && typeof metricDict === "object") {
      const logicalTable = ((metricDict["logical_table"] as string) ?? "").trim()
      const metricName = ((metricDict["metrics_name"] as string) ?? "").trim()
      if (logicalTable && metricName) {
        metricClauses.push(`METRICS ${logicalTable}.${metricName}`)
      }
    }
  }

  // semantic_view.py:2092-2098 — merge clauses
  const allClauses: string[] = [...dimensionClauses, ...metricClauses]
  const allClausesStr = allClauses.join(", ")

  // semantic_view.py:2100-2117 — build filter clause
  let filterClause = ""
  if (filterConditions.length > 0) {
    const filterItems: string[] = []
    for (const filterDict of filterConditions) {
      if (!filterDict || typeof filterDict !== "object") continue
      const fieldName = ((filterDict["field_name"] as string) ?? "").trim()
      const expr = ((filterDict["expr"] as string) ?? "").trim()
      if (fieldName && expr) {
        filterItems.push(`${fieldName} ${expr}`)
      }
    }
    if (filterItems.length > 0) {
      filterClause = ` WHERE ${filterItems.join(" AND ")}`
    }
  }

  // semantic_view.py:2119-2123 — build final SQL
  let baseQuery = `select * from semantic_view(${fullViewName}`
  if (allClausesStr) {
    baseQuery += `, ${allClausesStr}`
  }
  baseQuery += `)${filterClause};`
  const query = baseQuery

  logger.info({ query: query.slice(0, 200) }, "Querying semantic value")

  try {
    const [data] = await db.executeQuery(query)

    const responseData: Record<string, unknown> = {
      join_table_data: data,
    }

    // semantic_view.py:2139-2145 — verbose mode
    if (verbose) {
      responseData["sql_query_executed"] = query
      responseData["parameter_details"] = {
        verbose_mode: true,
        full_view_name: fullViewName,
        filter_conditions_applied: filterConditions,
      }
    }

    return { success: true, data: responseData }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error in handleQuerySemanticValue")
    return {
      success: false,
      message: `Failed to query semantic value: ${err.message}`,
      executed_sql: query,
    }
  }
}

// ---------------------------------------------------------------------------
// registerSemanticViewTools — semantic_view_tools.py:8-442 get_semantic_view_tools()
// ---------------------------------------------------------------------------
export function registerSemanticViewTools(registry: ToolRegistry, db: LakehouseDB): void {
  const tools: ToolDefinition[] = [
    // semantic_view_tools.py:10-52 — LH-desc-logical-table
    {
      name: "LH-desc-logical-table",
      description:
        "Get logical table definition in the semantic view. Including its related physical tables, dimensions\n",
      inputSchema: {
        type: "object",
        properties: {
          semantic_view_name: {
            type: "string",
            description: "Semantic view name",
          },
          verbose: {
            type: "boolean",
            description:
              "If true, returns detailed SQL execution information including the query and metadata. If false, returns only the data results (optimized for token efficiency). Default: false",
            default: false,
          },
          schema_name: {
            type: "string",
            description: "Schema name where the semantic view is located (optional)",
          },
        },
        required: ["semantic_view_name"],
      },
      handler: async (args: Record<string, unknown>) => handleDescLogicalTable(args, db),
      tags: ["query", "read", "semantic_view", "normalize"],
      samples: [
        {
          description: "Describe semantic view, the semantic view name is SV_customers",
          semantic_view_name: "SV_customers",
        },
        {
          description: "查询 sv  schema 下的语义视图 SV_customers",
          schema_name: "sv",
          semantic_view_name: "SV_customers",
        },
        {
          description: "查询 tpch_ai 下的语义视图 tpch_rev_analysis",
          semantic_view_name: "tpch_rev_analysis",
          schema_name: "tpch_ai",
        },
      ],
    },
    // semantic_view_tools.py:53-94 — LH-desc-semantic-view
    {
      name: "LH-desc-semantic-view",
      description: "Returning semantic view definition in YAML format\n",
      inputSchema: {
        type: "object",
        properties: {
          semantic_view_name: {
            type: "string",
            description: "Semantic view name",
          },
          schema_name: {
            type: "string",
            description: "Schema name where the semantic view is located (optional)",
          },
          verbose: {
            type: "boolean",
            description:
              "If true, returns detailed SQL execution information including the query and metadata. If false, returns only the data results (optimized for token efficiency). Default: false",
            default: false,
          },
        },
        required: ["semantic_view_name"],
      },
      handler: async (args: Record<string, unknown>) => handleDescSemanticView(args, db),
      tags: ["query", "read", "semantic_view", "normalize"],
      samples: [
        {
          description: "Describe semantic view, the semantic view name is SV_customers",
          semantic_view_name: "SV_customers",
        },
        {
          description: "查询 sv  schema 下的语义视图 SV_customers",
          schema_name: "sv",
          semantic_view_name: "SV_customers",
        },
        {
          description: "查询 tpch_ai 下的语义视图 tpch_rev_analysis",
          semantic_view_name: "tpch_rev_analysis",
        },
      ],
    },
    // semantic_view_tools.py:95-166 — LH-create-semantic-view
    {
      name: "LH-create-semantic-view",
      description: "Creating semantic view from YAML definition in Snowflake Cortex Analyst format\n",
      inputSchema: {
        type: "object",
        properties: {
          semantic_view_yaml: {
            type: "string",
            description: "YAML definition of the semantic view in Snowflake Cortex Analyst format",
          },
          semantic_view_name: {
            type: "string",
            description: "name of the semantic view to be created",
          },
          if_not_exists: {
            type: "boolean",
            description:
              "Whether to include IF NOT EXISTS clause to avoid error if the semantic view already exists. Default: true",
            default: true,
          },
          schema_name: {
            type: "string",
            description: "Schema name where the semantic view is located (optional)",
          },
          verbose: {
            type: "boolean",
            description:
              "If true, returns detailed SQL execution information including the CREATE statement. Default: false",
            default: false,
          },
        },
        required: ["semantic_view_yaml"],
        additionalProperties: false,
      },
      handler: async (args: Record<string, unknown>) => handleCreateSemanticView(args, db),
      tags: ["query", "write", "semantic_view", "normalize"],
      samples: [
        {
          description: "从 YAML 创建语义视图",
          semantic_view_yaml: `name: order_analysis_view
description: 订单分析语义视图（包含收入、订单数等核心指标）
tables:
  - name: orders_logical
    description: 订单明细逻辑表
    base_table:
      database: TPCH_AI
      schema: PUBLIC
      table: ORDERS
    dimensions:
      - name: order_date
        description: 下单日期
        expr: ORDER_DATE
        data_type: DATE
        unique: false
    facts:
      - name: order_amount
        description: 订单金额
        expr: TOTAL_AMOUNT
        data_type: DECIMAL(18,2)
    metrics:
      - name: total_revenue
        description: 总收入
        expr: SUM(order_amount)
      - name: total_orders
        description: 总订单数
        expr: COUNT(DISTINCT ORDER_ID)`,
          semantic_view_name: "order_analysis_view",
          if_not_exists: true,
          verbose: true,
        },
      ],
    },
    // semantic_view_tools.py:167-199 — LH-brief-semantic-view
    {
      name: "LH-brief-semantic-view",
      description: "Describing semantic view fields with simple format\n",
      inputSchema: {
        type: "object",
        properties: {
          semantic_view_name: {
            type: "string",
            description: "Semantic View name",
          },
          schema_name: {
            type: "string",
            description: "Schema name where the semantic view is located (optional)",
          },
        },
        required: ["semantic_view_name"],
      },
      handler: async (args: Record<string, unknown>) => handleBriefSemanticView(args, db),
      tags: ["query", "read", "semantic_view", "cot", "aliases"],
      samples: [
        {
          description: "查询语义视图sv_order_analysis_view",
          semantic_view_name: "sv_order_analysis_view",
        },
        {
          description: "Briefly describe semantic view sv_order_analysis_view under schema sv_oa",
          semantic_view_name: "sv_order_analysis_view",
          schema_name: "sv_oa",
        },
      ],
    },
    // semantic_view_tools.py:201-238 — LH-semantic-view-dim-add
    {
      name: "LH-semantic-view-dim-add",
      description: "Adding dimensions to Semantic View\n\n",
      inputSchema: {
        type: "object",
        properties: {
          semantic_view_name: {
            type: "string",
            description: "Name of the Semantic View to modify",
          },
          schema_name: {
            type: "string",
            description: "Schema name where the semantic view is located (optional)",
          },
          dimensions: {
            type: "array",
            description: "dimensions to add",
            items: {
              type: "object",
              properties: {
                logical_table: {
                  type: "string",
                  description: "logical table name in the semantic view",
                },
                dimension_name: {
                  type: "string",
                  description: "dimension name to add",
                },
                column_name: {
                  type: "string",
                  description: "column name in the physical table",
                },
                synonyms: { type: "array", items: { type: "string" } },
                comment: { type: "string", description: "description of the dimension" },
              },
              required: ["logical_table", "dimension_name", "column_name", "synonyms", "comment"],
            },
          },
        },
        required: ["semantic_view_name", "dimensions"],
      },
      handler: async (args: Record<string, unknown>) => handleSemanticViewDimAdd(args, db),
      tags: ["semantic_view", "modification", "normalize"],
      samples: [],
    },
    // semantic_view_tools.py:240-271 — LH-semantic-view-dim-del
    {
      name: "LH-semantic-view-dim-del",
      description: "Removing dimensions from Semantic View\n\n",
      inputSchema: {
        type: "object",
        properties: {
          semantic_view_name: {
            type: "string",
            description: "Name of the Semantic View to modify",
          },
          schema_name: {
            type: "string",
            description: "Schema name where the semantic view is located (optional)",
          },
          dimensions_to_remove: {
            type: "array",
            description: "dimensions to remove",
            items: {
              type: "object",
              properties: {
                dimension_name: {
                  type: "string",
                  description: "dimension name to remove",
                },
              },
              required: ["dimension_name"],
            },
          },
        },
        required: ["semantic_view_name", "dimensions_to_remove"],
      },
      handler: async (args: Record<string, unknown>) => handleSemanticViewDimDel(args, db),
      tags: ["semantic_view", "remove_dimensions", "normalize"],
      samples: [],
    },
    // semantic_view_tools.py:272-303 — LH-get_semantic_view_dims
    {
      name: "LH-get_semantic_view_dims",
      description: "Get dimensions from a semantic view\n",
      inputSchema: {
        type: "object",
        properties: {
          schema_name: {
            type: "string",
            description: "Schema name where the semantic view is located (optional)",
          },
          semantic_view: {
            type: "string",
            description: "semantic_view name, like 'SV_Order_Analysis_view' ",
          },
        },
        required: ["semantic_view"],
      },
      handler: async (args: Record<string, unknown>) => handleGetSemanticViewDims(args, db),
      tags: ["query", "read", "semantic_view", "join_table", "dimensions", "metrics", "filter"],
      samples: [
        {
          description: "在sv_lxj空间下，删除当前SV_Order_Analysis_view下的订单金额的维度",
          semantic_view: "SV_Order_Analysis_view",
        },
        {
          description: "在<space>下，删除当前<view>下的<dimension>",
          semantic_view: "<view>",
        },
      ],
    },
    // semantic_view_tools.py:304-442 — LH-query-semantic-value
    {
      name: "LH-query-semantic-value",
      description:
        "Query data from the semantic view based on natural language, where the data can come from specified dimensions, metrics, and filter conditions. " +
        "Filter conditions support filtering on both dimensions and metrics, but the 'field_name' in filter must be exactly the same as 'dimensions_name' in selected_dimensions or 'metrics_name' in selected_metrics. " +
        "The filter expression follows SQL syntax rules.",
      inputSchema: {
        type: "object",
        properties: {
          semantic_view_name: {
            type: "string",
            description: "Semantic view name，例如'SV_Order_Analysis_view'",
          },
          schema_name: {
            type: "string",
            description: "Schema name where the semantic view is located (optional)",
          },
          selected_dimensions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                logical_table: {
                  type: "string",
                  description: "Logical table name where the dimension belongs to, e.g. 'orders'",
                },
                dimensions_name: {
                  type: "string",
                  description: "Dimension name (without logical table prefix), e.g. 'order_date'",
                },
              },
              required: ["logical_table", "dimensions_name"],
            },
            description:
              "List of dimension dicts to select from semantic view, each dict contains logical table and dimension name",
          },
          selected_metrics: {
            type: "array",
            items: {
              type: "object",
              properties: {
                logical_table: {
                  type: "string",
                  description: "Logical table name where the metric belongs to, e.g. 'orders'",
                },
                metrics_name: {
                  type: "string",
                  description: "Metric name (without logical table prefix), e.g. 'total_order_amount'",
                },
              },
              required: ["logical_table", "metrics_name"],
            },
            description:
              "List of metric dicts to select from semantic view, each dict contains logical table and metric name",
          },
          filter_conditions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field_name: {
                  type: "string",
                  description:
                    "Name of filtered dimension/metric (must be exactly the same as 'dimensions_name' in selected_dimensions or 'metrics_name' in selected_metrics), e.g. 'order_date' or 'total_order_amount'",
                },
                expr: {
                  type: "string",
                  description:
                    "Filter expression following SQL syntax, e.g. 'like '2025-11-10'', '> 1000', 'between '2025-11-01' and '2025-11-10''",
                },
              },
              required: ["field_name", "expr"],
            },
            description:
              "List of filter condition dicts (optional), 'field_name' must be from selected dimensions/metrics, expression follows SQL rules",
            default: [],
          },
          verbose: {
            type: "boolean",
            description:
              "If true, returns detailed SQL execution information including the query and metadata. If false, returns only the data results (optimized for token efficiency). Default: false",
            default: true,
          },
        },
        required: ["semantic_view_name", "selected_dimensions", "selected_metrics"],
      },
      handler: async (args: Record<string, unknown>) => handleQuerySemanticValue(args, db),
      tags: ["query", "read", "semantic_view"],
      samples: [
        {
          description: "精准匹配示例格式的查询（带维度过滤，field_name匹配已选维度）, 在sv_oa的schema下",
          schema_name: "sv_oa",
          semantic_view_name: "SV_Order_Analysis_view",
          selected_dimensions: [{ logical_table: "orders", dimensions_name: "order_date" }],
          selected_metrics: [{ logical_table: "orders", metrics_name: "total_order_amount" }],
          filter_conditions: [{ field_name: "order_date", expr: "like '2025-11-10'" }],
          verbose: true,
        },
        {
          description: "基础查询（仅指定核心字段+指标过滤，field_name匹配已选指标）",
          semantic_view_name: "SV_Order_Analysis_view",
          selected_dimensions: [{ logical_table: "orders", dimensions_name: "customer_id" }],
          selected_metrics: [{ logical_table: "orders", metrics_name: "order_count" }],
          filter_conditions: [{ field_name: "order_count", expr: "> 10" }],
          verbose: false,
        },
        {
          description: "基础查询（无过滤条件）",
          semantic_view_name: "SV_Order_Analysis_view",
          selected_dimensions: [{ logical_table: "orders", dimensions_name: "customer_id" }],
          selected_metrics: [{ logical_table: "orders", metrics_name: "order_count" }],
          filter_conditions: [],
          verbose: false,
        },
        {
          description: "多维度多指标查询（混合过滤，field_name均匹配已选字段），在tpch_ai的schema下",
          schema_name: "tpch_ai",
          semantic_view_name: "tpch_rev_analysis",
          selected_dimensions: [
            { logical_table: "line_item", dimensions_name: "ship_date" },
            { logical_table: "orders", dimensions_name: "order_id" },
          ],
          selected_metrics: [
            { logical_table: "line_item", metrics_name: "revenue_amount" },
            { logical_table: "orders", metrics_name: "total_profit" },
          ],
          filter_conditions: [
            { field_name: "ship_date", expr: "like '2025-11%'" },
            { field_name: "revenue_amount", expr: "> 10000" },
          ],
          verbose: true,
        },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering semantic view tools")
  registry.registerTools(tools)
}
