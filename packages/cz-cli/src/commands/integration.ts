import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import {
  studioRequest,
  getTaskDetail,
  getTaskConfigDetail,
  saveTaskContent,
  type StudioConfig,
} from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error, handledError, isHandledCliError } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getStudioContext } from "./studio-context.js"
import { resolveTaskId } from "../resolver.js"
import { studioUrl } from "./studio-url.js"
import { resolveDatasource } from "./datasource.js"
import { resolveConnectionConfig } from "../connection/config.js"

// ---------------------------------------------------------------------------
// Studio API endpoints used for integration sync (ported from
// clickzetta-studio-ai-agent agent/tools/infra/config/api_properties.ini).
// ---------------------------------------------------------------------------
const API = {
  COLUMN_MAP_META: "/ide-authority/v1/projectDataSources/getColumnMapMeta",
  GET_DDL: "/ide-authority/v1/projectDataSources/getDdl",
  EXECUTE_SQL: "/ide-authority/v1/ai/mcp/execute",
  PIPELINE_CHECK_TABLES: "/ide-admin/v1/timelyTask/pipeline/checkTables",
}

// offline multi-table / whole-db sync: readMode is ignored, hard-code it.
const OFFLINE_READ_MODE = "BINLOG"

type Json = Record<string, unknown>
interface ColumnMeta { name?: string; columnName?: string; column?: string; [k: string]: unknown }
interface MappingRow { source?: string; sink?: string }
interface KvRow { key?: string; value?: unknown }

function reportError(err: unknown, format: string | undefined): void {
  if (isHandledCliError(err)) return
  error("INTEGRATION_ERROR", err instanceof Error ? err.message : String(err), { format })
}

function parseJsonArg<T>(raw: string | undefined, label: string, format: string | undefined): T | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.replace(/^'|'$/g, "").trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed) as T
  } catch {
    handledError("INVALID_ARGUMENTS", `--${label} is not valid JSON: ${raw}`, { format, exitCode: 2 })
  }
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Inline API helpers (studioRequest, same pattern as datasource.ts).
// ---------------------------------------------------------------------------

/** Fetch source/sink column metadata in one call. Returns {source, sink} column lists. */
async function getColumnMapMeta(
  sc: StudioConfig,
  src: { dsType?: number; id: number; schema: string; table: string },
  snk: { dsType?: number; id: number; schema: string; table: string },
): Promise<{ source: ColumnMeta[]; sink: ColumnMeta[] }> {
  const resp = await studioRequest<Json>(
    sc,
    `${API.COLUMN_MAP_META}?instanceId=${sc.instanceId}`,
    {
      sourceReq: {
        options: { dsType: src.dsType, operatorType: "source", table: src.table, database: src.schema },
        id: src.id,
        dataObjectName: src.table,
        nameSpace: src.schema,
      },
      sinkReq: {
        options: { dsType: snk.dsType, operatorType: "sink", table: snk.table },
        id: snk.id,
        dataObjectName: snk.table,
        nameSpace: snk.schema,
        __id__: [snk.dsType, snk.id],
        __partitions__: { open: false },
      },
    },
  )
  const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Json
  const source = ((data.sourceMeta as Json | undefined)?.columns as ColumnMeta[]) ?? []
  const sink = ((data.sinkMeta as Json | undefined)?.columns as ColumnMeta[]) ?? []
  return { source, sink }
}

/** Get the CREATE TABLE DDL for a source table (used to mirror it on the sink). */
async function getDatasourceDdl(
  sc: StudioConfig,
  src: { dsType?: number; id: number; schema: string; table: string },
  sink: { dsType?: number; schema: string },
): Promise<string> {
  const resp = await studioRequest<unknown>(
    sc,
    `${API.GET_DDL}?instanceId=${sc.instanceId}`,
    {
      options: { dsType: src.dsType, sinkNameSpace: sink.schema, sinkDsType: sink.dsType, operatorType: "source" },
      __id__: [src.dsType, src.id],
      id: src.id,
      nameSpace: src.schema,
      dataObjectName: src.table,
      workspace: "",
    },
  )
  return typeof resp.data === "string" ? resp.data : ""
}

/** Execute a SQL statement directly against an external datasource. */
async function executeDatasourceSql(
  sc: StudioConfig,
  datasourceId: number,
  sql: string,
  options: Json = {},
): Promise<{ ok: boolean; data: unknown }> {
  const resp = await studioRequest<unknown>(
    sc,
    `${API.EXECUTE_SQL}?instanceId=${sc.instanceId}`,
    { id: datasourceId, sql, options },
  )
  return { ok: true, data: resp.data }
}

/** Pre-save validation for multi-table / whole-db sync (Studio checkVirtualTables). Non-blocking. */
async function pipelineCheckTables(
  sc: StudioConfig,
  pipelineId: number,
  tableInfoList: { schema?: string; table?: string }[],
  pipelineType: number,
): Promise<string | null> {
  try {
    const resp = await studioRequest<unknown>(sc, API.PIPELINE_CHECK_TABLES, {
      pipelineId,
      workspace: sc.workspaceName,
      tableInfoVoList: tableInfoList,
      pipelineType,
    })
    const data = resp.data
    if (data === false) return resp.message ?? "table validation failed"
    if (data && typeof data === "object") {
      const d = data as Json
      if (d.checkResult === false) {
        return `table validation: duplicates=${JSON.stringify(d.duplicateMatchedTables)}, unmatched=${JSON.stringify(d.noneMatchedTables)}`
      }
    }
    return null
  } catch {
    // Non-blocking: a failed validation call must not block save.
    return null
  }
}

// ---------------------------------------------------------------------------
// Datasource-type-specific SQL generation (ported from datasource_utils.py).
// ---------------------------------------------------------------------------
function checkTableSql(dsType: number, schema: string, table: string): string | null {
  if ([5, 21, 22, 23, 24].includes(dsType)) return `SHOW TABLES FROM \`${schema}\` LIKE '${table}'`
  if ([7, 18, 19, 25, 26].includes(dsType))
    return `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = '${table}')`
  if (dsType === 12) return `db.getCollectionNames().indexOf('${table}') !== -1`
  if (dsType === 17) return `SELECT COUNT(*) FROM all_tables WHERE owner = UPPER('${schema}') AND table_name = UPPER('${table}')`
  if (dsType === 8) return `SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}'`
  if (dsType === 27) return `EXISTS TABLE \`${schema}\`.\`${table}\``
  if ([3, 4, 1].includes(dsType)) return `SHOW TABLES IN \`${schema}\` LIKE '${table}'`
  return null
}

function checkSchemaSql(dsType: number, schema: string): string | null {
  if ([5, 21, 22, 23, 24].includes(dsType)) return `SHOW DATABASES LIKE '${schema}'`
  if ([7, 18, 19, 25, 26].includes(dsType))
    return `SELECT EXISTS (SELECT FROM information_schema.schemata WHERE schema_name = '${schema}')`
  if (dsType === 17) return `SELECT COUNT(*) FROM all_users WHERE username = UPPER('${schema}')`
  if (dsType === 8) return `SELECT COUNT(*) FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${schema}'`
  if (dsType === 27) return `EXISTS DATABASE \`${schema}\``
  if ([3, 4].includes(dsType)) return `SHOW DATABASES LIKE '${schema}'`
  if (dsType === 1) return `SHOW SCHEMAS LIKE '${schema}'`
  return null
}

function createSchemaSql(dsType: number, schema: string): string | null {
  if ([5, 21, 22, 23, 24, 3, 4, 27].includes(dsType)) return `CREATE DATABASE IF NOT EXISTS \`${schema}\``
  if ([7, 18, 19, 25, 26].includes(dsType)) return `CREATE SCHEMA IF NOT EXISTS "${schema}"`
  if (dsType === 8)
    return `IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${schema}') EXEC('CREATE SCHEMA [${schema}]')`
  if (dsType === 1) return `CREATE SCHEMA IF NOT EXISTS ${schema}`
  return null
}

/** Recursively unwrap nested single-element arrays and pull the first row value. */
function firstScalar(data: unknown): unknown {
  let cur = data
  if (cur && typeof cur === "object" && !Array.isArray(cur)) {
    const rows = (cur as Json).rows
    if (Array.isArray(rows)) cur = rows[0]
    else return undefined
  }
  while (Array.isArray(cur) && cur.length > 0) cur = cur[0]
  return cur
}

function interpretExists(dsType: number, raw: unknown): boolean {
  const value = firstScalar(raw)
  if (value === undefined || value === null) return false
  // PostgreSQL family: EXISTS → boolean / "t" / "true"
  if ([7, 18, 19, 25, 26].includes(dsType)) {
    const s = String(value).toLowerCase().trim()
    return s.includes("true") || s === "t"
  }
  if (dsType === 12) {
    const s = String(value).toLowerCase()
    return s.includes("true") || !s.includes("-1")
  }
  // COUNT-based (Oracle/SQLServer/Lakehouse/ClickHouse) and SHOW-based families
  if (typeof value === "number") return value > 0
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const nums = value.match(/\d+/)
    if ([17, 8, 1].includes(dsType) && nums) return parseInt(nums[0], 10) > 0
    return value.trim().length > 0
  }
  return Boolean(value)
}

async function tableExists(
  sc: StudioConfig,
  datasourceId: number,
  dsType: number,
  schema: string,
  table: string,
): Promise<boolean> {
  const sql = checkTableSql(dsType, schema, table)
  if (!sql) return false
  try {
    const resp = await executeDatasourceSql(sc, datasourceId, sql)
    return interpretExists(dsType, resp.data)
  } catch {
    return false
  }
}

async function schemaExists(
  sc: StudioConfig,
  datasourceId: number,
  dsType: number,
  schema: string,
): Promise<boolean> {
  const sql = checkSchemaSql(dsType, schema)
  if (!sql) return true // unsupported probe → assume present, don't block
  try {
    const resp = await executeDatasourceSql(sc, datasourceId, sql)
    return interpretExists(dsType, resp.data)
  } catch {
    return false
  }
}

async function ensureSchema(
  sc: StudioConfig,
  datasourceId: number,
  dsType: number,
  schema: string,
  execOptions: Json,
): Promise<void> {
  if (await schemaExists(sc, datasourceId, dsType, schema)) return
  const sql = createSchemaSql(dsType, schema)
  if (!sql) return
  await executeDatasourceSql(sc, datasourceId, sql, execOptions)
}

/** Rewrite the CREATE TABLE target identifier in a source DDL to the sink schema.table. */
function rewriteDdlTarget(ddl: string, sinkSchema: string, sinkTable: string): string {
  const m = ddl.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i)
  if (!m) return ddl
  const original = m[1]
  const replacement = original.includes("`")
    ? `\`${sinkSchema}\`.\`${sinkTable}\``
    : original.includes('"')
      ? `"${sinkSchema}"."${sinkTable}"`
      : `${sinkSchema}.${sinkTable}`
  const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return ddl.replace(
    new RegExp(`(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)${escaped}`, "i"),
    `$1${replacement}`,
  )
}

/** Create the sink table by mirroring the source table's DDL. No-op if it already exists. */
async function createSinkTableFromSource(
  sc: StudioConfig,
  source: { id: number; dsType: number; schema: string; table: string },
  sink: { id: number; dsType: number; schema: string; table: string },
  execOptions: Json,
): Promise<void> {
  if (await tableExists(sc, sink.id, sink.dsType, sink.schema, sink.table)) return
  const ddl = await getDatasourceDdl(sc, source, sink)
  if (!ddl) throw new Error(`Could not fetch DDL for source table ${source.schema}.${source.table}`)
  const rewritten = rewriteDdlTarget(ddl, sink.schema, sink.table)
  await executeDatasourceSql(sc, sink.id, rewritten, execOptions)
}

// ---------------------------------------------------------------------------
// Column mapping / table mapping helpers (ported from task_handlers.py).
// ---------------------------------------------------------------------------
function colName(c: ColumnMeta | string): string | undefined {
  if (typeof c === "string") return c || undefined
  return c.name || c.columnName || c.column
}

/** Normalize submitted mapping into {sinkCol: sourceCol}. Accepts rows [{source,sink}] or a dict. */
function normalizeColumnMapping(value: MappingRow[] | Record<string, string> | undefined): Record<string, string> | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) {
    const mapping: Record<string, string> = {}
    for (const row of value) {
      if (row && row.source && row.sink) mapping[row.sink] = row.source
    }
    return Object.keys(mapping).length ? mapping : undefined
  }
  if (typeof value === "object") {
    const mapping: Record<string, string> = {}
    for (const [k, v] of Object.entries(value)) if (k && v) mapping[k] = v
    return Object.keys(mapping).length ? mapping : undefined
  }
  return undefined
}

/** {sink: source} → rows [{source, sink}] for display. */
function mappingToRows(mapping: Record<string, string> | undefined): MappingRow[] {
  if (!mapping || typeof mapping !== "object") return []
  return Object.entries(mapping).map(([sink, source]) => ({ source, sink }))
}

/** jobs[] → table rows [{source:'ns.table', sink:'ns.table'}]. */
function jobsToTableRows(content: Json): MappingRow[] {
  const rows: MappingRow[] = []
  for (const job of (content.jobs as Json[]) ?? []) {
    if (!job || typeof job !== "object") continue
    const src = (job.source as Json) ?? {}
    const snk = (job.sink as Json) ?? {}
    const s = [src.namespace, src.dataObject].filter(Boolean).join(".")
    const t = [snk.namespace, snk.dataObject].filter(Boolean).join(".")
    if (s) rows.push({ source: s, sink: t })
  }
  return rows
}

function splitQualified(x: string | undefined): [string, string] {
  const v = (x ?? "").trim()
  if (v.includes(".")) {
    const idx = v.indexOf(".")
    return [v.slice(0, idx).trim(), v.slice(idx + 1).trim()]
  }
  return ["", v]
}

/** table rows → jobs[] (empty columns/mapping; the running task creates tables). */
function rebuildJobsFromTableRows(content: Json, rows: MappingRow[]): Json[] {
  const srcConn = (content.sourceConnection as Json) ?? {}
  const dsArr = (srcConn.datasource as Json[]) ?? []
  const srcDsId = (dsArr[0] ?? {}).datasourceId
  const jobs: Json[] = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const [sNs, sTbl] = splitQualified(row.source)
    if (!sTbl) continue
    const [tNs, tTbl] = splitQualified(row.sink)
    jobs.push({
      source: { dataObject: sTbl, namespace: sNs, columns: [], datasourceId: srcDsId },
      sink: { dataObject: tTbl || sTbl, namespace: tNs || sNs, columns: [] },
      columnMapping: {},
    })
  }
  return jobs
}

function toInt(v: unknown): number | undefined {
  if (v === undefined || v === null || String(v).trim() === "") return undefined
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}

/** Wrap sink partition expressions to the Studio shape: ["dt=${bizdate}"] -> [["dt=${bizdate}"]]. */
function wrapPartitions(partitions: unknown[]): unknown[] {
  if (partitions.length && typeof partitions[0] === "string") return [partitions]
  return partitions
}

// ---------------------------------------------------------------------------
// Content generators (ported from datasource_utils.py).
// ---------------------------------------------------------------------------
function generatePipelineContent(opts: {
  pipelineType: number
  source: { id: number; name: string; dsType: number }
  sink: { id: number; name: string; dsType: number; schema: string }
  jobsSpec: [string, string][] // [sourceNamespace, table]
  dbNamespaces?: string[]
}): Json {
  const { pipelineType, source, sink, jobsSpec, dbNamespaces } = opts
  const content: Json = {
    templateKey: 1,
    userParams: {},
    pipelineType,
    heterogeneous: false,
    sourceConnection: {
      datasource: [{ datasourceId: source.id, datasourceName: source.name, type: source.dsType }],
      params: { readMode: OFFLINE_READ_MODE, dsType: source.dsType, operatorType: "source", heterogeneous: false },
    },
    sinkConnection: {
      datasourceId: sink.id,
      datasourceName: sink.name,
      type: sink.dsType,
      syncMode: 1,
      params: { dsType: sink.dsType, operatorType: "sink" },
    },
    setting: {
      groupingStrategy: { strategy: "SIZE", batchSize: 4, connections: 4, parallelism: 4 },
      pkWriteMode: "OVERWRITE",
      nonPkWriteMode: "OVERWRITE",
    },
    sourceEventTypes: ["c", "u", "d"],
    dataFilterSwitch: false,
    syncAllAtFirst: true,
    jobs: [],
  }
  if (pipelineType === 3) {
    content.dynamicFlag = true
    content.nameRule = {
      schema: { mode: "3", rule: "{SOURCE_DATABASE}" },
      table: { mode: "2", rule: "{SOURCE_DATABASE}_{SOURCE_TABLE}" },
    }
    if (dbNamespaces && dbNamespaces.length) {
      content.dbMirror = { dbs: dbNamespaces.map((ns) => ({ namespace: ns, datasourceId: source.id })) }
    }
  } else {
    content.nameRule = { schema: { mode: "2" }, table: { mode: "1" } }
  }
  const jobs = content.jobs as Json[]
  for (const [ns, tbl] of jobsSpec) {
    jobs.push({
      source: { dataObject: tbl, namespace: ns, columns: [], datasourceId: source.id },
      sink: { dataObject: tbl, namespace: sink.schema, columns: [] },
      columnMapping: {},
    })
  }
  return content
}

function generateSingleContent(opts: {
  source: { id: number; name: string; dsType: number; schema: string; table: string }
  sink: { id: number; name: string; dsType: number; schema: string; table: string }
  sourceColumns: ColumnMeta[]
  sinkColumns: ColumnMeta[]
  writeMode?: string
  outputMode?: string
  partitions?: string[]
}): Json {
  const { source, sink, sourceColumns, sinkColumns } = opts
  const writeMode = opts.writeMode || "OVERWRITE"
  const outputMode = opts.outputMode || writeMode
  const columnMapping: Record<string, string> = {}
  const minLen = Math.min(sourceColumns.length, sinkColumns.length)
  for (let i = 0; i < minLen; i++) {
    const s = colName(sourceColumns[i])
    const t = colName(sinkColumns[i])
    if (s && t) columnMapping[t] = s
  }
  return {
    templateKey: 1,
    userParams: {},
    sourceConnection: { datasourceId: source.id, datasourceName: source.name, type: source.dsType },
    sinkConnection: { datasourceId: sink.id, datasourceName: sink.name, type: sink.dsType },
    jobs: [
      {
        source: {
          dataObject: source.table,
          namespace: source.schema,
          params: { dsType: source.dsType, operatorType: "source", table: source.table, database: source.schema },
          columns: sourceColumns,
        },
        sink: {
          dataObject: sink.table,
          namespace: sink.schema,
          params: {
            dsType: sink.dsType,
            operatorType: "sink",
            table: sink.table,
            database: sink.schema,
            is_partition: false,
            writeMode,
            outputMode,
            ...(opts.partitions && opts.partitions.length ? { partitions: wrapPartitions(opts.partitions) } : {}),
          },
          columns: sinkColumns,
        },
        setting: { parallelism: 1, errorLimit: { maxCount: -1, collectDirtyData: true, record: -1 } },
        columnMapping,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Load existing integration content (probe content/dataFileContent/fileContent).
// ---------------------------------------------------------------------------
function coerceContent(obj: unknown): Json | null {
  let data = obj
  if (typeof data === "string") {
    const s = data.trim()
    if (!s) return null
    try {
      data = JSON.parse(s)
    } catch {
      return null
    }
  }
  if (data && typeof data === "object" && (data as Json).jobs) return data as Json
  return null
}

async function loadIntegrationContent(sc: StudioConfig, taskId: number): Promise<Json | null> {
  const probe = (data: Json | undefined): Json | null => {
    if (!data) return null
    for (const key of ["content", "dataFileContent", "fileContent"]) {
      const r = coerceContent(data[key])
      if (r) return r
    }
    return coerceContent(data)
  }
  const detail = await getTaskDetail(sc, taskId)
  const detailData = (detail.data && typeof detail.data === "object" ? detail.data : {}) as Json
  const fromDetail = probe(detailData)
  if (fromDetail) return fromDetail
  try {
    const cfg = await getTaskConfigDetail(sc, {
      projectId: sc.projectId,
      workspaceId: sc.workspaceId,
      dataFileId: taskId,
    })
    return probe((cfg.data && typeof cfg.data === "object" ? cfg.data : {}) as Json)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Save helpers
// ---------------------------------------------------------------------------
async function saveContent(sc: StudioConfig, taskId: number, content: Json, paramValueList: unknown[] = []): Promise<void> {
  await saveTaskContent(sc, {
    dataFileId: taskId,
    dataFileContent: content,
    projectId: sc.projectId,
    updateBy: String(sc.userId),
    instanceName: sc.instanceName,
    replaceEscapedChars: false,
    paramValueList,
  })
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------
export function registerTaskIntegrationCommands(taskYargs: Argv<GlobalArgs>): Argv<GlobalArgs> {
  return taskYargs.command("integration", "Configure data integration (offline sync) task content", (yargs) => {
    yargs
      // ── setup ─────────────────────────────────────────────────────────
      .command(
        "setup <task>",
        "Configure an integration sync task's content (single-table / multi-table / whole-db). " +
          "Create the task first with: cz-cli task create <name> --type INTEGRATION (single) or --type MULTI_DI (multi/whole_db).",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true, describe: "Task name or ID" })
            .option("sync-type", {
              type: "string",
              choices: ["single", "multi", "whole_db"],
              default: "single",
              describe: "single: one table (creates sink table + field mapping); multi: many tables; whole_db: whole database (no table creation)",
            })
            .option("source-datasource", { type: "string", demandOption: true, describe: "Source datasource name or ID" })
            .option("source-schema", { type: "string", demandOption: true, describe: "Source schema/database" })
            .option("source-table", { type: "string", describe: "[single] Source table name" })
            .option("source-tables", { type: "string", describe: "[multi] Comma-separated source table names within --source-schema" })
            .option("source-dbs", { type: "string", describe: "[whole_db] Comma-separated source schemas/databases to mirror" })
            .option("sink-datasource", { type: "string", demandOption: true, describe: "Sink datasource name or ID" })
            .option("sink-schema", { type: "string", default: "public", describe: "Sink schema (default: public)" })
            .option("sink-table", { type: "string", describe: "[single] Sink table name (default: source table name)" })
            .option("write-mode", { type: "string", choices: ["OVERWRITE", "APPEND", "UPSERT"], default: "OVERWRITE", describe: "[single] Sink write mode (default: OVERWRITE)" })
            .option("partitions", { type: "string", describe: "[single] Comma-separated sink partition expressions, e.g. 'dt=${bizdate}'. When using scheduling date/time params, look up the correct Studio param syntax first (cz-cli ai-guide / docs)." })
            .option("param-value-list", { type: "string", describe: "Scheduling parameter declarations as JSON, e.g. '[{\"paramKey\":\"bizdate\",\"paramValue\":\"$[yyyyMMdd-1]\"}]' (needed by partition/where expressions). Look up the correct Studio scheduling-param syntax first (cz-cli ai-guide / docs) — do NOT invent formats." }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const conn = resolveConnectionConfig(argv as Record<string, unknown>)
            const execOptions: Json = {}
            if (conn.vcluster) execOptions.vclusterName = conn.vcluster

            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const syncType = String(argv["sync-type"])

            const sourceDs = await resolveDatasource(sc, String(argv["source-datasource"]))
            const sinkDs = await resolveDatasource(sc, String(argv["sink-datasource"]))
            if (sourceDs.dsType === undefined || sinkDs.dsType === undefined) {
              error("INVALID_DATASOURCE", "Could not resolve datasource type. Verify the datasource names/IDs.", { format })
              return
            }
            const sourceSchema = String(argv["source-schema"])
            const sinkSchema = String(argv["sink-schema"])

            // ── multi-table / whole-db: build pipeline content, no table creation ──
            if (syncType === "multi" || syncType === "whole_db") {
              const pipelineType = syncType === "multi" ? 1 : 3
              const sourceTable = argv["source-table"] as string | undefined
              const tables =
                splitCsv(argv["source-tables"] as string | undefined).length > 0
                  ? splitCsv(argv["source-tables"] as string | undefined)
                  : sourceTable
                    ? [sourceTable]
                    : []
              const jobsSpec: [string, string][] = tables.map((t) => [sourceSchema, t])
              const dbNamespaces =
                splitCsv(argv["source-dbs"] as string | undefined).length > 0
                  ? splitCsv(argv["source-dbs"] as string | undefined)
                  : [sourceSchema]
              const content = generatePipelineContent({
                pipelineType,
                source: { id: sourceDs.id, name: sourceDs.name, dsType: sourceDs.dsType },
                sink: { id: sinkDs.id, name: sinkDs.name, dsType: sinkDs.dsType, schema: sinkSchema },
                jobsSpec,
                dbNamespaces,
              })
              await saveContent(sc, fileId, content)
              logOperation("integration setup", { ok: true })
              const kind = pipelineType === 1 ? "multi-table" : "whole-db"
              success(
                { task_id: fileId, sync_type: syncType, tables, studio_url: studioUrl(sc, fileId) },
                {
                  format,
                  aiMessage: `已创建${kind === "multi-table" ? "多表" : "整库"}同步任务（${jobsSpec.length} 张表）。集成任务执行需使用 INTEGRATION 类型的 vcluster。`,
                },
              )
              return
            }

            // ── single-table: create sink table + generate field mapping ──
            const sourceTable = argv["source-table"] as string | undefined
            if (!sourceTable) {
              error("INVALID_ARGUMENTS", "--source-table is required for single-table sync.", { format, exitCode: 2 })
              return
            }
            const sinkTable = (argv["sink-table"] as string | undefined) || sourceTable

            // Ensure sink schema, then mirror the source table on the sink.
            await ensureSchema(sc, sinkDs.id, sinkDs.dsType, sinkSchema, execOptions)
            await createSinkTableFromSource(
              sc,
              { id: sourceDs.id, dsType: sourceDs.dsType, schema: sourceSchema, table: sourceTable },
              { id: sinkDs.id, dsType: sinkDs.dsType, schema: sinkSchema, table: sinkTable },
              execOptions,
            )

            // Fetch column metadata and build a default position-based mapping.
            const meta = await getColumnMapMeta(
              sc,
              { dsType: sourceDs.dsType, id: sourceDs.id, schema: sourceSchema, table: sourceTable },
              { dsType: sinkDs.dsType, id: sinkDs.id, schema: sinkSchema, table: sinkTable },
            )
            const content = generateSingleContent({
              source: { id: sourceDs.id, name: sourceDs.name, dsType: sourceDs.dsType, schema: sourceSchema, table: sourceTable },
              sink: { id: sinkDs.id, name: sinkDs.name, dsType: sinkDs.dsType, schema: sinkSchema, table: sinkTable },
              sourceColumns: meta.source,
              sinkColumns: meta.sink,
              writeMode: argv["write-mode"] as string | undefined,
              partitions: splitCsv(argv["partitions"] as string | undefined),
            })
            const paramValueList = parseJsonArg<unknown[]>(argv["param-value-list"] as string | undefined, "param-value-list", format) ?? []
            await saveContent(sc, fileId, content, paramValueList)
            const rows = mappingToRows((content.jobs as Json[])[0].columnMapping as Record<string, string>)
            logOperation("integration setup", { ok: true })
            success(
              {
                task_id: fileId,
                sync_type: "single",
                source: `${sourceSchema}.${sourceTable}`,
                sink: `${sinkSchema}.${sinkTable}`,
                column_mapping: rows,
                studio_url: studioUrl(sc, fileId),
              },
              {
                format,
                aiMessage:
                  "已创建单表同步任务并生成默认字段映射。如需调整映射或同步参数，使用: cz-cli task integration edit <task>。集成任务执行需使用 INTEGRATION 类型的 vcluster。",
              },
            )
          } catch (err) {
            reportError(err, format)
          }
        },
      )
      // ── show ──────────────────────────────────────────────────────────
      .command(
        "show <task>",
        "Show an existing integration task's current field/table mapping and sync params",
        (y) => y.positional("task", { type: "string", demandOption: true, describe: "Task name or ID" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const content = await loadIntegrationContent(sc, fileId)
            if (!content) {
              error("NO_CONTENT", "No integration content found for this task. Configure it first via: cz-cli task integration setup", { format })
              return
            }
            const pipelineType = content.pipelineType as number | undefined
            if (pipelineType === 1 || pipelineType === 3) {
              const setting = (content.setting as Json) ?? {}
              const grouping = (setting.groupingStrategy as Json) ?? {}
              const nameRule = (content.nameRule as Json) ?? {}
              const schemaNr = (nameRule.schema as Json) ?? {}
              const tableNr = (nameRule.table as Json) ?? {}
              logOperation("integration show", { ok: true })
              success(
                {
                  task_id: fileId,
                  sync_type: pipelineType === 1 ? "multi" : "whole_db",
                  pipeline_type: pipelineType,
                  table_mapping: jobsToTableRows(content),
                  pk_write_mode: setting.pkWriteMode ?? "OVERWRITE",
                  non_pk_write_mode: setting.nonPkWriteMode ?? "OVERWRITE",
                  schema_rule: schemaNr.rule ?? "",
                  table_rule: tableNr.rule ?? "",
                  parallelism: grouping.parallelism,
                  batch_size: grouping.batchSize,
                  connections: grouping.connections,
                  studio_url: studioUrl(sc, fileId),
                },
                { format },
              )
              return
            }
            // single-table
            const jobs = (content.jobs as Json[]) ?? []
            const job0 = (jobs[0] as Json) ?? {}
            const mapping = (job0.columnMapping as Record<string, string>) ?? {}
            const setting = (job0.setting as Json) ?? {}
            const el = (setting.errorLimit as Json) ?? {}
            const srcParams = ((job0.source as Json)?.params as Json) ?? {}
            const adv = (content.advancedParamStr as KvRow[]) ?? []
            logOperation("integration show", { ok: true })
            success(
              {
                task_id: fileId,
                sync_type: "single",
                column_mapping: mappingToRows(mapping),
                parallelism: setting.parallelism ?? 1,
                error_limit: el.maxCount ?? -1,
                m_bytes: setting.mBytes ?? 1,
                split_pk: srcParams.splitPk ?? "",
                where: srcParams.where ?? "",
                advanced_params: adv,
                studio_url: studioUrl(sc, fileId),
              },
              { format },
            )
          } catch (err) {
            reportError(err, format)
          }
        },
      )
      // ── edit ──────────────────────────────────────────────────────────
      .command(
        "edit <task>",
        "Edit an existing integration task's field/table mapping and sync params (applied and saved immediately). " +
          "Use 'cz-cli task integration show <task>' first to read the current config. Does NOT change source/sink tables (use setup for that).",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true, describe: "Task name or ID" })
            // single-table
            .option("column-mapping", {
              type: "string",
              describe:
                "[single] FULL field mapping as JSON rows [{\"source\":\"id\",\"sink\":\"id\"}] — REPLACES the entire current mapping (include every row to keep)",
            })
            .option("parallelism", { type: "number", describe: "Parallelism" })
            .option("error-limit", { type: "number", describe: "[single] Error tolerance count (-1 = unlimited)" })
            .option("m-bytes", { type: "number", describe: "[single] Sync rate (mBytes)" })
            .option("split-pk", { type: "string", describe: "[single] Source split primary key (empty string clears it)" })
            .option("where", {
              type: "string",
              describe:
                "[single] Source where filter (empty string clears it). IMPORTANT: when the filter involves scheduling date/time parameters (bizdate, yyyyMMdd, monthly partition, etc.), look up the correct Studio scheduling-parameter syntax first (cz-cli ai-guide / docs) — do NOT invent parameter formats.",
            })
            .option("advanced-params", { type: "string", describe: "[single] Advanced params as JSON rows [{\"key\":\"k\",\"value\":\"v\"}] (replaces existing)" })
            .option("write-mode", { type: "string", choices: ["OVERWRITE", "APPEND", "UPSERT"], describe: "[single] Sink write mode: OVERWRITE | APPEND | UPSERT" })
            .option("partitions", { type: "string", describe: "[single] Comma-separated sink partition expressions (empty string clears), e.g. 'dt=${bizdate}'" })
            .option("param-value-list", { type: "string", describe: "Scheduling parameter declarations as JSON [{\"paramKey\":\"bizdate\",\"paramValue\":\"$[yyyyMMdd-1]\"}] (passed to save; needed by partition/where params). Look up the correct Studio scheduling-param syntax first (cz-cli ai-guide / docs) — do NOT invent formats." })
            // multi-table / whole-db
            .option("table-mapping", {
              type: "string",
              describe:
                "[multi/whole_db] FULL table mapping as JSON rows [{\"source\":\"schema.table\",\"sink\":\"schema.table\"}] — REPLACES the task's jobs",
            })
            .option("pk-write-mode", { type: "string", choices: ["OVERWRITE", "APPEND"], describe: "[multi/whole_db] PK write mode" })
            .option("non-pk-write-mode", { type: "string", choices: ["OVERWRITE", "APPEND"], describe: "[multi/whole_db] non-PK write mode" })
            .option("schema-rule", { type: "string", describe: "[multi/whole_db] sink schema naming rule, e.g. '{SOURCE_DATABASE}'" })
            .option("table-rule", { type: "string", describe: "[multi/whole_db] sink table naming rule, e.g. '{SOURCE_DATABASE}_{SOURCE_TABLE}'" })
            .option("batch-size", { type: "number", describe: "[multi/whole_db] groupingStrategy.batchSize" })
            .option("connections", { type: "number", describe: "[multi/whole_db] groupingStrategy.connections" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const content = (await loadIntegrationContent(sc, fileId)) ?? { jobs: [{ columnMapping: {} }] }

            let jobs = content.jobs as Json[]
            if (!Array.isArray(jobs) || !jobs.length) {
              jobs = [{ columnMapping: {} }]
              content.jobs = jobs
            }
            if (!jobs[0] || typeof jobs[0] !== "object") jobs[0] = { columnMapping: {} }

            const pipelineType = content.pipelineType as number | undefined

            // ── multi-table (1) / whole-db (3) ──
            if (pipelineType === 1 || pipelineType === 3) {
              const tableMapping = parseJsonArg<MappingRow[]>(argv["table-mapping"] as string | undefined, "table-mapping", format)
              const pkWriteMode = argv["pk-write-mode"] as string | undefined
              const nonPkWriteMode = argv["non-pk-write-mode"] as string | undefined
              const schemaRule = argv["schema-rule"] as string | undefined
              const tableRule = argv["table-rule"] as string | undefined
              const parallelism = argv.parallelism as number | undefined
              const batchSize = argv["batch-size"] as number | undefined
              const connections = argv.connections as number | undefined

              const hasChange =
                tableMapping !== undefined ||
                [pkWriteMode, nonPkWriteMode, schemaRule, tableRule, parallelism, batchSize, connections].some(
                  (v) => v !== undefined,
                )
              if (!hasChange) {
                error("INVALID_ARGUMENTS", "Provide at least one field to change. See 'cz-cli task integration edit --help'.", { format, exitCode: 2 })
                return
              }

              const setting = (content.setting && typeof content.setting === "object" ? content.setting : {}) as Json
              content.setting = setting
              if (pkWriteMode === "OVERWRITE" || pkWriteMode === "APPEND") setting.pkWriteMode = pkWriteMode
              if (nonPkWriteMode === "OVERWRITE" || nonPkWriteMode === "APPEND") setting.nonPkWriteMode = nonPkWriteMode
              const gs = (setting.groupingStrategy && typeof setting.groupingStrategy === "object" ? setting.groupingStrategy : {}) as Json
              setting.groupingStrategy = gs
              for (const [key, val] of [["parallelism", parallelism], ["batchSize", batchSize], ["connections", connections]] as const) {
                const iv = toInt(val)
                if (iv !== undefined) gs[key] = iv
              }
              // Naming rules: empty values do not overwrite (rules are usually required).
              if (schemaRule || tableRule) {
                const nr = (content.nameRule && typeof content.nameRule === "object" ? content.nameRule : {}) as Json
                content.nameRule = nr
                if (schemaRule) {
                  const sn = (nr.schema && typeof nr.schema === "object" ? nr.schema : {}) as Json
                  nr.schema = sn
                  sn.rule = schemaRule
                }
                if (tableRule) {
                  const tn = (nr.table && typeof nr.table === "object" ? nr.table : {}) as Json
                  nr.table = tn
                  tn.rule = tableRule
                }
              }
              if (tableMapping && tableMapping.length) {
                const newJobs = rebuildJobsFromTableRows(content, tableMapping)
                if (newJobs.length) content.jobs = newJobs
              }

              // Pre-save validation (non-blocking).
              const jobsNow = (content.jobs as Json[]) ?? []
              const tableInfo = jobsNow
                .filter((j) => j && typeof j === "object" && (j.source as Json)?.dataObject)
                .map((j) => ({ schema: (j.source as Json).namespace as string, table: (j.source as Json).dataObject as string }))
              const warning = await pipelineCheckTables(sc, fileId, tableInfo, pipelineType)

              await saveContent(sc, fileId, content)
              logOperation("integration edit", { ok: true })
              success(
                {
                  task_id: fileId,
                  sync_type: pipelineType === 1 ? "multi" : "whole_db",
                  table_mapping: jobsToTableRows(content),
                  studio_url: studioUrl(sc, fileId),
                  ...(warning ? { validation_warning: warning } : {}),
                },
                { format, aiMessage: warning ? `已更新（校验提示：${warning}）` : "已更新集成任务参数" },
              )
              return
            }

            // ── single-table ──
            const columnMapping = parseJsonArg<MappingRow[]>(argv["column-mapping"] as string | undefined, "column-mapping", format)
            const advancedParams = parseJsonArg<KvRow[]>(argv["advanced-params"] as string | undefined, "advanced-params", format)
            const parallelism = argv.parallelism as number | undefined
            const errorLimit = argv["error-limit"] as number | undefined
            const mBytes = argv["m-bytes"] as number | undefined
            const splitPk = argv["split-pk"] as string | undefined
            const where = argv.where as string | undefined
            const writeMode = argv["write-mode"] as string | undefined
            const partitionsArg = argv["partitions"] as string | undefined
            const paramValueList = parseJsonArg<unknown[]>(argv["param-value-list"] as string | undefined, "param-value-list", format)

            const hasChange =
              columnMapping !== undefined ||
              advancedParams !== undefined ||
              partitionsArg !== undefined ||
              paramValueList !== undefined ||
              [parallelism, errorLimit, mBytes, splitPk, where, writeMode].some((v) => v !== undefined)
            if (!hasChange) {
              error("INVALID_ARGUMENTS", "Provide at least one field to change. See 'cz-cli task integration edit --help'.", { format, exitCode: 2 })
              return
            }

            const job0 = jobs[0] as Json
            const currentMapping = (job0.columnMapping as Record<string, string>) ?? {}
            const mapping = columnMapping !== undefined ? normalizeColumnMapping(columnMapping) ?? {} : { ...currentMapping }

            // Rebuild source/sink columns to match the mapping, preserving archived column metadata.
            const byName = (cols: ColumnMeta[] | undefined): Record<string, ColumnMeta> => {
              const out: Record<string, ColumnMeta> = {}
              for (const c of cols ?? []) {
                const n = colName(c)
                if (n) out[n] = c
              }
              return out
            }
            const origSource = byName((job0.source as Json)?.columns as ColumnMeta[])
            const origSink = byName((job0.sink as Json)?.columns as ColumnMeta[])
            const newSourceCols: ColumnMeta[] = []
            const newSinkCols: ColumnMeta[] = []
            for (const [sinkCol, sourceCol] of Object.entries(mapping)) {
              newSinkCols.push(origSink[sinkCol] ?? { name: sinkCol })
              newSourceCols.push(origSource[sourceCol] ?? { name: sourceCol })
            }
            const source = (job0.source && typeof job0.source === "object" ? job0.source : {}) as Json
            const sink = (job0.sink && typeof job0.sink === "object" ? job0.sink : {}) as Json
            job0.source = source
            job0.sink = sink
            source.columns = newSourceCols
            sink.columns = newSinkCols
            job0.columnMapping = mapping

            // setting: parallelism / mBytes / errorLimit
            const setting = (job0.setting && typeof job0.setting === "object" ? job0.setting : {}) as Json
            job0.setting = setting
            const pv = toInt(parallelism)
            if (pv !== undefined) setting.parallelism = pv
            const mv = toInt(mBytes)
            if (mv !== undefined) setting.mBytes = mv
            const ev = toInt(errorLimit)
            if (ev !== undefined) {
              const elc = (setting.errorLimit && typeof setting.errorLimit === "object" ? setting.errorLimit : {}) as Json
              setting.errorLimit = elc
              elc.maxCount = ev
              elc.record = ev
              if (elc.collectDirtyData === undefined) elc.collectDirtyData = true
            }

            // source.params: splitPk / where
            const sp = (source.params && typeof source.params === "object" ? source.params : {}) as Json
            source.params = sp
            if (splitPk !== undefined) {
              if (splitPk) sp.splitPk = splitPk
              else delete sp.splitPk
            }
            if (where !== undefined) {
              if (where) sp.where = where
              else delete sp.where
            }

            // sink.params: write mode + partitions
            const sinkParams = (sink.params && typeof sink.params === "object" ? sink.params : {}) as Json
            sink.params = sinkParams
            if (writeMode) {
              sinkParams.writeMode = writeMode
              sinkParams.outputMode = writeMode
            }
            if (partitionsArg !== undefined) {
              const parts = splitCsv(partitionsArg)
              if (parts.length) sinkParams.partitions = wrapPartitions(parts)
              else delete sinkParams.partitions
            }

            // advanced params
            if (advancedParams !== undefined) {
              content.advancedParamStr = (advancedParams ?? [])
                .filter((r) => r && typeof r === "object" && (r.key ?? "").trim())
                .map((r) => ({ key: r.key, value: r.value }))
            }

            await saveContent(sc, fileId, content, paramValueList ?? [])
            logOperation("integration edit", { ok: true })
            success(
              {
                task_id: fileId,
                sync_type: "single",
                column_mapping: mappingToRows(mapping),
                studio_url: studioUrl(sc, fileId),
              },
              { format, aiMessage: "已更新集成任务" },
            )
          } catch (err) {
            reportError(err, format)
          }
        },
      )
    return commandGroup(yargs, "task integration")
  })
}

async function ctx(argv: Record<string, unknown>): Promise<StudioConfig> {
  return getStudioContext(argv)
}
