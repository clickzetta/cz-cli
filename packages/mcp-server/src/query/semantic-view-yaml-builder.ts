/**
 * semantic-view-yaml-builder.ts — port of cz_mcp/query/semantic_view_yaml_builder.py
 */

import { dataToYaml } from "../common/utilities.js"

export interface ModelInfo {
  name: string
  description: string
}

export interface SemanticViewYAMLBuilder {
  modelInfo: ModelInfo
  tables: Record<string, unknown>[]
  relationships: Record<string, unknown>[]
}

export function createYAMLBuilder(): SemanticViewYAMLBuilder {
  return { modelInfo: { name: "", description: "" }, tables: [], relationships: [] }
}

export function setModelInfo(builder: SemanticViewYAMLBuilder, name: string, description: string): void {
  builder.modelInfo = { name, description }
}

export function setModelInfoFromJson(builder: SemanticViewYAMLBuilder, modelInfoJson: string): void {
  const info = JSON.parse(modelInfoJson) as ModelInfo
  setModelInfo(builder, info.name, info.description)
}

export function addTable(builder: SemanticViewYAMLBuilder, tableYaml: string): void {
  const tableDict = JSON.parse(tableYaml) as Record<string, unknown>
  builder.tables.push(tableDict)
}

export function addTablesFromList(builder: SemanticViewYAMLBuilder, tablesYamlList: string[]): void {
  for (const t of tablesYamlList) addTable(builder, t)
}

export function setRelationships(builder: SemanticViewYAMLBuilder, relationshipsJson: string): void {
  if (relationshipsJson.trim()) {
    const parsed = JSON.parse(relationshipsJson)
    builder.relationships = Array.isArray(parsed) ? parsed : [parsed]
  } else {
    builder.relationships = []
  }
}

export function buildYaml(builder: SemanticViewYAMLBuilder): string {
  if (!builder.modelInfo.name) throw new Error("缺少 model name")
  if (!builder.modelInfo.description) throw new Error("缺少 model description")
  if (!builder.tables.length) throw new Error("至少需要一个 table")

  const complete = {
    name: builder.modelInfo.name,
    description: builder.modelInfo.description,
    tables: builder.tables,
    relationships: builder.relationships,
  }
  return dataToYaml(complete)
}

export function buildYamlDict(builder: SemanticViewYAMLBuilder): Record<string, unknown> {
  if (!builder.modelInfo.name) throw new Error("缺少 model name")
  if (!builder.modelInfo.description) throw new Error("缺少 model description")
  if (!builder.tables.length) throw new Error("至少需要一个 table")

  return {
    name: builder.modelInfo.name,
    description: builder.modelInfo.description,
    tables: builder.tables,
    relationships: builder.relationships,
  }
}

export function resetBuilder(builder: SemanticViewYAMLBuilder): void {
  builder.modelInfo = { name: "", description: "" }
  builder.tables = []
  builder.relationships = []
}

export function buildSemanticViewYaml(
  modelInfoJson: string,
  tablesYamlList: string[],
  relationshipsJson: string,
): string {
  const builder = createYAMLBuilder()
  setModelInfoFromJson(builder, modelInfoJson)
  addTablesFromList(builder, tablesYamlList)
  setRelationships(builder, relationshipsJson)
  return buildYaml(builder)
}

export function buildSemanticViewYamlFromParts(
  name: string,
  description: string,
  tablesYamlList: string[],
  relationshipsJson = "",
): string {
  const builder = createYAMLBuilder()
  setModelInfo(builder, name, description)
  addTablesFromList(builder, tablesYamlList)
  setRelationships(builder, relationshipsJson)
  return buildYaml(builder)
}

export function extractTablesInfoForRelationships(tablesMetadata: Record<string, unknown>[]): string {
  const tablesInfo = tablesMetadata.map((meta) => ({
    logical_name: generateLogicalTableName(meta["table_name"] as string),
    physical_name: meta["table_name"],
    foreign_keys: (meta["foreign_keys"] as unknown[]) ?? [],
  }))
  return JSON.stringify(tablesInfo, null, 2)
}

function generateLogicalTableName(physicalName: string): string {
  const name = physicalName.toLowerCase()
  if (name.endsWith("s")) return name
  if (name.endsWith("y")) return name.slice(0, -1) + "ies"
  if (name.endsWith("ch") || name.endsWith("sh") || name.endsWith("x") || name.endsWith("z"))
    return name + "es"
  return name + "s"
}

export interface ValidationResult {
  is_valid: boolean
  errors: string[]
}

export function validateYamlStructure(yamlObj: unknown): ValidationResult {
  const errors: string[] = []
  try {
    const data = typeof yamlObj === "string" ? JSON.parse(yamlObj) : yamlObj
    if (!data || typeof data !== "object") {
      errors.push("YAML 解析错误: not an object")
      return { is_valid: false, errors }
    }
    const d = data as Record<string, unknown>
    if (!("name" in d)) errors.push("缺少顶层字段: name")
    if (!("description" in d)) errors.push("缺少顶层字段: description")
    if (!("tables" in d)) errors.push("缺少顶层字段: tables")
    if (!("relationships" in d)) errors.push("缺少顶层字段: relationships")

    if ("tables" in d) {
      if (!Array.isArray(d["tables"])) errors.push("tables 必须是列表")
      else if ((d["tables"] as unknown[]).length === 0) errors.push("tables 列表为空")
      else {
        for (let i = 0; i < (d["tables"] as unknown[]).length; i++) {
          const table = (d["tables"] as Record<string, unknown>[])[i]
          if (!("name" in table)) errors.push(`表 ${i + 1} 缺少 name 字段`)
          if (!("base_table" in table)) errors.push(`表 ${i + 1} 缺少 base_table 字段`)
        }
      }
    }
    if ("relationships" in d && !Array.isArray(d["relationships"])) errors.push("relationships 必须是列表")
  } catch (e) {
    errors.push(`验证错误: ${String(e)}`)
  }
  return { is_valid: errors.length === 0, errors }
}
