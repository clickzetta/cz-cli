/**
 * semantic-view-operations.ts — port of cz_mcp/query/semantic_view.py (lines 961-2159)
 * Operational functions for ClickZetta Semantic Views.
 */

import { logger } from "../logger.js"
import { convertDfToDict, ResponseBuilder } from "../common/utilities.js"
import type { McpContent } from "../common/utilities.js"
import type { LakehouseDB } from "../server.js"
import type { StudioConfig } from "../config/profile.js"
import {
  type CzSvDataModel,
  type CzSvDimension,
  type CzSvIdentifier,
  CzSvTableType,
  CzSemanticViewUtils,
  svSemanticViewToYaml,
  svSemanticViewCreationSql,
} from "./semantic-view-models.js"
import { SQLIntelligence } from "./sql-intelligence.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripQuotes(name: string): string {
  const quotes = ["'", '"', "`"]
  let s = name.trim()
  while (s.length > 0 && quotes.includes(s[0])) s = s.slice(1)
  while (s.length > 0 && quotes.includes(s[s.length - 1])) s = s.slice(0, -1)
  return s
}

function buildFullViewName(schema: string | undefined, viewName: string): string {
  return schema ? `${schema}.${viewName}` : viewName
}

function buildErrorMessage(analysis: { friendly_message: string; suggestions: string[] }, query: string, errorMsg: string): string {
  return (
    `❌ ${analysis.friendly_message || "Query failed"}\n\n` +
    `📝 SQL executed: ${query}\n` +
    `🔍 Original Error: ${errorMsg}\n\n` +
    `💡 Suggestions: ${analysis.suggestions.slice(0, 2).join("; ")}`
  )
}

// ─── 1. descSemanticView — semantic_view.py:961-1069 ─────────────────────────

export async function descSemanticView(
  args: Record<string, unknown>,
  db: LakehouseDB,
  studioConfig?: StudioConfig | null,
): Promise<Record<string, unknown>> {
  const schemaName = (args["schema_name"] as string | undefined) ?? studioConfig?.schema ?? db.connectionConfig?.schema ?? ""
  const semanticViewName = args["semantic_view_name"] as string | undefined
  const verbose = (args["verbose"] as boolean | undefined) ?? false

  if (!semanticViewName) throw new Error("semantic_view_name is required")

  const cleanName = stripQuotes(semanticViewName)
  const fullViewName = buildFullViewName(schemaName, cleanName)
  const query = `use ${schemaName}; set cz.sql.desc.format=json; DESC extended ${fullViewName};`
  logger.info({ fullViewName }, "descSemanticView")

  try {
    const [data] = await db.executeQuery(query)
    const resultDict = data ?? []

    let comment = ""
    for (const r of resultDict) {
      if (r["column_name"] === "comment" && r["data_type"]) comment = r["data_type"] as string
    }

    let responseData: Record<string, unknown> = { data: resultDict, count: resultDict.length }

    for (const r of resultDict) {
      if (r["column_name"] === "def" && r["data_type"]) {
        try {
          const czSvJson = JSON.parse(r["data_type"] as string) as CzSvDataModel
          const svObj = CzSemanticViewUtils.getSemanticView(czSvJson)
          svObj.comments = comment
          responseData = { yaml: svSemanticViewToYaml(svObj), count: resultDict.length }
        } catch (parseErr) {
          logger.info({ err: parseErr }, "Parse semantic view def failed, using raw result")
        }
        break
      }
    }

    if (verbose) {
      responseData["sql_query_executed"] = query
      responseData["parameter_details"] = { verbose_mode: true }
    }
    return responseData
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const analysis = SQLIntelligence.analyzeSqlError(msg, query)
    throw new Error(buildErrorMessage(analysis, query, msg))
  }
}

// ─── 2. createSemanticView — semantic_view.py:1072-1327 ──────────────────────

export async function createSemanticView(
  args: Record<string, unknown>,
  db: LakehouseDB,
  studioConfig?: StudioConfig | null,
): Promise<Record<string, unknown>> {
  const schemaName = (args["schema_name"] as string | undefined) ?? studioConfig?.schema ?? db.connectionConfig?.schema ?? ""
  const semanticViewYaml = (args["semantic_view_yaml"] as string | undefined) ?? ""
  let semanticViewName = (args["semantic_view_name"] as string | undefined) ?? ""
  const ifNotExists = (args["if_not_exists"] as boolean | undefined) ?? true
  const verbose = (args["verbose"] as boolean | undefined) ?? false

  if (!semanticViewYaml) throw new Error("semantic_view_yaml is required")

  let yamlDict: Record<string, unknown>
  try {
    const trimmed = semanticViewYaml.trim()
    yamlDict = trimmed.startsWith("{") ? JSON.parse(trimmed) : { _raw_yaml: trimmed }
  } catch (e) {
    throw new Error(`YAML parse failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (!yamlDict["name"] || semanticViewName) yamlDict["name"] = semanticViewName
  semanticViewName = (yamlDict["name"] as string) ?? ""
  if (!semanticViewName) throw new Error("Cannot determine semantic view name")

  const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : ""
  const sqlBody = yamlDict["_raw_yaml"] ? (yamlDict["_raw_yaml"] as string) : JSON.stringify(yamlDict, null, 2)
  const createSql = `USE ${schemaName}; CREATE SEMANTIC VIEW ${ifNotExistsClause}${semanticViewName} \n${sqlBody};`
  logger.info({ sql: createSql.slice(0, 200) }, "createSemanticView")

  try {
    const [data] = await db.executeQuery(createSql)
    const resultDict = data ?? []
    const responseData: Record<string, unknown> = {
      message: `Semantic view '${semanticViewName}' created successfully`,
      semantic_view_name: semanticViewName,
      result: resultDict,
    }
    if (verbose) {
      responseData["sql_query_executed"] = [createSql]
      responseData["creation_sql"] = createSql
    }
    return responseData
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const analysis = SQLIntelligence.analyzeSqlError(msg, createSql)
    throw new Error(buildErrorMessage(analysis, createSql, msg))
  }
}

// ─── 3. addDimensions — semantic_view.py:1351-1494 ───────────────────────────

export async function addDimensions(
  args: Record<string, unknown>,
  db: LakehouseDB,
  studioConfig?: StudioConfig | null,
): Promise<string> {
  const schemaName = (args["schema_name"] as string | undefined) ?? studioConfig?.schema ?? db.connectionConfig?.schema ?? ""
  const semanticViewName = stripQuotes((args["semantic_view_name"] as string) ?? "")
  const newDimensions = (args["new_dimensions"] as Record<string, unknown>[]) ?? []

  if (!semanticViewName) throw new Error("semantic_view_name is required")

  // Build CzSvDimension-like objects
  const newDimObjs: Record<string, unknown>[] = newDimensions.map((item) => ({
    name: {
      type: CzSvTableType.UNKNOWN,
      instanceId: "86",
      namespace: [item["logical_table"]],
      namespaceId: [],
      namespaceType: [],
      name: item["dimension_name"],
      id: "0",
      version: "",
    },
    expressionText: "",
    expressionExpandedText: `${item["logical_table"]}.${item["column_name"]}`,
    synonyms: item["synonyms"] ?? [],
    trait: null,
    comment: item["comment"] ?? "",
  }))

  const fullViewName = buildFullViewName(schemaName, semanticViewName)
  const query = `set cz.sql.desc.format=json; DESC extended ${fullViewName};`

  const [data] = await db.executeQuery(query)
  const resultDict = data ?? []

  let comment = ""
  let czSvJson: CzSvDataModel | null = null
  for (const r of resultDict) {
    if (r["column_name"] === "comment" && r["data_type"]) comment = r["data_type"] as string
    if (r["column_name"] === "def" && r["data_type"]) {
      czSvJson = JSON.parse(r["data_type"] as string) as CzSvDataModel
    }
  }

  if (!czSvJson) throw new Error("Could not retrieve semantic view definition")

  // Add new dimensions
  czSvJson.dimensions = [...czSvJson.dimensions, ...(newDimObjs as unknown as CzSvDimension[])]

  const svObj = CzSemanticViewUtils.getSemanticView(czSvJson)
  svObj.comments = comment
  return svSemanticViewCreationSql(svObj)
}

// ─── 4. removeDimensions — semantic_view.py:1494-1616 ────────────────────────

export async function removeDimensions(
  args: Record<string, unknown>,
  db: LakehouseDB,
  studioConfig?: StudioConfig | null,
): Promise<string> {
  const schemaName = (args["schema_name"] as string | undefined) ?? studioConfig?.schema ?? db.connectionConfig?.schema ?? ""
  const semanticViewName = stripQuotes((args["semantic_view_name"] as string) ?? "")
  const removeDims = (args["remove_dimensions"] as Record<string, unknown>[]) ?? []

  if (!semanticViewName) throw new Error("semantic_view_name is required")

  const fullViewName = buildFullViewName(schemaName, semanticViewName)
  const query = `set cz.sql.desc.format=json; DESC extended ${fullViewName};`

  const [data] = await db.executeQuery(query)
  const resultDict = data ?? []

  let comment = ""
  let czSvJson: CzSvDataModel | null = null
  for (const r of resultDict) {
    if (r["column_name"] === "comment" && r["data_type"]) comment = r["data_type"] as string
    if (r["column_name"] === "def" && r["data_type"]) {
      czSvJson = JSON.parse(r["data_type"] as string) as CzSvDataModel
    }
  }

  if (!czSvJson) throw new Error("Could not retrieve semantic view definition")

  // Filter out dimensions to remove
  const removeNames = new Set(removeDims.map((d) => d["dimension_name"] as string))
  czSvJson.dimensions = czSvJson.dimensions.filter((dim) => !removeNames.has(dim.name.name))

  const svObj = CzSemanticViewUtils.getSemanticView(czSvJson)
  svObj.comments = comment
  return svSemanticViewCreationSql(svObj)
}

// ─── 5. fuzzyQueryValue — semantic_view.py:1616-1748 ─────────────────────────

export async function fuzzyQueryValue(
  args: Record<string, unknown>,
  db: LakehouseDB,
  studioConfig?: StudioConfig | null,
): Promise<Record<string, unknown>> {
  const schemaName = (args["schema_name"] as string | undefined) ?? studioConfig?.schema ?? db.connectionConfig?.schema ?? ""
  const semanticViewName = stripQuotes((args["semantic_view_name"] as string) ?? "")
  const dimensions = (args["dimensions"] as Record<string, unknown>[]) ?? []
  const limit = (args["limit"] as number | undefined) ?? 100
  const verbose = (args["verbose"] as boolean | undefined) ?? false

  if (!schemaName || !semanticViewName) throw new Error("schema_name and semantic_view_name are required")
  if (!dimensions.length) throw new Error("dimensions must be a non-empty list")

  const fullViewName = `${schemaName}.${semanticViewName}`
  const dimensionValuesResult: Record<string, unknown>[] = []
  const executedSqls: string[] = []

  for (const dimInfo of dimensions) {
    const tableName = (dimInfo["table"] as string) ?? ""
    const dimensionName = (dimInfo["dimension"] as string) ?? ""
    if (!tableName || !dimensionName) continue

    const query = `SELECT DISTINCT ${tableName}.${dimensionName} AS dimension_value FROM ${fullViewName} WHERE ${tableName}.${dimensionName} IS NOT NULL LIMIT ${limit};`
    executedSqls.push(query)

    try {
      const [data] = await db.executeQuery(query)
      const values = (data ?? []).map((row) => row["dimension_value"]).filter((v) => v != null)
      dimensionValuesResult.push({ table: tableName, dimension: dimensionName, values, count: values.length })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      dimensionValuesResult.push({ table: tableName, dimension: dimensionName, error: msg, values: [], count: 0 })
    }
  }

  const responseData: Record<string, unknown> = {
    semantic_view_name: semanticViewName,
    schema_name: schemaName,
    dimension_values: dimensionValuesResult,
    total_dimensions_queried: dimensions.length,
    successful_queries: dimensionValuesResult.filter((d) => !("error" in d)).length,
  }
  if (verbose) responseData["sql_queries_executed"] = executedSqls
  return responseData
}

// ─── 6. getLogicalTableMeta — semantic_view.py:1748-1891 ─────────────────────

export async function getLogicalTableMeta(
  args: Record<string, unknown>,
  db: LakehouseDB,
  studioConfig?: StudioConfig | null,
): Promise<Record<string, unknown>> {
  const schemaName = (args["schema_name"] as string | undefined) ?? studioConfig?.schema ?? db.connectionConfig?.schema ?? ""
  const semanticViewName = stripQuotes((args["semantic_view_name"] as string) ?? "")
  const verbose = (args["verbose"] as boolean | undefined) ?? false

  if (!semanticViewName) throw new Error("semantic_view_name is required")

  const fullViewName = buildFullViewName(schemaName, semanticViewName)
  const query = `set cz.sql.desc.format=json; DESC extended ${fullViewName};`
  logger.info({ fullViewName }, "getLogicalTableMeta")

  try {
    const [data] = await db.executeQuery(query)
    const defItem = (data ?? []).find((item) => item["column_name"] === "def")
    if (!defItem || !defItem["data_type"]) throw new Error("No 'def' field found")

    const defDict = JSON.parse(defItem["data_type"] as string) as Record<string, unknown>
    const logicalTables = (defDict["logicalTables"] as Record<string, unknown>[]) ?? []

    const tablesStructured = logicalTables.map((table) => {
      const tableId = (table["tableIdentifier"] as Record<string, unknown>) ?? {}
      const ns = (tableId["namespace"] as string[]) ?? []
      const constraints = (table["constraints"] as Record<string, unknown>[]) ?? []

      const tableInfo: Record<string, unknown> = {
        logical_table: table["alias"],
        physical_table: tableId["name"],
        workspace: ns[0] ?? "",
        schema: ns[1] ?? "",
        table_comment: table["comment"],
        primary_key: { fields: [] as string[], enable: false, validate: false, rely: false },
        foreign_keys: [] as Record<string, unknown>[],
      }

      for (const c of constraints) {
        if ("primaryKey" in c) {
          const pk = c["primaryKey"] as Record<string, unknown>
          tableInfo["primary_key"] = {
            fields: ((pk["fields"] as Record<string, unknown>[]) ?? []).map((f) => f["fieldName"]),
            enable: pk["enable"], validate: pk["validate"], rely: pk["rely"],
          }
        }
      }

      const foreignKeys: Record<string, unknown>[] = []
      for (const c of constraints) {
        if ("foreignKey" in c) {
          const fk = c["foreignKey"] as Record<string, unknown>
          const refTable = (fk["refTable"] as Record<string, unknown>) ?? {}
          const refNs = (refTable["namespace"] as string[]) ?? []
          foreignKeys.push({
            current_table_field: ((fk["fields"] as Record<string, unknown>[]) ?? [])[0]?.["fieldName"] ?? "",
            ref_table_info: { workspace: refNs[0] ?? "", schema: refNs[1] ?? "", table_name: refTable["name"], table_alias: refTable["alias"] ?? refTable["name"] },
            ref_table_field: ((fk["refFields"] as Record<string, unknown>[]) ?? [])[0]?.["fieldName"] ?? "",
            fk_config: { enable: fk["enable"], validate: fk["validate"], rely: fk["rely"] },
          })
        }
      }
      tableInfo["foreign_keys"] = foreignKeys
      return tableInfo
    })

    const responseData: Record<string, unknown> = { logical_table_meta: tablesStructured }
    if (verbose) { responseData["sql_query_executed"] = query; responseData["parameter_details"] = { verbose_mode: true } }
    return responseData
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const analysis = SQLIntelligence.analyzeSqlError(msg, query)
    throw new Error(buildErrorMessage(analysis, query, msg))
  }
}

// ─── 7. extractSemanticAliasesFromResult — semantic_view.py:1891-1961 ────────

export interface SemanticAliases {
  logical_tables: Record<string, unknown>[]
  dimensions: Record<string, unknown>[]
  metrics: Record<string, unknown>[]
  filters: Record<string, unknown>[]
}

export function extractSemanticAliasesFromResult(resultDict: Record<string, unknown>[]): SemanticAliases {
  const defRow = resultDict.find((r) => r["column_name"] === "def")
  if (!defRow || !defRow["data_type"]) return { logical_tables: [], dimensions: [], metrics: [], filters: [] }

  let defJson: Record<string, unknown>
  try { defJson = JSON.parse(defRow["data_type"] as string) } catch { return { logical_tables: [], dimensions: [], metrics: [], filters: [] } }

  const dimensions = ((defJson["dimensions"] as Record<string, unknown>[]) ?? []).map((dim) => {
    const dName = (dim["name"] as Record<string, unknown>) ?? {}
    const dNs = (dName["namespace"] as string[]) ?? []
    return {
      dimension_name: dName["name"], logical_table: dNs[0] ?? "",
      alias: `${dNs[0] ?? ""}.${dName["name"]}`, physical_field: dim["expressionExpandedText"],
      synonyms: dim["synonyms"] ?? [], comment: dim["comment"] ?? "",
    }
  })

  const metrics = ((defJson["metrics"] as Record<string, unknown>[]) ?? []).map((m) => {
    const mName = (m["name"] as Record<string, unknown>) ?? {}
    const mNs = (mName["namespace"] as string[]) ?? []
    return {
      dimension_name: mName["name"], logical_table: mNs[0] ?? "",
      metrics: `${mNs[0] ?? ""}.${mName["name"]}`,
      expression: ((m["expressionExpandedText"] as string) ?? "").replace(/`/g, ""),
      synonyms: m["synonyms"] ?? [], comment: m["comment"] ?? "",
    }
  })

  const filters = ((defJson["filters"] as Record<string, unknown>[]) ?? []).map((f) => {
    const fName = (f["name"] as Record<string, unknown>) ?? {}
    const fNs = (fName["namespace"] as string[]) ?? []
    return {
      dimension_name: fName["name"], logical_table: fNs[0] ?? "",
      condition: ((f["expressionExpandedText"] as string) ?? "").replace(/`/g, ""),
      synonyms: f["synonyms"] ?? [], comment: f["comment"] ?? "",
    }
  })

  const logical_tables = ((defJson["logicalTables"] as Record<string, unknown>[]) ?? []).map((lt) => ({
    alias: lt["alias"] ?? "", comment: lt["comment"] ?? "", synonyms: lt["synonyms"] ?? [],
  }))

  return { logical_tables, dimensions, metrics, filters }
}

// ─── 8. getSemanticViewSimpleDesc — semantic_view.py:1964-2038 ───────────────

export async function getSemanticViewSimpleDesc(
  args: Record<string, unknown>,
  db: LakehouseDB,
  studioConfig?: StudioConfig | null,
): Promise<Record<string, unknown>> {
  const semanticViewName = (args["semantic_view_name"] as string) ?? ""
  const schemaName = (args["schema_name"] as string | undefined) ?? studioConfig?.schema ?? db.connectionConfig?.schema ?? ""

  if (!semanticViewName) throw new Error("semantic_view_name is required")

  const fullViewName = buildFullViewName(schemaName, semanticViewName)
  const query = `set cz.sql.desc.format=json; DESC extended ${fullViewName};`

  try {
    const [data] = await db.executeQuery(query)
    const resultDict = data ?? []
    const aliases = extractSemanticAliasesFromResult(resultDict)

    return {
      semantic_view_name: semanticViewName,
      schema_name: schemaName || "default",
      logical_tables: aliases.logical_tables,
      available_dimensions: aliases.dimensions,
      available_metrics: aliases.metrics,
      available_filters: aliases.filters,
      dimension_count: aliases.dimensions.length,
      metric_count: aliases.metrics.length,
      filter_count: aliases.filters.length,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const analysis = SQLIntelligence.analyzeSqlError(msg, query)
    throw new Error(buildErrorMessage(analysis, query, msg))
  }
}

// ─── 9. querySemanticValue — semantic_view.py:2041-2159 ──────────────────────

export async function querySemanticValue(
  args: Record<string, unknown>,
  db: LakehouseDB,
  studioConfig?: StudioConfig | null,
): Promise<Record<string, unknown>> {
  const schemaName = (args["schema_name"] as string | undefined) ?? studioConfig?.schema ?? db.connectionConfig?.schema ?? ""
  const semanticViewName = stripQuotes((args["semantic_view_name"] as string) ?? "")
  const selectedDimensions = (args["selected_dimensions"] as Record<string, unknown>[]) ?? []
  const selectedMetrics = (args["selected_metrics"] as Record<string, unknown>[]) ?? []
  const filterConditions = (args["filter_conditions"] as Record<string, unknown>[]) ?? []
  const verbose = (args["verbose"] as boolean | undefined) ?? true

  if (!semanticViewName) throw new Error("semantic_view_name is required")

  const fullViewName = buildFullViewName(schemaName, semanticViewName)

  // Build dimension clauses
  const dimensionClauses: string[] = []
  for (const d of selectedDimensions) {
    const t = ((d["logical_table"] as string) ?? "").trim()
    const n = ((d["dimensions_name"] as string) ?? "").trim()
    if (t && n) dimensionClauses.push(`DIMENSIONS ${t}.${n}`)
  }

  // Build metric clauses
  const metricClauses: string[] = []
  for (const m of selectedMetrics) {
    const t = ((m["logical_table"] as string) ?? "").trim()
    const n = ((m["metrics_name"] as string) ?? "").trim()
    if (t && n) metricClauses.push(`METRICS ${t}.${n}`)
  }

  const allClausesStr = [...dimensionClauses, ...metricClauses].join(", ")

  // Build filter clause
  let filterClause = ""
  if (filterConditions.length > 0) {
    const items: string[] = []
    for (const f of filterConditions) {
      const field = ((f["field_name"] as string) ?? "").trim()
      const expr = ((f["expr"] as string) ?? "").trim()
      if (field && expr) items.push(`${field} ${expr}`)
    }
    if (items.length > 0) filterClause = ` WHERE ${items.join(" AND ")}`
  }

  let query = `select * from semantic_view(${fullViewName}`
  if (allClausesStr) query += `, ${allClausesStr}`
  query += `)${filterClause};`

  logger.info({ query: query.slice(0, 200) }, "querySemanticValue")

  try {
    const [data] = await db.executeQuery(query)
    const responseData: Record<string, unknown> = { join_table_data: data }
    if (verbose) {
      responseData["sql_query_executed"] = query
      responseData["parameter_details"] = { verbose_mode: true, full_view_name: fullViewName, filter_conditions_applied: filterConditions }
    }
    return responseData
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to query semantic value: ${msg}\n📝 Executed SQL: ${query}`)
  }
}
