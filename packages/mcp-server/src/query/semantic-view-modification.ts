/**
 * semantic-view-modification.ts — port of cz_mcp/query/semantic_view_modification.py
 */

import { logger } from "../logger.js"
import { convertDfToDict, ResponseBuilder } from "../common/utilities.js"
import type { McpContent } from "../common/utilities.js"
import type { LakehouseDB } from "../server.js"
import type { StudioConfig } from "../config/profile.js"
import { addDimensions, removeDimensions, descSemanticView, createSemanticView } from "./semantic-view-operations.js"
import {
  type CzSvDataModel,
  type CzSvLogicalTable,
  CzSvTableType,
  CzSemanticViewUtils,
  svSemanticViewCreationSql,
} from "./semantic-view-models.js"

export async function addDimensionsToSemanticView(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const db = opts?.db
  const semanticViewName = arguments_["semantic_view_name"] as string | undefined
  const dimensionsToAdd = arguments_["dimensions"] as Record<string, unknown>[] | undefined

  if (!semanticViewName) throw new Error("Missing semantic_view_name")
  if (!dimensionsToAdd || !dimensionsToAdd.length) throw new Error("Missing dimensions to add")
  if (!db) throw new Error("Missing db")

  logger.info(`Adding ${dimensionsToAdd.length} dimensions to ${semanticViewName}`)

  // 1. Get new CREATE SQL body via addDimensions
  const sqlBody = await addDimensions(
    { semantic_view_name: semanticViewName, schema_name: schemaName, new_dimensions: dimensionsToAdd },
    db, studioConfig,
  )
  const createSql = `USE ${schemaName};\n CREATE SEMANTIC VIEW ${semanticViewName} \n${sqlBody}\n;`

  // 2. Drop old view
  const dropSql = `DROP SEMANTIC VIEW IF EXISTS ${schemaName}.${semanticViewName};`
  await db.executeQuery(dropSql)
  logger.info(`Dropped old semantic view: ${semanticViewName}`)

  // 3. Create new view
  const [data, dataId] = await db.executeQuery(createSql)
  logger.info(`Semantic view '${semanticViewName}' created successfully`)

  const resultDict = data ? convertDfToDict(data) : []
  const responseData = {
    message: `✅ 新的语义视图 '${semanticViewName}' 创建成功`,
    semantic_view_name: semanticViewName,
    sql_query_executed: [createSql],
    result: resultDict,
  }
  return ResponseBuilder.createYamlJsonResponse([responseData], dataId, studioConfig)
}

export async function removeDimensionsFromSemanticView(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const db = opts?.db
  const semanticViewName = arguments_["semantic_view_name"] as string | undefined
  const dimensionsToRemove = arguments_["dimensions_to_remove"] as Record<string, unknown>[] | undefined

  if (!semanticViewName) throw new Error("Missing semantic_view_name")
  if (!dimensionsToRemove || !dimensionsToRemove.length) throw new Error("Missing dimensions_to_remove")
  if (!db) throw new Error("Missing db")

  logger.info(`Removing ${dimensionsToRemove.length} dimensions from ${semanticViewName}`)

  // 1. Get new CREATE SQL body via removeDimensions
  const sqlBody = await removeDimensions(
    { semantic_view_name: semanticViewName, schema_name: schemaName, remove_dimensions: dimensionsToRemove },
    db, studioConfig,
  )
  const createSql = `USE ${schemaName};\n CREATE SEMANTIC VIEW ${semanticViewName} \n${sqlBody}\n;`

  // 2. Drop old view
  const dropSql = `DROP SEMANTIC VIEW IF EXISTS ${schemaName}.${semanticViewName};`
  await db.executeQuery(dropSql)
  logger.info(`Dropped old semantic view: ${semanticViewName}`)

  // 3. Create new view
  const [data, dataId] = await db.executeQuery(createSql)
  logger.info(`Semantic view '${semanticViewName}' created successfully`)

  const resultDict = data ? convertDfToDict(data) : []
  const responseData = {
    message: `✅ 新的语义视图 '${semanticViewName}' 创建成功`,
    semantic_view_name: semanticViewName,
    sql_query_executed: [createSql],
    result: resultDict,
  }
  return ResponseBuilder.createYamlJsonResponse([responseData], dataId, studioConfig)
}

export async function addTablesToSemanticView(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const db = opts?.db
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const semanticViewName = arguments_["semantic_view_name"] as string | undefined
  const tablesToAdd = arguments_["tables"] as Record<string, unknown>[] | undefined

  if (!semanticViewName) throw new Error("Missing semantic_view_name")
  if (!tablesToAdd || !tablesToAdd.length) throw new Error("Missing tables to add")
  if (!db) throw new Error("Missing db")

  logger.info(`Adding ${tablesToAdd.length} tables to ${semanticViewName}`)

  // 1. Get current definition (raw JSON from DESC)
  const fullViewName = schemaName ? `${schemaName}.${semanticViewName}` : semanticViewName
  const query = `set cz.sql.desc.format=json; DESC extended ${fullViewName};`
  const [data] = await db.executeQuery(query)
  const resultDict = data ?? []

  let comment = ""
  let czSvJson: CzSvDataModel | null = null
  for (const r of resultDict) {
    if (r["column_name"] === "comment" && r["data_type"]) comment = r["data_type"] as string
    if (r["column_name"] === "def" && r["data_type"]) {
      czSvJson = JSON.parse(r["data_type"] as string) as CzSvDataModel
    }
  }
  if (!czSvJson) throw new Error("Could not retrieve semantic view definition")

  // 2. Add new tables
  const existingAliases = new Set(czSvJson.logicalTables.map((t) => t.alias))
  let addedCount = 0

  for (const newTable of tablesToAdd) {
    const logicalName = newTable["logical_name"] as string
    if (existingAliases.has(logicalName)) {
      logger.warn(`Table ${logicalName} already exists, skipping`)
      continue
    }

    const newLogicalTable: CzSvLogicalTable = {
      tableIdentifier: {
        type: CzSvTableType.TABLE,
        instanceId: "86",
        namespace: [
          (newTable["database"] as string) ?? "",
          (newTable["schema"] as string) ?? "public",
        ],
        namespaceId: [],
        namespaceType: [],
        name: (newTable["table_name"] as string) ?? "",
        id: "0",
        version: "",
      },
      alias: logicalName,
      constraints: [],
      synonyms: [],
      comment: (newTable["comment"] as string) ?? "",
    }

    // Add foreign keys if provided
    const foreignKeys = newTable["foreign_keys"] as Record<string, unknown>[] | undefined
    if (foreignKeys) {
      for (const fk of foreignKeys) {
        newLogicalTable.constraints.push({
          specId: 0,
          properties: [],
          name: "",
          foreignKey: {
            fields: [{ fieldName: (fk["field"] as string) ?? (fk["left_column"] as string) ?? "" }],
            refTable: {
              type: CzSvTableType.TABLE,
              instanceId: "86",
              namespace: [],
              namespaceId: [],
              namespaceType: [],
              name: (fk["references"] as string) ?? (fk["right_table"] as string) ?? "",
              id: "0",
              version: "",
            },
            refFields: [{ fieldName: (fk["ref_field"] as string) ?? (fk["right_column"] as string) ?? "" }],
            enable: true,
            rely: true,
          },
        })
      }
    }

    czSvJson.logicalTables.push(newLogicalTable)
    addedCount++
    logger.info(`Added table ${logicalName}`)
  }

  // 3. Rebuild view
  const svObj = CzSemanticViewUtils.getSemanticView(czSvJson)
  svObj.comments = comment
  const sqlBody = svSemanticViewCreationSql(svObj)
  const createSql = `USE ${schemaName};\nCREATE SEMANTIC VIEW ${semanticViewName}\n${sqlBody}`

  const dropSql = `DROP SEMANTIC VIEW IF EXISTS ${fullViewName};`
  await db.executeQuery(dropSql)
  logger.info(`Dropped old semantic view: ${semanticViewName}`)

  const [createData, dataId] = await db.executeQuery(createSql)
  logger.info(`Semantic view '${semanticViewName}' recreated successfully`)

  const responseData = {
    status: "success",
    semantic_view_name: semanticViewName,
    tables_added: addedCount,
  }
  return ResponseBuilder.createYamlJsonResponse([responseData], dataId, studioConfig)
}

export async function removeTablesFromSemanticView(
  arguments_: Record<string, unknown>,
  studioConfig?: StudioConfig | null,
  opts?: { db?: LakehouseDB },
): Promise<McpContent[]> {
  const db = opts?.db
  const schemaName = (arguments_["schema_name"] as string | undefined) ?? studioConfig?.schema ?? ""
  const semanticViewName = arguments_["semantic_view_name"] as string | undefined
  const tablesToRemove = arguments_["tables_to_remove"] as string[] | undefined

  if (!semanticViewName) throw new Error("Missing semantic_view_name")
  if (!tablesToRemove || !tablesToRemove.length) throw new Error("Missing tables_to_remove")
  if (!db) throw new Error("Missing db")

  logger.info(`Removing ${tablesToRemove.length} tables from ${semanticViewName}`)

  // 1. Get current definition
  const fullViewName = schemaName ? `${schemaName}.${semanticViewName}` : semanticViewName
  const query = `set cz.sql.desc.format=json; DESC extended ${fullViewName};`
  const [data] = await db.executeQuery(query)
  const resultDict = data ?? []

  let comment = ""
  let czSvJson: CzSvDataModel | null = null
  for (const r of resultDict) {
    if (r["column_name"] === "comment" && r["data_type"]) comment = r["data_type"] as string
    if (r["column_name"] === "def" && r["data_type"]) {
      czSvJson = JSON.parse(r["data_type"] as string) as CzSvDataModel
    }
  }
  if (!czSvJson) throw new Error("Could not retrieve semantic view definition")

  const removeSet = new Set(tablesToRemove)

  // 2. Check FK dependencies - remaining tables must not reference removed tables
  const remainingTables = czSvJson.logicalTables.filter((t) => !removeSet.has(t.alias))
  for (const table of remainingTables) {
    for (const constraint of table.constraints) {
      if (constraint.foreignKey && removeSet.has(constraint.foreignKey.refTable.name)) {
        throw new Error(
          `Cannot remove table ${constraint.foreignKey.refTable.name} because ` +
          `table ${table.alias} has a foreign key reference to it`
        )
      }
    }
  }

  // 3. Remove tables and related dimensions/metrics/filters
  const originalCount = czSvJson.logicalTables.length
  czSvJson.logicalTables = remainingTables
  const removedCount = originalCount - remainingTables.length

  if (removedCount === 0) {
    throw new Error(`No tables removed. Check table names: ${tablesToRemove.join(", ")}`)
  }

  // Remove dimensions/metrics/filters belonging to removed tables
  czSvJson.dimensions = czSvJson.dimensions.filter((d) => !removeSet.has(d.name.namespace[0]))
  czSvJson.metrics = czSvJson.metrics.filter((m) => !removeSet.has(m.name.namespace[0]))
  czSvJson.filters = czSvJson.filters.filter((f) => !removeSet.has(f.name.namespace[0]))

  // 4. Rebuild view
  const svObj = CzSemanticViewUtils.getSemanticView(czSvJson)
  svObj.comments = comment
  const sqlBody = svSemanticViewCreationSql(svObj)
  const createSql = `USE ${schemaName};\nCREATE SEMANTIC VIEW ${semanticViewName}\n${sqlBody}`

  const dropSql = `DROP SEMANTIC VIEW IF EXISTS ${fullViewName};`
  await db.executeQuery(dropSql)
  logger.info(`Dropped old semantic view: ${semanticViewName}`)

  const [createData, dataId] = await db.executeQuery(createSql)
  logger.info(`Semantic view '${semanticViewName}' recreated successfully`)

  const responseData = {
    status: "success",
    semantic_view_name: semanticViewName,
    tables_removed: removedCount,
    removed_table_names: tablesToRemove,
  }
  return ResponseBuilder.createYamlJsonResponse([responseData], dataId, studioConfig)
}
