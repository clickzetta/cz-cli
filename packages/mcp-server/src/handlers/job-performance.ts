/**
 * Job Performance Analysis Handler
 *
 * Python → TS mapping:
 *   job_performance_handler.py:14-33  FINDING_REFERENCE_MAP  → FINDING_REFERENCE_MAP
 *   job_performance_handler.py:36-81  _load_reference_files  → loadReferenceFiles
 *   job_performance_handler.py:83-95  _estimate_expert_mode_tokens → estimateExpertModeTokens
 *   job_performance_handler.py:97-174 analyze_job_performance → analyzeJobPerformance
 */

import { existsSync, readFileSync } from "node:fs"
import { join, resolve, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { logger } from "../logger.js"

// ---------------------------------------------------------------------------
// job_performance_handler.py:14-33 — FINDING_REFERENCE_MAP
// ---------------------------------------------------------------------------

// Expert 模式：Finding 类型到 reference 文件的映射
const FINDING_REFERENCE_MAP: Record<string, string[]> = {
  DATA_SKEW: ["stage-operator-optimization.md"],
  STAGE_SPILLING: ["stage-operator-optimization.md"],
  OPERATOR_SPILLING: ["stage-operator-optimization.md"],
  RESOURCE_INEFFICIENCY: ["stage-operator-optimization.md"],
  SINGLE_DOP_AGG: ["stage-operator-optimization.md"],
  MISSING_BF_COLLECTION: ["stage-operator-optimization.md"],
  BROADCAST_JOIN: ["stage-operator-optimization.md"],
  TABLESINK_DOP: ["stage-operator-optimization.md"],
  MAX_DOP_USER_SET: ["stage-operator-optimization.md"],
  BOTTLENECK_ANALYSIS: ["stage-operator-optimization.md"],
  FULL_REFRESH: ["incremental-optimization.md"],
  NON_INCREMENTAL_REFRESH: ["state-table-optimization.md", "incremental-optimization.md"],
  HEAVY_CALC: ["state-table-optimization.md"],
  POTENTIAL_OPTIMIZATION: ["state-table-optimization.md"],
  SNAPSHOT_SUBPLAN_CANDIDATE: ["state-table-optimization.md"],
  INCREMENTAL_STATE_TABLE_CANDIDATE: ["state-table-optimization.md"],
  AGG_NOT_REUSING: ["state-table-optimization.md"],
  MISSING_APPEND_ONLY_PROPERTY: ["state-table-optimization.md"],
}

// ---------------------------------------------------------------------------
// job_performance_handler.py:36-81 — _load_reference_files
// ---------------------------------------------------------------------------

/**
 * 根据 findings 类型按需加载对应的 reference 文件内容
 *
 * @param findingTypes 规则引擎产出的 finding 类型集合
 * @returns 拼接后的 reference 文档内容
 */
export function loadReferenceFiles(findingTypes: Set<string>): string {
  // 收集需要加载的 reference 文件（去重）
  const neededFiles = new Set<string>()
  for (const findingType of findingTypes) {
    const refs = FINDING_REFERENCE_MAP[findingType] ?? []
    for (const ref of refs) {
      neededFiles.add(ref)
    }
  }

  // expert 模式下始终加载优化原则文档
  neededFiles.add("optimization-principles.md")

  if (neededFiles.size === 0) {
    return ""
  }

  // 定位 references 目录 — mirrors os.path.dirname(__file__) + '../skills/job-performance-analyzer/references'
  // In TS: handlers/ → src/ → package root → data/job-performance-analyzer/references
  const __filename = fileURLToPath(import.meta.url)
  const referencesDir = normalize(
    resolve(__filename, "..", "..", "..", "data", "job-performance-analyzer", "references"),
  )

  const contents: string[] = []
  let totalSize = 0
  for (const filename of [...neededFiles].sort()) {
    const filepath = join(referencesDir, filename)
    if (existsSync(filepath)) {
      try {
        const content = readFileSync(filepath, "utf-8")
        totalSize += content.length
        contents.push(`## Reference: ${filename}\n\n${content}`)
        logger.info({ filename, chars: content.length }, "[expert mode] Loaded reference")
      } catch (e) {
        logger.warn({ filename, err: e }, "[expert mode] Failed to load reference")
      }
    } else {
      logger.warn({ filepath }, "[expert mode] Reference file not found")
    }
  }

  logger.info({ count: contents.length, totalSize }, "[expert mode] Loaded reference files")
  return contents.join("\n\n---\n\n")
}

// ---------------------------------------------------------------------------
// job_performance_handler.py:83-95 — _estimate_expert_mode_tokens
// ---------------------------------------------------------------------------

/**
 * 估算 expert 模式的 token 消耗
 *
 * 粗略估算：1 token ≈ 4 chars (中英文混合场景偏保守)
 */
export function estimateExpertModeTokens(
  jsonReport: Record<string, unknown>,
  referenceContent: string,
): number {
  const reportSize = JSON.stringify(jsonReport).length
  const referenceSize = referenceContent.length
  const promptSize = 2000 // AI prompt 模板约 2KB

  const inputTokens = Math.floor((reportSize + referenceSize + promptSize) / 4)
  const outputTokens = 3000 // 预估 AI 输出
  return inputTokens + outputTokens
}

// ---------------------------------------------------------------------------
// job_performance_handler.py:97-174 — analyze_job_performance
// ---------------------------------------------------------------------------

export interface JobPerformanceResult {
  /** All captured output (print and log messages) */
  output?: string
  /** JSON format analysis report with structured data */
  structured_json_report?: Record<string, unknown>
  /** Reference context for expert mode */
  reference_context?: string
  /** Estimated token count for expert mode */
  token_estimate?: number
  /** Whether confirmation is required (expert mode) */
  requires_confirmation?: boolean
  [key: string]: unknown
}

/**
 * Analyze job performance using job plan and profile data.
 *
 * In the TS port there is no rule-engine equivalent of cz_skills.analyze_job,
 * so this function handles the expert-mode reference loading and token
 * estimation that the Python handler wraps around analyze_job().  The raw
 * plan/profile data is returned for the AI to interpret.
 *
 * @param jobPlanData    Job plan JSON data (may be null)
 * @param jobProfileData Job profile JSON data
 * @param enableIncrementalAlgorithmAnalysis Enable incremental algorithm analysis
 * @param enableStateTableAnalysis Enable state table analysis
 * @param analysisMode Analysis mode: 'quick' | 'detailed' | 'expert'
 */
export function analyzeJobPerformance(
  jobPlanData: Record<string, unknown> | null,
  jobProfileData: Record<string, unknown>,
  enableIncrementalAlgorithmAnalysis: boolean,
  enableStateTableAnalysis: boolean,
  analysisMode: string = "quick",
): JobPerformanceResult {
  try {
    // job_performance_handler.py:114-139 — build base result
    // (TS has no rule-engine; return raw data for AI analysis)
    const result: JobPerformanceResult = {
      job_plan: jobPlanData,
      job_profile: jobProfileData,
      enable_incremental_algorithm_analysis: enableIncrementalAlgorithmAnalysis,
      enable_state_table_analysis: enableStateTableAnalysis,
      analysis_mode: analysisMode,
    }

    // job_performance_handler.py:141-168 — expert mode: load reference docs
    if (analysisMode === "expert") {
      const findingTypes = new Set<string>()
      const structuredReport = (result["structured_json_report"] as Record<string, unknown>) ?? {}

      if (structuredReport) {
        const findings = (structuredReport["findings"] as Array<Record<string, unknown>>) ?? []
        for (const finding of findings) {
          const type = finding["type"] as string | undefined
          if (type) {
            findingTypes.add(type)
          }
        }

        // 加载对应的 reference 文档
        const referenceContent = loadReferenceFiles(findingTypes)

        if (referenceContent) {
          result["reference_context"] = referenceContent
        }

        // Token 估算
        result["token_estimate"] = estimateExpertModeTokens(structuredReport, referenceContent ?? "")
        result["requires_confirmation"] = true
      }
    }

    return result
  } catch (e) {
    logger.error({ err: e }, "Job performance analysis failed")
    throw e
  }
}
