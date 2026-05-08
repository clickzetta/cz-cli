/**
 * Base Rule - Abstract base class for all optimization rules
 */

export interface RuleResult {
  findings: any[];
  recommendations: any[];
  insights: any[];
  [key: string]: any;
}

export abstract class BaseRule {
  name = 'base_rule';
  category = 'unknown';
  description = '';
  ruleScope = 'stage';
  context: Record<string, any> = {};

  abstract check(stageData: Record<string, any>, context: Record<string, any>): boolean;
  abstract analyze(stageData: Record<string, any>, context: Record<string, any>): RuleResult;

  getSetting(setting: string, context: Record<string, any>): string | undefined {
    return (context.settings || {})[setting];
  }

  hasSetting(setting: string, context: Record<string, any>): boolean {
    return setting in (context.settings || {});
  }

  hasProfileData(context: Record<string, any>): boolean {
    return context.hasProfile || false;
  }

  createRecommendation(setting: string, value: string, priority: number, reason: string, impact = 'MEDIUM', currentValue?: string | null, warning?: string | null): Record<string, any> {
    return { rule: this.name, setting, value, priority, reason, impact, currentValue: currentValue ?? null, warning: warning ?? null };
  }

  createFinding(findingType: string, stageId: string, severity: string, description = '', details?: Record<string, any>, confidence = 'high'): Record<string, any> {
    return { rule: this.name, type: findingType, stageId, severity, description, details: details || {}, confidence };
  }

  createInsight(message: string, stageId?: string | null, level = 'detail'): Record<string, any> {
    return { rule: this.name, message, stageId: stageId ?? null, level };
  }

  addAnalysisDetail(context: Record<string, any>, key: string, value: any, stageId?: string): void {
    if (!context.analysisScope) context.analysisScope = {};
    if (!context.analysisScope[this.name]) context.analysisScope[this.name] = {};
    if (stageId) {
      if (!context.analysisScope[this.name][stageId]) context.analysisScope[this.name][stageId] = {};
      context.analysisScope[this.name][stageId][key] = value;
    } else {
      context.analysisScope[this.name][key] = value;
    }
  }

  getRefreshTableProperties(context: Record<string, any>): Record<string, string> {
    const alignedStages = context.alignedStages || {};
    for (const stageData of Object.values(alignedStages) as any[]) {
      const plan = stageData.plan || {};
      for (const op of (plan.operators || []) as any[]) {
        if ('tableSink' in op) {
          const tableSink = op.tableSink;
          const flags = tableSink.flags || 0;
          if ((flags & 0x20) !== 0) continue;
          const table = tableSink.table || {};
          const path: string[] = table.path || [];
          if (path.length === 4 && path[path.length - 1] === '__delta__') continue;
          const rawProps = table.properties || {};
          if (Array.isArray(rawProps)) {
            const result: Record<string, string> = {};
            for (const item of rawProps) { if (item.key) result[item.key] = item.value || ''; }
            return result;
          }
          return typeof rawProps === 'object' ? rawProps : {};
        }
      }
    }
    return {};
  }

  protected getRefreshTableName(context: Record<string, any>): string | null {
    const alignedStages = context.alignedStages || {};
    for (const stageData of Object.values(alignedStages) as any[]) {
      const plan = stageData.plan || {};
      for (const op of (plan.operators || []) as any[]) {
        if ('tableSink' in op) {
          const tableSink = op.tableSink;
          const flags = tableSink.flags || 0;
          if ((flags & 0x20) !== 0) continue;
          const table = tableSink.table || {};
          const path: string[] = table.path || [];
          if (path.length === 4 && path[path.length - 1] === '__delta__') continue;
          if (path.length >= 3) return path.slice(0, 3).join('.');
        }
      }
    }
    return null;
  }

  buildRecommendationWithTableCheck(param: string, value: string, priority: number, reason: string, impact: string, context: Record<string, any>, currentValue?: string | null, warning?: string | null, _stageId?: string): Record<string, any> {
    const tableProps = this.getRefreshTableProperties(context);
    let finalWarning = warning || null;
    if (param in tableProps) {
      const tableName = this.getRefreshTableName(context) || '目标表';
      const tableWarning = `同时注意：dynamic table ${tableName} 上已设置该参数为 '${tableProps[param]}'，需先通过 ALTER TABLE ${tableName} UNSET TBLPROPERTIES ('${param}') 去掉`;
      finalWarning = finalWarning ? `${finalWarning}；${tableWarning}` : tableWarning;
    }
    return this.createRecommendation(param, value, priority, reason, impact, currentValue, finalWarning);
  }
}

export abstract class GlobalRule extends BaseRule {
  override ruleScope = 'global';

  override check(_stageData: Record<string, any>, _context: Record<string, any>): boolean { return true; }

  abstract analyzeGlobal(context: Record<string, any>): RuleResult;

  override analyze(_stageData: Record<string, any>, context: Record<string, any>): RuleResult {
    return this.analyzeGlobal(context);
  }
}
