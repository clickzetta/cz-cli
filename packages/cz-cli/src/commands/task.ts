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
        "create <name>",
        "Create a new task",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .option("type", {
              type: "string",
              demandOption: true,
              describe:
                'Available options: SQL, PYTHON, SHELL, JDBC, FLOW, INTEGRATION, REALTIME, VIRTUAL, FULL_INCREMENTAL, MULTI_REALTIME, MULTI_DI"',
            })
            .option("folder", { type: "string", default: "0", describe: "Folder ID or name" })
            .option("description", { type: "string", describe: "Task description" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const folderRaw = (argv.folder as string).trim()
            const folderId = /^\d+$/.test(folderRaw)
              ? parseInt(folderRaw, 10)
              : await resolveFolderIdByName(sc, folderRaw, format)
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
            success({ id:data, studio_url: url }, { format })
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
        ["content <task>", "detail <task>"],
        "Get task content and config",
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
            logOperation("task content", { ok: true })
            success({ ...merged, studio_url: studioUrl(sc, fileId) }, { format, aiMessage: t("task_content") })
          } catch (err) {
            reportTaskError(err, format)
          }
        },
      )
      .command(
        "save-content <task>",
        "Save task script content",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("content", { type: "string", describe: "Script content" })
            .option("file", { alias: "f", type: "string", describe: "Read content from file" })
            .option("params", { type: "string", describe: 'Runtime parameters as JSON object. Values starting with "$[" or matching system param names (bizdate, sys_biz_day, sys_plan_day, etc.) are treated as system/expression params automatically. e.g. \'{"city":"beijing","dt":"bizdate","yesterday":"$[yyyy-MM-dd,-1d]"}\'' }),
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
            const resp = await saveTaskContent(sc, {
              dataFileId: fileId,
              dataFileContent: text,
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.instanceName,
              replaceEscapedChars: false,
              ...(paramValueList && { paramValueList }),
            })
            logOperation("task save-content", { ok: true })
            success({ ...resp.data as object, studio_url: studioUrl(sc, fileId) }, { format, aiMessage: t("task_save_online_reminder", fileId) })
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

            const resp = await saveTaskConfig(sc, {
              dataFileId: fileId,
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.instanceName,
              cronExpress: cronResult.outputCron!,
              schemaName: (argv.schema as string | undefined) ?? (oldData.schemaName as string | undefined) ?? "public",
              etlVcCode: (argv.vc as string | undefined) ?? (oldData.etlVcCode as string | undefined) ?? "DEFAULT",
              etlVcId: argv["vc-id"] != null ? Number(argv["vc-id"]) : (oldData.etlVcId as number | undefined),
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
        "save-config <task>",
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
            logOperation("task save-config", { ok: true })
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
            const taskDetail = detail.data as Record<string, unknown> | undefined
            const fileType = Number(
              taskDetail?.fileType ?? taskDetail?.file_type ?? 0,
            )
            if (fileType === 500) {
              error(
                "TASK_ERROR",
                "Flow tasks cannot be published with task online. Use: cz-cli task flow submit <task>",
                { format },
              )
              return
            }
            if (!argv.yes) {
              const ok = await confirm(`Publish and online task ${fileId}?`)
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
            .option("poll-interval", { type: "number", default: 5, describe: "Polling interval seconds" }),
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
            const detail = await getTaskDetail(sc, fileId)
            const data = detail.data as Record<string, unknown> | undefined
            const taskDetail = (
              typeof data?.taskDetail === "object" && data?.taskDetail !== null ? data.taskDetail : data
            ) as Record<string, unknown> | undefined
            if (!vcCode) {
              vcCode = (taskDetail?.defaultVcName ??
                taskDetail?.default_vc_name ??
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
              adhocVcId: 0,
              dataFileContent: content,
              params,
              datasourceId,
              sessionSchemaName,
              dsType,
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
                  `临时执行完成（task_id=${fileId}，run_id=${runInstanceId}）。Notice: 这是一次临时执行，不影响调度计划。如需将当前脚本提升为正式调度，请在用户确认后执行: cz-cli task online ${fileId} -y`
                if (statusCode === 3 || failMsg) {
                  error("EXECUTE_FAILED", String(failMsg ?? `Task execution ${runInstanceId} failed`), { format })
                  return
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
        "search",
        "Search tasks by name with resolved folder path",
        (y) =>
          y
            .option("name", { type: "string", describe: "Task name (fuzzy match)" })
            .option("type", { type: "string", describe: "Task type filter: SQL, PYTHON, SHELL, JDBC, etc." })
            .option("status", {
              type: "string",
              choices: ["draft", "published", "offline"],
              describe: "Task status filter: draft=10, published=20, offline=100",
            })
            .option("limit", { type: "number", default: 50, describe: "Max results to return" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const fileType = argv.type ? String(parseTaskType(argv.type as string)) : undefined
            const STATUS_CODE: Record<string, number> = { draft: 10, published: 20, offline: 100 }
            const statusFilter = argv.status ? STATUS_CODE[argv.status as string] : undefined
            const limit = argv.limit as number

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
              const resp = await listTasks(sc, { projectId: sc.projectId, page, pageSize, fileName: argv.name as string | undefined, fileType })
              const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
              const tasks = Array.isArray(data.list) ? data.list as Record<string, unknown>[] : []
              if (tasks.length === 0) break
              for (const task of tasks) {
                if (results.length >= limit) break
                if (statusFilter != null && Number(task.fileFlowStatus ?? task.taskEditState) !== statusFilter) continue
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

            // Enrich with last_edit_time via parallel getTaskDetail calls
            const enriched = await Promise.all(
              results.slice(0, limit).map(async (t) => {
                try {
                  const detail = await getTaskDetail(sc, Number(t.task_id))
                  const data = (detail.data && typeof detail.data === "object" ? detail.data : {}) as Record<string, unknown>
                  const lastEditTime = data.lastEditTime ?? data.last_edit_time
                  const lastEditUser = data.lastEditUser ?? data.last_edit_user
                  return { ...t, last_edit_time: lastEditTime, last_edit_user: lastEditUser }
                } catch {
                  return t
                }
              })
            )

            // Sort by last_edit_time descending (most recently modified first)
            enriched.sort((a, b) => {
              const ta = Number(a.last_edit_time ?? 0)
              const tb = Number(b.last_edit_time ?? 0)
              return tb - ta
            })

            const EDIT_STATE: Record<number, string> = { 10: "draft", 20: "published", 100: "offline" }
            const displayed = enriched.map((t) => ({
              ...t,
              task_edit_state: EDIT_STATE[Number(t.task_edit_state)] ?? t.task_edit_state,
              last_edit_time: t.last_edit_time ? new Date(Number(t.last_edit_time)).toISOString().replace("T", " ").slice(0, 19) : undefined,
            }))

            logOperation("task search", { ok: true })
            success(displayed, {
              format,
              extra: { total_matched: results.length, limit },
              aiMessage: `找到 ${results.length} 个匹配任务${results.length >= limit ? `（已截断，最多显示 ${limit} 条）` : ""}。` +
                `path 字段为解析后的文件夹路径。如需更多结果请增大 --limit。`,
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

            // Resolve folder id if provided
            const folderArg = argv.folder as string | undefined
            let folderId: number | undefined
            if (folderArg) {
              folderId = /^\d+$/.test(folderArg)
                ? parseInt(folderArg, 10)
                : await resolveFolderIdByName(sc, folderArg, format)
            }

            const fileType = argv.type ? String(parseTaskType(argv.type as string)) : undefined
            // cycleTaskType used by getInstanceStats is FILE_TYPE_TO_TASK_TYPE converted value
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
            const [taskResp, folderResp, instanceStatsResp, taskRunStatsResp] = await Promise.all([
              listTasks(sc, { projectId: sc.projectId, page: 1, pageSize: 1, folderId, fileType }),
              listFolders(sc, { projectId: sc.projectId, page: 1, pageSize: 1, parentFolderId: folderId ?? 0 }),
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

            // Task summary
            const taskData = (taskResp.data && typeof taskResp.data === "object" ? taskResp.data : {}) as Record<string, unknown>
            const taskTotal = taskData.total as number ?? 0
            const folderData = (folderResp.data && typeof folderResp.data === "object" ? folderResp.data : {}) as Record<string, unknown>
            const folderTotal = folderData.total as number ?? 0

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
                ...(folderId ? { folder_filter: folderId } : {}),
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
              aiMessage: `任务统计（${folderId ? `folder=${folderId}` : "全部文件夹"}）：共 ${taskTotal} 个任务，${folderTotal} 个目录。` +
                `运行实例（${fromStr}~${toStr}）共 ${instanceTotal} 次，` +
                `成功 ${byStatus["SUCCESS"] ?? 0} / 失败 ${byStatus["FAILED"] ?? 0} / 运行中 ${byStatus["RUNNING"] ?? 0}。`,
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
