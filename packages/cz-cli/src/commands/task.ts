import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import { readFileSync } from "node:fs"
import {
  listTasks, createTask, getTaskDetail, getTaskConfigDetail,
  saveTaskContent, saveTaskConfig, submitTask, onlineTask, offlineTask,
  offlineTaskWithDownstream, deleteTask, deleteFolder,
   listFolders, createFolder,
  executeAdhoc, getRunDetail,
  getFlowDag, createFlowNode, bindFlowNode, unbindFlowNode,
  removeFlowNode, submitFlow, listFlowInstances,
  saveFlowNodeContent, getFlowNodeDetail, saveFlowNodeConfig,
  getInstanceStats, getTaskRunStats,
  getAllDownstream, previewScheduleInstanceTimes,
  saveCdcTask,
  startCdcTask,
  stopCdcTask,
  getCdcTaskRunStatus,
  startRealtimeTask,
  stopRealtimeTask,
  listPgSlots,
  listPgPublications,
  resolveVclusterId,
  studioRequest,
  type StudioConfig,
} from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error, handledError, isHandledCliError } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getStudioContext } from "./studio-context.js"
import { confirm } from "../confirm.js"
import { resolveTaskId, resolveNodeId, resolveFolderIdByName } from "../resolver.js"
import { studioUrl } from "./studio-url.js"
import { normalizeTaskIdentity } from "../identity.js"
import { t } from "../locale.js"
import { resolveConnectionConfig } from "../connection/config.js"
import { resolveDatasource } from "./datasource.js"
import { convertAgentCron } from "../cron-adapter.js"

function formatIsoStartOfDay(value: string | undefined | null): string {
  if (!value) return new Date().toISOString().slice(0, 10) + "T00:00:00.000Z"
  const trimmed = String(value).trim()
  // Already ISO with time? strip time to start of day
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10) + "T00:00:00.000Z"
  return trimmed
}



const TASK_TYPE_MAP: Record<string, number> = {
  SQL: 4, LAKEHOUSE: 4, PYTHON: 7, SHELL: 5, JDBC: 15,
  SPARK: 400, FLOW: 500, INTEGRATION: 1, DI: 1,
  REALTIME: 14, CDC: 14, DYNAMIC_TABLE: 16, DT: 16,
  STREAMING: 17, CONTINUOUS: 17,
  FULL_INCREMENTAL: 280, MULTI_REALTIME: 281, MULTI_DI: 291,
  DATABRICKS_SQL: 300, DATABRICKS_NOTEBOOK: 301,
  VIRTUAL: 0,
}

function parseTaskType(value: string): number {
  const upper = value.toUpperCase()
  if (upper in TASK_TYPE_MAP) return TASK_TYPE_MAP[upper]
  const n = parseInt(value, 10)
  if (!isNaN(n)) return n
  throw new Error(`Unsupported task type: ${value}. Use SQL/PYTHON/SHELL/SPARK/FLOW or integer code.`)
}

const UI_ONLY_TYPES = new Set([400, 500, 1, 14, 16, 17, 280, 281, 291, 300, 301])

const SYSTEM_PARAM_NAMES = new Set([
  "bizdate", "sys_biz_day", "sys_biz_datetime",
  "sys_plan_day", "sys_plan_datetime", "sys_plan_timestamp",
  "sys_task_id", "sys_task_name", "sys_task_owner",
])

function inferParamType(value: string): "manual" | "system" {
  if (value.startsWith("$[")) return "system"
  if (SYSTEM_PARAM_NAMES.has(value)) return "system"
  return "manual"
}

function parseParamValueList(raw: string): unknown[] | null {
  const cleaned = raw.replace(/^'|'$/g, "")
  const tryJson = (): Record<string, string> | null => {
    try { return JSON.parse(cleaned) } catch { return null }
  }
  const tryRelaxed = (): Record<string, string> | null => {
    const relaxed = cleaned.replace(/^\{|\}$/g, "").trim()
    if (!relaxed) return null
    const pairs = relaxed.split(",").map((pair) => {
      const idx = pair.indexOf(":")
      if (idx <= 0) return null
      return [pair.slice(0, idx).trim().replace(/^["']|["']$/g, ""), pair.slice(idx + 1).trim().replace(/^["']|["']$/g, "")] as [string, string]
    })
    if (pairs.some((p) => p === null)) return null
    return Object.fromEntries(pairs as [string, string][])
  }
  const parsed = tryJson() ?? tryRelaxed()
  if (!parsed) return null
  return Object.entries(parsed).map(([k, v], i) => ({
    encrypt: false,
    id: String(Date.now() + i),
    ignore: false,
    paramKey: k,
    paramType: inferParamType(v),
    paramValue: v,
    ref: 0,
  }))
}

async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let idx = 0
  const worker = async (): Promise<void> => {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

// CDC prerequisite check helper — returns { ok, message } without throwing
async function checkCdcPrereqs(
  sc: StudioConfig,
  ds: { id: number; name: string; dsType: number },
  sourceArg: string,
): Promise<{ ok: boolean; message: string }> {
  const MYSQL_LIKE = new Set([5, 17, 18, 19, 39])
  const PG_LIKE    = new Set([7, 22, 40, 46, 48])
  const SS_LIKE    = new Set([8])
  const DM_LIKE    = new Set([26])

  const dsType = ds.dsType

  if (MYSQL_LIKE.has(dsType)) {
    const r = await studioRequest(sc, "/ide-authority/v1/projectDataSources/getSampleData", {
      id: ds.id, nameSpace: "performance_schema", dataObjectName: "global_variables",
      options: { dsType, where: "VARIABLE_NAME IN ('log_bin','binlog_format','binlog_row_image')" },
    }).catch(() => null)
    const data = (r as { data?: { fieldNames?: string[]; rows?: unknown[][] } } | null)?.data
    const nameIdx = data?.fieldNames?.findIndex(f => f.toUpperCase() === "VARIABLE_NAME") ?? 0
    const valIdx  = data?.fieldNames?.findIndex(f => f.toUpperCase() === "VARIABLE_VALUE") ?? 1
    const varMap: Record<string, string> = {}
    for (const row of data?.rows ?? []) {
      varMap[String((row as unknown[])[nameIdx] ?? "").toLowerCase()] = String((row as unknown[])[valIdx] ?? "")
    }
    const failed: string[] = []
    if ((varMap["log_bin"] ?? "").toUpperCase() !== "ON") failed.push("log_bin must be ON (add log_bin=ON to my.cnf and restart)")
    if ((varMap["binlog_format"] ?? "").toUpperCase() !== "ROW") failed.push("SET GLOBAL binlog_format = 'ROW'")
    if ((varMap["binlog_row_image"] ?? "").toUpperCase() !== "FULL") failed.push("SET GLOBAL binlog_row_image = 'FULL'")
    if (failed.length > 0) return { ok: false, message: `MySQL CDC prerequisites not met for '${ds.name}':\n${failed.join("\n")}\n\nRun 'cz-cli datasource check-cdc ${sourceArg}' for details. Use --skip-check to bypass.` }
    return { ok: true, message: "" }
  }

  if (PG_LIKE.has(dsType)) {
    const walR = await studioRequest(sc, "/ide-authority/v1/projectDataSources/getSampleData", {
      id: ds.id, nameSpace: "pg_catalog", dataObjectName: "pg_settings",
      options: { dsType, where: "name = 'wal_level'" },
    }).catch(() => null)
    const walData = (walR as { data?: { fieldNames?: string[]; rows?: unknown[][] } } | null)?.data
    const si = walData?.fieldNames?.findIndex(f => f.toLowerCase() === "setting") ?? 1
    const walLevel = walData?.rows?.[0] ? String((walData.rows[0] as unknown[])[si]) : ""
    const slotR = await listPgSlots(sc, [ds.id]).catch(() => null)
    const slots = slotR?.data?.find(s => s.datasourceId === ds.id)?.pipelineSlotMetaVos ?? []
    const failed: string[] = []
    if (walLevel !== "logical") failed.push(`wal_level must be 'logical' (current: '${walLevel || "unknown"}') — set in postgresql.conf and restart`)
    if (slots.length === 0) failed.push("No replication slot found — run: SELECT pg_create_logical_replication_slot('slot_name', 'pgoutput')")
    if (failed.length > 0) return { ok: false, message: `PostgreSQL CDC prerequisites not met for '${ds.name}':\n${failed.join("\n")}\n\nRun 'cz-cli datasource check-cdc ${sourceArg}' for details. Use --skip-check to bypass.` }
    return { ok: true, message: "" }
  }

  // SQL Server — not tested, based on standard SQL Server CDC docs
  if (SS_LIKE.has(dsType)) {
    const dbR = await studioRequest(sc, "/ide-authority/v1/projectDataSources/getSampleData", {
      id: ds.id, nameSpace: "master", dataObjectName: "sys.databases",
      options: { dsType, where: "name = DB_NAME()" },
    }).catch(() => null)
    const dbData = (dbR as { data?: { fieldNames?: string[]; rows?: unknown[][] } } | null)?.data
    const cdcIdx = dbData?.fieldNames?.findIndex(f => f.toLowerCase() === "is_cdc_enabled") ?? -1
    const isCdcEnabled = cdcIdx >= 0 && dbData?.rows?.[0]
      ? String((dbData.rows[0] as unknown[])[cdcIdx]) === "1"
      : false
    const agentR = await studioRequest(sc, "/ide-authority/v1/projectDataSources/getSampleData", {
      id: ds.id, nameSpace: "master", dataObjectName: "sys.dm_server_services",
      options: { dsType, where: "servicename LIKE 'SQL Server Agent%'" },
    }).catch(() => null)
    const agentData = (agentR as { data?: { fieldNames?: string[]; rows?: unknown[][] } } | null)?.data
    const stIdx = agentData?.fieldNames?.findIndex(f => f.toLowerCase() === "status_desc") ?? -1
    const agentStatus = stIdx >= 0 && agentData?.rows?.[0] ? String((agentData.rows[0] as unknown[])[stIdx]) : "UNKNOWN"
    const failed: string[] = []
    if (!isCdcEnabled) failed.push("Enable CDC: EXEC sys.sp_cdc_enable_db")
    if (agentStatus.toLowerCase() !== "running") failed.push(`SQL Server Agent must be Running (current: ${agentStatus}) — start the service`)
    if (failed.length > 0) return { ok: false, message: `SQL Server CDC prerequisites not met for '${ds.name}':\n${failed.join("\n")}\n\nRun 'cz-cli datasource check-cdc ${sourceArg}' for details. Use --skip-check to bypass.` }
    return { ok: true, message: "" }
  }

  // DM 达梦 — not tested, based on standard DM CDC docs
  if (DM_LIKE.has(dsType)) {
    const dbR = await studioRequest(sc, "/ide-authority/v1/projectDataSources/getSampleData", {
      id: ds.id, nameSpace: "SYS", dataObjectName: "V$DATABASE",
      options: { dsType },
    }).catch(() => null)
    const dbData = (dbR as { data?: { fieldNames?: string[]; rows?: unknown[][] } } | null)?.data
    const archIdx = dbData?.fieldNames?.findIndex(f => f.toUpperCase() === "ARCH_MODE") ?? -1
    const archMode = archIdx >= 0 && dbData?.rows?.[0] ? String((dbData.rows[0] as unknown[])[archIdx]) : "UNKNOWN"
    const suppIdx = dbData?.fieldNames?.findIndex(f => f.toUpperCase() === "SUPPLEMENTAL_LOG_DATA_MIN") ?? -1
    const suppLog = suppIdx >= 0 && dbData?.rows?.[0] ? String((dbData.rows[0] as unknown[])[suppIdx]) : "UNKNOWN"
    const failed: string[] = []
    if (archMode !== "1") failed.push(`ARCH_MODE must be 1 (current: ${archMode}) — ALTER DATABASE MOUNT; ALTER DATABASE ARCHIVELOG; ALTER DATABASE OPEN;`)
    if (suppLog.toUpperCase() !== "YES") failed.push(`Supplemental logging must be enabled (current: ${suppLog}) — ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;`)
    if (failed.length > 0) return { ok: false, message: `DM CDC prerequisites not met for '${ds.name}':\n${failed.join("\n")}\n\nRun 'cz-cli datasource check-cdc ${sourceArg}' for details. Use --skip-check to bypass.` }
    return { ok: true, message: "" }
  }

  return { ok: true, message: "" } // other types: no check needed
}

async function autoResolveLakehouseDs(sc: StudioConfig): Promise<{ id: number; name: string } | null> {
  const resp = await studioRequest<{ list?: unknown[] }>(sc, "/ide-authority/v1/projectDataSources/list", {
    current: 1, pageSize: 50, status: 1, pageIndex: 1, dsType: 1, projectName: sc.workspaceName,
  })
  const list = (resp.data as Record<string, unknown>)?.list as Record<string, unknown>[] | undefined ?? []
  if (list.length === 0) return null
  // Prefer datasource whose name contains the workspace name (e.g. LAKEHOUSE_quick_start for workspace quick_start)
  const wsName = sc.workspaceName?.toLowerCase() ?? ""
  const match = list.find((ds) => String(ds.dsName ?? "").toLowerCase().includes(wsName))
    ?? list.find((ds) => String(ds.dsName ?? "").toUpperCase().startsWith("LAKEHOUSE_"))
    ?? list[0]
  return { id: Number(match.id), name: String(match.dsName ?? "LAKEHOUSE") }
}

async function isUiOnlyTask(sc: StudioConfig, fileId: number): Promise<boolean> {
  const detail = await getTaskDetail(sc, fileId)
  const data = detail.data as Record<string, unknown> | undefined
  const fileType = Number(data?.fileType ?? data?.file_type ?? 0)
  return UI_ONLY_TYPES.has(fileType)
}

function normalizeCron(value: string): string {
  const parts = value.split(/\s+/)
  if (parts.length === 5) {
    const [min, hr, day, month, week] = parts
    return `0 ${min} ${hr} ${day} ${month} ${week === "*" ? "?" : week} *`
  }
  if (parts.length === 6) return parts.join(" ") + " *"
  if (parts.length === 7) return parts.join(" ")
  throw new Error("Cron expression must have 5, 6, or 7 fields.")
}

function normalizeScheduleClock(value: string, label: string): string {
  const m = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) throw new Error(`Invalid ${label} format: '${value}'. Expected HH:MM.`)
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (h > 23 || min > 59) throw new Error(`Invalid ${label} value: '${value}'. Hours must be 0-23, minutes 0-59.`)
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
}

async function ctx(argv: Record<string, unknown>): Promise<StudioConfig> {
  return getStudioContext(argv)
}

function reportTaskError(err: unknown, format: string | undefined): void {
  if (isHandledCliError(err)) return
  error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
}

function parseDependencyTasks(raw: string, format: string | undefined, projectId: number): Record<string, unknown>[] {
  const cleaned = raw.replace(/^'|'$/g, "")
  let parsed: Record<string, unknown>[]
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    try {
      const fixed = cleaned.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":').replace(/:\s*([^",\}\]]+)/g, (_, v) => `:"${v.trim()}"`)
      parsed = JSON.parse(fixed)
    } catch {
      handledError("INVALID_ARGUMENTS", `--dep-tasks is not valid JSON: ${raw}`, { format })
    }
  }
  return parsed.map((item, index) => {
    const fileId = item.taskId ?? item.dependency_task_id ?? item.dependencyFileId
    const fileName = item.taskName ?? item.dependency_task_name ?? item.dependencyFileName
    if (!fileId) handledError("INVALID_ARGUMENTS", `--dep-tasks[${index}]: taskId is required`, { format })
    if (!fileName) handledError("INVALID_ARGUMENTS", `--dep-tasks[${index}]: taskName is required`, { format })
    return {
      parseType: "1",
      dependencyProjectId: projectId,
      depStrategy: item.dep_strategy ?? item.depStrategy ?? 0,
      dependencyFileId: fileId,
      dependencyFileName: fileName,
    }
  })
}

// ---------------------------------------------------------------------------
// Field converter — mirrors MCP server convertTaskDetailFields
// ---------------------------------------------------------------------------
const FILE_TYPE_TO_TASK_TYPE: Record<number, number> = {
  0: 0, 1: 10, 4: 23, 5: 24, 7: 26, 14: 28, 15: 29, 16: 30, 17: 31,
  280: 280, 281: 281, 291: 291, 300: 300, 301: 301, 400: 400, 500: 500,
}

const TASK_DETAIL_FIELDS: Record<string, string> = {
  id: "task_id", tenantId: "tenant_id", userId: "user_id", projectId: "project_id",
  location: "location", dataFolderId: "folder_id", dataFileName: "task_name",
  ownerCnName: "owner_cn_name", ownerEnName: "owner_en_name",
  lastEditTime: "last_edit_time", lastEditUser: "last_edit_user",
  createdBy: "created_by", createdTime: "created_time",
  updatedBy: "updated_by", updatedTime: "updated_time", lockTime: "lock_time",
  fileFlowStatus: "task_edit_state", showFileStatusName: "show_file_status_name",
  lockUserName: "lock_user_name", hasConfig: "has_config",
  currentVersion: "current_version", fileContent: "task_content",
  fileDescription: "task_description", paramValueList: "param_value_list",
  executeParam: "execute_param", workspaceId: "workspace_id",
  defaultSchemaName: "default_schema_name", defaultVcName: "default_vc_name",
  datasourceId: "datasource_id", dsType: "ds_type",
  sessionSchemaName: "session_schema_name", cdcTaskId: "cdc_task_id",
  groupId: "group_id", instanceName: "instance_name",
  multiDataSource: "multi_data_source", nodeId: "node_id",
  adhocConfigs: "adhoc_configs",
  fileCreateType: "file_create_type", fileStatus: "file_status",
  deployStatus: "deploy_status", isLock: "is_lock",
}

function convertTaskFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (k in TASK_DETAIL_FIELDS) {
      out[TASK_DETAIL_FIELDS[k]!] = v
    } else if (k === "fileType") {
      out["task_type"] = FILE_TYPE_TO_TASK_TYPE[v as number] ?? v
    }
  }
  return out
}

const CONFIG_DETAIL_FIELDS: Record<string, string> = {
  projectId: "project_id", dataFileId: "task_id", dataFileVersion: "data_file_version",
  retryIntervalTime: "retry_interval_time", retryIntervalTimeUnit: "retry_interval_time_unit",
  retryCount: "retry_count", rerunProperty: "rerun_property", selfDependsJob: "self_depends_job",
  cronExpress: "cron_express", activeStartTime: "active_start_time", activeEndTime: "active_end_time",
  schemaName: "schema_name", etlVcCode: "etl_vc_code", etlVcId: "etl_vc_id",
  executeTimeout: "execute_timeout", executeTimeoutUnit: "execute_timeout_unit",
  taskPriority: "task_priority", triggerType: "trigger_type",
  scheduleRateType: "schedule_rate_type", scheduleConfigType: "schedule_config_type",
  configProperties: "config_properties",
}

function convertConfigFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (k in CONFIG_DETAIL_FIELDS) {
      out[CONFIG_DETAIL_FIELDS[k]!] = v
    } else if (k === "fileType") {
      out["task_type"] = FILE_TYPE_TO_TASK_TYPE[v as number] ?? v
    }
  }
  // Parse configProperties JSON string
  const raw = out["config_properties"]
  if (typeof raw === "string") {
    try { out["config_properties"] = JSON.parse(raw) } catch { /* keep as string */ }
  }
  // Convert dependencies
  const deps = data.dataFileDependencyDTOS
  if (Array.isArray(deps)) {
    out["task_dependencies"] = deps.map((d: unknown) => {
      const dep = d as Record<string, unknown>
      return {
        dependency_task_id: dep.dependencyFileId ?? dep.dataFileId,
        dependency_task_name: dep.dependencyFileName ?? dep.dataFileName,
        dep_strategy: dep.depStrategy ?? 0,
      }
    })
  }
  return out
}

export function registerTaskCommand(cli: Argv<GlobalArgs>): void {
  cli.command("task", "Manage Studio tasks", (yargs) => {
    yargs
      .command(
        "list",
        "List tasks",
        (y) =>
          y
            .option("page", { type: "number", default: 1 })
            .option("page-size", { type: "number", default: 10 })
            .option("limit", { type: "number", describe: "Alias of --page-size" })
            .option("parent", { type: "number", describe: "Folder ID filter" })
            .option("folder", { type: "number", describe: "Folder ID filter (alias of --parent)", hidden: true })
            .option("folder-id", { type: "number", describe: "Folder ID filter (alias of --parent)", hidden: true })
            .option("like", { type: "string", describe: "Task name filter" })
            .option("name", { type: "string", describe: "Task name filter (alias of --like)", hidden: true })
            .option("type", {
              type: "string",
              describe:
                "Task type: SQL, PYTHON, SHELL, JDBC, FLOW, INTEGRATION, REALTIME, VIRTUAL, FULL_INCREMENTAL, MULTI_REALTIME, MULTI_DI",
            }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileType = argv.type ? String(parseTaskType(argv.type)) : undefined
            const pageSize = argv.limit ?? argv["page-size"]
            const folderId = argv.parent ?? argv.folder ?? argv["folder-id"]
            const fileName = argv.like ?? argv.name
            const resp = await listTasks(sc, {
              projectId: sc.projectId,
              page: argv.page,
              pageSize,
              folderId,
              fileName,
              fileType,
            })
            const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
            const tasks = (Array.isArray(data.list) ? (data.list as Record<string, unknown>[]) : []).map(
              convertTaskFields,
            )
            const total = data.total as number | undefined
            const totalPages = data.totalPages as number | undefined
            const aiMessage =
              `当前仅展示第 ${argv.page} 页` +
              (total != null ? `（${tasks.length} 条 / 共 ${total} 条，共 ${totalPages} 页）` : "") +
              `。如需下一页，请执行: cz-cli task list --page ${(argv.page as number) + 1} --page-size ${pageSize}`
            logOperation("task list", { ok: true })
            success(tasks, {
              format,
              aiMessage,
              extra: { pagination: { page: argv.page, page_size: pageSize, total, total_pages: totalPages } },
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "list-folders",
        "List task folders",
        (y) =>
          y
            .option("page", { type: "number", default: 1 })
            .option("page-size", { type: "number", default: 10 })
            .option("parent", { type: "number", default: 0, describe: "Parent folder ID" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const resp = await listFolders(sc, {
              projectId: sc.projectId,
              page: argv.page,
              pageSize: argv["page-size"],
              parentFolderId: argv.parent,
            })
            const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
            const items = Array.isArray(data.list) ? (data.list as unknown[]) : []
            const total = data.total as number | undefined
            const totalPages = data.totalPages as number | undefined
            const aiMessage =
              `当前仅展示第 ${argv.page} 页` +
              (total != null ? `（${items.length} 条 / 共 ${total} 条，共 ${totalPages} 页）` : "") +
              `。可使用 --page 和 --page-size 翻页。`
            logOperation("task list-folders", { ok: true })
            success(items, {
              format,
              aiMessage,
              extra: { pagination: { page: argv.page, page_size: argv["page-size"], total, total_pages: totalPages } },
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "folder-tree",
        "Show full folder hierarchy as a tree (use this to find the right folder before creating a task)",
        (y) => y.option("parent", { type: "number", default: 0, describe: "Root folder ID (0 = workspace root)" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)

            // BFS to build full tree
            interface FolderNode { id: number; name: string; path: string; children: FolderNode[] }
            const buildTree = async (parentId: number, parentPath: string): Promise<FolderNode[]> => {
              const resp = await listFolders(sc, { projectId: sc.projectId, page: 1, pageSize: 500, parentFolderId: parentId })
              const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
              const folders = Array.isArray(data.list) ? data.list as Record<string, unknown>[] : []
              return Promise.all(folders.map(async (f) => {
                const id = Number(f.id ?? f.dataFolderId)
                const name = String(f.dataFolderName ?? f.folderName ?? id)
                const path = parentPath ? `${parentPath}/${name}` : name
                const children = f.hasChildren ? await buildTree(id, path) : []
                return { id, name, path, children }
              }))
            }

            const tree = await buildTree(argv.parent as number, "")

            // Flatten to list with indent for readability
            const flatten = (nodes: FolderNode[], depth: number): { id: number; name: string; path: string; indent: string }[] =>
              nodes.flatMap((n) => [
                { id: n.id, name: n.name, path: n.path, indent: "  ".repeat(depth) + (depth > 0 ? "└─ " : "") },
                ...flatten(n.children, depth + 1),
              ])

            const flat = flatten(tree, 0)
            logOperation("task folder-tree", { ok: true })
            const aiMsg = flat.length > 0
              ? `Found ${flat.length} folder(s). Use the 'id' or 'name' field with --folder when creating tasks. Example: cz-cli task create <name> --type SQL --folder <id>`
              : "No folders found. Either no folders exist in this workspace yet, or your account may lack folder read permissions. " +
                "You can: (1) create a folder first with 'cz-cli task create-folder <name>', or (2) create a task in root with '--folder 0' (not recommended)."
            success(flat, {
              format,
              aiMessage: aiMsg,
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "create <name>",
        "Create a SQL/Python/Shell script task",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .option("type", {
              type: "string",
              demandOption: true,
              describe:
                'Available options: SQL, PYTHON, SHELL, JDBC, FLOW, INTEGRATION, REALTIME, VIRTUAL, FULL_INCREMENTAL, MULTI_REALTIME, MULTI_DI"',
            })
            .option("folder", { type: "string", describe: "Folder ID or name (required; root directory not allowed)" })
            .option("description", { type: "string", describe: "Task description" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const folderRaw = (argv.folder as string | undefined)?.trim()
            if (!folderRaw) {
              error("INVALID_ARGUMENTS", "Missing required option: --folder. Run 'cz-cli task folder-tree' to see available folders and their IDs, then pass the correct folder with --folder <id_or_name>.", { format, exitCode: 2 }); return
            }
            const folderId = /^\d+$/.test(folderRaw)
              ? parseInt(folderRaw, 10)
              : await resolveFolderIdByName(sc, folderRaw, format)
            if (folderId === 0) {
              process.stderr.write("Warning: creating task in root directory. Consider using a subfolder to keep the workspace organized.\n")
            }
            // Check for duplicate name in the same folder
            const existing = await listTasks(sc, { projectId: sc.projectId, page: 1, pageSize: 50, folderId, fileName: argv.name as string })
            const existingData = (existing.data && typeof existing.data === "object" ? existing.data : {}) as Record<string, unknown>
            const existingList = Array.isArray(existingData.list) ? existingData.list as Record<string, unknown>[] : []
            const duplicate = existingList.find((t) => String(t.dataFileName ?? t.fileName ?? "") === argv.name)
            if (duplicate) {
              error("DUPLICATE_TASK", `Task '${argv.name}' already exists in this folder (task_id=${duplicate.id ?? duplicate.task_id}). Use a different name or delete the existing task first.`, { format, exitCode: 2 }); return
            }
            const resp = await createTask(sc, {
              fileType: String(parseTaskType(argv.type as string)),
              createdBy: String(sc.userId),
              projectId: sc.projectId,
              dataFileName: argv.name as string,
              fileDescription: argv.description,
              dataFolderId: folderId,
              workspaceName: sc.workspaceName,
            })
            logOperation("task create", { ok: true })
            const data = resp.data as Record<string, unknown> | undefined
            const newFileId = Number(data)
            const url = newFileId ? studioUrl(sc, newFileId) : undefined
            success({ id: data, studio_url: url }, { format })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "create-realtime-sync <name>",
        "Create a multi-table realtime CDC sync task (MULTI_REALTIME) — one step: prereq check + create + configure",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true, describe: "Task name" })
            .option("folder", { type: "string", demandOption: true, describe: "Folder ID or name" })
            .option("source", { type: "string", demandOption: true, describe: "Source datasource name or ID" })
            .option("database", { type: "string", demandOption: true, describe: "Source database/schema to sync" })
            .option("tables", { type: "string", describe: "Comma-separated table names. Omit for whole-database mirror." })
            .option("target", { type: "string", describe: "Target Lakehouse datasource name or ID (auto-resolves if omitted)" })
            .option("vc", { type: "string", describe: "Virtual cluster name for CDC execution" })
            .option("slot-name", { type: "string", describe: "PostgreSQL replication slot name (auto-detected if omitted)" })
            .option("logic-plugin", { type: "string", default: "pgoutput", describe: "PostgreSQL logical replication plugin (default: pgoutput)" })
            .option("pipeline-type", {
              type: "number", default: 3,
              describe: "1=multi-table mirror (specific tables), 2=multi-table merge, 3=whole-database mirror (default)",
            })
            .option("sync-mode", {
              type: "number", default: 1,
              describe: "1=full+incremental (default), 2=incremental only",
            })
            .option("skip-check", { type: "boolean", default: false, describe: "Skip CDC prerequisite check" })
            .option("description", { type: "string", describe: "Task description" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)

            // Step 1: resolve source datasource
            const sourceDs = await resolveDatasource(sc, String(argv.source))
            if (!sourceDs.dsType) {
              error("INVALID_ARGUMENTS", `Cannot determine dsType for source datasource '${argv.source}'.`, { format, exitCode: 2 }); return
            }

            // Step 2: CDC prerequisite check (before creating anything)
            if (!(argv["skip-check"] as boolean)) {
              const check = await checkCdcPrereqs(sc, sourceDs as { id: number; name: string; dsType: number }, String(argv.source))
              if (!check.ok) { error("CDC_PREREQ_FAILED", check.message, { format, exitCode: 2 }); return }
            }

            // Step 3: resolve folder
            const folderRaw = (argv.folder as string).trim()
            const folderId = /^\d+$/.test(folderRaw)
              ? parseInt(folderRaw, 10)
              : await resolveFolderIdByName(sc, folderRaw, format)

            // Step 4: check duplicate name
            const existing = await listTasks(sc, { projectId: sc.projectId, page: 1, pageSize: 50, folderId, fileName: argv.name as string })
            const existingData = (existing.data && typeof existing.data === "object" ? existing.data : {}) as Record<string, unknown>
            const existingList = Array.isArray(existingData.list) ? existingData.list as Record<string, unknown>[] : []
            if (existingList.find(t => String(t.dataFileName ?? t.fileName ?? "") === argv.name)) {
              error("DUPLICATE_TASK", `Task '${argv.name}' already exists in this folder.`, { format, exitCode: 2 }); return
            }

            // Step 5: create task
            const created = await createTask(sc, {
              fileType: "281",
              createdBy: String(sc.userId),
              projectId: sc.projectId,
              dataFileName: argv.name as string,
              fileDescription: argv.description as string | undefined,
              dataFolderId: folderId,
              workspaceName: sc.workspaceName,
            })
            const fileId = Number(created.data)

            // Step 6: resolve target datasource (Lakehouse only)
            let targetDsId: number
            let targetDsType = 1
            if (argv.target) {
              const targetDs = await resolveDatasource(sc, String(argv.target))
              if ((targetDs.dsType ?? 1) !== 1) {
                error("INVALID_ARGUMENTS", `CDC multi-table sync only supports Lakehouse as target. '${targetDs.name}' is not a Lakehouse datasource.`, { format, exitCode: 2 }); return
              }
              targetDsId = targetDs.id
              targetDsType = 1
            } else {
              const lhDs = await autoResolveLakehouseDs(sc)
              if (!lhDs) {
                error("DATASOURCE_NOT_FOUND", "No Lakehouse datasource found. Please specify --target.", { format, exitCode: 2 }); return
              }
              targetDsId = lhDs.id
            }

            // Step 7: resolve PG slot
            const PG_LIKE = new Set([7, 22, 40, 46, 48])
            const isPg = PG_LIKE.has(sourceDs.dsType)
            let slotName = argv["slot-name"] as string | undefined
            const logicPlugin = (argv["logic-plugin"] as string | undefined) ?? "pgoutput"
            if (isPg && !slotName) {
              const slotResp = await listPgSlots(sc, [sourceDs.id]).catch(() => null)
              const slots = slotResp?.data?.find(s => s.datasourceId === sourceDs.id)?.pipelineSlotMetaVos ?? []
              if (slots.length > 0) slotName = slots[0].slotName
            }

            // Step 8: save CDC config
            const tablesArg = argv.tables as string | undefined
            const pipelineType = argv["pipeline-type"] as number
            const syncObjectList = tablesArg
              ? tablesArg.split(",").map(t => ({ schemaName: argv.database as string, tableName: t.trim() }))
              : [{ schemaName: argv.database as string }]
            const effectivePipelineType = tablesArg && pipelineType === 3 ? 1 : pipelineType

            await saveCdcTask(sc, {
              dataFileId: fileId,
              projectId: sc.projectId,
              pipelineType: effectivePipelineType,
              syncMode: argv["sync-mode"] as number,
              sourceDatasourceList: [{
                datasourceId: sourceDs.id,
                datasourceType: sourceDs.dsType,
                ...(isPg && slotName && { slotName, logicPlugin }),
              }],
              syncObjectList,
              targetDatasource: { datasourceId: targetDsId, datasourceType: targetDsType },
            })

            // Step 9: save VC config
            const vcName = argv.vc as string | undefined
            if (vcName) {
              const resolvedVcId = await resolveVclusterId(sc, vcName).catch(() => undefined)
              await saveTaskConfig(sc, {
                dataFileId: fileId,
                projectId: sc.projectId,
                updateBy: String(sc.userId),
                instanceName: sc.workspaceName,
                etlVcCode: vcName,
                ...(resolvedVcId != null && { etlVcId: resolvedVcId }),
                activeStartTime: new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
                activeEndTime: "2099-01-01T00:00:00.000Z",
              }).catch(() => null)
            }

            logOperation("task create-realtime-sync", { ok: true })
            success({
              task_id: fileId,
              task_name: argv.name,
              pipeline_type: effectivePipelineType === 1 ? "multi-table mirror" : effectivePipelineType === 2 ? "multi-table merge" : "whole-database mirror",
              source: { datasource: sourceDs.name, database: argv.database, tables: tablesArg ?? "all", ...(isPg && slotName && { slot: slotName }) },
              target: { datasource_id: targetDsId },
              sync_mode: argv["sync-mode"] === 1 ? "full+incremental" : "incremental only",
              studio_url: studioUrl(sc, fileId),
            }, {
              format,
              aiMessage: `MULTI_REALTIME CDC task created (id=${fileId}). Next: deploy with 'cz-cli task deploy ${fileId} -y', then start with 'cz-cli task start ${fileId}'.`,
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "create-batch-sync <name>",
        "Create a multi-table offline batch sync task (MULTI_DI) — one step: prereq check + create + configure",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true, describe: "Task name" })
            .option("folder", { type: "string", demandOption: true, describe: "Folder ID or name" })
            .option("source", { type: "string", demandOption: true, describe: "Source datasource name or ID" })
            .option("database", { type: "string", demandOption: true, describe: "Source database/schema to sync" })
            .option("tables", { type: "string", describe: "Comma-separated table names. Omit for whole-database." })
            .option("target", { type: "string", describe: "Target Lakehouse datasource name or ID (auto-resolves if omitted)" })
            .option("vc", { type: "string", describe: "Virtual cluster name for execution" })
            .option("cron", { type: "string", describe: "Cron expression for scheduled execution" })
            .option("pipeline-type", { type: "number", default: 1, describe: "1=multi-table mirror (default), 2=multi-table merge" })
            .option("batch-size", { type: "number", default: 4, describe: "Tables per group (default: 4)" })
            .option("connections", { type: "number", default: 4, describe: "Max source connections per group (default: 4)" })
            .option("parallelism", { type: "number", default: 4, describe: "Concurrent groups (default: 4)" })
            .option("pk-write-mode", { type: "string", default: "OVERWRITE", choices: ["OVERWRITE", "APPEND"], describe: "Write mode for tables with PK (default: OVERWRITE)" })
            .option("non-pk-write-mode", { type: "string", default: "OVERWRITE", choices: ["OVERWRITE", "APPEND"], describe: "Write mode for tables without PK (default: OVERWRITE)" })
            .option("skip-check", { type: "boolean", default: false, describe: "Skip CDC prerequisite check" })
            .option("description", { type: "string", describe: "Task description" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)

            // Step 1: resolve source datasource
            const sourceDs = await resolveDatasource(sc, String(argv.source))
            if (!sourceDs.dsType) {
              error("INVALID_ARGUMENTS", `Cannot determine dsType for source datasource '${argv.source}'.`, { format, exitCode: 2 }); return
            }

            // Step 2: CDC prerequisite check
            if (!(argv["skip-check"] as boolean)) {
              const check = await checkCdcPrereqs(sc, sourceDs as { id: number; name: string; dsType: number }, String(argv.source))
              if (!check.ok) { error("CDC_PREREQ_FAILED", check.message, { format, exitCode: 2 }); return }
            }

            // Step 3: resolve folder
            const folderRaw = (argv.folder as string).trim()
            const folderId = /^\d+$/.test(folderRaw)
              ? parseInt(folderRaw, 10)
              : await resolveFolderIdByName(sc, folderRaw, format)

            // Step 4: check duplicate name
            const existing = await listTasks(sc, { projectId: sc.projectId, page: 1, pageSize: 50, folderId, fileName: argv.name as string })
            const existingData = (existing.data && typeof existing.data === "object" ? existing.data : {}) as Record<string, unknown>
            const existingList = Array.isArray(existingData.list) ? existingData.list as Record<string, unknown>[] : []
            if (existingList.find(t => String(t.dataFileName ?? t.fileName ?? "") === argv.name)) {
              error("DUPLICATE_TASK", `Task '${argv.name}' already exists in this folder.`, { format, exitCode: 2 }); return
            }

            // Step 5: create task
            const created = await createTask(sc, {
              fileType: "291",
              createdBy: String(sc.userId),
              projectId: sc.projectId,
              dataFileName: argv.name as string,
              fileDescription: argv.description as string | undefined,
              dataFolderId: folderId,
              workspaceName: sc.workspaceName,
            })
            const fileId = Number(created.data)

            // Step 6: resolve target datasource (Lakehouse only)
            let targetDsId: number
            if (argv.target) {
              const targetDs = await resolveDatasource(sc, String(argv.target))
              if ((targetDs.dsType ?? 1) !== 1) {
                error("INVALID_ARGUMENTS", `MULTI_DI only supports Lakehouse as target. '${targetDs.name}' is not a Lakehouse datasource.`, { format, exitCode: 2 }); return
              }
              targetDsId = targetDs.id
            } else {
              const lhDs = await autoResolveLakehouseDs(sc)
              if (!lhDs) {
                error("DATASOURCE_NOT_FOUND", "No Lakehouse datasource found. Please specify --target.", { format, exitCode: 2 }); return
              }
              targetDsId = lhDs.id
            }

            // Step 7: build jobs list
            const tablesArg = argv.tables as string | undefined
            const database = argv.database as string
            const jobs = tablesArg
              ? tablesArg.split(",").map(t => ({
                  source: { dataObject: t.trim(), namespace: database, columns: [], datasourceId: sourceDs.id },
                  sink: { dataObject: t.trim(), namespace: database, columns: [] },
                  columnMapping: {},
                }))
              : []

            // Step 8: build and save content
            const content = {
              templateKey: 1,
              userParams: {},
              pipelineType: argv["pipeline-type"] as number,
              heterogeneous: false,
              sourceConnection: {
                datasource: [{ datasourceId: sourceDs.id, datasourceName: sourceDs.name, type: sourceDs.dsType }],
                params: { dsType: sourceDs.dsType, readMode: "BINLOG", operatorType: "source", heterogeneous: false },
              },
              sinkConnection: {
                datasourceId: targetDsId,
                datasourceName: "",
                type: 1,
                syncMode: 1,
                params: { dsType: 1, operatorType: "sink" },
              },
              nameRule: { schema: { mode: "2" }, table: { mode: "1" } },
              setting: {
                groupingStrategy: {
                  strategy: "SIZE",
                  batchSize: argv["batch-size"] as number,
                  connections: argv.connections as number,
                  parallelism: argv.parallelism as number,
                },
                pkWriteMode: argv["pk-write-mode"] as string,
                nonPkWriteMode: argv["non-pk-write-mode"] as string,
              },
              sourceEventTypes: ["c", "u", "d"],
              dataFilterSwitch: false,
              syncAllAtFirst: true,
              jobs,
            }

            const vcName = argv.vc as string | undefined
            const resolvedVcId = vcName ? await resolveVclusterId(sc, vcName).catch(() => undefined) : undefined

            await saveTaskContent(sc, {
              dataFileId: fileId,
              dataFileContent: JSON.stringify(content),
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.workspaceName,
              adhocConfigs: JSON.stringify({
                multiDataSource: [],
                schema: "public",
                ...(vcName && { adhocVcCode: vcName }),
                ...(vcName && resolvedVcId != null && { adhocVcId: String(resolvedVcId) }),
              }),
            })

            // Step 9: save cron + VC if provided
            if (argv.cron || vcName) {
              await saveTaskConfig(sc, {
                dataFileId: fileId,
                projectId: sc.projectId,
                updateBy: String(sc.userId),
                instanceName: sc.workspaceName,
                ...(argv.cron && { cronExpress: normalizeCron(argv.cron as string) }),
                ...(vcName && { etlVcCode: vcName }),
                ...(resolvedVcId != null && { etlVcId: resolvedVcId }),
                activeStartTime: new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
                activeEndTime: "2099-01-01T00:00:00.000Z",
              }).catch(() => null)
            }

            logOperation("task create-batch-sync", { ok: true })
            success({
              task_id: fileId,
              task_name: argv.name,
              source: { datasource: sourceDs.name, database, tables: tablesArg ?? "all" },
              target: { datasource_id: targetDsId },
              setting: { batch_size: argv["batch-size"], connections: argv.connections, parallelism: argv.parallelism },
              studio_url: studioUrl(sc, fileId),
            }, {
              format,
              aiMessage: `MULTI_DI task created (id=${fileId}). Next: deploy with 'cz-cli task deploy ${fileId} -y', then execute with 'cz-cli task execute ${fileId} --vc <vc_name>'.`,
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "create-stream-sync <name>",
        "Create a single-table streaming sync task from Kafka/AutoMQ to Lakehouse (REALTIME type)",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true, describe: "Task name" })
            .option("folder", { type: "string", demandOption: true, describe: "Folder ID or name" })
            .option("source", { type: "string", demandOption: true, describe: "Kafka/AutoMQ datasource name or ID" })
            .option("topic", { type: "string", demandOption: true, describe: "Kafka topic name" })
            .option("target", { type: "string", describe: "Target Lakehouse datasource (auto-resolves if omitted)" })
            .option("target-schema", { type: "string", default: "public", describe: "Target schema (default: public)" })
            .option("target-table", { type: "string", describe: "Target table name (defaults to topic name)" })
            .option("vc", { type: "string", describe: "Virtual cluster name for execution" })
            .option("mode", { type: "string", default: "latest-offset", describe: "Kafka offset mode: latest-offset, earliest-offset, specific-offsets (default: latest-offset)" })
            .option("codec", { type: "string", default: "json", describe: "Message codec: json, avro, csv (default: json)" })
            .option("group-id", { type: "string", default: "1", describe: "Kafka consumer group ID (default: 1)" })
            .option("parallelism", { type: "number", default: 1, describe: "Task parallelism (default: 1)" })
            .option("cron", { type: "string", describe: "Cron expression for scheduled heartbeat (required for deploy)" })
            .option("description", { type: "string", describe: "Task description" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)

            // Step 1: resolve source datasource
            const sourceDs = await resolveDatasource(sc, String(argv.source))
            const KAFKA_TYPES = new Set([2, 45]) // Kafka=2, AutoMQ=45
            if (!KAFKA_TYPES.has(sourceDs.dsType ?? 0)) {
              error("INVALID_ARGUMENTS", `REALTIME task only supports Kafka/AutoMQ as source. '${sourceDs.name}' (dsType=${sourceDs.dsType}) is not supported.`, { format, exitCode: 2 }); return
            }

            // Step 2: resolve target datasource (Lakehouse only)
            let targetDsId: number
            let targetDsName: string
            if (argv.target) {
              const targetDs = await resolveDatasource(sc, String(argv.target))
              if ((targetDs.dsType ?? 1) !== 1) {
                error("INVALID_ARGUMENTS", `REALTIME task only supports Lakehouse as target.`, { format, exitCode: 2 }); return
              }
              targetDsId = targetDs.id; targetDsName = targetDs.name
            } else {
              const lhDs = await autoResolveLakehouseDs(sc)
              if (!lhDs) { error("DATASOURCE_NOT_FOUND", "No Lakehouse datasource found. Specify --target.", { format, exitCode: 2 }); return }
              targetDsId = lhDs.id; targetDsName = lhDs.name
            }

            const topic = argv.topic as string
            const targetTable = (argv["target-table"] as string | undefined) ?? topic
            const targetSchema = argv["target-schema"] as string

            // Step 3: check if target table exists
            const targetColsResp = await studioRequest(sc, "/ide-authority/v1/projectDataSources/getDataObjectMeta", {
              id: targetDsId, nameSpace: targetSchema, dataObjectName: targetTable,
            }).catch(() => null)
            const targetCols = (() => {
              if (!targetColsResp) return null
              const d = ((targetColsResp as unknown) as Record<string, unknown>).data as Record<string, unknown> | null
              if (!d) return null
              const cols = (d as Record<string, unknown>).columns
              return Array.isArray(cols) && cols.length > 0 ? cols : null
            })()
            const targetTableExists = targetCols !== null

            // Step 4: resolve folder + check duplicate
            const folderRaw = (argv.folder as string).trim()
            const folderId = /^\d+$/.test(folderRaw)
              ? parseInt(folderRaw, 10)
              : await resolveFolderIdByName(sc, folderRaw, format)
            const existing = await listTasks(sc, { projectId: sc.projectId, page: 1, pageSize: 50, folderId, fileName: argv.name as string })
            const existingData = (existing.data && typeof existing.data === "object" ? existing.data : {}) as Record<string, unknown>
            const existingList = Array.isArray(existingData.list) ? existingData.list as Record<string, unknown>[] : []
            if (existingList.find(t => String(t.dataFileName ?? t.fileName ?? "") === argv.name)) {
              error("DUPLICATE_TASK", `Task '${argv.name}' already exists in this folder.`, { format, exitCode: 2 }); return
            }

            // Step 5: create task
            const created = await createTask(sc, {
              fileType: "14",
              createdBy: String(sc.userId),
              projectId: sc.projectId,
              dataFileName: argv.name as string,
              fileDescription: argv.description as string | undefined,
              dataFolderId: folderId,
              workspaceName: sc.workspaceName,
            })
            const fileId = Number(created.data)

            // Step 6: Kafka system columns (fixed schema)
            const kafkaColumns = [
              { name: "__key__",       type: "STRING",  physicalType: null, comment: null, nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, cluster: false, partitionColumn: false },
              { name: "__value__",     type: "STRING",  physicalType: null, comment: null, nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, cluster: false, partitionColumn: false },
              { name: "__partition__", type: "INTEGER", physicalType: null, comment: null, nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, cluster: false, partitionColumn: false },
              { name: "__offset__",    type: "LONG",    physicalType: null, comment: null, nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, cluster: false, partitionColumn: false },
              { name: "__timestamp__", type: "LONG",    physicalType: null, comment: null, nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, cluster: false, partitionColumn: false },
            ]
            const sinkColumns = [
              { name: "__key__",       type: "string",  physicalType: null, comment: "", nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, cluster: false, partitionColumn: false },
              { name: "__value__",     type: "string",  physicalType: null, comment: "", nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, cluster: false, partitionColumn: false },
              { name: "__partition__", type: "int",     physicalType: null, comment: "", nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, cluster: false, partitionColumn: false },
              { name: "__offset__",    type: "bigint",  physicalType: null, comment: "", nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, cluster: false, partitionColumn: false },
              { name: "__timestamp__", type: "bigint",  physicalType: null, comment: "", nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, cluster: false, partitionColumn: false },
            ]

            // Step 7: build and save content
            const content = {
              templateKey: 1,
              userParams: {},
              sourceConnection: {
                datasourceId: sourceDs.id,
                datasourceName: sourceDs.name,
                type: sourceDs.dsType,
              },
              sinkConnection: {
                datasourceId: targetDsId,
                datasourceName: targetDsName,
                type: 1,
              },
              jobs: [{
                source: {
                  dataObject: topic,
                  namespace: "--",
                  params: {
                    dsType: sourceDs.dsType,
                    mode: argv.mode as string,
                    codec: argv.codec as string,
                    groupId: argv["group-id"] as string,
                    operatorType: "source",
                    table: topic,
                    database: "--",
                  },
                  columns: kafkaColumns,
                },
                sink: {
                  dataObject: targetTable,
                  namespace: targetSchema,
                  params: {
                    dsType: 1,
                    writeMode: "APPEND",
                    operatorType: "sink",
                    table: targetTable,
                    database: targetSchema,
                    is_partition: false,
                  },
                  columns: sinkColumns,
                },
                setting: {
                  parallelism: argv.parallelism as number,
                  errorLimit: { maxCount: -1, record: -1 },
                },
                columnMapping: {
                  __key__: "__key__", __value__: "__value__",
                  __partition__: "__partition__", __offset__: "__offset__", __timestamp__: "__timestamp__",
                },
              }],
            }

            const vcName = argv.vc as string | undefined
            const resolvedVcId = vcName ? await resolveVclusterId(sc, vcName).catch(() => undefined) : undefined
            await saveTaskContent(sc, {
              dataFileId: fileId,
              dataFileContent: JSON.stringify(content),
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.workspaceName,
              ...(vcName && {
                adhocConfigs: JSON.stringify({
                  multiDataSource: [],
                  schema: targetSchema,
                  adhocVcCode: vcName,
                  ...(resolvedVcId != null && { adhocVcId: String(resolvedVcId) }),
                }),
              }),
            })

            // Save cron + VC config (required for deploy)
            await saveTaskConfig(sc, {
              dataFileId: fileId,
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.workspaceName,
              cronExpress: normalizeCron((argv.cron as string | undefined) ?? "0 0 2 * * ? *"),
              ...(vcName && { etlVcCode: vcName }),
              ...(resolvedVcId != null && { etlVcId: resolvedVcId }),
              activeStartTime: new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
              activeEndTime: "2099-01-01T00:00:00.000Z",
            }).catch(() => null)
            const ddlHint = !targetTableExists
              ? `CREATE TABLE IF NOT EXISTS ${targetSchema}.${targetTable} (\n  __key__ STRING,\n  __value__ STRING,\n  __partition__ INT,\n  __offset__ BIGINT,\n  __timestamp__ BIGINT\n);`
              : null

            logOperation("task create-stream-sync", { ok: true })
            success({
              task_id: fileId,
              task_name: argv.name,
              source: { datasource: sourceDs.name, topic, mode: argv.mode, codec: argv.codec },
              target: { datasource: targetDsName, schema: targetSchema, table: targetTable, table_exists: targetTableExists },
              studio_url: studioUrl(sc, fileId),
              ...(ddlHint && { create_table_ddl: ddlHint }),
            }, {
              format,
              aiMessage: [
                `REALTIME task created (id=${fileId}).`,
                !targetTableExists ? `⚠ Target table '${targetSchema}.${targetTable}' does not exist. Run:\n  cz-cli sql "${ddlHint?.replace(/\n/g, " ")}"` : null,
                `Next: deploy with 'cz-cli task deploy ${fileId} -y', then start with 'cz-cli task start ${fileId}'.`,
              ].filter(Boolean).join("\n"),
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "create-setup <name>",
        "Create a script task with content and schedule configured in one step",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .option("type", { type: "string", demandOption: true, describe: "Task type: SQL, PYTHON, SHELL, JDBC, etc." })
            .option("folder", { type: "string", describe: "Folder ID or name (required; root directory not allowed)" })
            .option("content", { type: "string", describe: "Script content" })
            .option("file", { alias: "f", type: "string", describe: "Read script from file" })
            .option("cron", { type: "string", describe: "Cron expression (5/6/7 fields)" })
            .option("vc", { type: "string", describe: "Virtual cluster code" })
            .option("schema", { type: "string", describe: "Schema name" })
            .option("description", { type: "string", describe: "Task description" })
            .option("params", { type: "string", describe: 'Runtime parameters JSON, e.g. \'{"bizdate":"bizdate","city":"beijing"}\'' })
            .option("datasource", { type: "string", describe: "JDBC datasource name or ID to bind (auto-resolves dsType)" })
            .option("database", { type: "string", describe: "JDBC database/schema name to USE after connecting" }),
        async (argv) => {
          const format = argv.format
          try {
            if (argv.content && argv.file) {
              error("INVALID_ARGUMENTS", "Provide --content or --file, not both.", { format, exitCode: 2 }); return
            }
            if (!argv.content && !argv.file && !argv.cron) {
              process.stderr.write("Warning: no --content/--file or --cron provided. Task will be created as an empty draft.\n")
            }
            const sc = await ctx(argv)
            const folderRaw = (argv.folder as string | undefined)?.trim()
            if (!folderRaw) {
              error("INVALID_ARGUMENTS", "Missing required option: --folder. Run 'cz-cli task folder-tree' to see available folders and their IDs, then pass the correct folder with --folder <id_or_name>.", { format, exitCode: 2 }); return
            }
            const folderId = /^\d+$/.test(folderRaw)
              ? parseInt(folderRaw, 10)
              : await resolveFolderIdByName(sc, folderRaw, format)
            if (folderId === 0) {
              process.stderr.write("Warning: creating task in root directory. Consider using a subfolder to keep the workspace organized.\n")
            }
            // Check for duplicate name
            const existing = await listTasks(sc, { projectId: sc.projectId, page: 1, pageSize: 50, folderId, fileName: argv.name as string })
            const existingData = (existing.data && typeof existing.data === "object" ? existing.data : {}) as Record<string, unknown>
            const existingList = Array.isArray(existingData.list) ? existingData.list as Record<string, unknown>[] : []
            const duplicate = existingList.find((t) => String(t.dataFileName ?? t.fileName ?? "") === argv.name)
            if (duplicate) {
              error("DUPLICATE_TASK", `Task '${argv.name}' already exists in this folder (task_id=${duplicate.id ?? duplicate.task_id}). Use a different name or delete the existing task first.`, { format, exitCode: 2 }); return
            }

            // Step 1: create
            const parsedFileType = parseTaskType(argv.type as string)
            // UI_ONLY types: content must be configured in Studio UI
            if (UI_ONLY_TYPES.has(parsedFileType)) {
              const createResp = await createTask(sc, {
                fileType: String(parsedFileType),
                createdBy: String(sc.userId),
                projectId: sc.projectId,
                dataFileName: argv.name as string,
                fileDescription: argv.description,
                dataFolderId: folderId,
                workspaceName: sc.workspaceName,
              })
              const fileId = Number(createResp.data as Record<string, unknown>)
              logOperation("task create-setup", { ok: true })
              success({
                task_id: fileId,
                task_name: argv.name,
                content_saved: false,
                cron_saved: false,
                studio_url: studioUrl(sc, fileId),
              }, {
                format,
                aiMessage: `Task created (type=${argv.type} is UI-only). Open Studio to configure data source, field mapping, and sync rules: ${studioUrl(sc, fileId)}`,
              })
              return
            }
            const createResp = await createTask(sc, {
              fileType: String(parsedFileType),
              createdBy: String(sc.userId),
              projectId: sc.projectId,
              dataFileName: argv.name as string,
              fileDescription: argv.description,
              dataFolderId: folderId,
              workspaceName: sc.workspaceName,
            })
            const fileId = Number((createResp.data as Record<string, unknown>))
            const url = studioUrl(sc, fileId)

            // Steps 2 & 3 with rollback on failure
            try {
              // Step 2: save content (optional)
              if (argv.content || argv.file) {
                const text = argv.content ?? readFileSync(argv.file as string, "utf-8")
                let paramValueList: unknown[] | undefined
                if (argv.params) {
                  const result = parseParamValueList(argv.params as string)
                  if (!result) { error("INVALID_ARGUMENTS", `--params is not valid: ${argv.params}`, { format }); return }
                  paramValueList = result
                }
                let casAdhocConfigs: string | undefined
                if (argv.datasource) {
                  const ds = await resolveDatasource(sc, String(argv.datasource))
                  casAdhocConfigs = JSON.stringify({
                    datasourceId: ds.id,
                    dsType: ds.dsType,
                    sessionSchemaName: argv.database ?? "",
                    multiDataSource: [],
                    schema: "public",
                  })
                }
                await saveTaskContent(sc, {
                  dataFileId: fileId,
                  dataFileContent: text,
                  projectId: sc.projectId,
                  updateBy: String(sc.userId),
                  instanceName: sc.instanceName,
                  replaceEscapedChars: false,
                  ...(paramValueList && { paramValueList }),
                  ...(casAdhocConfigs && { adhocConfigs: casAdhocConfigs }),
                })
              }

              // Step 3: save cron (optional)
              if (argv.cron) {
                const cronResult = convertAgentCron(argv.cron as string)
                if (!cronResult.ok || !cronResult.outputCron) {
                  error("INVALID_CRON", cronResult.error ?? "Invalid cron expression", { format, exitCode: 2 }); return
                }
                const oldConfigProps: Record<string, unknown> = {}
                if (cronResult.uiParam.scheduleStartTime) oldConfigProps["scheduleStartTime"] = cronResult.uiParam.scheduleStartTime
                if (cronResult.uiParam.scheduleEndTime) oldConfigProps["scheduleEndTime"] = cronResult.uiParam.scheduleEndTime
                await saveTaskConfig(sc, {
                  dataFileId: fileId,
                  projectId: sc.projectId,
                  updateBy: String(sc.userId),
                  instanceName: sc.instanceName,
                  cronExpress: cronResult.outputCron,
                  schemaName: (argv.schema as string | undefined) ?? "public",
                  etlVcCode: (argv.vc as string | undefined) ?? "DEFAULT",
                  retryCount: 1,
                  retryIntervalTime: 1,
                  retryIntervalTimeUnit: "m",
                  rerunProperty: "3",
                  selfDependsJob: 0,
                  executeTimeout: 0,
                  executeTimeoutUnit: "m",
                  activeStartTime: new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
                  activeEndTime: "2099-01-01T00:00:00.000Z",
                  dataFileInputListReqs: [],
                  configProperties: JSON.stringify(oldConfigProps),
                })
              }
            } catch (setupErr) {
              // Rollback: delete the created task so no orphan is left
              await deleteTask(sc, { scheduleTaskId: fileId, projectId: sc.projectId }).catch(() => {})
              throw setupErr
            }

            logOperation("task create-setup", { ok: true })
            success({
              task_id: fileId,
              task_name: argv.name,
              content_saved: !!(argv.content || argv.file),
              cron_saved: !!argv.cron,
              studio_url: url,
            }, {
              format,
              aiMessage: t("task_save_online_reminder", fileId),
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "create-folder <name>",
        "Create a task folder",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .option("parent", { type: "number", default: 0, describe: "Parent folder ID" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            try {
              const resp = await createFolder(sc, {
                createdBy: String(sc.userId),
                projectId: sc.projectId,
                dataFolderName: argv.name as string,
                parentFolderId: argv.parent,
              })
              logOperation("task create-folder", { ok: true })
              success(resp.data, { format })
            } catch (createErr) {
              const msg = createErr instanceof Error ? createErr.message : String(createErr)
              if (msg.includes("已经存在") || msg.includes("already exist")) {
                const folderId = await resolveFolderIdByName(sc, argv.name as string, format)
                logOperation("task create-folder", { ok: true })
                success({ id: folderId, dataFolderName: argv.name, existing: true }, { format })
                return
              }
              throw createErr
            }
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "status <task>",
        "Get combined draft + deployed status in one call",
        (y) => y.positional("task", { type: "string", demandOption: true }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)

            // Parallel: draft detail + config + deployed schedule detail
            const CDC_TYPES = new Set([14, 17, 280, 281, 291])

            // Pre-fetch getDetail to know fileType before deciding whether to call CDC run status
            const detail = await getTaskDetail(sc, fileId)
            const detailData = (detail.data && typeof detail.data === "object" ? detail.data : {}) as Record<string, unknown>
            const detailObj = (typeof detailData.taskDetail === "object" && detailData.taskDetail !== null
              ? detailData.taskDetail : detailData) as Record<string, unknown>
            const fileType = Number(detailObj.fileType ?? 0)
            const isCdcType = CDC_TYPES.has(fileType)

            const [config, scheduleResp, cdcRunResp] = await Promise.all([
              getTaskConfigDetail(sc, { projectId: sc.projectId, workspaceId: sc.workspaceId, dataFileId: fileId }),
              studioRequest(sc, "/ide-admin/v1/scheduleTask/getDetail",
                { scheduleTaskId: fileId, projectId: sc.projectId },
                { env: "prod" },
              ).catch(() => null),
              isCdcType
                ? (fileType === 14
                    ? getCdcTaskRunStatus(sc, fileId).catch(() => null)           // REALTIME: use fileId directly
                    : getCdcTaskRunStatus(sc, Number(detailObj.cdcTaskId)).catch(() => null))  // MULTI_REALTIME: use cdcTaskId
                : Promise.resolve(null),
            ])

            const configData = (config.data && typeof config.data === "object" ? config.data : {}) as Record<string, unknown>
            const scheduleConfig = convertConfigFields((configData.taskConfigurationDetail ??
              configData.task_configuration_detail ?? configData) as Record<string, unknown>)

            const EDIT_STATE: Record<number, string> = { 10: "draft", 20: "published", 100: "offline" }
            const editState = Number(detailObj.fileFlowStatus ?? detailObj.fileStatus ?? 0)

            const scheduleData = scheduleResp?.data as Record<string, unknown> | null | undefined

            // CDC run status: from /timelyTask/getDetail (taskStatus: 2=running, 4=stopped)
            const CDC_RUN_STATUS: Record<number, string> = { 2: "running", 4: "stopped" }
            let cdcRunStatus: string | undefined
            if (isCdcType) {
              if (cdcRunResp) {
                const cdcRunData = (cdcRunResp.data && typeof cdcRunResp.data === "object" ? cdcRunResp.data : {}) as Record<string, unknown>
                const taskStatus = Number(cdcRunData.taskStatus ?? -1)
                cdcRunStatus = (cdcRunData.taskStatusName as string | undefined)
                  ?? CDC_RUN_STATUS[taskStatus]
                  ?? (taskStatus >= 0 ? String(taskStatus) : undefined)
              } else {
                // API errors when task is not running — treat as stopped (if deployed)
                const deployStatus = Number(detailObj.deployStatus ?? 0)
                cdcRunStatus = deployStatus >= 1 ? "stopped" : "not_deployed"
              }
            }

            // Fallback: deployStatus from getDetail (1=deployed, not necessarily running)
            const CDC_DEPLOY_STATUS: Record<number, string> = { 0: "not_deployed", 1: "deployed", 2: "running", 3: "stopped", 4: "failed" }
            const cdcDeployStatus = isCdcType
              ? (CDC_DEPLOY_STATUS[Number(detailObj.deployStatus ?? 0)] ?? String(detailObj.deployStatus ?? "unknown"))
              : undefined

            logOperation("task status", { ok: true })
            success({
              task_id: fileId,
              task_name: detailObj.dataFileName ?? detailObj.task_name,
              edit_state: EDIT_STATE[editState] ?? String(editState),
              studio_url: studioUrl(sc, fileId),
              ...(isCdcType && {
                cdc_status: cdcRunStatus ?? cdcDeployStatus,
                cdc_task_id: detailObj.cdcTaskId,
                note: "CDC/streaming task: use 'task start' to launch, 'task stop' to pause",
              }),
              draft: {
                task_content: detailObj.fileContent ?? detailObj.dataFileContent,
                cron_express: scheduleConfig.cron_express,
                vc: scheduleConfig.etl_vc_code,
                schema: scheduleConfig.schema_name,
              },
              deployed: isCdcType ? (detailObj.deployStatus != null ? { cdc_deploy_status: cdcDeployStatus, cdc_task_id: detailObj.cdcTaskId } : "not deployed") : (scheduleData ?? "not deployed or not accessible"),
            }, { format })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        ["get-content <task>", "detail <task>"],
        "Get task script content and configuration",
        (y) => y.positional("task", { type: "string", demandOption: true }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const [detail, config] = await Promise.all([
              getTaskDetail(sc, fileId),
              getTaskConfigDetail(sc, { projectId: sc.projectId, workspaceId: sc.workspaceId, dataFileId: fileId }),
            ])
            const detailData = (detail.data && typeof detail.data === "object" ? detail.data : {}) as Record<
              string,
              unknown
            >
            const detailObj = (
              typeof detailData.taskDetail === "object" && detailData.taskDetail !== null
                ? detailData.taskDetail
                : detailData
            ) as Record<string, unknown>
            const normalizedDetail: Record<string, unknown> = { ...convertTaskFields(detailObj), task_id: fileId }
            const configData = (config.data && typeof config.data === "object" ? config.data : {}) as Record<
              string,
              unknown
            >
            const scheduleConfig = convertConfigFields((configData.taskConfigurationDetail ??
              configData.task_configuration_detail ??
              configData.scheduleConfig ??
              configData.schedule_config ??
              configData) as Record<string, unknown>)
            const rawParams = (detailObj.paramValueList ?? detailData.paramValueList) as unknown[] | undefined
            const rawInputParams = (detailObj.inputParamValueList ?? detailData.inputParamValueList) as unknown[] | undefined
            const rawOutputParams = (detailObj.outputParamValueList ?? detailData.outputParamValueList) as unknown[] | undefined
            // Parse adhocConfigs for JDBC datasource binding (datasourceId + sessionSchemaName)
            const adhocConfigsRaw = detailObj.adhocConfigs ?? detailData.adhocConfigs
            const adhocConfigs = (() => {
              if (!adhocConfigsRaw) return null
              try { return JSON.parse(String(adhocConfigsRaw)) as Record<string, unknown> } catch { return null }
            })()
            const merged = {
              task_id: normalizedDetail.task_id ?? fileId,
              task_name: normalizedDetail.task_name,
              task_content: normalizedDetail.task_content ?? detailObj.fileContent ?? detailObj.dataFileContent,
              params: Array.isArray(rawParams) && rawParams.length > 0 ? rawParams : undefined,
              input_params: Array.isArray(rawInputParams) && rawInputParams.length > 0 ? rawInputParams : undefined,
              output_params: Array.isArray(rawOutputParams) && rawOutputParams.length > 0 ? rawOutputParams : undefined,
              datasource_id: adhocConfigs?.datasourceId ?? detailData.datasourceId ?? undefined,
              session_schema_name: adhocConfigs?.sessionSchemaName ?? detailData.sessionSchemaName ?? undefined,
              ds_type: adhocConfigs?.dsType ?? detailData.dsType ?? undefined,
              schedule_config: scheduleConfig,
            }
            logOperation("task get-content", { ok: true })
            success({ ...merged, studio_url: studioUrl(sc, fileId) }, { format, aiMessage: t("task_content") })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "save-content <task>",
        "Save script content for a SQL/Python/Shell task",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("content", { type: "string", describe: "Script content" })
            .option("file", { alias: "f", type: "string", describe: "Read content from file" })
            .option("params", { type: "string", describe: 'Runtime parameters as JSON object. Values starting with "$[" or matching system param names (bizdate, sys_biz_day, sys_plan_day, etc.) are treated as system/expression params automatically. e.g. \'{"city":"beijing","dt":"bizdate","yesterday":"$[yyyy-MM-dd,-1d]"}\'' })
            .option("datasource", { type: "string", describe: "JDBC datasource name or ID to bind (auto-resolves dsType)" })
            .option("database", { type: "string", describe: "JDBC database/schema name to USE after connecting" }),
        async (argv) => {
          const format = argv.format
          try {
            if ((argv.content && argv.file) || (!argv.content && !argv.file)) {
              error("INVALID_ARGUMENTS", "Exactly one of --content or --file is required.", { format, exitCode: 2 })
              return
            }
            const text = argv.content ?? readFileSync(argv.file as string, "utf-8")
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            if (await isUiOnlyTask(sc, fileId)) {
              error("UI_ONLY_TASK", `This task type requires configuration via Studio UI.`, {
                format,
                aiMessage: `Open Studio to configure: ${studioUrl(sc, fileId)}`,
              }); return
            }
            let paramValueList: unknown[] | undefined
            if (argv.params) {
              const result = parseParamValueList(argv.params as string)
              if (!result) {
                error("INVALID_ARGUMENTS", `--params is not valid: ${argv.params}. Use: --params '{"key":"value","dt":"bizdate","yesterday":"$[yyyy-MM-dd,-1d]"}'`, { format }); return
              }
              paramValueList = result
            }
            // Build adhocConfigs for JDBC datasource binding
            let adhocConfigs: string | undefined
            if (argv.datasource) {
              const ds = await resolveDatasource(sc, String(argv.datasource))
              adhocConfigs = JSON.stringify({
                datasourceId: ds.id,
                dsType: ds.dsType,
                sessionSchemaName: argv.database ?? "",
                multiDataSource: [],
                schema: "public",
              })
            }
            const resp = await saveTaskContent(sc, {
              dataFileId: fileId,
              dataFileContent: text,
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.instanceName,
              replaceEscapedChars: false,
              ...(paramValueList && { paramValueList }),
              ...(adhocConfigs && { adhocConfigs }),
            })
            logOperation("task save-content", { ok: true })
            success({ ...resp.data as object, studio_url: studioUrl(sc, fileId) }, { format, aiMessage: t("task_save_online_reminder", fileId) })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "create-offline-sync <name>",
        "Create a single-table offline batch sync task (INTEGRATION) and fetch source schema for Agent field mapping",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true, describe: "Task name" })
            .option("folder", { type: "string", demandOption: true, describe: "Folder ID or name" })
            .option("source", { type: "string", demandOption: true, describe: "Source datasource name or ID" })
            .option("source-db", { type: "string", demandOption: true, describe: "Source database/schema" })
            .option("source-table", { type: "string", demandOption: true, describe: "Source table name" })
            .option("target", { type: "string", describe: "Target Lakehouse datasource (auto-resolved if omitted)" })
            .option("target-schema", { type: "string", default: "public", describe: "Target schema" })
            .option("target-table", { type: "string", describe: "Target table name (defaults to source-table)" })
            .option("description", { type: "string", describe: "Task description" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)

            // Step 1: resolve folder + check duplicate
            const folderRaw = (argv.folder as string).trim()
            const folderId = /^\d+$/.test(folderRaw)
              ? parseInt(folderRaw, 10)
              : await resolveFolderIdByName(sc, folderRaw, format)
            const existing = await listTasks(sc, { projectId: sc.projectId, page: 1, pageSize: 50, folderId, fileName: argv.name as string })
            const existingData = (existing.data && typeof existing.data === "object" ? existing.data : {}) as Record<string, unknown>
            const existingList = Array.isArray(existingData.list) ? existingData.list as Record<string, unknown>[] : []
            if (existingList.find(t => String(t.dataFileName ?? t.fileName ?? "") === argv.name)) {
              error("DUPLICATE_TASK", `Task '${argv.name}' already exists in this folder.`, { format, exitCode: 2 }); return
            }

            // Step 2: create task
            const created = await createTask(sc, {
              fileType: "1",
              createdBy: String(sc.userId),
              projectId: sc.projectId,
              dataFileName: argv.name as string,
              fileDescription: argv.description as string | undefined,
              dataFolderId: folderId,
              workspaceName: sc.workspaceName,
            })
            const fileId = Number(created.data)

            // Step 3: run integration-schema logic with the new fileId

            // Inline: same as integration-schema but with fileId already resolved
            const sourceDs = await resolveDatasource(sc, String(argv.source))
            if (!sourceDs.dsType) {
              error("INVALID_ARGUMENTS", `Cannot determine dsType for datasource '${argv.source}'.`, { format, exitCode: 2 }); return
            }
            let targetDsId: number
            let targetDsName: string
            if (argv.target) {
              const targetDs = await resolveDatasource(sc, String(argv.target))
              targetDsId = targetDs.id; targetDsName = targetDs.name
            } else {
              const lhDs = await autoResolveLakehouseDs(sc)
              if (!lhDs) { error("DATASOURCE_NOT_FOUND", "No Lakehouse datasource found. Specify --target.", { format, exitCode: 2 }); return }
              targetDsId = lhDs.id; targetDsName = lhDs.name
            }
            const sinkTargetTable = (argv["target-table"] as string | undefined) ?? argv["source-table"] as string
            const targetSchema = argv["target-schema"] as string
            const [metaResp, targetColsResp] = await Promise.all([
              studioRequest<unknown>(sc, "/ide-authority/v1/projectDataSources/getDataObjectMeta", {
                id: sourceDs.id, nameSpace: argv["source-db"] as string, dataObjectName: argv["source-table"] as string,
              }),
              studioRequest<unknown>(sc, "/ide-authority/v1/projectDataSources/getDataObjectMeta", {
                id: targetDsId, nameSpace: targetSchema, dataObjectName: sinkTargetTable,
              }).catch(() => null),
            ])
            const metaData = (metaResp.data as Record<string, unknown> | null) ?? {}
            const sourceColumns = (Array.isArray((metaData as Record<string, unknown>).columns)
              ? (metaData as Record<string, unknown>).columns
              : Array.isArray(metaData) ? metaData : []) as Record<string, unknown>[]
            if (sourceColumns.length === 0) {
              error("NO_COLUMNS", `Cannot fetch columns for ${argv["source-db"]}.${argv["source-table"]}.`, { format, exitCode: 2 }); return
            }
            const targetCols = (() => {
              if (!targetColsResp) return null
              const d = ((targetColsResp as unknown) as Record<string, unknown>).data as Record<string, unknown> | null
              if (!d) return null
              const cols = (d as Record<string, unknown>).columns
              return Array.isArray(cols) && cols.length > 0 ? cols : null
            })()
            const targetTableExists = targetCols !== null

            logOperation("task create-offline-sync", { ok: true })
            success({
              task_id: fileId,
              task_name: argv.name,
              source: { datasource_id: sourceDs.id, datasource_name: sourceDs.name, ds_type: sourceDs.dsType, db: argv["source-db"], table: argv["source-table"] },
              target: { datasource_id: targetDsId, datasource_name: targetDsName, ds_type: 1, schema: targetSchema, table: sinkTargetTable, table_exists: targetTableExists, existing_columns: targetCols ?? undefined },
              source_columns: sourceColumns,
              studio_url: studioUrl(sc, fileId),
            }, {
              format,
              aiMessage: [
                `INTEGRATION task '${argv.name}' created (id=${fileId}).`,
                `Source: ${sourceDs.name}.${argv["source-db"]}.${argv["source-table"]} (${sourceColumns.length} columns)`,
                `Target: ${targetDsName}.${targetSchema}.${sinkTargetTable} — ${targetTableExists ? "table EXISTS" : "table NOT EXISTS (needs CREATE TABLE)"}`,
                `\nNext: review source_columns and generate field mapping config, then run:`,
                `  cz-cli task offline-sync-schema ${fileId} --source ${argv.source} --source-db ${argv["source-db"]} --source-table ${argv["source-table"]} --target-schema ${targetSchema} --target-table ${sinkTargetTable}`,
                `  # (for full recommendations including write_mode, splitPk, where)`,
                `  cz-cli task save-offline-sync ${fileId} --config '<json>' --vc <vc_name>`,
                `  cz-cli task save-cron ${fileId} --cron '0 0 2 * * ? *' --vc <vc_name>`,
                `  cz-cli task deploy ${fileId} -y`,
              ].join("\n"),
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "offline-sync-schema <task>",
        "Fetch source table schema for INTEGRATION task — Agent uses output to generate field mapping for save-offline-sync",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("source", { type: "string", demandOption: true, describe: "Source datasource name or ID" })
            .option("source-db", { type: "string", demandOption: true, describe: "Source database/schema" })
            .option("source-table", { type: "string", demandOption: true, describe: "Source table name" })
            .option("target", { type: "string", describe: "Target Lakehouse datasource (auto-resolved if omitted)" })
            .option("target-schema", { type: "string", default: "public", describe: "Target schema" })
            .option("target-table", { type: "string", describe: "Target table name (defaults to source-table)" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const sourceDs = await resolveDatasource(sc, String(argv.source))
            if (!sourceDs.dsType) {
              error("INVALID_ARGUMENTS", `Cannot determine dsType for datasource '${argv.source}'.`, { format, exitCode: 2 }); return
            }
            // Resolve target datasource
            let targetDsId: number
            let targetDsName: string
            if (argv.target) {
              const targetDs = await resolveDatasource(sc, String(argv.target))
              targetDsId = targetDs.id; targetDsName = targetDs.name
            } else {
              const lhDs = await autoResolveLakehouseDs(sc)
              if (!lhDs) { error("DATASOURCE_NOT_FOUND", "No Lakehouse datasource found. Specify --target.", { format, exitCode: 2 }); return }
              targetDsId = lhDs.id
              targetDsName = lhDs.name
            }
            // Fetch columns + check target table existence + list sync VClusters in parallel
            const sinkTargetTable = (argv["target-table"] as string | undefined) ?? argv["source-table"] as string
            const targetSchema = argv["target-schema"] as string
            const [metaResp, targetColsResp] = await Promise.all([
              // Source table columns
              studioRequest<unknown>(sc, "/ide-authority/v1/projectDataSources/getDataObjectMeta", {
                id: sourceDs.id, nameSpace: argv["source-db"] as string, dataObjectName: argv["source-table"] as string,
              }),
              // Check target table columns in Lakehouse (to see if it exists)
              studioRequest<unknown>(sc, "/ide-authority/v1/projectDataSources/getDataObjectMeta", {
                id: targetDsId, nameSpace: targetSchema, dataObjectName: sinkTargetTable,
              }).catch(() => null),
            ])
            const metaData = (metaResp.data as Record<string, unknown> | null) ?? {}
            const sourceColumns = (Array.isArray((metaData as Record<string, unknown>).columns)
              ? (metaData as Record<string, unknown>).columns
              : Array.isArray(metaData) ? metaData : []) as Record<string, unknown>[]
            if (sourceColumns.length === 0) {
              error("NO_COLUMNS", `Cannot fetch columns for ${argv["source-db"]}.${argv["source-table"]}.`, { format, exitCode: 2 }); return
            }
            // Check target table existence
            const targetCols = (() => {
              if (!targetColsResp) return null
              const d = ((targetColsResp as unknown) as Record<string, unknown>).data as Record<string, unknown> | null
              if (!d) return null
              const cols = (d as Record<string, unknown>).columns
              return Array.isArray(cols) && cols.length > 0 ? cols : null
            })()
            const targetTableExists = targetCols !== null
            // DB type groupings for dsType-specific behavior
            const dsType = sourceDs.dsType ?? 0
            const MYSQL_LIKE  = new Set([5, 17, 18, 19, 39])   // MySQL, TiDB, MariaDB, PolarDB MySQL, Aurora MySQL
            const PG_LIKE     = new Set([7, 22, 40, 46, 48])   // PostgreSQL, Greenplum, Aurora PG, Redshift, PolarDB PG
            const ORACLE_LIKE = new Set([25, 21])               // Oracle, DB2
            const SS_LIKE     = new Set([8])                    // SQLServer
            const COMPAT_LIKE = new Set([4, 14, 15, 16])       // ClickHouse, Doris, StarRocks, SelectDB (MySQL-like SQL)
            const NO_SPLITPK  = new Set([2, 12, 13, 43, 51])   // Kafka, MongoDB, ES, Redis, DynamoDB
            const NO_WHERE    = new Set([2, 9, 27, 38, 43, 51]) // Streaming/object-store/KV

            // where clause format differs by DB
            const BIZDATE = '${bizdate}'
            const buildWhereClause = (colName: string): string => {
              if (PG_LIKE.has(dsType))     return `${colName} >= '${BIZDATE}'::date`
              if (ORACLE_LIKE.has(dsType)) return `${colName} >= TO_DATE('${BIZDATE}', 'YYYY-MM-DD')`
              return `${colName} >= '${BIZDATE}'`  // MySQL, SQLServer, ClickHouse, Doris, etc.
            }

            // Infer recommended splitPk (only for types that support it)
            const supportsSplitPk = !NO_SPLITPK.has(dsType)
            const primaryCols = sourceColumns.filter((c) => c.primary === true || c.isPrimary === true)
            // Good splitPk candidates: INT/BIGINT/SERIAL with wide range — exclude TINYINT/SMALLINT (too narrow for effective splitting)
            const splitPkTypes = new Set(['INT','INTEGER','BIGINT','MEDIUMINT','SERIAL','BIGSERIAL','INT4','INT8','INT2'])
            const splitPkExclude = new Set(['TINYINT','SMALLINT','INT2'])
            const numericTypes = new Set(['INT','INTEGER','BIGINT','SMALLINT','TINYINT','MEDIUMINT','SERIAL','BIGSERIAL'])
            const numericCols = sourceColumns.filter((c) => numericTypes.has(String(c.type ?? "").toUpperCase().split("(")[0].trim()))
            const splitPkCols = sourceColumns.filter((c) => {
              const t = String(c.type ?? "").toUpperCase().split("(")[0].trim()
              return splitPkTypes.has(t) && !splitPkExclude.has(t)
            })
            const recommendedSplitPk = supportsSplitPk && primaryCols.length > 0
              ? primaryCols[0]?.name
              : null
            const splitPkIsValid = recommendedSplitPk != null && (
              primaryCols.some(c => c.name === recommendedSplitPk) ||
              numericCols.some(c => c.name === recommendedSplitPk)
            )

            // Detect incremental column for write_mode + where inference
            // Only applies to relational/Hive DBs; streaming/KV types don't use where
            const supportsIncremental = !NO_WHERE.has(dsType)
            const UPDATE_TIME_PAT = /^(update_time|updated_at|gmt_modif(y|ied)|modify_time|last_modified|update_date)$/i
            const CREATE_TIME_PAT = /^(create_time|created_at|gmt_create|create_date)$/i
            const updateTimeCol = supportsIncremental
              ? sourceColumns.find(c => UPDATE_TIME_PAT.test(String(c.name ?? "")))
              : undefined
            const createTimeCol = supportsIncremental
              ? sourceColumns.find(c => CREATE_TIME_PAT.test(String(c.name ?? "")))
              : undefined
            const incrementalCol = updateTimeCol ?? createTimeCol
            const recommendedWriteMode = incrementalCol ? "APPEND" : "OVERWRITE"
            // ${bizdate} is a built-in system param injected by scheduler (previous day date)
            const recommendedWhere = incrementalCol
              ? buildWhereClause(String(incrementalCol.name))
              : null

            // Column alignment check (only when target table exists)
            // Source type → expected Lakehouse type
            const SRC_TO_LH: Record<string, string> = {
              BIGINT:'bigint', INT:'int', INTEGER:'int', MEDIUMINT:'int',
              SMALLINT:'smallint', TINYINT:'tinyint',
              FLOAT:'float', REAL:'float', DOUBLE:'double',
              VARCHAR:'string', CHAR:'string', TEXT:'string', LONGTEXT:'string',
              TINYTEXT:'string', MEDIUMTEXT:'string', CLOB:'string', NVARCHAR:'string',
              BOOLEAN:'boolean', BOOL:'boolean', BIT:'boolean',
              DATE:'date', TIME:'time',
              DATETIME:'timestamp', TIMESTAMP:'timestamp',
              BINARY:'binary', VARBINARY:'binary', BLOB:'binary', BYTEA:'binary',
              JSON:'json', DECIMAL:'decimal', NUMERIC:'decimal', NUMBER:'decimal',
              // Complex types: pass through as-is (ARRAY/MAP/STRUCT carry element type info)
              ARRAY:'array', MAP:'map', STRUCT:'struct',
            }
            type ColAlignIssue = { name: string; source_type: string; expected_lh_type: string; actual_lh_type: string; alter_sql: string }
            type ColAlignment = {
              ok_count: number
              missing: { name: string; source_type: string; expected_lh_type: string; alter_sql: string }[]
              type_mismatch: ColAlignIssue[]
              extra_in_target: string[]
            }
            const colAlignment: ColAlignment | null = (() => {
              if (!targetCols) return null
              const targetMap = new Map((targetCols as Record<string, unknown>[]).map(c => [
                String(c.name ?? "").toLowerCase(),
                String(c.type ?? "").toLowerCase()
              ]))
              const missing: ColAlignment['missing'] = []
              const type_mismatch: ColAlignment['type_mismatch'] = []
              let ok_count = 0
              for (const sc of sourceColumns) {
                const colName = String(sc.name ?? "")
                const srcTypeRaw = String(sc.type ?? "").toUpperCase().split("(")[0].trim()
                // PostgreSQL array types use _xxx prefix (e.g. _text = text[], _int4 = int4[])
                // Map them to array<element_type>
                const normalizeSrcType = (raw: string): string => {
                  if (raw.startsWith('_')) {
                    const elem = raw.slice(1)  // _text → text, _int4 → int4
                    const elemMapped = normalizeSrcType(elem)  // recurse for element type
                    return `array<${elemMapped}>`
                  }
                  // PG integer aliases
                  if (raw === 'INT2' || raw === 'SMALLSERIAL') return 'smallint'
                  if (raw === 'INT4' || raw === 'SERIAL' || raw === 'SERIAL4') return 'int'
                  if (raw === 'INT8' || raw === 'BIGSERIAL' || raw === 'SERIAL8') return 'bigint'
                  // PG float aliases
                  if (raw === 'FLOAT4') return 'float'
                  if (raw === 'FLOAT8' || raw === 'DOUBLE PRECISION') return 'double'
                  // PG numeric
                  if (raw === 'NUMERIC') return 'decimal'
                  // PG time with tz
                  if (raw === 'TIMESTAMPTZ') return 'timestamp'
                  // PG timestamp without tz — use timestamp (timestamp_ntz not supported by INTEGRATION sink)
                  if (raw === 'TIMESTAMP') return 'timestamp'
                  // PG char types
                  if (raw === 'BPCHAR') return 'string'  // blank-padded char = CHAR
                  if (raw === 'NAME') return 'string'    // PG system type, ~64 chars
                  // PG misc → string (LLM should verify)
                  if (raw === 'UUID') return 'string'
                  if (raw === 'TSVECTOR' || raw === 'TSQUERY') return 'string'
                  if (raw === 'INTERVAL') return 'string'
                  if (raw === 'TIMETZ') return 'string'   // time with tz, no direct Lakehouse equivalent
                  if (raw === 'OID' || raw === 'XID' || raw === 'CID') return 'bigint'
                  if (raw === 'VARBIT') return 'binary'
                  if (raw === 'JSONB') return 'json'
                  // pgvector → ask LLM to use VECTOR(FLOAT, dim)
                  if (raw === 'VECTOR') return 'string'
                  return SRC_TO_LH[raw] ?? raw.toLowerCase()
                }
                const expectedLhType = normalizeSrcType(srcTypeRaw)
                const targetType = targetMap.get(colName.toLowerCase())
                if (targetType === undefined) {
                  missing.push({
                    name: colName,
                    source_type: srcTypeRaw,
                    expected_lh_type: expectedLhType,
                    alter_sql: `ALTER TABLE ${targetSchema}.${sinkTargetTable} ADD COLUMN ${colName} ${expectedLhType};`,
                  })
                } else {
                  // Check compatibility: target type starts with expected (e.g. "decimal(10,2)" matches "decimal")
                  // Also handle Lakehouse physical type aliases: int64=bigint, int32=int, float64=double, etc.
                  const LH_ALIASES: Record<string, string> = {
                    'int64': 'bigint', 'int32': 'int', 'int16': 'smallint', 'int8': 'tinyint',
                    'float32': 'float', 'float64': 'double',
                    'utf8': 'string', 'large_utf8': 'string',
                    'timestamp_ntz': 'timestamp_ntz', 'timestamp_ltz': 'timestamp_ltz',
                  }
                  const normalizedTarget = LH_ALIASES[targetType] ?? targetType
                  // Complex types (array/map/struct): match by prefix — ARRAY<int> matches array
                  const compat = normalizedTarget.startsWith(expectedLhType) || expectedLhType.startsWith(normalizedTarget)
                  if (!compat) {
                    type_mismatch.push({
                      name: colName, source_type: srcTypeRaw, expected_lh_type: expectedLhType,
                      actual_lh_type: targetType,
                      alter_sql: `ALTER TABLE ${targetSchema}.${sinkTargetTable} MODIFY COLUMN ${colName} ${expectedLhType};`,
                    })
                  } else {
                    ok_count++
                  }
                }
              }
              const sourceNames = new Set(sourceColumns.map(c => String(c.name ?? "").toLowerCase()))
              const extra_in_target = [...targetMap.keys()].filter(n => !sourceNames.has(n))
              return { ok_count, missing, type_mismatch, extra_in_target }
            })()

            // Partition suggestion (only when target table does NOT exist)
            const timeColForPartition = !targetTableExists ? sourceColumns.find(c => {
              const t = String(c.type ?? "").toUpperCase().split("(")[0].trim()
              const n = String(c.name ?? "").toLowerCase()
              return (t === 'TIMESTAMP' || t === 'DATETIME' || t === 'DATE') &&
                (n.includes('create') || n.includes('update') || n.includes('time') || n.includes('date'))
            }) : undefined
            const partitionSuggestion = (() => {
              if (!timeColForPartition) return null
              const col = String(timeColForPartition.name)
              const tbl = sinkTargetTable.toLowerCase()
              // Infer granularity from table name patterns
              const granularity = /log|event|click|access|track|behavior|action/.test(tbl) ? 'day'
                : /order|transact|payment|trade|invoice/.test(tbl) ? 'day'
                : /summary|report|agg|stat|monthly/.test(tbl) ? 'month'
                : 'day'
              const truncExpr = granularity === 'month'
                ? `date_trunc('month', ${col})`
                : `date_trunc('day', ${col})`
              return {
                column: col,
                granularity,
                ddl_hint: `PARTITION BY ${truncExpr}`,
              }
            })()

            logOperation("task offline-sync-schema", { ok: true })
            success({
              task_id: fileId,
              source: { datasource_id: sourceDs.id, datasource_name: sourceDs.name, ds_type: sourceDs.dsType, db: argv["source-db"], table: argv["source-table"] },
              target: {
                datasource_id: targetDsId, datasource_name: targetDsName, ds_type: 1,
                schema: targetSchema, table: sinkTargetTable,
                table_exists: targetTableExists,
                existing_columns: targetCols ?? undefined,
              },
              source_columns: sourceColumns,
              recommendations: {
                split_pk: recommendedSplitPk,
                split_pk_valid: splitPkIsValid,
                write_mode: recommendedWriteMode,
                parallelism: 1,
                where: recommendedWhere,
                incremental_col: incrementalCol?.name ?? null,
              },
              // Source params template varies by datasource type
              source_params_template: (() => {
                const dt = sourceDs.dsType
                if (dt === 3) return { // Hive: NO table/database in params
                  note: "Hive source: table and database are ONLY in dataObject/namespace, NOT in params. No splitPk support. Incremental is done via partition filters, not where clause.",
                  params: { dsType: dt, operatorType: "source" }
                }
                if (dt === 2) return { // Kafka
                  note: "Kafka source: no splitPk or where support. offset='latest' reads new messages; use 'earliest' for full replay.",
                  params: { dsType: dt, operatorType: "source", topic: "<topic_name>", groupId: "<consumer_group>", offset: "latest" }
                }
                if (dt === 9 || dt === 27 || dt === 38) return { // OSS/COS/S3
                  note: "Object storage source: path-based, no splitPk or where support.",
                  params: { dsType: dt, operatorType: "source", path: "<path>", fileType: "CSV", encoding: "UTF-8" }
                }
                if (dt === 12) return { // MongoDB
                  note: "MongoDB source: no splitPk support. Use filter param for conditional sync (MongoDB query syntax).",
                  params: { dsType: dt, operatorType: "source", table: "<collection_name>", database: argv["source-db"] as string }
                }
                if (ORACLE_LIKE.has(dt ?? 0)) return { // Oracle / DB2
                  note: `Oracle/DB2: 'database' = schema name (not instance name). where format: col >= TO_DATE('${BIZDATE}', 'YYYY-MM-DD'). splitPk must be numeric.`,
                  params: { dsType: dt, operatorType: "source", table: argv["source-table"] as string, database: argv["source-db"] as string,
                    ...(recommendedSplitPk != null ? { splitPk: recommendedSplitPk } : {}),
                    ...(recommendedWhere != null ? { where: recommendedWhere } : {}),
                  }
                }
                if (PG_LIKE.has(dt ?? 0)) return { // PostgreSQL family
                  note: `PostgreSQL/Greenplum/Redshift: where clause needs explicit cast: col >= '${BIZDATE}'::date. splitPk supported.`,
                  params: { dsType: dt, operatorType: "source", table: argv["source-table"] as string, database: argv["source-db"] as string,
                    ...(recommendedSplitPk != null ? { splitPk: recommendedSplitPk } : {}),
                    ...(recommendedWhere != null ? { where: recommendedWhere } : {}),
                  }
                }
                if (SS_LIKE.has(dt ?? 0)) return { // SQLServer
                  note: `SQLServer: default schema is 'dbo'. where format: col >= '${BIZDATE}'. splitPk supported.`,
                  params: { dsType: dt, operatorType: "source", table: argv["source-table"] as string, database: argv["source-db"] as string,
                    ...(recommendedSplitPk != null ? { splitPk: recommendedSplitPk } : {}),
                    ...(recommendedWhere != null ? { where: recommendedWhere } : {}),
                  }
                }
                // MySQL family + ClickHouse/Doris/StarRocks + default relational
                const isMysqlFamily = MYSQL_LIKE.has(dt ?? 0)
                const isAnalytic = COMPAT_LIKE.has(dt ?? 0)
                const note = isMysqlFamily
                  ? `MySQL/TiDB/MariaDB: where format: col >= '${BIZDATE}'. splitPk supported (use numeric primary key).`
                  : isAnalytic
                  ? `ClickHouse/Doris/StarRocks: MySQL-compatible SQL, where format: col >= '${BIZDATE}'. splitPk supported.`
                  : `Relational DB: standard JDBC params. where format: col >= '${BIZDATE}'.`
                return {
                  note,
                  params: { dsType: dt, operatorType: "source", table: argv["source-table"] as string, database: argv["source-db"] as string,
                    ...(recommendedSplitPk != null ? { splitPk: recommendedSplitPk } : {}),
                    ...(recommendedWhere != null ? { where: recommendedWhere } : {}),
                  }
                }
              })(),
              ...(partitionSuggestion && { partition_suggestion: partitionSuggestion }),
              ...(colAlignment && { col_alignment: colAlignment }),
            }, {
              format,
              aiMessage: (() => {
                const lines: string[] = []

                // --- Summary ---
                lines.push(`Retrieved ${sourceColumns.length} columns from ${argv["source-db"]}.${argv["source-table"]}.`)
                lines.push(`Target table ${targetSchema}.${sinkTargetTable}: ${targetTableExists ? "EXISTS ✓" : "NOT EXISTS"}`)

                // --- Inferred config ---
                lines.push(`\n**Inferred configuration:**`)
                if (incrementalCol) {
                  lines.push(`- Incremental column detected: ${String(incrementalCol.name)} → write_mode=APPEND, where="${recommendedWhere}"`)
                  lines.push(`  (\${bizdate} is the scheduler date parameter — confirm with user what date range each run should cover)`)
                } else {
                  lines.push(`- No incremental column detected → write_mode=OVERWRITE (full reload each run)`)
                }
                if (recommendedSplitPk) {
                  const pkNote = primaryCols.some(c => c.name === recommendedSplitPk) ? "primary key" : "first numeric col"
                  lines.push(`- splitPk: ${String(recommendedSplitPk)} (${pkNote}) — enables range-split parallel reads; ask user whether to increase parallelism`)
                } else {
                  lines.push(`- splitPk: none (no suitable split column found) — confirm with user if a custom split column is needed`)
                }

                // --- Column alignment (target exists) ---
                if (colAlignment) {
                  lines.push(`\n**Column alignment check:**`)
                  if (colAlignment.missing.length === 0 && colAlignment.type_mismatch.length === 0) {
                    lines.push(`- ✓ All ${colAlignment.ok_count} columns match`)
                  } else {
                    if (colAlignment.ok_count > 0) lines.push(`- ✓ ${colAlignment.ok_count} columns OK`)
                    if (colAlignment.missing.length > 0) {
                      lines.push(`- ⚠ Missing columns in target (run these BEFORE deploy):`)
                      colAlignment.missing.forEach(m => lines.push(`    ${m.alter_sql}`))
                    }
                    if (colAlignment.type_mismatch.length > 0) {
                      lines.push(`- ⚠ Type mismatches (review and fix if needed):`)
                      colAlignment.type_mismatch.forEach(m =>
                        lines.push(`    ${m.name}: source ${m.source_type}→${m.expected_lh_type}, target has ${m.actual_lh_type}`)
                      )
                    }
                  }
                  if (colAlignment.extra_in_target.length > 0)
                    lines.push(`- ℹ Extra columns in target (not in source, will not be written): ${colAlignment.extra_in_target.join(", ")}`)
                }

                // --- Partition suggestion (target not exists) ---
                if (partitionSuggestion) {
                  lines.push(`\n**Partition suggestion** (target table does not exist yet):`)
                  lines.push(`- Detected time column: ${String(partitionSuggestion.column)} — confirm with user whether partitioning makes sense for this table.`)
                  lines.push(`  Partitioning principle: beneficial when queries commonly filter by time range and the table is large enough that partition pruning matters. Not worth the overhead for small or rarely-queried tables.`)
                  lines.push(`  Granularity principle: choose the coarsest granularity that still gives useful pruning — day for high-frequency data, month or year for sparse/aggregated data. Ask the user about expected data volume and query patterns.`)
                  lines.push(`  If partitioned: ${partitionSuggestion.ddl_hint} — set sink.params.is_partition=true in config JSON`)
                }

                // --- Confirm with user (only non-inferred items) ---
                lines.push(`\n**Confirm with user before proceeding:**`)
                lines.push(`1. Target: ${targetSchema}.${sinkTargetTable} — correct schema/table?`)
                if (incrementalCol) {
                  lines.push(`2. WHERE condition "${recommendedWhere}" — does this incremental filter fit your use case?`)
                  lines.push(`   If you need full reload instead: use write_mode=OVERWRITE and remove the where condition`)
                } else {
                  lines.push(`2. No incremental column found — confirm full OVERWRITE each run is acceptable`)
                  lines.push(`   Or specify a custom where condition if you want partial sync`)
                }
                lines.push(`3. Sync VCluster: run 'cz-cli sql --sync "SHOW VCLUSTERS"' to list VClusters with VCLUSTER_TYPE=INTEGRATION`)
                lines.push(`   If none exists: CREATE VCLUSTER IF NOT EXISTS sync_vc VCLUSTER_TYPE=INTEGRATION VCLUSTER_SIZE=1 AUTO_RESUME=TRUE;`)

                // --- Next step ---
                lines.push(`\nAfter confirming, generate config JSON and call:`)
                lines.push(`cz-cli task save-offline-sync ${fileId} --config '<json>' --vc <sync_vc_name>`)

                // --- Type mapping rules ---
                lines.push(`\nLakehouse type system principles (use these to derive mappings, not a fixed lookup table):`)
                lines.push(`- Numeric: TINYINT/SMALLINT/INT/BIGINT/FLOAT/DOUBLE/DECIMAL(p,s) map directly. MySQL UNSIGNED integers promote one size up (e.g. INT UNSIGNED → bigint). Use DECIMAL for money/exact values.`)
                lines.push(`- String: all char/text variants → STRING (recommended default). VARCHAR(n)/CHAR(n) only if length constraint is meaningful.`)
                lines.push(`- Time: use TIMESTAMP for all datetime columns in INTEGRATION sink (timestamp_ntz is NOT supported by the sync engine). DATE and TIME map directly.`)
                lines.push(`- Boolean/Binary/JSON map directly. ARRAY<T>/MAP<K,V>/STRUCT<f:T> keep same syntax. VECTOR(type,dim) for embeddings. BITMAP for cardinality estimation.`)
                lines.push(`- PostgreSQL native types: int4/int8→int/bigint, float4/float8→float/double, timestamptz→TIMESTAMP, _text/_int4 etc (underscore prefix) are arrays→array<element_type>. pgvector 'vector' type → VECTOR(FLOAT, dim) — confirm dimension with user.`)
                lines.push(`- When uncertain: prefer the wider/safer type (e.g. STRING over VARCHAR, BIGINT over INT, DOUBLE over FLOAT). Correctness > compactness.`)

                // --- Config JSON template ---
                lines.push(`\nConfig JSON structure (use source_params_template.params for source.params):`)
                lines.push(`{"templateKey":1,"userParams":{},"sourceConnection":{"datasourceId":<id>,"datasourceName":"<name>","type":<dsType>},"sinkConnection":{"datasourceId":<id>,"datasourceName":"<name>","type":1},"jobs":[{"source":{"dataObject":"<table>","namespace":"<db>","params":<source_params_template.params with splitPk and where added>,"columns":[...source columns as-is...]},"sink":{"dataObject":"<table>","namespace":"<schema>","params":{"dsType":1,"writeMode":"${recommendedWriteMode}","operatorType":"sink","table":"<table>","database":"<schema>","is_partition":false},"columns":[...same columns with Lakehouse types...]},"setting":{"parallelism":1,"errorLimit":{"maxCount":-1,"collectDirtyData":true,"record":-1}},"columnMapping":{"col":"col",...}}]}`)

                return lines.join("\n")
              })(),
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "save-offline-sync <task>",
        "Save INTEGRATION task configuration with agent-generated field mapping",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("config", {
              type: "string", demandOption: true,
              describe: "Integration config JSON (output from agent after reviewing integration-schema). Must contain templateKey, sourceConnection, sinkConnection, jobs[].",
            })
            .option("vc", { type: "string", describe: "VCluster for execution" })
            .option("target-schema", { type: "string", default: "public", describe: "Target schema (used in adhocConfigs)" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            // Parse and validate config JSON
            let integrationConfig: Record<string, unknown>
            try {
              const raw = (argv.config as string).replace(/^'|'$/g, "")
              integrationConfig = JSON.parse(raw)
            } catch {
              error("INVALID_ARGUMENTS", "--config is not valid JSON. Pass the JSON string output from 'task offline-sync-schema' after agent mapping.", { format, exitCode: 2 }); return
            }
            if (!integrationConfig.jobs || !integrationConfig.sourceConnection || !integrationConfig.sinkConnection) {
              error("INVALID_ARGUMENTS", "--config JSON must have templateKey, sourceConnection, sinkConnection, and jobs fields.", { format, exitCode: 2 }); return
            }
            const vcCode = (argv.vc as string | undefined) ?? "DEFAULT"
            // Resolve VC name to numeric ID for scheduler
            let etlVcId: string | number | undefined
            if (vcCode && vcCode !== "DEFAULT") {
              etlVcId = await resolveVclusterId(sc, vcCode).catch(() => undefined)
            }
            const adhocConfigs = JSON.stringify({
              multiDataSource: [],
              schema: argv["target-schema"] as string,
              adhocVcCode: vcCode,
            })
            await saveTaskContent(sc, {
              dataFileId: fileId,
              dataFileContent: JSON.stringify(integrationConfig),
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.instanceName,
              replaceEscapedChars: false,
              adhocConfigs,
            })
            // Also save etlVcCode/etlVcId for scheduled execution
            // Read existing config to preserve cron and other settings
            const existingCfg = await getTaskConfigDetail(sc, { projectId: sc.projectId, workspaceId: sc.workspaceId, dataFileId: fileId }).catch(() => null)
            const oldData = (existingCfg?.data as Record<string, unknown> | undefined) ?? {}
            const existingCron = oldData.cronExpress as string | undefined
            if (vcCode && vcCode !== "DEFAULT" && existingCron) {
              // Only update scheduler config when a cron is already set (otherwise let save-cron handle it)
              await saveTaskConfig(sc, {
                dataFileId: fileId,
                projectId: sc.projectId,
                updateBy: String(sc.userId),
                instanceName: sc.instanceName,
                cronExpress: existingCron,
                schemaName: (argv["target-schema"] as string | undefined) ?? (oldData.schemaName as string | undefined) ?? "public",
                etlVcCode: vcCode,
                etlVcId: etlVcId as number | undefined,
                retryCount: (oldData.retryCount as number | undefined) ?? 1,
                retryIntervalTime: (oldData.retryIntervalTime as number | undefined) ?? 1,
                retryIntervalTimeUnit: (oldData.retryIntervalTimeUnit as string | undefined) ?? "m",
                rerunProperty: String((oldData.rerunProperty as number | undefined) ?? 3),
                selfDependsJob: (oldData.selfDependsJob as number | undefined) ?? 0,
                executeTimeout: (oldData.executeTimeout as number | undefined) ?? 0,
                activeStartTime: formatIsoStartOfDay(oldData.activeStartTime as string | undefined),
                activeEndTime: formatIsoStartOfDay((oldData.activeEndTime as string | undefined) ?? "2099-01-01"),
                ownerEnName: (oldData.ownerEnName as string | undefined),
                ownerCnName: (oldData.ownerCnName as string | undefined),
                configProperties: (oldData.configProperties as Record<string, unknown> | undefined),
              })
            }
            // Verify the content was actually saved by reading it back
            const verify = await getTaskDetail(sc, fileId)
            const verifyData = (verify.data && typeof verify.data === "object" ? verify.data : {}) as Record<string, unknown>
            const savedContent = verifyData.fileContent ?? verifyData.dataFileContent
            if (!savedContent || String(savedContent).length < 10) {
              error("SAVE_FAILED", "Integration config was not saved — server returned empty content. Check datasource IDs and config structure.", { format, exitCode: 2 }); return
            }
            // Validate saved JSON parses correctly
            try { JSON.parse(String(savedContent)) } catch {
              error("SAVE_FAILED", "Integration config saved but content is not valid JSON. Review the --config input.", { format, exitCode: 2 }); return
            }
            const jobs = Array.isArray(integrationConfig.jobs) ? integrationConfig.jobs as Record<string, unknown>[] : []
            const colCount = Array.isArray((jobs[0] as Record<string, unknown>)?.source) ? 0 :
              ((jobs[0] as Record<string, unknown>)?.source as Record<string, unknown>)?.columns as unknown[]
            logOperation("task save-offline-sync", { ok: true })
            success({
              task_id: fileId,
              jobs_count: jobs.length,
              studio_url: studioUrl(sc, fileId),
            }, {
              format,
              aiMessage: `Integration task configured. Review in Studio: ${studioUrl(sc, fileId)}\n` +
                `Next: configure schedule with 'cz-cli task save-cron ${fileId} --cron <expr> --vc <vc>', then deploy with: cz-cli task deploy ${fileId} -y`,
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "save-realtime-sync <task>",
        "Configure CDC multi-table real-time sync task (MULTI_REALTIME type) with source and target datasource",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true, describe: "Task name or ID (must be MULTI_REALTIME type)" })
            .option("source", { type: "string", demandOption: true, describe: "Source datasource name or ID" })
            .option("database", { type: "string", demandOption: true, describe: "Source database/schema to sync" })
            .option("tables", { type: "string", describe: "Comma-separated table names to sync. Omit for whole-database mirror." })
            .option("target", { type: "string", describe: "Target Lakehouse datasource name or ID (auto-resolves if omitted)" })
            .option("vc", { type: "string", describe: "Virtual cluster name for CDC execution (e.g. FLINK_ON_VC)" })
            .option("slot-name", { type: "string", describe: "PostgreSQL replication slot name (auto-detected for PG sources if omitted)" })
            .option("logic-plugin", { type: "string", default: "pgoutput", describe: "PostgreSQL logical replication plugin (default: pgoutput)" })
            .option("pipeline-type", {
              type: "number", default: 3,
              describe: "1=multi-table mirror (specific tables), 2=multi-table merge (sharding), 3=whole-database mirror (default)",
            })
            .option("sync-mode", {
              type: "number", default: 1,
              describe: "1=full+incremental (default, recommended for first run), 2=incremental only",
            })
            .option("skip-check", {
              type: "boolean", default: false,
              describe: "Skip CDC prerequisite check (binlog/WAL validation)",
            }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)

            // Resolve source datasource
            const sourceDs = await resolveDatasource(sc, String(argv.source))
            if (!sourceDs.dsType) {
              error("INVALID_ARGUMENTS", `Cannot determine dsType for source datasource '${argv.source}'. Specify a valid datasource.`, { format, exitCode: 2 }); return
            }

            // CDC prerequisite check (skip with --skip-check)
            if (!(argv["skip-check"] as boolean)) {
              const check = await checkCdcPrereqs(sc, sourceDs as { id: number; name: string; dsType: number }, String(argv.source))
              if (!check.ok) { error("CDC_PREREQ_FAILED", check.message, { format, exitCode: 2 }); return }
            }

            // Resolve target datasource (Lakehouse only)
            let targetDsId: number
            let targetDsType = 1
            if (argv.target) {
              const targetDs = await resolveDatasource(sc, String(argv.target))
              if ((targetDs.dsType ?? 1) !== 1) {
                error("INVALID_ARGUMENTS", `CDC multi-table sync only supports Lakehouse as target. '${targetDs.name}' is not a Lakehouse datasource.`, { format, exitCode: 2 }); return
              }
              targetDsId = targetDs.id
              targetDsType = 1
            } else {
              // Auto-find Lakehouse datasource matching current workspace
              const lhDs = await autoResolveLakehouseDs(sc)
              if (!lhDs) {
                error("DATASOURCE_NOT_FOUND", "No Lakehouse datasource found. Please specify --target <datasource_name>.", { format, exitCode: 2 }); return
              }
              targetDsId = lhDs.id
            }

            // Build sync object list
            const tablesArg = argv.tables as string | undefined
            const pipelineType = argv["pipeline-type"] as number
            const syncObjectList = tablesArg
              ? tablesArg.split(",").map((t) => ({ schemaName: argv.database as string, tableName: t.trim() }))
              : [{ schemaName: argv.database as string }]

            // If tables specified but pipeline-type is 3, auto-switch to 1
            const effectivePipelineType = tablesArg && pipelineType === 3 ? 1 : pipelineType

            // PG (dsType=7,22,40,46,48): resolve slot name
            const PG_TYPES = new Set([7, 22, 40, 46, 48])
            const isPg = PG_TYPES.has(sourceDs.dsType)
            let slotName = argv["slot-name"] as string | undefined
            const logicPlugin = (argv["logic-plugin"] as string | undefined) ?? "pgoutput"

            if (isPg && !slotName) {
              // Auto-detect: use first available inactive slot
              const slotResp = await listPgSlots(sc, [sourceDs.id]).catch(() => null)
              const slots = slotResp?.data?.find((s: { datasourceId: number }) => s.datasourceId === sourceDs.id)?.pipelineSlotMetaVos ?? []
              if (slots.length > 0) {
                slotName = slots[0].slotName
              } else {
                error("PG_SLOT_REQUIRED", `No replication slots found on datasource '${sourceDs.name}'. Create a slot in PostgreSQL first, then pass --slot-name <slot>.`, { format, exitCode: 2 }); return
              }
            }

            const resp = await saveCdcTask(sc, {
              dataFileId: fileId,
              projectId: sc.projectId,
              pipelineType: effectivePipelineType,
              syncMode: argv["sync-mode"] as number,
              sourceDatasourceList: [{
                datasourceId: sourceDs.id,
                datasourceType: sourceDs.dsType,
                ...(isPg && slotName && { slotName, logicPlugin }),
              }],
              syncObjectList,
              targetDatasource: { datasourceId: targetDsId, datasourceType: targetDsType },
            })

            // Save VC config if --vc specified
            const vcName = argv.vc as string | undefined
            if (vcName) {
              const resolvedVcId = await resolveVclusterId(sc, vcName).catch(() => undefined)
              await saveTaskConfig(sc, {
                dataFileId: fileId,
                projectId: sc.projectId,
                updateBy: String(sc.userId),
                instanceName: sc.workspaceName,
                etlVcCode: vcName,
                ...(resolvedVcId != null && { etlVcId: resolvedVcId }),
                activeStartTime: new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
                activeEndTime: "2099-01-01T00:00:00.000Z",
              }).catch(() => null)
            }

            logOperation("task save-realtime-sync", { ok: true })
            success({
              task_id: fileId,
              pipeline_type: effectivePipelineType === 1 ? "multi-table mirror" : effectivePipelineType === 2 ? "multi-table merge" : "whole-database mirror",
              source: { datasource: sourceDs.name, database: argv.database, tables: tablesArg ?? "all", ...(isPg && slotName && { slot: slotName, logic_plugin: logicPlugin }) },
              target: { datasource_id: targetDsId, ds_type: targetDsType },
              sync_mode: argv["sync-mode"] === 1 ? "full+incremental" : "incremental only",
              studio_url: studioUrl(sc, fileId),
              raw: resp.data,
            }, {
              format,
              aiMessage: `CDC task configured. Deploy with: cz-cli task deploy ${fileId} -y\nNote: CDC tasks run continuously after deploy — no cron schedule needed.`,
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "save-cron <task>",
        "Save cron schedule configuration (preserves non-cron settings)",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("cron", { type: "string", demandOption: true, describe: "Cron expression — ClickZetta uses 7-field format: second minute hour day month weekday year (e.g. '0 30 9 * * ? *' = daily 09:30)" })
            .option("vc", { type: "string", describe: "Virtual cluster code" })
            .option("vc-id", { type: "string", describe: "Virtual cluster ID" })
            .option("schema", { type: "string", describe: "Schema name" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const cronResult = convertAgentCron(argv.cron as string)
            if (!cronResult.ok || !cronResult.outputCron) {
              error("INVALID_CRON", cronResult.error ?? "Invalid cron expression", { format, exitCode: 2 })
              return
            }
            // Fetch existing config to merge
            const oldResp = await getTaskConfigDetail(sc, { projectId: sc.projectId, workspaceId: sc.workspaceId, dataFileId: fileId })
            const oldData = (oldResp.data && typeof oldResp.data === "object" ? oldResp.data : {}) as Record<string, unknown>
            // Build configProperties with schedule times from UI param
            const oldConfigProps = (() => {
              const raw = oldData.configProperties
              if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return {} } }
              return typeof raw === "object" && raw ? raw : {}
            })() as Record<string, unknown>
            // Python: pop old schedule times, then add new from ui_param
            delete oldConfigProps["scheduleStartTime"]
            delete oldConfigProps["scheduleEndTime"]
            if (cronResult.uiParam.scheduleStartTime) oldConfigProps["scheduleStartTime"] = cronResult.uiParam.scheduleStartTime
            if (cronResult.uiParam.scheduleEndTime) oldConfigProps["scheduleEndTime"] = cronResult.uiParam.scheduleEndTime

            const vcCodeFinal = (argv.vc as string | undefined) ?? (oldData.etlVcCode as string | undefined) ?? "DEFAULT"
            // Resolve VC name to numeric ID for scheduler (mirrors frontend vcluster/list lookup)
            let etlVcIdFinal: number | string | undefined = argv["vc-id"] != null ? Number(argv["vc-id"]) : (oldData.etlVcId as number | undefined)
            if (!etlVcIdFinal && vcCodeFinal && vcCodeFinal !== "DEFAULT") {
              const resolvedId = await resolveVclusterId(sc, vcCodeFinal).catch(() => undefined)
              if (resolvedId) etlVcIdFinal = resolvedId
            }
            const resp = await saveTaskConfig(sc, {
              dataFileId: fileId,
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.instanceName,
              cronExpress: cronResult.outputCron!,
              schemaName: (argv.schema as string | undefined) ?? (oldData.schemaName as string | undefined) ?? "public",
              etlVcCode: vcCodeFinal,
              etlVcId: etlVcIdFinal as number | undefined,
              retryCount: (oldData.retryCount as number | undefined) ?? 1,
              retryIntervalTime: (oldData.retryIntervalTime as number | undefined) ?? 1,
              retryIntervalTimeUnit: (oldData.retryIntervalTimeUnit as string | undefined) ?? "m",
              rerunProperty: String((oldData.rerunProperty as number | undefined) ?? 3),
              selfDependsJob: (oldData.selfDependsJob as number | undefined) ?? 0,
              executeTimeout: (oldData.executeTimeout as number | undefined) ?? 0,
              executeTimeoutUnit: (oldData.executeTimeoutUnit as string | undefined) ?? "m",
              activeStartTime: formatIsoStartOfDay(oldData.activeStartTime as string | undefined),
              activeEndTime: formatIsoStartOfDay((oldData.activeEndTime as string | undefined) ?? "2099-01-01"),
              dataFileInputListReqs: (oldData.dataFileDependencyDTOS as unknown[]) ?? [],
              configProperties: JSON.stringify(oldConfigProps),
            })
            logOperation("task save-cron", { ok: true })
            success({ ...resp.data as object, studio_url: studioUrl(sc, fileId) }, { format, aiMessage: t("task_save_online_reminder", fileId) })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "save-schedule <task>",
        "Save non-cron task configuration (retry, deps, VC, timeout — preserves cron)",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("retry-count", { type: "number", describe: "Max retry attempts" })
            .option("retry-interval", { type: "number", describe: "Retry interval value" })
            .option("retry-unit", { type: "string", describe: "Retry interval unit (m/s)" })
            .option("rerun-property", { type: "number", describe: "Rerun policy: 1=ANY_TIME, 2=FAILED_ONLY, 3=NOT_RERUN" })
            .option("self-depends", { type: "number", describe: "Self dependency: 0=no, 1=yes" })
            .option("vc", { type: "string", describe: "Virtual cluster code" })
            .option("vc-id", { type: "string", describe: "Virtual cluster ID" })
            .option("schema", { type: "string", describe: "Schema name" })
            .option("timeout", { type: "number", describe: "Execute timeout" })
            .option("timeout-unit", { type: "string", describe: "Timeout unit (m/s)" })
            .option("deps", { type: "string", choices: ["keep", "replace", "clear"], describe: "Dependency action" })
            .option("dep-tasks", { type: "string", describe: "Dependency tasks JSON array. Each item requires taskId (number) and taskName (string), e.g. '[{\"taskId\":123,\"taskName\":\"upstream_task\"}]'" }),
        async (argv) => {
          const format = argv.format
          try {
            const configOpts = ["retry-count", "retry-interval", "retry-unit", "rerun-property", "self-depends", "vc", "vc-id", "schema", "timeout", "timeout-unit", "deps"] as const
            if (!configOpts.some((k) => argv[k] != null)) {
              error("INVALID_ARGUMENTS", "At least one configuration option is required.", { format, exitCode: 2 })
              return
            }
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            // Fetch existing config
            const oldResp = await getTaskConfigDetail(sc, { projectId: sc.projectId, workspaceId: sc.workspaceId, dataFileId: fileId })
            const oldData = (oldResp.data && typeof oldResp.data === "object" ? oldResp.data : {}) as Record<string, unknown>
            // Dependencies
            let deps: unknown[]
            const depsAction = argv.deps as string | undefined
            if (depsAction === "clear") deps = []
            else if (depsAction === "replace") {
              const raw = argv["dep-tasks"] as string | undefined
              if (!raw) { deps = [] } else {
                deps = parseDependencyTasks(raw, format, sc.projectId)
              }
            } else {
              deps = (oldData.dataFileDependencyDTOS as unknown[]) ?? []
            }

            const resp = await saveTaskConfig(sc, {
              dataFileId: fileId,
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.instanceName,
              cronExpress: (oldData.cronExpress as string | undefined) ?? "0 00 00 * * ? *",
              activeStartTime: formatIsoStartOfDay(oldData.activeStartTime as string | undefined),
              activeEndTime: formatIsoStartOfDay((oldData.activeEndTime as string | undefined) ?? "2099-01-01"),
              schemaName: (argv.schema as string | undefined) ?? (oldData.schemaName as string | undefined) ?? "",
              etlVcCode: (argv.vc as string | undefined) ?? (oldData.etlVcCode as string | undefined) ?? "DEFAULT",
              etlVcId: argv["vc-id"] != null ? Number(argv["vc-id"]) : (oldData.etlVcId as number | undefined),
              retryCount: (argv["retry-count"] as number | undefined) ?? (oldData.retryCount as number | undefined) ?? 1,
              retryIntervalTime: (argv["retry-interval"] as number | undefined) ?? (oldData.retryIntervalTime as number | undefined) ?? 1,
              retryIntervalTimeUnit: (argv["retry-unit"] as string | undefined) ?? (oldData.retryIntervalTimeUnit as string | undefined) ?? "m",
              rerunProperty: String((argv["rerun-property"] as number | undefined) ?? (oldData.rerunProperty as number | undefined) ?? 3),
              selfDependsJob: (argv["self-depends"] as number | undefined) ?? (oldData.selfDependsJob as number | undefined) ?? 0,
              executeTimeout: (argv.timeout as number | undefined) ?? (oldData.executeTimeout as number | undefined),
              executeTimeoutUnit: (argv["timeout-unit"] as string | undefined) ?? (oldData.executeTimeoutUnit as string | undefined) ?? "m",
              dataFileInputListReqs: deps,
              configProperties: oldData.configProperties ?? "{}",
            })
            logOperation("task save-schedule", { ok: true })
            success({ ...resp.data as object, studio_url: studioUrl(sc, fileId) }, { format, aiMessage: t("task_save_online_reminder", fileId) })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "deps <task>",
        "Show task dependencies (draft state)",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const configResp = await getTaskConfigDetail(sc, {
              projectId: sc.projectId,
              workspaceId: sc.workspaceId,
              dataFileId: fileId,
            })
            const configData = (
              configResp.data && typeof configResp.data === "object" ? configResp.data : {}
            ) as Record<string, unknown>
            const depDtos = Array.isArray(configData.dataFileDependencyDTOS)
              ? (configData.dataFileDependencyDTOS as Record<string, unknown>[])
              : []
            const dependencies = depDtos.map((d) => ({
              dependency_task_id: d.dependencyFileId ?? d.dataFileId,
              dependency_task_name: d.dependencyFileName ?? d.dataFileName,
              dep_strategy: d.depStrategy ?? 0,
              dependency_project_id: d.dependencyProjectId,
            }))
            const result = {
              task_id: fileId,
              self_depends_job: configData.selfDependsJob ?? 0,
              dependencies,
            }
            logOperation("task deps", { ok: true })
            success(result, { format, aiMessage: t("task_deps") })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        ["deploy <task>", "online <task>"],
        "Publish/online a task",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .version(false)
            .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip confirmation" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const detail = await getTaskDetail(sc, fileId)
            const taskDetailData = detail.data as Record<string, unknown> | undefined
            const taskDetailInner = (typeof taskDetailData?.taskDetail === "object" && taskDetailData?.taskDetail !== null
              ? taskDetailData.taskDetail : taskDetailData) as Record<string, unknown> | undefined
            const fileType = Number(
              taskDetailInner?.fileType ?? taskDetailInner?.file_type ?? 0,
            )
            if (fileType === 500) {
              error(
                "TASK_ERROR",
                "Flow tasks cannot be published with task online. Use: cz-cli task flow submit <task>",
                { format },
              )
              return
            }
            // For script-based tasks (SQL/Python/Shell/JDBC), check schedule config is saved
            const SCRIPT_FILE_TYPES = new Set([4, 5, 7, 15])
            // UI_ONLY sync types need source/target configured before deploy
            const UI_ONLY_SYNC_TYPES = new Set([1, 14, 17, 280, 281, 291])
            if (UI_ONLY_SYNC_TYPES.has(fileType)) {
              const syncTypeName: Record<number, string> = {
                1: "INTEGRATION (single-table sync)", 14: "REALTIME (single-table CDC)",
                17: "STREAMING", 280: "FULL_INCREMENTAL", 281: "MULTI_REALTIME (multi-table CDC)",
                291: "MULTI_DI (multi-table offline sync)",
              }
              const typeName = syncTypeName[fileType] ?? `type=${fileType}`
              if (fileType === 281 || fileType === 291) {
                const hasConfig = taskDetailInner?.hasConfig ?? taskDetailData?.hasConfig
                if (!hasConfig) {
                  const cmd = fileType === 281
                    ? `cz-cli task save-realtime-sync ${fileId} --source <ds> --database <db>`
                    : `cz-cli task create-batch-sync <name> --source <ds> --database <db>`
                  error("NO_SYNC_CONFIG", `${syncTypeName[fileType]} task not configured. Run '${cmd}' first.`, { format, exitCode: 2 }); return
                }
              } else if (fileType === 1) {
                // INTEGRATION: check both fileContent (field mapping) and hasConfig (schedule)
                const content = String(taskDetailInner?.fileContent ?? taskDetailData?.fileContent ?? "").trim()
                if (!content || content.length < 10) {
                  error("NO_INTEGRATION_CONFIG",
                    `INTEGRATION task has no field mapping configured. Run:\n` +
                    `  cz-cli task offline-sync-schema ${fileId} --source <ds> --source-db <db> --source-table <table>\n` +
                    `  # Agent maps types, then:\n` +
                    `  cz-cli task save-offline-sync ${fileId} --config '<json>'\n` +
                    `  cz-cli task save-cron ${fileId} --cron '0 2 * * *' --vc <vc_name>`,
                    { format, exitCode: 2 }); return
                }
                const hasConfig = taskDetailInner?.hasConfig ?? taskDetailData?.hasConfig
                if (!hasConfig) {
                  error("NO_SCHEDULE_CONFIG",
                    `INTEGRATION task field mapping is saved but schedule is not configured.\n` +
                    `Run: cz-cli task save-cron ${fileId} --cron '0 2 * * *' --vc <vc_name>`,
                    { format, exitCode: 2 }); return
                }
              } else {
                // All other sync types require Studio UI configuration
                process.stderr.write(`Warning: ${typeName} task — source/target/field-mapping must be configured in Studio UI before deploying. Open: ${studioUrl(sc, fileId)}\n`)
              }
            }
            if (SCRIPT_FILE_TYPES.has(fileType)) {
              const hasConfig = taskDetailInner?.hasConfig ?? taskDetailData?.hasConfig
              if (hasConfig === false || hasConfig === 0) {
                error("NO_SCHEDULE_CONFIG", "Task schedule configuration has not been saved. Use 'cz-cli task save-cron' before deploying.", { format, exitCode: 2 }); return
              }
            }
            if (!argv.yes) {
              // Show cron so user can confirm before schedule takes effect
              const configResp = await getTaskConfigDetail(sc, { projectId: sc.projectId, workspaceId: sc.workspaceId, dataFileId: fileId })
              const configData = (configResp.data && typeof configResp.data === "object" ? configResp.data : {}) as Record<string, unknown>
              const cron = configData.cronExpress ?? (configData as any).taskConfigurationDetail?.cronExpress ?? "(not set)"
              const ok = await confirm(`Publish task ${fileId}? Cron: ${cron}\nSchedule takes effect immediately after deploy. Confirm?`)
              if (!ok) {
                success(
                  {
                    message: "Cancelled by user. No online action was executed.",
                    action: "task.online",
                    executed: false,
                  },
                  { format },
                )
                return
              }
            }
            const resp = await submitTask(sc, {
              commitMsg: "Published via cz-cli",
              dataFileId: fileId,
              projectId: sc.projectId,
              updatedBy: String(sc.userId),
            })
            logOperation("task online", { ok: true })
            success({ data: resp.data, status: "online", studio_url: studioUrl(sc, fileId) }, { format })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "start <task>",
        "Start a CDC/streaming task (MULTI_REALTIME, REALTIME, STREAMING types)",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("startup-mode", {
              type: "number",
              default: 0,
              describe: "0=无状态启动 (default), 1=从上次保存状态恢复, 4=自定义起始位置",
            })
            .option("engine-type", {
              type: "number",
              default: 5,
              describe: "Engine type (default: 5)",
            })
            .option("snapshot", {
              type: "boolean",
              default: false,
              describe: "Enable full snapshot before incremental sync",
            })
            .option("snapshot-pool-size", {
              type: "number",
              default: 1,
              describe: "Snapshot concurrency (only when --snapshot is set)",
            })
            .option("blacklist-strategy", {
              type: "number",
              default: 2,
              describe: "Blacklist strategy (default: 2)",
            })
            .option("config", {
              type: "string",
              describe:
                "JSON string for custom startup position (required when --startup-mode=4). " +
                'Array of {datasourceId, startupMode (2=指定时间|3=指定文件), startTimestamp|file+pos}. ' +
                'Example: \'[{"datasourceId":123,"startupMode":2,"startTimestamp":"1718000000000"}]\'',
            }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)

            const startupMode = argv["startup-mode"] as number
            let positionConfig: import("@clickzetta/sdk").CdcStartupPositionConfig[] | undefined
            if (startupMode === 4) {
              if (!argv.config) {
                throw new Error("--config is required when --startup-mode=4")
              }
              try {
                positionConfig = JSON.parse(argv.config as string)
              } catch {
                throw new Error("--config must be valid JSON")
              }
            }

            const resp = await (async () => {
              // REALTIME (14) uses a different API than MULTI_REALTIME (281)
              const det = await getTaskDetail(sc, fileId)
              const detObj = (det?.data as Record<string, unknown>)?.taskDetail ?? det?.data ?? {}
              const ft = Number((detObj as Record<string, unknown>).fileType ?? 0)
              if (ft === 14) {
                return startRealtimeTask(sc, fileId, String(sc.userId), sc.workspaceName, sc.projectId, startupMode)
              }
              return startCdcTask(sc, {
                fileId,
                updateBy: String(sc.userId),
                workspace: sc.workspaceName,
                startupMode,
                engineType: argv["engine-type"] as number,
                snapshotTaskSwitch: (argv.snapshot as boolean) ? 1 : 0,
                snapshotTaskPoolSize: argv["snapshot-pool-size"] as number,
                blacklistStrategy: argv["blacklist-strategy"] as number,
                config: positionConfig,
              })
            })()
            logOperation("task start", { ok: true })
            success({ task_id: fileId, action: "start", result: resp.data }, {
              format,
              aiMessage: `CDC task ${fileId} start triggered (startupMode=${startupMode}). Check status with: cz-cli task status ${fileId}`,
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "stop <task>",
        "Stop a CDC/streaming task (MULTI_REALTIME, REALTIME, STREAMING types)",
        (y) => y.positional("task", { type: "string", demandOption: true }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            // REALTIME (14) uses a different stop API
            const det = await getTaskDetail(sc, fileId)
            const detObj = (det?.data as Record<string, unknown>)?.taskDetail ?? det?.data ?? {}
            const ft = Number((detObj as Record<string, unknown>).fileType ?? 0)
            const resp = ft === 14
              ? await stopRealtimeTask(sc, fileId, String(sc.userId), sc.workspaceName, sc.projectId)
              : await stopCdcTask(sc, fileId, String(sc.userId), sc.workspaceName)
            logOperation("task stop", { ok: true })
            success({ task_id: fileId, action: "stop", result: resp.data }, {
              format,
              aiMessage: `CDC task ${fileId} stop triggered. Check status with: cz-cli task status ${fileId}`,
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        ["undeploy <task>","offline <task>"],
        "Take a task offline (clears all run instances, irreversible)",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("with-downstream", { type: "boolean", default: false, describe: "Also offline downstream tasks" })
            .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip confirmation" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            if (!argv.yes) {
              const ok = await confirm(
                `Take task ${fileId} offline? This clears ALL run instances and is IRREVERSIBLE.`,
              )
              if (!ok) {
                success(
                  {
                    message: "Cancelled by user. No offline action was executed.",
                    action: "task.offline",
                    executed: false,
                  },
                  { format },
                )
                return
              }
            }
            const resp = argv["with-downstream"]
              ? await offlineTaskWithDownstream(sc, fileId, sc.projectId)
              : await offlineTask(sc, fileId, sc.projectId)
            logOperation("task offline", { ok: true })
            success({ data: resp.data, status: "offline" }, { format })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "execute <task>",
        "Execute a task ad-hoc",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true, describe: "Task name or ID" })
            .option("vc", {
              type: "string",
              describe: "Virtual cluster code (resolves from task detail or profile if omitted)",
            })
            .option("schema", { type: "string", describe: "Schema name" })
            .option("content", { type: "string", describe: "Override script content" })
            .option("file", { alias: "f", type: "string", describe: "Read override content from file" })
            .option("param", { type: "array", string: true, describe: "Parameter KEY=VALUE" })
            .option("datasource", { type: "string", describe: "Datasource name or ID for JDBC tasks (auto-resolved from task config if omitted)" })
            .option("database", { type: "string", describe: "Database/schema to USE for JDBC tasks (auto-resolved from task config if omitted)" })
            .option("max-wait-seconds", {
              type: "number",
              default: 300,
              describe: "Max seconds to wait for completion",
            })
            .option("poll-interval", { type: "number", default: 5, describe: "Polling interval seconds" })
            .option("save-params", { type: "boolean", default: false, describe: "After execution, persist --param values back to task paramValueList so scheduled runs use the same values" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            let content = argv.content as string | undefined
            if (argv.file) content = readFileSync(argv.file as string, "utf-8")
            // Build params from --param flags
            const cliParams: Record<string, string> = {}
            if (argv.param && argv.param.length > 0) {
              for (const p of argv.param) {
                const eqIdx = p.indexOf("=")
                if (eqIdx > 0) cliParams[p.slice(0, eqIdx)] = p.slice(eqIdx + 1)
              }
            }
            // Resolve VC + content + saved paramValueList from task detail
            let vcCode = argv.vc as string | undefined
            const [detail, cfgDetail] = await Promise.all([
              getTaskDetail(sc, fileId),
              getTaskConfigDetail(sc, { projectId: sc.projectId, workspaceId: sc.workspaceId, dataFileId: fileId }).catch(() => null),
            ])
            const data = detail.data as Record<string, unknown> | undefined
            const taskDetail = (
              typeof data?.taskDetail === "object" && data?.taskDetail !== null ? data.taskDetail : data
            ) as Record<string, unknown> | undefined
            // Parse connectionParam for etlVcCode/etlVcId (set by scheduler, not in taskDetail)
            const connParam = (() => {
              const raw = (cfgDetail?.data as Record<string, unknown> | undefined)?.connectionParam
              if (!raw) return {} as Record<string, unknown>
              try { return JSON.parse(String(raw)) as Record<string, unknown> } catch { return {} as Record<string, unknown> }
            })()
            const INTEGRATION_FILE_TYPES = new Set([1, 14, 17, 280, 281, 291])
            const execFileType = Number(taskDetail?.fileType ?? data?.fileType ?? 0)
            if (!vcCode) {
              // For INTEGRATION types, skip defaultVcName (it's the general VC, not the Sync VC)
              const skipDefaultVc = INTEGRATION_FILE_TYPES.has(execFileType)
              vcCode = ((!skipDefaultVc ? (taskDetail?.defaultVcName ?? taskDetail?.default_vc_name) : undefined) ??
                connParam?.etlVcCode ??
                taskDetail?.etlVcCode ??
                taskDetail?.etl_vc_code) as string | undefined
              if (!vcCode) {
                const config = resolveConnectionConfig(argv as Record<string, unknown>)
                vcCode = config.vcluster || undefined
              }
            }
            if (!content) {
              content = (taskDetail?.taskContent ??
                taskDetail?.fileContent ??
                taskDetail?.task_content ??
                taskDetail?.dataFileContent ??
                data?.content ??
                "") as string
            }
            // Merge saved paramValueList as defaults (--param overrides)
            const savedParamList = (data?.paramValueList ?? taskDetail?.paramValueList) as {paramKey: string, paramValue: string, paramType: string}[] | undefined
            const savedDefaults: Record<string, string> = {}
            if (Array.isArray(savedParamList)) {
              for (const p of savedParamList) {
                if (p.paramKey && p.paramType === "manual") savedDefaults[p.paramKey] = p.paramValue
              }
            }
            const params = Object.keys(cliParams).length > 0 || Object.keys(savedDefaults).length > 0
              ? { ...savedDefaults, ...cliParams }
              : undefined
            // Parse adhocConfigs for JDBC datasource binding
            const adhocConfigsRaw = data?.adhocConfigs ?? taskDetail?.adhocConfigs
            const adhocConfigs = (() => {
              if (!adhocConfigsRaw) return null
              try { return JSON.parse(String(adhocConfigsRaw)) as Record<string, unknown> } catch { return null }
            })()
            // Resolve JDBC datasource: --datasource flag > adhocConfigs > none
            // When --datasource is provided, look up dsType automatically via datasource API
            let datasourceId = adhocConfigs?.datasourceId as number | undefined
            let dsType = adhocConfigs?.dsType as number | undefined
            const sessionSchemaName = (argv.database as string | undefined)
              ?? (adhocConfigs?.sessionSchemaName as string | undefined)
            // For INTEGRATION task types: override vcCode with adhocConfigs.adhocVcCode if set to a real Sync VC
            if (INTEGRATION_FILE_TYPES.has(execFileType) && !(argv.vc as string | undefined)) {
              const adhocVcFromConfig = adhocConfigs?.adhocVcCode as string | undefined
              if (adhocVcFromConfig && adhocVcFromConfig !== "default" && adhocVcFromConfig !== "DEFAULT") {
                vcCode = adhocVcFromConfig
              } else if (!vcCode || vcCode === "DEFAULT" || vcCode === "default") {
                // No valid Sync VC found anywhere — require explicit --vc
                error("INTEGRATION_VC_REQUIRED",
                  `INTEGRATION task ad-hoc execution requires a Sync VCluster.\n` +
                  `Configure via 'cz-cli task save-offline-sync ... --vc <SYNC_VC>', or\n` +
                  `pass explicitly: cz-cli task execute ${fileId} --vc <SYNC_VC_NAME>\n` +
                  `Run 'cz-cli sql --sync "SHOW VCLUSTERS"' to list available Sync VClusters.`,
                  { format, exitCode: 2 }); return
              }
            }
            if (argv.datasource != null) {
              const resolved = await resolveDatasource(sc, String(argv.datasource))
              datasourceId = resolved.id
              dsType = resolved.dsType ?? dsType
            }
            // Warn if content has unresolved ${...} placeholders after merging
            const unresolvedPlaceholders = (content ?? "").match(/\$\{[^}]+\}/g)
              ?.filter((ph) => {
                const key = ph.slice(2, -1)
                return !params?.[key] && !SYSTEM_PARAM_NAMES.has(key)
              }) ?? []
            if (unresolvedPlaceholders.length > 0) {
              process.stderr.write(`Warning: unresolved placeholders in script: ${unresolvedPlaceholders.join(", ")}. SQL tasks will fail; Python/Shell tasks will use literal placeholder strings.\n`)
            }
            if (!content) {
              error(
                "INVALID_ARGUMENTS",
                "Task content is empty. Provide --content or ensure the task has saved content.",
                { format },
              )
              return
            }
            if (!vcCode || !vcCode.trim()) {
              error(
                "INVALID_ARGUMENTS",
                "Virtual cluster (VC) is required. Provide --vc or configure vcluster in your profile.",
                { format },
              )
              return
            }
            // Resolve VC name to numeric ID (required by adhoc execute API)
            // For INTEGRATION types, also resolve etlVcId from connectionParam.etlVcCode if not already set
            let adhocVcId: string | number = vcCode
            if (INTEGRATION_FILE_TYPES.has(execFileType)) {
              const resolvedId = await resolveVclusterId(sc, vcCode).catch(() => undefined)
              if (resolvedId) adhocVcId = resolvedId
            }
            const resp = await executeAdhoc(sc, {
              updateBy: String(sc.userId),
              dataFileId: fileId,
              collectType: 0,
              maxRowSize: 5000,
              offsetLine: 0,
              offsetCol: 0,
              instanceName: sc.instanceName,
              multiDataSource: [],
              adhocVcCode: vcCode ?? "",
              adhocSchemaName: argv.schema ?? "",
              adhocVcId,
              dataFileContent: content,
              params,
              datasourceId,
              sessionSchemaName,
              dsType,
              ...(connParam?.etlVcCode != null && { etlVcCode: connParam.etlVcCode as string }),
              ...(connParam?.etlVcId != null && { etlVcId: connParam.etlVcId as string }),
            })
            const execData = resp.data as Record<string, unknown> | undefined
            const runInstanceId = execData?.scheduleInstanceId ?? execData?.instanceId
            if (runInstanceId == null) {
              logOperation("task execute failed", { ok: false})
              error(
                "EXECUTE_FAILED",
                "Can not trace execute cause no run id returned",execData ?? {})
              return
            }
            const maxWaitMs = (argv["max-wait-seconds"] as number) * 1000
            const pollMs = (argv["poll-interval"] as number) * 1000
            const deadline = Date.now() + maxWaitMs
            const STATUS_NAME: Record<number, string> = { 1: "SUCCESS", 2: "WAITING", 3: "FAILED", 4: "RUNNING" }
            while (Date.now() < deadline) {
              const detailResp = await getRunDetail(sc, Number(runInstanceId), { projectId: sc.projectId })
              const detailData = detailResp.data as Record<string, unknown> | undefined
              const taskDetail = (
                typeof detailData?.taskDetail === "object" && detailData?.taskDetail !== null
                  ? detailData.taskDetail
                  : detailData
              ) as Record<string, unknown> | undefined
              const statusCode = (taskDetail?.instanceStatus ?? detailData?.instanceStatus) as number | undefined
              const endTime = taskDetail?.executeEndTime ?? detailData?.executeEndTime
              const failMsg = taskDetail?.failMsg ?? detailData?.failMsg
              const isTerminal = statusCode === 1 || statusCode === 3 || (statusCode == null && endTime != null)
              if (isTerminal) {
                const result = {
                  task_id: fileId,
                  run_id: runInstanceId,
                  execution_status: STATUS_NAME[statusCode as number] ?? statusCode,
                }
                const aiMessage =
                  `临时执行完成（task_id=${fileId}，run_id=${runInstanceId}）。Notice: 这是一次临时执行，不影响调度计划。` +
                  (argv["save-params"] && Object.keys(cliParams).length > 0
                    ? `--param 值已通过 --save-params 写回任务 paramValueList，调度运行将使用这些参数值。`
                    : `--param 传入的参数值仅对本次执行有效，调度运行使用任务配置中保存的参数（通过 cz-cli task save-content --params 设置）。`) +
                  `如需将当前脚本提升为正式调度，请在用户确认后执行: cz-cli task online ${fileId} -y`
                if (statusCode === 3 || failMsg) {
                  error("EXECUTE_FAILED", String(failMsg ?? `Task execution ${runInstanceId} failed`), { format })
                  return
                }
                // If --save-params, persist cliParams back to paramValueList for scheduled runs
                if (argv["save-params"] && Object.keys(cliParams).length > 0) {
                  const updatedParamList = parseParamValueList(
                    "{" + Object.entries(cliParams).map(([k, v]) => `"${k}":"${v}"`).join(",") + "}"
                  )
                  if (updatedParamList) {
                    await saveTaskContent(sc, {
                      dataFileId: fileId,
                      dataFileContent: content,
                      projectId: sc.projectId,
                      updateBy: String(sc.userId),
                      instanceName: sc.instanceName,
                      replaceEscapedChars: false,
                      paramValueList: updatedParamList,
                    }).catch(() => {}) // non-fatal
                  }
                }
                logOperation("task execute", { ok: true })
                success(result, { format, aiMessage })
                return
              }
              await new Promise((r) => setTimeout(r, pollMs))
            }
            error(
              "EXECUTE_TIMEOUT",
              `Task execution ${runInstanceId} did not complete within ${argv["max-wait-seconds"]}s`,
              { format },
            )
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command("flow", "Flow task operations", (flowYargs) =>
        flowYargs
          .command(
            "dag <task>",
            "Get flow DAG",
            (y) => y.positional("task", { type: "string", demandOption: true }),
            async (argv) => {
              const format = argv.format
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                const resp = await getFlowDag(sc, fileId)
                logOperation("task flow dag", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                reportTaskError(err, format)
              }
            },
          )
          .command(
            "create-node <task>",
            "Add node to flow",
            (y) =>
              y
                .positional("task", { type: "string", demandOption: true })
                .option("name", { type: "string", demandOption: true })
                .option("type", { type: "string", default: "sql", describe: "SQL/PYTHON/SHELL/SPARK" })
                .option("description", { type: "string" })
                .option("dependency", { type: "string", describe: "Dependency node name" })
                .option("content", { type: "string", describe: "Initial node content" }),
            async (argv) => {
              const format = argv.format
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                let depNodeId: number | undefined
                if (argv.dependency) {
                  depNodeId = await resolveNodeId(sc, fileId, argv.dependency as string, format)
                }
                const resp = await createFlowNode(sc, {
                  dataFileId: fileId,
                  projectId: sc.projectId,
                  nodeName: argv.name as string,
                  fileType: String(parseTaskType(argv.type as string)),
                  env: sc.env,
                  nodeDescription: argv.description,
                  dependencyNodeId: depNodeId,
                  content: argv.content,
                })
                logOperation("task flow create-node", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                reportTaskError(err, format)
              }
            },
          )
          .command(
            "remove-node <task>",
            "Remove node from flow",
            (y) =>
              y
                .positional("task", { type: "string", demandOption: true })
                .option("name", { type: "string", describe: "Node name" })
                .option("node-id", { type: "number", describe: "Node ID" }),
            async (argv) => {
              const format = argv.format
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                let nodeId = argv["node-id"] as number | undefined
                if (nodeId === undefined) {
                  if (!argv.name) { error("INVALID_ARGUMENTS", "Provide --name or --node-id.", { format, exitCode: 2 }); return }
                  nodeId = await resolveNodeId(sc, fileId, argv.name as string, format)
                }
                const resp = await removeFlowNode(sc, {
                  fileId,
                  nodeId,
                })
                logOperation("task flow remove-node", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                reportTaskError(err, format)
              }
            },
          )
          .command(
            "bind <task>",
            "Create dependency between flow nodes",
            (y) =>
              y
                .positional("task", { type: "string", demandOption: true })
                .option("upstream", { type: "string", demandOption: true, describe: "Upstream node name" })
                .option("downstream", { type: "string", demandOption: true, describe: "Downstream node name" }),
            async (argv) => {
              const format = argv.format
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                const upstreamNodeId = await resolveNodeId(sc, fileId, argv.upstream as string, format)
                const downstreamNodeId = await resolveNodeId(sc, fileId, argv.downstream as string, format)
                const resp = await bindFlowNode(sc, {
                  currentFileId: fileId,
                  currentNodeId: downstreamNodeId,
                  currentProjectId: sc.projectId,
                  dependencyFileId: fileId,
                  dependencyNodeId: upstreamNodeId,
                  dependencyProjectId: sc.projectId,
                })
                logOperation("task flow bind", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                reportTaskError(err, format)
              }
            },
          )
          .command(
            "unbind <task>",
            "Remove dependency between flow nodes",
            (y) =>
              y
                .positional("task", { type: "string", demandOption: true })
                .option("dependency-id", { alias: "dep-id", type: "number", demandOption: true }),
            async (argv) => {
              const format = argv.format
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                const resp = await unbindFlowNode(sc, {
                  depId: argv["dependency-id"] as number,
                  fileId,
                })
                logOperation("task flow unbind", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                reportTaskError(err, format)
              }
            },
          )
          .command(
            "node-detail <task>",
            "Get flow node detail",
            (y) =>
              y
                .positional("task", { type: "string", demandOption: true })
                .option("node-id", { type: "number", describe: "Node ID" })
                .option("name", { type: "string", describe: "Node name (resolved via DAG)" }),
            async (argv) => {
              const format = argv.format
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                let nodeId = argv["node-id"] as number | undefined
                if (nodeId === undefined) {
                  if (!argv.name) { error("INVALID_ARGUMENTS", "Provide --node-id or --name.", { format, exitCode: 2 }); return }
                  nodeId = await resolveNodeId(sc, fileId, argv.name as string, format)
                }
                const resp = await getFlowNodeDetail(sc, fileId, nodeId)
                logOperation("task flow node-detail", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                reportTaskError(err, format)
              }
            },
          )
          .command(
            "node-save <task>",
            "Save flow node script content",
            (y) =>
              y
                .positional("task", { type: "string", demandOption: true })
                .option("node-id", { type: "number", describe: "Node ID" })
                .option("name", { type: "string", describe: "Node name (resolved via DAG)" })
                .option("content", { type: "string" })
                .option("file", { alias: "f", type: "string" }),
            async (argv) => {
              const format = argv.format
              try {
                if (!argv.content && !argv.file) {
                  error("INVALID_ARGUMENTS", "Provide --content or --file.", { format, exitCode: 2 })
                  return
                }
                const text = argv.content ?? readFileSync(argv.file as string, "utf-8")
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                let nodeId = argv["node-id"] as number | undefined
                if (nodeId === undefined) {
                  if (!argv.name) { error("INVALID_ARGUMENTS", "Provide --node-id or --name.", { format, exitCode: 2 }); return }
                  nodeId = await resolveNodeId(sc, fileId, argv.name as string, format)
                }
                const resp = await saveFlowNodeContent(sc, {
                  dataFileId: fileId,
                  nodeId,
                  dataFileContent: text,
                  projectId: sc.projectId,
                  updateBy: String(sc.userId),
                  instanceName: sc.instanceName,
                })
                logOperation("task flow node-save", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                reportTaskError(err, format)
              }
            },
          )
          .command(
            "node-save-config <task>",
            "Save flow node schedule config",
            (y) =>
              y
                .positional("task", { type: "string", demandOption: true })
                .option("node-id", { type: "number", describe: "Node ID" })
                .option("name", { type: "string", describe: "Node name (resolved via DAG)" })
                .option("cron", { type: "string" })
                .option("vc", { type: "string" })
                .option("schema", { type: "string" }),
            async (argv) => {
              const format = argv.format
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                let nodeId = argv["node-id"] as number | undefined
                if (nodeId === undefined) {
                  if (!argv.name) { error("INVALID_ARGUMENTS", "Provide --node-id or --name.", { format, exitCode: 2 }); return }
                  nodeId = await resolveNodeId(sc, fileId, argv.name as string, format)
                }
                const resp = await saveFlowNodeConfig(sc, {
                  dataFileId: fileId,
                  nodeId,
                  projectId: sc.projectId,
                  updateBy: String(sc.userId),
                  instanceName: sc.instanceName,
                  cronExpress: argv.cron ? normalizeCron(argv.cron) : undefined,
                  etlVcCode: argv.vc,
                  schemaName: argv.schema,
                })
                logOperation("task flow node-save-config", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                reportTaskError(err, format)
              }
            },
          )
          .command(
            "submit <task>",
            "Publish flow",
            (y) => y.positional("task", { type: "string", demandOption: true }),
            async (argv) => {
              const format = argv.format
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                const resp = await submitFlow(sc, {
                  fileId,
                  projectId: sc.projectId,
                  env: sc.env,
                })
                logOperation("task flow submit", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                reportTaskError(err, format)
              }
            },
          )
          .command(
            "instances <task>",
            "List flow node instances",
            (y) =>
              y
                .positional("task", { type: "string", demandOption: true })
                .option("instance", { type: "number", demandOption: true, describe: "Flow instance ID" })
                .option("node-id", { type: "number", describe: "Flow node ID" })
                .option("node-instance-id", { type: "number", describe: "Flow node instance ID" }),
            async (argv) => {
              const format = argv.format
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                const resp = await listFlowInstances(sc, {
                  flowId: fileId,
                  flowInstanceId: argv.instance as number | undefined,
                  flowNodeId: argv["node-id"] as number | undefined,
                  flowNodeInstanceId: argv["node-instance-id"] as number | undefined,
                })
                logOperation("task flow instances", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                reportTaskError(err, format)
              }
            },
          )
          .strictCommands()
          .strictOptions()
          .demandCommand(1, "Missing subcommand for 'task flow'. Available: list, detail, submit, instances, node-save-config"),
      )
      .command(
        "delete-folder <folder>",
        "[🔴 DESTRUCTIVE] Delete a task folder. The folder must be empty. Requires confirmation.",
        (y: Argv) =>
          y
            .positional("folder", { type: "string", demandOption: true, describe: "Folder name or ID" })
            .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip confirmation" }),
        async (argv: Record<string, unknown>) => {
          const format = (argv as { format: string }).format
          try {
            const sc = await ctx(argv)
            const folderArg = String(argv.folder)
            const folderId = /^\d+$/.test(folderArg)
              ? parseInt(folderArg, 10)
              : await resolveFolderIdByName(sc, folderArg, format)
            if (!argv.yes) {
              const ok = await confirm(`Delete folder ${folderId}? This is irreversible.`)
              if (!ok) {
                success({ message: "Cancelled by user.", action: "task.delete-folder", executed: false }, { format })
                return
              }
            }
            const resp = await deleteFolder(sc, { folderId, projectId: sc.projectId })
            logOperation("task delete-folder", { ok: true })
            success(resp, { format })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "delete <task>",
        "[🔴 DESTRUCTIVE] Delete a task in draft/offline state. Published tasks must be taken offline first. Requires confirmation.",
        (y: Argv) =>
          y
            .positional("task", { type: "string", demandOption: true, describe: "Task name or ID" })
            .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip confirmation" }),
        async (argv: Record<string, unknown>) => {
          const format = (argv as { format: string }).format
          try {
            const sc = await ctx(argv)
            const taskId = await resolveTaskId(sc, String(argv.task), format)
            if (!argv.yes) {
              const ok = await confirm(`Delete task ${taskId}? This is irreversible.`)
              if (!ok) {
                success({ message: "Cancelled by user.", action: "task.delete", executed: false }, { format })
                return
              }
            }
            const resp = await deleteTask(sc, { scheduleTaskId: taskId, projectId: sc.projectId })
            logOperation("task delete", { ok: true })
            success(resp, { format })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "schedule-info <task>",
        "Get published schedule state for a deployed task (cron, next run time, last run result, etc.)",
        (y) => y.positional("task", { type: "string", demandOption: true, describe: "Task name or ID" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            // getScheduleDetail uses scheduleTaskId = fileId (same id as draft task)
            const resp = await studioRequest(sc,
              "/ide-admin/v1/scheduleTask/getDetail",
              { scheduleTaskId: fileId, projectId: sc.projectId },
              { env: "prod" },
            )
            logOperation("task schedule-info", { ok: true })
            success(resp.data, { format, aiMessage: "This is the deployed (published) schedule state. For draft config use: cz-cli task content <task>" })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "downstream <task>",
        "List all downstream tasks that depend on this task (flattened)",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true, describe: "Task name or ID" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const resp = await getAllDownstream(sc, fileId, sc.projectId)
            const items = Array.isArray(resp.data) ? resp.data : []
            logOperation("task downstream", { ok: true })
            success(items, {
              format,
              aiMessage: `Found ${items.length} downstream task(s). Use cz-cli task upstream <task> for upstream dependencies.`,
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "cron-preview <cron>",
        "Preview the next scheduled run times for a cron expression",
        (y) =>
          y
            .positional("cron", { type: "string", demandOption: true, describe: "Cron expression (5, 6, or 7 fields)" })
            .option("count", { type: "number", default: 5, describe: "Number of upcoming run times to show" })
            .option("start", { type: "string", describe: "Window start time HH:MM (default 00:00)" })
            .option("end", { type: "string", describe: "Window end time HH:MM (default 23:59)" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const cronExpress = normalizeCron(argv.cron as string)
            const resp = await previewScheduleInstanceTimes(sc, {
              cronExpress,
              ...(argv.start ? { scheduleStartTime: argv.start as string } : {}),
              ...(argv.end ? { scheduleEndTime: argv.end as string } : {}),
              scheduleEnv: "prod",
            })
            const times = Array.isArray(resp.data) ? resp.data : []
            const limited = times.slice(0, argv.count as number)
            logOperation("task cron-preview", { ok: true })
            success({ cron: cronExpress, next_runs: limited, count: limited.length }, {
              format,
              aiMessage: `Next ${limited.length} scheduled run times for cron: ${cronExpress}`,
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "search",
        "Search tasks by name with resolved folder path",
        (y) =>
          y
            .option("name", { type: "string", describe: "Task name (fuzzy match)" })
            .option("type", { type: "string", describe: "Task type filter: SQL, PYTHON, SHELL, JDBC, etc." })
            .option("status", {
              type: "string",
              choices: ["draft", "published", "offline"],
              describe: "Task status filter",
            })
            .option("folder", { type: "string", describe: "Filter by folder name or ID (searches within this folder)" })
            .option("owner", { type: "string", describe: "Filter by owner username (fuzzy match)" })
            .option("sort", {
              type: "string",
              choices: ["last_edit", "name", "type"],
              default: "last_edit",
              describe: "Sort order: last_edit=most recently modified first, name=alphabetical, type=by task type",
            })
            .option("limit", { type: "number", default: 50, describe: "Max results to return" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileType = argv.type ? String(parseTaskType(argv.type as string)) : undefined
            const STATUS_CODE: Record<string, number> = { draft: 10, published: 20, offline: 100 }
            const statusFilter = argv.status ? STATUS_CODE[argv.status as string] : undefined
            const ownerFilter = (argv.owner as string | undefined)?.toLowerCase()
            const sortBy = (argv.sort as string) ?? "last_edit"
            const limit = argv.limit as number

            // Resolve folder filter to id (server-side filter)
            const folderArg = argv.folder as string | undefined
            let folderIdFilter: number | undefined
            if (folderArg) {
              folderIdFilter = /^\d+$/.test(folderArg)
                ? parseInt(folderArg, 10)
                : await resolveFolderIdByName(sc, folderArg, format)
            }

            // Build folder id→name map by BFS across all folder levels
            const folderMap = new Map<number, string>()
            const buildFolderMap = async (parentId: number): Promise<void> => {
              const resp = await listFolders(sc, { projectId: sc.projectId, page: 1, pageSize: 500, parentFolderId: parentId })
              const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
              const folders = Array.isArray(data.list) ? data.list as Record<string, unknown>[] : []
              await Promise.all(folders.map(async (f) => {
                const id = Number(f.id ?? f.dataFolderId)
                const name = String(f.dataFolderName ?? f.folderName ?? id)
                folderMap.set(id, name)
                if (f.hasChildren) await buildFolderMap(id)
              }))
            }
            await buildFolderMap(0)

            // Resolve location "0.folderId1.folderId2.taskId" → "folder1/folder2"
            const resolvePath = (location: string, taskId: number): string => {
              const parts = location.split(".").map(Number).filter((n) => n !== 0 && n !== taskId)
              return parts.map((id) => folderMap.get(id) ?? String(id)).join("/")
            }

            // Fetch tasks with pagination until we have enough matches
            const results: Record<string, unknown>[] = []
            let page = 1
            const pageSize = 100
            while (results.length < limit) {
              const resp = await listTasks(sc, {
                projectId: sc.projectId, page, pageSize,
                fileName: argv.name as string | undefined,
                fileType,
                // Only use folderId as server filter when no recursive folder match needed
                // (listTasks folderId filters direct children only; we use location for recursive)
              })
              const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
              const tasks = Array.isArray(data.list) ? data.list as Record<string, unknown>[] : []
              if (tasks.length === 0) break
              for (const task of tasks) {
                if (results.length >= limit) break
                if (statusFilter != null && Number(task.fileFlowStatus ?? task.taskEditState) !== statusFilter) continue
                // Folder filter: task's location must include the target folder id
                if (folderIdFilter != null && !String(task.location ?? "").split(".").includes(String(folderIdFilter))) continue
                const taskId = Number(task.id ?? task.task_id)
                const location = String(task.location ?? "")
                results.push({
                  ...convertTaskFields(task),
                  path: resolvePath(location, taskId),
                })
              }
              const total = data.total as number ?? 0
              if (page * pageSize >= total) break
              page++
            }

            // Enrich with last_edit_time and owner via rate-limited parallel getTaskDetail calls (max 20 concurrent)
            const enriched = await pMap(
              results.slice(0, limit),
              async (t) => {
                try {
                  const detail = await getTaskDetail(sc, Number(t.task_id))
                  const data = (detail.data && typeof detail.data === "object" ? detail.data : {}) as Record<string, unknown>
                  return {
                    ...t,
                    last_edit_time: data.lastEditTime ?? data.last_edit_time,
                    last_edit_user: data.lastEditUser ?? data.last_edit_user,
                    owner_cn_name: data.ownerCnName ?? data.owner_cn_name,
                    owner_en_name: data.ownerEnName ?? data.owner_en_name,
                  }
                } catch {
                  return t
                }
              },
              20,
            )

            // Apply owner filter (client-side, needs detail data)
            const filtered = ownerFilter
              ? enriched.filter((t) =>
                  String(t.owner_en_name ?? "").toLowerCase().includes(ownerFilter) ||
                  String(t.owner_cn_name ?? "").toLowerCase().includes(ownerFilter) ||
                  String(t.last_edit_user ?? "").toLowerCase().includes(ownerFilter)
                )
              : enriched

            // Sort
            filtered.sort((a, b) => {
              if (sortBy === "name") return String(a.task_name ?? "").localeCompare(String(b.task_name ?? ""))
              if (sortBy === "type") return Number(a.task_type ?? 0) - Number(b.task_type ?? 0)
              // default: last_edit descending
              return Number(b.last_edit_time ?? 0) - Number(a.last_edit_time ?? 0)
            })

            const EDIT_STATE: Record<number, string> = { 10: "draft", 20: "published", 100: "offline" }
            const displayed = filtered.map((t) => ({
              ...t,
              task_edit_state: EDIT_STATE[Number(t.task_edit_state)] ?? t.task_edit_state,
              last_edit_time: t.last_edit_time ? new Date(Number(t.last_edit_time)).toISOString().replace("T", " ").slice(0, 19) : undefined,
            }))

            logOperation("task search", { ok: true })
            success(displayed, {
              format,
              extra: { total_matched: filtered.length, limit },
              aiMessage: t("task_search_result",
                filtered.length,
                filtered.length >= limit ? `（已截断，最多显示 ${limit} 条 / truncated at ${limit}）` : "",
              ),
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "stats",
        "Get task and run instance statistics",
        (y) =>
          y
            .option("folder", { type: "string", describe: "Filter by folder name or ID" })
            .option("type", { type: "string", describe: "Filter by task type (SQL, PYTHON, SHELL, JDBC, etc.)" })
            .option("task", { type: "string", describe: "Filter run stats by task name (fuzzy)" })
            .option("from", { type: "string", describe: "Run stats start time (YYYY-MM-DD or ISO). Defaults to 7 days ago." })
            .option("to", { type: "string", describe: "Run stats end time (YYYY-MM-DD or ISO). Defaults to now." })
            .option("vc", { type: "string", describe: "Filter run stats by VCluster code" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)

            // Resolve folder id if provided, then collect all descendant folder ids (recursive)
            const folderArg = argv.folder as string | undefined
            let rootFolderId: number | undefined
            if (folderArg) {
              rootFolderId = /^\d+$/.test(folderArg)
                ? parseInt(folderArg, 10)
                : await resolveFolderIdByName(sc, folderArg, format)
            }

            // BFS: collect all folder ids under rootFolderId (inclusive)
            const collectFolderIds = async (parentId: number): Promise<number[]> => {
              const resp = await listFolders(sc, { projectId: sc.projectId, page: 1, pageSize: 500, parentFolderId: parentId })
              const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
              const folders = Array.isArray(data.list) ? data.list as Record<string, unknown>[] : []
              const childIds = await Promise.all(
                folders.map(async (f) => {
                  const id = Number(f.id ?? f.dataFolderId)
                  return f.hasChildren ? [id, ...(await collectFolderIds(id))] : [id]
                })
              )
              return childIds.flat()
            }

            let folderIds: number[] | undefined
            let folderCount: number | undefined
            if (rootFolderId != null) {
              const descendants = await collectFolderIds(rootFolderId)
              folderIds = [rootFolderId, ...descendants]
              folderCount = folderIds.length
            }

            const fileType = argv.type ? String(parseTaskType(argv.type as string)) : undefined
            const cycleTaskType = fileType != null ? (FILE_TYPE_TO_TASK_TYPE[Number(fileType)] ?? Number(fileType)) : undefined
            const now = Date.now()
            const fromMs = argv.from
              ? new Date(argv.from as string).getTime()
              : now - 7 * 86400000
            const toMs = argv.to
              ? (() => {
                  const ms = new Date(argv.to as string).getTime()
                  return /^\d{4}-\d{2}-\d{2}$/.test((argv.to as string).trim()) ? ms + 86400000 - 1 : ms
                })()
              : now

            // Parallel: task total, folder total, instance stats, task run stats
            // Task count: if folder filter, sum totals across all collected folder ids
            const taskTotalPromise = folderIds
              ? Promise.all(folderIds.map((fid) =>
                  listTasks(sc, { projectId: sc.projectId, page: 1, pageSize: 1, folderId: fid, fileType })
                    .then((r) => Number((r.data as Record<string, unknown>)?.total ?? 0))
                )).then((totals) => totals.reduce((a, b) => a + b, 0))
              : listTasks(sc, { projectId: sc.projectId, page: 1, pageSize: 1, fileType })
                  .then((r) => Number((r.data as Record<string, unknown>)?.total ?? 0))

            const folderCountPromise = rootFolderId != null
              ? Promise.resolve(folderCount ?? 0)
              : listFolders(sc, { projectId: sc.projectId, page: 1, pageSize: 1, parentFolderId: 0 })
                  .then((r) => Number((r.data as Record<string, unknown>)?.total ?? 0))

            const [taskTotal, resolvedFolderCount, instanceStatsResp, taskRunStatsResp] = await Promise.all([
              taskTotalPromise,
              folderCountPromise,
              getInstanceStats(sc, {
                projectId: sc.projectId,
                queryStartPlanTime: fromMs,
                queryEndPlanTime: toMs,
                ...(argv.task ? { scheduleTaskName: argv.task as string } : {}),
                ...(cycleTaskType != null ? { taskType: cycleTaskType } : {}),
                ...(argv.vc ? { vcCode: argv.vc as string } : {}),
              }),
              getTaskRunStats(sc, {
                projectId: sc.projectId,
                queryPlanTimeLeft: fromMs,
                queryPlanTimeRight: toMs,
                ...(argv.task ? { taskNameRlike: argv.task as string } : {}),
              }),
            ])
            const folderTotal = resolvedFolderCount

            // Instance stats: group by status and type
            const STATUS_NAME: Record<number, string> = { 1: "SUCCESS", 2: "WAITING", 3: "FAILED", 4: "RUNNING" }
            const RUN_TYPE_NAME: Record<number, string> = { 1: "SCHEDULE", 3: "TEMP", 4: "REFILL" }
            const TASK_TYPE_NAME: Record<number, string> = {
              23: "SQL", 24: "SHELL", 26: "PYTHON", 29: "JDBC",
              400: "SPARK", 500: "FLOW", 10: "INTEGRATION", 28: "REALTIME",
              280: "FULL_INCREMENTAL", 281: "MULTI_REALTIME", 291: "MULTI_DI",
            }
            // fileType codes (used by getTaskRunStats) → name
            const FILE_TYPE_NAME: Record<number, string> = {
              4: "SQL", 5: "SHELL", 7: "PYTHON", 15: "JDBC",
              400: "SPARK", 500: "FLOW", 1: "INTEGRATION", 14: "REALTIME",
              280: "FULL_INCREMENTAL", 281: "MULTI_REALTIME", 291: "MULTI_DI",
            }

            const instanceRows = Array.isArray(instanceStatsResp.data) ? instanceStatsResp.data as Record<string, unknown>[] : []
            const byStatus: Record<string, number> = {}
            const byRunType: Record<string, number> = {}
            const byTaskType: Record<string, number> = {}
            let instanceTotal = 0
            for (const row of instanceRows) {
              // Raw API fields: instanceStatus, taskType, instanceType, count
              const cnt = Number(row.count ?? 0)
              const statusKey = STATUS_NAME[Number(row.instanceStatus)] ?? String(row.instanceStatus)
              const runTypeKey = RUN_TYPE_NAME[Number(row.instanceType)] ?? String(row.instanceType)
              const taskTypeKey = TASK_TYPE_NAME[Number(row.taskType)] ?? String(row.taskType)
              byStatus[statusKey] = (byStatus[statusKey] ?? 0) + cnt
              byRunType[runTypeKey] = (byRunType[runTypeKey] ?? 0) + cnt
              byTaskType[taskTypeKey] = (byTaskType[taskTypeKey] ?? 0) + cnt
              instanceTotal += cnt
            }

            // Task run stats: raw fields are fileType (task type), cnt (count)
            // fileFlowStatus: 10=draft, 20=published
            const FILE_STATUS_NAME: Record<number, string> = { 10: "DRAFT", 20: "PUBLISHED", 100: "OFFLINE" }
            const taskRunRows = (Array.isArray(taskRunStatsResp.data) ? taskRunStatsResp.data as Record<string, unknown>[] : [])
              .map((row) => ({
                task_type: FILE_TYPE_NAME[Number(row.fileType)] ?? String(row.fileType),
                status: FILE_STATUS_NAME[Number(row.fileFlowStatus)] ?? String(row.fileFlowStatus),
                count: Number(row.cnt ?? 0),
              }))

            const fromStr = new Date(fromMs).toISOString().slice(0, 10)
            const toStr = new Date(toMs).toISOString().slice(0, 10)

            logOperation("task stats", { ok: true })
            success({
              tasks: {
                total: taskTotal,
                folders: folderTotal,
                ...(rootFolderId ? { folder_filter: rootFolderId, folder_count_recursive: folderTotal } : {}),
                ...(fileType ? { type_filter: argv.type } : {}),
              },
              run_instances: {
                total: instanceTotal,
                period: `${fromStr} ~ ${toStr}`,
                by_status: byStatus,
                by_run_type: byRunType,
                by_task_type: byTaskType,
              },
              ...(taskRunRows.length > 0 ? { task_run_breakdown: taskRunRows } : {}),
            }, {
              format,
              aiMessage: t("task_stats_result",
                rootFolderId ? `folder=${rootFolderId}` : (fileType ? `type=${argv.type}` : "all"),
                taskTotal,
                folderTotal,
                `${fromStr}~${toStr}`,
                instanceTotal,
                byStatus["SUCCESS"] ?? 0,
                byStatus["FAILED"] ?? 0,
                byStatus["RUNNING"] ?? 0,
              ),
            })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "save <task>",
        false as unknown as string,
        (y: Argv) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("content", { type: "string" })
            .option("file", { alias: "f", type: "string" }),
        async (argv: Record<string, unknown>) => {
          const format = (argv as { format: string }).format
          try {
            if (!argv.content && !argv.file) {
              error("INVALID_ARGUMENTS", "Provide --content or --file.", { format, exitCode: 2 })
              return
            }
            const text = (argv.content ?? readFileSync(argv.file as string, "utf-8")) as string
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, String(argv.task), format)
            const resp = await saveTaskContent(sc, {
              dataFileId: fileId,
              dataFileContent: text,
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.instanceName,
              replaceEscapedChars: false,
            })
            logOperation("task save (alias)", { ok: true })
            success({ ...resp.data as object, studio_url: studioUrl(sc, fileId) }, { format, aiMessage: t("task_save_online_reminder", fileId) })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
    return commandGroup(yargs, "task")
  })
}
