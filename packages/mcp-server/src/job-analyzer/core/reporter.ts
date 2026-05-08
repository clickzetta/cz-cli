/**
 * Reporter - Generates analysis reports
 */

export interface Finding { rule?: string; type: string; stageId: string; severity: string; description?: string; details?: Record<string, any>; confidence?: string; }
export interface Recommendation { rule?: string; type?: string; setting?: string; value?: string; priority?: number; reason?: string; impact?: string; currentValue?: string | null; warning?: string | null; title?: string; description?: string; action?: string; }
export interface Insight { rule?: string; message: string; stageId?: string | null; level?: string; category?: string; }

export class Reporter {
  findings: Finding[] = [];
  recommendations: Recommendation[] = [];
  insights: Insight[] = [];
  warnings: any[] = [];
  metadata: Record<string, any> = {};
  incrementalAlgorithms: Record<string, any> | null = null;

  addFinding(finding: Finding): void { this.findings.push(finding); }
  addRecommendation(recommendation: Recommendation): void { this.recommendations.push(recommendation); }
  addInsight(insight: Insight): void { this.insights.push(insight); }
  setMetadata(key: string, value: any): void { this.metadata[key] = value; }
  setIncrementalAlgorithms(data: Record<string, any>): void { this.incrementalAlgorithms = data; }

  mergeAnalysisResult(result: Record<string, any>): void {
    this.findings.push(...(result.findings || []));
    this.recommendations.push(...(result.recommendations || []));
    this.insights.push(...(result.insights || []));
  }

  generateConsoleReport(context: Record<string, any>, sections?: string[], showDetailInsights = false, analysisMode = 'quick'): string {
    if (!sections) sections = ['summary', 'recommendations'];
    if (analysisMode === 'detailed' || analysisMode === 'expert') showDetailInsights = true;

    const lines: string[] = ['='.repeat(80), 'Job 性能分析报告', '='.repeat(80)];

    if (sections.includes('summary')) {
      lines.push('\n[概况]');
      lines.push(`  SQL 类型: ${this.metadata.sqlType || 'Unknown'}`);
      lines.push(`  VC 模式: ${this.metadata.vcMode || 'Unknown'}`);
      const jobTotalTime = this.metadata.jobTotalTimeSeconds || 0;
      const stageTotalTime = this.metadata.stageTotalTimeSeconds || 0;
      if (jobTotalTime > 0 && stageTotalTime > 0) {
        lines.push(`  Job 总耗时: ${jobTotalTime.toFixed(2)}s (生命周期)`);
        lines.push(`  Stage 执行时间: ${stageTotalTime.toFixed(2)}s (Running 阶段)`);
      } else if (jobTotalTime > 0) {
        lines.push(`  总耗时: ${jobTotalTime.toFixed(2)}s`);
      } else if (stageTotalTime > 0) {
        lines.push(`  总耗时: ${stageTotalTime.toFixed(2)}s (Stage 执行)`);
      } else {
        lines.push(`  总耗时: ${(this.metadata.totalTimeSeconds || 0).toFixed(2)}s`);
      }
      lines.push(`  Stage 数: ${this.metadata.stageCount || 0}`);
      if (this.metadata.refreshType) lines.push(`  刷新类型: ${this.metadata.refreshType}`);
    }

    if (sections.includes('findings') && this.findings.length) {
      lines.push(`\n[发现问题] (${this.findings.length})`);
      for (const f of this.findings) {
        lines.push(`  [${f.severity}] ${f.type} - Stage ${f.stageId}`);
        if (f.description) lines.push(`         ${f.description}`);
      }
    }

    if (sections.includes('insights') && this.insights.length) {
      const sortedInsights = this.sortInsightsByStageTime(context);
      const importantInsights = sortedInsights.filter(i => i.level === 'important');
      const detailInsights = sortedInsights.filter(i => i.level !== 'important');

      if (showDetailInsights && detailInsights.length) {
        lines.push(`\n[补充洞察] (${detailInsights.length} 条，供深入分析参考)`);
        for (const insight of detailInsights.slice(0, 50)) lines.push(`  ℹ️  ${insight.message}`);
      }
      if (importantInsights.length) {
        lines.push(`\n[关键洞察] (${importantInsights.length} 条)`);
        for (const insight of importantInsights.slice(0, 20)) lines.push(`  💡 ${insight.message}`);
      }
    }

    if (sections.includes('recommendations')) {
      if (this.recommendations.length) {
        const uniqueRecs = this.deduplicateRecommendations();
        lines.push(`\n[参数建议] (${uniqueRecs.length})`);
        lines.push('='.repeat(80));
        for (let i = 0; i < uniqueRecs.length; i++) {
          const rec = uniqueRecs[i];
          const recType = rec.type || 'parameter';
          if (recType === 'rerun_job' || recType === 'contact_support') {
            lines.push(`\n${i + 1}. [优先级: ${rec.priority}] ${rec.title}`);
            lines.push(`   ${rec.description}`);
            if (rec.action) lines.push(`   操作: ${rec.action}`);
          } else {
            lines.push(`\n${i + 1}. [P${rec.priority}] [Impact: ${rec.impact}]`);
            lines.push(`   set ${rec.setting} = ${rec.value};`);
            if (rec.currentValue) lines.push(`   当前值: ${rec.currentValue}`);
            lines.push(`   理由: ${rec.reason}`);
            if (rec.warning) lines.push(`   ⚠️  ${rec.warning}`);
          }
        }
        lines.push('='.repeat(80));
      } else {
        lines.push('\n[参数建议]\n  ✓ 未发现需要调整的参数');
      }
    }

    return lines.join('\n');
  }

  generateJsonReport(context?: Record<string, any>, analysisMode = 'quick'): Record<string, any> {
    let filteredFindings = this.findings;
    let filteredInsights = this.insights;
    if (analysisMode === 'quick') {
      filteredFindings = this.findings.filter(f => !['INFO', 'LOW'].includes((f.severity || '').toUpperCase()));
      filteredInsights = this.insights.filter(i => i.level === 'important');
    }
    const sortedInsights = context ? this.sortInsightsByStageTime(context, filteredInsights) : filteredInsights;

    const report: Record<string, any> = {
      generatedAt: new Date().toISOString(),
      metadata: { ...this.metadata, analysisMode },
      findings: filteredFindings,
      warnings: this.warnings,
      recommendations: this.deduplicateRecommendations(),
      insights: sortedInsights,
    };

    if ((analysisMode === 'detailed' || analysisMode === 'expert') && context) {
      if (context.analysisScope) report.analysisScope = context.analysisScope;
      const stageSummary = this.buildStageSummary(context);
      if (stageSummary.length) report.stageSummary = stageSummary;
    }
    if (this.incrementalAlgorithms) report.incrementalAlgorithms = this.incrementalAlgorithms;
    return report;
  }

  private deduplicateRecommendations(): Recommendation[] {
    const unique: Record<string, Recommendation> = {};
    for (const rec of this.recommendations) {
      const recType = rec.type || 'parameter';
      if (recType === 'rerun_job' || recType === 'contact_support') {
        unique[`${recType}_${Object.keys(unique).length}`] = rec;
      } else {
        const setting = rec.setting || '';
        if (!unique[setting] || (rec.priority || 9) < (unique[setting].priority || 9)) unique[setting] = rec;
      }
    }
    return Object.values(unique).sort((a, b) => {
      const aIsSpecial = (a.type === 'rerun_job' || a.type === 'contact_support') ? 0 : 1;
      const bIsSpecial = (b.type === 'rerun_job' || b.type === 'contact_support') ? 0 : 1;
      if (aIsSpecial !== bIsSpecial) return aIsSpecial - bIsSpecial;
      return (a.priority || 9) - (b.priority || 9);
    });
  }

  private buildStageSummary(context: Record<string, any>): any[] {
    const allStageMetrics = context.allStageMetrics || {};
    const totalJobTime = context.totalJobTime || 0;
    const operatorAnalysis = context.operatorAnalysis || [];
    if (!Object.keys(allStageMetrics).length) return [];

    const sortedStages = Object.entries(allStageMetrics).sort((a: any, b: any) => (b[1].elapsedMs || 0) - (a[1].elapsedMs || 0));
    const opsByStage: Record<string, any[]> = {};
    for (const op of operatorAnalysis) {
      const sid = op.stageId;
      if (!opsByStage[sid]) opsByStage[sid] = [];
      opsByStage[sid].push(op);
    }

    const summary: any[] = [];
    for (const [stageId, metrics] of sortedStages) {
      const m = metrics as any;
      const elapsedMs = m.elapsedMs || 0;
      if (elapsedMs <= 0) continue;
      const pct = totalJobTime > 0 ? (elapsedMs / totalJobTime * 100) : 0;
      const entry: any = {
        stageId, elapsedS: Math.round(elapsedMs / 10) / 100, pct: Math.round(pct * 10) / 10,
        dop: m.dop || 0, inputBytes: m.inputBytes || 0, outputBytes: m.outputBytes || 0,
        effectiveSpillBytes: m.effectiveSpillBytes || 0,
      };
      if (m.totalTaskCount > 0) {
        entry.taskSkew = { active: m.activeTaskCount, total: m.totalTaskCount, skewRatio: Math.round((m.taskTimeSkewRatio || 1.0) * 100) / 100 };
      }
      const stageOps = opsByStage[stageId] || [];
      if (stageOps.length) {
        entry.topOperators = stageOps.slice(0, 3).map((op: any) => {
          const opEntry: any = { id: op.operatorId, maxS: Math.round((op.maxTimeMs || 0) / 10) / 100, stagePct: Math.round((op.stagePct || 0) * 10) / 10, skew: Math.round((op.skewRatio || 1.0) * 10) / 10 };
          if (op.rowCountMax > 0) { opEntry.maxRows = op.rowCountMax; if (op.rowSkewRatio > 1.5) opEntry.rowSkew = Math.round(op.rowSkewRatio * 10) / 10; }
          return opEntry;
        });
      }
      summary.push(entry);
    }
    return summary;
  }

  private sortInsightsByStageTime(context: Record<string, any>, insights?: Insight[]): Insight[] {
    const list = insights || this.insights;
    const stageMetrics = context.allStageMetrics || {};
    return [...list].sort((a, b) => {
      const aStage = a.stageId;
      const bStage = b.stageId;
      if (!aStage && !bStage) return 0;
      if (!aStage) return 1;
      if (!bStage) return -1;
      const aElapsed = stageMetrics[aStage]?.elapsedMs || 0;
      const bElapsed = stageMetrics[bStage]?.elapsedMs || 0;
      return bElapsed - aElapsed;
    });
  }
}
