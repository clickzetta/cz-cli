/**
 * State Table Rules - All state table optimization rules merged
 */
import { BaseRule, GlobalRule } from "./base-rule.js";
import type { RuleResult } from "./base-rule.js";
import { parseVersion, isVersionLe, isVersionGe } from '../utils/helpers.js';
import { AppendOnlyDetector, StateTableChecker } from '../utils/helpers.js';
import { createStageNavigator } from '../utils/plan-navigator.js';

// ============================================================================
// NonIncrementalDiagnosis
// ============================================================================
export class NonIncrementalDiagnosis extends GlobalRule {
  override name = 'non_incremental_diagnosis';
  override category = 'incremental/state_table';
  override description = '诊断为什么任务退化为全量刷新';

  static readonly DIAGNOSIS_FLAGS_V13: [string, string][] = [
    ['cz.optimizer.print.non.incremental.reason', 'true'],
    ['cz.optimizer.print.non.incremental.reason.msg.max.length', '100000'],
    ['cz.optimizer.incremental.force.incremental', 'true'],
  ];
  static readonly DIAGNOSIS_FLAGS_V14: [string, string][] = [
    ['cz.optimizer.incremental.try.incremental.refresh.enabled', 'true'],
  ];

  override analyzeGlobal(context: Record<string, any>): RuleResult {
    const refreshType = context.refreshType;
    const settings = context.settings || {};
    const versionInfo = context.versionInfo || {};
    const gitBranch = versionInfo.gitBranch || 'Unknown';
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];

    if (refreshType !== 'FULL') return { findings, recommendations, insights };
    if (String(settings['cz.sql.incremental.is.incremental.plan'] || '0') === '1') return { findings, recommendations, insights };
    if (settings['cz.optimizer.incremental.force.full.refresh']?.toLowerCase() === 'true') {
      insights.push(this.createInsight('任务为全量刷新，因设置了 cz.optimizer.incremental.force.full.refresh=true，属于强制全量，符合预期', 'global', 'important'));
      return { findings, recommendations, insights };
    }

    findings.push(this.createFinding('NON_INCREMENTAL_REFRESH', 'global', 'HIGH', '任务退化为全量刷新，需要诊断原因', {}, 'high'));

    const version = parseVersion(gitBranch);
    let diagnosisFlags: [string, string][];
    if (version === null || isVersionLe(version, 1, 3)) diagnosisFlags = NonIncrementalDiagnosis.DIAGNOSIS_FLAGS_V13;
    else diagnosisFlags = NonIncrementalDiagnosis.DIAGNOSIS_FLAGS_V14;

    const missingFlags = diagnosisFlags.filter(([p]) => !(p in settings));
    for (const [param, value] of missingFlags) {
      recommendations.push(this.buildRecommendationWithTableCheck(param, value, 1, '任务为全量刷新，需设置该参数诊断全量原因。', 'HIGH', context));
    }
    if (missingFlags.length) {
      const display = missingFlags.map(([p, v]) => `${p}=${v}`).join(', ');
      insights.push(this.createInsight(`任务为全量刷新，请设置 ${display} 后查看全量原因。注意：如果是该表或分区的第一次刷新，则全量刷新是正常行为`, 'global', 'important'));
    }
    return { findings, recommendations, insights };
  }
}

// ============================================================================
// StateTableEnable
// ============================================================================
export class StateTableEnable extends GlobalRule {
  override name = 'state_table_enable';
  override category = 'incremental/state_table';
  override description = '判断是否应该开启状态表以优化增量计算';

  override analyzeGlobal(context: Record<string, any>): RuleResult {
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];
    const alignedStages = context.alignedStages || {};
    const settings = context.settings || {};

    // Analyze snapshot subplan strategy
    const snapshotStages: string[] = [];
    let totalSnapshotTime = 0;
    const totalJobTime = context.totalJobTime || 0;

    for (const [stageId, stageData] of Object.entries(alignedStages) as [string, any][]) {
      const plan = stageData.plan || {};
      const planStr = JSON.stringify(plan);
      // Check if stage has only snapshot scans (no delta)
      const hasDelta = planStr.includes('incrementalTableProperty');
      const hasStateTable = planStr.includes('__incr__');
      if (!hasDelta && !hasStateTable) {
        const metrics = stageData.metrics || {};
        const elapsedMs = metrics.elapsedMs || 0;
        if (elapsedMs > 0) {
          snapshotStages.push(stageId);
          totalSnapshotTime += elapsedMs;
        }
      }
    }

    if (snapshotStages.length > 0 && totalJobTime > 0) {
      const snapshotPct = totalSnapshotTime / totalJobTime * 100;
      if (snapshotPct > 30) {
        findings.push(this.createFinding('SNAPSHOT_SUBPLAN_HEAVY', 'global', 'MEDIUM',
          `Snapshot subplan 占总耗时 ${snapshotPct.toFixed(1)}%（${snapshotStages.length} 个 stage），考虑启用状态表减少重复计算`,
          { snapshotStages, snapshotPct, totalSnapshotTimeMs: totalSnapshotTime }, 'medium'));

        const param = 'cz.optimizer.incremental.enable.state.table';
        if (!(param in settings) || settings[param] === 'false') {
          recommendations.push(this.buildRecommendationWithTableCheck(param, 'true', 2,
            `Snapshot subplan 占总耗时 ${snapshotPct.toFixed(1)}%，启用状态表可减少重复计算`, 'MEDIUM', context));
        }
        insights.push(this.createInsight(
          `Snapshot subplan 占总耗时 ${snapshotPct.toFixed(1)}%（${snapshotStages.length} 个 stage: ${snapshotStages.slice(0, 5).join(', ')}），建议启用状态表优化`,
          'global', 'important'));
      }
    }
    return { findings, recommendations, insights };
  }
}

// ============================================================================
// RowNumberCheck
// ============================================================================
export class RowNumberCheck extends BaseRule {
  override name = 'row_number_check';
  override category = 'incremental/state_table';
  override description = '检查 window 算子在 append-only delta 输入时的优化';

  override check(stageData: Record<string, any>, _context: Record<string, any>): boolean {
    const planStr = JSON.stringify(stageData.plan || {});
    return planStr.toLowerCase().includes('window') || planStr.includes('Window');
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    const stageId = stageData.stageId || 'unknown';
    const plan = stageData.plan || {};
    const settings = context.settings || {};
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];

    const operators: any[] = plan.operators || [];
    for (const op of operators) {
      if (!('window' in op || JSON.stringify(op).includes('Window'))) continue;
      const opStr = JSON.stringify(op);
      const hasLinearTopK = opStr.includes('IncrementalLinearTopKWindowRule') || opStr.includes('IncrementalLinearTopKWindowRuleV2');
      const hasRnPattern = ['ROW_NUMBER', 'row_number', 'rn=1'].some(p => opStr.includes(p)) || this.checkEqOnePattern(op);

      // Check if input is append-only
      let isAppendOnlyInput = false;
      for (const scanOp of operators) {
        if (AppendOnlyDetector.isDeltaScan(scanOp) && AppendOnlyDetector.isAppendOnlyScan(scanOp) === true) {
          isAppendOnlyInput = true; break;
        }
      }

      if (isAppendOnlyInput && hasRnPattern && !hasLinearTopK) {
        const param = 'cz.optimizer.incremental.window.sd.to.sd.rule.enable';
        if (!(param in settings) || settings[param] === 'true') {
          findings.push(this.createFinding('WINDOW_RN_NOT_OPTIMIZED', stageId, 'MEDIUM',
            'Window 算子有 rn=1 pattern 且输入是 append-only，但未使用 IncrementalLinearTopKWindowRule',
            { hasRnPattern, isAppendOnlyInput, hasLinearTopK }, 'high'));
          recommendations.push(this.buildRecommendationWithTableCheck(param, 'false', 2,
            `Stage ${stageId}: Window 算子有 rn=1 pattern 且输入是 append-only，设置此参数以启用 LinearTopK 优化`, 'MEDIUM', context, settings[param]));
          insights.push(this.createInsight(`Stage ${stageId}: Window 算子有 rn=1 pattern 且输入是 append-only，建议设置 ${param}=false 以启用 LinearTopK 优化`, stageId, 'important'));
        }
      }
    }
    return { findings, recommendations, insights };
  }

  private checkEqOnePattern(obj: any): boolean {
    if (typeof obj !== 'object' || obj === null) return false;
    if (obj.function?.name === 'EQ') {
      const args = obj.function.arguments || [];
      for (const arg of args) {
        if (arg?.constant?.bigint === '1' || arg?.constant?.bigint === 1 || arg?.constant?.int === '1' || arg?.constant?.int === 1) return true;
      }
    }
    for (const value of Object.values(obj)) {
      if (typeof value === 'object' && value !== null) { if (this.checkEqOnePattern(value)) return true; }
      if (Array.isArray(value)) { for (const item of value) { if (this.checkEqOnePattern(item)) return true; } }
    }
    return false;
  }
}

// ============================================================================
// AppendOnlyScan
// ============================================================================
export class AppendOnlyScan extends BaseRule {
  override name = 'append_only_scan';
  override category = 'incremental/state_table';
  override description = '检查 append-only 表扫描是否可以通过增量算法优化';

  override check(_stageData: Record<string, any>, _context: Record<string, any>): boolean {
    // Currently disabled (TODO)
    return false;
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    return { findings: [], recommendations: [], insights: [] };
  }
}

// ============================================================================
// AggregateReuse
// ============================================================================
export class AggregateReuse extends BaseRule {
  override name = 'aggregate_reuse';
  override category = 'incremental/state_table';
  override description = '检查聚合计算是否利用了之前的结果';
  static readonly ALWAYS_INCREMENTAL = ['SUM', 'COUNT', 'sum', 'count'];
  static readonly APPEND_ONLY_INCREMENTAL = ['MIN', 'MAX', 'min', 'max'];

  override check(stageData: Record<string, any>, _context: Record<string, any>): boolean {
    const planStr = JSON.stringify(stageData.plan || {});
    return planStr.includes('HashAggregate') || planStr.includes('Aggregate');
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    const stageId = stageData.stageId || 'unknown';
    const plan = stageData.plan || {};
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];

    // Check for incremental markers
    const planStr = JSON.stringify(plan);
    const hasIncrementalMarker = ['IncrementalAggregateRule', 'DeltaState', 'Rule:Incremental'].some(p => planStr.includes(p));
    if (hasIncrementalMarker) return { findings, recommendations, insights };

    // Check for aggregate operators with incremental hints
    for (const op of (plan.operators || []) as any[]) {
      if (!('hashAgg' in op)) continue;
      const opStr = JSON.stringify(op);
      const hasIncrementalHint = ['IncrementalAggregateRule', 'DeltaState', 'HINT=delta'].some(p => opStr.includes(p));
      if (!hasIncrementalHint) continue;

      const aggCalls: any[] = op.hashAgg?.aggregate?.aggregateCalls || [];
      const aggFuncs = aggCalls.map((c: any) => c?.function?.function?.name || 'unknown');
      const hasAlwaysIncremental = aggFuncs.some(f => AggregateReuse.ALWAYS_INCREMENTAL.some(ai => f.toUpperCase().includes(ai)));

      if (hasAlwaysIncremental) {
        const funcList = aggFuncs.join(', ');
        findings.push(this.createFinding('AGG_NOT_REUSING', stageId, 'WARNING', `聚合 (${funcList}) 未复用之前的计算结果`, {}, 'medium'));
        const hasStateTable = StateTableChecker.checkPlanHasStateTable(context);
        if (!hasStateTable) {
          insights.push(this.createInsight(`Stage ${stageId}: 聚合 (${funcList}) 未复用之前的结果，可能缺少状态表，建议设置 cz.optimizer.incremental.enable.state.table=true`, stageId));
        }
      }
    }
    return { findings, recommendations, insights };
  }
}

// ============================================================================
// HeavyCalcState
// ============================================================================
export class HeavyCalcState extends BaseRule {
  override name = 'heavy_calc_state';
  override category = 'incremental/state_table';
  override description = '检测高耗时 Calc 算子，建议存储状态以避免重复计算';
  static readonly CALC_STAGE_PERCENT = 30.0;
  static readonly STAGE_TOTAL_PERCENT = 15.0;

  override check(stageData: Record<string, any>, context: Record<string, any>): boolean {
    const operatorAnalysis: any[] = context.operatorAnalysis || [];
    const stageId = stageData.stageId;
    return operatorAnalysis.some(op => op.stageId === stageId && (op.operatorId || '').includes('Calc'));
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    const stageId = stageData.stageId || 'unknown';
    const plan = stageData.plan || {};
    const metrics = stageData.metrics || {};
    const settings = context.settings || {};
    const operatorAnalysis: any[] = context.operatorAnalysis || [];
    const totalTime = context.totalJobTime || 0;
    const elapsedMs = metrics.elapsedMs || 0;
    const stagePct = totalTime ? (elapsedMs / totalTime * 100) : 0;
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];

    const calcOps = operatorAnalysis.filter((op: any) => op.stageId === stageId && (op.operatorId || '').includes('Calc'));
    for (const calcOp of calcOps) {
      const calcStagePct = calcOp.stagePct || 0;
      if (calcStagePct < HeavyCalcState.CALC_STAGE_PERCENT) continue;
      if (stagePct < HeavyCalcState.STAGE_TOTAL_PERCENT) continue;

      const operatorId = calcOp.operatorId || 'unknown';
      const calcElapsedMs = elapsedMs * calcStagePct / 100;
      const hasUdf = ['udf', 'UDF', 'user_defined', 'ScalarFunction'].some(p => JSON.stringify(plan).includes(p));

      findings.push(this.createFinding('HEAVY_CALC', stageId, hasUdf ? 'HIGH' : 'MEDIUM',
        `Calc ${operatorId} 占 Stage ${calcStagePct.toFixed(1)}%，Stage ${stageId} 占整体 ${stagePct.toFixed(1)}%`,
        { operatorId, hasUdf, calcElapsedMs, calcStagePct, stageElapsedMs: elapsedMs, stageTotalPct: stagePct }, hasUdf ? 'high' : 'medium'));

      const param = 'cz.optimizer.incremental.create.rule.based.table.on.heavy.calc';
      if (!(param in settings) || settings[param] === 'false') {
        recommendations.push(this.buildRecommendationWithTableCheck(param, 'true', hasUdf ? 2 : 3,
          `Stage ${stageId}: Calc ${operatorId} 耗时 ${(calcElapsedMs / 1000).toFixed(1)}s (占 Stage ${calcStagePct.toFixed(1)}%)${hasUdf ? '，包含 UDF' : ''}`,
          hasUdf ? 'HIGH' : 'MEDIUM', context));
      }
      insights.push(this.createInsight(`Stage ${stageId}: Calc ${operatorId} 耗时 ${(calcElapsedMs / 1000).toFixed(1)}s (占 Stage ${calcStagePct.toFixed(1)}%)${hasUdf ? '，包含 UDF' : ''}，考虑开启状态优化`, stageId));
    }
    return { findings, recommendations, insights };
  }
}

// ============================================================================
// IncrementalAlgorithmVisualization (Global Rule)
// ============================================================================
export class IncrementalAlgorithmVisualization extends GlobalRule {
  override name = 'incremental_algorithm_visualization';
  override category = 'incremental/state_table';
  override description = '增量算法可视化分析';

  override analyzeGlobal(context: Record<string, any>): RuleResult {
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];
    // Delegate to IncrementalAlgorithmAnalyzer if enabled
    if (!context.enableIncrementalAlgorithmAnalysis) return { findings, recommendations, insights };

    const { IncrementalAlgorithmAnalyzer } = require('../utils/incremental-analyzer.js');
    const alignedStages = context.alignedStages || {};
    const analyzer = new IncrementalAlgorithmAnalyzer({}, alignedStages);
    const result = analyzer.analyze();

    if (result.algorithms.length > 0) {
      context.incrementalAlgorithms = result;
      insights.push(this.createInsight(result.visualization, 'global', 'important'));
    }
    return { findings, recommendations, insights };
  }
}
