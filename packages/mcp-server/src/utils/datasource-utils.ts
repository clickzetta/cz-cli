/**
 * datasource-utils.ts — port of cz_mcp/utils/datasource_utils.py
 * Utility functions for working with datasources via Studio API.
 */

import { logger } from "../logger.js"
import type { StudioConfig } from "../config/profile.js"
import { readApi, readUrl } from "./config.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function studioPost(url: string, body: unknown, config: StudioConfig): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
    "cz-lang": "zh_CN",
    env: "prod",
    instanceid: String(config.instanceId),
    instancename: config.instance,
    "x-clickzetta-token": config.token,
  }
  const resp = await fetch(`${url}?instanceId=${config.instanceId}`, {
    method: "POST", headers, body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`)
  return resp.json()
}

// ---------------------------------------------------------------------------
// getDatasourceByName — datasource_utils.py:18-70
// ---------------------------------------------------------------------------
export async function getDatasourceByName(
  datasourceName: string, config: StudioConfig, dsName?: string, dsType?: number | null,
  pageIndex = 1, pageSize = 20,
): Promise<Record<string, unknown> | null> {
  const url = readUrl(config.env) + readApi("DATASOURCE_LIST")
  const body: Record<string, unknown> = {
    projectId: config.projectId, pageIndex, pageSize,
    ...(dsName ? { dsName } : {}),
    ...(dsType != null ? { dsType } : {}),
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`, "Content-Type": "application/json",
    "cz-lang": "zh_CN", env: "prod",
    instanceid: String(config.instanceId), instancename: config.instance,
    "x-clickzetta-token": config.token,
    userid: String(config.userId), accountid: String(config.tenantId),
  }
  try {
    const resp = await fetch(`${url}?instanceId=${config.instanceId}`, { method: "POST", headers, body: JSON.stringify(body) })
    if (!resp.ok) return null
    const data = (await resp.json()) as Record<string, unknown>
    if (data.code !== "200") return null
    const list = ((data.data as Record<string, unknown>)?.list as Array<Record<string, unknown>>) ?? []
    return list.find((ds) => ds.dsName === datasourceName) ?? null
  } catch (e) { logger.error(`getDatasourceByName error: ${e}`); return null }
}

// ---------------------------------------------------------------------------
// executeSql — datasource_utils.py:519-575
// ---------------------------------------------------------------------------
export async function executeSql(datasourceId: number, sql: string, env: string, config: StudioConfig): Promise<boolean> {
  const url = readUrl(env) + readApi("EXECUTE_SQL_URL")
  const body: Record<string, unknown> = {
    id: datasourceId, sql,
    options: { schema: config.schema ?? "", ...(config.vcluster ? { vclusterName: config.vcluster } : {}) },
  }
  try {
    const data = (await studioPost(url, body, config)) as Record<string, unknown>
    if (data.code === "200") return true
    throw new Error(String(data.message ?? "SQL execution failed"))
  } catch (e) { logger.error(`executeSql error: ${e}`); throw e }
}

// ---------------------------------------------------------------------------
// executeQuery — datasource_utils.py:578-650
// ---------------------------------------------------------------------------
export async function executeQuery(
  datasourceId: number, sql: string, env: string, config: StudioConfig,
): Promise<[unknown | null, string | null, string | null]> {
  const url = readUrl(env) + readApi("EXECUTE_SQL_URL")
  const body: Record<string, unknown> = {
    id: datasourceId, sql,
    options: { schema: "", ...(config.vcluster ? { vclusterName: config.vcluster } : {}) },
  }
  try {
    const resp = await fetch(`${url}?instanceId=${config.instanceId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`, "Content-Type": "application/json",
        "cz-lang": "zh_CN", env: "prod",
        instanceid: String(config.instanceId), instancename: config.instance,
        "x-clickzetta-token": config.token,
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) return [null, `HTTP ${resp.status}: ${await resp.text()}`, null]
    const data = (await resp.json()) as Record<string, unknown>
    if (data.code === "200") return [data.data, null, null]
    const msg = String(data.message ?? "unknown error")
      .replace("数据源探测失败:SQLException:", "")
      .replace("COMMON_DATASOURCE_EXPLORE_EXCEPTION_WITH_REASON", "sql_execution_failed")
      .trim()
    const jobMatch = msg.match(/Job\s+([a-f0-9-]{36})/)
    return [null, msg || String(data.message), jobMatch?.[1] ?? null]
  } catch (e) { return [null, String(e), null] }
}

// ---------------------------------------------------------------------------
// checkTableExists — datasource_utils.py:73-200
// ---------------------------------------------------------------------------
export async function checkTableExists(
  datasourceId: number, schema: string, table: string, config: StudioConfig,
  datasourceType?: number, env?: string,
): Promise<boolean> {
  const dsType = datasourceType ?? 5
  const checkSql = generateCheckTableSql(dsType, schema, table)
  if (!checkSql) return false
  try {
    const [result, err] = await executeQuery(datasourceId, checkSql, env ?? config.env, config)
    if (err || result == null) return false
    return interpretExistenceResult(result, dsType)
  } catch { return false }
}

// ---------------------------------------------------------------------------
// checkSchemaExists — datasource_utils.py:202-320
// ---------------------------------------------------------------------------
export async function checkSchemaExists(
  datasourceId: number, schema: string, config: StudioConfig,
  datasourceType?: number, env?: string,
): Promise<boolean> {
  const dsType = datasourceType ?? 5
  const checkSql = generateCheckSchemaSql(dsType, schema)
  if (!checkSql) return true
  try {
    const [result, err] = await executeQuery(datasourceId, checkSql, env ?? config.env, config)
    if (err || result == null) return false
    return interpretExistenceResult(result, dsType)
  } catch { return false }
}

// ---------------------------------------------------------------------------
// createSchemaIfNotExists — datasource_utils.py:323-345
// ---------------------------------------------------------------------------
export async function createSchemaIfNotExists(
  datasourceId: number, schema: string, config: StudioConfig,
  datasourceType?: number, env?: string,
): Promise<boolean> {
  const dsType = datasourceType ?? 5
  if (await checkSchemaExists(datasourceId, schema, config, dsType, env)) return true
  const createSql = generateCreateSchemaSql(dsType, schema)
  if (!createSql) return false
  return executeSql(datasourceId, createSql, env ?? config.env, config)
}

// ---------------------------------------------------------------------------
// createSinkTableFromSource — datasource_utils.py:348-510
// ---------------------------------------------------------------------------
export async function createSinkTableFromSource(
  sourceDsId: number, sourceDsType: number, sourceSchema: string, sourceTable: string,
  sinkDsId: number, sinkDsType: number, sinkSchema: string, sinkTable: string,
  config: StudioConfig, env: string,
): Promise<boolean> {
  if (await checkTableExists(sinkDsId, sinkSchema, sinkTable, config, sinkDsType, env)) return true
  const url = readUrl(env) + readApi("DATA_SOURCES_GET_DDL")
  const body = {
    options: { dsType: sourceDsType, sinkNameSpace: sinkSchema, sinkDsType, operatorType: "source" },
    __id__: [sourceDsType, sourceDsId], id: sourceDsId,
    nameSpace: sourceSchema, dataObjectName: sourceTable, workspace: "",
  }
  try {
    const data = (await studioPost(url, body, config)) as Record<string, unknown>
    if (data.code !== "200") return false
    let ddl = String(data.data ?? "")
    if (!ddl) return false
    const match = ddl.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i)
    if (match) {
      const actual = match[1]
      const replacement = actual.includes("`") ? `\`${sinkSchema}\`.\`${sinkTable}\`` : `${sinkSchema}.${sinkTable}`
      ddl = ddl.replace(actual, replacement)
    }
    return executeSql(sinkDsId, ddl, env, config)
  } catch (e) { throw new Error(`Error creating sink table: ${e}`) }
}

// ---------------------------------------------------------------------------
// getTableMetadata — datasource_utils.py:652-720
// ---------------------------------------------------------------------------
export async function getTableMetadata(
  datasourceId: number, schema: string, table: string, env: string, config: StudioConfig,
): Promise<Record<string, unknown> | null> {
  const url = readUrl(env) + readApi("DATA_SOURCES_GET_COLUMN_MAP_META")
  const body = {
    sourceReq: { options: { dsType: 5, operatorType: "source", table, database: schema }, id: datasourceId, dataObjectName: table, nameSpace: schema },
    sinkReq: { options: { dsType: 1, operatorType: "sink", table, database: "public", is_partition: false }, id: 1, dataObjectName: table, nameSpace: "public" },
  }
  try {
    const data = (await studioPost(url, body, config)) as Record<string, unknown>
    if (data.code === "200") return (data.data as Record<string, unknown>) ?? null
    return null
  } catch { return null }
}

// ---------------------------------------------------------------------------
// integrationGenerator — datasource_utils.py:723-900
// ---------------------------------------------------------------------------
export async function integrationGenerator(
  sourceDsId: number, sourceDsName: string, sourceSchema: string, sourceTable: string,
  sinkDsId: number, sinkDsName: string, sinkSchema: string, sinkTable: string,
  sourceDsType: number, sinkDsType: number, env: string, config: StudioConfig,
): Promise<Record<string, unknown>> {
  const url = readUrl(env) + readApi("DATA_SOURCES_GET_COLUMN_MAP_META")
  const body = {
    sourceReq: { options: { dsType: sourceDsType, operatorType: "source", table: sourceTable, database: sourceSchema }, id: sourceDsId, dataObjectName: sourceTable, nameSpace: sourceSchema },
    sinkReq: { options: { dsType: sinkDsType, operatorType: "sink", table: sinkTable }, id: sinkDsId, dataObjectName: sinkTable, nameSpace: sinkSchema, __id__: [sinkDsType, sinkDsId], __partitions__: { open: false } },
  }
  try {
    const data = (await studioPost(url, body, config)) as Record<string, unknown>
    if (data.code !== "200") return { code: "500", message: data.message ?? "Failed to get metadata" }
    const meta = data.data as Record<string, unknown>
    const sourceMeta = (meta?.sourceMeta as Record<string, unknown>) ?? {}
    const sinkMeta = (meta?.sinkMeta as Record<string, unknown>) ?? {}
    const sourceColumns = (sourceMeta.columns as Array<Record<string, unknown>>) ?? []
    const sinkColumns = (sinkMeta.columns as Array<Record<string, unknown>>) ?? []
    const columnMapping: Record<string, string> = {}
    const minLen = Math.min(sourceColumns.length, sinkColumns.length)
    for (let i = 0; i < minLen; i++) columnMapping[sinkColumns[i].name as string] = sourceColumns[i].name as string

    return {
      templateKey: 1, userParams: {},
      sourceConnection: { datasourceId: sourceDsId, datasourceName: sourceDsName, type: sourceDsType },
      sinkConnection: { datasourceId: sinkDsId, datasourceName: sinkDsName, type: sinkDsType },
      jobs: [{
        source: { dataObject: sourceTable, namespace: sourceSchema, params: { dsType: sourceDsType, operatorType: "source", table: sourceTable, database: sourceSchema }, columns: sourceColumns },
        sink: { dataObject: sinkTable, namespace: sinkSchema, params: { dsType: sinkDsType, operatorType: "sink", table: sinkTable, database: sinkSchema, is_partition: false, writeMode: "OVERWRITE", outputMode: "OVERWRITE" }, columns: sinkColumns },
        setting: { parallelism: 1, errorLimit: { maxCount: -1, collectDirtyData: true, record: -1 } },
        columnMapping,
      }],
    }
  } catch (e) { return { code: "500", message: String(e) } }
}

// ---------------------------------------------------------------------------
// SQL generators — datasource_utils.py:900-1050
// ---------------------------------------------------------------------------
export function generateCheckTableSql(dsType: number, schema: string, table: string): string | null {
  if ([5, 21, 22, 23, 24].includes(dsType)) return `SHOW TABLES FROM \`${schema}\` LIKE '${table}'`
  if ([7, 18, 19, 25, 26].includes(dsType)) return `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = '${table}')`
  if (dsType === 12) return `db.getCollectionNames().indexOf('${table}') !== -1`
  if (dsType === 17) return `SELECT COUNT(*) FROM all_tables WHERE owner = UPPER('${schema}') AND table_name = UPPER('${table}')`
  if (dsType === 8) return `SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}'`
  if (dsType === 27) return `EXISTS TABLE \`${schema}\`.\`${table}\``
  if ([3, 4, 1].includes(dsType)) return `SHOW TABLES IN \`${schema}\` LIKE '${table}'`
  return null
}

export function generateCheckSchemaSql(dsType: number, schema: string): string | null {
  if ([5, 21, 22, 23, 24].includes(dsType)) return `SHOW DATABASES LIKE '${schema}'`
  if ([7, 18, 19, 25, 26].includes(dsType)) return `SELECT EXISTS (SELECT FROM information_schema.schemata WHERE schema_name = '${schema}')`
  if (dsType === 17) return `SELECT COUNT(*) FROM all_users WHERE username = UPPER('${schema}')`
  if (dsType === 8) return `SELECT COUNT(*) FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${schema}'`
  if (dsType === 27) return `EXISTS DATABASE \`${schema}\``
  if ([3, 4].includes(dsType)) return `SHOW DATABASES LIKE '${schema}'`
  if (dsType === 1) return `SHOW SCHEMAS LIKE '${schema}'`
  return null
}

export function generateCreateSchemaSql(dsType: number, schema: string): string | null {
  if ([5, 21, 22, 23, 24, 3, 4].includes(dsType)) return `CREATE DATABASE IF NOT EXISTS \`${schema}\``
  if ([7, 18, 19, 25, 26].includes(dsType)) return `CREATE SCHEMA IF NOT EXISTS "${schema}"`
  if (dsType === 8) return `IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${schema}') EXEC('CREATE SCHEMA [${schema}]')`
  if (dsType === 27) return `CREATE DATABASE IF NOT EXISTS \`${schema}\``
  if (dsType === 1) return `CREATE SCHEMA IF NOT EXISTS ${schema}`
  return null
}

// ---------------------------------------------------------------------------
// interpretExistenceResult — helper for check* functions
// ---------------------------------------------------------------------------
function interpretExistenceResult(data: unknown, dsType: number): boolean {
  let val = data
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    const rows = (val as Record<string, unknown>).rows as unknown[] | undefined
    if (rows && rows.length > 0) val = rows[0]
    else return false
  }
  while (Array.isArray(val) && val.length > 0) val = val[0]
  if (val == null) return false

  // PostgreSQL family: boolean result
  if ([7, 18, 19, 25, 26].includes(dsType)) {
    const s = String(val).toLowerCase().trim()
    return s.includes("true") || s === "t"
  }
  // Count-based
  if ([17, 8, 1, 27].includes(dsType)) {
    if (typeof val === "number") return val > 0
    const nums = String(val).match(/\d+/)
    return nums ? parseInt(nums[0]) > 0 : String(val).trim().length > 0
  }
  // String-based (MySQL, Hive, etc.)
  if (typeof val === "string") return val.trim().length > 0
  if (typeof val === "number") return val > 0
  if (typeof val === "boolean") return val
  return Boolean(val)
}
