/**
 * Optimize tools — port of cz-mcp-server/cz_mcp/tools/optimize_tools.py
 *
 * Python → TS mapping:
 *   optimize_tools.py:16-43   get_job_plan_url            → apiGetJobPlanUrl (studio-api.ts)
 *   optimize_tools.py:46-71   get_job_profile             → apiGetJobProfile (studio-api.ts)
 *   optimize_tools.py:74-118  _build_ai_review_prompt     → buildAiReviewPrompt()
 *   optimize_tools.py:121-301 handle_job_performance_analysis → handleJobPerformanceAnalysis()
 *   optimize_tools.py:304-354 job_performance_analysis_tool() → (tool definition in registerOptimizeTools)
 *   optimize_tools.py:357-361 get_optimize_tools()        → registerOptimizeTools()
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import type { StudioConfig } from "../config/profile.js"
import { apiGetJobPlanUrl, apiGetJobProfile } from "./studio-api.js"

// ---------------------------------------------------------------------------
// _build_ai_review_prompt — optimize_tools.py:74-118
// ---------------------------------------------------------------------------
function buildAiReviewPrompt(analysisMode: string): string {
  const basePrompt = (
    "你是 Clickzetta 增量计算性能专家。以下是规则引擎的分析结果。\n\n" +
    "请你做以下分析：\n\n" +
    "1. **因果关联分析**：检查 findings 之间是否有因果关系。\n" +
    "   常见因果链：\n" +
    "   - DATA_SKEW → STAGE_SPILLING → RESOURCE_INEFFICIENCY\n" +
    "   - SINGLE_DOP_AGG → BOTTLENECK_ANALYSIS(SINGLE_OP_DOMINANT)\n" +
    "   - TABLESINK_DOP(DOP被调小) → RESOURCE_INEFFICIENCY\n" +
    "   如果发现因果链，指出根因和影响链。\n\n" +
    "2. **优先级建议**：如果有多个 recommendations，基于以下原则重新排序：\n" +
    "   - 根因问题的参数优先于症状问题的参数\n" +
    "   - 影响范围大的参数优先（影响多个 stage）\n" +
    "   - confidence=high 的优先于 medium/low\n" +
    "   给出'如果只能改一个参数，建议先改哪个'的建议。\n\n" +
    "3. **补充洞察**：检查 analysis_scope 中是否有被 findings 遗漏的重要信息。\n" +
    "   特别关注：\n" +
    "   - confidence=medium/low 的 findings，是否有额外证据支持或否定\n" +
    "   - 多个 stage 出现相似问题时，是否有共同根因\n" +
    "   - insights 中 level=detail 的信息，是否有值得提升为 important 的\n\n" +
    "4. **stage_summary 全局审视**：检查 stage_summary 中每个 stage 的关键指标，\n" +
    "   发现规则引擎可能遗漏的问题。特别关注：\n" +
    "   - effective_spill_bytes 较高但没有对应 STAGE_SPILLING finding 的 stage\n" +
    "   - task_skew.skew_ratio 较高但没有 DATA_SKEW finding 的 stage\n" +
    "   - top_operators 中 stage_pct 极高（>80%）的单一算子瓶颈\n" +
    "   - 多个 stage 的 dop 远低于 vc_cores，可能存在全局资源竞争\n\n" +
    "5. **风险提示**：对于 recommendations 中的参数建议，是否有潜在风险或副作用。\n"
  )

  if (analysisMode === "expert") {
    const expertPrompt = (
      "\n\n--- 专家分析额外要求 ---\n\n" +
      "6. **规则盲区检查**：基于你对 Clickzetta 增量计算的理解，是否有规则引擎未覆盖的问题？\n" +
      "   检查 analysis_scope 和 stage_summary 中是否存在异常 pattern。\n\n" +
      "7. **参数组合分析**：多个参数建议之间是否有依赖或冲突关系？\n" +
      "   是否需要按特定顺序设置？\n\n" +
      "8. **深度根因分析**：对于 confidence=low/medium 的 findings，\n" +
      "   给出更确定的诊断。\n\n" +
      "9. **优化方案设计**：综合所有发现，给出一个完整的优化方案，\n" +
      "   包括参数设置顺序、预期效果、验证方法。\n"
    )
    return basePrompt + expertPrompt
  }

  return basePrompt
}

// ---------------------------------------------------------------------------
// handleJobPerformanceAnalysis — optimize_tools.py:121-301
// ---------------------------------------------------------------------------
async function handleJobPerformanceAnalysis(
  arguments_: Record<string, unknown>,
  config: StudioConfig,
): Promise<Record<string, unknown>> {
  try {
    // optimize_tools.py:127-129 — resolve workspace
    const workspaceName = (arguments_["workspace_name"] as string | undefined) ?? config.workspace
    logger.info({ workspaceName }, "[handleJobPerformanceAnalysis] Workspace name")

    const jobId = arguments_["job_id"] as string
    const enableStateTable = (arguments_["enable_state_table"] as boolean | undefined) ?? true
    const enableIncrementalAlgorithm = (arguments_["enable_incremental_algorithm"] as boolean | undefined) ?? false
    const analysisMode = (arguments_["analysis_mode"] as string | undefined) ?? "quick"
    const jobPlanPath = arguments_["path"] as string | undefined

    // optimize_tools.py:140-143
    if (!workspaceName || !jobId) {
      return {
        success: false,
        message: "workspace_name and job_id are required",
        error_type: "ValueError",
      }
    }

    let jobPlanData: Record<string, unknown> | null = null
    let jobProfileResponse: Record<string, unknown> | null = null

    // optimize_tools.py:145-186 — local path branch
    if (jobPlanPath) {
      logger.info({ jobPlanPath }, "Loading job plan and profile from local path")

      // Load job_plan.json
      const { existsSync, readFileSync } = await import("node:fs")
      const { join } = await import("node:path")

      const jobPlanFile = join(jobPlanPath, "job_plan.json")
      const planFile = join(jobPlanPath, "plan.json")

      if (existsSync(jobPlanFile)) {
        try {
          jobPlanData = JSON.parse(readFileSync(jobPlanFile, "utf-8")) as Record<string, unknown>
          logger.info({ jobPlanFile }, "Successfully loaded job_plan.json")
        } catch (e) {
          logger.warn({ err: e }, "Failed to load job_plan.json")
        }
      } else if (existsSync(planFile)) {
        try {
          jobPlanData = JSON.parse(readFileSync(planFile, "utf-8")) as Record<string, unknown>
          logger.info({ planFile }, "Successfully loaded plan.json as job_plan.json")
        } catch (e) {
          logger.warn({ err: e }, "Failed to load plan.json")
        }
      } else {
        logger.info({ jobPlanFile }, "job_plan.json not found, proceeding without plan data")
      }

      // Load job_profile.json
      const jobProfileFile = join(jobPlanPath, "job_profile.json")
      if (!existsSync(jobProfileFile)) {
        return {
          success: false,
          message: `job_profile.json not found at ${jobProfileFile}`,
          error_type: "ValueError",
        }
      }

      try {
        jobProfileResponse = JSON.parse(readFileSync(jobProfileFile, "utf-8")) as Record<string, unknown>
        logger.info({ jobProfileFile }, "Successfully loaded job_profile.json")
      } catch (e) {
        logger.error({ err: e }, "Failed to load job_profile.json")
        return {
          success: false,
          message: `Failed to load job_profile.json from ${jobProfileFile}: ${e instanceof Error ? e.message : String(e)}`,
          error_type: "IOError",
        }
      }
    } else {
      // optimize_tools.py:188-250 — download from API

      // Get job plan URL
      let planUrlResponse: Record<string, unknown>
      try {
        planUrlResponse = await apiGetJobPlanUrl(config, {
          workspaceName,
          jobId,
          extended: true,
        })
      } catch (e) {
        logger.error({ err: e }, "Failed to get job plan json")
        return {
          success: false,
          message: `Can not get job plan json by job_id:${jobId}: ${e instanceof Error ? e.message : String(e)}`,
          error_type: e instanceof Error ? e.constructor.name : "Error",
        }
      }

      // optimize_tools.py:209-224 — check if job plan URL exists
      const planData = planUrlResponse["data"] as Record<string, unknown> | undefined
      if (
        planData &&
        planData["locations"] &&
        (planData["locations"] as Record<string, unknown>)["JobPlanJson"]
      ) {
        const jobPlanUrl = (planData["locations"] as Record<string, unknown>)["JobPlanJson"] as string
        const planResp = await fetch(jobPlanUrl)
        if (!planResp.ok) {
          return {
            success: false,
            message: `Failed to download job plan: ${await planResp.text()}`,
            error_type: "ValueError",
          }
        }
        jobPlanData = (await planResp.json()) as Record<string, unknown>
      } else {
        logger.info({ jobId }, "Job plan URL not found, proceeding without plan data")
      }

      // Get job profile
      try {
        jobProfileResponse = await apiGetJobProfile(config, { workspaceName, jobId })
      } catch (e) {
        logger.error({ err: e }, "Failed to get job profile json")
        return {
          success: false,
          message: `Can not get job profile json by job_id:${jobId}: ${e instanceof Error ? e.message : String(e)}`,
          error_type: e instanceof Error ? e.constructor.name : "Error",
        }
      }

      // optimize_tools.py:243-250 — check respStatus
      const respStatus = (jobProfileResponse["respStatus"] as Record<string, unknown> | undefined) ?? {}
      if (respStatus["errorCode"]) {
        const errorMsg = (respStatus["errorMsg"] as string | undefined) ?? "Unknown error"
        const errorCode = respStatus["errorCode"]
        logger.error({ errorCode, errorMsg }, "Job profile API error")
        return {
          success: false,
          message: `[${errorCode}] ${errorMsg}`,
          error_type: "APIError",
        }
      }
    }

    // optimize_tools.py:252-254 — return raw data for AI analysis
    // NOTE: The Python side calls analyze_job_performance() from a separate handler module.
    // In the TS port we return the raw data for the AI to analyze, matching the tool's
    // stated purpose: "Fetches raw job plan and profile data ... does NOT interpret results."
    const analysisResult: Record<string, unknown> = {
      job_id: jobId,
      workspace_name: workspaceName,
      enable_state_table: enableStateTable,
      enable_incremental_algorithm: enableIncrementalAlgorithm,
      analysis_mode: analysisMode,
      job_plan: jobPlanData,
      job_profile: jobProfileResponse,
    }

    // optimize_tools.py:256-268 — optimization principles
    const optimizationPrinciples = (
      "优化参数推荐必须遵守的原则：\n" +
      "❌ 禁止行为：\n" +
      "1. 不要给没有依据的参数\n" +
      "2. 不要凭空给 flag，必须为data中明确提及的 flag，且询问用户是否需要执行\n" +
      "3. 不要推荐已存在且正确的参数\n" +
      "✅ 必须做到：\n" +
      "1. 仅在发现实际问题时才建议参数\n" +
      "2. 每个建议必须有明确的触发条件\n" +
      "3. 每个建议必须引用实际数据作为证据\n" +
      "4. 必须检查 settings 避免重复建议\n" +
      "📋 其他可能有用的参数：对于那些可能有用但没有明确问题证据的参数，单独列出，不要给强烈建议，让用户自行决定是否重跑"
    )

    // optimize_tools.py:271-296 — attach AI review prompt for detailed/expert modes
    const additionalPrefs: Record<string, unknown> = { optimization_principles: optimizationPrinciples }
    if (analysisMode === "detailed" || analysisMode === "expert") {
      additionalPrefs["ai_review_prompt"] = buildAiReviewPrompt(analysisMode)
    }

    return {
      success: true,
      data: analysisResult,
      additional_preferences: additionalPrefs,
    }
  } catch (e) {
    logger.error({ err: e }, "Job performance analysis failed")
    return {
      success: false,
      message: `job_performance_analysis: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// registerOptimizeTools — optimize_tools.py:357-361
// ---------------------------------------------------------------------------
export function registerOptimizeTools(registry: ToolRegistry, db: LakehouseDB): void {
  const getConfig = () => {
    if (!db.connectionConfig) throw new Error("No connection configuration available")
    return db.connectionConfig
  }

  // optimize_tools.py:304-354 — job_performance_analysis_tool()
  const tools: ToolDefinition[] = [
    {
      name: "fetch_job_performance_data",
      description: (
        "⚠️ PREREQUISITE: Before calling this tool, you MUST call get_useful_skills with " +
        "task_description='job performance analysis' and follow the returned skill instructions. " +
        "Calling this tool without the skill guidance will produce incomplete and incorrect results.\n" +
        "Fetches raw job plan and profile data for a given job ID. Returns structured data only — " +
        "does NOT interpret results. You MUST load the job-performance-analyzer skill first to " +
        "perform analysis and generate optimization recommendations.\n" +
        "Note: This tool params job ID does not need to be checked for existence.\n" +
        "## Example Usage\n" +
        "- Analyze task 2026012808001805432z9g3fx1sok.\n" +
        "- Please analyze job ID 2026012808001805432z9g3fx1sok and provide tuning suggestions.\n"
      ),
      inputSchema: {
        type: "object",
        properties: {
          workspace_name: {
            type: "string",
            description: "Workspace name",
          },
          job_id: {
            type: "string",
            description: "Lakehouse engine sql job_id. Note: This job ID does not need to be checked for existence.",
          },
          enable_incremental_algorithm: {
            type: "boolean",
            description: "Enable incremental algorithm, default is False",
          },
          enable_state_table: {
            type: "boolean",
            description: "Enable state table optimization, default is True",
          },
          analysis_mode: {
            type: "string",
            enum: ["quick", "detailed", "expert"],
            default: "quick",
            description: "分析模式，默认 quick。必须严格按以下关键词匹配，不要自行升级：quick='分析'/'看看'/'帮我分析'（默认）；detailed='详细分析'/'仔细看看'/'再详细分析下'；expert=仅当用户原话包含'专家模式'/'深度分析'/'全面分析'时才用。'详细'='detailed'，不是'expert'。不确定时选 quick。",
          },
          path: {
            type: "string",
            description: "Optional local folder path containing both job_plan.json and job_profile.json. If provided, the tool will load data from these local files instead of downloading from API.",
          },
        },
        additionalProperties: false,
        required: ["job_id"],
      },
      handler: async (args: Record<string, unknown>) => handleJobPerformanceAnalysis(args, getConfig()),
      tags: ["optimization", "job", "performance", "normalize"],
      samples: [],
    },
  ]

  logger.info({ count: tools.length }, "Registering optimize tools")
  registry.registerTools(tools)
}
