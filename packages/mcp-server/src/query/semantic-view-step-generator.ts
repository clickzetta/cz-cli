/**
 * semantic-view-step-generator.ts — port of cz_mcp/query/semantic_view_step_generator.py
 *
 * Coordinates step-by-step generation of semantic view YAML.
 */

import { logger } from "../logger.js"
import {
  createYAMLBuilder,
  setModelInfo,
  addTable,
  setRelationships,
  buildYaml,
  buildSemanticViewYaml,
  extractTablesInfoForRelationships,
  validateYamlStructure,
} from "./semantic-view-yaml-builder.js"

export type LlmGenerateFunc = (promptName: string, kwargs: Record<string, string>) => Promise<string>

export interface StepByStepResult {
  success: boolean
  yaml: string | null
  steps: {
    model_info: Record<string, unknown> | null
    tables: Array<{ physical_name: string; yaml: string }>
    relationships: string | null
  }
  errors: string[]
}

export async function generateSemanticViewYamlStepByStep(
  requirement: string,
  tablesMetadata: Record<string, unknown>[],
  llmGenerateFunc: LlmGenerateFunc,
  modelName?: string,
): Promise<StepByStepResult> {
  const builder = createYAMLBuilder()
  const stepsResult: StepByStepResult["steps"] = { model_info: null, tables: [], relationships: null }
  const errors: string[] = []

  try {
    // Step 1: Generate model info
    logger.info("步骤 1/4: 生成模型基本信息...")
    const tableNamesStr = JSON.stringify(tablesMetadata.map((t) => t["table_name"]))
    const modelInfoJson = await llmGenerateFunc("generate_semantic_model_info", {
      requirement,
      table_names: tableNamesStr,
    })
    const modelInfo = JSON.parse(modelInfoJson) as { name: string; description: string }
    if (modelName) modelInfo.name = modelName
    setModelInfo(builder, modelInfo.name, modelInfo.description)
    stepsResult.model_info = modelInfo
    logger.info(`  ✓ 模型名称: ${modelInfo.name}`)

    // Step 2: Generate logical table definitions
    logger.info(`步骤 2/4: 生成 ${tablesMetadata.length} 个逻辑表定义...`)
    for (let i = 0; i < tablesMetadata.length; i++) {
      const tableMeta = tablesMetadata[i]
      logger.info(`  生成表 ${i + 1}/${tablesMetadata.length}: ${tableMeta["table_name"]}...`)
      const tableMetaJson = JSON.stringify(tableMeta)
      let tableYaml = await llmGenerateFunc("generate_single_logical_table", {
        table_metadata_json: tableMetaJson,
      })
      tableYaml = cleanYamlOutput(tableYaml)
      addTable(builder, tableYaml)
      stepsResult.tables.push({ physical_name: tableMeta["table_name"] as string, yaml: tableYaml })
      logger.info(`  ✓ 表 ${tableMeta["table_name"]} 生成完成`)
    }

    // Step 3: Generate relationships
    logger.info("步骤 3/4: 生成表关系...")
    const hasForeignKeys = tablesMetadata.some(
      (t) => Array.isArray(t["foreign_keys"]) && (t["foreign_keys"] as unknown[]).length > 0,
    )

    if (hasForeignKeys) {
      const tablesInfoJson = extractTablesInfoForRelationships(tablesMetadata)
      let relationshipsYaml = await llmGenerateFunc("generate_relationships", {
        tables_info_json: tablesInfoJson,
      })
      relationshipsYaml = cleanYamlOutput(relationshipsYaml)
      setRelationships(builder, relationshipsYaml)
      stepsResult.relationships = relationshipsYaml
      logger.info("  ✓ 关系定义生成完成")
    } else {
      logger.info("  ℹ 没有外键，跳过关系生成")
      setRelationships(builder, "")
      stepsResult.relationships = ""
    }

    // Step 4: Assemble YAML
    logger.info("步骤 4/4: 组装完整 YAML...")
    const finalYaml = buildYaml(builder)

    const validationResult = validateYamlStructure(JSON.parse(finalYaml))
    if (!validationResult.is_valid) {
      errors.push(...validationResult.errors)
      logger.warn(`  ⚠ YAML 验证发现问题: ${validationResult.errors.join(", ")}`)
    } else {
      logger.info("  ✓ YAML 结构验证通过")
    }

    logger.info("✅ YAML 生成完成！")
    return { success: true, yaml: finalYaml, steps: stepsResult, errors }
  } catch (e) {
    logger.error(`❌ 生成失败: ${String(e)}`)
    errors.push(`生成失败: ${String(e)}`)
    return { success: false, yaml: null, steps: stepsResult, errors }
  }
}

export function cleanYamlOutput(yamlStr: string): string {
  let s = yamlStr.trim()
  if (s.startsWith("```yaml")) s = s.slice(7)
  else if (s.startsWith("```")) s = s.slice(3)
  if (s.endsWith("```")) s = s.slice(0, -3)
  return s.trim()
}

export function buildYamlFromGeneratedParts(
  modelInfoJson: string,
  tablesYamlList: string[],
  relationshipsYaml: string,
): string {
  return buildSemanticViewYaml(modelInfoJson, tablesYamlList, relationshipsYaml)
}
