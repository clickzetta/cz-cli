import type { Argv } from "yargs"
import {
  listRuns, getRunDetail, stopRun, rerunInstance,
  createBackfill, getInstanceRelation,
  getTaskRelation, listAttempts, getAttemptLog,
  getScheduleDetail, getTaskRunStats,
  type StudioConfig,
} from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getStudioContext } from "./studio-context.js"
import { confirm } from "../confirm.js"
import { resolveTaskId, resolveRunIdOrTaskName } from "../resolver.js"
import { normalizeRunIdentity, normalizeRunIdentityList } from "../identity.js"
import { t } from "../locale.js"

const STATUS_MAP: Record<string, string> = {
  SUCCESS: "1", WAITING: "2", FAILED: "3", RUNNING: "4",
}
const RUN_TYPE_MAP: Record<string, string> = {
  SCHEDULE: "1", TEMP: "3", REFILL: "4",
  "1": "1", "3": "3", "4": "4",
}

function parseWindowBoundary(value: string, endOfDay: boolean): number {
  const ms = new Date(value).getTime()
  if (isNaN(ms)) return Date.now()
  // If date-only (YYYY-MM-DD), add end-of-day for --to boundary
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return ms + 86400000 - 1 // 23:59:59.999
  }
  return ms
}

async function ctx(argv: Record<string, unknown>): Promise<StudioConfig> {
  return getStudioContext(argv)
}

export function registerRunsCommand(cli: Argv<GlobalArgs>): void {
  cli.command("runs", "Manage task run instances", (yargs) =>
    yargs
      .command(
        "list",
        "List run instances",
        (y) =>
          y
            .option("task", { type: "string", describe: "Task name or ID filter" })
            .option("status", { type: "array", string: true, choices: ["SUCCESS", "WAITING", "FAILED", "RUNNING"], describe: "Status: SUCCESS/WAITING/FAILED/RUNNING (multiple allowed)" })
            .option("run-type", { type: "string", default: "SCHEDULE", choices: ["SCHEDULE", "TEMP", "REFILL"], describe: "SCHEDULE/TEMP/REFILL" })
            .option("from", { type: "string", describe: "Start time (ISO)" })
            .option("to", { type: "string", describe: "End time (ISO)" })
            .option("page", { type: "number", default: 1 })
            .option("page-size", { type: "number", default: 10 })
            .option("limit", { type: "number", describe: "Alias of --page-size" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const pageSize = argv.limit ?? argv["page-size"]
            const now = Date.now()
            const fromMs = argv.from ? parseWindowBoundary(argv.from as string, false) : now - 86400000
            const toMs = argv.to ? parseWindowBoundary(argv.to as string, true) : now
            const statusList = argv.status
              ? (argv.status as string[]).map((s) => STATUS_MAP[s.toUpperCase()] ?? s)
              : undefined
            const taskId = argv.task ? await resolveTaskId(sc, argv.task, format) : undefined
            const resolvedRunType = RUN_TYPE_MAP[(argv["run-type"] as string).toUpperCase()] ?? argv["run-type"]
            const resp = await listRuns(sc, {
              projectId: sc.projectId,
              pageIndex: argv.page,
              pageSize,
              scheduleTaskId: taskId,
              instanceStatusList: statusList,
              cycleTaskType: resolvedRunType,
              queryStartPlanTime: String(fromMs),
              queryEndPlanTime: String(toMs),
            })
            const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
            const items = normalizeRunIdentityList(Array.isArray(data.taskRunList) ? data.taskRunList as Record<string, unknown>[] : [])
            const total = data.totalCount ?? data.total
            const aiMessage = `当前仅展示第 ${data.pageIndex ?? argv.page} 页` +
              (total != null ? `（${items.length} 条 / 共 ${total} 条）` : "") +
              `，run_type=${resolvedRunType}` +
              `。如需下一页，请执行: cz-cli runs list --run-type ${resolvedRunType} --page ${(argv.page as number) + 1} --page-size ${pageSize}`
            logOperation("runs list", { ok: true })
            success(items, { format, aiMessage, extra: { pagination: { page: argv.page, page_size: pageSize, total } } })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "detail <id>",
        "Get run detail",
        (y) => y.positional("id", { type: "string", demandOption: true }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const runId = await resolveRunIdOrTaskName(sc, argv.id as string, format)
            const resp = await getRunDetail(sc, runId, { projectId: sc.projectId })
            const runData = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
            const taskDetail = (typeof runData.taskDetail === "object" && runData.taskDetail !== null ? runData.taskDetail : {}) as Record<string, unknown>
            const normalized = normalizeRunIdentity(runData, taskDetail, { run_id: runId })
            normalized.workspace = taskDetail.projectName ?? taskDetail.project_name
            normalized.owner = taskDetail.taskOwnerCn ?? taskDetail.task_owner_cn ?? taskDetail.executorUserName ?? taskDetail.executor_user_name
            normalized.vc_code = taskDetail.vcCode ?? taskDetail.vc_code
            normalized.plan_trigger_time = taskDetail.planTriggerTime ?? taskDetail.plan_trigger_time
            normalized.execute_start_time = taskDetail.executeStartTime ?? taskDetail.execute_start_time
            normalized.execute_end_time = taskDetail.executeEndTime ?? taskDetail.execute_end_time
            const start = normalized.execute_start_time as number | undefined
            const end = normalized.execute_end_time as number | undefined
            if (start && end) normalized.duration_ms = end - start
            normalized.task_param = taskDetail.taskParam ?? taskDetail.task_param
            normalized.version = taskDetail.version
            normalized.fail_msg = taskDetail.failMsg ?? taskDetail.fail_msg
            let scheduleConfig: Record<string, unknown> | undefined
            let aiMessage = t("runs_detail")
            const scheduleTaskId = taskDetail.taskId ?? taskDetail.task_id ?? runData.scheduleTaskId ?? runData.schedule_task_id
            if (scheduleTaskId != null) {
              try {
                const sResp = await getScheduleDetail(sc, {
                  scheduleTaskId: Number(scheduleTaskId),
                  projectId: sc.projectId,
                })
                const sData = (sResp.data && typeof sResp.data === "object" ? sResp.data : {}) as Record<string, unknown>
                scheduleConfig = (sData.scheduleTaskDetail ?? sData.schedule_task_detail ?? sData) as Record<string, unknown>
              } catch {
                aiMessage += " " + t("runs_detail_degraded")
              }
            } else {
              aiMessage += " " + t("runs_detail_degraded")
            }
            normalized.schedule_config = scheduleConfig
            logOperation("runs detail", { ok: true })
            success(normalized, { format, aiMessage })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "wait <id>",
        "Poll until run completes",
        (y) =>
          y
            .positional("id", { type: "string", demandOption: true })
            .option("attempts", { type: "number", default: 120, describe: "Maximum polling attempts" })
            .option("interval", { type: "number", default: 5, describe: "Poll interval seconds" })
            .option("allow-timeout", { type: "boolean", default: false, describe: "Return success on timeout instead of error" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const runId = await resolveRunIdOrTaskName(sc, argv.id as string, format)
            const maxAttempts = Math.max(1, argv.attempts as number)
            const intervalMs = Math.max(100, (argv.interval as number) * 1000)
            const STATUS_NAME: Record<number, string> = { 1: "SUCCESS", 2: "WAITING", 3: "FAILED", 4: "RUNNING" }
            let lastPayload: Record<string, unknown> | undefined
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              const resp = await getRunDetail(sc, runId, { projectId: sc.projectId })
              const data = resp.data as Record<string, unknown> | undefined
              lastPayload = data
              const taskDetail = (typeof data?.taskDetail === "object" && data?.taskDetail !== null ? data.taskDetail : data) as Record<string, unknown> | undefined
              const statusCode = (taskDetail?.instanceStatus ?? data?.instanceStatus ?? data?.status) as number | string | undefined
              const endTime = taskDetail?.executeEndTime ?? data?.executeEndTime
              const failMsg = taskDetail?.failMsg ?? data?.failMsg
              const isTerminal = statusCode === 1 || statusCode === 3 || (statusCode == null && endTime != null)
              if (isTerminal) {
                const polling = { run_id: runId, attempts_used: attempt, attempts_max: maxAttempts, interval_seconds: argv.interval, terminal_status: STATUS_NAME[statusCode as number] ?? statusCode }
                if (statusCode === 3 || failMsg) {
                  error("RUN_FAILED", String(failMsg ?? `Run ${runId} ended with terminal failure status`), { format, extra: { run_detail: data, polling } })
                }
                logOperation("runs wait", { ok: true })
                success(data ?? {}, { format, extra: { polling } })
              }
              if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, intervalMs))
            }
            const timeoutPayload = { run_id: runId, attempts_used: maxAttempts, attempts_max: maxAttempts, interval_seconds: argv.interval, last_detail: lastPayload }
            if (argv["allow-timeout"]) {
              logOperation("runs wait", { ok: true })
              success(timeoutPayload, { format, aiMessage: "Polling reached max attempts before terminal state." })
            }
            error("RUN_WAIT_TIMEOUT", `Run ${runId} did not reach terminal state within ${maxAttempts} attempts.`, { format })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        ["logs <id>", "log <id>"],
        "Get run execution log",
        (y) =>
          y
            .positional("id", { type: "string", demandOption: true })
            .option("offset", { type: "number", describe: "Log byte offset" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const runId = await resolveRunIdOrTaskName(sc, argv.id as string, format)
            const attemptsResp = await listAttempts(sc, {
              taskInstanceId: runId,
              projectId: sc.projectId,
              pageIndex: 1,
              pageSize: 20,
            })
            const attemptsData = attemptsResp.data as Record<string, unknown> | undefined
            const items = attemptsData?.list ?? attemptsData
            const list = Array.isArray(items) ? items as Record<string, unknown>[] : []
            if (list.length === 0) error("NO_ATTEMPTS", `Run ${runId} has no attempt records yet`, { format })
            const item = list[0]
            const attemptId = Number(item.executeLogId ?? item.id ?? item.attemptId ?? item.attempt_id)
            const logResp = await getAttemptLog(sc, {
              queryLogActionCode: "1",
              taskInstanceId: runId,
              executeLogId: attemptId,
              ...(argv.offset != null ? { offset: argv.offset as number } : {}),
            })
            const normalized = normalizeRunIdentity(
              (logResp.data as Record<string, unknown>) ?? {},
              { attempt_id: attemptId },
            )
            logOperation("runs logs", { ok: true })
            success(normalized, { format })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "deps <task>",
        "View published task dependencies (调度态)",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true, describe: "Task name or ID" })
            .option("parent-level", { type: "number", default: 1, describe: "Upstream dependency depth" })
            .option("child-level", { type: "number", default: 1, describe: "Downstream dependency depth" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const taskId = await resolveTaskId(sc, argv.task as string, format)
            const resp = await getTaskRelation(sc, {
              scheduleTaskId: taskId,
              projectId: sc.projectId,
              parentLevel: Math.max(1, argv["parent-level"] as number),
              childLevel: Math.max(1, argv["child-level"] as number),
            })
            const relation = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
            relation.task_id ??= taskId
            relation.parent_tasks ??= []
            relation.child_tasks ??= []
            logOperation("runs deps", { ok: true })
            success(relation, { format, aiMessage: t("runs_deps") })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "stop <id>",
        "Stop a running instance",
        (y) =>
          y
            .positional("id", { type: "string", demandOption: true })
            .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip confirmation" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const runId = await resolveRunIdOrTaskName(sc, argv.id as string, format)
            if (!argv.yes) {
              const ok = await confirm(t("stop_confirm"))
              if (!ok) {
                success({ message: "Cancelled by user. No stop action was executed.", action: "runs.stop", executed: false }, { format })
                return
              }
            }
            const resp = await stopRun(sc, runId)
            logOperation("runs stop", { ok: true })
            const normalized = normalizeRunIdentity(
              (resp.data as Record<string, unknown>) ?? {},
              { run_id: runId },
            )
            success(normalized, { format })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "refill <task>",
        "[🟠 HIGH IMPACT] Submit a backfill job. Requires confirmation.",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true, describe: "Task name or ID" })
            .option("from", { type: "string", describe: "Backfill start (YYYY-MM-DD or ISO)" })
            .option("to", { type: "string", describe: "Backfill end (YYYY-MM-DD or ISO)" })
            .option("vc", { type: "string", default: "DEFAULT", describe: "VC code" })
            .option("name", { type: "string", describe: "Backfill job name" })
            .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip confirmation" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const taskId = await resolveTaskId(sc, argv.task as string, format)
            if (!argv.yes) {
              const range = argv.from && argv.to ? ` from ${argv.from} to ${argv.to}` : ""
              const ok = await confirm(`Submit backfill for task ${taskId}${range}?`)
              if (!ok) {
                success({ message: "Cancelled by user. No refill action was executed.", action: "runs.refill", executed: false }, { format })
                return
              }
            }
            if ((argv.from && !argv.to) || (!argv.from && argv.to)) {
              error("INVALID_ARGUMENTS", "--from and --to must be provided together, or omit both.", { format, exitCode: 2 })
            }
            const params: Record<string, unknown> = {
              scheduleTaskId: taskId,
              sqlVcCode: argv.vc,
              projectId: sc.projectId,
            }
            if (argv.from && argv.to) {
              params.bizStartTime = parseWindowBoundary(argv.from as string, false)
              params.bizEndTime = parseWindowBoundary(argv.to as string, true)
            } else {
              const nowMs = Date.now()
              params.bizStartTime = nowMs
              params.bizEndTime = nowMs
            }
            if (argv.name) params.complementJobName = argv.name
            const resp = await createBackfill(sc, params)
            const refillData = normalizeRunIdentity(
              (resp.data as Record<string, unknown>) ?? {},
            )
            const refillRunId = refillData.run_id ?? ""
            logOperation("runs refill", { ok: true })
            success(refillData, { format, aiMessage: t("runs_refill", String(refillRunId)) })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "rerun <id>",
        "Rerun a failed instance",
        (y) => y.positional("id", { type: "string", demandOption: true }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const runId = await resolveRunIdOrTaskName(sc, argv.id as string, format)
            const resp = await rerunInstance(sc, runId)
            logOperation("runs rerun", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "stats",
        "Get run statistics summary",
        (y) =>
          y
            .option("task", { type: "string", describe: "Task name or ID filter" })
            .option("from", { type: "string", describe: "Start time (ISO)" })
            .option("to", { type: "string", describe: "End time (ISO)" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const now = Date.now()
            const fromMs = argv.from ? parseWindowBoundary(argv.from as string, false) : now - 86400000
            const toMs = argv.to ? parseWindowBoundary(argv.to as string, true) : now
            const resp = await getTaskRunStats(sc, {
              projectId: sc.projectId,
              queryPlanTimeLeft: String(fromMs),
              queryPlanTimeRight: String(toMs),
              ...(argv.task ? { taskNameRlike: argv.task as string } : {}),
            })
            logOperation("runs stats", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .demandCommand(1, ""),
  )
}
