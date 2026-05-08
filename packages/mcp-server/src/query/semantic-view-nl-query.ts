/**
 * semantic-view-nl-query.ts — port of cz_mcp/query/semantic_view_nl_query.py
 *
 * Natural language query handler for semantic views.
 */

import { logger } from "../logger.js"
import { convertDfToDict, ResponseBuilder } from "../common/utilities.js"
import { SQLIntelligence } from "./sql-intelligence.js"
import { parseSvQueryInput, svQueryToSql } from "./semantic-view-query.js"
import type { McpContent } from "../common/utilities.js"
import type { LakehouseDB } from "../server.js"
import type { StudioConfig } from "../config/profile.js"

export async function generateAndExecuteSemanticViewQuery(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const db = opts?.db
  const semanticViewName = arguments_["semantic_view_name"] as string | undefined
  const queryParamsInput = arguments_["query_params"] as string | Record<string, unknown> | undefined
  const verbose = Boolean(arguments_["verbose"] ?? false)

  if (!semanticViewName) {
    return ResponseBuilder.createErrorResponse(new Error("Missing semantic_view_name"), "generateAndExecuteSemanticViewQuery")
  }
  if (!queryParamsInput) {
    return ResponseBuilder.createErrorResponse(new Error("Missing query_params"), "generateAndExecuteSemanticViewQuery")
  }

  // Parse query params
  let queryParams: Record<string, unknown>
  if (typeof queryParamsInput === "string") {
    try {
      queryParams = JSON.parse(queryParamsInput) as Record<string, unknown>
    } catch (e) {
      return ResponseBuilder.createErrorResponse(new Error(`Invalid JSON in query_params: ${e}`), "generateAndExecuteSemanticViewQuery")
    }
  } else {
    queryParams = queryParamsInput
  }

  if (!queryParams["semantic_view"]) queryParams["semantic_view"] = semanticViewName

  logger.info(`Generating query for semantic view: ${semanticViewName}`)

  // Parse to SVQuery
  let sqlStr: string
  try {
    const svQuery = parseSvQueryInput(queryParams)
    sqlStr = svQueryToSql(svQuery)
  } catch (e) {
    return ResponseBuilder.createErrorResponse(new Error(`Failed to parse query parameters: ${e}`), "generateAndExecuteSemanticViewQuery")
  }

  // Prepend schema usage
  const fullSql = `use ${schemaName}; ${sqlStr}`
  logger.info(`Generated SQL: ${fullSql}`)

  try {
    const [data, dataId] = await db!.executeQuery(fullSql)
    const resultDict = data ? convertDfToDict(data) : []

    const responseData: Record<string, unknown> = {
      semantic_view: semanticViewName,
      query_params: queryParams,
      data: resultDict,
      count: resultDict.length,
    }
    if (verbose) {
      responseData["generated_sql"] = sqlStr
      responseData["data_id"] = dataId
    }
    return ResponseBuilder.createYamlJsonResponse([responseData], dataId, studioConfig)
  } catch (e) {
    const errorMsg = String(e)
    logger.error(`Query execution failed: ${errorMsg}`)
    const analysis = SQLIntelligence.analyzeSqlError(errorMsg, fullSql)
    const detailedError =
      `❌ ${analysis.friendly_message || "查询执行失败"}\n\n` +
      `📝 Generated SQL:\n${sqlStr}\n\n` +
      `🔍 Original Error: ${errorMsg}\n\n` +
      `💡 Suggestions:\n` + analysis.suggestions.slice(0, 3).map((s) => `  • ${s}`).join("\n")
    return ResponseBuilder.createErrorResponse(new Error(detailedError), "generateAndExecuteSemanticViewQuery")
  }
}

export async function answerQuestionWithSemanticView(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const semanticViewName = arguments_["semantic_view_name"] as string | undefined
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const userQuestion = (arguments_["user_question"] as string) ?? ""
  const verbose = Boolean(arguments_["verbose"] ?? false)

  logger.info(`Answering question for semantic view: ${semanticViewName}`)
  logger.info(`User question: ${userQuestion}`)

  if (!semanticViewName) {
    return ResponseBuilder.createErrorResponse(new Error("Missing semantic_view_name"), "answerQuestionWithSemanticView")
  }

  const queryParams: Record<string, unknown> = {
    semantic_view: semanticViewName,
    dimensions: arguments_["dimensions"] ?? [],
    metrics: arguments_["metrics"] ?? [],
    filters: arguments_["filters"] ?? [],
    order_by: arguments_["order_by"] ?? [],
    order_asc: arguments_["order_asc"] ?? true,
    limit: arguments_["limit"] ?? null,
  }

  return generateAndExecuteSemanticViewQuery(
    {
      schema_name: schemaName,
      semantic_view_name: semanticViewName,
      query_params: queryParams,
      verbose,
    },
    studioConfig,
    opts,
  )
}
