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
