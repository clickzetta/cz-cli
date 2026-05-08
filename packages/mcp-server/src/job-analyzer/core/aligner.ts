/**
 * Stage Aligner - Aligns Plan and Profile stage data
 */
import { logger } from '../../logger.js';

export interface AlignedData {
  alignedStages: Record<string, any>;
  stageMetrics: Record<string, any>;
  operatorAnalysis: any[];
  totalJobTime: number;
  stageDependencies: Record<string, string[]>;
  globalTaskTimeline: [number, number][];
  perStageTaskTimeline: Record<string, [number, number][]>;
}

export class StageAligner {
  static readonly IDLE_TASK_MAX_TIME_MS = 500;
  static readonly IDLE_TASK_MAX_INPUT_BYTES = 65536;
  static readonly IGNORABLE_SPILL_PATTERNS = ['ShuffleWrite', 'ShuffleExchange', 'Exchange'];

  private planStages: Record<string, any>;
  private profileStages: Record<string, any>;
  private hasProfile: boolean;
  private alignedStages: Record<string, any> = {};
  private stageMetrics: Record<string, any> = {};
  private operatorAnalysis: any[] = [];
  private totalJobTime = 0;
  private stageDependencies: Record<string, string[]> = {};
  private globalTaskTimeline: [number, number][] = [];
  private perStageTaskTimeline: Record<string, [number, number][]> = {};

  constructor(parsedData: Record<string, any>) {
    this.planStages = parsedData.planStages || {};
    this.profileStages = parsedData.profileStages || {};
    this.hasProfile = parsedData.hasProfile || false;
  }

  align(): AlignedData {
    this.calculateStageMetrics();
    this.parseStageDepedencies();
    this.alignStages();
    this.analyzeOperators();
    this.buildGlobalTaskTimeline();
    return {
      alignedStages: this.alignedStages,
      stageMetrics: this.stageMetrics,
      operatorAnalysis: this.operatorAnalysis,
      totalJobTime: this.totalJobTime,
      stageDependencies: this.stageDependencies,
      globalTaskTimeline: this.globalTaskTimeline,
      perStageTaskTimeline: this.perStageTaskTimeline,
    };
  }

  private calculateStageMetrics(): void {
    if (!this.hasProfile) return;
    let minStartTime = Infinity;
    let maxEndTime = 0;

    for (const [stageId, stageData] of Object.entries(this.profileStages)) {
      try {
        const taskCountDetail = stageData.taskCountDetail || {};
        let actualDop: number;
        if (Object.keys(taskCountDetail).length) {
          actualDop = Object.values(taskCountDetail).reduce((sum: number, c: any) => sum + parseInt(String(c)) || 0, 0);
        } else {
          actualDop = parseInt(stageData.taskCount || '0') || 0;
        }
        if (actualDop === 0) actualDop = 1;

        let planDop = 1;
        if (this.planStages[stageId]) planDop = parseInt(this.planStages[stageId].dop || '1') || 1;

        const startTime = parseInt(stageData.startTime || '0') || 0;
        const endTime = parseInt(stageData.endTime || '0') || 0;
        const elapsedMs = endTime - startTime;
        const ioStats = stageData.inputOutputStats || {};

        this.stageMetrics[stageId] = {
          elapsedMs, dop: actualDop, actualDop, planDop,
          inputBytes: parseInt(ioStats.inputBytes || '0') || 0,
          outputBytes: parseInt(ioStats.outputBytes || '0') || 0,
          spillBytes: parseInt(ioStats.spillingBytes || '0') || 0,
        };

        const taskSkew = this.computeTaskTimeSkew(stageData.taskSummary || {});
        Object.assign(this.stageMetrics[stageId], taskSkew);

        if (startTime > 0) minStartTime = Math.min(minStartTime, startTime);
        if (endTime > 0) maxEndTime = Math.max(maxEndTime, endTime);
      } catch (e: any) {
        this.stageMetrics[stageId] = {
          elapsedMs: 0, dop: 1, actualDop: 1, planDop: 1,
          inputBytes: 0, outputBytes: 0, spillBytes: 0,
          effectiveSpillBytes: 0, effectiveSpillGb: 0, operatorSpills: [],
        };
      }
    }

    if (minStartTime !== Infinity && maxEndTime > 0) {
      this.totalJobTime = maxEndTime - minStartTime;
    }
  }

  private isIdleTask(taskData: Record<string, any>): boolean {
    const ioStats = taskData.inputOutputStats || {};
    const inputRowCount = parseInt(ioStats.inputRowCount || '0') || 0;
    const inputBytes = parseInt(ioStats.inputBytes || '0') || 0;
    const startTime = parseInt(taskData.startTime || '0') || 0;
    const endTime = parseInt(taskData.endTime || '0') || 0;
    const elapsedMs = endTime > 0 && startTime > 0 ? endTime - startTime : 0;
    return elapsedMs < StageAligner.IDLE_TASK_MAX_TIME_MS && inputRowCount === 0 && inputBytes <= StageAligner.IDLE_TASK_MAX_INPUT_BYTES;
  }

  private computeTaskTimeSkew(taskSummary: Record<string, any>): Record<string, any> {
    const empty = {
      activeTaskCount: 0, totalTaskCount: 0, activeTaskRatio: 0,
      taskTimeSkewRatio: 1.0, taskTimeMaxMedianRatio: 1.0,
      activeMaxMs: 0, activeAvgMs: 0, activeMedianMs: 0,
      dataSkewMaxMedianRatio: 1.0, dataSkewConcentrationRatio: 1.0,
      dataSkewTopKTasks: 0, dataSkewMaxRows: 0, dataSkewMedianRows: 0,
    };
    if (!taskSummary || !Object.keys(taskSummary).length) return empty;

    const total = Object.keys(taskSummary).length;
    const activeElapsed: number[] = [];
    const activeInputRows: number[] = [];

    for (const taskData of Object.values(taskSummary) as any[]) {
      if (!this.isIdleTask(taskData)) {
        const start = parseInt(taskData.startTime || '0') || 0;
        const end = parseInt(taskData.endTime || '0') || 0;
        activeElapsed.push(end > 0 && start > 0 ? end - start : 0);
        const ioStats = taskData.inputOutputStats || {};
        activeInputRows.push(parseInt(ioStats.inputRowCount || '0') || 0);
      }
    }

    const activeCount = activeElapsed.length;
    if (activeCount === 0) { return { ...empty, totalTaskCount: total }; }

    const activeMax = Math.max(...activeElapsed);
    const activeAvg = activeElapsed.reduce((a, b) => a + b, 0) / activeCount;
    const timeSkewRatio = activeAvg > 0 ? activeMax / activeAvg : 1.0;

    const sortedElapsed = [...activeElapsed].sort((a, b) => a - b);
    let activeMedian: number;
    if (activeCount % 2 === 1) activeMedian = sortedElapsed[Math.floor(activeCount / 2)];
    else activeMedian = Math.floor((sortedElapsed[activeCount / 2 - 1] + sortedElapsed[activeCount / 2]) / 2);
    const timeMaxMedianRatio = activeMedian > 0 ? activeMax / activeMedian : Infinity;

    const dataSkew = StageAligner.computeDataSkew(activeInputRows);

    return {
      activeTaskCount: activeCount, totalTaskCount: total,
      activeTaskRatio: activeCount / total,
      taskTimeSkewRatio: timeSkewRatio, taskTimeMaxMedianRatio: timeMaxMedianRatio,
      activeMaxMs: activeMax, activeAvgMs: activeAvg, activeMedianMs: activeMedian,
      ...dataSkew,
    };
  }

  static computeDataSkew(inputRows: number[]): Record<string, any> {
    const n = inputRows.length;
    if (n === 0) return { dataSkewMaxMedianRatio: 1.0, dataSkewConcentrationRatio: 1.0, dataSkewTopKTasks: 0, dataSkewMaxRows: 0, dataSkewMedianRows: 0 };

    const sortedRows = [...inputRows].sort((a, b) => b - a);
    const maxRows = sortedRows[0];
    let medianRows: number;
    if (n % 2 === 1) medianRows = sortedRows[Math.floor(n / 2)];
    else medianRows = Math.floor((sortedRows[n / 2 - 1] + sortedRows[n / 2]) / 2);
    const maxMedianRatio = medianRows > 0 ? maxRows / medianRows : Infinity;

    const totalRows = sortedRows.reduce((a, b) => a + b, 0);
    if (totalRows === 0) return { dataSkewMaxMedianRatio: 1.0, dataSkewConcentrationRatio: 1.0, dataSkewTopKTasks: n, dataSkewMaxRows: 0, dataSkewMedianRows: 0 };

    const threshold = totalRows * 0.8;
    let cumsum = 0, topK = 0;
    for (const rows of sortedRows) {
      cumsum += rows; topK++;
      if (cumsum >= threshold) break;
    }

    return { dataSkewMaxMedianRatio: maxMedianRatio, dataSkewConcentrationRatio: topK / n, dataSkewTopKTasks: topK, dataSkewMaxRows: maxRows, dataSkewMedianRows: medianRows };
  }

  private parseStageDepedencies(): void {
    const operatorToStage: Record<string, string> = {};
    for (const [stageId, plan] of Object.entries(this.planStages)) {
      for (const op of (plan.operators || []) as any[]) {
        if (op.id) operatorToStage[op.id] = stageId;
      }
    }

    for (const [stageId, plan] of Object.entries(this.planStages)) {
      const upstreamStages: string[] = [];
      if (plan.inputStages) upstreamStages.push(...plan.inputStages);
      if (plan.inputs) {
        for (const inp of plan.inputs) {
          if (typeof inp === 'object' && inp.stageId) upstreamStages.push(inp.stageId);
          else if (typeof inp === 'string') upstreamStages.push(inp);
        }
      }
      for (const op of (plan.operators || []) as any[]) {
        if (op.exchange) {
          if (op.exchange.inputStageId) upstreamStages.push(op.exchange.inputStageId);
          else if (op.exchange.input?.stageId) upstreamStages.push(op.exchange.input.stageId);
        }
        for (const inputId of (op.inputIds || []) as string[]) {
          if (operatorToStage[inputId] && operatorToStage[inputId] !== stageId) {
            upstreamStages.push(operatorToStage[inputId]);
          }
        }
      }
      this.stageDependencies[stageId] = [...new Set(upstreamStages)];
    }
  }

  private alignStages(): void {
    for (const stageId of Object.keys(this.planStages)) {
      const planData = this.planStages[stageId];
      const planOperators = planData.operators || [];
      if (this.hasProfile && this.profileStages[stageId]) {
        this.alignedStages[stageId] = {
          stageId, plan: planData, profile: this.profileStages[stageId],
          metrics: this.stageMetrics[stageId] || {},
          upstreamStages: this.stageDependencies[stageId] || [],
          planOperators,
        };
      } else {
        this.alignedStages[stageId] = {
          stageId, plan: planData, profile: {}, metrics: {},
          upstreamStages: this.stageDependencies[stageId] || [],
          planOperators,
        };
      }
    }
  }

  private analyzeOperators(): void {
    if (!this.hasProfile) return;

    for (const [stageId, stageData] of Object.entries(this.alignedStages)) {
      const profile = stageData.profile || {};
      const metrics = stageData.metrics || {};
      if (!profile.operatorSummary) continue;

      const operatorSpills: any[] = [];
      let effectiveSpillBytes = 0;
      let scanSplitCntMax = 0;
      let scanSplitCntAvg = 0;

      for (const [opId, opData] of Object.entries(profile.operatorSummary) as [string, any][]) {
        try {
          const wallTime = opData.wallTimeNs || {};
          const maxMs = (parseInt(wallTime.max || '0') || 0) / 1_000_000;
          const minMs = (parseInt(wallTime.min || '0') || 0) / 1_000_000;
          const avgMs = (parseInt(wallTime.avg || '0') || 0) / 1_000_000;
          const stageElapsed = metrics.elapsedMs || 1;

          const activeRatio = metrics.activeTaskRatio ?? 1.0;
          const stageTaskSkew = metrics.taskTimeSkewRatio ?? 1.0;
          const opSkewRatio = activeRatio < 0.5 ? stageTaskSkew : (avgMs > 0 ? maxMs / avgMs : 1.0);

          const rowCountStats = opData.rowCount || {};
          const rowCountMax = parseInt(rowCountStats.max || '0') || 0;
          const rowCountMin = parseInt(rowCountStats.min || '0') || 0;
          const rowCountAvg = parseInt(rowCountStats.avg || '0') || 0;
          const rowCountSum = parseInt(rowCountStats.sum || '0') || 0;
          const rowSkewRatio = rowCountAvg > 0 ? rowCountMax / rowCountAvg : 1.0;

          const spillBytes = StageAligner.extractOperatorSpillBytes(opData);
          const isShuffle = StageAligner.IGNORABLE_SPILL_PATTERNS.some(p => opId.includes(p));

          if (spillBytes > 0) {
            operatorSpills.push({ operatorId: opId, spillBytes, spillGb: spillBytes / (1024 ** 3), isShuffle });
            if (!isShuffle) effectiveSpillBytes += spillBytes;
          }

          const opIdLower = opId.toLowerCase();
          if (opIdLower.includes('scan') || opIdLower.includes('tablescan')) {
            const tss = opData.tableScanSummary || {};
            const splitCntStats = tss.splitCnt || {};
            if (Object.keys(splitCntStats).length) {
              const scMax = parseInt(splitCntStats.max || '0') || 0;
              const scAvg = parseFloat(splitCntStats.avg || '0') || 0;
              if (scMax > scanSplitCntMax) scanSplitCntMax = scMax;
              if (scAvg > scanSplitCntAvg) scanSplitCntAvg = scAvg;
            }
          }

          this.operatorAnalysis.push({
            stageId, operatorId: opId, maxTimeMs: maxMs,
            minTimeMs: minMs > 0 ? minMs : null, avgTimeMs: avgMs,
            stagePct: stageElapsed ? (maxMs / stageElapsed * 100) : 0,
            totalPct: this.totalJobTime ? (maxMs / this.totalJobTime * 100) : 0,
            skewRatio: opSkewRatio,
            rowCountMax, rowCountMin: rowCountMin > 0 ? rowCountMin : null,
            rowCountAvg, rowCountSum, rowSkewRatio,
            spillBytes, isShuffle, operatorData: opData,
          });
        } catch (e: any) { /* skip */ }
      }

      if (this.stageMetrics[stageId]) {
        this.stageMetrics[stageId].effectiveSpillBytes = effectiveSpillBytes;
        this.stageMetrics[stageId].effectiveSpillGb = effectiveSpillBytes / (1024 ** 3);
        this.stageMetrics[stageId].operatorSpills = operatorSpills.sort((a, b) => b.spillBytes - a.spillBytes);
        if (scanSplitCntMax > 0) {
          this.stageMetrics[stageId].scanSplitCntMax = scanSplitCntMax;
          this.stageMetrics[stageId].scanSplitCntAvg = scanSplitCntAvg;
        }
      }
    }

    this.operatorAnalysis.sort((a, b) => b.maxTimeMs - a.maxTimeMs);
  }

  static extractOperatorSpillBytes(opData: Record<string, any>): number {
    let spillBytes = 0;
    if (opData.spillStats) {
      const ss = opData.spillStats;
      if (typeof ss === 'object') spillBytes = parseInt(ss.spillingBytes || '0') || 0;
      else if (typeof ss === 'number') spillBytes = ss;
    }
    if (opData.inputOutputStats) {
      const ioSpill = parseInt(opData.inputOutputStats.spillingBytes || '0') || 0;
      spillBytes = Math.max(spillBytes, ioSpill);
    }
    return spillBytes;
  }

  private buildGlobalTaskTimeline(): void {
    if (!this.hasProfile) return;
    const globalEvents: [number, number][] = [];

    for (const [stageId, stageData] of Object.entries(this.profileStages)) {
      const taskSummary = stageData.taskSummary || {};
      const stageEvents: [number, number][] = [];
      for (const taskData of Object.values(taskSummary) as any[]) {
        const tStart = parseInt(taskData.startTime || '0') || 0;
        const tEnd = parseInt(taskData.endTime || '0') || 0;
        if (tEnd > tStart) {
          globalEvents.push([tStart, 1], [tEnd, -1]);
          stageEvents.push([tStart, 1], [tEnd, -1]);
        }
      }
      this.perStageTaskTimeline[stageId] = StageAligner.eventsToTimeline(stageEvents);
    }
    this.globalTaskTimeline = StageAligner.eventsToTimeline(globalEvents);
  }

  static eventsToTimeline(events: [number, number][]): [number, number][] {
    if (!events.length) return [];
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const timeline: [number, number][] = [];
    let current = 0, i = 0;
    while (i < events.length) {
      const ts = events[i][0];
      while (i < events.length && events[i][0] === ts) { current += events[i][1]; i++; }
      timeline.push([ts, current]);
    }
    return timeline;
  }

  getTopStages(n = 10): [string, any][] {
    return Object.entries(this.stageMetrics).sort((a, b) => (b[1].elapsedMs || 0) - (a[1].elapsedMs || 0)).slice(0, n);
  }

  getTopOperators(n = 10): any[] {
    return this.operatorAnalysis.slice(0, n);
  }

  getUpstreamStages(stageId: string): string[] {
    return this.stageDependencies[stageId] || [];
  }

  getUpstreamDops(stageId: string): number[] {
    return this.getUpstreamStages(stageId)
      .map(id => this.stageMetrics[id]?.dop || 0)
      .filter(d => d > 0);
  }
}
