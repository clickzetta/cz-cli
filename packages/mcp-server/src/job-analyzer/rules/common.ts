/**
 * Common Rules - Error analysis, job conflict detection, optimizer error detection,
 * CPU efficiency analysis, resource wait analysis, job profiling analysis
 */
import { BaseRule, GlobalRule } from "./base-rule.js";
import type { RuleResult } from "./base-rule.js";

// ============================================================================
// ErrorMessageCollector
// ============================================================================
export class ErrorMessageCollector extends GlobalRule {
  override name = 'error_message_collector';
  override category = 'error_analysis';
  override description = '收集 job_profile.json 中的所有错误信息';

  override analyzeGlobal(context: Record<string, any>): RuleResult {
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];
    if (!context.hasProfile) { context.errorMessages = []; return { findings, recommendations, insights, errorMessages: [] }; }

    const errorMessages: any[] = [];
    const rawProfile = context.rawProfile || {};
    if (rawProfile.jobStatus?.message && this.isErrorMessage(rawProfile.jobStatus.message)) {
      const parsed = this.parseJsonErrors(rawProfile.jobStatus.message);
      if (parsed.length) { for (const err of parsed) errorMessages.push({ location: 'job_status', message: err, rawMessage: rawProfile.jobStatus.message }); }
      else errorMessages.push({ location: 'job_status', message: rawProfile.jobStatus.message, rawMessage: rawProfile.jobStatus.message });
    }

    const alignedStages = context.alignedStages || {};
    for (const [stageId, stageData] of Object.entries(alignedStages) as [string, any][]) {
      const profile = stageData.profile || {};
      if (profile.message && this.isErrorMessage(profile.message)) {
        errorMessages.push({ location: 'stage', stageId, message: profile.message, rawMessage: profile.message });
      }
      for (const [taskId, taskData] of Object.entries(profile.taskSummary || {}) as [string, any][]) {
        if (taskData.message && this.isErrorMessage(taskData.message)) {
          errorMessages.push({ location: 'task', stageId, taskId, message: taskData.message, rawMessage: taskData.message });
        }
      }
    }

    const refined = this.refineErrorMessages(errorMessages);
    context.errorMessages = refined;
    context.rawErrorMessages = errorMessages;

    if (refined.length) {
      const types = this.categorizeErrors(refined);
      insights.push({ category: 'error_analysis', message: `收集到 ${errorMessages.length} 条错误信息（去重后 ${refined.length} 条）。错误类型: ${types.join(', ')}` });
    }
    return { findings, recommendations, insights, errorMessages: refined };
  }

  private isErrorMessage(message: string): boolean {
    if (!message) return false;
    try { const obj = JSON.parse(message); if (obj?.errors?.length) return true; } catch {}
    const keywords = ['error', 'exception', 'failed', 'failure', 'conflict', 'timeout', 'abort', 'cancel', 'invalid', 'illegal', 'denied', 'forbidden', 'unauthorized', 'not found', 'out of memory', 'oom', 'overflow'];
    return keywords.some(k => message.toLowerCase().includes(k));
  }

  private parseJsonErrors(message: string): string[] {
    try {
      const obj = JSON.parse(message);
      if (obj?.errors) {
        return obj.errors.map((err: any) => {
          const parts: string[] = [];
          if (err.category) parts.push(`[${err.category}]`);
          if (err.errorCode) parts.push(`(${err.errorCode})`);
          if (err.line && err.col) parts.push(`Line ${err.line}, Col ${err.col}:`);
          if (err.message) parts.push(err.message);
          return parts.join(' ');
        });
      }
    } catch {}
    return [];
  }

  private refineErrorMessages(errors: any[]): any[] {
    const seen = new Set<string>();
    return errors.filter(e => { if (seen.has(e.message)) return false; seen.add(e.message); return true; })
      .map(e => ({ ...e, refinedMessage: e.message.length > 500 ? e.message.substring(0, 500) + '. . .' : e.message }));
  }

  private categorizeErrors(errors: any[]): string[] {
    const types = new Set<string>();
    for (const e of errors) {
      const m = e.message.toLowerCase();
      if (m.includes('conflict')) types.add('冲突错误');
      else if (m.includes('timeout')) types.add('超时错误');
      else if (m.includes('out of memory') || m.includes('oom')) types.add('内存错误');
      else if (m.includes('not found')) types.add('资源未找到');
      else if (m.includes('denied') || m.includes('forbidden')) types.add('权限错误');
      else if (m.includes('invalid') || m.includes('illegal')) types.add('参数错误');
      else types.add('其他错误');
    }
    return [...types].sort();
  }
}

// ============================================================================
// JobConflictDetection
// ============================================================================
export class JobConflictDetection extends GlobalRule {
  override name = 'job_conflict_detection';
  override category = 'error_analysis';
  override description = '检测 Job 提交冲突报错';

  override analyzeGlobal(context: Record<string, any>): RuleResult {
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];
    if (!context.hasProfile) return { findings, recommendations, insights };
    const errorMessages: any[] = context.errorMessages || [];
    if (!errorMessages.length) return { findings, recommendations, insights };

    const conflictErrors: any[] = [];
    const conflictJobIds = new Set<string>();
    for (const error of errorMessages) {
      const message = error.message || '';
      if (message.toLowerCase().includes('conflicts with another concurrent job which updates')) {
        conflictErrors.push(error);
        const matches = message.match(/(?:job\s+['"]|concurrent\s+job\s+['"])([0-9]{17,20}_[a-z]_[a-f0-9]+|[0-9]{17,30}[a-z0-9]+)['"]/gi) || [];
        for (const m of matches) { const id = m.replace(/.*['"]([^'"]+)['"].*/, '$1'); if (id) conflictJobIds.add(id); }
      }
    }

    if (conflictErrors.length) {
      const compactionJobs = [...conflictJobIds].filter(id => id.includes('_b_'));
      const regularJobs = [...conflictJobIds].filter(id => !id.includes('_b_'));

      findings.push({ type: 'job_conflict_error', severity: 'high', title: 'Job 提交冲突错误',
        description: `检测到 Job 提交冲突错误。此 Job 与另一个并发 Job 发生了更新冲突。`,
        evidence: { conflictCount: conflictErrors.length, conflictJobIds: [...conflictJobIds], compactionJobs, regularJobs }
      });

      recommendations.push({ type: 'rerun_job', priority: 'high', title: '重新运行 Job',
        description: '由于检测到提交冲突错误，建议重新运行整个 Job。', action: '重新提交并运行此 Job' });
      insights.push({ category: 'error_analysis', message: `检测到 ${conflictErrors.length} 处提交冲突错误。这通常发生在多个 Job 并发更新同一张表时。` });
    }
    return { findings, recommendations, insights };
  }
}

// ============================================================================
// OptimizerErrorDetection
// ============================================================================
export class OptimizerErrorDetection extends GlobalRule {
  override name = 'optimizer_error_detection';
  override category = 'error_analysis';
  override description = '检测优化器内部错误';

  override analyzeGlobal(context: Record<string, any>): RuleResult {
    const findings: any[] = [], recommendations: any[] = [], insights: any[] = [];
    if (!context.hasProfile) return { findings, recommendations, insights };
    const errorMessages: any[] = context.errorMessages || [];
    if (!errorMessages.length) return { findings, recommendations, insights };

    const optimizerErrors = errorMessages.filter((e: any) => e.message.toLowerCase().includes('optimizer internal error'));
    if (optimizerErrors.length) {
      findings.push({ type: 'optimizer_internal_error', severity: 'high', title: '优化器内部错误',
        description: `检测到优化器内部错误。`, evidence: { errorCount: optimizerErrors.length } });

      const settings = context.settings || {};
      if (settings['cz.sql.playback.scratch']?.toLowerCase() !== 'true') {
        recommendations.push({ type: 'rerun_job', priority: 'high', title: '设置参数后重新运行 Job',
          description: '需要设置 set cz.sql.playback.scratch=true 后重新运行此 Job。',
          action: '1. 设置 set cz.sql.playback.scratch=true\n   2. 重新提交并运行此 Job' });
      } else {
        recommendations.push({ type: 'contact_support', priority: 'high', title: '联系技术支持',
          description: 'playback 功能已启用，建议联系技术支持进行问题定位。', action: '收集 playback 信息并联系技术支持团队' });
      }
      insights.push({ category: 'error_analysis', message: `检测到 ${optimizerErrors.length} 处优化器内部错误。` });
    }
    return { findings, recommendations, insights };
  }
}

// ============================================================================
// CpuEfficiencyAnalysis
// ============================================================================
export class CpuEfficiencyAnalysis extends GlobalRule {
  override name = 'cpu_efficiency_analysis';
  override category = 'common';
  override description = '分析 Operator CPU 效率，识别 I/O 瓶颈';
  static readonly CPU_RATIO_THRESHOLD = 0.3;
  static readonly MIN_WALL_TIME_SUM_MS = 1000;

  override analyzeGlobal(context: Record<string, any>): RuleResult {
    const statsSummary = context.extraFiles?.statsSummary;
    if (!statsSummary) return { findings: [], recommendations: [], insights: [] };
    const findings: any[] = [], insights: any[] = [];
    const lowEfficiencyOps: any[] = [];

    for (const [stageKey, operators] of Object.entries(statsSummary) as [string, any][]) {
      const stageId = stageKey.includes(' ') ? stageKey.split(' ')[0] : stageKey;
      for (const [opName, stats] of Object.entries(operators) as [string, any][]) {
        if (opName === 'pipeline_stats') continue;
        const wallStr = stats['wall_time[min/max/avg/sum](ms)'] || '';
        const cpuStr = stats['cpu_time[min/max/avg/sum](ms)'] || '';
        if (!wallStr || !cpuStr) continue;
        const wallSum = this.parseSum(wallStr);
        const cpuSum = this.parseSum(cpuStr);
        if (wallSum < CpuEfficiencyAnalysis.MIN_WALL_TIME_SUM_MS) continue;
        const ratio = wallSum > 0 ? cpuSum / wallSum : 1.0;
        if (ratio < CpuEfficiencyAnalysis.CPU_RATIO_THRESHOLD) {
          lowEfficiencyOps.push({ stageId, operator: opName, cpuRatio: ratio, wallSumMs: wallSum, cpuSumMs: cpuSum });
        }
      }
    }

    if (!lowEfficiencyOps.length) return { findings, recommendations: [], insights };
    lowEfficiencyOps.sort((a, b) => b.wallSumMs - a.wallSumMs);
    const topOps = lowEfficiencyOps.slice(0, 10);
    const lines = [`CPU 效率分析（cpu_time/wall_time 低于 ${CpuEfficiencyAnalysis.CPU_RATIO_THRESHOLD * 100}%）:`];
    for (const op of topOps) {
      const waitMs = op.wallSumMs - op.cpuSumMs;
      lines.push(`  ${op.stageId}/${op.operator}: CPU 占比 ${(op.cpuRatio * 100).toFixed(0)}%, wall_sum=${(op.wallSumMs / 1000).toFixed(1)}s, 等待时间≈${(waitMs / 1000).toFixed(1)}s`);
    }
    insights.push(this.createInsight(lines.join('\n'), null, 'important'));
    const worst = topOps[0];
    findings.push(this.createFinding('LOW_CPU_EFFICIENCY', worst.stageId, 'MEDIUM',
      `${worst.stageId}/${worst.operator} CPU 效率仅 ${(worst.cpuRatio * 100).toFixed(0)}%`, { lowEfficiencyOperators: topOps }));
    return { findings, recommendations: [], insights };
  }

  private parseSum(valueStr: string): number {
    const s = valueStr.replace(/[\[\]\s]/g, '');
    const parts = s.split('/');
    if (parts.length >= 4) { const v = parseFloat(parts[3]); if (!isNaN(v)) return v; }
    return 0;
  }
}

// ============================================================================
// ResourceWaitAnalysis
// ============================================================================
export class ResourceWaitAnalysis extends GlobalRule {
  override name = 'resource_wait_analysis';
  override category = 'common';
  override description = '分析 Task 资源等待时间，识别调度瓶颈';
  static readonly MIN_WAIT_TIME_MS = 1000;

  override analyzeGlobal(context: Record<string, any>): RuleResult {
    const dagSummary = context.extraFiles?.dagSummary;
    if (!dagSummary) return { findings: [], recommendations: [], insights: [] };
    const stageProgress = dagSummary.stageProgress || {};
    if (!Object.keys(stageProgress).length) return { findings: [], recommendations: [], insights: [] };

    const findings: any[] = [], insights: any[] = [];
    const stageWaitStats: any[] = [];

    for (const [stageId, stageInfo] of Object.entries(stageProgress) as [string, any][]) {
      const taskProgress = stageInfo.taskProgress || {};
      if (!Object.keys(taskProgress).length) continue;
      const waitTimes: number[] = [], execTimes: number[] = [];
      for (const tinfo of Object.values(taskProgress) as any[]) {
        for (const att of (tinfo.attempts || []) as any[]) {
          const wr = att.timeOnWaitResource || {};
          if (wr.startTime && wr.endTime) waitTimes.push(parseInt(wr.endTime) - parseInt(wr.startTime));
          const te = att.timeOnExecutor || {};
          if (te.startTime && te.endTime) execTimes.push(parseInt(te.endTime) - parseInt(te.startTime));
        }
      }
      if (!waitTimes.length) continue;
      const maxWait = Math.max(...waitTimes);
      if (maxWait >= ResourceWaitAnalysis.MIN_WAIT_TIME_MS) {
        const avgWait = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;
        const maxExec = execTimes.length ? Math.max(...execTimes) : 0;
        const avgExec = execTimes.length ? execTimes.reduce((a, b) => a + b, 0) / execTimes.length : 0;
        stageWaitStats.push({ stageId, taskCount: Object.keys(taskProgress).length, waitMaxMs: maxWait, waitAvgMs: avgWait, execMaxMs: maxExec, execAvgMs: avgExec, waitRatio: (avgWait + avgExec) > 0 ? avgWait / (avgWait + avgExec) : 0 });
      }
    }

    if (!stageWaitStats.length) return { findings: [], recommendations: [], insights: [] };
    stageWaitStats.sort((a, b) => b.waitMaxMs - a.waitMaxMs);
    const lines = ['Task 资源等待时间分析:'];
    for (const s of stageWaitStats) lines.push(`  ${s.stageId} (${s.taskCount} tasks): 等待 max=${(s.waitMaxMs / 1000).toFixed(1)}s avg=${(s.waitAvgMs / 1000).toFixed(1)}s, 等待占比=${(s.waitRatio * 100).toFixed(0)}%`);
    insights.push(this.createInsight(lines.join('\n'), null, 'important'));

    const worst = stageWaitStats[0];
    if (worst.waitRatio > 0.3) {
      findings.push(this.createFinding('HIGH_RESOURCE_WAIT', worst.stageId, worst.waitRatio > 0.5 ? 'HIGH' : 'MEDIUM',
        `${worst.stageId} 资源等待占比 ${(worst.waitRatio * 100).toFixed(0)}%`, { stageWaitStats }));
    }
    return { findings, recommendations: [], insights };
  }
}

// ============================================================================
// JobProfilingAnalysis
// ============================================================================
export class JobProfilingAnalysis extends GlobalRule {
  override name = 'job_profiling_analysis';
  override category = '性能分析';
  override description = 'Job 生命周期分析';

  override analyzeGlobal(context: Record<string, any>): RuleResult {
    const parser = context.parser;
    if (!parser) return { findings: [], recommendations: [], insights: [] };
    const profiling = parser.getJobProfilingAnalysis();
    if (!profiling?.phases?.length) return { findings: [], recommendations: [], insights: [] };

    const insights: any[] = [];
    insights.push(`Job 生命周期总耗时: ${profiling.totalTimeSec.toFixed(1)}s`);
    const sortedPhases = [...profiling.phases].sort((a: any, b: any) => b.durationMs - a.durationMs);
    for (const phase of sortedPhases) {
      const timeStr = phase.durationSec < 1 ? `${phase.durationMs.toFixed(0)}ms` : `${phase.durationSec.toFixed(2)}s`;
      insights.push(`  ${phase.name}: ${timeStr} (${phase.percentage.toFixed(1)}%)`);
    }
    return { findings: [], recommendations: [], insights };
  }
}
