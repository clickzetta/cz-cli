import type { Argv } from "yargs"
import { studioRequest, type StudioConfig } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
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
}

const DS_TYPE_NAMES: Record<number, string> = {
  1: "LakeHouse", 2: "Kafka", 3: "Hive", 4: "ClickHouse", 5: "MySQL",
  7: "PostgreSQL", 8: "SqlServer", 9: "Oss", 10: "Hbase", 11: "Odps",
  12: "MongoDB", 13: "ElasticSearch7", 14: "Doris", 15: "StarRocks",
  16: "SelectDB", 17: "TiDB", 18: "MariaDB", 19: "PolarDB", 20: "Hologres",
  21: "DB2", 22: "Greenplum", 25: "Oracle", 26: "DM", 27: "COS",
  38: "S3", 43: "Redis", 44: "Databricks", 45: "AutoMQ", 46: "Redshift",
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

// ---------------------------------------------------------------------------
// Resolve datasource by name or id
// ---------------------------------------------------------------------------
async function resolveDatasource(sc: StudioConfig, nameOrId: string): Promise<{ id: number; name: string }> {
  const n = Number(nameOrId)
  if (Number.isFinite(n) && n > 0) return { id: n, name: nameOrId }
  // Search by name
  const resp = await apiList(sc, { dsName: nameOrId, pageSize: 50 })
  const list = (resp.data as Record<string, unknown>)?.list as Record<string, unknown>[] | undefined
    ?? (Array.isArray(resp.data) ? resp.data as Record<string, unknown>[] : [])
  const exact = list.find((ds) => String(ds.dsName ?? ds.name ?? "") === nameOrId)
  const match = exact ?? list[0]
  if (!match) throw new Error(`Datasource '${nameOrId}' not found`)
  return { id: Number(match.id ?? match.dsId), name: String(match.dsName ?? match.name ?? nameOrId) }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------
export function registerDatasourceCommand(cli: Argv<GlobalArgs>): void {
  cli.command("datasource", "Manage external data sources", (yargs) =>
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
          const format = argv.output
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
              testStatus: ds.testStatus,
              testFailedReason:ds.testFailedReason
            }))
            logOperation("datasource list", { ok: true, rows: rows.length, timeMs: Date.now() - t0 })
            success(rows, {
              format, timeMs: Date.now() - t0,
              aiMessage: `Page ${argv.page}, showing ${rows.length} of ${total} datasources.`,
            })
          } catch (err) {
            logOperation("datasource list", { ok: false, timeMs: Date.now() - t0 })
            error("DATASOURCE_ERROR", err instanceof Error ? err.message : String(err), { format })
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
            .option("filter", { type: "string", describe: "Filter by name (fuzzy)" }),
        async (argv) => {
          const format = argv.output
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
            logOperation("datasource catalogs", { ok: true, rows: list.length, timeMs: Date.now() - t0 })
            success(list, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            logOperation("datasource catalogs", { ok: false, timeMs: Date.now() - t0 })
            error("DATASOURCE_ERROR", err instanceof Error ? err.message : String(err), { format })
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
            .option("filter", { type: "string", describe: "Filter by name (fuzzy)" }),
        async (argv) => {
          const format = argv.output
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
            logOperation("datasource objects", { ok: true, rows: names.length, timeMs: Date.now() - t0 })
            success(names, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            logOperation("datasource objects", { ok: false, timeMs: Date.now() - t0 })
            error("DATASOURCE_ERROR", err instanceof Error ? err.message : String(err), { format })
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
          const format = argv.output
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const ds = await resolveDatasource(sc, argv.datasource as string)
            const resp = await apiMetaDetail(sc, ds.id, argv.catalog as string, argv.object as string)
            logOperation("datasource describe", { ok: true, timeMs: Date.now() - t0 })
            success(resp.data, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            logOperation("datasource describe", { ok: false, timeMs: Date.now() - t0 })
            error("DATASOURCE_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .strictCommands().strictOptions().demandCommand(1, ""),
  )
}
