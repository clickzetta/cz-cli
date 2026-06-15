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
// Command registration
// ---------------------------------------------------------------------------
export function registerDatasourceCommand(cli: Argv<GlobalArgs>): void {
  cli.command("datasource", "Manage external data sources", (yargs) => {
    yargs
      // ── list ──────────────────────────────────────────────────────────
      .command(
        "list",
        "List data sources",
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
        "Test data source connectivity",
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

            const MYSQL_LIKE = new Set([5, 17, 18, 19, 39])
            const PG_LIKE    = new Set([7, 22, 40, 46, 48])
            const SS_LIKE    = new Set([8])   // SQL Server
            const DM_LIKE    = new Set([26])  // DM 达梦

            // ── MySQL / TiDB / Aurora MySQL / PolarDB MySQL ────────────────
            if (MYSQL_LIKE.has(dsType)) {
              const resp = await apiSampleData(sc, {
                id: ds.id, nameSpace: "performance_schema", dataObjectName: "global_variables", dsType,
                where: "VARIABLE_NAME IN ('log_bin','binlog_format','binlog_row_image')",
              })
              const data = resp.data as { fieldNames?: string[]; rows?: unknown[][] } | undefined
              const nameIdx = data?.fieldNames?.findIndex(f => f.toUpperCase() === "VARIABLE_NAME") ?? 0
              const valIdx  = data?.fieldNames?.findIndex(f => f.toUpperCase() === "VARIABLE_VALUE") ?? 1
              const varMap: Record<string, string> = {}
              for (const row of data?.rows ?? []) {
                const k = String((row as unknown[])[nameIdx] ?? "").toLowerCase()
                varMap[k] = String((row as unknown[])[valIdx] ?? "")
              }
              const checks = [
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

              logOperation("datasource check-cdc", { ok: ready })
              success({ datasource: ds.name, ds_type: dsType, checks, ready }, {
                format,
                aiMessage: ready
                  ? `MySQL CDC prerequisites met for '${ds.name}'. Proceed to: cz-cli task create-realtime-sync <name> --folder <folder> --source ${ds.name} --database <db> --target <lakehouse_ds>`
                  : `MySQL CDC prerequisites NOT met for '${ds.name}'. Fix:\n${fixHints.join("\n")}`,
              })
              return
            }

            // ── PostgreSQL / Aurora PG / PolarDB PG / Greenplum / Redshift ─
            if (PG_LIKE.has(dsType)) {
              const checks: { name: string; required: string; actual: string; pass: boolean }[] = []

              // wal_level check
              const walResp = await apiSampleData(sc, {
                id: ds.id, nameSpace: "pg_catalog", dataObjectName: "pg_settings", dsType,
                where: "name = 'wal_level'",
              }).catch(() => null)
              const walData = walResp?.data as { fieldNames?: string[]; rows?: unknown[][] } | undefined
              const settingIdx = walData?.fieldNames?.findIndex(f => f.toLowerCase() === "setting") ?? 1
              const walRow = walData?.rows?.[0]
              const walLevel = walRow ? String((walRow as unknown[])[settingIdx]) : "UNKNOWN"
              checks.push({ name: "wal_level", required: "logical", actual: walLevel, pass: walLevel === "logical" })

              // slot check
              const slotResp = await listPgSlots(sc, [ds.id]).catch(() => null)
              const slots = slotResp?.data?.find(s => s.datasourceId === ds.id)?.pipelineSlotMetaVos ?? []
              checks.push({
                name: "replication_slot",
                required: ">= 1 slot",
                actual: slots.length > 0 ? slots.map(s => s.slotName).join(", ") : "none",
                pass: slots.length > 0,
              })

              const ready = checks.every(c => c.pass)
              const failed = checks.filter(c => !c.pass)
              const fixHints = failed.map(c =>
                c.name === "wal_level"
                  ? "Set wal_level=logical in postgresql.conf and restart PostgreSQL"
                  : "Create a replication slot: SELECT pg_create_logical_replication_slot('slot_name', 'pgoutput');"
              )

              logOperation("datasource check-cdc", { ok: ready })
              success({ datasource: ds.name, ds_type: dsType, checks, ready }, {
                format,
                aiMessage: ready
                  ? `PostgreSQL CDC prerequisites met for '${ds.name}'. Proceed to: cz-cli task create-realtime-sync <name> --folder <folder> --source ${ds.name} --database <db> --target <lakehouse_ds>`
                  : `PostgreSQL CDC prerequisites NOT met for '${ds.name}'. Fix:\n${fixHints.join("\n")}`,
              })
              return
            }

            // ── SQL Server ─────────────────────────────────────────────────
            // Note: not tested (no environment available) — based on standard SQL Server CDC docs
            if (SS_LIKE.has(dsType)) {
              const checks: { name: string; required: string; actual: string; pass: boolean }[] = []

              // Check if CDC is enabled at database level: sys.databases.is_cdc_enabled = 1
              const dbResp = await apiSampleData(sc, {
                id: ds.id, nameSpace: "master", dataObjectName: "sys.databases", dsType,
                where: "name = DB_NAME()",
              }).catch(() => null)
              const dbData = dbResp?.data as { fieldNames?: string[]; rows?: unknown[][] } | undefined
              const cdcIdx = dbData?.fieldNames?.findIndex(f => f.toLowerCase() === "is_cdc_enabled") ?? -1
              const isCdcEnabled = cdcIdx >= 0 && dbData?.rows?.[0]
                ? String((dbData.rows[0] as unknown[])[cdcIdx]) === "1" || String((dbData.rows[0] as unknown[])[cdcIdx]).toLowerCase() === "true"
                : false
              checks.push({
                name: "cdc_enabled",
                required: "1 (enabled)",
                actual: isCdcEnabled ? "1" : (cdcIdx >= 0 ? "0" : "UNKNOWN"),
                pass: isCdcEnabled,
              })

              // Check if SQL Server Agent is running: sys.dm_server_services
              const agentResp = await apiSampleData(sc, {
                id: ds.id, nameSpace: "master", dataObjectName: "sys.dm_server_services", dsType,
                where: "servicename LIKE 'SQL Server Agent%'",
              }).catch(() => null)
              const agentData = agentResp?.data as { fieldNames?: string[]; rows?: unknown[][] } | undefined
              const statusIdx = agentData?.fieldNames?.findIndex(f => f.toLowerCase() === "status_desc") ?? -1
              const agentStatus = statusIdx >= 0 && agentData?.rows?.[0]
                ? String((agentData.rows[0] as unknown[])[statusIdx])
                : "UNKNOWN"
              checks.push({
                name: "sql_server_agent",
                required: "Running",
                actual: agentStatus,
                pass: agentStatus.toLowerCase() === "running",
              })

              const ready = checks.every(c => c.pass)
              const failed = checks.filter(c => !c.pass)
              const fixHints = failed.map(c =>
                c.name === "cdc_enabled"
                  ? "Enable CDC on the database: EXEC sys.sp_cdc_enable_db"
                  : "Start SQL Server Agent service (required for CDC capture jobs)"
              )

              logOperation("datasource check-cdc", { ok: ready })
              success({ datasource: ds.name, ds_type: dsType, checks, ready }, {
                format,
                aiMessage: ready
                  ? `SQL Server CDC prerequisites met for '${ds.name}'.`
                  : `SQL Server CDC prerequisites NOT met for '${ds.name}'. Fix:\n${fixHints.join("\n")}`,
              })
              return
            }

            // ── DM 达梦 ────────────────────────────────────────────────────
            // Note: not tested (no environment available) — based on standard DM CDC docs
            if (DM_LIKE.has(dsType)) {
              const checks: { name: string; required: string; actual: string; pass: boolean }[] = []

              // Check archive log mode: V$DATABASE ARCH_MODE = 1
              const archResp = await apiSampleData(sc, {
                id: ds.id, nameSpace: "SYS", dataObjectName: "V$DATABASE", dsType,
              }).catch(() => null)
              const archData = archResp?.data as { fieldNames?: string[]; rows?: unknown[][] } | undefined
              const archIdx = archData?.fieldNames?.findIndex(f => f.toUpperCase() === "ARCH_MODE") ?? -1
              const archMode = archIdx >= 0 && archData?.rows?.[0]
                ? String((archData.rows[0] as unknown[])[archIdx])
                : "UNKNOWN"
              checks.push({
                name: "arch_mode",
                required: "1 (archiving enabled)",
                actual: archMode,
                pass: archMode === "1",
              })

              // Check supplemental log: V$DATABASE SUPPLEMENTAL_LOG_DATA_MIN
              const suppIdx = archData?.fieldNames?.findIndex(f => f.toUpperCase() === "SUPPLEMENTAL_LOG_DATA_MIN") ?? -1
              const suppLog = suppIdx >= 0 && archData?.rows?.[0]
                ? String((archData.rows[0] as unknown[])[suppIdx])
                : "UNKNOWN"
              checks.push({
                name: "supplemental_log",
                required: "YES",
                actual: suppLog,
                pass: suppLog.toUpperCase() === "YES",
              })

              const ready = checks.every(c => c.pass)
              const failed = checks.filter(c => !c.pass)
              const fixHints = failed.map(c =>
                c.name === "arch_mode"
                  ? "Enable archive log mode in DM: ALTER DATABASE MOUNT; ALTER DATABASE ARCHIVELOG; ALTER DATABASE OPEN;"
                  : "Enable supplemental logging: ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;"
              )

              logOperation("datasource check-cdc", { ok: ready })
              success({ datasource: ds.name, ds_type: dsType, checks, ready }, {
                format,
                aiMessage: ready
                  ? `DM CDC prerequisites met for '${ds.name}'.`
                  : `DM CDC prerequisites NOT met for '${ds.name}'. Fix:\n${fixHints.join("\n")}`,
              })
              return
            }

            // ── Other types ────────────────────────────────────────────────
            success({ datasource: ds.name, ds_type: dsType, checks: [], ready: true }, {
              format,
              aiMessage: `Datasource type ${dsType} does not require CDC prerequisite checks.`,
            })
          } catch (err) {
            reportDatasourceError(err, format)
          }
        },
      )
    return commandGroup(yargs, "datasource")
  })
}
