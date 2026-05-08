/**
 * table-metadata.ts — port of cz_mcp/query/table_metadata.py
 * Table metadata query handlers for ClickZetta.
 */

import { logger } from "../logger.js"
import { convertDfToDict, ResponseBuilder } from "../common/utilities.js"
import { SQLIntelligence } from "./sql-intelligence.js"
import type { LakehouseDB } from "../server.js"
import type { StudioConfig } from "../config/profile.js"
import type { McpContent } from "../common/utilities.js"

// ─── get_all_tables_metadata ─────────────────────────────────────────────────

export async function getAllTablesMetadata(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const db = opts?.db
  let schemaName = (studioConfig?.schema ?? "") as string
  schemaName = (arguments_.schema_name as string) ?? schemaName
  const includeColumns = (arguments_.include_columns as boolean) ?? true
  const verbose = (arguments_.verbose as boolean) ?? false

  if (!schemaName) throw new Error("❌ schema_name 参数不能为空。请提供要查询的 schema 名称。")

  logger.info(`Get all tables metadata for schema: ${schemaName}, include_columns=${includeColumns}`)

  const executedSqls: string[] = []
  const showTablesSql = `SHOW TABLES IN ${schemaName}`
  executedSqls.push(showTablesSql)

  let tables: Record<string, unknown>[]
  let dataId: string | undefined

  try {
    const [tablesDf, id] = await db!.executeQuery(showTablesSql + ";")
    dataId = id
    tables = tablesDf ? convertDfToDict(tablesDf) : []
    logger.info(`Found ${tables.length} tables in schema ${schemaName}`)
  } catch (e: unknown) {
    const errorMsg = String(e)
    const analysis = SQLIntelligence.analyzeSqlError(errorMsg, showTablesSql)
    throw new Error(
      `❌ ${analysis.friendly_message || `获取 ${schemaName} 下的表列表失败`}\n\n` +
      `📝 SQL executed: ${showTablesSql}\n🔍 Original Error: ${errorMsg}\n\n` +
      `💡 Suggestions: ${analysis.suggestions.slice(0, 2).join("; ")}`,
    )
  }

  if (!tables.length) {
    const responseData: Record<string, unknown> = {
      success: false, schema_name: schemaName, tables: [], table_count: 0,
      message: `Schema '${schemaName}' 中没有找到任何表`,
    }
    if (verbose) responseData.sql_query_executed = executedSqls
    return ResponseBuilder.createYamlJsonResponse([responseData], dataId, studioConfig)
  }

  const tablesMetadata: Record<string, unknown>[] = []

  for (const table of tables) {
    const tableName = (table.table_name ?? table.name ?? "") as string
    if (!tableName) continue

    const tableMeta: Record<string, unknown> = {
      workspace: (table.workspace ?? table.catalog ?? "") as string,
      table_type: (table.table_type ?? "TABLE") as string,
      schema_name: (table.schema_name ?? table.schema ?? schemaName) as string,
      table_name: tableName,
      is_view: table.is_view ?? false,
      is_materialized_view: table.is_materialized_view ?? false,
      is_external: table.is_external ?? false,
      is_dynamic: table.is_dynamic ?? false,
    }

    if (includeColumns) {
      const workspace = tableMeta.workspace as string
      const schema = tableMeta.schema_name as string
      const fullTableName = workspace ? `${workspace}.${schema}.${tableName}` : `${schema}.${tableName}`
      const descSql = `DESC TABLE EXTENDED ${fullTableName}`
      executedSqls.push(descSql)

      try {
        const [colsDf] = await db!.executeQuery(descSql + ";")
        const cols = colsDf ? convertDfToDict(colsDf) : []
        const columnsInfo: Record<string, unknown>[] = []
        const primaryKeys: string[] = []
        const foreignKeys: Record<string, unknown>[] = []

        for (const col of cols) {
          const colNameField = (col.col_name ?? col.column_name ?? col.name ?? "") as string

          if (colNameField.toLowerCase() === "primary_key") {
            const pkValue = (col.data_type ?? col.type ?? col.col_type ?? "") as string
            if (pkValue) {
              try {
                const parsed = JSON.parse(pkValue)
                if (Array.isArray(parsed)) primaryKeys.push(...parsed)
                else if (typeof parsed === "string") primaryKeys.push(...parsed.split(",").map(s => s.trim()).filter(Boolean))
              } catch {
                primaryKeys.push(...pkValue.replace(/[[\]]/g, "").split(",").map(s => s.trim()).filter(Boolean))
              }
            }
            continue
          }

          if (colNameField.toLowerCase() === "foreign_key" || colNameField.toLowerCase() === "foreign_keys") {
            const fkValue = (col.data_type ?? col.type ?? col.col_type ?? "") as string
            if (fkValue && !["", "null", "NULL", "None"].includes(fkValue)) {
              try {
                const parsed = JSON.parse(fkValue)
                if (Array.isArray(parsed)) foreignKeys.push(...parsed)
                else if (typeof parsed === "object") foreignKeys.push(parsed as Record<string, unknown>)
                else if (typeof parsed === "string" && parsed.trim()) foreignKeys.push({ raw: parsed })
              } catch {
                if (fkValue.trim()) foreignKeys.push({ raw: fkValue })
              }
            }
            continue
          }

          if (colNameField) {
            const colInfo: Record<string, unknown> = {
              name: colNameField,
              type: (col.type ?? col.data_type ?? col.col_type ?? "") as string,
              nullable: col.nullable ?? true,
              comment: (col.comment ?? col.col_comment ?? "") as string,
            }
            if (col.default_value) colInfo.default_value = col.default_value
            if ("primary_key" in col) colInfo.is_primary_key = col.primary_key
            columnsInfo.push(colInfo)
          }
        }

        tableMeta.columns = columnsInfo
        tableMeta.column_count = columnsInfo.length
        if (primaryKeys.length) {
          tableMeta.primary_key = primaryKeys
          tableMeta.primary_key_columns = primaryKeys
        }
        if (foreignKeys.length) {
          tableMeta.foreign_keys = foreignKeys
          const fkHints: Record<string, unknown>[] = []
          for (const fk of foreignKeys) {
            if (!("raw" in fk)) {
              const cols2 = fk.columns as string[] | undefined
              const refCols = fk.ref_columns as string[] | undefined
              const hint: Record<string, unknown> = {
                column: fk.column ?? (Array.isArray(cols2) ? cols2[0] : null),
                references_table: fk.references_table ?? fk.ref_table,
                references_column: fk.references_column ?? (Array.isArray(refCols) ? refCols[0] : null),
              }
              if (hint.column && hint.references_table) fkHints.push(hint)
            }
          }
          if (fkHints.length) tableMeta.foreign_key_hints = fkHints
        }
      } catch (e: unknown) {
        logger.warn(`DESC TABLE EXTENDED failed for ${fullTableName}: ${e}`)
        tableMeta.columns = []
        tableMeta.column_count = 0
        tableMeta.metadata_error = String(e)
      }
    }

    tablesMetadata.push(tableMeta)
  }

  const responseData: Record<string, unknown> = {
    schema_name: schemaName, tables: tablesMetadata, table_count: tablesMetadata.length,
  }
  if (verbose) {
    responseData.sql_query_executed = executedSqls
    responseData.parameter_details = { include_columns: includeColumns, verbose_mode: true }
  }
  return ResponseBuilder.createYamlJsonResponse([responseData], dataId, studioConfig)
}

// ─── get_view_dimensions ─────────────────────────────────────────────────────

export async function getViewDimensions(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const db = opts?.db
  let schemaName = (studioConfig?.schema ?? "") as string
  schemaName = (arguments_.schema_name as string) ?? schemaName
  const semanticView = (arguments_.semantic_view as string) ?? ""

  const fullViewName = `${schemaName}.${semanticView}`
  const query = `set cz.sql.desc.format=json; DESC extended ${fullViewName};`
  const [dataFrame, dataId] = await db!.executeQuery(query)

  let defData: string | null = null
  if (Array.isArray(dataFrame)) {
    for (const item of dataFrame) {
      if ((item as Record<string, unknown>).column_name === "def" && (item as Record<string, unknown>).data_type) {
        defData = (item as Record<string, unknown>).data_type as string
        break
      }
    }
  }

  const dimensionsInfo: Record<string, unknown>[] = []
  if (defData) {
    const svData = JSON.parse(defData)
    const dimensions = (svData.dimensions ?? []) as Record<string, unknown>[]
    for (const dim of dimensions) {
      const name = dim.name as Record<string, unknown>
      dimensionsInfo.push({
        dimensions_name: (name.name as string),
        logical_table: name.namespace,
        expression: dim.expressionExpandedText,
        comment: dim.comment,
        synonyms: dim.synonyms,
      })
    }
  }

  return ResponseBuilder.createYamlJsonResponse([{ schema_name: schemaName, dimensions_info: dimensionsInfo }], dataId, studioConfig)
}

// ─── get_tables_column_names ─────────────────────────────────────────────────

export async function getTablesColumnNames(
  arguments_: Record<string, unknown>,
  db: LakehouseDB,
  studioConfig?: StudioConfig | null,
): Promise<McpContent[]> {
  const schemaName = ((arguments_.schema_name as string) ?? "").trim()
  if (!schemaName) throw new Error("❌ schema_name 参数不能为空")

  const showTablesSql = `SHOW TABLES IN ${schemaName}`
  const [tablesDf, dataId] = await db.executeQuery(showTablesSql + ";")
  const tables = tablesDf ? convertDfToDict(tablesDf) : []

  if (!tables.length) {
    return ResponseBuilder.createYamlJsonResponse([{
      schema_name: schemaName, logical_tables: [], message: `Schema '${schemaName}' 无表/视图`,
    }], dataId, studioConfig)
  }

  const originalTables: { table_name: string; column_names: string[]; column_count: number }[] = []
  for (const table of tables) {
    const tableName = (table.table_name ?? table.name ?? "") as string
    if (!tableName) continue
    const schema = (table.schema_name ?? schemaName) as string
    const workspace = (table.workspace ?? "") as string
    const fullTableName = workspace ? `${workspace}.${schema}.${tableName}` : `${schema}.${tableName}`
    const descSql = `DESC TABLE ${fullTableName}`
    const columnNames: string[] = []
    try {
      const [colsDf] = await db.executeQuery(descSql + ";")
      const cols = colsDf ? convertDfToDict(colsDf) : []
      for (const col of cols) {
        const colName = (col.col_name ?? col.column_name ?? "") as string
        if (colName && !["primary_key", "foreign_key"].includes(colName.toLowerCase())) {
          columnNames.push(colName)
        }
      }
    } catch (e: unknown) {
      logger.warn(`查询${fullTableName}列名失败: ${e}`)
    }
    originalTables.push({ table_name: tableName, column_names: columnNames, column_count: columnNames.length })
  }

  let logicalPhysicalMap: Record<string, string> = {}
  for (const table of originalTables) {
    if (table.column_names.length !== 0) continue
    const fullTableName = `${schemaName}.${table.table_name}`
    const descExtendedSql = `DESC EXTENDED ${fullTableName}`
    try {
      const [data] = await db.executeQuery(descExtendedSql + ";")
      const resultDict = data ? convertDfToDict(data) : []
      logicalPhysicalMap = parseLogicalPhysicalMapping(resultDict)
    } catch (e: unknown) {
      logger.warn(`解析视图${fullTableName}失败: ${e}`)
    }
  }

  const finalLogicalTables: Record<string, unknown>[] = []
  for (const table of originalTables) {
    if (table.column_names.length === 0) continue
    const logicalTableName = logicalPhysicalMap[table.table_name] ?? table.table_name
    finalLogicalTables.push({
      logical_table_name: logicalTableName,
      column_names: table.column_names,
      column_count: table.column_count,
    })
  }

  return ResponseBuilder.createYamlJsonResponse([{
    schema_name: schemaName, logical_tables: finalLogicalTables, table_count: finalLogicalTables.length,
    message: `成功获取${finalLogicalTables.length}个逻辑表的列信息`,
  }], dataId, studioConfig)
}

// ─── parse_logical_physical_mapping ──────────────────────────────────────────

export function parseLogicalPhysicalMapping(resultDict: Record<string, unknown>[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  let inLogicalTablesSection = false

  for (const row of resultDict) {
    const columnName = ((row.column_name ?? "") as string).trim()
    const dataType = ((row.data_type ?? "") as string).trim()

    if (columnName === "#logical tables") { inLogicalTablesSection = true; continue }
    if (inLogicalTablesSection && columnName.startsWith("#")) break
    if (inLogicalTablesSection && columnName && dataType.includes(".")) {
      const physicalTableName = dataType.split(".").pop()!
      mapping[physicalTableName] = columnName
    }
  }
  return mapping
}

// ─── get_tables_metadata (with PK/FK filter) ─────────────────────────────────

export async function getTablesMetadata(
  arguments_: Record<string, unknown>,
  db: LakehouseDB,
  studioConfig?: StudioConfig | null,
): Promise<McpContent[]> {
  const schemaName = ((arguments_.schema_name as string) ?? "").trim()
  const includeColumns = (arguments_.include_columns as boolean) ?? true
  const verbose = (arguments_.verbose as boolean) ?? false

  if (!schemaName) throw new Error("❌ schema_name 参数不能为空。请提供要查询的 schema 名称。")

  const executedSqls: string[] = []
  const showTablesSql = `SHOW TABLES IN ${schemaName}`
  executedSqls.push(showTablesSql)

  let tables: Record<string, unknown>[]
  let dataId: string | undefined

  try {
    const [tablesDf, id] = await db.executeQuery(showTablesSql + ";")
    dataId = id
    tables = tablesDf ? convertDfToDict(tablesDf) : []
  } catch (e: unknown) {
    const errorMsg = String(e)
    const analysis = SQLIntelligence.analyzeSqlError(errorMsg, showTablesSql)
    throw new Error(
      `❌ ${analysis.friendly_message || `获取 ${schemaName} 下的表列表失败`}\n\n` +
      `📝 SQL executed: ${showTablesSql}\n🔍 Original Error: ${errorMsg}\n\n` +
      `💡 Suggestions: ${analysis.suggestions.slice(0, 2).join("; ")}`,
    )
  }

  if (!tables.length) {
    const responseData: Record<string, unknown> = {
      schema_name: schemaName, tables: [], table_count: 0, filtered_tables_count: 0,
      message: `Schema '${schemaName}' 中没有找到任何表`,
    }
    if (verbose) responseData.sql_query_executed = executedSqls
    return ResponseBuilder.createYamlJsonResponse([responseData], dataId, studioConfig)
  }

  const tablesMetadata: Record<string, unknown>[] = []
  let filteredTableCount = 0

  for (const table of tables) {
    const tableName = (table.table_name ?? table.name ?? "") as string
    if (!tableName) { filteredTableCount++; continue }

    const tableMeta: Record<string, unknown> = {
      workspace: (table.workspace ?? table.catalog ?? "") as string,
      table_type: (table.table_type ?? "TABLE") as string,
      schema_name: (table.schema_name ?? table.schema ?? schemaName) as string,
      table_name: tableName,
      is_view: table.is_view ?? false,
      is_materialized_view: table.is_materialized_view ?? false,
      is_external: table.is_external ?? false,
      is_dynamic: table.is_dynamic ?? false,
    }

    let hasPrimaryKey = false
    let hasForeignKey = false
    const columnsInfo: Record<string, unknown>[] = []
    const primaryKeys: string[] = []
    const foreignKeys: Record<string, unknown>[] = []

    if (includeColumns) {
      const workspace = tableMeta.workspace as string
      const schema = tableMeta.schema_name as string
      const fullTableName = workspace ? `${workspace}.${schema}.${tableName}` : `${schema}.${tableName}`
      const descSql = `DESC TABLE EXTENDED ${fullTableName}`
      executedSqls.push(descSql)

      try {
        const [colsDf] = await db.executeQuery(descSql + ";")
        const cols = colsDf ? convertDfToDict(colsDf) : []

        for (const col of cols) {
          const colNameField = (col.col_name ?? col.column_name ?? col.name ?? "") as string

          if (colNameField.toLowerCase() === "primary_key") {
            const pkValue = (col.data_type ?? col.type ?? col.col_type ?? "") as string
            if (pkValue) {
              try {
                const parsed = JSON.parse(pkValue)
                if (Array.isArray(parsed)) primaryKeys.push(...parsed)
                else if (typeof parsed === "string") primaryKeys.push(...parsed.split(",").map(s => s.trim()).filter(Boolean))
              } catch {
                primaryKeys.push(...pkValue.replace(/[[\]]/g, "").split(",").map(s => s.trim()).filter(Boolean))
              }
            }
            hasPrimaryKey = primaryKeys.length > 0
            continue
          }

          if (["foreign_key", "foreign_keys"].includes(colNameField.toLowerCase())) {
            const fkValue = (col.data_type ?? col.type ?? col.col_type ?? "") as string
            if (fkValue && !["", "null", "NULL", "None"].includes(fkValue)) {
              try {
                const parsed = JSON.parse(fkValue)
                if (Array.isArray(parsed)) foreignKeys.push(...parsed)
                else if (typeof parsed === "object") foreignKeys.push(parsed as Record<string, unknown>)
                else if (typeof parsed === "string" && parsed.trim()) foreignKeys.push({ raw: parsed })
              } catch {
                if (fkValue.trim()) foreignKeys.push({ raw: fkValue })
              }
            }
            hasForeignKey = foreignKeys.length > 0
            continue
          }

          if (colNameField) {
            const colInfo: Record<string, unknown> = {
              name: colNameField,
              type: (col.type ?? col.data_type ?? col.col_type ?? "") as string,
              nullable: col.nullable ?? true,
              comment: (col.comment ?? col.col_comment ?? "") as string,
            }
            if ("primary_key" in col) { colInfo.is_primary_key = col.primary_key; hasPrimaryKey = true }
            if (col.default_value) colInfo.default_value = col.default_value
            columnsInfo.push(colInfo)
          }
        }
      } catch (e: unknown) {
        logger.warn(`DESC TABLE EXTENDED failed for ${fullTableName}: ${e}`)
        tableMeta.metadata_error = String(e)
      }
    } else {
      hasPrimaryKey = Boolean(table.primary_key)
      hasForeignKey = Boolean(table.foreign_keys)
    }

    if (hasPrimaryKey || hasForeignKey) {
      tableMeta.columns = columnsInfo
      tableMeta.column_count = columnsInfo.length
      if (primaryKeys.length) { tableMeta.primary_key = primaryKeys; tableMeta.primary_key_columns = primaryKeys }
      if (foreignKeys.length) {
        tableMeta.foreign_keys = foreignKeys
        const fkHints: Record<string, unknown>[] = []
        for (const fk of foreignKeys) {
          if (!("raw" in fk)) {
            const cols2 = fk.columns as string[] | undefined
            const refCols = fk.ref_columns as string[] | undefined
            const hint: Record<string, unknown> = {
              column: fk.column ?? (Array.isArray(cols2) ? cols2[0] : null),
              references_table: fk.references_table ?? fk.ref_table,
              references_column: fk.references_column ?? (Array.isArray(refCols) ? refCols[0] : null),
            }
            if (hint.column && hint.references_table) fkHints.push(hint)
          }
        }
        if (fkHints.length) tableMeta.foreign_key_hints = fkHints
      }
      tablesMetadata.push(tableMeta)
    } else {
      filteredTableCount++
    }
  }

  const responseData: Record<string, unknown> = {
    schema_name: schemaName, tables: tablesMetadata, table_count: tablesMetadata.length,
    filtered_tables_count: filteredTableCount, total_tables_scanned: tables.length,
  }
  if (tablesMetadata.length === 0) {
    responseData.message = `Schema '${schemaName}' 中没有找到包含主键或外键的表`
  } else {
    responseData.message = `Schema '${schemaName}' 中筛选出 ${tablesMetadata.length} 个包含主键/外键的表（共扫描 ${tables.length} 个表，过滤 ${filteredTableCount} 个无PK/FK的表）`
  }
  if (verbose) {
    responseData.sql_query_executed = executedSqls
    responseData.parameter_details = { include_columns: includeColumns, verbose_mode: true, filter_rule: "仅保留包含主键（PK）或外键（FK）的表" }
  }
  return ResponseBuilder.createYamlJsonResponse([responseData], dataId, studioConfig)
}
