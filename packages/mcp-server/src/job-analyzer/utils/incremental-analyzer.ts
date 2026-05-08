/**
 * Incremental Algorithm Analyzer
 * Full port of incremental_algorithm_analyzer.py
 */
import { logger } from '../../logger.js';
import { AppendOnlyDetector } from './helpers.js';
import { getOperatorTypeFromObj, isDfAndJoin } from './plan-navigator.js';

// ============================================================================
// Enums
// ============================================================================

export enum DataType {
  DELTA = 'delta',
  SNAPSHOT = 'snapshot',
  UNKNOWN = 'unknown',
}

export enum AppendOnlyType {
  APPEND_ONLY = 'append_only',
  WITH_DELETE = 'with_delete',
  NOT_APPLICABLE = 'not_applicable',
  UNKNOWN = 'unknown',
}

// ============================================================================
// Interfaces
// ============================================================================

export interface OperatorDetail {
  operator_id: string;
  operator_type: string;
  data_type: string;
  has_hint: boolean;
}

export interface TableScanInfo {
  operator_id: string;
  operator_index: number;
  table_name: string;
  data_type: string;
  append_only_type: string;
  is_append_only: boolean;
}

export interface TableScanAppendOnlyInfo {
  has_tablescans: boolean;
  all_append_only: boolean;
  total_tablescans: number;
  delta_tablescans: number;
  tablescans: TableScanInfo[];
}

export interface IncrementalAlgorithm {
  type: string;
  rule_id: string;
  is_original_sql: boolean;
  operators: string[];
  rule_operators: string[];
  target_operator_id: string | null;
  root_operator_id: string | null;
  operator_details: OperatorDetail[];
  total_operators: number;
  tablescan_append_only_info: TableScanAppendOnlyInfo;
}

export interface RuleNameConflict {
  algorithm_id: string;
  rule_names: string[];
  selected_name: string;
  message: string;
}

export interface IncrementalAnalysisResult {
  operator_data_types: Record<string, string>;
  operator_append_only_types: Record<string, string>;
  rule_groups: Record<string, string[]>;
  incremental_algorithms: IncrementalAlgorithm[];
  algorithm_dependencies: Record<string, string[]>;
  dependency_graph: string;
  validation_warnings: string[];
  rule_name_conflicts: RuleNameConflict[];
}

// ============================================================================
// Main Class
// ============================================================================

export class IncrementalAlgorithmAnalyzer {
  private plan: Record<string, any>;
  private operators: Record<string, any>[];

  // operator index -> actual operator id
  private operatorIds: Map<number, string> = new Map();
  // actual operator id -> operator index
  private idToIndex: Map<string, number> = new Map();

  // operator index -> DataType
  private operatorDataTypes: Map<number, DataType> = new Map();
  // operator index -> AppendOnlyType
  private operatorAppendOnlyTypes: Map<number, AppendOnlyType> = new Map();

  // rule_id -> [operator_indices]
  private ruleGroups: Map<string, number[]> = new Map();
  // operator_index -> rule_name (all hints including those without #ID)
  private operatorRuleNames: Map<number, string> = new Map();
  // algorithm_id -> full_rule_name
  private algorithmIdToRuleName: Map<string, string> = new Map();
  // algorithm_id -> Set<rule_names> (for conflict detection)
  private algorithmIdRuleConflicts: Map<string, Set<string>> = new Map();

  // operator_index -> [input_operator_indices]
  private operatorDependencies: Map<number, number[]> = new Map();
  // operator_index -> [output_operator_indices]
  private operatorDependents: Map<number, number[]> = new Map();

  // Caches
  private _operatorStrCache: Map<number, string> = new Map();
  private _isDeleteplanCache: Map<number, boolean> = new Map();

  constructor(plan: Record<string, any>) {
    this.plan = plan;
    this.operators = plan.operators || [];
    logger.debug(`初始化增量算法分析器，算子数量: ${this.operators.length}`);
    this._extractOperatorIds();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  analyze(): IncrementalAnalysisResult {
    logger.debug('========== 开始增量算法分析 ==========');
    logger.debug(`算子总数: ${this.operators.length}`);

    this._identifyScanDataTypes();
    this._parseRuleHints();

    logger.debug(`解析完成，找到 ${this.ruleGroups.size} 个增量算法`);

    this._buildOperatorDependencies();
    this._propagateDataTypes();
    this._identifyAppendOnlyTypes();

    const algorithms = this._identifyIncrementalAlgorithmsWithSubplan();
    const algoDeps = this._buildAlgorithmDependencies(algorithms);
    const depGraph = this._generateDependencyGraph(algorithms, algoDeps);
    const validationWarnings = this._validateAlgorithms(algorithms);
    const ruleNameConflicts = this._detectRuleNameConflicts();

    this._logAlgorithmDetails(algorithms);

    logger.debug('========== 增量算法分析完成 ==========');

    const operatorDataTypesResult: Record<string, string> = {};
    for (const [idx, dt] of this.operatorDataTypes) {
      operatorDataTypesResult[this.operatorIds.get(idx) || `op_${idx}`] = dt;
    }

    const operatorAppendOnlyResult: Record<string, string> = {};
    for (const [idx, ao] of this.operatorAppendOnlyTypes) {
      operatorAppendOnlyResult[this.operatorIds.get(idx) || `op_${idx}`] = ao;
    }

    const ruleGroupsResult: Record<string, string[]> = {};
    for (const [ruleId, indices] of this.ruleGroups) {
      ruleGroupsResult[ruleId] = indices.map(idx => this.operatorIds.get(idx) || `op_${idx}`);
    }

    return {
      operator_data_types: operatorDataTypesResult,
      operator_append_only_types: operatorAppendOnlyResult,
      rule_groups: ruleGroupsResult,
      incremental_algorithms: algorithms,
      algorithm_dependencies: algoDeps,
      dependency_graph: depGraph,
      validation_warnings: validationWarnings,
      rule_name_conflicts: ruleNameConflicts,
    };
  }

  getOperatorSummary(opIndex: number): Record<string, any> {
    if (opIndex >= this.operators.length) return {};
    const op = this.operators[opIndex];
    const opType = this._getOperatorType(op);
    const dataType = this.operatorDataTypes.get(opIndex) || DataType.UNKNOWN;
    const opId = this.operatorIds.get(opIndex) || `op_${opIndex}`;
    const ruleIds: string[] = [];
    for (const [ruleId, indices] of this.ruleGroups) {
      if (indices.includes(opIndex)) ruleIds.push(ruleId);
    }
    return { index: opIndex, id: opId, type: opType, data_type: dataType, rule_ids: ruleIds };
  }

  // ==========================================================================
  // Operator ID Extraction
  // ==========================================================================

  private _extractOperatorIds(): void {
    for (let idx = 0; idx < this.operators.length; idx++) {
      const op = this.operators[idx];
      const opId = this._extractIdFromOperator(op);
      if (opId) {
        this.operatorIds.set(idx, opId);
        this.idToIndex.set(opId, idx);
      } else {
        const fallback = `unknown_op_${idx}`;
        this.operatorIds.set(idx, fallback);
        this.idToIndex.set(fallback, idx);
      }
    }
  }

  private _extractIdFromOperator(op: Record<string, any>): string | null {
    if ('id' in op) return String(op.id);
    for (const value of Object.values(op)) {
      if (typeof value === 'object' && value !== null && 'id' in value) {
        return String(value.id);
      }
    }
    for (const value of Object.values(op)) {
      if (typeof value === 'object' && value !== null) {
        for (const [subKey, subValue] of Object.entries(value)) {
          if (subKey === 'id') return String(subValue);
        }
      }
    }
    return null;
  }

  // ==========================================================================
  // Step 1: Identify Scan Data Types
  // ==========================================================================

  private _identifyScanDataTypes(): void {
    const MIN_LONG = BigInt('-9223372036854775808');

    for (let idx = 0; idx < this.operators.length; idx++) {
      const op = this.operators[idx];
      if (!('tableScan' in op)) continue;

      const tableScan = op.tableScan;
      const incrProperty = tableScan?.incrementalTableProperty || {};
      const fromVersion = incrProperty.from;
      const toVersion = incrProperty.to;

      if (fromVersion == null && toVersion == null) {
        this.operatorDataTypes.set(idx, DataType.UNKNOWN);
        continue;
      }

      let fromVal: bigint | null = null;
      let toVal: bigint | null = null;
      try {
        if (fromVersion != null) fromVal = BigInt(fromVersion);
        if (toVersion != null) toVal = BigInt(toVersion);
      } catch {
        this.operatorDataTypes.set(idx, DataType.UNKNOWN);
        continue;
      }

      if (fromVal !== null && fromVal === MIN_LONG) {
        this.operatorDataTypes.set(idx, DataType.SNAPSHOT);
      } else if (fromVal !== null && toVal !== null && fromVal !== MIN_LONG && toVal !== MIN_LONG) {
        this.operatorDataTypes.set(idx, DataType.DELTA);
      } else {
        this.operatorDataTypes.set(idx, DataType.UNKNOWN);
      }
    }
  }

  // ==========================================================================
  // Step 2: Parse Rule Hints
  // ==========================================================================

  private _parseRuleHints(): void {
    for (let idx = 0; idx < this.operators.length; idx++) {
      const op = this.operators[idx];
      const opStr = JSON.stringify(op);

      // Pattern 1: Rule:xxx
      const rulePattern = /Rule:([A-Za-z0-9_:#,\-()]+)/g;
      let match: RegExpExecArray | null;
      while ((match = rulePattern.exec(opStr)) !== null) {
        const ruleName = match[1];
        if (ruleName.toLowerCase().includes('deleteplan') || ruleName.toLowerCase().includes('delete_plan')) continue;
        const algorithmId = this._extractBaseRuleId(ruleName);
        if (algorithmId === null) continue;
        const fullRuleName = this._extractFullRuleName(ruleName);
        this._updateAlgorithmRuleName(algorithmId, fullRuleName);
        if (!this.ruleGroups.has(algorithmId)) this.ruleGroups.set(algorithmId, []);
        this.ruleGroups.get(algorithmId)!.push(idx);
      }

      // Pattern 2: HINT=Rule:IncrementalXxxRule (may not have #ID)
      const hintRulePattern = /HINT=Rule:(Incremental[A-Za-z0-9]+Rule(?:V\d+)?)/g;
      const commentsRulePattern = /"comments":\s*"Rule:(Incremental[A-Za-z0-9]+Rule(?:V\d+)?)[^"]*"/g;

      const allHintRuleMatches: string[] = [];
      while ((match = hintRulePattern.exec(opStr)) !== null) allHintRuleMatches.push(match[1]);
      while ((match = commentsRulePattern.exec(opStr)) !== null) allHintRuleMatches.push(match[1]);

      for (const ruleName of allHintRuleMatches) {
        if (ruleName.toLowerCase().includes('deleteplan') || ruleName.toLowerCase().includes('delete_plan')) continue;
        const fullRuleName = this._extractFullRuleName(ruleName);
        this.operatorRuleNames.set(idx, fullRuleName);
        const algorithmId = this._extractBaseRuleId(ruleName);
        if (algorithmId !== null) {
          this._updateAlgorithmRuleName(algorithmId, fullRuleName);
          if (!this.ruleGroups.has(algorithmId)) this.ruleGroups.set(algorithmId, []);
          this.ruleGroups.get(algorithmId)!.push(idx);
        }
      }

      // Pattern 3: HINT=...IncrementalXxxRule#...#ID
      const hintPattern = /HINT=.*?_(Incremental[^#]+Rule(?:V\d+)?(?:\s+[^#]+)?)#[^#]*#(\d+)/g;
      while ((match = hintPattern.exec(opStr)) !== null) {
        const ruleName = match[1].trim();
        const targetOpId = match[2];
        const fullRuleId = `${ruleName}#${targetOpId}`;
        if (fullRuleId.toLowerCase().includes('deleteplan') || fullRuleId.toLowerCase().includes('delete_plan')) continue;
        const algorithmId = this._extractBaseRuleId(fullRuleId);
        if (algorithmId === null) continue;
        const fullRuleName = this._extractFullRuleName(ruleName);
        this._updateAlgorithmRuleName(algorithmId, fullRuleName);
        if (!this.ruleGroups.has(algorithmId)) this.ruleGroups.set(algorithmId, []);
        this.ruleGroups.get(algorithmId)!.push(idx);
      }

      // Pattern 4: DeltaState...IncrementalXxxRule#...#ID
      const deltastatePattern = /DeltaState[+-]?:\[.*?\].*?_(Incremental[^#]+Rule(?:V\d+)?(?:\s+[^#]+)?)#[^#]*#(\d+)/g;
      while ((match = deltastatePattern.exec(opStr)) !== null) {
        const ruleName = match[1].trim();
        const targetOpId = match[2];
        const fullRuleId = `${ruleName}#${targetOpId}`;
        if (fullRuleId.toLowerCase().includes('deleteplan') || fullRuleId.toLowerCase().includes('delete_plan')) continue;
        const algorithmId = this._extractBaseRuleId(fullRuleId);
        if (algorithmId === null) continue;
        const fullRuleName = this._extractFullRuleName(ruleName);
        this._updateAlgorithmRuleName(algorithmId, fullRuleName);
        if (!this.ruleGroups.has(algorithmId)) this.ruleGroups.set(algorithmId, []);
        this.ruleGroups.get(algorithmId)!.push(idx);
      }
    }

    this._assignHintsWithoutIdToAlgorithms();
  }

  private _extractBaseRuleId(ruleName: string): string | null {
    const match = ruleName.match(/#(\d+)/);
    return match ? match[1] : null;
  }

  private _extractFullRuleName(ruleName: string): string {
    const ruleMatch = ruleName.match(/(Incremental[A-Za-z0-9]+Rule(?:V\d+)?)/);
    if (ruleMatch) return ruleMatch[1];
    const altMatch = ruleName.match(/^([A-Za-z0-9]+)(?:_Delta:|_Snapshot:|_cz::|#|\s|$)/);
    if (altMatch) return altMatch[1];
    return ruleName.split('_')[0].split('#')[0].split(/\s/)[0].trim();
  }

  private _extractBaseRuleName(ruleName: string): string {
    let baseName = ruleName.replace(/V\d+$/, '');
    baseName = baseName.replace(/_.*$/, '');
    return baseName.trim();
  }

  private _updateAlgorithmRuleName(algorithmId: string, newRuleName: string): void {
    if (!this.algorithmIdToRuleName.has(algorithmId)) {
      this.algorithmIdToRuleName.set(algorithmId, newRuleName);
      this.algorithmIdRuleConflicts.set(algorithmId, new Set([newRuleName]));
    } else {
      const existingName = this.algorithmIdToRuleName.get(algorithmId)!;
      if (!this.algorithmIdRuleConflicts.has(algorithmId)) {
        this.algorithmIdRuleConflicts.set(algorithmId, new Set([existingName]));
      }
      this.algorithmIdRuleConflicts.get(algorithmId)!.add(newRuleName);

      if (existingName !== newRuleName) {
        const hasVersionNew = /V\d+/.test(newRuleName);
        const hasVersionExisting = /V\d+/.test(existingName);
        let shouldUpdate = false;
        if (hasVersionNew && !hasVersionExisting) shouldUpdate = true;
        else if (!hasVersionNew && hasVersionExisting) shouldUpdate = false;
        else if (newRuleName.length > existingName.length) shouldUpdate = true;
        if (shouldUpdate) this.algorithmIdToRuleName.set(algorithmId, newRuleName);
      }
    }
  }

  private _assignHintsWithoutIdToAlgorithms(): void {
    for (const [idx, ruleName] of this.operatorRuleNames) {
      const algoType = this._identifyAlgorithmTypeFromRuleName(ruleName);
      const matchedAlgorithmId = this._findMatchingAlgorithmDownstreamByName(idx, ruleName, algoType);
      if (matchedAlgorithmId) {
        if (!this.ruleGroups.has(matchedAlgorithmId)) this.ruleGroups.set(matchedAlgorithmId, []);
        if (!this.ruleGroups.get(matchedAlgorithmId)!.includes(idx)) {
          this.ruleGroups.get(matchedAlgorithmId)!.push(idx);
        }
      }
    }
  }

  private _identifyAlgorithmTypeFromRuleName(ruleName: string): string {
    if (ruleName.includes('Aggregate') || ruleName.includes('Agg')) return 'aggregate';
    if (ruleName.includes('Join')) return 'join';
    if (ruleName.includes('Window')) return 'window';
    return 'unknown';
  }

  private _findMatchingAlgorithmDownstreamByName(startIdx: number, ruleName: string, opType: string, maxDepth = 10): string | null {
    const baseRuleName = this._extractBaseRuleName(ruleName);
    const visited = new Set<number>();
    const queue: [number, number][] = [[startIdx, 0]];
    visited.add(startIdx);

    while (queue.length > 0) {
      const [currentIdx, depth] = queue.shift()!;
      if (depth > maxDepth) continue;

      for (const [algorithmId, algoIndices] of this.ruleGroups) {
        if (algoIndices.includes(currentIdx)) {
          const algoRuleName = this.algorithmIdToRuleName.get(algorithmId) || '';
          const algoBaseName = this._extractBaseRuleName(algoRuleName);
          const algoType = this._identifyAlgorithmType(algorithmId);
          if (algoType === opType && algoBaseName === baseRuleName) return algorithmId;
        }
      }

      for (const dependentIdx of this.operatorDependents.get(currentIdx) || []) {
        if (!visited.has(dependentIdx)) {
          visited.add(dependentIdx);
          queue.push([dependentIdx, depth + 1]);
        }
      }
    }
    return null;
  }

  // ==========================================================================
  // Step 3: Build Operator Dependencies
  // ==========================================================================

  private _buildOperatorDependencies(): void {
    for (let idx = 0; idx < this.operators.length; idx++) {
      this.operatorDependencies.set(idx, []);
      this.operatorDependents.set(idx, []);
    }
    for (let idx = 0; idx < this.operators.length; idx++) {
      const op = this.operators[idx];
      const inputs = this._extractOperatorInputs(op, idx);
      this.operatorDependencies.set(idx, inputs);
      for (const inputIdx of inputs) {
        if (inputIdx >= 0 && inputIdx < this.operators.length) {
          this.operatorDependents.get(inputIdx)!.push(idx);
        }
      }
    }
  }

  private _extractOperatorInputs(op: Record<string, any>, currentIdx: number): number[] {
    // Method 1: inputIds field
    if ('inputIds' in op) {
      const inputIds = op.inputIds;
      if (Array.isArray(inputIds)) {
        const inputs: number[] = [];
        for (const inputId of inputIds) {
          if (typeof inputId === 'string' && this.idToIndex.has(inputId)) {
            inputs.push(this.idToIndex.get(inputId)!);
          }
        }
        return inputs;
      }
    }
    // Method 2: heuristic fallback
    const opStr = JSON.stringify(op).toLowerCase();
    if (opStr.includes('join') && currentIdx >= 2) {
      return [currentIdx - 2, currentIdx - 1];
    } else if (currentIdx > 0) {
      return [currentIdx - 1];
    }
    return [];
  }

  // ==========================================================================
  // Step 4: Propagate Data Types
  // ==========================================================================

  private _propagateDataTypes(): void {
    const maxIterations = 10;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let changed = false;
      for (let idx = 0; idx < this.operators.length; idx++) {
        if (this.operatorDataTypes.has(idx)) continue;
        const op = this.operators[idx];

        if (this._hasIncrementalHint(op)) {
          this.operatorDataTypes.set(idx, DataType.DELTA);
          changed = true;
          continue;
        }

        const inputIndices = this.operatorDependencies.get(idx) || [];
        const inputTypes: DataType[] = [];
        for (const inputIdx of inputIndices) {
          if (this.operatorDataTypes.has(inputIdx)) {
            inputTypes.push(this.operatorDataTypes.get(inputIdx)!);
          }
        }
        if (!inputTypes.length || inputTypes.length < inputIndices.length) continue;

        const opType = this._getOperatorType(op);
        const outputType = this._inferOutputType(opType, inputTypes, op);
        if (outputType !== DataType.UNKNOWN) {
          this.operatorDataTypes.set(idx, outputType);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  private _hasIncrementalHint(op: Record<string, any>): boolean {
    try {
      const opId = op.id != null ? String(op.id) : '';
      if (opId.includes('Incremental') || opId.includes('DeltaState')) return true;
      if ('hints' in op && op.hints) {
        const hintsStr = String(op.hints);
        if (hintsStr.includes('Incremental') || hintsStr.includes('DeltaState')) return true;
      }
      const opStr = JSON.stringify(op);
      return opStr.includes('Incremental') || opStr.includes('DeltaState');
    } catch {
      return false;
    }
  }

  private _inferOutputType(opType: string, inputTypes: DataType[], op?: Record<string, any>): DataType {
    if (!inputTypes.length) return DataType.UNKNOWN;
    if (opType === 'join') {
      if (op && isDfAndJoin(op)) return inputTypes[0] || DataType.UNKNOWN;
      return inputTypes.every(dt => dt === DataType.SNAPSHOT) ? DataType.SNAPSHOT : DataType.DELTA;
    } else if (opType === 'union') {
      if (inputTypes.every(dt => dt === DataType.SNAPSHOT)) return DataType.SNAPSHOT;
      if (inputTypes.every(dt => dt === DataType.DELTA)) return DataType.DELTA;
      return DataType.SNAPSHOT;
    }
    return inputTypes[0] || DataType.UNKNOWN;
  }

  // ==========================================================================
  // Step 5: Identify Append-Only Types
  // ==========================================================================

  private _identifyAppendOnlyTypes(): void {
    // Step 1: TableScan append-only
    for (let idx = 0; idx < this.operators.length; idx++) {
      const op = this.operators[idx];
      const dataType = this.operatorDataTypes.get(idx) || DataType.UNKNOWN;
      if (dataType !== DataType.DELTA) {
        this.operatorAppendOnlyTypes.set(idx, AppendOnlyType.NOT_APPLICABLE);
        continue;
      }
      if (!('tableScan' in op)) continue;
      const isAppendOnly = AppendOnlyDetector.isAppendOnlyScan(op);
      if (isAppendOnly === null) {
        this.operatorAppendOnlyTypes.set(idx, AppendOnlyType.NOT_APPLICABLE);
      } else if (isAppendOnly) {
        this.operatorAppendOnlyTypes.set(idx, AppendOnlyType.APPEND_ONLY);
      } else {
        this.operatorAppendOnlyTypes.set(idx, AppendOnlyType.WITH_DELETE);
      }
    }

    // Step 2: Propagate
    const maxIterations = 10;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let changed = false;
      for (let idx = 0; idx < this.operators.length; idx++) {
        if (this.operatorAppendOnlyTypes.has(idx)) continue;
        const dataType = this.operatorDataTypes.get(idx) || DataType.UNKNOWN;
        if (dataType !== DataType.DELTA) {
          this.operatorAppendOnlyTypes.set(idx, AppendOnlyType.NOT_APPLICABLE);
          changed = true;
          continue;
        }
        const inputIndices = this.operatorDependencies.get(idx) || [];
        const inputAoTypes: AppendOnlyType[] = [];
        for (const inputIdx of inputIndices) {
          if (this.operatorAppendOnlyTypes.has(inputIdx)) {
            inputAoTypes.push(this.operatorAppendOnlyTypes.get(inputIdx)!);
          }
        }
        if (!inputAoTypes.length || inputAoTypes.length < inputIndices.length) continue;

        const op = this.operators[idx];
        const opType = this._getOperatorType(op);
        const aoType = this._inferAppendOnlyType(idx, op, opType, inputIndices, inputAoTypes);
        if (aoType !== AppendOnlyType.UNKNOWN) {
          this.operatorAppendOnlyTypes.set(idx, aoType);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  private _inferAppendOnlyType(
    idx: number, op: Record<string, any>, opType: string,
    inputIndices: number[], inputAoTypes: AppendOnlyType[]
  ): AppendOnlyType {
    const deltaInputs: [number, AppendOnlyType][] = [];
    for (let i = 0; i < inputIndices.length; i++) {
      if (inputAoTypes[i] !== AppendOnlyType.NOT_APPLICABLE) {
        deltaInputs.push([inputIndices[i], inputAoTypes[i]]);
      }
    }
    if (!deltaInputs.length) return AppendOnlyType.NOT_APPLICABLE;

    if (opType === 'join') return this._inferJoinAppendOnlyType(op, deltaInputs);
    if (opType === 'aggregate' || opType === 'window') return this._inferAggWindowAppendOnlyType(idx, op, opType, deltaInputs);

    for (const [, aoType] of deltaInputs) {
      if (aoType === AppendOnlyType.WITH_DELETE) return AppendOnlyType.WITH_DELETE;
      if (aoType === AppendOnlyType.UNKNOWN) return AppendOnlyType.UNKNOWN;
    }
    return AppendOnlyType.APPEND_ONLY;
  }

  private _inferJoinAppendOnlyType(op: Record<string, any>, deltaInputs: [number, AppendOnlyType][]): AppendOnlyType {
    const deltastateType = this._checkDeltastatePattern(op);
    if (deltastateType !== AppendOnlyType.UNKNOWN) return deltastateType;

    const joinType = this._getJoinType(op);
    const deltaCount = deltaInputs.length;

    if (deltaCount === 1 && ['inner', 'anti', 'left_semi'].includes(joinType)) {
      return deltaInputs[0][1];
    }
    if (deltaCount >= 2 && ['inner', 'left_semi', 'anti'].includes(joinType)) {
      const allAppendOnly = deltaInputs.every(([, ao]) => ao === AppendOnlyType.APPEND_ONLY);
      if (allAppendOnly && this._hasRuleHint(op)) return AppendOnlyType.APPEND_ONLY;
    }
    return AppendOnlyType.WITH_DELETE;
  }

  private _inferAggWindowAppendOnlyType(
    _idx: number, op: Record<string, any>, _opType: string,
    deltaInputs: [number, AppendOnlyType][]
  ): AppendOnlyType {
    const deltastateType = this._checkDeltastatePattern(op);
    if (deltastateType !== AppendOnlyType.UNKNOWN) return deltastateType;

    for (const [, aoType] of deltaInputs) {
      if (aoType === AppendOnlyType.WITH_DELETE) return AppendOnlyType.WITH_DELETE;
      if (aoType === AppendOnlyType.UNKNOWN) return AppendOnlyType.UNKNOWN;
    }
    return AppendOnlyType.APPEND_ONLY;
  }

  private _checkDeltastatePattern(op: Record<string, any>): AppendOnlyType {
    const opStr = JSON.stringify(op);
    if (opStr.includes('DeltaState-')) return AppendOnlyType.WITH_DELETE;
    if (opStr.includes('DeltaState+')) return AppendOnlyType.APPEND_ONLY;
    return AppendOnlyType.UNKNOWN;
  }

  private _getJoinType(op: Record<string, any>): string {
    const joinKeys = ['hashJoin', 'nestedLoopJoin', 'broadcastHashJoin', 'join'];
    for (const key of Object.keys(op)) {
      const keyLower = key.toLowerCase();
      if (joinKeys.some(jk => keyLower.includes(jk.toLowerCase()))) {
        const joinObj = op[key];
        if (typeof joinObj === 'object' && joinObj !== null) {
          if (joinObj.join && typeof joinObj.join === 'object' && 'type' in joinObj.join) {
            return String(joinObj.join.type).toLowerCase();
          }
          if ('type' in joinObj) return String(joinObj.type).toLowerCase();
          if ('joinType' in joinObj) return String(joinObj.joinType).toLowerCase();
        }
      }
    }
    return 'unknown';
  }

  private _hasRuleHint(op: Record<string, any>): boolean {
    const opStr = JSON.stringify(op);
    if (opStr.includes('Rule:')) return true;
    for (const key of Object.keys(op)) {
      if (key.toLowerCase().includes('join')) {
        const joinObj = op[key];
        if (typeof joinObj === 'object' && joinObj !== null && joinObj.hint) {
          const hintObj = joinObj.hint;
          if (typeof hintObj === 'object') {
            if (hintObj.comments && String(hintObj.comments).includes('Rule:')) return true;
            for (const hv of Object.values(hintObj)) {
              if (typeof hv === 'string' && hv.includes('Rule:')) return true;
            }
          }
        }
      }
    }
    return false;
  }

  // ==========================================================================
  // Step 6: Identify Incremental Algorithms with Subplan
  // ==========================================================================

  private _identifyIncrementalAlgorithmsWithSubplan(): IncrementalAlgorithm[] {
    const algorithms: IncrementalAlgorithm[] = [];
    const operatorHintMap: Map<number, string> = new Map();
    for (const [ruleId, indices] of this.ruleGroups) {
      for (const idx of indices) operatorHintMap.set(idx, ruleId);
    }

    const sortedRuleGroups = this._sortRuleGroupsByTopology();
    const assignedOperators: Map<number, string> = new Map();

    // Phase 1: Build confirmed sets for all algorithms
    const allConfirmedSets: Map<string, { confirmedSet: Set<number>; algoType: string; ruleOpIndices: number[] }> = new Map();
    for (const [ruleId, ruleOpIndices] of sortedRuleGroups) {
      const algoType = this._identifyAlgorithmType(ruleId);
      const confirmedSet = this._connectHintOperatorsForAlgorithm(
        new Set(ruleOpIndices), algoType, ruleId, operatorHintMap
      );
      allConfirmedSets.set(ruleId, { confirmedSet, algoType, ruleOpIndices });
    }

    // Phase 2: Expand confirmed sets to full subplans
    for (const [ruleId, ruleOpIndices] of sortedRuleGroups) {
      const info = allConfirmedSets.get(ruleId)!;
      const { confirmedSet, algoType } = info;
      const targetOpIdx = this._findTargetOperator(ruleId);
      const subplanIndices = this._findAlgorithmSubplanFromConfirmedSet(
        confirmedSet, algoType, ruleId, operatorHintMap, assignedOperators
      );

      for (const idx of subplanIndices) {
        if (!assignedOperators.has(idx)) assignedOperators.set(idx, ruleId);
      }

      const isOriginalSql = this._isOriginalSqlOperator(algoType, ruleOpIndices);
      const rootOpIdx = this._findRootOperatorIndex(subplanIndices);

      const operatorDetails: OperatorDetail[] = subplanIndices.map(idx => ({
        operator_id: this.operatorIds.get(idx) || `op_${idx}`,
        operator_type: this._getOperatorType(this.operators[idx]),
        data_type: (this.operatorDataTypes.get(idx) || DataType.UNKNOWN),
        has_hint: ruleOpIndices.includes(idx),
      }));

      const fullRuleName = this.algorithmIdToRuleName.get(ruleId) || 'UnknownRule';
      const fullRuleId = `${fullRuleName}#${ruleId}`;
      const tablescanInfo = this._collectTablescanAppendOnlyInfo(subplanIndices);

      algorithms.push({
        type: algoType,
        rule_id: fullRuleId,
        is_original_sql: isOriginalSql,
        operators: subplanIndices.map(idx => this.operatorIds.get(idx) || `op_${idx}`),
        rule_operators: ruleOpIndices.map(idx => this.operatorIds.get(idx) || `op_${idx}`),
        target_operator_id: targetOpIdx !== null ? (this.operatorIds.get(targetOpIdx) || null) : null,
        root_operator_id: rootOpIdx !== null ? (this.operatorIds.get(rootOpIdx) || null) : null,
        operator_details: operatorDetails,
        total_operators: subplanIndices.length,
        tablescan_append_only_info: tablescanInfo,
      });
    }
    return algorithms;
  }

  private _sortRuleGroupsByTopology(): [string, number[]][] {
    const ruleOrder: [number, string, number[]][] = [];
    for (const [ruleId, indices] of this.ruleGroups) {
      const minIdx = indices.length > 0 ? Math.min(...indices) : Infinity;
      ruleOrder.push([minIdx, ruleId, indices]);
    }
    ruleOrder.sort((a, b) => a[0] - b[0]);
    return ruleOrder.map(([, ruleId, indices]) => [ruleId, indices]);
  }

  private _identifyAlgorithmType(ruleId: string): string {
    const ruleName = this.algorithmIdToRuleName.get(ruleId) || ruleId;
    if (ruleName.includes('Aggregate') || ruleName.includes('Agg')) return 'aggregate';
    if (ruleName.includes('Join')) return 'join';
    if (ruleName.includes('Window')) return 'window';
    return 'unknown';
  }

  private _findTargetOperator(ruleId: string): number | null {
    const targetOpId = this._extractTargetOperatorId(ruleId);
    if (targetOpId && this.idToIndex.has(targetOpId)) return this.idToIndex.get(targetOpId)!;
    return null;
  }

  private _extractTargetOperatorId(ruleId: string): string | null {
    const match = ruleId.match(/#(\d+)/);
    return match ? match[1] : null;
  }

  private _connectHintOperatorsForAlgorithm(
    hintOperators: Set<number>, algorithmType: string, currentRuleId: string,
    operatorHintMap: Map<number, string>
  ): Set<number> {
    const confirmedSet = new Set(hintOperators);
    const hintListWithId = [...hintOperators].filter(
      idx => operatorHintMap.get(idx) === currentRuleId
    );

    for (let i = 0; i < hintListWithId.length; i++) {
      for (let j = i + 1; j < hintListWithId.length; j++) {
        const idx1 = hintListWithId[i];
        const idx2 = hintListWithId[j];
        if (this._hasPathBetween(idx1, idx2, 20, algorithmType, currentRuleId, operatorHintMap)) {
          const pathOps = this._findAllPathsBetween(idx1, idx2, 20, algorithmType, currentRuleId, operatorHintMap);
          for (const op of pathOps) confirmedSet.add(op);
        }
      }
    }
    return confirmedSet;
  }

  private _findAlgorithmSubplanFromConfirmedSet(
    confirmedSet: Set<number>, algorithmType: string, currentRuleId: string,
    operatorHintMap: Map<number, string>, assignedOperators: Map<number, string>
  ): number[] {
    const subplan = new Set(confirmedSet);
    const currentAlgoHintIndices = confirmedSet;

    const shouldStopAtOperator = (idx: number, direction: string): boolean => {
      if (idx < 0 || idx >= this.operators.length) return true;

      // Condition 1: DeletePlan
      const op = this.operators[idx];
      const opStr = JSON.stringify(op);
      if (opStr.toLowerCase().includes('deleteplan') || opStr.toLowerCase().includes('delete_plan')) {
        const ruleMatches = opStr.match(/Rule:([A-Za-z0-9_:#,\-()]+)/g) || [];
        for (const rm of ruleMatches) {
          if (rm.toLowerCase().includes('deleteplan') || rm.toLowerCase().includes('delete_plan')) return true;
        }
      }

      // Condition 2: Different hint
      if (operatorHintMap.has(idx)) {
        if (operatorHintMap.get(idx) !== currentRuleId) return true;
      }

      // Condition 3: Assigned to other algorithm
      if (assignedOperators.has(idx)) {
        if (assignedOperators.get(idx) !== currentRuleId) {
          const opId = this.operatorIds.get(idx) || '';
          const isTableScan = opId.includes('TableScan') || opId.toLowerCase().includes('tablescan');
          if (!isTableScan) return true;
        }
      }

      // Condition 4: Final/Complete aggregate
      if (algorithmType === 'aggregate' && !currentAlgoHintIndices.has(idx)) {
        const opType = this._getOperatorType(op);
        if (opType === 'aggregate') {
          const aggMode = this._getAggregateMode(op);
          if (aggMode && ['Final', 'Complete', 'FINAL', 'COMPLETE'].includes(aggMode)) {
            const currentRuleName = this.operatorRuleNames.get(idx);
            const algoRuleName = this.algorithmIdToRuleName.get(currentRuleId);
            if (currentRuleName && algoRuleName && currentRuleName === algoRuleName) return false;
            if (algoRuleName && this._hasDownstreamWithAlgorithmId(idx, currentRuleId, 10)) return false;
            return true;
          }
        }
      }

      // Condition 5: Snapshot boundary (upstream traversal)
      if (direction === 'down') {
        const currentDataType = this.operatorDataTypes.get(idx) || DataType.UNKNOWN;
        if (currentDataType === DataType.SNAPSHOT) {
          for (const inputIdx of this.operatorDependencies.get(idx) || []) {
            const inputDataType = this.operatorDataTypes.get(inputIdx) || DataType.UNKNOWN;
            if (inputDataType === DataType.SNAPSHOT) return true;
          }
        }
      }
      return false;
    };

    const isCalcBoundary = (idx: number): boolean => {
      if (idx < 0 || idx >= this.operators.length) return false;
      const op = this.operators[idx];
      const opType = this._getOperatorType(op);
      if (opType === 'calc') {
        const opStr = JSON.stringify(op);
        if (opStr.includes('DeltaState') && opStr.includes('Incremental')) {
          if (/DeltaState:.*?Incremental/is.test(opStr)) {
            if (opStr.includes(`#${currentRuleId}`)) return false;
            return true;
          }
        }
      }
      return false;
    };

    const isDfAggregate = (idx: number): boolean => {
      if (idx < 0 || idx >= this.operators.length) return false;
      const op = this.operators[idx];
      const opType = this._getOperatorType(op);
      if (opType !== 'aggregate') return false;
      const aggFunctions = this._getAggregateFunctions(op);
      const dfFunctions = new Set(['MULTI_RANGE_COLLECT', '_DF_BF_COLLECT', 'DF_BF_COLLECT', 'BF_COLLECT']);
      return aggFunctions.some(fn => dfFunctions.has(fn.toUpperCase()));
    };

    const dfsDown = (idx: number, visited: Set<number>): void => {
      if (visited.has(idx)) return;
      if (this._isDeleteplanOperator(idx)) return;
      if (isDfAggregate(idx)) return;
      visited.add(idx);
      subplan.add(idx);
      if (isCalcBoundary(idx)) return;
      if (shouldStopAtOperator(idx, 'down')) return;

      for (const inputIdx of this.operatorDependencies.get(idx) || []) {
        if (this._isDeleteplanOperator(inputIdx) || isDfAggregate(inputIdx)) continue;
        if (operatorHintMap.has(inputIdx) && operatorHintMap.get(inputIdx) !== currentRuleId) continue;
        if (this.operatorRuleNames.has(inputIdx)) {
          if (!operatorHintMap.has(inputIdx) || operatorHintMap.get(inputIdx) !== currentRuleId) continue;
        }
        dfsDown(inputIdx, visited);
      }
    };

    const dfsUp = (idx: number, visited: Set<number>, stopAtFinalAgg: boolean): void => {
      if (visited.has(idx)) return;
      if (this._isDeleteplanOperator(idx)) return;
      if (isDfAggregate(idx)) return;
      visited.add(idx);
      subplan.add(idx);
      if (isCalcBoundary(idx)) return;
      if (shouldStopAtOperator(idx, 'up')) return;

      let isFinalAgg = false;
      if (stopAtFinalAgg && algorithmType === 'aggregate') {
        const op = this.operators[idx];
        const opType = this._getOperatorType(op);
        if (opType === 'aggregate') {
          const aggMode = this._getAggregateMode(op);
          if (aggMode && ['Final', 'Complete', 'FINAL', 'COMPLETE'].includes(aggMode)) isFinalAgg = true;
        }
      }

      for (const outputIdx of this.operatorDependents.get(idx) || []) {
        if (this._isDeleteplanOperator(outputIdx) || isDfAggregate(outputIdx)) continue;
        if (operatorHintMap.has(outputIdx) && operatorHintMap.get(outputIdx) !== currentRuleId) continue;
        if (this.operatorRuleNames.has(outputIdx)) {
          if (!operatorHintMap.has(outputIdx) || operatorHintMap.get(outputIdx) !== currentRuleId) continue;
        }
        if (isFinalAgg) {
          const nextOp = this.operators[outputIdx];
          const nextOpType = this._getOperatorType(nextOp);
          if (nextOpType !== 'aggregate') dfsUp(outputIdx, visited, stopAtFinalAgg);
        } else {
          dfsUp(outputIdx, visited, stopAtFinalAgg);
        }
      }
    };

    const visitedDown = new Set<number>();
    const visitedUp = new Set<number>();
    const needFinalAgg = algorithmType === 'aggregate';

    for (const idx of confirmedSet) {
      dfsDown(idx, visitedDown);
      dfsUp(idx, visitedUp, needFinalAgg);
    }

    return [...subplan].sort((a, b) => a - b);
  }

  private _findDownstreamWithIdAndSameType(
    startIdx: number, targetRuleId: string, algorithmType: string,
    operatorHintMap: Map<number, string>, maxDepth = 10
  ): number | null {
    const visited = new Set<number>();
    const queue: [number, number][] = [[startIdx, 0]];

    while (queue.length > 0) {
      const [currentIdx, depth] = queue.shift()!;
      if (visited.has(currentIdx)) continue;
      visited.add(currentIdx);
      if (depth > maxDepth) continue;

      if (currentIdx !== startIdx) {
        if (operatorHintMap.get(currentIdx) === targetRuleId) {
          const opType = this._getOperatorType(this.operators[currentIdx]);
          if (opType === algorithmType) return currentIdx;
        }
      }
      for (const depIdx of this.operatorDependents.get(currentIdx) || []) {
        if (!visited.has(depIdx)) queue.push([depIdx, depth + 1]);
      }
    }
    return null;
  }

  // ==========================================================================
  // Path Finding
  // ==========================================================================

  private _hasPathBetween(
    fromIdx: number, toIdx: number, maxDepth: number,
    algorithmType: string, currentRuleId: string, operatorHintMap: Map<number, string>
  ): boolean {
    const visited = new Set<number>();
    const queue: [number, number][] = [[fromIdx, 0]];

    while (queue.length > 0) {
      const [currentIdx, depth] = queue.shift()!;
      if (currentIdx === toIdx) return true;
      if (depth > maxDepth) continue;
      if (visited.has(currentIdx)) continue;
      visited.add(currentIdx);

      if (this._shouldStopAtBoundary(currentIdx, algorithmType, currentRuleId, operatorHintMap)) continue;

      const neighbors = [
        ...(this.operatorDependencies.get(currentIdx) || []),
        ...(this.operatorDependents.get(currentIdx) || []),
      ];
      for (const neighborIdx of neighbors) {
        if (visited.has(neighborIdx)) continue;
        if (this._isDeleteplanOperator(neighborIdx)) continue;
        if (operatorHintMap.has(neighborIdx) && operatorHintMap.get(neighborIdx) !== currentRuleId) continue;
        queue.push([neighborIdx, depth + 1]);
      }
    }
    return false;
  }

  private _findAllPathsBetween(
    fromIdx: number, toIdx: number, maxDepth: number,
    algorithmType: string, currentRuleId: string, operatorHintMap: Map<number, string>
  ): Set<number> {
    const pathOperators = new Set<number>();
    const queue: [number, number, number[]][] = [[fromIdx, 0, [fromIdx]]];
    const allPaths: number[][] = [];

    while (queue.length > 0) {
      const [currentIdx, depth, path] = queue.shift()!;
      if (depth > maxDepth) continue;
      if (currentIdx === toIdx) { allPaths.push(path); continue; }
      if (this._shouldStopAtBoundary(currentIdx, algorithmType, currentRuleId, operatorHintMap)) continue;

      const neighbors = [
        ...(this.operatorDependencies.get(currentIdx) || []),
        ...(this.operatorDependents.get(currentIdx) || []),
      ];
      for (const neighborIdx of neighbors) {
        if (path.includes(neighborIdx)) continue;
        if (this._isDeleteplanOperator(neighborIdx)) continue;
        if (operatorHintMap.has(neighborIdx) && operatorHintMap.get(neighborIdx) !== currentRuleId) continue;
        queue.push([neighborIdx, depth + 1, [...path, neighborIdx]]);
      }
    }
    for (const path of allPaths) for (const idx of path) pathOperators.add(idx);
    return pathOperators;
  }

  private _shouldStopAtBoundary(
    idx: number, algorithmType: string, currentRuleId: string, operatorHintMap: Map<number, string>
  ): boolean {
    if (idx < 0 || idx >= this.operators.length) return true;
    if (this._isDeleteplanOperator(idx)) return true;
    if (operatorHintMap.has(idx) && operatorHintMap.get(idx) !== currentRuleId) return true;

    if (algorithmType === 'aggregate') {
      const op = this.operators[idx];
      const opType = this._getOperatorType(op);
      if (opType === 'aggregate') {
        const aggMode = this._getAggregateMode(op);
        if (aggMode && ['Final', 'Complete', 'FINAL', 'COMPLETE'].includes(aggMode)) {
          const currentRuleName = this.operatorRuleNames.get(idx);
          const algoRuleName = this.algorithmIdToRuleName.get(currentRuleId);
          if (currentRuleName && algoRuleName && currentRuleName === algoRuleName) return false;
          if (algoRuleName && this._hasDownstreamWithAlgorithmId(idx, currentRuleId, 10)) return false;
          return true;
        }
      }
    }
    return false;
  }

  // ==========================================================================
  // Downstream Search
  // ==========================================================================

  private _hasDownstreamSameRule(startIdx: number, targetRuleName: string, maxDepth = 10): boolean {
    const visited = new Set<number>();
    const queue: [number, number][] = [[startIdx, 0]];
    while (queue.length > 0) {
      const [currentIdx, depth] = queue.shift()!;
      if (visited.has(currentIdx)) continue;
      visited.add(currentIdx);
      if (depth > maxDepth) continue;
      if (this.operatorRuleNames.get(currentIdx) === targetRuleName) return true;
      for (const depIdx of this.operatorDependents.get(currentIdx) || []) {
        if (!visited.has(depIdx)) queue.push([depIdx, depth + 1]);
      }
    }
    return false;
  }

  private _hasDownstreamWithAlgorithmId(startIdx: number, targetAlgorithmId: string, maxDepth = 10): boolean {
    const visited = new Set<number>();
    const queue: [number, number][] = [[startIdx, 0]];
    while (queue.length > 0) {
      const [currentIdx, depth] = queue.shift()!;
      if (visited.has(currentIdx)) continue;
      visited.add(currentIdx);
      if (depth > maxDepth) continue;
      const indices = this.ruleGroups.get(targetAlgorithmId);
      if (indices && indices.includes(currentIdx)) return true;
      for (const depIdx of this.operatorDependents.get(currentIdx) || []) {
        if (!visited.has(depIdx)) queue.push([depIdx, depth + 1]);
      }
    }
    return false;
  }

  // ==========================================================================
  // Root / Original SQL / TableScan Info
  // ==========================================================================

  private _findRootOperatorIndex(subplanIndices: number[]): number | null {
    if (!subplanIndices.length) return null;
    const subplanSet = new Set(subplanIndices);
    for (let i = subplanIndices.length - 1; i >= 0; i--) {
      const idx = subplanIndices[i];
      const dependents = this.operatorDependents.get(idx) || [];
      if (!dependents.some(dep => subplanSet.has(dep))) return idx;
    }
    return Math.max(...subplanIndices);
  }

  private _isOriginalSqlOperator(algoType: string, opIndices: number[]): boolean {
    for (const idx of opIndices) {
      if (idx >= this.operators.length) continue;
      const op = this.operators[idx];
      if (this._getOperatorType(op) === algoType) return true;
    }
    return false;
  }

  private _collectTablescanAppendOnlyInfo(subplanIndices: number[]): TableScanAppendOnlyInfo {
    const tablescans: TableScanInfo[] = [];
    for (const idx of subplanIndices) {
      if (idx >= this.operators.length) continue;
      const op = this.operators[idx];
      if (!('tableScan' in op)) continue;

      const dataType = this.operatorDataTypes.get(idx) || DataType.UNKNOWN;
      const appendOnlyType = this.operatorAppendOnlyTypes.get(idx) || AppendOnlyType.UNKNOWN;
      const opId = this.operatorIds.get(idx) || `op_${idx}`;

      let tableName = 'unknown';
      try {
        const tableScan = op.tableScan || {};
        const tableInfo = tableScan.table || {};
        const tablePath: string[] = tableInfo.path || [];
        if (tablePath.length) tableName = tablePath.join('.');
      } catch { /* ignore */ }

      const isAppendOnly = dataType === DataType.DELTA && appendOnlyType === AppendOnlyType.APPEND_ONLY;
      tablescans.push({
        operator_id: opId,
        operator_index: idx,
        table_name: tableName,
        data_type: dataType,
        append_only_type: appendOnlyType,
        is_append_only: isAppendOnly,
      });
    }

    const deltaTablescans = tablescans.filter(ts => ts.data_type === DataType.DELTA);
    const allAppendOnly = deltaTablescans.length > 0 && deltaTablescans.every(ts => ts.is_append_only);

    return {
      has_tablescans: tablescans.length > 0,
      all_append_only: allAppendOnly,
      total_tablescans: tablescans.length,
      delta_tablescans: deltaTablescans.length,
      tablescans,
    };
  }

  // ==========================================================================
  // Step 7: Build Algorithm Dependencies
  // ==========================================================================

  private _buildAlgorithmDependencies(algorithms: IncrementalAlgorithm[]): Record<string, string[]> {
    const dependencies: Record<string, string[]> = {};
    for (const algo of algorithms) {
      const ruleId = algo.rule_id;
      dependencies[ruleId] = [];
      const algoIndices = algo.rule_operators
        .filter(opId => this.idToIndex.has(opId))
        .map(opId => this.idToIndex.get(opId)!);
      if (!algoIndices.length) continue;
      const minIdx = Math.min(...algoIndices);

      for (const otherAlgo of algorithms) {
        if (otherAlgo.rule_id === ruleId) continue;
        const otherIndices = otherAlgo.rule_operators
          .filter(opId => this.idToIndex.has(opId))
          .map(opId => this.idToIndex.get(opId)!);
        if (!otherIndices.length) continue;
        if (Math.max(...otherIndices) < minIdx) {
          dependencies[ruleId].push(otherAlgo.rule_id);
        }
      }
    }
    return dependencies;
  }

  // ==========================================================================
  // Step 8: Generate Dependency Graph
  // ==========================================================================

  private _generateDependencyGraph(algorithms: IncrementalAlgorithm[], dependencies: Record<string, string[]>): string {
    if (!algorithms.length) return '未检测到增量算法';

    const lines: string[] = ['', '='.repeat(60), '增量算法依赖关系图', '='.repeat(60), ''];

    const sortedAlgos = [...algorithms].sort((a, b) => {
      const aMin = Math.min(...a.rule_operators.filter(id => this.idToIndex.has(id)).map(id => this.idToIndex.get(id)!), Infinity);
      const bMin = Math.min(...b.rule_operators.filter(id => this.idToIndex.has(id)).map(id => this.idToIndex.get(id)!), Infinity);
      return aMin - bMin;
    });

    for (const algo of sortedAlgos) {
      const ruleId = algo.rule_id;
      const tag = algo.is_original_sql ? '(原始SQL)' : '(算法辅助)';
      lines.push(`[${algo.type.toUpperCase()}] ${tag}`);

      if (ruleId.includes('#')) {
        lines.push(`  ID: #${ruleId.split('#').pop()}`);
      } else {
        lines.push(`  Rule: ${ruleId.substring(0, 50)}...`);
      }

      if (algo.target_operator_id) lines.push(`  目标算子: ${algo.target_operator_id}`);
      if (algo.rule_operators.length) {
        let opList = algo.rule_operators.slice(0, 5).join(', ');
        if (algo.rule_operators.length > 5) opList += `, ... (共${algo.rule_operators.length}个 hint 算子)`;
        lines.push(`  Rule 算子: ${opList}`);
      }
      lines.push(`  完整 subplan: ${algo.operators.length} 个算子`);
      if (algo.root_operator_id) lines.push(`  Root 算子: ${algo.root_operator_id}`);

      const deps = dependencies[ruleId] || [];
      if (deps.length) {
        lines.push(`  ↓ 依赖于 ${deps.length} 个算法:`);
        for (const depId of deps.slice(0, 3)) {
          const depAlgo = algorithms.find(a => a.rule_id === depId);
          if (depAlgo) lines.push(`    - ${depAlgo.type.toUpperCase()}`);
        }
      } else {
        lines.push('  ↓ 无依赖（最底层）');
      }
      lines.push('');
    }

    lines.push('='.repeat(60));
    lines.push('执行顺序（从上到下）：');
    for (let i = 0; i < sortedAlgos.length; i++) {
      const algo = sortedAlgos[i];
      const tag = algo.is_original_sql ? '原始SQL' : '辅助';
      lines.push(`  ${i + 1}. ${algo.type.toUpperCase()} (${tag}) - ${algo.operators.length} 个算子`);
    }
    lines.push('='.repeat(60));
    return lines.join('\n');
  }

  // ==========================================================================
  // Step 9: Validation
  // ==========================================================================

  private _validateAlgorithms(algorithms: IncrementalAlgorithm[]): string[] {
    const warnings: string[] = [];
    const opToAlgos: Map<string, { rule_id: string; is_root: boolean }[]> = new Map();

    for (const algo of algorithms) {
      const ruleId = algo.rule_id;
      const rootOpId = algo.root_operator_id;
      for (const opId of algo.operators) {
        if (!opToAlgos.has(opId)) opToAlgos.set(opId, []);
        opToAlgos.get(opId)!.push({ rule_id: ruleId, is_root: opId === rootOpId });
      }
    }

    // Rule 1: Same operator in multiple algorithms
    for (const [opId, algoList] of opToAlgos) {
      if (algoList.length <= 1) continue;
      const isTableScan = opId.includes('TableScan') || opId.toLowerCase().includes('tablescan');
      const nonRootAlgos = algoList.filter(a => !a.is_root);
      if (!isTableScan && nonRootAlgos.length > 1) {
        const algoNames = nonRootAlgos.map(a => a.rule_id).slice(0, 3);
        warnings.push(
          `[算子唯一性] 算子 ${opId} 属于 ${nonRootAlgos.length} 个不同的增量算法: ${algoNames.join(', ')}${nonRootAlgos.length > 3 ? '...' : ''}`
        );
      }
    }

    // Rule 2: Upstream/downstream conflicts
    const algoOrder: Map<string, number> = new Map();
    for (const algo of algorithms) {
      let minIdx = Infinity;
      for (const opId of algo.operators) {
        if (this.idToIndex.has(opId)) minIdx = Math.min(minIdx, this.idToIndex.get(opId)!);
      }
      algoOrder.set(algo.rule_id, minIdx === Infinity ? 0 : minIdx);
    }

    for (const [opId, algoList] of opToAlgos) {
      if (algoList.length <= 1) continue;
      const isTableScan = opId.includes('TableScan') || opId.toLowerCase().includes('tablescan');
      const sorted = [...algoList].sort((a, b) => (algoOrder.get(a.rule_id) || 0) - (algoOrder.get(b.rule_id) || 0));
      for (let i = 0; i < sorted.length - 1; i++) {
        if (!sorted[i].is_root && !sorted[i + 1].is_root && !isTableScan) {
          warnings.push(
            `[上下游冲突] 算子 ${opId} 同时属于上游算法 ${sorted[i].rule_id} 和下游算法 ${sorted[i + 1].rule_id}`
          );
        }
      }
    }

    // Rule 3: Snapshot boundary
    for (const algo of algorithms) {
      for (const opId of algo.operators) {
        if (!this.idToIndex.has(opId)) continue;
        const idx = this.idToIndex.get(opId)!;
        const dataType = this.operatorDataTypes.get(idx) || DataType.UNKNOWN;
        if (dataType !== DataType.SNAPSHOT) continue;
        for (const upstreamIdx of this.operatorDependencies.get(idx) || []) {
          const upstreamId = this.operatorIds.get(upstreamIdx);
          if (upstreamId && algo.operators.includes(upstreamId)) {
            const upstreamDataType = this.operatorDataTypes.get(upstreamIdx) || DataType.UNKNOWN;
            if (upstreamDataType === DataType.SNAPSHOT) {
              warnings.push(
                `[Snapshot 边界] 算法 ${algo.rule_id} 包含 snapshot 算子 ${opId}，但继续向上游遍历到 snapshot 算子 ${upstreamId}`
              );
            }
          }
        }
      }
    }

    // Rule 4: Top-down traversal
    warnings.push(...this._validateTopdownTraversal(algorithms, opToAlgos));
    return warnings;
  }

  private _validateTopdownTraversal(
    algorithms: IncrementalAlgorithm[],
    opToAlgos: Map<string, { rule_id: string; is_root: boolean }[]>
  ): string[] {
    const warnings: string[] = [];
    const operatorHintMap: Map<number, string> = new Map();
    for (const [ruleId, indices] of this.ruleGroups) {
      for (const idx of indices) operatorHintMap.set(idx, ruleId);
    }

    for (const algo of algorithms) {
      const rootOpId = algo.root_operator_id;
      if (!rootOpId || !this.idToIndex.has(rootOpId)) continue;
      const rootIdx = this.idToIndex.get(rootOpId)!;
      const algoOpIndices = new Set(
        algo.operators.filter(id => this.idToIndex.has(id)).map(id => this.idToIndex.get(id)!)
      );
      const visited = new Set<number>();
      warnings.push(...this._topdownTraverseAndCheck(
        rootIdx, algo.rule_id, algo.type, operatorHintMap, opToAlgos, algoOpIndices, visited
      ));
    }
    return warnings;
  }

  private _topdownTraverseAndCheck(
    currentIdx: number, currentRuleId: string, algoType: string,
    operatorHintMap: Map<number, string>,
    opToAlgos: Map<string, { rule_id: string; is_root: boolean }[]>,
    algoOpIndices: Set<number>, visited: Set<number>
  ): string[] {
    const warnings: string[] = [];
    if (visited.has(currentIdx)) return warnings;
    visited.add(currentIdx);

    if (this._isBoundaryOperator(currentIdx, currentRuleId, algoType, operatorHintMap)) return warnings;

    const currentOpId = this.operatorIds.get(currentIdx);
    const inCurrentSubplan = algoOpIndices.has(currentIdx);

    if (inCurrentSubplan && currentOpId && opToAlgos.has(currentOpId)) {
      const algoList = opToAlgos.get(currentOpId)!;
      const isTableScan = currentOpId.includes('TableScan') || currentOpId.toLowerCase().includes('tablescan');
      if (!isTableScan) {
        const otherAlgos = algoList.filter(a => a.rule_id !== currentRuleId);
        if (otherAlgos.length) {
          const otherRuleIds = otherAlgos.map(a => a.rule_id).slice(0, 3);
          warnings.push(
            `[Top-Down 遍历] 算法 ${currentRuleId} 的 subplan 包含了算子 ${currentOpId}，但该算子属于其他算法: ${otherRuleIds.join(', ')}${otherAlgos.length > 3 ? '...' : ''}`
          );
        }
      }
    }

    for (const inputIdx of this.operatorDependencies.get(currentIdx) || []) {
      warnings.push(...this._topdownTraverseAndCheck(inputIdx, currentRuleId, algoType, operatorHintMap, opToAlgos, algoOpIndices, visited));
    }
    for (const outputIdx of this.operatorDependents.get(currentIdx) || []) {
      warnings.push(...this._topdownTraverseAndCheck(outputIdx, currentRuleId, algoType, operatorHintMap, opToAlgos, algoOpIndices, visited));
    }
    return warnings;
  }

  private _isBoundaryOperator(idx: number, currentRuleId: string, algoType: string, operatorHintMap: Map<number, string>): boolean {
    if (idx < 0 || idx >= this.operators.length) return true;
    if (this._isDeleteplanOperator(idx)) return true;
    if (operatorHintMap.has(idx) && operatorHintMap.get(idx) !== currentRuleId) return true;

    if (algoType === 'aggregate') {
      const op = this.operators[idx];
      const opType = this._getOperatorType(op);
      if (opType === 'aggregate') {
        const aggMode = this._getAggregateMode(op);
        if (aggMode && ['Final', 'Complete', 'FINAL', 'COMPLETE'].includes(aggMode)) return true;
      }
    }

    const currentDataType = this.operatorDataTypes.get(idx) || DataType.UNKNOWN;
    if (currentDataType === DataType.SNAPSHOT) {
      for (const inputIdx of this.operatorDependencies.get(idx) || []) {
        if ((this.operatorDataTypes.get(inputIdx) || DataType.UNKNOWN) === DataType.SNAPSHOT) return true;
      }
    }
    return false;
  }

  // ==========================================================================
  // Detect Rule Name Conflicts
  // ==========================================================================

  private _detectRuleNameConflicts(): RuleNameConflict[] {
    const conflicts: RuleNameConflict[] = [];
    for (const [algorithmId, ruleNames] of this.algorithmIdRuleConflicts) {
      if (ruleNames.size > 1) {
        const selectedName = this.algorithmIdToRuleName.get(algorithmId) || 'Unknown';
        const sortedNames = [...ruleNames].sort();
        conflicts.push({
          algorithm_id: algorithmId,
          rule_names: sortedNames,
          selected_name: selectedName,
          message: `算法 ID #${algorithmId} 有 ${ruleNames.size} 个不同的 rule 名称: ${sortedNames.join(', ')}。已选择: ${selectedName}`,
        });
      }
    }
    return conflicts;
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  private _getOperatorType(op: Record<string, any>): string {
    return getOperatorTypeFromObj(op);
  }

  private _getAggregateMode(op: Record<string, any>): string | null {
    const hashAgg = op.hashAgg || op.hashAggregate;
    if (!hashAgg || typeof hashAgg !== 'object') return null;

    if (hashAgg.stage) return String(hashAgg.stage);
    if (hashAgg.aggregate && typeof hashAgg.aggregate === 'object') {
      const calls: any[] = hashAgg.aggregate.aggregateCalls || [];
      if (calls.length > 0 && calls[0]?.stage) return String(calls[0].stage);
    }
    if (hashAgg.mode) return String(hashAgg.mode);
    return null;
  }

  private _getAggregateFunctions(op: Record<string, any>): string[] {
    const functions: string[] = [];
    const hashAgg = op.hashAgg || op.hashAggregate;
    if (!hashAgg || typeof hashAgg !== 'object') return functions;

    const aggregate = hashAgg.aggregate;
    if (!aggregate || typeof aggregate !== 'object') return functions;
    const calls: any[] = aggregate.aggregateCalls || [];
    for (const call of calls) {
      if (!call || typeof call !== 'object' || !call.function) continue;
      const funcObj = call.function;
      if (typeof funcObj === 'object') {
        if (funcObj.function && typeof funcObj.function === 'object' && funcObj.function.name) {
          functions.push(String(funcObj.function.name));
        } else if (funcObj.name) {
          functions.push(String(funcObj.name));
        }
      }
    }
    return functions;
  }

  private _getOperatorStr(idx: number): string {
    if (!this._operatorStrCache.has(idx)) {
      if (idx < 0 || idx >= this.operators.length) {
        this._operatorStrCache.set(idx, '');
      } else {
        this._operatorStrCache.set(idx, JSON.stringify(this.operators[idx]));
      }
    }
    return this._operatorStrCache.get(idx)!;
  }

  private _isDeleteplanOperator(idx: number): boolean {
    if (this._isDeleteplanCache.has(idx)) return this._isDeleteplanCache.get(idx)!;
    if (idx < 0 || idx >= this.operators.length) {
      this._isDeleteplanCache.set(idx, false);
      return false;
    }
    const opStr = this._getOperatorStr(idx);
    let result = false;
    if (opStr.toLowerCase().includes('deleteplan') || opStr.toLowerCase().includes('delete_plan')) {
      const matches = opStr.match(/Rule:([A-Za-z0-9_:#,\-()]+)/g) || [];
      for (const m of matches) {
        if (m.toLowerCase().includes('deleteplan') || m.toLowerCase().includes('delete_plan')) {
          result = true;
          break;
        }
      }
    }
    this._isDeleteplanCache.set(idx, result);
    return result;
  }

  private _logAlgorithmDetails(algorithms: IncrementalAlgorithm[]): void {
    if (!algorithms.length) return;
    logger.debug(`增量算法详细信息 - 共 ${algorithms.length} 个`);
    for (let i = 0; i < algorithms.length; i++) {
      const algo = algorithms[i];
      const [ruleName, algoId] = algo.rule_id.includes('#')
        ? algo.rule_id.split('#', 2) as [string, string]
        : [algo.rule_id, 'N/A'];
      logger.debug(`算法 ${i + 1}: ${ruleName} | ID: ${algoId} | 类型: ${algo.type} | 原始SQL: ${algo.is_original_sql ? '✓' : '✗'} | 算子: ${algo.operators.length}`);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createIncrementalAnalyzer(stageData: Record<string, any>): IncrementalAlgorithmAnalyzer {
  const plan = stageData.plan || {};
  return new IncrementalAlgorithmAnalyzer(plan);
}
