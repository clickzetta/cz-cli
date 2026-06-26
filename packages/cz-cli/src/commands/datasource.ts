import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import { studioRequest, listPgSlots, type StudioConfig } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error, isHandledCliError } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getStudioContext } from "./studio-context.js"

// ---------------------------------------------------------------------------
// Type mapping: user-friendly string → numeric code
// ---------------------------------------------------------------------------
const DS_TYPE_MAP: Record<string, number> = {
  lakehouse: 1, kafka: 2, hive: 3, clickhouse: 4, mysql: 5,
  postgresql: 7, sqlserver: 8, oss: 9, hbase: 10, odps: 11,
  mongodb: 12, elasticsearch: 13, doris: 14, starrocks: 15,
  selectdb: 16, tidb: 17, mariadb: 18, polardb: 19, hologres: 20,
  db2: 21, greenplum: 22, oracle: 25, dm: 26, cos: 27, redis: 43,
  databricks: 44, automq: 45, redshift: 46, s3: 38, dynamodb: 51,
  aurora_mysql: 39, aurora_postgresql: 40, polardb_postgresql: 48,
}

const DS_TYPE_NAMES: Record<number, string> = {
  1: "LakeHouse", 2: "Kafka", 3: "Hive", 4: "ClickHouse", 5: "MySQL",
  7: "PostgreSQL", 8: "SqlServer", 9: "Oss", 10: "Hbase", 11: "Odps",
  12: "MongoDB", 13: "ElasticSearch7", 14: "Doris", 15: "StarRocks",
  16: "SelectDB", 17: "TiDB", 18: "MariaDB", 19: "PolarDB MySQL", 20: "Hologres",
  21: "DB2", 22: "Greenplum", 25: "Oracle", 26: "DM", 27: "COS",
  38: "S3", 39: "Aurora MySQL", 40: "Aurora PostgreSQL", 43: "Redis",
  44: "Databricks", 45: "AutoMQ", 46: "Redshift", 48: "PolarDB PostgreSQL",
  51: "DynamoDB",
}

function parseDsType(value: string): number | undefined {
  const n = Number(value)
  if (Number.isFinite(n)) return n
  return DS_TYPE_MAP[value.toLowerCase()]
}

// ---------------------------------------------------------------------------
// Studio API helpers
// ---------------------------------------------------------------------------
const API = {
  LIST: "/ide-authority/v1/projectDataSources/list",
  NAMESPACES: "/ide-authority/v1/projectDataSources/listNamespaces",
  OBJECTS: "/ide-authority/v1/projectDataSources/listDataObjects",
  META_DETAIL: "/ide-authority/v1/projectDataSources/getDataObjectMeta",
  TEST: "/ide-authority/v1/projectDataSources/testDatasource",
  SAMPLE: "/ide-authority/v1/projectDataSources/getSampleData",
}

async function apiList(sc: StudioConfig, opts: { dsName?: string; dsType?: number; page?: number; pageSize?: number }) {
  return studioRequest<{ list?: unknown[]; total?: number }>(sc, API.LIST, {
    current: opts.page ?? 1,
    pageSize: opts.pageSize ?? 20,
    status: 1,
    pageIndex: opts.page ?? 1,
    dsName: opts.dsName,
    dsType: opts.dsType,
    projectName: sc.workspaceName
  })
}

async function apiNamespaces(sc: StudioConfig, datasourceId: number) {
  return studioRequest<{ list?: string[] }>(sc, API.NAMESPACES, { id: datasourceId })
}

async function apiObjects(sc: StudioConfig, datasourceId: number, namespace: string) {
  return studioRequest<{ list?: unknown[] }>(sc, API.OBJECTS, { id: datasourceId, nameSpace: namespace })
}

async function apiMetaDetail(sc: StudioConfig, datasourceId: number, namespace: string, tableName: string) {
  return studioRequest<unknown>(sc, API.META_DETAIL, { id: datasourceId, nameSpace: namespace, dataObjectName:tableName })
}

async function apiTestDatasource(sc: StudioConfig, ds: { id: number; dsType?: number; connectionParams?: unknown }) {
  try {
    const resp = await studioRequest<unknown>(sc, API.TEST, { id: ds.id, dsType: ds.dsType, env:"prod", connectionParams: ds.connectionParams })
    return { connected: resp.data === true, message: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { connected: false, message: msg }
  }
}

function reportDatasourceError(err: unknown, format: string | undefined): void {
  if (isHandledCliError(err)) return
  error("DATASOURCE_ERROR", err instanceof Error ? err.message : String(err), { format })
}

async function apiSampleData(sc: StudioConfig, params: { id: number; nameSpace: string; dataObjectName: string; dsType?: number; partitions?: string; where?: string }) {
  return studioRequest<{ fieldNames?: string[]; rows?: unknown[][] }>(sc, API.SAMPLE, {
    id: params.id,
    nameSpace: params.nameSpace,
    dataObjectName: params.dataObjectName,
    options: { dsType: params.dsType, ...(params.where && { where: params.where }) },
  })
}

// ---------------------------------------------------------------------------
// Resolve datasource by name or id
// ---------------------------------------------------------------------------
export interface ResolvedDatasource {
  id: number
  name: string
  dsType?: number
  connectionParams?: unknown
}

export async function resolveDatasource(sc: StudioConfig, nameOrId: string): Promise<ResolvedDatasource> {
  const n = Number(nameOrId)
  if (Number.isFinite(n) && n > 0) {
    // Fetch detail by listing with no filter and finding by id
    const resp = await apiList(sc, { pageSize: 100 })
    const list = (resp.data as Record<string, unknown>)?.list as Record<string, unknown>[] | undefined
      ?? (Array.isArray(resp.data) ? resp.data as Record<string, unknown>[] : [])
    const match = list.find((ds) => Number(ds.id ?? ds.dsId) === n)
    if (match) {
      return {
        id: n,
        name: String(match.dsName ?? match.name ?? nameOrId),
        dsType: match.dsType as number | undefined,
        connectionParams: match.connectionParams,
      }
    }
    return { id: n, name: nameOrId }
  }
  // Search by name
  const resp = await apiList(sc, { dsName: nameOrId, pageSize: 50 })
  const list = (resp.data as Record<string, unknown>)?.list as Record<string, unknown>[] | undefined
    ?? (Array.isArray(resp.data) ? resp.data as Record<string, unknown>[] : [])
  const exact = list.find((ds) => String(ds.dsName ?? ds.name ?? "") === nameOrId)
  const match = exact ?? list[0]
  if (!match) throw new Error(`Datasource '${nameOrId}' not found`)
  return {
    id: Number(match.id ?? match.dsId),
    name: String(match.dsName ?? match.name ?? nameOrId),
    dsType: match.dsType as number | undefined,
    connectionParams: match.connectionParams,
  }
}

// ---------------------------------------------------------------------------
// CDC prerequisite check — shared helper used by check-cdc command and task commands
// ---------------------------------------------------------------------------
export interface CdcPrereqCheck {
  name: string
  required: string
  actual: string
  pass: boolean
}

export interface CdcPrereqResult {
  ok: boolean
  message: string
  checks: CdcPrereqCheck[]
}

export async function checkCdcPrereqs(
  sc: StudioConfig,
  ds: { id: number; name: string; dsType: number },
  sourceArg: string,
): Promise<CdcPrereqResult> {
  const MYSQL_LIKE = new Set([5, 17, 18, 19, 39])
  const PG_LIKE    = new Set([7, 22, 40, 46, 48])
  const SS_LIKE    = new Set([8])
  const DM_LIKE    = new Set([26])
  const dsType = ds.dsType

  if (MYSQL_LIKE.has(dsType)) {
    const resp = await apiSampleData(sc, {
      id: ds.id, nameSpace: "performance_schema", dataObjectName: "global_variables", dsType,
      where: "VARIABLE_NAME IN ('log_bin','binlog_format','binlog_row_image')",
    }).catch(() => null)
    const data = resp?.data as { fieldNames?: string[]; rows?: unknown[][] } | undefined
    const nameIdx = data?.fieldNames?.findIndex(f => f.toUpperCase() === "VARIABLE_NAME") ?? 0
    const valIdx  = data?.fieldNames?.findIndex(f => f.toUpperCase() === "VARIABLE_VALUE") ?? 1
    const varMap: Record<string, string> = {}
    for (const row of data?.rows ?? []) {
      varMap[String((row as unknown[])[nameIdx] ?? "").toLowerCase()] = String((row as unknown[])[valIdx] ?? "")
    }
    const checks: CdcPrereqCheck[] = [
      { name: "log_bin",          required: "ON",   actual: varMap["log_bin"]          ?? "UNKNOWN" },
      { name: "binlog_format",    required: "ROW",  actual: varMap["binlog_format"]    ?? "UNKNOWN" },
      { name: "binlog_row_image", required: "FULL", actual: varMap["binlog_row_image"] ?? "UNKNOWN" },
    ].map(c => ({ ...c, pass: c.actual.toUpperCase() === c.required }))
    const ready = checks.every(c => c.pass)
    const failed = checks.filter(c => !c.pass)
    const fixHints = failed.map(c =>
      c.name === "log_bin"          ? "Enable binary logging: add `log_bin=ON` to my.cnf and restart MySQL" :
      c.name === "binlog_format"    ? `SET GLOBAL binlog_format = 'ROW';` :
      c.name === "binlog_row_image" ? `SET GLOBAL binlog_row_image = 'FULL';` : ""
    ).filter(Boolean)
    return { ok: ready, checks, message: ready ? "" : `MySQL CDC prerequisites not met for '${ds.name}':\n${fixHints.join("\n")}\n\nRun 'cz-cli datasource check-cdc ${sourceArg}' for details. Use --skip-check to bypass.` }
  }

  if (PG_LIKE.has(dsType)) {
    const checks: CdcPrereqCheck[] = []
    const walResp = await apiSampleData(sc, {
      id: ds.id, nameSpace: "pg_catalog", dataObjectName: "pg_settings", dsType,
      where: "name = 'wal_level'",
    }).catch(() => null)
    const walData = walResp?.data as { fieldNames?: string[]; rows?: unknown[][] } | undefined
    const settingIdx = walData?.fieldNames?.findIndex(f => f.toLowerCase() === "setting") ?? 1
    const walLevel = walData?.rows?.[0] ? String((walData.rows[0] as unknown[])[settingIdx]) : "UNKNOWN"
    checks.push({ name: "wal_level", required: "logical", actual: walLevel, pass: walLevel === "logical" })
    const slotResp = await listPgSlots(sc, [ds.id]).catch(() => null)
    const slots = slotResp?.data?.find(s => s.datasourceId === ds.id)?.pipelineSlotMetaVos ?? []
    checks.push({ name: "replication_slot", required: ">= 1 slot", actual: slots.length > 0 ? slots.map(s => s.slotName).join(", ") : "none", pass: slots.length > 0 })
    const ready = checks.every(c => c.pass)
    const failed = checks.filter(c => !c.pass)
    const fixHints = failed.map(c =>
      c.name === "wal_level"
        ? "Set wal_level=logical in postgresql.conf and restart PostgreSQL"
        : "Create a replication slot: SELECT pg_create_logical_replication_slot('slot_name', 'pgoutput');"
    )
    return { ok: ready, checks, message: ready ? "" : `PostgreSQL CDC prerequisites not met for '${ds.name}':\n${fixHints.join("\n")}\n\nRun 'cz-cli datasource check-cdc ${sourceArg}' for details. Use --skip-check to bypass.` }
  }

  if (SS_LIKE.has(dsType)) {
    const checks: CdcPrereqCheck[] = []
    // Check CDC enabled: query INFORMATION_SCHEMA.TABLES for cdc schema tables
    // (sys.databases is not accessible via getSampleData API — uses schema prefix internally)
    const cdcTablesResp = await apiSampleData(sc, { id: ds.id, nameSpace: "INFORMATION_SCHEMA", dataObjectName: "TABLES", dsType }).catch(() => null)
    const cdcTablesData = cdcTablesResp?.data as { fieldNames?: string[]; rows?: unknown[][] } | undefined
    const schemaIdx = cdcTablesData?.fieldNames?.findIndex(f => f.toUpperCase() === "TABLE_SCHEMA") ?? -1
    const cdcRows = (cdcTablesData?.rows ?? []).filter(row => String((row as unknown[])[schemaIdx] ?? "").toLowerCase() === "cdc")
    const isCdcEnabled = cdcRows.length > 0
    checks.push({ name: "cdc_enabled", required: "1 (enabled)", actual: isCdcEnabled ? "1 (cdc schema found)" : "0 (no cdc schema)", pass: isCdcEnabled })
    // Check SQL Server Agent: try msdb.dbo.sysjobs (Agent jobs table) — accessible if Agent is configured
    const agentResp = await apiSampleData(sc, { id: ds.id, nameSpace: "INFORMATION_SCHEMA", dataObjectName: "SCHEMATA", dsType }).catch(() => null)
    const agentData = agentResp?.data as { fieldNames?: string[]; rows?: unknown[][] } | undefined
    const schemaNameIdx = agentData?.fieldNames?.findIndex(f => f.toUpperCase() === "SCHEMA_NAME") ?? -1
    const hasCdcSchema = (agentData?.rows ?? []).some(row => String((row as unknown[])[schemaNameIdx] ?? "").toLowerCase() === "cdc")
    // If CDC schema exists, SQL Server Agent must be running (CDC requires it)
    const agentStatus = isCdcEnabled ? "Running (inferred from active CDC)" : "UNKNOWN (enable CDC first)"
    checks.push({ name: "sql_server_agent", required: "Running", actual: agentStatus, pass: isCdcEnabled })
    const ready = checks.every(c => c.pass)
    const failed = checks.filter(c => !c.pass)
    const fixHints = failed.map(c => c.name === "cdc_enabled"
      ? "Enable CDC on the database: EXEC sys.sp_cdc_enable_db\nThen enable CDC on each table: EXEC sys.sp_cdc_enable_table @source_schema='dbo', @source_name='<table>', @role_name=NULL"
      : "Start SQL Server Agent service (required for CDC capture jobs)")
    return { ok: ready, checks, message: ready ? "" : `SQL Server CDC prerequisites not met for '${ds.name}':\n${fixHints.join("\n")}\n\nRun 'cz-cli datasource check-cdc ${sourceArg}' for details. Use --skip-check to bypass.` }
  }

  if (DM_LIKE.has(dsType)) {
    const checks: CdcPrereqCheck[] = []
    const archResp = await apiSampleData(sc, { id: ds.id, nameSpace: "SYS", dataObjectName: "V$DATABASE", dsType }).catch(() => null)
    const archData = archResp?.data as { fieldNames?: string[]; rows?: unknown[][] } | undefined
    const archIdx = archData?.fieldNames?.findIndex(f => f.toUpperCase() === "ARCH_MODE") ?? -1
    const archMode = archIdx >= 0 && archData?.rows?.[0] ? String((archData.rows[0] as unknown[])[archIdx]) : "UNKNOWN"
    checks.push({ name: "arch_mode", required: "1 (archiving enabled)", actual: archMode, pass: archMode === "1" })
    const suppIdx = archData?.fieldNames?.findIndex(f => f.toUpperCase() === "SUPPLEMENTAL_LOG_DATA_MIN") ?? -1
    const suppLog = suppIdx >= 0 && archData?.rows?.[0] ? String((archData.rows[0] as unknown[])[suppIdx]) : "UNKNOWN"
    checks.push({ name: "supplemental_log", required: "YES", actual: suppLog, pass: suppLog.toUpperCase() === "YES" })
    const ready = checks.every(c => c.pass)
    const failed = checks.filter(c => !c.pass)
    const fixHints = failed.map(c => c.name === "arch_mode" ? "Enable archive log mode in DM: ALTER DATABASE MOUNT; ALTER DATABASE ARCHIVELOG; ALTER DATABASE OPEN;" : "Enable supplemental logging: ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;")
    return { ok: ready, checks, message: ready ? "" : `DM CDC prerequisites not met for '${ds.name}':\n${fixHints.join("\n")}\n\nRun 'cz-cli datasource check-cdc ${sourceArg}' for details. Use --skip-check to bypass.` }
  }

  // Oracle (dsType=25) is not supported for CDC multi-table sync
  const ORACLE_LIKE = new Set([25])
  if (ORACLE_LIKE.has(dsType)) {
    return {
      ok: false,
      checks: [{ name: "cdc_support", required: "supported", actual: "not supported", pass: false }],
      message: `Oracle is not supported as a CDC source for multi-table real-time sync. Supported sources: MySQL, PostgreSQL, SQL Server, DM.`,
    }
  }

  return { ok: true, message: "", checks: [] }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------
export function registerDatasourceCommand(cli: Argv<GlobalArgs>): void {
  cli.command("datasource", "Manage external data sources", (yargs) => {
    yargs
      // ── list ──────────────────────────────────────────────────────────
      .command(
        "list",
        "List all data sources. Use --name to filter, --type to filter by db type. After listing, use 'datasource test <name>' to verify connectivity.",
        (y) =>
          y
            .option("name", { type: "string", describe: "Filter by name (fuzzy)" })
            .option("type", { type: "string", describe: `Filter by type: ${Object.keys(DS_TYPE_MAP).join(", ")}` })
            .option("page", { type: "number", default: 1, describe: "Page number" })
            .option("page-size", { type: "number", default: 20, describe: "Items per page" }),
        async (argv) => {
          const format = argv.format
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const dsType = argv.type ? parseDsType(argv.type) : undefined
            if (argv.type && dsType === undefined) {
              error("INVALID_TYPE", `Unknown datasource type '${argv.type}'. Valid: ${Object.keys(DS_TYPE_MAP).join(", ")}`, { format }); return
            }
            const resp = await apiList(sc, { dsName: argv.name, dsType, page: argv.page, pageSize: argv["page-size"] })
            const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
            const list = (Array.isArray(data.list) ? data.list : Array.isArray(resp.data) ? resp.data : []) as Record<string, unknown>[]
            const total = (data.total as number | undefined) ?? list.length
            const rows = list.map((ds) => ({
              id: ds.id ?? ds.dsId,
              name: ds.dsName ?? ds.name,
              type: DS_TYPE_NAMES[Number(ds.dsType)] ?? ds.dsType,
              status: ds.status,
              connectionParams: ds.connectionParams,
              testFailedReason:ds.testFailedReason
            }))
            logOperation("datasource list", { ok: true, rows: rows.length, timeMs: Date.now() - t0 })
            success(rows, {
              format, timeMs: Date.now() - t0,
              aiMessage: `Page ${argv.page}, showing ${rows.length} of ${total} datasources.`,
            })
          } catch (err) {
            logOperation("datasource list", { ok: false, timeMs: Date.now() - t0 })
            reportDatasourceError(err, format)
          }
        },
      )
      // ── catalogs ──────────────────────────────────────────────────────
      .command(
        "catalogs <datasource>",
        "List catalogs (namespaces/databases/topics) in a data source",
        (y) =>
          y
            .positional("datasource", { type: "string", demandOption: true, describe: "Datasource name or ID" })
            .option("filter", { type: "string", describe: "Filter by name (fuzzy)" })
            .option("limit", { type: "number", default: 50, describe: "Max results to return" }),
        async (argv) => {
          const format = argv.format
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const ds = await resolveDatasource(sc, argv.datasource as string)
            const resp = await apiNamespaces(sc, ds.id)
            const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
            let list = (data.list as string[]) ?? []
            if (argv.filter) {
              const f = argv.filter.toLowerCase()
              list = list.filter((ns) => String(ns).toLowerCase().includes(f))
            }
            const total = list.length
            const limit = argv.limit as number
            const limited = list.slice(0, limit)
            logOperation("datasource catalogs", { ok: true, rows: limited.length, timeMs: Date.now() - t0 })
            success(limited, {
              format, timeMs: Date.now() - t0,
              aiMessage: total > limited.length
                ? `Showing ${limited.length} of ${total} catalogs. Use --filter to narrow or --limit to raise the cap. Use one of these catalog names with: cz-cli datasource objects <datasource> <catalog>`
                : `Use one of these catalog names with: cz-cli datasource objects ${argv.datasource} <catalog>`,
            })
          } catch (err) {
            logOperation("datasource catalogs", { ok: false, timeMs: Date.now() - t0 })
            reportDatasourceError(err, format)
          }
        },
      )
      // ── objects ───────────────────────────────────────────────────────
      .command(
        "objects <datasource> <catalog>",
        "List objects (tables/topics/collections) in a catalog",
        (y) =>
          y
            .positional("datasource", { type: "string", demandOption: true, describe: "Datasource name or ID" })
            .positional("catalog", { type: "string", demandOption: true, describe: "Catalog (namespace/database)" })
            .option("filter", { type: "string", describe: "Filter by name (fuzzy)" })
            .option("limit", { type: "number", default: 50, describe: "Max results to return" }),
        async (argv) => {
          const format = argv.format
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const ds = await resolveDatasource(sc, argv.datasource as string)
            const resp = await apiObjects(sc, ds.id, argv.catalog as string)
            const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
            let list = (data.list as unknown[]) ?? []
            if (argv.filter) {
              const f = argv.filter.toLowerCase()
              list = list.filter((obj) => {
                const name = typeof obj === "string" ? obj : String((obj as Record<string, unknown>).name ?? (obj as Record<string, unknown>).tableName ?? obj)
                return name.toLowerCase().includes(f)
              })
            }
            const names = list.map((obj) =>
              typeof obj === "string" ? obj : String((obj as Record<string, unknown>).name ?? (obj as Record<string, unknown>).tableName ?? obj)
            )
            const total = names.length
            const limited = names.slice(0, argv.limit as number)
            logOperation("datasource objects", { ok: true, rows: limited.length, timeMs: Date.now() - t0 })
            success(limited, {
              format, timeMs: Date.now() - t0,
              aiMessage: total > limited.length
                ? `Showing ${limited.length} of ${total} objects. Use --filter to narrow or --limit to raise the cap. Use a table name with: cz-cli datasource describe <datasource> ${argv.catalog} <table>`
                : `Use a table name with: cz-cli datasource describe ${argv.datasource} ${argv.catalog} <table>`,
            })
          } catch (err) {
            logOperation("datasource objects", { ok: false, timeMs: Date.now() - t0 })
            reportDatasourceError(err, format)
          }
        },
      )
      // ── describe ──────────────────────────────────────────────────────
      .command(
        "describe <datasource> <catalog> <object>",
        "Show metadata detail for an object",
        (y) =>
          y
            .positional("datasource", { type: "string", demandOption: true, describe: "Datasource name or ID" })
            .positional("catalog", { type: "string", demandOption: true, describe: "Catalog (namespace/database)" })
            .positional("object", { type: "string", demandOption: true, describe: "Object name (table/topic)" }),
        async (argv) => {
          const format = argv.format
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const ds = await resolveDatasource(sc, argv.datasource as string)
            const resp = await apiMetaDetail(sc, ds.id, argv.catalog as string, argv.object as string)
            logOperation("datasource describe", { ok: true, timeMs: Date.now() - t0 })
            success(resp.data, { format, timeMs: Date.now() - t0, aiMessage: `Column metadata retrieved. Use source_columns to generate DDL for target Lakehouse table, or proceed to: cz-cli task create-offline-sync <name> --folder <folder> --source ${argv.datasource} --source-db ${argv.catalog} --source-table ${argv.object}` })
          } catch (err) {
            logOperation("datasource describe", { ok: false, timeMs: Date.now() - t0 })
            reportDatasourceError(err, format)
          }
        },
      )
      // ── test ──────────────────────────────────────────────────────────
      .command(
        "test <datasource>",
        "Test data source connectivity. Returns {connected: true/false} with latency. Use before creating sync tasks to verify the datasource is reachable.",
        (y) =>
          y.positional("datasource", { type: "string", demandOption: true, describe: "Datasource name or ID" }),
        async (argv) => {
          const format = argv.format
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const ds = await resolveDatasource(sc, argv.datasource as string)
            const result = await apiTestDatasource(sc, ds)
            logOperation("datasource test", { ok: result.connected, timeMs: Date.now() - t0 })
            if (result.connected) {
              success({ datasource: ds.name, id: ds.id, connected: true }, { format, timeMs: Date.now() - t0 })
            } else {
              error("CONNECTION_FAILED", result.message ?? "Datasource connectivity test failed", {
                format,
                aiMessage: `Datasource '${ds.name}' (id=${ds.id}) is not reachable. Check network and connection parameters.`,
              })
            }
          } catch (err) {
            logOperation("datasource test", { ok: false, timeMs: Date.now() - t0 })
            reportDatasourceError(err, format)
          }
        },
      )
      // ── sample ────────────────────────────────────────────────────────
      .command(
        "sample <datasource> <catalog> <object>",
        "Get sample data from an object",
        (y) =>
          y
            .positional("datasource", { type: "string", demandOption: true, describe: "Datasource name or ID" })
            .positional("catalog", { type: "string", demandOption: true, describe: "Catalog (namespace/database)" })
            .positional("object", { type: "string", demandOption: true, describe: "Object name (table/topic)" })
            .option("limit", { type: "number", default: 50, describe: "Max rows to return" }),
        async (argv) => {
          const format = argv.format
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const ds = await resolveDatasource(sc, argv.datasource as string)
            const resp = await apiSampleData(sc, {
              id: ds.id,
              nameSpace: argv.catalog as string,
              dataObjectName: argv.object as string,
              dsType: ds.dsType,
            })
            const data = resp.data as { fieldNames?: string[]; rows?: unknown[][] } | undefined
            if (!data?.fieldNames || !data?.rows) {
              success(data ?? {}, { format, timeMs: Date.now() - t0 }); return
            }
            const rows = data.rows.slice(0, argv.limit as number).map((row) =>
              Object.fromEntries(data.fieldNames!.map((col, i) => [col, row[i]]))
            )
            logOperation("datasource sample", { ok: true, rows: rows.length, timeMs: Date.now() - t0 })
            success(rows, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            logOperation("datasource sample", { ok: false, timeMs: Date.now() - t0 })
            reportDatasourceError(err, format)
          }
        },
      )
      // ── check-cdc ─────────────────────────────────────────────────────────
      .command(
        "check-cdc <datasource>",
        "Check if a datasource meets CDC prerequisites (binlog/WAL config, replication slots)",
        (y) =>
          y.positional("datasource", { type: "string", demandOption: true, describe: "Datasource name or ID" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await getStudioContext(argv)
            const ds = await resolveDatasource(sc, argv.datasource as string)
            const dsType = ds.dsType ?? 0
            const result = await checkCdcPrereqs(sc, { id: ds.id, name: ds.name, dsType }, ds.name)
            logOperation("datasource check-cdc", { ok: result.ok })
            const aiMsg = result.ok
              ? (dsType === 0
                  ? `Datasource type ${dsType} does not require CDC prerequisite checks.`
                  : result.checks.length === 0
                    ? `Datasource type ${dsType} does not require CDC prerequisite checks.`
                    : `${ds.name} CDC prerequisites met. Proceed to: cz-cli task create-realtime-sync <name> --folder <folder> --source ${ds.name} --database <db> --target <lakehouse_ds>`)
              : result.message
            success({ datasource: ds.name, ds_type: dsType, checks: result.checks, ready: result.ok }, {
              format, aiMessage: aiMsg,
            })
          } catch (err) {
            reportDatasourceError(err, format)
          }
        },
      )
    return commandGroup(yargs, "datasource")
  })
}
