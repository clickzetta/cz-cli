/**
 * Utility helpers: version_utils + append_only_detector + state_table_checker
 */

// ============================================================================
// Version Utils
// ============================================================================

export type Version = [number, number];

export function parseVersion(gitBranch: string): Version | null {
  if (!gitBranch || gitBranch === 'Unknown') return null;
  const match = gitBranch.match(/v?(\d+)\.(\d+)/);
  if (match) return [parseInt(match[1]), parseInt(match[2])];
  return null;
}

export function compareVersion(version: Version | null, targetMajor: number, targetMinor: number): number | null {
  if (version === null) return null;
  const [major, minor] = version;
  const current: [number, number] = [major, minor];
  const target: [number, number] = [targetMajor, targetMinor];
  if (current[0] < target[0] || (current[0] === target[0] && current[1] < target[1])) return -1;
  if (current[0] > target[0] || (current[0] === target[0] && current[1] > target[1])) return 1;
  return 0;
}

export function isVersionLe(version: Version | null, targetMajor: number, targetMinor: number): boolean {
  const cmp = compareVersion(version, targetMajor, targetMinor);
  return cmp !== null && cmp <= 0;
}

export function isVersionGe(version: Version | null, targetMajor: number, targetMinor: number): boolean {
  const cmp = compareVersion(version, targetMajor, targetMinor);
  return cmp !== null && cmp >= 0;
}

// ============================================================================
// Append-Only Detector
// ============================================================================

export class AppendOnlyDetector {
  static readonly INCREMENTAL_DELETE_COL = '__incremental_deleted';

  static isAppendOnlyScan(operator: Record<string, any>): boolean | null {
    const tableScan = operator.tableScan || operator.TableScan;
    if (!tableScan) return null;
    const outputFields = this.getOperatorOutputFields(operator);
    if (outputFields === null) return null;
    return !outputFields.includes(this.INCREMENTAL_DELETE_COL);
  }

  static getOperatorOutputFields(operator: Record<string, any>): string[] | null {
    const schema = operator.schema || {};
    const structInfo = schema.structTypeInfo || {};
    const fields: any[] = structInfo.fields || [];
    if (!fields.length) return null;
    return fields.map((f: any) => f.name || '').filter((n: string) => n !== '');
  }

  static hasIncrementalDeleteColumn(operator: Record<string, any>): boolean {
    const outputFields = this.getOperatorOutputFields(operator);
    if (outputFields === null) return false;
    return outputFields.includes(this.INCREMENTAL_DELETE_COL);
  }

  static isDeltaScan(operator: Record<string, any>): boolean {
    const tableScan = operator.tableScan || operator.TableScan;
    if (!tableScan) return false;
    const incrProp = tableScan.incrementalTableProperty;
    if (!incrProp) return false;
    const fromVersion = String(incrProp.from ?? '');
    if (fromVersion === '-9223372036854775808') return false;
    return true;
  }

  static isAppendOnlyDeltaScan(operator: Record<string, any>): boolean | null {
    if (!this.isDeltaScan(operator)) return false;
    return this.isAppendOnlyScan(operator);
  }

  static getTableName(operator: Record<string, any>): string | null {
    const tableScan = operator.tableScan || operator.TableScan;
    if (!tableScan) return null;
    const tableInfo = tableScan.table || {};
    const path: string[] = tableInfo.path || [];
    if (path.length >= 3) return `${path[0]}.${path[1]}.${path[2]}`;
    if (path.length >= 1) return path[path.length - 1];
    return tableInfo.name || null;
  }
}

// ============================================================================
// State Table Checker
// ============================================================================

export class StateTableChecker {
  static readonly STATE_TABLE_PATTERN = '__incr__';
  private static cache = new Map<any, boolean>();

  static checkPlanHasStateTable(contextOrPlan: Record<string, any>): boolean {
    if ('aligned_stages' in contextOrPlan || 'alignedStages' in contextOrPlan) {
      const alignedStages = contextOrPlan.alignedStages || contextOrPlan.aligned_stages || {};
      for (const stageData of Object.values(alignedStages) as any[]) {
        const plan = stageData.plan || {};
        if (!plan || !Object.keys(plan).length) continue;
        try {
          const planStr = JSON.stringify(plan);
          if (planStr.includes(this.STATE_TABLE_PATTERN)) return true;
        } catch { continue; }
      }
      return false;
    } else {
      try {
        const planStr = JSON.stringify(contextOrPlan);
        return planStr.includes(this.STATE_TABLE_PATTERN);
      } catch { return false; }
    }
  }

  static clearCache(): void {
    this.cache.clear();
  }

  static getStateTableStatusMessage(hasStateTable: boolean, baseMessage: string, withStateTableSuffix?: string): string {
    if (!hasStateTable) return baseMessage;
    if (withStateTableSuffix) {
      return `${baseMessage}。注意：Job 已包含中间状态表，${withStateTableSuffix}`;
    }
    return `${baseMessage}。注意：Job 已包含中间状态表，但该问题仍存在，建议检查状态表位置和配置`;
  }
}
