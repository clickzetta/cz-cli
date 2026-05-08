/**
 * Stage Optimization Rules - All incremental stage optimization rules merged
 */
import { BaseRule } from "./base-rule.js";
import type { RuleResult } from "./base-rule.js";
import { createStageNavigator, isDfAndJoin } from '../utils/plan-navigator.js';

// ============================================================================
// RefreshTypeDetection
// ============================================================================
export class RefreshTypeDetection extends BaseRule {
  override name = 'refresh_type_detection';
  override category = 'incremental/stage_optimization';
  override description = '判断 REFRESH SQL 是增量还是全量刷新';
  static readonly INTERMEDIATE_PATTERNS = ['__incr__', '__state__', '__incr_state__', '__temp__', '__intermediate__'];

  override check(stageData: Record<string, any>, context: Record<string, any>): boolean {
    const sqlInfo = context.sqlInfo || {};
    if (!sqlInfo.isRefresh) return false;
    return createStageNavigator(stageData).hasOperator('TableSink');
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult & { refreshType?: string | null } {
    const stageId = stageData.stageId || 'unknown';
    const navigator = createStageNavigator(stageData);
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];
    const tableName = navigator.getRefreshTableName();
    if (tableName && RefreshTypeDetection.INTERMEDIATE_PATTERNS.some(p => tableName.includes(p))) {
      return { findings, recommendations, insights, refreshType: null };
    }
    const isIncremental = navigator.isDeltaTableSink();
    const isOverwrite = navigator.isOverwriteSink();
    const fullPath = navigator.getTableFullPath();

    if (isIncremental) {
      return { findings, recommendations, insights, refreshType: 'INCREMENTAL' };
    }
    const refreshType = 'FULL';
    const settings = context.settings || {};
    if (String(settings['cz.sql.incremental.is.incremental.plan'] || '0') === '1') {
      return { findings, recommendations, insights, refreshType };
    }
    findings.push(this.createFinding('FULL_REFRESH', stageId, 'WARNING',
      `检测到全量刷新 (表: ${fullPath || tableName || 'unknown'}, overwrite=${isOverwrite})`,
      { tableName, fullPath, isOverwrite }, 'high'));
    insights.push(this.createInsight(`Stage ${stageId}: 全量刷新可能导致性能问题，建议检查增量计算配置`, stageId));
    return { findings, recommendations, insights, refreshType };
  }
}

// ============================================================================
// MaxDopCheck
// ============================================================================
export class MaxDopCheck extends BaseRule {
  override name = 'max_dop_check';
  override category = 'incremental/stage_optimization';
  override description = '检查是否达到系统 DOP 限制';
  static readonly MAP_MAX_DOP = 4096;
  static readonly REDUCE_MAX_DOP = 2048;

  override check(stageData: Record<string, any>, context: Record<string, any>): boolean {
    if (!this.hasProfileData(context)) return false;
    return (stageData.metrics?.dop || 0) >= MaxDopCheck.REDUCE_MAX_DOP;
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    const stageId = stageData.stageId || 'unknown';
    const dop = stageData.metrics?.dop || 0;
    const settings = context.settings || {};
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];
    const [limitType, userSetting] = dop >= MaxDopCheck.MAP_MAX_DOP
      ? ['Map', 'cz.optimizer.mapper.stage.max.dop']
      : ['Reduce', 'cz.optimizer.reducer.stage.max.dop'];
    const userSetValue = settings[userSetting];
    if (userSetValue) {
      findings.push(this.createFinding('MAX_DOP_USER_SET', stageId, 'INFO', `Stage DOP=${dop} 达到 ${limitType} 限制，用户已设置 ${userSetting}=${userSetValue}`));
      insights.push(this.createInsight(`Stage ${stageId}: DOP=${dop} 达到 ${limitType} 限制，用户已设置参数，请确认是否符合预期`, stageId));
    }
    return { findings, recommendations, insights };
  }
}

// ============================================================================
// SpillingAnalysis
// ============================================================================
export class SpillingAnalysis extends BaseRule {
  override name = 'spilling_analysis';
  override category = 'incremental/stage_optimization';
  override description = '检测内存溢出到磁盘的情况';
  static readonly STAGE_SPILL_THRESHOLD_GB = 1.0;
  static readonly OPERATOR_SPILL_THRESHOLD_GB = 0.5;

  override check(stageData: Record<string, any>, context: Record<string, any>): boolean {
    if (!this.hasProfileData(context)) return false;
    return (stageData.metrics?.effectiveSpillBytes || 0) > 0;
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    const stageId = stageData.stageId || 'unknown';
    const metrics = stageData.metrics || {};
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];
    const effectiveSpillGb = metrics.effectiveSpillGb || 0;
    const operatorSpills: any[] = metrics.operatorSpills || [];
    const effectiveSpills = operatorSpills.filter((op: any) => !op.isShuffle);

    if (effectiveSpillGb >= SpillingAnalysis.STAGE_SPILL_THRESHOLD_GB) {
      const severity = effectiveSpillGb >= SpillingAnalysis.STAGE_SPILL_THRESHOLD_GB * 3 ? 'HIGH' : 'MEDIUM';
      findings.push(this.createFinding('STAGE_SPILLING', stageId, severity, `计算算子 Spilling 合计: ${effectiveSpillGb.toFixed(2)} GB`, { spillGb: effectiveSpillGb, level: 'stage' }, 'high'));
    }
    for (const opSpill of effectiveSpills) {
      if (opSpill.spillGb >= SpillingAnalysis.OPERATOR_SPILL_THRESHOLD_GB) {
        const severity = opSpill.spillGb >= SpillingAnalysis.OPERATOR_SPILL_THRESHOLD_GB * 2 ? 'HIGH' : 'MEDIUM';
        findings.push(this.createFinding('OPERATOR_SPILLING', stageId, severity, `Operator ${opSpill.operatorId} Spilling: ${opSpill.spillGb.toFixed(2)} GB`, { operatorId: opSpill.operatorId, spillGb: opSpill.spillGb, level: 'operator' }, 'high'));
      }
    }
    if (effectiveSpills.length) {
      this.addAnalysisDetail(context, 'operatorSpills', effectiveSpills.map((op: any) => ({ operatorId: op.operatorId, spillGb: op.spillGb })), stageId);
      this.addAnalysisDetail(context, 'effectiveStageSpillGb', effectiveSpillGb, stageId);
    }
    return { findings, recommendations, insights };
  }
}

// ============================================================================
// SkewDetection
// ============================================================================
export class SkewDetection extends BaseRule {
  override name = 'skew_detection';
  override category = 'incremental/stage_optimization';
  override description = '检测数据倾斜问题';
  static readonly STAGE_TIME_RATIO_THRESHOLD = 0.15;
  static readonly MIN_STAGE_TIME_MS = 5000;
  static readonly MIN_DATA_BYTES = 100 * 1024 * 1024;
  static readonly TIME_MAX_MEDIAN_RATIO_THRESHOLD = 10.0;
  static readonly DATA_MAX_MEDIAN_RATIO_THRESHOLD = 5.0;
  static readonly CONCENTRATION_RATIO_THRESHOLD = 0.3;
  static readonly TIME_DATA_RATIO_THRESHOLD = 3.0;
  static readonly DEFAULT_SPLIT_SIZE = 268435456;
  static readonly MIN_SPLIT_SIZE = 16777216;
  static readonly MAX_SPLIT_SIZE = 268435456;

  override check(stageData: Record<string, any>, context: Record<string, any>): boolean {
    if (!this.hasProfileData(context)) return false;
    const metrics = stageData.metrics || {};
    if ((metrics.elapsedMs || 0) < SkewDetection.MIN_STAGE_TIME_MS) return false;
    if ((metrics.inputBytes || 0) < SkewDetection.MIN_DATA_BYTES && (metrics.outputBytes || 0) < SkewDetection.MIN_DATA_BYTES) return false;
    const totalJobTime = context.totalJobTime || 0;
    if (totalJobTime > 0 && (metrics.elapsedMs || 0) / totalJobTime < SkewDetection.STAGE_TIME_RATIO_THRESHOLD) return false;
    return (metrics.taskTimeMaxMedianRatio || 1.0) >= SkewDetection.TIME_MAX_MEDIAN_RATIO_THRESHOLD;
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    const stageId = stageData.stageId || 'unknown';
    const planStage = stageData.plan || {};
    const metrics = stageData.metrics || {};
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];

    const elapsedMs = metrics.elapsedMs || 0;
    const totalJobTime = context.totalJobTime || 0;
    const stagePct = totalJobTime > 0 ? (elapsedMs / totalJobTime * 100) : 0;
    const timeMaxMedian = metrics.taskTimeMaxMedianRatio || 1.0;
    const activeMaxMs = metrics.activeMaxMs || 0;
    const activeMedianMs = metrics.activeMedianMs || 0;
    const activeTasks = metrics.activeTaskCount || 0;
    const totalTasks = metrics.totalTaskCount || 0;
    const maxMedianRatio = metrics.dataSkewMaxMedianRatio || 1.0;
    const concentrationRatio = metrics.dataSkewConcentrationRatio || 1.0;
    const topKTasks = metrics.dataSkewTopKTasks || 0;
    const maxRows = metrics.dataSkewMaxRows || 0;
    const medianRows = metrics.dataSkewMedianRows || 0;
    const splitCntMax = metrics.scanSplitCntMax || 0;
    const splitCntAvg = metrics.scanSplitCntAvg || 0;

    const hasDataSkew = maxMedianRatio >= SkewDetection.DATA_MAX_MEDIAN_RATIO_THRESHOLD;
    const thresholdB = activeTasks > 0 ? Math.min(SkewDetection.CONCENTRATION_RATIO_THRESHOLD, 2 / activeTasks) : 1.0;
    const hasConcentrationSkew = activeTasks > 0 ? concentrationRatio <= thresholdB : false;
    const isDataSkew = hasDataSkew || hasConcentrationSkew;
    const effectiveDataRatio = Math.max(maxMedianRatio, 1.0);
    const hasIoLongTail = (timeMaxMedian / effectiveDataRatio >= SkewDetection.TIME_DATA_RATIO_THRESHOLD && splitCntMax > 0);

    const timeDesc = `时间倾斜 max/median=${timeMaxMedian.toFixed(1)}x (最慢 task ${(activeMaxMs / 1000).toFixed(1)}s, 中位数 ${(activeMedianMs / 1000).toFixed(1)}s)`;
    const severity = timeMaxMedian >= 20 ? 'HIGH' : 'MEDIUM';

    if (isDataSkew) {
      findings.push(this.createFinding('DATA_SKEW', stageId, severity,
        `检测到数据倾斜：${timeDesc}，active task ${activeTasks}/${totalTasks}，Stage 耗时 ${(elapsedMs / 1000).toFixed(1)}s，占整体 ${stagePct.toFixed(1)}%`,
        { activeTasks, totalTasks, taskTimeMaxMedianRatio: timeMaxMedian, dataSkewMaxMedianRatio: maxMedianRatio, stageElapsedMs: elapsedMs, stageTotalPct: stagePct }, 'high'));

      if (this.hasScanOperator(planStage)) {
        this.generateScanSkewRecommendations(stageId, timeDesc, elapsedMs, stagePct, timeMaxMedian, hasIoLongTail, context, recommendations, insights);
      } else {
        insights.push(this.createInsight(`Stage ${stageId}: ${timeDesc}，Stage 耗时 ${(elapsedMs / 1000).toFixed(1)}s (占整体 ${stagePct.toFixed(1)}%)，建议检查数据分布和分区策略`, stageId, 'important'));
      }
    } else {
      findings.push(this.createFinding(hasIoLongTail ? 'IO_LONG_TAIL_SKEW' : 'TIME_SKEW', stageId, severity,
        `检测到时间倾斜：${timeDesc}，数据量分布均匀，active task ${activeTasks}/${totalTasks}，Stage 耗时 ${(elapsedMs / 1000).toFixed(1)}s，占整体 ${stagePct.toFixed(1)}%`,
        { activeTasks, totalTasks, taskTimeMaxMedianRatio: timeMaxMedian, stageElapsedMs: elapsedMs }, 'medium'));
      insights.push(this.createInsight(`Stage ${stageId}: ${timeDesc}，数据量分布均匀，Stage 耗时 ${(elapsedMs / 1000).toFixed(1)}s (占整体 ${stagePct.toFixed(1)}%)`, stageId, 'important'));
    }
    return { findings, recommendations, insights };
  }

  private hasScanOperator(planStage: Record<string, any>): boolean {
    if (!planStage) return false;
    for (const op of (planStage.operators || []) as any[]) {
      if ('tableScan' in op) return true;
      if ((op.type || '').toLowerCase().includes('scan')) return true;
    }
    return false;
  }

  private generateScanSkewRecommendations(stageId: string, skewDesc: string, elapsedMs: number, stagePct: number, timeMaxMedian: number, hasIoLongTail: boolean, context: Record<string, any>, recommendations: any[], insights: any[]): void {
    const settings = context.settings || {};
    const splitSizeStr = settings['cz.mapper.file.split.size'];
    let currentSplitSize = splitSizeStr ? parseInt(splitSizeStr) || SkewDetection.DEFAULT_SPLIT_SIZE : SkewDetection.DEFAULT_SPLIT_SIZE;
    const isUserSet = !!splitSizeStr;

    let recommendedSplitSize = Math.floor(currentSplitSize / 4);
    recommendedSplitSize = Math.max(SkewDetection.MIN_SPLIT_SIZE, Math.min(recommendedSplitSize, SkewDetection.MAX_SPLIT_SIZE));

    if (recommendedSplitSize >= currentSplitSize || currentSplitSize <= SkewDetection.MIN_SPLIT_SIZE) {
      insights.push(this.createInsight(`Stage ${stageId}: ${skewDesc}，split size 已设置为 ${(currentSplitSize / (1024 ** 2)).toFixed(0)}M，仍存在倾斜`, stageId, 'important'));
    } else {
      const reason = `Stage ${stageId}: ${skewDesc}，Stage 耗时 ${(elapsedMs / 1000).toFixed(1)}s (占整体 ${stagePct.toFixed(1)}%)，建议调整 split size 从 ${(currentSplitSize / (1024 ** 2)).toFixed(0)}M 到 ${(recommendedSplitSize / (1024 ** 2)).toFixed(0)}M`;
      recommendations.push(this.buildRecommendationWithTableCheck('cz.mapper.file.split.size', String(recommendedSplitSize), 2, reason, 'MEDIUM', context, isUserSet ? String(currentSplitSize) : null));
      insights.push(this.createInsight(reason, stageId, 'important'));
    }
  }
}

// ============================================================================
// BucketDopLimit
// ============================================================================
export class BucketDopLimit extends BaseRule {
  override name = 'bucket_dop_limit';
  override category = 'incremental/stage_optimization';
  override description = '检测表的 bucket 配置导致 Stage DOP 受限';
  static readonly DEFAULT_SPLIT_SIZE_BYTES = 256 * 1024 * 1024;
  static readonly DOP_RATIO_THRESHOLD = 2.0;
  static readonly MIN_STAGE_TIME_MS = 10000;

  override check(stageData: Record<string, any>, context: Record<string, any>): boolean {
    if (!this.hasProfileData(context)) return false;
    const metrics = stageData.metrics || {};
    if ((metrics.elapsedMs || 0) < BucketDopLimit.MIN_STAGE_TIME_MS) return false;
    return (metrics.dop || 0) > 1;
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    const stageId = stageData.stageId || 'unknown';
    const metrics = stageData.metrics || {};
    const plan = stageData.plan || {};
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];
    const dop = metrics.dop || 0;
    const inputBytes = metrics.inputBytes || 0;

    const bucketInfo = this.extractBucketInfo(plan);
    if (!bucketInfo.length) return { findings, recommendations, insights };
    const matchedTables = bucketInfo.filter(info => info.bucketsCount === dop);
    if (!matchedTables.length) return { findings, recommendations, insights };

    const theoreticalDop = Math.max(1, Math.floor(inputBytes / BucketDopLimit.DEFAULT_SPLIT_SIZE_BYTES));
    const dopRatio = dop > 0 ? theoreticalDop / dop : 0;
    if (dopRatio < BucketDopLimit.DOP_RATIO_THRESHOLD) return { findings, recommendations, insights };

    const settings = context.settings || {};
    if (settings['cz.sql.force.enable.shuffle']?.toLowerCase() === 'true') return { findings, recommendations, insights };

    const tableNames = matchedTables.map(t => t.tableName);
    const tableDesc = tableNames.join('、');
    const inputGb = inputBytes / (1024 ** 3);

    findings.push(this.createFinding('BUCKET_DOP_LIMIT', stageId, 'HIGH',
      `表 ${tableDesc} 设置了 bucket=${dop}，导致 Stage DOP 被限制为 ${dop}。输入数据量 ${inputGb.toFixed(1)}GB，理论 DOP 约 ${theoreticalDop}`,
      { bucketCount: dop, theoreticalDop, dopRatio: Math.round(dopRatio * 10) / 10, inputGb: Math.round(inputGb * 10) / 10, tables: tableNames }, 'high'));

    recommendations.push(this.createRecommendation('cz.sql.force.enable.shuffle', 'true', 1,
      `表 ${tableDesc} 的 bucket=${dop} 限制了 DOP，输入 ${inputGb.toFixed(1)}GB 理论需要 ${theoreticalDop} 并行度。设置此参数强制走 shuffle`, 'HIGH', null,
      `此参数会强制所有 shuffle 操作不复用 bucket 分布。另一个方案是修改表 ${tableDesc} 的 cluster 属性`));

    insights.push(this.createInsight(`Stage ${stageId}: 表 ${tableDesc} 的 bucket=${dop} 限制了并行度，输入 ${inputGb.toFixed(1)}GB 理论 DOP=${theoreticalDop}，实际仅 ${dop}`, stageId, 'important'));
    return { findings, recommendations, insights };
  }

  private extractBucketInfo(plan: Record<string, any>): any[] {
    const results: any[] = [];
    const seenTables = new Set<string>();
    for (const op of (plan.operators || []) as any[]) {
      if ('tableScan' in op) {
        const info = this.extractFromTableMeta(op.tableScan?.table || {}, op.id || '');
        if (info && !seenTables.has(info.tableName)) { seenTables.add(info.tableName); results.push(info); }
      }
      if ('tableSink' in op) {
        const table = op.tableSink?.table || {};
        const path: string[] = table.path || [];
        if (path.length === 4 && path[path.length - 1] === '__delta__') continue;
        const info = this.extractFromTableMeta(table, op.id || '');
        if (info && !seenTables.has(info.tableName)) { seenTables.add(info.tableName); results.push(info); }
      }
    }
    return results;
  }

  private extractFromTableMeta(table: Record<string, any>, operatorId: string): any | null {
    const path: string[] = table.path || [];
    if (!path.length) return null;
    const tableName = path.length >= 3 ? path.slice(0, 3).join('.') : path[path.length - 1];
    const clusterSpecs: any[] = table.tableMeta?.clusterInfoSpec || [];
    for (const spec of clusterSpecs) {
      const clusterInfo = spec.clusterInfo || {};
      const bucketsCount = parseInt(clusterInfo.bucketsCount || '0') || 0;
      if (bucketsCount > 1) {
        return { tableName, bucketsCount, bucketType: clusterInfo.hash?.bucketType || 'UNKNOWN', operatorId };
      }
    }
    return null;
  }
}

// ============================================================================
// HashJoinOptimization
// ============================================================================
export class HashJoinOptimization extends BaseRule {
  override name = 'hash_join_optimization';
  override category = 'incremental/stage_optimization';
  override description = '检测 Hash Join build/probe 数据量不对称';
  static readonly STAGE_TIME_THRESHOLD_MS = 10000;
  static readonly STAGE_PERCENT_THRESHOLD = 8.0;
  static readonly BUILD_PROBE_RATIO_THRESHOLD = 10.0;
  static readonly JOIN_TIME_IMPORTANT_MS = 5000;
  static readonly JOIN_PERCENT_THRESHOLD = 30.0;
  static readonly BROADCAST_BUILD_SIZE_THRESHOLD = 2 * 1024 ** 3;

  override check(stageData: Record<string, any>, context: Record<string, any>): boolean {
    if (!this.hasProfileData(context)) return false;
    const metrics = stageData.metrics || {};
    const totalTime = context.totalJobTime || 0;
    const elapsedMs = metrics.elapsedMs || 0;
    const timePct = totalTime ? (elapsedMs / totalTime * 100) : 0;
    if (elapsedMs < HashJoinOptimization.STAGE_TIME_THRESHOLD_MS && timePct < HashJoinOptimization.STAGE_PERCENT_THRESHOLD) return false;
    return (stageData.planOperators || []).some((op: any) => 'hashJoin' in op);
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    const stageId = stageData.stageId || 'unknown';
    const metrics = stageData.metrics || {};
    const profile = stageData.profile || {};
    const planOperators: any[] = stageData.planOperators || [];
    const settings = context.settings || {};
    const totalTime = context.totalJobTime || 0;
    const elapsedMs = metrics.elapsedMs || 0;
    const stagePct = totalTime > 0 ? (elapsedMs / totalTime * 100) : 0;
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];

    const opMap: Record<string, any> = {};
    for (const op of planOperators) { if (op.id) opMap[op.id] = op; }
    const opSummary = profile.operatorSummary || {};

    for (const op of planOperators) {
      if (!('hashJoin' in op)) continue;
      const opId = op.id;
      const hj = op.hashJoin;
      const isBroadcast = hj.broadcast || false;
      const probeOpId = hj.probeOperatorId || '';
      const inputIds: string[] = op.inputIds || [];
      let buildOpId: string | null = null;
      for (const iid of inputIds) { if (iid !== probeOpId) { buildOpId = iid; break; } }
      if (!buildOpId) continue;

      const isDf = isDfAndJoin(op);
      const [buildBytes, buildRows] = this.getSubtreeData(buildOpId, opMap, opSummary);
      const [probeBytes, probeRows] = this.getSubtreeData(probeOpId, opMap, opSummary);

      let ratio = 0;
      if (buildBytes > 0 && probeBytes > 0) ratio = buildBytes / probeBytes;
      else if (buildRows > 0 && probeRows > 0) ratio = buildRows / probeRows;

      if (ratio >= HashJoinOptimization.BUILD_PROBE_RATIO_THRESHOLD) {
        const hjProfile = opSummary[opId] || {};
        const hjMaxMs = (parseInt(hjProfile.wallTimeNs?.max || '0') || 0) / 1_000_000;
        const isImportant = !isDf && hjMaxMs >= HashJoinOptimization.JOIN_TIME_IMPORTANT_MS;
        const joinType = isBroadcast ? 'Broadcast' : 'Shuffle';
        const severity = isBroadcast ? (isImportant ? 'HIGH' : 'LOW') : (isImportant ? 'MEDIUM' : 'LOW');

        findings.push(this.createFinding('HASH_JOIN_BUILD_HEAVY', stageId, severity,
          `${opId}（${joinType} Hash Join）build 侧数据量远大于 probe 侧，比值 ${ratio.toFixed(1)}x`,
          { operatorId: opId, joinType, isDfJoin: isDf, ratio, joinTimeMs: hjMaxMs }, 'high'));

        if (isBroadcast && isImportant) {
          const param = 'cz.optimizer.enable.broadcast.hash.join';
          if (settings[param] !== 'false') {
            recommendations.push(this.buildRecommendationWithTableCheck(param, 'false', 2,
              `Stage ${stageId}: ${opId} (Broadcast Hash Join) build 侧数据量远大于 probe 侧（比值 ${ratio.toFixed(1)}x），建议关闭 Broadcast Hash Join`,
              'HIGH', context, settings[param], '禁用后将使用 Shuffle Hash Join，需观察整体性能变化', stageId));
          }
        }
        insights.push(this.createInsight(`Stage ${stageId}: ${opId} 是 ${joinType} Hash Join，build 侧数据量远大于 probe 侧（比值 ${ratio.toFixed(1)}x）`, stageId, isImportant ? 'important' : 'detail'));
      }
    }
    return { findings, recommendations, insights };
  }

  private getSubtreeData(opId: string, opMap: Record<string, any>, opSummary: Record<string, any>): [number, number] {
    return this.collectLeafData(opId, opMap, opSummary, new Set());
  }

  private collectLeafData(opId: string, opMap: Record<string, any>, opSummary: Record<string, any>, visited: Set<string>): [number, number] {
    if (visited.has(opId)) return [0, 0];
    visited.add(opId);
    const leafPrefixes = ['TableScan', 'ShuffleRead', 'Values', 'Buffer'];
    const isLeaf = leafPrefixes.some(p => opId.startsWith(p));
    if (isLeaf || !opMap[opId]) return this.extractOpData(opId, opSummary);
    const op = opMap[opId];
    const inputIds: string[] = op.inputIds || [];
    if (!inputIds.length) return this.extractOpData(opId, opSummary);
    let totalBytes = 0, totalRows = 0;
    for (const iid of inputIds) { const [b, r] = this.collectLeafData(iid, opMap, opSummary, visited); totalBytes += b; totalRows += r; }
    return [totalBytes, totalRows];
  }

  private extractOpData(opId: string, opSummary: Record<string, any>): [number, number] {
    const opData = opSummary[opId] || {};
    const ioStats = opData.inputOutputStats || {};
    return [parseInt(ioStats.inputBytes || '0') || 0, parseInt(opData.rowCount?.sum || '0') || 0];
  }
}

// ============================================================================
// SingleDopAggregate
// ============================================================================
export class SingleDopAggregate extends BaseRule {
  override name = 'single_dop_aggregate';
  override category = 'incremental/stage_optimization';
  override description = '检测单并行度聚合Stage';
  static readonly EXPENSIVE_FUNCTIONS = ['MULTI_RANGE_COLLECT', '_DF_BF_COLLECT', 'BF_COLLECT', 'DF_BF_COLLECT'];
  static readonly TIME_THRESHOLD_MS = 20000;
  static readonly PERCENT_THRESHOLD = 10.0;

  override check(stageData: Record<string, any>, context: Record<string, any>): boolean {
    const navigator = createStageNavigator(stageData);
    if (!navigator.hasOperator('HashAggregate')) return false;
    if (!this.hasProfileData(context)) return false;
    const metrics = stageData.metrics || {};
    if (metrics.dop !== 1) return false;
    const totalTime = context.totalJobTime || 0;
    const elapsedMs = metrics.elapsedMs || 0;
    const timePct = totalTime ? (elapsedMs / totalTime * 100) : 0;
    if (elapsedMs < SingleDopAggregate.TIME_THRESHOLD_MS || timePct < SingleDopAggregate.PERCENT_THRESHOLD) return false;
    return navigator.hasAggregateFunction(SingleDopAggregate.EXPENSIVE_FUNCTIONS);
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    const stageId = stageData.stageId || 'unknown';
    const metrics = stageData.metrics || {};
    const settings = context.settings || {};
    const totalTime = context.totalJobTime || 0;
    const elapsedMs = metrics.elapsedMs || 0;
    const timePct = totalTime ? (elapsedMs / totalTime * 100) : 0;
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];

    findings.push(this.createFinding('SINGLE_DOP_AGG', stageId, 'HIGH', `DOP=1, 耗时=${(elapsedMs / 1000).toFixed(1)}s (${timePct.toFixed(1)}%)`, { dop: 1, elapsedMs, timePct }));

    const p1 = 'cz.optimizer.incremental.df.three.phase.agg.enable';
    const p2 = 'cz.optimizer.df.enable.three.phase.agg';
    const threePhaseEnabled = settings[p1] === 'true' || settings[p2] === 'true';
    if (!threePhaseEnabled) {
      recommendations.push(this.buildRecommendationWithTableCheck(p1, 'true', 1,
        `Stage ${stageId} 耗时 ${(elapsedMs / 1000).toFixed(1)}s (占总耗时 ${timePct.toFixed(1)}%)，开启三阶段聚合可提升并行度`, 'HIGH', context));
    }
    return { findings, recommendations, insights };
  }
}

// ============================================================================
// TableSinkDop
// ============================================================================
export class TableSinkDop extends BaseRule {
  override name = 'tablesink_dop';
  override category = 'incremental/stage_optimization';
  override description = '检测 TableSink Stage 的 DOP 是否被自动调小';
  static readonly STAGE_PCT_THRESHOLD = 0.10;
  static readonly DOP_RATIO_THRESHOLD = 0.5;

  override check(stageData: Record<string, any>, context: Record<string, any>): boolean {
    if (!this.hasProfileData(context)) return false;
    const navigator = createStageNavigator(stageData);
    if (!navigator.hasOperator('TableSink')) return false;
    const plan = stageData.plan || {};
    let hasValidSink = false;
    for (const op of (plan.operators || []) as any[]) {
      if ('tableSink' in op) {
        const ts = op.tableSink || {};
        if ((ts.flags || 0) & 0x20) continue;
        const path: string[] = ts.table?.path || [];
        if (path.length === 4 && path[path.length - 1] === '__delta__') continue;
        hasValidSink = true; break;
      }
    }
    if (!hasValidSink) return false;
    const totalElapsedMs = context.totalJobTime || 0;
    if (!totalElapsedMs) return false;
    const metrics = stageData.metrics || {};
    return (metrics.elapsedMs || 0) / totalElapsedMs >= TableSinkDop.STAGE_PCT_THRESHOLD;
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    const stageId = stageData.stageId || 'unknown';
    const metrics = stageData.metrics || {};
    const settings = context.settings || {};
    const currentDop = metrics.actualDop || metrics.dop || 0;
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];

    const upstreamStages: string[] = stageData.upstreamStages || [];
    const alignedStages = context.alignedStages || {};
    const upstreamDops: number[] = [];
    for (const upId of upstreamStages) {
      const upMetrics = alignedStages[upId]?.metrics || {};
      const upDop = upMetrics.actualDop || upMetrics.dop || 0;
      if (upDop > 0) upstreamDops.push(upDop);
    }
    if (!upstreamDops.length) return { findings, recommendations, insights };

    const maxUpstream = Math.max(...upstreamDops);
    if (currentDop >= maxUpstream) return { findings, recommendations, insights };

    const dopRatio = currentDop / maxUpstream;
    if (dopRatio >= TableSinkDop.DOP_RATIO_THRESHOLD) return { findings, recommendations, insights };

    findings.push(this.createFinding('TABLESINK_DOP', stageId, 'MEDIUM',
      `TableSink actual_dop=${currentDop} 远小于上游 (max=${maxUpstream}, ratio=${dopRatio.toFixed(2)})`,
      { currentDop, maxUpstreamDop: maxUpstream, dopRatio }, 'high'));

    const param = 'cz.sql.enable.dag.auto.adaptive.split.size';
    if (settings[param] === 'true') {
      recommendations.push(this.buildRecommendationWithTableCheck(param, 'false', 2,
        `Stage ${stageId}: TableSink actual_dop=${currentDop} 可能被自动调小 (上游max=${maxUpstream})`, 'MEDIUM', context, settings[param],
        '该参数影响TableSink stage的DOP', stageId));
    }
    return { findings, recommendations, insights };
  }
}

// ============================================================================
// ResourceEfficiencyAnalysis
// ============================================================================
export class ResourceEfficiencyAnalysis extends BaseRule {
  override name = 'resource_efficiency_analysis';
  override category = 'incremental/stage_optimization';
  override description = '分析 Stage 资源效率';
  static readonly EFFICIENCY_RATIO_THRESHOLD = 2.0;
  static readonly MIN_STAGE_TIME_MS = 60000;

  override check(stageData: Record<string, any>, context: Record<string, any>): boolean {
    if (!this.hasProfileData(context)) return false;
    if (!stageData.profile?.taskSummary) return false;
    const vcCores = context.vcModeInfo?.vcCores || 0;
    if (vcCores <= 0) return false;
    return (stageData.metrics?.elapsedMs || 0) >= ResourceEfficiencyAnalysis.MIN_STAGE_TIME_MS;
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    const stageId = stageData.stageId || 'unknown';
    const profile = stageData.profile || {};
    const metrics = stageData.metrics || {};
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];
    const taskSummary = profile.taskSummary || {};
    if (!Object.keys(taskSummary).length) return { findings, recommendations, insights };

    const vcCores = context.vcModeInfo?.vcCores || 0;
    const elapsedMs = metrics.elapsedMs || 0;
    const totalJobTime = context.totalJobTime || 0;
    const stagePct = totalJobTime > 0 ? (elapsedMs / totalJobTime * 100) : 0;

    const taskTimesMs: number[] = [];
    for (const taskData of Object.values(taskSummary) as any[]) {
      const tStart = parseInt(taskData.startTime || '0') || 0;
      const tEnd = parseInt(taskData.endTime || '0') || 0;
      if (tEnd > tStart) taskTimesMs.push(tEnd - tStart);
    }
    if (!taskTimesMs.length) return { findings, recommendations, insights };

    const maxTaskTimeMs = Math.max(...taskTimesMs);
    const totalTasks = taskTimesMs.length;
    const rounds = vcCores > 0 ? Math.ceil(totalTasks / vcCores) : totalTasks;
    const estimatedMs = maxTaskTimeMs * rounds;
    if (estimatedMs <= 0) return { findings, recommendations, insights };

    const efficiencyRatio = elapsedMs / estimatedMs;
    if (efficiencyRatio >= ResourceEfficiencyAnalysis.EFFICIENCY_RATIO_THRESHOLD) {
      const severity = efficiencyRatio >= 3.0 ? 'HIGH' : 'MEDIUM';
      findings.push(this.createFinding('RESOURCE_INEFFICIENCY', stageId, severity,
        `Stage 实际耗时 ${(elapsedMs / 1000).toFixed(1)}s 是预期耗时 ${(estimatedMs / 1000).toFixed(1)}s 的 ${efficiencyRatio.toFixed(1)} 倍 (占整体 ${stagePct.toFixed(1)}%)`,
        { elapsedMs, estimatedMs, efficiencyRatio, maxTaskTimeMs, totalTasks, vcCores, rounds }, efficiencyRatio >= 3.0 ? 'high' : 'medium'));
      insights.push(this.createInsight(
        `Stage ${stageId}: 资源抢占或调度问题导致并发偏低，实际耗时 ${(elapsedMs / 1000).toFixed(1)}s，预期 ${(estimatedMs / 1000).toFixed(1)}s (最大task ${(maxTaskTimeMs / 1000).toFixed(1)}s × ${rounds}轮，VC 总资源 ${vcCores} cores)，实际/预期=${efficiencyRatio.toFixed(1)}x`,
        stageId, 'important'));
    }
    return { findings, recommendations, insights };
  }
}

// ============================================================================
// ActiveProblemFinding
// ============================================================================
export class ActiveProblemFinding extends BaseRule {
  override name = 'active_problem_finding';
  override category = 'incremental/stage_optimization';
  override description = '主动分析 Top 耗时 Stage 的瓶颈原因';
  static readonly MIN_STAGE_TIME_MS = 5000;
  static readonly SINGLE_OP_THRESHOLD = 80.0;

  override check(stageData: Record<string, any>, context: Record<string, any>): boolean {
    return this.hasProfileData(context);
  }

  override analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    const stageId = stageData.stageId || 'unknown';
    const metrics = stageData.metrics || {};
    const totalTime = context.totalJobTime || 0;
    const operatorAnalysis: any[] = context.operatorAnalysis || [];
    const elapsedMs = metrics.elapsedMs || 0;
    const timePct = totalTime ? (elapsedMs / totalTime * 100) : 0;
    const effectiveSpillGb = metrics.effectiveSpillGb || 0;
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];

    if (elapsedMs < ActiveProblemFinding.MIN_STAGE_TIME_MS) return { findings, recommendations, insights };

    const stageOps = operatorAnalysis.filter((op: any) => op.stageId === stageId).sort((a: any, b: any) => b.maxTimeMs - a.maxTimeMs);
    const bottleneck = stageOps[0] || null;
    const existingFindings = (context.allResults?.findings || []).filter((f: any) => f.stageId === stageId && f.rule !== this.name);
    const existingTypes = new Set(existingFindings.map((f: any) => f.type));
    const problems: any[] = [];

    if (bottleneck && bottleneck.skewRatio > 5.0 && !existingTypes.has('DATA_SKEW') && bottleneck.maxTimeMs >= 5000) {
      problems.push({ type: 'DATA_SKEW', description: `数据倾斜 ${bottleneck.skewRatio.toFixed(1)}x，瓶颈算子 ${bottleneck.operatorId} 耗时 ${(bottleneck.maxTimeMs / 1000).toFixed(1)}s`, suggestion: '检查数据分布', severity: 'HIGH' });
    }
    if (bottleneck && (bottleneck.stagePct || 0) > ActiveProblemFinding.SINGLE_OP_THRESHOLD) {
      problems.push({ type: 'SINGLE_OP_DOMINANT', description: `算子 ${bottleneck.operatorId} 占 Stage 耗时 ${bottleneck.stagePct.toFixed(1)}%`, suggestion: '检查算子逻辑和数据分布', severity: 'MEDIUM' });
    }

    const hasSkew = existingTypes.has('DATA_SKEW') || problems.some(p => p.type === 'DATA_SKEW');
    const hasSpill = existingTypes.has('STAGE_SPILLING') || existingTypes.has('OPERATOR_SPILLING') || effectiveSpillGb > 1.0;
    if (hasSkew && hasSpill) {
      problems.push({ type: 'CAUSAL_CHAIN', description: `数据倾斜导致 Spilling（${effectiveSpillGb.toFixed(2)} GB）`, suggestion: '优先解决数据倾斜（根因）', severity: 'HIGH' });
    }

    if (problems.length) {
      findings.push(this.createFinding('BOTTLENECK_ANALYSIS', stageId, timePct > 30 ? 'HIGH' : 'MEDIUM',
        `Stage 耗时 ${(elapsedMs / 1000).toFixed(1)}s (${timePct.toFixed(1)}%)`, { elapsedMs, timePct, problems }, 'high'));
      for (const p of problems) insights.push(this.createInsight(`Stage ${stageId}: ${p.description}. 建议: ${p.suggestion}`, stageId));
    }
    return { findings, recommendations, insights };
  }
}
