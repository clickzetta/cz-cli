/**
 * Job Performance Analyzer - Main entry point
 * Migrated from Python: cz_skills/job_performance_analyzer/analyze_job.py
 */
import { logger } from '../logger.js';
import { PlanProfileParser } from './core/parser.js';
import type { ParsedData } from './core/parser.js';
import { StageAligner } from './core/aligner.js';
import type { AlignedData } from './core/aligner.js';
import { Reporter } from './core/reporter.js';
import {
  RefreshTypeDetection, SingleDopAggregate, HashJoinOptimization,
  TableSinkDop, MaxDopCheck, SpillingAnalysis, SkewDetection,
  ResourceEfficiencyAnalysis, ActiveProblemFinding, BucketDopLimit,
} from './rules/stage-optimization.js';
import {
  NonIncrementalDiagnosis, RowNumberCheck, AppendOnlyScan,
  StateTableEnable, AggregateReuse, HeavyCalcState,
  IncrementalAlgorithmVisualization,
} from './rules/state-table.js';
import {
  ErrorMessageCollector, JobConflictDetection, OptimizerErrorDetection,
  CpuEfficiencyAnalysis, ResourceWaitAnalysis,
} from './rules/common.js';
import { BaseRule, GlobalRule } from './rules/base-rule.js';
import type { RuleResult } from './rules/base-rule.js';

export interface AnalyzeJobOptions {
  planData?: Record<string, any> | null;
  profileData?: Record<string, any> | null;
  enableStateTableAnalysis?: boolean;
  enableIncrementalAlgorithmAnalysis?: boolean;
  analysisMode?: 'quick' | 'detailed' | 'expert';
  extraFiles?: Record<string, any>;
}

export interface AnalyzeJobResult {
  consoleReport: string;
  jsonReport: Record<string, any>;
}

export function analyzeJob(options: AnalyzeJobOptions): AnalyzeJobResult {
  const {
    planData = null,
    profileData = null,
    enableStateTableAnalysis = false,
    enableIncrementalAlgorithmAnalysis = false,
    analysisMode = 'quick',
    extraFiles = {},
  } = options;

  // Step 1: Parse input
  const parser = new PlanProfileParser(planData, profileData);
  const parsedData = parser.parse();
  const { sqlInfo, vcMode, settings, versionInfo } = parsedData;

  // Step 2: Align stages
  const aligner = new StageAligner(parsedData);
  const alignedData = aligner.align();
  const totalTime = alignedData.totalJobTime;

  // Step 3: Run analysis
  const reporter = new Reporter();
  const context: Record<string, any> = {
    sqlInfo,
    settings,
    vcMode: vcMode.mode,
    vcModeInfo: vcMode,
    versionInfo,
    hasProfile: parsedData.hasProfile,
    hasPlan: parsedData.hasPlan,
    rawProfile: parsedData.rawProfile,
    parser,
    enableIncrementalAlgorithmAnalysis,
    extraFiles,
    totalJobTime: totalTime,
    allStageMetrics: alignedData.stageMetrics,
    operatorAnalysis: alignedData.operatorAnalysis,
    alignedStages: alignedData.alignedStages,
    stageDependencies: alignedData.stageDependencies,
    globalTaskTimeline: alignedData.globalTaskTimeline,
    perStageTaskTimeline: alignedData.perStageTaskTimeline,
    reporter,
  };

  const allResults: RuleResult = { findings: [], recommendations: [], insights: [] };
  context.allResults = allResults;

  // Stage-level rules
  const stageRules: BaseRule[] = [
    new RefreshTypeDetection(), new SingleDopAggregate(), new HashJoinOptimization(),
    new TableSinkDop(), new MaxDopCheck(), new SpillingAnalysis(), new SkewDetection(),
    new ResourceEfficiencyAnalysis(), new BucketDopLimit(), new ActiveProblemFinding(),
  ];

  // Global rules
  const globalRules: GlobalRule[] = [
    new ErrorMessageCollector(), new JobConflictDetection(), new OptimizerErrorDetection(),
    new CpuEfficiencyAnalysis(), new ResourceWaitAnalysis(),
  ];

  if (enableIncrementalAlgorithmAnalysis) {
    globalRules.push(new IncrementalAlgorithmVisualization());
  }
  if (enableStateTableAnalysis) {
    globalRules.push(new NonIncrementalDiagnosis());
    globalRules.push(new StateTableEnable());
  }

  // State table stage-level rules
  const stateTableRules: BaseRule[] = enableStateTableAnalysis
    ? [new RowNumberCheck(), new AppendOnlyScan(), new AggregateReuse(), new HeavyCalcState()]
    : [];

  let refreshType: string | null = null;

  // Execute stage-level rules
  for (const [stageId, stageData] of Object.entries(alignedData.alignedStages)) {
    (stageData as any).stageId = stageId;
    for (const rule of stageRules) {
      try {
        if (rule.check(stageData as any, context)) {
          const result = rule.analyze(stageData as any, context);
          mergeResults(allResults, result);
          if (rule.name === 'refresh_type_detection' && (result as any).refreshType) {
            refreshType = (result as any).refreshType;
            context.refreshType = refreshType;
          }
        }
      } catch (e: any) {
        logger.error(`[${rule.name}] Stage ${stageId}: ${e.message}`);
      }
    }
  }

  // Execute global rules
  const isRefreshSql = sqlInfo.isRefresh;
  const incrementalGlobalRules = ['non_incremental_diagnosis', 'state_table_enable', 'incremental_algorithm_visualization'];

  for (const rule of globalRules) {
    try {
      if (incrementalGlobalRules.includes(rule.name) && !isRefreshSql) continue;
      if (['state_table_enable', 'incremental_algorithm_visualization'].includes(rule.name) && refreshType === 'FULL') continue;
      const result = rule.analyzeGlobal(context);
      mergeResults(allResults, result);
    } catch (e: any) {
      logger.error(`[${rule.name}] Global: ${e.message}`);
    }
  }

  // Execute state table stage-level rules
  if (stateTableRules.length && isRefreshSql && refreshType !== 'FULL') {
    for (const [stageId, stageData] of Object.entries(alignedData.alignedStages)) {
      (stageData as any).stageId = stageId;
      for (const rule of stateTableRules) {
        try {
          if (rule.check(stageData as any, context)) {
            const result = rule.analyze(stageData as any, context);
            mergeResults(allResults, result);
          }
        } catch (e: any) {
          logger.error(`[${rule.name}] Stage ${stageId}: ${e.message}`);
        }
      }
    }
  }

  // Build report
  for (const f of allResults.findings) reporter.addFinding(f);
  for (const r of allResults.recommendations) reporter.addRecommendation(r);
  for (const i of allResults.insights) reporter.addInsight(i);

  reporter.setMetadata('sqlType', sqlInfo.sqlTypeDisplay);
  reporter.setMetadata('vcMode', vcMode.mode);
  reporter.setMetadata('refreshType', refreshType);
  reporter.setMetadata('stageTotalTimeSeconds', totalTime / 1000);
  reporter.setMetadata('stageCount', Object.keys(alignedData.alignedStages).length);

  const profiling = parser.getJobProfilingAnalysis();
  if (profiling?.totalTimeSec) {
    reporter.setMetadata('jobTotalTimeSeconds', profiling.totalTimeSec);
  } else {
    reporter.setMetadata('totalTimeSeconds', totalTime / 1000);
  }

  if (context.incrementalAlgorithms) {
    reporter.setIncrementalAlgorithms(context.incrementalAlgorithms);
  }

  const consoleReport = reporter.generateConsoleReport(context,
    ['summary', 'recommendations', 'insights'], false, analysisMode);
  const jsonReport = reporter.generateJsonReport(context, analysisMode);

  return { consoleReport, jsonReport };
}

function mergeResults(target: RuleResult, source: RuleResult): void {
  target.findings.push(...(source.findings || []));
  target.recommendations.push(...(source.recommendations || []));
  target.insights.push(...(source.insights || []));
}

// Re-export core types
export { PlanProfileParser } from './core/parser.js';
export { StageAligner } from './core/aligner.js';
export { Reporter } from './core/reporter.js';
export type { ParsedData, SqlInfo, VcMode } from './core/parser.js';
export type { AlignedData } from './core/aligner.js';
