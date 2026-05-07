import type { Argv } from "yargs"
import { readFileSync } from "node:fs"
import {
  listTasks, createTask, getTaskDetail, getTaskConfigDetail,
  saveTaskContent, saveTaskConfig, submitTask, onlineTask, offlineTask,
  offlineTaskWithDownstream, deleteTask, deleteFolder,
  getTaskDependencies, listFolders, createFolder,
  executeAdhoc, getRunDetail, previewScheduleInstanceTimes,
  getFlowDag, createFlowNode, bindFlowNode, unbindFlowNode,
  removeFlowNode, submitFlow, listFlowInstances,
  saveFlowNodeContent, getFlowNodeDetail, saveFlowNodeConfig,
  studioRequest,
  type StudioConfig,
} from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getStudioContext } from "./studio-context.js"
import { confirm } from "../confirm.js"
import { resolveTaskId, resolveNodeId, resolveFolderIdByName } from "../resolver.js"
import { normalizeTaskIdentity } from "../identity.js"
import { t } from "../locale.js"
import { resolveConnectionConfig } from "../connection/config.js"

const TASK_TYPE_MAP: Record<string, number> = {
  SQL: 23, PYTHON: 26, SHELL: 24, SPARK: 400, FLOW: 500,
}

function parseTaskType(value: string): number {
  const upper = value.toUpperCase()
  if (upper in TASK_TYPE_MAP) return TASK_TYPE_MAP[upper]
  const n = parseInt(value, 10)
  if (!isNaN(n)) return n
  throw new Error(`Unsupported task type: ${value}. Use SQL/PYTHON/SHELL/SPARK/FLOW or integer code.`)
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

export function registerTaskCommand(cli: Argv<GlobalArgs>): void {
  cli.command("task", "Manage Studio tasks", (yargs) =>
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
            .option("type", { type: "string", describe: "Task type (SQL/PYTHON/SHELL/SPARK/FLOW)" }),
        async (argv) => {
          const format = argv.output
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
            const tasks = Array.isArray(data.tasks) ? data.tasks as Record<string, unknown>[] : []
            const pagination = (data.pagination && typeof data.pagination === "object" ? data.pagination : {}) as Record<string, unknown>
            const total = pagination.total
            const aiMessage = `当前仅展示第 ${pagination.page ?? argv.page} 页` +
              (total != null ? `（${tasks.length} 条 / 共 ${total} 条）` : "") +
              `。如需下一页，请执行: cz-cli task list --page ${(argv.page as number) + 1} --page-size ${pageSize}`
            logOperation("task list", { ok: true })
            success(tasks, { format, aiMessage, extra: { pagination } })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await listFolders(sc, {
              projectId: sc.projectId,
              page: argv.page,
              pageSize: argv["page-size"],
              parentFolderId: argv.parent,
            })
            const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
            const items = Array.isArray(data.folders) ? data.folders as unknown[] : []
            const pagination = (data.pagination && typeof data.pagination === "object" ? data.pagination : {}) as Record<string, unknown>
            const aiMessage = `当前仅展示第 ${pagination.page ?? argv.page} 页。可使用 --page 和 --page-size 翻页。`
            logOperation("task list-folders", { ok: true })
            success(items, { format, aiMessage, extra: { pagination } })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "create <name>",
        "Create a new task",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .option("type", { type: "string", demandOption: true, describe: "SQL/PYTHON/SHELL/SPARK/FLOW" })
            .option("folder", { type: "string", default: "0", describe: "Folder ID or name" })
            .option("description", { type: "string", describe: "Task description" }),
        async (argv) => {
          const format = argv.output
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
            success(resp.data, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
          const format = argv.output
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
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "content <task>",
        "Get task content and config",
        (y) => y.positional("task", { type: "string", demandOption: true }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const [detail, config] = await Promise.all([
              getTaskDetail(sc, fileId),
              getTaskConfigDetail(sc, { projectId: sc.projectId, workspaceId: sc.workspaceId, dataFileId: fileId }),
            ])
            const detailData = (detail.data && typeof detail.data === "object" ? detail.data : {}) as Record<string, unknown>
            const detailObj = (typeof detailData.taskDetail === "object" && detailData.taskDetail !== null ? detailData.taskDetail : detailData) as Record<string, unknown>
            const normalizedDetail = normalizeTaskIdentity(detailObj, { task_id: fileId })
            const configData = (config.data && typeof config.data === "object" ? config.data : {}) as Record<string, unknown>
            const scheduleConfig = (configData.taskConfigurationDetail ?? configData.task_configuration_detail ?? configData.scheduleConfig ?? configData.schedule_config ?? configData) as Record<string, unknown>
            const merged = normalizeTaskIdentity({
              task_id: normalizedDetail.task_id ?? fileId,
              task_name: normalizedDetail.task_name,
              task_content: normalizedDetail.taskContent ?? normalizedDetail.task_content ?? normalizedDetail.dataFileContent ?? normalizedDetail.data_file_content,
              schedule_config: scheduleConfig,
            }, { task_id: fileId })
            logOperation("task content", { ok: true })
            success(merged, { format, aiMessage: t("task_content") })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
            .option("file", { alias: "f", type: "string", describe: "Read content from file" }),
        async (argv) => {
          const format = argv.output
          try {
            if ((argv.content && argv.file) || (!argv.content && !argv.file)) {
              error("INVALID_ARGUMENTS", "Exactly one of --content or --file is required.", { format, exitCode: 2 })
            }
            const text = argv.content ?? readFileSync(argv.file as string, "utf-8")
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const resp = await saveTaskContent(sc, {
              dataFileId: fileId,
              dataFileContent: text,
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.instanceName,
              replaceEscapedChars: false,
            })
            logOperation("task save-content", { ok: true })
            success(resp.data, { format, aiMessage: t("task_save_online_reminder", fileId) })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "save-config <task>",
        "Save task schedule config",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("cron", { type: "string", describe: "Cron expression (5/6/7 fields)" })
            .option("vc", { type: "string", describe: "Virtual cluster code" })
            .option("schema", { type: "string", describe: "Schema name" })
            .option("retry-count", { type: "number", describe: "Retry count" })
            .option("timeout", { type: "number", describe: "Execute timeout" })
            .option("timeout-unit", { type: "string", default: "MINUTES", describe: "Timeout unit" })
            .option("dry-run", { type: "boolean", default: false, describe: "Validate and preview without saving" })
            .option("start", { alias: "s", type: "string", describe: "Preview start clock HH:MM (dry-run only, default: 00:00)" })
            .option("end", { alias: "e", type: "string", describe: "Preview end clock HH:MM (dry-run only, default: 23:59)" })
            .option("env", { alias: "E", type: "string", describe: "Preview schedule env (dry-run only, default: prod)" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            if (!argv.cron) {
              error("INVALID_ARGUMENTS", "Missing required fields for task save-config: cron_express", { format, exitCode: 2 })
            }
            const cronExpress = normalizeCron(argv.cron as string)
            if (!argv["dry-run"] && (argv.start || argv.end || argv.env)) {
              error("INVALID_ARGUMENTS", "--start/--end/--env options can only be used together with --dry-run.", { format, exitCode: 2 })
            }
            if (argv["dry-run"]) {
              const startClock = normalizeScheduleClock(argv.start ?? "00:00", "--start")
              const endClock = normalizeScheduleClock(argv.end ?? "23:59", "--end")
              const scheduleEnv = argv.env ?? "prod"
              let instanceTimes: unknown[] = []
              try {
                const previewResp = await previewScheduleInstanceTimes(sc, {
                  cronExpress: cronExpress,
                  scheduleStartTime: startClock,
                  scheduleEndTime: endClock,
                  scheduleEnv,
                })
                instanceTimes = Array.isArray(previewResp.data) ? previewResp.data : []
              } catch { /* best-effort preview */ }
              logOperation("task save-config dry-run", { ok: true })
              success({
                dry_run: true,
                task_id: fileId,
                input_cron: argv.cron,
                normalized_cron: cronExpress,
                vc: argv.vc,
                schema: argv.schema,
                schedule_start_time: startClock,
                schedule_end_time: endClock,
                schedule_env: scheduleEnv,
                instance_times: instanceTimes,
              }, { format })
              return
            }
            const resp = await saveTaskConfig(sc, {
              dataFileId: fileId,
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.instanceName,
              cronExpress,
              etlVcCode: argv.vc,
              schemaName: argv.schema,
              retryCount: argv["retry-count"],
              executeTimeout: argv.timeout,
              executeTimeoutUnit: argv["timeout-unit"],
            })
            logOperation("task save-config", { ok: true })
            success(resp.data, { format, aiMessage: t("task_save_online_reminder", fileId) })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "deps <task>",
        "Show task dependencies (draft state)",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("parent-level", { type: "number", default: 1, describe: "Upstream depth" })
            .option("child-level", { type: "number", default: 1, describe: "Downstream depth" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const configResp = await getTaskConfigDetail(sc, { projectId: sc.projectId, workspaceId: sc.workspaceId, dataFileId: fileId })
            const configData = (configResp.data && typeof configResp.data === "object" ? configResp.data : {}) as Record<string, unknown>
            const detail = (configData.configurationDetail ?? configData.configuration_detail ?? {}) as Record<string, unknown>
            const selfDepends = detail.selfDependsJob ?? detail.self_depends_job ?? 0
            const depDtos = Array.isArray(detail.taskDependencies ?? detail.task_dependencies)
              ? (detail.taskDependencies ?? detail.task_dependencies) as Record<string, unknown>[]
              : []
            const depIds = depDtos.map((d) => Number(d.dependencyTaskId ?? d.dependency_task_id)).filter((id) => id > 0)
            let parentTasks: unknown[] = []
            if (depIds.length > 0) {
              const depResp = await getTaskDependencies(sc, { currentId: fileId, fileIds: depIds })
              const depData = (depResp.data && typeof depResp.data === "object" ? depResp.data : {}) as Record<string, unknown>
              parentTasks = Array.isArray(depData.dependencies) ? depData.dependencies as unknown[] : []
            }
            const result = normalizeTaskIdentity({ task_id: fileId, self_depends_job: selfDepends, parent_tasks: parentTasks })
            logOperation("task deps", { ok: true })
            success(result, { format, aiMessage: t("task_deps") })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "online <task>",
        "Publish/online a task",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("version", { type: "number", describe: "Task version to publish" })
            .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip confirmation" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            const detail = await getTaskDetail(sc, fileId)
            const taskData = detail.data as Record<string, unknown> | undefined
            const taskDetail = (typeof taskData?.taskDetail === "object" && taskData?.taskDetail !== null ? taskData.taskDetail : taskData) as Record<string, unknown> | undefined
            const fileType = Number(taskDetail?.fileType ?? taskDetail?.file_type ?? taskData?.fileType ?? taskData?.file_type ?? 0)
            if (fileType === 500) {
              error("TASK_ERROR", "Flow tasks cannot be published with task online. Use: cz-cli task flow submit <task>", { format })
            }
            if (!argv.yes) {
              const ok = await confirm(`Publish and online task ${fileId}?`)
              if (!ok) {
                success({ message: "Cancelled by user. No online action was executed.", action: "task.online", executed: false }, { format })
                return
              }
            }
            const resolvedVersion = argv.version != null
              ? String(argv.version)
              : String(taskDetail?.currentVersion ?? taskDetail?.current_version ?? taskData?.currentVersion ?? taskData?.current_version ?? "")
            const resp = await submitTask(sc, {
              commitMsg: "Published via cz-cli",
              dataFileId: fileId,
              projectId: sc.projectId,
              updatedBy: String(sc.userId),
              ...(resolvedVersion ? { dataFileVersion: resolvedVersion } : {}),
            })
            await onlineTask(sc, fileId, sc.projectId)
            logOperation("task online", { ok: true })
            success({ data: resp.data, status: "online" }, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "offline <task>",
        "Take a task offline (clears all run instances, irreversible)",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true })
            .option("with-downstream", { type: "boolean", default: false, describe: "Also offline downstream tasks" })
            .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip confirmation" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            if (!argv.yes) {
              const ok = await confirm(`Take task ${fileId} offline? This clears ALL run instances and is IRREVERSIBLE.`)
              if (!ok) {
                success({ message: "Cancelled by user. No offline action was executed.", action: "task.offline", executed: false }, { format })
                return
              }
            }
            const resp = argv["with-downstream"]
              ? await offlineTaskWithDownstream(sc, fileId, sc.projectId)
              : await offlineTask(sc, fileId, sc.projectId)
            logOperation("task offline", { ok: true })
            success({ data: resp.data, status: "offline" }, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "execute <task>",
        "Execute a task ad-hoc",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true, describe: "Task name or ID" })
            .option("vc", { type: "string", describe: "Virtual cluster code (resolves from task detail or profile if omitted)" })
            .option("schema", { type: "string", describe: "Schema name" })
            .option("content", { type: "string", describe: "Override script content" })
            .option("file", { alias: "f", type: "string", describe: "Read override content from file" })
            .option("param", { type: "array", string: true, describe: "Parameter KEY=VALUE" })
            .option("max-wait-seconds", { type: "number", default: 300, describe: "Max seconds to wait for completion" })
            .option("poll-interval", { type: "number", default: 5, describe: "Polling interval seconds" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, argv.task as string, format)
            let content = argv.content as string | undefined
            if (argv.file) content = readFileSync(argv.file as string, "utf-8")
            let params: Record<string, string> | undefined
            if (argv.param && argv.param.length > 0) {
              params = {}
              for (const p of argv.param) {
                const eqIdx = p.indexOf("=")
                if (eqIdx > 0) params[p.slice(0, eqIdx)] = p.slice(eqIdx + 1)
              }
            }
            // Resolve VC: --vc > task detail default_vc_name > profile vcluster
            let vcCode = argv.vc as string | undefined
            if (!vcCode) {
              const detail = await getTaskDetail(sc, fileId)
              const data = detail.data as Record<string, unknown> | undefined
              const taskDetail = (typeof data?.taskDetail === "object" && data?.taskDetail !== null ? data.taskDetail : data) as Record<string, unknown> | undefined
              vcCode = (taskDetail?.defaultVcName ?? taskDetail?.default_vc_name ?? taskDetail?.etlVcCode ?? taskDetail?.etl_vc_code) as string | undefined
              if (!vcCode) {
                const config = resolveConnectionConfig(argv as Record<string, unknown>)
                vcCode = config.vcluster || undefined
              }
              if (!content) {
                content = (taskDetail?.taskContent ?? taskDetail?.task_content ?? taskDetail?.dataFileContent ?? taskDetail?.data_file_content ?? data?.dataFileContent ?? data?.content ?? "") as string
              }
            } else if (!content) {
              const detail = await getTaskDetail(sc, fileId)
              const data = detail.data as Record<string, unknown> | undefined
              const taskDetail = (typeof data?.taskDetail === "object" && data?.taskDetail !== null ? data.taskDetail : data) as Record<string, unknown> | undefined
              content = (taskDetail?.taskContent ?? taskDetail?.task_content ?? taskDetail?.dataFileContent ?? taskDetail?.data_file_content ?? data?.dataFileContent ?? data?.content ?? "") as string
            }
            if (!content) {
              error("INVALID_ARGUMENTS", "Task content is empty. Provide --content or ensure the task has saved content.", { format })
            }
            if (!vcCode || !vcCode.trim()) {
              error("INVALID_ARGUMENTS", "Virtual cluster (VC) is required. Provide --vc or configure vcluster in your profile.", { format })
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
              adhocVcCode: vcCode,
              adhocSchemaName: argv.schema ?? "",
              adhocVcId: 0,
              dataFileContent: content,
              params,
            })
            const execData = resp.data as Record<string, unknown> | undefined
            const runInstanceId = execData?.taskInstanceId ?? execData?.task_instance_id
            if (runInstanceId == null) {
              logOperation("task execute", { ok: true })
              success(execData ?? {}, { format })
              return
            }
            const maxWaitMs = (argv["max-wait-seconds"] as number) * 1000
            const pollMs = (argv["poll-interval"] as number) * 1000
            const deadline = Date.now() + maxWaitMs
            const STATUS_NAME: Record<number, string> = { 1: "SUCCESS", 2: "WAITING", 3: "FAILED", 4: "RUNNING" }
            while (Date.now() < deadline) {
              const detailResp = await getRunDetail(sc, Number(runInstanceId), { projectId: sc.projectId })
              const detailData = detailResp.data as Record<string, unknown> | undefined
              const taskDetail = (typeof detailData?.taskDetail === "object" && detailData?.taskDetail !== null ? detailData.taskDetail : detailData) as Record<string, unknown> | undefined
              const statusCode = (taskDetail?.instanceStatus ?? detailData?.instanceStatus) as number | undefined
              const endTime = taskDetail?.executeEndTime ?? detailData?.executeEndTime
              const failMsg = taskDetail?.failMsg ?? detailData?.failMsg
              const isTerminal = statusCode === 1 || statusCode === 3 || (statusCode == null && endTime != null)
              if (isTerminal) {
                const normalized = normalizeTaskIdentity(
                  { ...detailData, task_id: fileId, run_id: runInstanceId, execution_status: STATUS_NAME[statusCode as number] ?? statusCode },
                )
                const aiMessage = normalized.run_id != null
                  ? `临时执行完成（task_id=${normalized.task_id}，run_id=${normalized.run_id}）。Notice: 这是一次临时执行，不影响调度计划。如需将当前脚本提升为正式调度，请在用户确认后执行: cz-cli task online ${normalized.task_id} -y`
                  : `临时执行完成（task_id=${normalized.task_id}）。Notice: 这是一次临时执行，不影响调度计划。`
                if (statusCode === 3 || failMsg) {
                  error("EXECUTE_FAILED", String(failMsg ?? `Task execution ${runInstanceId} failed`), { format })
                }
                logOperation("task execute", { ok: true })
                success(normalized, { format, aiMessage })
              }
              await new Promise((r) => setTimeout(r, pollMs))
            }
            error("EXECUTE_TIMEOUT", `Task execution ${runInstanceId} did not complete within ${argv["max-wait-seconds"]}s`, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                const resp = await getFlowDag(sc, fileId)
                logOperation("task flow dag", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
              const format = argv.output
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
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                let nodeId = argv["node-id"] as number | undefined
                if (nodeId === undefined) {
                  if (!argv.name) error("INVALID_ARGUMENTS", "Provide --name or --node-id.", { format, exitCode: 2 })
                  nodeId = await resolveNodeId(sc, fileId, argv.name as string, format)
                }
                const resp = await removeFlowNode(sc, {
                  fileId,
                  nodeId,
                })
                logOperation("task flow remove-node", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
              const format = argv.output
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
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
              const format = argv.output
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
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                let nodeId = argv["node-id"] as number | undefined
                if (nodeId === undefined) {
                  if (!argv.name) error("INVALID_ARGUMENTS", "Provide --node-id or --name.", { format, exitCode: 2 })
                  nodeId = await resolveNodeId(sc, fileId, argv.name as string, format)
                }
                const resp = await getFlowNodeDetail(sc, fileId, nodeId)
                logOperation("task flow node-detail", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
              const format = argv.output
              try {
                if (!argv.content && !argv.file) {
                  error("INVALID_ARGUMENTS", "Provide --content or --file.", { format, exitCode: 2 })
                }
                const text = argv.content ?? readFileSync(argv.file as string, "utf-8")
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                let nodeId = argv["node-id"] as number | undefined
                if (nodeId === undefined) {
                  if (!argv.name) error("INVALID_ARGUMENTS", "Provide --node-id or --name.", { format, exitCode: 2 })
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
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const fileId = await resolveTaskId(sc, argv.task as string, format)
                let nodeId = argv["node-id"] as number | undefined
                if (nodeId === undefined) {
                  if (!argv.name) error("INVALID_ARGUMENTS", "Provide --node-id or --name.", { format, exitCode: 2 })
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
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
              }
            },
          )
          .command(
            "submit <task>",
            "Publish flow",
            (y) => y.positional("task", { type: "string", demandOption: true }),
            async (argv) => {
              const format = argv.output
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
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
              const format = argv.output
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
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
              }
            },
          )
          .demandCommand(1, ""),
      )
      .command(
        "delete-folder <folder>",
        "[🔴 DESTRUCTIVE] Delete a task folder. The folder must be empty. Requires confirmation.",
        (y: Argv) =>
          y
            .positional("folder", { type: "string", demandOption: true, describe: "Folder name or ID" })
            .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip confirmation" }),
        async (argv: Record<string, unknown>) => {
          const format = (argv as { output: string }).output
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
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
          const format = (argv as { output: string }).output
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
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "detail <task>",
        false as unknown as string,
        (y: Argv) => y.positional("task", { type: "string", demandOption: true }),
        async (argv: Record<string, unknown>) => {
          const format = (argv as { output: string }).output
          try {
            const sc = await ctx(argv)
            const fileId = await resolveTaskId(sc, String(argv.task), format)
            const [detail, config] = await Promise.all([
              getTaskDetail(sc, fileId),
              getTaskConfigDetail(sc, { projectId: sc.projectId, workspaceId: sc.workspaceId, dataFileId: fileId }),
            ])
            const detailData = (detail.data && typeof detail.data === "object" ? detail.data : {}) as Record<string, unknown>
            const detailObj = (typeof detailData.taskDetail === "object" && detailData.taskDetail !== null ? detailData.taskDetail : detailData) as Record<string, unknown>
            const normalizedDetail = normalizeTaskIdentity(detailObj, { task_id: fileId })
            const configData = (config.data && typeof config.data === "object" ? config.data : {}) as Record<string, unknown>
            const scheduleConfig = (configData.taskConfigurationDetail ?? configData.task_configuration_detail ?? configData.scheduleConfig ?? configData.schedule_config ?? configData) as Record<string, unknown>
            const merged = normalizeTaskIdentity({
              task_id: normalizedDetail.task_id ?? fileId,
              task_name: normalizedDetail.task_name,
              task_content: normalizedDetail.taskContent ?? normalizedDetail.task_content ?? normalizedDetail.dataFileContent ?? normalizedDetail.data_file_content,
              schedule_config: scheduleConfig,
            }, { task_id: fileId })
            logOperation("task detail (alias)", { ok: true })
            success(merged, { format, aiMessage: t("task_content") })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
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
          const format = (argv as { output: string }).output
          try {
            if (!argv.content && !argv.file) {
              error("INVALID_ARGUMENTS", "Provide --content or --file.", { format, exitCode: 2 })
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
            success(resp.data, { format, aiMessage: t("task_save_online_reminder", fileId) })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .demandCommand(1, ""),
  )
}
