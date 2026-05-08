/**
 * basic-query.ts — port of cz_mcp/query/basic_query.py
 * Handles read_query and write_query operations.
 */

import { logger } from "../logger.js"
import { HandlerFactory } from "../handlers/parameter-handler.js"
import { convertDfToDict, ResponseBuilder } from "../common/utilities.js"
import { SQLIntelligence } from "./sql-intelligence.js"
import type { LakehouseDB } from "../server.js"
import type { StudioConfig } from "../config/profile.js"
import type { McpContent } from "../common/utilities.js"
import type { SQLWriteDetector } from "../sql-write-detector.js"

export async function handleReadQuery(
  arguments_?: Record<string, unknown> | null,
  studioConfig?: StudioConfig | null,
  opts?: { writeDetector?: SQLWriteDetector; db?: LakehouseDB },
): Promise<McpContent[]> {
  const params = HandlerFactory.readQuery().processArguments(arguments_)
  const query = params["query"] as string
  const queryUpper = query.toUpperCase().trim()
  const db = opts?.db
  const writeDetector = opts?.writeDetector

  // Check write operations
  if (writeDetector) {
    const analysis = writeDetector.analyzeQuery(query)
    if (analysis.contains_write) {
      return ResponseBuilder.createYamlJsonResponse([{
        success: false,
        error_type: "write_operation_not_allowed",
        friendly_message: "LH-execute_read_query 工具不支持写操作",
        operation_type: analysis.operation_type ?? "WRITE",
        suggestions: [
          `请使用 LH-execute_write_query 工具执行 ${analysis.operation_type ?? "WRITE"} 操作`,
          "LH-execute_write_query 专门用于处理 INSERT/UPDATE/DELETE/CREATE/DROP/ALTER 等写操作",
        ],
      }], undefined, studioConfig)
    }
  } else {
    const writeKeywords = ["INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "TRUNCATE"]
    const detected = writeKeywords.find((kw) => queryUpper.includes(kw))
    if (detected) {
      return ResponseBuilder.createYamlJsonResponse([{
        success: false,
        error_type: "write_operation_not_allowed",
        friendly_message: "LH-execute_read_query 工具不支持写操作",
        operation_type: detected,
        suggestions: [
          `请使用 LH-execute_write_query 工具执行 ${detected} 操作`,
          "LH-execute_write_query 专门用于处理 INSERT/UPDATE/DELETE/CREATE/DROP/ALTER 等写操作",
        ],
      }], undefined, studioConfig)
    }
  }

  let finalQuery = query
  if (queryUpper.startsWith("DESCRIBE ")) finalQuery = "DESC " + queryUpper.slice("DESCRIBE ".length)

  const limit = (params["limit"] as number | undefined) ?? 50
  const verbose = params["verbose"] as boolean | undefined

  // Check syntax conversion
  const suggestedQuery = convertUnsupportedShowCommands(finalQuery)
  const needsConversion = finalQuery !== suggestedQuery

  // Check LIMIT
  let needsLimit = false
  let limitSuggestion = finalQuery
  if (limit && !finalQuery.toLowerCase().includes("limit")) {
    const qu = finalQuery.toUpperCase().trim()
    if (qu.startsWith("SELECT") || (qu.startsWith("WITH") && qu.includes("SELECT"))) {
      needsLimit = true
      limitSuggestion = `${finalQuery.replace(/;$/, "")} LIMIT ${limit}`
    }
  }

  if (needsConversion || needsLimit) {
    const suggestions: string[] = []
    if (needsConversion) suggestions.push(`语法转换建议: ${suggestedQuery}`)
    if (needsLimit) suggestions.push(`LIMIT建议: ${limitSuggestion}`)
    return ResponseBuilder.createYamlJsonResponse([{
      success: false,
      query_needs_modification: true,
      suggestions,
      reason: "为了兼容ClickZetta语法或提高查询性能，建议修改查询语句",
      action: "请复制建议的SQL语句重新执行",
    }], undefined, studioConfig)
  }

  try {
    const [rows] = await db!.executeQuery(finalQuery + ";")
    const resultDict = rows ? convertDfToDict(rows) : []

    const responseData: Record<string, unknown> = {
      data: resultDict,
      count: resultDict.length,
      truncated: limit != null && resultDict.length >= limit,
      hint: limit && resultDict.length >= limit ? `Limited to ${limit} rows` : null,
    }
    if (verbose) {
      responseData["sql_query_executed"] = finalQuery
      responseData["parameter_details"] = { limit_applied: limit, verbose_mode: true }
    }
    return ResponseBuilder.createYamlJsonResponse([responseData], undefined, studioConfig)
  } catch (e) {
    const errorMsg = String(e)
    logger.error(`读查询执行失败: ${errorMsg}`)
    const analysis = SQLIntelligence.analyzeSqlError(errorMsg, finalQuery)
    return ResponseBuilder.createYamlJsonResponse([{
      error_type: "query_execution_failed",
      friendly_message: analysis.friendly_message || "查询执行失败",
      original_error: errorMsg,
      suggestions: analysis.suggestions.slice(0, 3),
      analysis: { no_auto_conversion: true, limit_applied: limit && finalQuery.includes("LIMIT") ? limit : null },
    }], undefined, studioConfig)
  }
}

export async function handleWriteQuery(
  arguments_?: Record<string, unknown> | null,
  studioConfig?: StudioConfig | null,
  opts?: { writeDetector?: SQLWriteDetector; db?: LakehouseDB },
): Promise<McpContent[]> {
  const params = HandlerFactory.writeQuery().processArguments(arguments_)
  const query = params["query"] as string
  const verbose = params["verbose"] as boolean | undefined
  const writeDetector = opts?.writeDetector!
  const db = opts?.db!

  const suggestedQuery = convertUnsupportedShowCommands(query)
  if (query !== suggestedQuery) {
    return ResponseBuilder.createYamlJsonResponse([{
      query_needs_modification: true,
      suggested_query: suggestedQuery,
      reason: "为了兼容ClickZetta语法，建议修改查询语句",
      action: "请复制建议的SQL语句重新执行",
    }], undefined, studioConfig)
  }

  const analysis = writeDetector.analyzeQuery(query)
  if (!analysis.contains_write) {
    logger.warn(`查询可能不包含写操作: ${query.slice(0, 100)}...`)
  }

  try {
    const [rows] = await db.executeQuery(query + ";")
    const resultDict = rows ? convertDfToDict(rows) : []
    const responseData: Record<string, unknown> = {
      message: "Write query executed successfully",
      affected_rows: resultDict.length,
      operation_type: analysis.operation_type ?? "UNKNOWN",
      result: resultDict.length ? resultDict : null,
    }
    if (verbose) {
      responseData["sql_query_executed"] = query
      responseData["write_analysis"] = analysis
    }
    return ResponseBuilder.createYamlJsonResponse([responseData], undefined, studioConfig)
  } catch (e) {
    const errorMsg = String(e)
    logger.error(`写查询执行失败: ${errorMsg}`)
    const analysisResult = SQLIntelligence.analyzeSqlError(errorMsg, query)
    return ResponseBuilder.createYamlJsonResponse([{
      success: false,
      error_type: "write_query_execution_failed",
      friendly_message: analysisResult.friendly_message || "写操作失败",
      original_error: errorMsg,
      suggestions: analysisResult.suggestions.slice(0, 3),
      write_analysis: analysis,
      operation_type: analysis.operation_type ?? "UNKNOWN",
    }], undefined, studioConfig)
  }
}

export function convertUnsupportedShowCommands(query: string): string {
  const stripped = query.trim().replace(/;$/, "")
  const upper = stripped.toUpperCase()

  if (upper === "SHOW DYNAMIC TABLES") return "SHOW TABLES WHERE is_dynamic = true"
  if (upper === "SHOW VIEWS") return "SHOW TABLES WHERE table_type = 'VIEW'"
  if (upper === "SHOW MATERIALIZED VIEWS") return "SHOW TABLES WHERE table_type = 'MATERIALIZED_VIEW'"
  if (upper === "SHOW DATABASES") return "SHOW CATALOGS"

  if (upper.startsWith("SHOW INDEXES ON ")) return `SHOW INDEX FROM ${stripped.slice("SHOW INDEXES ON ".length).trim()}`
  if (upper.startsWith("SHOW INDEXES IN ")) return `SHOW INDEX FROM ${stripped.slice("SHOW INDEXES IN ".length).trim()}`
  if (upper.startsWith("SHOW INDEXES FROM ")) return `SHOW INDEX FROM ${stripped.slice("SHOW INDEXES FROM ".length).trim()}`

  if (upper.startsWith("USE DATABASE ")) return `USE SCHEMA ${stripped.slice("USE DATABASE ".length).trim()}`

  if (upper.startsWith("EXPLAIN ANALYZE")) return `EXPLAIN ${stripped.slice("EXPLAIN ANALYZE".length).trim()}`

  if (upper.startsWith("SHOW TRIGGERS")) throw new Error("ClickZetta不支持SHOW TRIGGERS命令。")
  if (upper.startsWith("SHOW PROCEDURES")) throw new Error("ClickZetta不支持SHOW PROCEDURES命令。请使用SHOW FUNCTIONS查看函数信息。")
  if (upper.startsWith("SHOW ENGINES")) throw new Error("ClickZetta不支持SHOW ENGINES命令。")

  return query
}
