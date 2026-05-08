/**
 * Plan Navigator - Structured plan query utilities
 */
import { AppendOnlyDetector } from './helpers.js';

export class PlanNavigator {
  private plan: Record<string, any>;
  private _planStrCache: string | null = null;

  constructor(plan: Record<string, any>) {
    this.plan = plan;
  }

  get planStr(): string {
    if (this._planStrCache === null) this._planStrCache = JSON.stringify(this.plan);
    return this._planStrCache;
  }

  hasOperator(operatorName: string): boolean {
    return this.planStr.toLowerCase().includes(operatorName.toLowerCase());
  }

  hasAnyOperator(operatorNames: string[]): boolean {
    return operatorNames.some(name => this.planStr.includes(name));
  }

  hasAllOperators(operatorNames: string[]): boolean {
    return operatorNames.every(name => this.planStr.includes(name));
  }

  getOperators(): Record<string, any>[] {
    return this.plan.operators || [];
  }

  findOperatorsByType(operatorType: string): Record<string, any>[] {
    return this.getOperators().filter(op => JSON.stringify(op).toLowerCase().includes(operatorType.toLowerCase()));
  }

  hasHashAggregatePhase(phase: string): boolean {
    for (const op of this.getOperators()) {
      if ('hashAgg' in op || JSON.stringify(op).includes('HashAggregate')) {
        if (JSON.stringify(op).includes(phase)) return true;
      }
    }
    return false;
  }

  hasAggregateFunction(functionNames: string[]): boolean {
    for (const op of this.getOperators()) {
      if (!('hashAgg' in op)) continue;
      const aggCalls: any[] = op.hashAgg?.aggregate?.aggregateCalls || [];
      for (const call of aggCalls) {
        const funcName = call?.function?.function?.name || '';
        if (functionNames.some(fn => funcName.includes(fn))) return true;
      }
    }
    return false;
  }

  extractAggregateBits(): number | null {
    for (const op of this.getOperators()) {
      if (!('hashAgg' in op)) continue;
      const aggCalls: any[] = op.hashAgg?.aggregate?.aggregateCalls || [];
      for (const call of aggCalls) {
        const func = call?.function?.function || {};
        const funcName = func.name || '';
        if (['_DF_BF_COLLECT', 'BF_COLLECT', 'DF_BF_COLLECT'].some(bf => funcName.includes(bf))) {
          const properties: any[] = func.properties?.properties || [];
          for (const prop of properties) {
            if (prop.key === 'bits') {
              const val = parseInt(prop.value, 10);
              if (!isNaN(val)) return val;
            }
          }
        }
      }
    }
    return null;
  }

  getTableSinkInfo(): Record<string, any>[] {
    return this.getOperators().filter(op => 'tableSink' in op || JSON.stringify(op).includes('TableSink'));
  }

  isDeltaTableSink(): boolean {
    for (const sink of this.getTableSinkInfo()) {
      const tableSink = sink.tableSink || {};
      const table = tableSink.table || {};
      const path: string[] = table.path || [];
      if (!Array.isArray(path) || path.length < 3) continue;
      let overwrite = tableSink.overwrite ?? true;
      if (typeof overwrite === 'string') overwrite = overwrite.toLowerCase() === 'true';
      if (path.length === 4 && path[path.length - 1] === '__delta__') return true;
      if (path.length === 3 && !overwrite) return true;
    }
    return false;
  }

  isOverwriteSink(): boolean {
    for (const sink of this.getTableSinkInfo()) {
      const tableSink = sink.tableSink || {};
      let overwrite = tableSink.overwrite ?? true;
      if (typeof overwrite === 'string') overwrite = overwrite.toLowerCase() === 'true';
      if (overwrite) return true;
    }
    return false;
  }

  getRefreshTableName(): string | null {
    for (const sink of this.getTableSinkInfo()) {
      const tableSink = sink.tableSink || {};
      const table = tableSink.table || {};
      const path: string[] = table.path || [];
      if (Array.isArray(path) && path.length >= 3 && path[2]) return path[2];
    }
    return null;
  }

  getTableFullPath(): string | null {
    for (const sink of this.getTableSinkInfo()) {
      const tableSink = sink.tableSink || {};
      const table = tableSink.table || {};
      const path: string[] = table.path || [];
      if (Array.isArray(path) && path.length >= 3) return path.slice(0, 3).join('.');
    }
    return null;
  }

  hasJoinType(joinType: string): boolean {
    return this.planStr.includes(joinType);
  }

  getJoinOperators(): Record<string, any>[] {
    return this.getOperators().filter(op => JSON.stringify(op).toLowerCase().includes('join'));
  }

  hasCalcWithUdf(): boolean {
    const udfPatterns = ['udf', 'UDF', 'user_defined', 'custom_func', 'ScalarFunction'];
    for (const op of this.getOperators()) {
      if (JSON.stringify(op).toLowerCase().includes('calc')) {
        const opStr = JSON.stringify(op);
        if (udfPatterns.some(p => opStr.includes(p))) return true;
      }
    }
    return false;
  }

  getInputStages(): string[] {
    const inputStages: string[] = [];
    if ('inputStages' in this.plan) {
      inputStages.push(...(this.plan.inputStages || []));
    } else if ('inputs' in this.plan) {
      for (const inp of this.plan.inputs || []) {
        if (typeof inp === 'object' && inp.stageId) inputStages.push(inp.stageId);
        else if (typeof inp === 'string') inputStages.push(inp);
      }
    }
    if (!inputStages.length) {
      for (const op of this.getOperators()) {
        if (JSON.stringify(op).toLowerCase().includes('exchange')) {
          const exchange = op.exchange || {};
          if (exchange.inputStageId) inputStages.push(exchange.inputStageId);
        }
      }
    }
    return inputStages;
  }

  hasNonAppendOnlyScan(): boolean {
    for (const op of this.plan.operators || []) {
      if (AppendOnlyDetector.isDeltaScan(op)) {
        const isAppendOnly = AppendOnlyDetector.isAppendOnlyScan(op);
        if (isAppendOnly === false) return true;
      }
    }
    return false;
  }

  hasAppendOnlyScan(): boolean {
    for (const op of this.plan.operators || []) {
      if (AppendOnlyDetector.isDeltaScan(op)) {
        const isAppendOnly = AppendOnlyDetector.isAppendOnlyScan(op);
        if (isAppendOnly === true) return true;
      }
    }
    return false;
  }

  hasScanWithIncrementalDelete(): boolean {
    return this.hasNonAppendOnlyScan();
  }

  hasRowNumberPattern(): boolean {
    const patterns = ['row_number=1', 'rn=1', 'rowNumber=1', 'ROW_NUMBER=1'];
    return patterns.some(p => this.planStr.includes(p));
  }

  extractShuffleBytes(): number { return 0; }

  getIncrementalTableScans(): Array<{ tableName: string; fromVersion: any; toVersion: any; scanType: string; operator: any }> {
    const scans: Array<{ tableName: string; fromVersion: any; toVersion: any; scanType: string; operator: any }> = [];
    for (const op of this.getOperators()) {
      if (!('tableScan' in op)) continue;
      const tableScan = op.tableScan;
      const tableName = tableScan?.table?.name || 'unknown';
      const incrProperty = tableScan?.incrementalTableProperty || {};
      const fromVersion = incrProperty.from ?? null;
      const toVersion = incrProperty.to ?? null;
      let scanType = 'unknown';
      if (fromVersion !== null && toVersion !== null) scanType = 'delta';
      else if (fromVersion === null && toVersion !== null) scanType = 'snapshot';
      scans.push({ tableName, fromVersion, toVersion, scanType, operator: op });
    }
    return scans;
  }

  hasDeltaScan(): boolean {
    return this.getIncrementalTableScans().some(s => s.scanType === 'delta');
  }

  getDeltaTables(): string[] {
    return this.getIncrementalTableScans().filter(s => s.scanType === 'delta').map(s => s.tableName);
  }

  getSnapshotTables(): string[] {
    return this.getIncrementalTableScans().filter(s => s.scanType === 'snapshot').map(s => s.tableName);
  }
}

export function createStageNavigator(stageData: Record<string, any>): PlanNavigator {
  return new PlanNavigator(stageData.plan || {});
}

export function isDfAndJoin(op: Record<string, any>): boolean {
  const opStr = JSON.stringify(op).toLowerCase();
  return opStr.includes('df_and') || opStr.includes('df-and');
}

// Operator type detection
const NAME_PREFIX_TO_TYPE: [string, string][] = [
  ['HashJoin', 'join'], ['NestedLoopJoin', 'join'], ['BroadcastHashJoin', 'join'],
  ['HashAgg', 'aggregate'], ['HashAggregate', 'aggregate'], ['Aggregate', 'aggregate'],
  ['Window', 'window'], ['TableFunctionScan', 'udtf'], ['TableScan', 'tablescan'],
  ['TableSink', 'tablesink'], ['Calc', 'calc'], ['Filter', 'filter'], ['Project', 'project'],
  ['UnionAll', 'union'], ['Union', 'union'], ['ShuffleRead', 'shuffle'], ['ShuffleWrite', 'shuffle'],
  ['Exchange', 'exchange'], ['Sort', 'sort'], ['Values', 'values'], ['Buffer', 'buffer'],
];

export function getOperatorTypeFromObj(op: Record<string, any>): string {
  for (const key of Object.keys(op)) {
    const keyLower = key.toLowerCase();
    if (keyLower.includes('join')) return 'join';
    if (keyLower.includes('agg') || keyLower.includes('aggregate')) return 'aggregate';
    if (keyLower === 'calc') return 'calc';
    if (keyLower === 'filter') return 'filter';
    if (keyLower === 'project') return 'project';
    if (keyLower.includes('union')) return 'union';
    if (keyLower === 'window') return 'window';
    if (keyLower.includes('tablescan')) return 'tablescan';
    if (keyLower.includes('tablefunctionscan') || keyLower.includes('lateralview')) return 'udtf';
    if (keyLower.includes('tablesink') || keyLower.includes('sink')) return 'tablesink';
    if (keyLower.includes('exchange')) return 'exchange';
    if (keyLower.includes('shuffleread') || keyLower.includes('shufflewrite')) return 'shuffle';
    if (keyLower === 'sort') return 'sort';
  }
  return 'unknown';
}

export function getOperatorTypeByName(operatorId: string): string {
  for (const [prefix, opType] of NAME_PREFIX_TO_TYPE) {
    if (operatorId.startsWith(prefix)) return opType;
  }
  const idLower = operatorId.toLowerCase();
  if (idLower.includes('join')) return 'join';
  if (idLower.includes('agg')) return 'aggregate';
  if (idLower.includes('tablefunctionscan')) return 'udtf';
  if (idLower.includes('scan')) return 'tablescan';
  if (idLower.includes('window')) return 'window';
  if (idLower.includes('calc')) return 'calc';
  if (idLower.includes('shuffle') || idLower.includes('exchange')) return 'shuffle';
  if (idLower.includes('sink')) return 'tablesink';
  if (idLower.includes('filter')) return 'filter';
  if (idLower.includes('union')) return 'union';
  if (idLower.includes('sort')) return 'sort';
  return 'unknown';
}

export function isShuffleOperator(operatorId: string): boolean {
  const opType = getOperatorTypeByName(operatorId);
  return opType === 'shuffle' || opType === 'exchange';
}
