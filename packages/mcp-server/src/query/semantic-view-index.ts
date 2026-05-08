/**
 * semantic-view-index.ts — port of cz_mcp/query/semantic_view_index.py
 *
 * Manages semantic view related indexes:
 * - Scalar index for business data values
 * - Vector index for view metadata
 */

import { logger } from "../logger.js"
import { convertDfToDict, ResponseBuilder } from "../common/utilities.js"
import { SQLIntelligence } from "./sql-intelligence.js"
import type { McpContent } from "../common/utilities.js"
import type { LakehouseDB } from "../server.js"
import type { StudioConfig } from "../config/profile.js"

// ---------------------------------------------------------------------------
// SVIndexUtils
// ---------------------------------------------------------------------------

export function getValIndexTableName(semanticViewName: string, prefix = "SV_VAL_IDX_"): string {
  const segments = semanticViewName.split(".")
  if (segments.length) segments[segments.length - 1] = prefix + segments[segments.length - 1]
  return segments.join(".")
}

export function getMetaIndexTableName(semanticViewName: string, prefix = "SV_META_IDX_"): string {
  const segments = semanticViewName.split(".")
  if (segments.length) segments[segments.length - 1] = prefix + segments[segments.length - 1]
  return segments.join(".")
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function buildErrorDetail(friendlyMessage: string, query: string, errorMsg: string, suggestions: string[]): string {
  return (
    `❌ ${friendlyMessage}\n\n` +
    `📝 SQL executed: ${query}\n` +
    `🔍 Original Error: ${errorMsg}\n\n` +
    `💡 Suggestions: ${suggestions.slice(0, 2).join("; ")}`
  )
}

// ---------------------------------------------------------------------------
// Embedding placeholders (ML-specific — throw Not implemented)
// ---------------------------------------------------------------------------

export function getOpenaiEmbeddingClient(
  _openaiApiBase?: string,
  _openaiApiKey?: string,
  _openaiApiVersion?: string,
): unknown {
  throw new Error("Not implemented: getOpenaiEmbeddingClient requires ML dependencies")
}

export function getEmbedding(_text: string, _embeddingClient: unknown): number[] {
  throw new Error("Not implemented: getEmbedding requires ML dependencies")
}

export function batchGetEmbedding(_texts: string[], _embeddingClient: unknown): number[][] {
  throw new Error("Not implemented: batchGetEmbedding requires ML dependencies")
}

export function getValuesForVct(
  _key: string,
  _meta: string,
  _tags: string[],
  _embeddingClient: unknown,
): string {
  throw new Error("Not implemented: getValuesForVct requires ML dependencies")
}

// ---------------------------------------------------------------------------
// indexSemanticViewValues — builds scalar index for business data values
// ---------------------------------------------------------------------------

export async function indexSemanticViewValues(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const semanticViewName = arguments_["semantic_view_name"] as string
  const forceRefresh = Boolean(arguments_["force_refresh"] ?? false)
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const db = opts?.db!
  const vc = (arguments_["vc"] as string) ?? "DEFAULT"

  const indexTableName = getValIndexTableName(semanticViewName)
  let query = `set cz.sql.desc.format=json; use ${schemaName}; DESC extended ${semanticViewName};`

  let resultDict: Record<string, unknown>[]
  try {
    const [data] = await db.executeQuery(query)
    resultDict = data ? convertDfToDict(data) : []
  } catch (e) {
    const errorMsg = String(e)
    logger.error(`Query Semantic View failed: ${errorMsg}`)
    const analysis = SQLIntelligence.analyzeSqlError(errorMsg, query)
    throw new Error(buildErrorDetail(
      analysis.friendly_message || "Description of semantic view failed.", query, errorMsg, analysis.suggestions,
    ))
  }

  // Parse semantic view definition to extract dimensions (simplified)
  const selectStatementList: string[] = []
  try {
    let svDef: Record<string, unknown> | null = null
    for (const r of resultDict) {
      if (r["column_name"] === "def" && r["data_type"]) {
        svDef = JSON.parse(r["data_type"] as string)
        break
      }
    }
    if (svDef && Array.isArray(svDef["tables"])) {
      for (const table of svDef["tables"] as Record<string, unknown>[]) {
        const tableName = ((table["names"] as string[]) ?? [])[0] ?? ""
        const baseTable = table["base_table"] as Record<string, unknown> | undefined
        const physicalTableName = baseTable
          ? `${baseTable["database"]}.${baseTable["schema"]}.${baseTable["table"]}`
          : tableName
        for (const dim of (table["dimensions"] as Record<string, unknown>[]) ?? []) {
          const expr = ((dim["expr"] as string) ?? "").replace(tableName, physicalTableName)
          const tags = `'table:${tableName}', 'dimension:${dim["column_name"] ?? ""}'`
          selectStatementList.push(
            `select null, string(${expr}), null, null, array(${tags}) from ${physicalTableName}`,
          )
        }
      }
    }
  } catch (e) {
    logger.info(`Parse Semantic View definition failed: ${String(e)}. Falling back.`)
  }

  // Create dynamic table
  try {
    query = `use ${schemaName}; show tables`
    const [data] = await db.executeQuery(query)
    let tableExists = false
    if (data) {
      for (const r of data) {
        if (r["schema_name"] === schemaName && r["table_name"] === indexTableName) {
          tableExists = true
          break
        }
      }
    }

    if (tableExists && !forceRefresh) {
      throw new Error(`Index table ${indexTableName} already exists. Set force_refresh to true to refresh.`)
    }
    if (tableExists) {
      await db.executeQuery(`use ${schemaName}; DROP TABLE ${indexTableName};`)
    }

    const keyIndex = "scl_index_" + indexTableName
    const unionStr = selectStatementList.join(" UNION ")
    query = `use ${schemaName}; create dynamic table ${indexTableName}`
    query += ` (vct_key STRING, scl_key STRING, vct VECTOR(1536), meta STRING, tags ARRAY<STRING> )`
    query += ` REFRESH interval 10 MINUTE vcluster ${vc}`
    query += ` AS ${unionStr};`

    logger.info(`Scalar index table creating with query: ${query}`)
    await db.executeQuery(query)

    query = `use ${schemaName}; CREATE INVERTED INDEX ${keyIndex} ON TABLE ${indexTableName}(scl_key)`
    query += ` PROPERTIES('analyzer' = 'chinese', 'mode' = 'max_word', 'support_score' = 'true');`
    logger.info(`Inverted index creating with query: ${query}`)
    await db.executeQuery(query)
  } catch (e) {
    const errorMsg = String(e)
    logger.error(`Index Semantic View failed: ${errorMsg}`)
    const analysis = SQLIntelligence.analyzeSqlError(errorMsg, query)
    throw new Error(buildErrorDetail(
      analysis.friendly_message || "Index semantic view failed.", query, errorMsg, analysis.suggestions,
    ))
  }

  return ResponseBuilder.createYamlJsonResponse([{ data: resultDict, count: resultDict.length }], undefined, studioConfig)
}

// ---------------------------------------------------------------------------
// indexSemanticViewMeta — builds vector index for metadata
// ---------------------------------------------------------------------------

export async function indexSemanticViewMeta(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const semanticViewName = arguments_["semantic_view_name"] as string
  const forceRefresh = Boolean(arguments_["force_refresh"] ?? false)
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const db = opts?.db!

  const indexTableName = getMetaIndexTableName(semanticViewName)
  let query = `set cz.sql.desc.format=json; DESC extended ${schemaName}.${semanticViewName};`

  let resultDict: Record<string, unknown>[]
  try {
    const [data] = await db.executeQuery(query)
    resultDict = data ? convertDfToDict(data) : []
  } catch (e) {
    const errorMsg = String(e)
    logger.error(`Query Semantic View failed: ${errorMsg}`)
    const analysis = SQLIntelligence.analyzeSqlError(errorMsg, query)
    throw new Error(buildErrorDetail(
      analysis.friendly_message || "Description of semantic view failed.", query, errorMsg, analysis.suggestions,
    ))
  }

  // Create vector index table
  try {
    query = `use ${schemaName}; show tables`
    const [data] = await db.executeQuery(query)
    let tableExists = false
    if (data) {
      for (const r of data) {
        if (r["schema_name"] === schemaName && r["table_name"] === indexTableName) {
          tableExists = true
          break
        }
      }
    }

    if (tableExists && !forceRefresh) {
      throw new Error(`Index table ${indexTableName} already exists. Set force_refresh to true to refresh.`)
    }
    if (tableExists) {
      await db.executeQuery(`DROP TABLE ${indexTableName};`)
    }

    const keyIndex = "vct_index_" + indexTableName.split(".").pop()!
    query = `use ${schemaName}; create table ${indexTableName}`
    query += ` (vct_key STRING, scl_key STRING, vct VECTOR(1536), meta STRING, tags ARRAY<STRING>, INDEX ${keyIndex} (vct) USING VECTOR )`

    logger.info(`Vector index table creating with query: ${query}`)
    await db.executeQuery(query)

    // Embedding + insert (requires ML deps — placeholder)
    logger.info("Vector embedding and insertion requires ML dependencies (not implemented in TS port)")

  } catch (e) {
    const errorMsg = String(e)
    logger.error(`Index Semantic View failed: ${errorMsg}`)
    const analysis = SQLIntelligence.analyzeSqlError(errorMsg, query)
    throw new Error(buildErrorDetail(
      analysis.friendly_message || "Index semantic view failed.", query, errorMsg, analysis.suggestions,
    ))
  }

  return ResponseBuilder.createYamlJsonResponse([{ result: "SUCCESS", number_of_index: 0 }], undefined, studioConfig)
}

// ---------------------------------------------------------------------------
// checkSemanticViewStatus
// ---------------------------------------------------------------------------

export async function checkSemanticViewStatus(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const semanticViewName = arguments_["semantic_view_name"] as string
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const db = opts?.db!
  const indexValTableName = getValIndexTableName(semanticViewName)
  const indexMetaTableName = getMetaIndexTableName(semanticViewName)

  let query = `use ${schemaName}; show tables;`
  try {
    const [data, dataId] = await db.executeQuery(query)
    let metaIndexTableExists = false
    let valueIndexTableExists = false
    if (data) {
      for (const r of data) {
        if (r["schema_name"] === schemaName && r["table_name"] === indexMetaTableName) metaIndexTableExists = true
        if (r["schema_name"] === schemaName && r["table_name"] === indexValTableName) valueIndexTableExists = true
      }
    }
    return ResponseBuilder.createYamlJsonResponse([{
      result: "SUCCESS",
      semantic_view_exist: true,
      meta_index_table_exists: metaIndexTableExists,
      value_index_table_exists: valueIndexTableExists,
    }], dataId, studioConfig)
  } catch (e) {
    const errorMsg = String(e)
    logger.error(`Check Semantic View Status failed: ${errorMsg}`)
    const analysis = SQLIntelligence.analyzeSqlError(errorMsg, query)
    throw new Error(buildErrorDetail(
      analysis.friendly_message || "Check semantic view status failed.", query, errorMsg, analysis.suggestions,
    ))
  }
}

// ---------------------------------------------------------------------------
// dropSemanticViewIndex
// ---------------------------------------------------------------------------

export async function dropSemanticViewIndex(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const semanticViewName = arguments_["semantic_view_name"] as string
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const db = opts?.db!
  const indexValTableName = getValIndexTableName(semanticViewName)
  const indexMetaTableName = getMetaIndexTableName(semanticViewName)

  let query = ""
  try {
    query = `use ${schemaName}; drop dynamic table IF EXISTS ${indexValTableName};`
    await db.executeQuery(query)
    query = `use ${schemaName}; drop table IF EXISTS ${indexMetaTableName};`
    await db.executeQuery(query)
    const keyIndex = "scl_index_" + indexValTableName
    query = `use ${schemaName}; DROP INDEX IF EXISTS ${keyIndex}`
    await db.executeQuery(query)
    return ResponseBuilder.createYamlJsonResponse([{ result: "SUCCESS" }], undefined, studioConfig)
  } catch (e) {
    const errorMsg = String(e)
    logger.error(`Drop Semantic View Index failed: ${errorMsg}`)
    const analysis = SQLIntelligence.analyzeSqlError(errorMsg, query)
    throw new Error(buildErrorDetail(
      analysis.friendly_message || "Drop semantic view index failed.", query, errorMsg, analysis.suggestions,
    ))
  }
}

// ---------------------------------------------------------------------------
// querySemanticViewByText — vector similarity query
// ---------------------------------------------------------------------------

export async function querySemanticViewByText(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<Record<string, unknown>> {
  const semanticViewName = arguments_["semantic_view_name"] as string
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const db = opts?.db!
  const queryText = arguments_["query_text"] as string
  const topK = (arguments_["top_k"] as number) ?? 5

  const indexTableName = getMetaIndexTableName(semanticViewName)
  const fullTableName = `${schemaName}.${indexTableName}`

  logger.info(`Vector similarity query: table=${fullTableName}, text=${queryText}, top_k=${topK}`)

  // Generate embedding (requires ML deps)
  throw new Error("Not implemented: querySemanticViewByText requires ML dependencies for embedding generation")
}

// ---------------------------------------------------------------------------
// querySemanticViewValues — inverted index keyword search
// ---------------------------------------------------------------------------

export async function querySemanticViewValues(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const semanticViewName = arguments_["semantic_view_name"] as string
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const db = opts?.db!
  const queryText = arguments_["query_text"] as string
  const topK = (arguments_["top_k"] as number) ?? 10

  const indexTableName = getValIndexTableName(semanticViewName)
  const fullTableName = `${schemaName}.${indexTableName}`

  logger.info(`Inverted index search: table=${fullTableName}, keyword=${queryText}, top_k=${topK}`)

  const escapedQuery = `'${queryText.replace(/'/g, "''")}'`
  const query = `
    use ${schemaName};
    SELECT scl_key, meta, tags, score() AS score
    FROM ${indexTableName}
    WHERE MATCH_ANY(scl_key, ${escapedQuery}, map('analyzer' = 'chinese', 'mode' = 'max_word'))
    ORDER BY score DESC
    LIMIT ${topK};
  `

  logger.info(`Executing inverted index query SQL: ${query}`)
  try {
    const [data, dataId] = await db.executeQuery(query)
    const jsonResults = data && data.length > 0 ? JSON.stringify(data, null, 2) : "[]"
    return ResponseBuilder.createYamlJsonResponse([{ results: jsonResults, count: jsonResults.length }], dataId, studioConfig)
  } catch (e) {
    throw new Error(`倒排索引查询失败: ${String(e)}`)
  }
}

// ---------------------------------------------------------------------------
// generateSemanticSql — combines vector + inverted index to generate SQL
// ---------------------------------------------------------------------------

export async function generateSemanticSql(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const semanticViewName = arguments_["semantic_view_name"] as string
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const db = opts?.db!
  const queryText = arguments_["query_text"] as string
  const topKMeta = (arguments_["top_k_meta"] as number) ?? 5
  const topKValue = (arguments_["top_k_value"] as number) ?? 10

  logger.info(`Generating semantic SQL: view=${semanticViewName}, text=${queryText}`)

  try {
    // Call vector search for metadata
    const metaArgs = { semantic_view_name: semanticViewName, schema_name: schemaName, query_text: queryText, top_k: topKMeta }
    const metaResponse = await querySemanticViewByText(metaArgs, studioConfig, opts) as Record<string, unknown>

    // Call inverted index for values
    const valueArgs = { semantic_view_name: semanticViewName, schema_name: schemaName, query_text: queryText, top_k: topKValue }
    const valueResponse = await querySemanticViewValues(valueArgs, studioConfig, opts)

    // Parse meta results
    const metaResults = (metaResponse["results"] ?? []) as Record<string, unknown>[]

    // Parse value results
    let valueResults: Record<string, unknown>[] = []
    if (Array.isArray(valueResponse) && valueResponse.length > 0) {
      const content = (valueResponse[0] as unknown as Record<string, unknown>)["content"]
      if (Array.isArray(content) && content.length > 0) {
        const raw = (content[0] as Record<string, unknown>)["results"]
        if (typeof raw === "string") {
          try { valueResults = JSON.parse(raw) } catch { /* empty */ }
        } else if (Array.isArray(raw)) {
          valueResults = raw as Record<string, unknown>[]
        }
      }
    }

    logger.info(`Retrieval done: meta=${metaResults.length}, values=${valueResults.length}`)

    // Parse vector results into metrics and dimensions
    const metrics: { name: string; agg_func: string; score: number }[] = []
    const dimensionsMeta: { name: string; score: number }[] = []

    for (const item of metaResults) {
      const vctKey = (item["vct_key"] as string) ?? ""
      const tags = (item["tags"] as string[]) ?? []
      const score = (item["score"] as number) ?? 0

      for (const tag of tags) {
        if (tag.toLowerCase().includes("metric")) {
          metrics.push({ name: vctKey, agg_func: inferAggregationFunction(queryText), score })
          break
        } else if (tag.toLowerCase().includes("dimension")) {
          dimensionsMeta.push({ name: vctKey, score })
          break
        }
      }
    }

    // Parse inverted index results into dimension values
    const dimensionValues: Record<string, { value: string; score: number }[]> = {}
    const tables = new Set<string>()

    for (const item of valueResults) {
      const sclKey = (item["scl_key"] as string) ?? ""
      const tags = (item["tags"] as string[]) ?? []
      const score = (item["score"] as number) ?? 0

      let dimName: string | null = null
      let tableName: string | null = null

      for (const tag of tags) {
        if (tag.startsWith("dimension:")) dimName = tag.split(":", 2)[1]!
        else if (tag.startsWith("table:")) tableName = tag.split(":", 2)[1]!
      }

      if (dimName && sclKey) {
        if (!dimensionValues[dimName]) dimensionValues[dimName] = []
        dimensionValues[dimName]!.push({ value: sclKey, score })
      }
      if (tableName) tables.add(tableName)
    }

    // Build SQL
    let selectClause: string
    if (metrics.length === 0) {
      selectClause = "COUNT(*) AS total_count"
    } else {
      const top = metrics[0]!
      selectClause = `${top.agg_func}(${top.name}) AS result`
    }

    const fromClause = tables.size > 0 ? [...tables][0]! : `${schemaName}.${semanticViewName}`

    const whereConditions: string[] = []
    const dimensionsWithValues: { name: string; values: string[] }[] = []

    for (const [dimName, values] of Object.entries(dimensionValues)) {
      if (!values.length) continue
      const topValues = values.sort((a, b) => b.score - a.score).slice(0, 3)
      const valueList = topValues.map((v) => v.value)

      if (valueList.length === 1) {
        whereConditions.push(`${dimName} = '${escapeString(valueList[0]!)}'`)
      } else {
        const escaped = valueList.map((v) => `'${escapeString(v)}'`).join(", ")
        whereConditions.push(`${dimName} IN (${escaped})`)
      }
      dimensionsWithValues.push({ name: dimName, values: valueList })
    }

    const whereClause = whereConditions.length > 0 ? whereConditions.join(" AND ") : "1=1"
    const generatedSql = `SELECT ${selectClause} FROM ${fromClause} WHERE ${whereClause}`

    logger.info(`SQL generated: ${generatedSql}`)

    return ResponseBuilder.createYamlJsonResponse([{
      generated_sql: generatedSql,
      metrics,
      dimensions: dimensionsWithValues,
      tables: [...tables],
      query_text: queryText,
    }], undefined, studioConfig)
  } catch (e) {
    const errorMsg = String(e)
    logger.error(`SQL generation failed: ${errorMsg}`)
    throw new Error(`SQL 生成失败: ${errorMsg}`)
  }
}

// ---------------------------------------------------------------------------
// inferAggregationFunction — infer aggregation from query text
// ---------------------------------------------------------------------------

export function inferAggregationFunction(queryText: string): string {
  const lower = queryText.toLowerCase()
  if (["总和", "总额", "总金额", "求和", "sum", "合计"].some((kw) => lower.includes(kw))) return "SUM"
  if (["统计", "总数", "数量", "计数", "count", "多少个", "几个"].some((kw) => lower.includes(kw))) return "COUNT"
  if (["平均", "均值", "average", "avg", "平均值"].some((kw) => lower.includes(kw))) return "AVG"
  if (["最大", "最高", "max", "最多"].some((kw) => lower.includes(kw))) return "MAX"
  if (["最小", "最低", "min", "最少"].some((kw) => lower.includes(kw))) return "MIN"
  return "SUM"
}
