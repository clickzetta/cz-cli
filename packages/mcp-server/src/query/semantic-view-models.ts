/**
 * semantic-view-models.ts — port of cz_mcp/query/semantic_view.py (lines 18-960)
 * Data model classes for ClickZetta Semantic Views.
 */

import * as fs from "fs"

// ─── Utility Functions ───────────────────────────────────────────────────────

export function parseYamlOrDict(inputData: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof inputData === "object" && inputData !== null) return inputData
  if (typeof inputData === "string") {
    const cleaned = inputData.trim()
    if (!cleaned) return {}
    try {
      const result = JSON.parse(cleaned)
      if (result === null || result === undefined) return {}
      if (typeof result === "object" && !Array.isArray(result)) return result as Record<string, unknown>
      throw new Error(`解析结果不是字典，而是${typeof result}`)
    } catch (e) {
      throw new Error(`无效的格式: ${e}`)
    }
  }
  throw new TypeError(`输入类型必须是字符串或字典，而不是${typeof inputData}`)
}

export function readYamlConfig(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) throw new Error(`配置文件 ${filePath} 不存在`)
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

export function getNestedConfig(config: Record<string, unknown>, keys: string | string[], defaultValue?: unknown): unknown {
  const keyList = typeof keys === "string" ? keys.split(".") : keys
  let current: unknown = config
  for (const key of keyList) {
    if (current && typeof current === "object" && key in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[key]
    } else {
      return defaultValue
    }
  }
  return current
}

export function convertToListOfStr(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch { /* not JSON */ }
    return value.split(",").map(s => s.trim()).filter(Boolean)
  }
  return [String(value)]
}

// ─── SV Models ───────────────────────────────────────────────────────────────

export interface SVBaseTable {
  table: string
  database: string
  workspace: string
}

export function svBaseTableGetFullName(bt: SVBaseTable): string {
  return `${bt.workspace}.${bt.database}.${bt.table}`
}

export function svBaseTableGetFullName_(bt: SVBaseTable): string {
  return `${bt.database}.${bt.table}`
}

export interface SVTimeDimension {
  column_name: string
  synonyms: string[]
  comments: string
  expr: string
  datetime_format: string
  unique: boolean
  sample_values: string[]
  data_type: string
}

export interface SVDimension {
  column_name: string
  synonyms: string[]
  comments: string
  expr: string
  data_type: string
  unique: boolean
  unique_values: string[]
  index: boolean
}

export function svDimensionGetDisplayName(dim: SVDimension): string {
  if (dim.synonyms.length > 0) {
    let displayName = dim.synonyms[0].toLowerCase()
    displayName = displayName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")
    displayName = displayName.replace(/_+/g, "_")
    displayName = displayName.replace(/^_|_$/g, "")
    return displayName
  }
  return dim.column_name
}

export interface SVFilter {
  column_name: string
  synonyms: string[]
  comments: string
  expr: string
  data_type: string
  unique: boolean
  unique_values: string[]
}

export function svFilterGetDisplayName(f: SVFilter): string {
  if (f.synonyms.length > 0) {
    let displayName = f.synonyms[0].toLowerCase()
    displayName = displayName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")
    displayName = displayName.replace(/_+/g, "_")
    displayName = displayName.replace(/^_|_$/g, "")
    return displayName
  }
  return f.column_name
}

export interface SVPartition {
  column_name: string
  synonyms: string[]
  comments: string
  default_partition_number: number
}

export enum SVPopType {
  NUMBER = "number",
  PROPORTION = "proportion",
}

export interface SVMetric {
  name: string
  namespace: string[]
  expr: string
  comments: string
  synonyms: string[]
  pop_type: SVPopType
}

export interface SVTable {
  names: string[]
  dimensions: SVDimension[]
  base_table: SVBaseTable
  filters: SVFilter[]
  primary_key: string[]
  hint_instructions: string
  time_dimensions: SVTimeDimension[]
  metrics: SVMetric[]
}

export enum SVJoinType {
  LEFT_JOIN = "left_join",
  INNER_JOIN = "inner_join",
  LEFT_OUTER_JOIN = "left_outer",
}

export enum SVRelationshipType {
  ONE_TO_ONE = "one_to_one",
  MANY_TO_ONE = "many_to_one",
}

export interface SVRelationship {
  name: string
  join_type: SVJoinType
  relationship_type: SVRelationshipType
  left_table: string
  right_table: string
  left_column: string
  right_column: string
}

export interface SVVerifiedQuery {
  question: string
  name: string
  sql: string
  creator: string
  create_time: string
}

export interface SVSemanticView {
  name: string
  comments: string
  tables: SVTable[]
  relationships: SVRelationship[]
  metrics: SVMetric[]
  verified_queries: SVVerifiedQuery[]
  custom_instructions: string
  base_table_name_2_obj: Record<string, SVBaseTable>
  table_name_2_obj: Record<string, SVTable>
}

export function createSVSemanticView(partial?: Partial<SVSemanticView>): SVSemanticView {
  return {
    name: "",
    comments: "",
    tables: [],
    relationships: [],
    metrics: [],
    verified_queries: [],
    custom_instructions: "",
    base_table_name_2_obj: {},
    table_name_2_obj: {},
    ...partial,
  }
}

export function svSemanticViewToYaml(sv: SVSemanticView): string {
  const { base_table_name_2_obj: _, table_name_2_obj: __, ...rest } = sv
  return JSON.stringify(rest, null, 2)
}

export function svSemanticViewAddTable(sv: SVSemanticView, table: SVTable): void {
  sv.tables.push(table)
}

export function svSemanticViewCreateCache(sv: SVSemanticView): void {
  for (const table of sv.tables) {
    sv.base_table_name_2_obj[svBaseTableGetFullName(table.base_table)] = table.base_table
    for (const name of table.names) {
      sv.table_name_2_obj[name] = table
    }
  }
}

export function svSemanticViewGetRelationTableColumn(
  sv: SVSemanticView, tableName: string, columnName: string,
): [string, string] | undefined {
  for (const rel of sv.relationships) {
    if (rel.left_table === tableName && rel.left_column === columnName) return [rel.right_table, rel.right_column]
    if (rel.right_table === tableName && rel.right_column === columnName) return [rel.left_table, rel.left_column]
  }
  return undefined
}

export function svSemanticViewGetRelationsInTable(
  sv: SVSemanticView, leftTable: string, relationTypes: SVRelationshipType[],
): SVRelationship[] {
  const relations: SVRelationship[] = []
  if (relationTypes.includes(SVRelationshipType.MANY_TO_ONE)) {
    for (const rel of sv.relationships) {
      if (rel.relationship_type === SVRelationshipType.MANY_TO_ONE && rel.left_table === leftTable) {
        relations.push(rel)
      }
    }
  }
  if (relationTypes.includes(SVRelationshipType.ONE_TO_ONE)) {
    for (const rel of sv.relationships) {
      if (rel.relationship_type === SVRelationshipType.ONE_TO_ONE && (rel.left_table === leftTable || rel.right_table === leftTable)) {
        relations.push(rel)
      }
    }
  }
  return relations
}

export function svSemanticViewCreationSql(sv: SVSemanticView): string {
  const tableDefinitions: string[] = []
  for (const table of sv.tables) {
    let tableStr = `   ${table.names[0]} AS ${svBaseTableGetFullName_(table.base_table)}\n`

    const tableRelations = svSemanticViewGetRelationsInTable(
      sv, table.names[0], [SVRelationshipType.MANY_TO_ONE, SVRelationshipType.ONE_TO_ONE],
    )

    if (table.primary_key.length > 0) {
      tableStr += `     PRIMARY KEY (${table.primary_key.join(", ")})\n`
    }

    const referenceTables = new Set<string>()
    for (const rel of tableRelations) {
      if (rel.left_table === table.names[0] && !referenceTables.has(rel.right_table)) {
        referenceTables.add(rel.right_table)
        tableStr += `     FOREIGN KEY (${rel.left_column}) REFERENCES ${rel.right_table}\n`
      } else if (rel.right_table === table.names[0] && !referenceTables.has(rel.left_table)) {
        referenceTables.add(rel.left_table)
        tableStr += `     FOREIGN KEY (${rel.right_column}) REFERENCES ${rel.left_table}\n`
      }
    }

    if (table.names.length > 1) {
      tableStr += `     WITH SYNONYMS (${table.names.slice(1).join(", ")})\n`
    }

    let escapedComment = table.hint_instructions.replace(/'/g, "''").replace(/\n/g, " ")
    tableStr += `     COMMENT = '${escapedComment}'`
    tableDefinitions.push(tableStr)
  }

  const tablesStr = `  TABLES (\n${tableDefinitions.join(",\n\n")}\n)\n`

  // Filters
  const filterDefinitions: string[] = []
  for (const table of sv.tables) {
    for (const tableFilter of table.filters) {
      const filterDisplayName = svFilterGetDisplayName(tableFilter)
      const filterExpr = (tableFilter.expr ?? tableFilter.column_name).replace(/"/g, "'")
      filterDefinitions.push(`   ${table.names[0]}.${filterDisplayName} AS ${filterExpr}`)
    }
  }
  const filtersStr = filterDefinitions.length > 0
    ? `  FILTERS (\n${filterDefinitions.join(",\n")}\n)\n`
    : ""

  // Dimensions
  const dimensionDefinitions: string[] = []
  for (const table of sv.tables) {
    for (const dimension of table.dimensions) {
      const dimensionDisplayName = svDimensionGetDisplayName(dimension)
      let dimStr = `   ${table.names[0]}.${dimensionDisplayName} as ${table.names[0]}.${dimension.expr}\n`
      const isTime = ["DATE", "DATETIME", "TIMESTAMP", "TIME"].includes(dimension.data_type.toUpperCase())
      dimStr += `      is_time = ${isTime}\n`
      if (dimension.synonyms.length > 0) {
        dimStr += `      WITH SYNONYMS (${dimension.synonyms.map(s => `'${s}'`).join(", ")})\n`
      }
      if (dimension.unique_values.length > 0) {
        dimStr += `      ENUM_VALUES = [${dimension.unique_values.join(", ")}]\n`
      }
      if (dimension.comments.length > 0) {
        const escaped = dimension.comments.replace(/'/g, "''")
        dimStr += `      comment = '${escaped}'`
      }
      dimensionDefinitions.push(dimStr)
    }
  }
  const dimensionsStr = `  DIMENSIONS (\n${dimensionDefinitions.join(",\n\n")}\n)\n`

  // Metrics
  const allMetricDefinitions: string[] = []
  for (const table of sv.tables) {
    if (!table.metrics || table.metrics.length === 0) continue
    for (const metric of table.metrics) {
      const escapedExpr = metric.expr.replace(/'/g, "''")
      let metricStr = `   ${table.names[0]}.${metric.name} AS ${table.names[0]}.${escapedExpr}\n`
      if (metric.synonyms.length > 0) {
        metricStr += `      WITH SYNONYMS (${metric.synonyms.map(s => `'${s}'`).join(", ")})\n`
      }
      if (metric.comments.length > 0) {
        const escaped = metric.comments.replace(/'/g, "''")
        metricStr += `      COMMENT = '${escaped}'`
      }
      allMetricDefinitions.push(metricStr)
    }
  }

  if (sv.metrics.length > 0) {
    if (allMetricDefinitions.length > 0) {
      allMetricDefinitions.push("\n     -- 模型级指标")
    }
    for (const metric of sv.metrics) {
      const escapedExpr = metric.expr.replace(/'/g, "''")
      let metricStr = `   ${metric.name} AS ${escapedExpr}\n`
      if (metric.synonyms.length > 0) {
        metricStr += `      WITH SYNONYMS (${metric.synonyms.map(s => `'${s}'`).join(", ")})\n`
      }
      if (metric.comments.length > 0) {
        const escaped = metric.comments.replace(/'/g, "''")
        metricStr += `      COMMENT = '${escaped}'`
      }
      allMetricDefinitions.push(metricStr)
    }
  }

  const finalMetrics: string[] = []
  for (let idx = 0; idx < allMetricDefinitions.length; idx++) {
    let metricDef = allMetricDefinitions[idx]
    if (metricDef.trim().startsWith("--")) {
      finalMetrics.push(metricDef)
      continue
    }
    if (idx !== allMetricDefinitions.length - 1) {
      const lines = metricDef.split("\n")
      for (let li = 0; li < lines.length; li++) {
        if (lines[li].includes("COMMENT = '")) {
          lines[li] = lines[li] + ","
          break
        }
      }
      metricDef = lines.join("\n")
    }
    finalMetrics.push(metricDef)
  }

  const metricsStr = `  METRICS (\n${finalMetrics.join("\n")}\n)\n`

  let commentStr = ""
  if (sv.comments.length > 0) {
    const escaped = sv.comments.replace(/'/g, "''").replace(/\n/g, " ")
    commentStr = `  \n  COMMENT = '${escaped}';`
  }

  return tablesStr + filtersStr + dimensionsStr + metricsStr + commentStr
}

// ─── CzSv Models (Lakehouse compiler output) ────────────────────────────────

export enum CzSvTableType {
  TABLE = "TABLE",
  UNKNOWN = "UNKNOWN",
}

export interface CzSvIdentifier {
  type: CzSvTableType
  instanceId: string
  namespace: string[]
  namespaceId: string[]
  namespaceType: string[]
  name: string
  id: string
  version: string
}

export interface CzSvFieldReference {
  fieldName: string
}

export interface CzSvPrimaryKey {
  fields: CzSvFieldReference[]
  enable: boolean
  rely: boolean
}

export interface CzSvForeignKey {
  fields: CzSvFieldReference[]
  refTable: CzSvIdentifier
  refFields: CzSvFieldReference[]
  enable: boolean
  rely: boolean
}

export interface CzSvConstraint {
  specId: number
  properties: string[]
  name: string
  primaryKey?: CzSvPrimaryKey
  foreignKey?: CzSvForeignKey
}

export interface CzSvLogicalTable {
  tableIdentifier: CzSvIdentifier
  alias: string
  constraints: CzSvConstraint[]
  synonyms: string[]
  comment: string
}

export interface CzSvEnumValue {
  date?: number
}

export interface TypedValue {
  [key: string]: unknown
}

export function typedValueKey(tv: TypedValue): string {
  return Object.keys(tv)[0]
}

export function typedValueValue(tv: TypedValue): unknown {
  return Object.values(tv)[0]
}

export interface CzSvTrait {
  enumValues: TypedValue[]
  isUnique?: boolean
  isTime?: boolean
}

export interface CzSvDimension {
  name: CzSvIdentifier
  expressionText: string
  expressionExpandedText: string
  synonyms: string[]
  trait?: CzSvTrait
  comment: string
}

export interface CzSvMetric {
  name: CzSvIdentifier
  expressionText: string
  expressionExpandedText: string
  synonyms: string[]
  comment: string
}

export interface CzSvFilter {
  name: CzSvIdentifier
  expressionText: string
  expressionExpandedText: string
  synonyms: string[]
  comment: string
}

export interface CzSvFact {
  name: CzSvIdentifier
  expressionText: string
  expressionExpandedText: string
  synonyms: string[]
  comment: string
}

export interface CzSvDataModel {
  logicalTables: CzSvLogicalTable[]
  facts: CzSvFact[]
  dimensions: CzSvDimension[]
  metrics: CzSvMetric[]
  filters: CzSvFilter[]
}

// ─── CzSemanticViewUtils ─────────────────────────────────────────────────────

export class CzSemanticViewUtils {
  static getBaseTableDict(model: CzSvDataModel): Record<string, SVBaseTable> {
    const dict: Record<string, SVBaseTable> = {}
    for (const lt of model.logicalTables) {
      const bt: SVBaseTable = {
        table: lt.tableIdentifier.name,
        database: lt.tableIdentifier.namespace[1],
        workspace: lt.tableIdentifier.namespace[0],
      }
      dict[svBaseTableGetFullName(bt)] = bt
    }
    return dict
  }

  static getLogicalTableToBaseTableMapping(model: CzSvDataModel): Record<string, SVBaseTable> {
    const mapping: Record<string, SVBaseTable> = {}
    for (const lt of model.logicalTables) {
      mapping[lt.alias] = {
        table: lt.tableIdentifier.name,
        database: lt.tableIdentifier.namespace[1],
        workspace: lt.tableIdentifier.namespace[0],
      }
    }
    return mapping
  }

  static getLogicalTableToDimensionListMapping(model: CzSvDataModel): Record<string, SVDimension[]> {
    const mapping: Record<string, SVDimension[]> = {}
    for (const dim of model.dimensions) {
      if (dim.trait?.isTime) continue
      const logicalTable = dim.name.namespace[0]
      const uniqueValues: string[] = dim.trait?.enumValues
        ? dim.trait.enumValues.map(ev => String(typedValueValue(ev)))
        : []
      const svDim: SVDimension = {
        column_name: dim.name.name,
        expr: dim.expressionExpandedText,
        data_type: dim.trait?.enumValues?.length ? typedValueKey(dim.trait.enumValues[0]) : "",
        synonyms: dim.synonyms,
        comments: dim.comment,
        unique: dim.trait?.isUnique ?? false,
        unique_values: uniqueValues,
        index: false,
      }
      if (!mapping[logicalTable]) mapping[logicalTable] = []
      mapping[logicalTable].push(svDim)
    }
    return mapping
  }

  static getLogicalTableToFilterListMapping(model: CzSvDataModel): Record<string, SVFilter[]> {
    const mapping: Record<string, SVFilter[]> = {}
    for (const filt of model.filters) {
      const logicalTable = filt.name.namespace[0]
      const svFilter: SVFilter = {
        column_name: filt.name.name,
        expr: filt.expressionExpandedText,
        data_type: "",
        synonyms: filt.synonyms,
        comments: "",
        unique: false,
        unique_values: [],
      }
      if (!mapping[logicalTable]) mapping[logicalTable] = []
      mapping[logicalTable].push(svFilter)
    }
    return mapping
  }

  static getLogicalTableToTimeDimensionListMapping(model: CzSvDataModel): Record<string, SVTimeDimension[]> {
    const mapping: Record<string, SVTimeDimension[]> = {}
    for (const dim of model.dimensions) {
      if (!dim.trait?.isTime) continue
      const logicalTable = dim.name.namespace[0]
      const svTimeDim: SVTimeDimension = {
        column_name: dim.name.name,
        expr: dim.expressionExpandedText,
        synonyms: dim.synonyms,
        comments: dim.comment,
        unique: dim.trait?.isUnique ?? false,
        datetime_format: "",
        sample_values: [],
        data_type: "",
      }
      if (!mapping[logicalTable]) mapping[logicalTable] = []
      mapping[logicalTable].push(svTimeDim)
    }
    return mapping
  }

  static getLogicalTableToPrimaryKeyMapping(model: CzSvDataModel): Record<string, string[]> {
    const mapping: Record<string, string[]> = {}
    for (const lt of model.logicalTables) {
      const pkColumns: string[] = []
      for (const constraint of lt.constraints) {
        if (constraint.primaryKey?.enable) {
          for (const fieldRef of constraint.primaryKey.fields) {
            pkColumns.push(fieldRef.fieldName)
          }
        }
      }
      mapping[lt.alias] = pkColumns
    }
    return mapping
  }

  static getLogicalTableMapping(model: CzSvDataModel): Record<string, SVTable> {
    const dimensionsMapping = CzSemanticViewUtils.getLogicalTableToDimensionListMapping(model)
    const filtersMapping = CzSemanticViewUtils.getLogicalTableToFilterListMapping(model)
    const primaryKeyMapping = CzSemanticViewUtils.getLogicalTableToPrimaryKeyMapping(model)
    const timeDimensionsMapping = CzSemanticViewUtils.getLogicalTableToTimeDimensionListMapping(model)

    const mapping: Record<string, SVTable> = {}
    for (const lt of model.logicalTables) {
      mapping[lt.alias] = {
        names: [lt.alias, ...lt.synonyms],
        dimensions: dimensionsMapping[lt.alias] ?? [],
        base_table: {
          table: lt.tableIdentifier.name,
          database: lt.tableIdentifier.namespace[1],
          workspace: lt.tableIdentifier.namespace[0],
        },
        filters: filtersMapping[lt.alias] ?? [],
        primary_key: primaryKeyMapping[lt.alias] ?? [],
        hint_instructions: lt.comment,
        time_dimensions: timeDimensionsMapping[lt.alias] ?? [],
        metrics: [],
      }
    }
    return mapping
  }

  static getMetricsMapping(model: CzSvDataModel): Record<string, SVMetric> {
    const mapping: Record<string, SVMetric> = {}
    for (const metric of model.metrics) {
      const svMetric: SVMetric = {
        name: metric.name.name,
        namespace: metric.name.namespace,
        expr: metric.expressionExpandedText,
        synonyms: metric.synonyms,
        comments: metric.comment,
        pop_type: SVPopType.NUMBER,
      }
      mapping[svMetric.name] = svMetric
    }
    return mapping
  }

  static getRelationships(model: CzSvDataModel): SVRelationship[] {
    const relationships: SVRelationship[] = []
    for (const lt of model.logicalTables) {
      for (const constraint of lt.constraints) {
        if (constraint.foreignKey) {
          const fk = constraint.foreignKey
          relationships.push({
            name: constraint.name,
            join_type: SVJoinType.LEFT_JOIN,
            relationship_type: SVRelationshipType.MANY_TO_ONE,
            left_table: lt.alias,
            right_table: fk.refTable.name,
            left_column: fk.fields[0].fieldName,
            right_column: fk.refFields[0].fieldName,
          })
        }
      }
    }
    return relationships
  }

  static getSemanticView(model: CzSvDataModel): SVSemanticView {
    const sv = createSVSemanticView()
    sv.base_table_name_2_obj = CzSemanticViewUtils.getBaseTableDict(model)
    sv.table_name_2_obj = CzSemanticViewUtils.getLogicalTableMapping(model)
    sv.tables = Object.values(sv.table_name_2_obj)
    sv.relationships = CzSemanticViewUtils.getRelationships(model)
    sv.metrics = Object.values(CzSemanticViewUtils.getMetricsMapping(model))
    svSemanticViewCreateCache(sv)
    return sv
  }
}
