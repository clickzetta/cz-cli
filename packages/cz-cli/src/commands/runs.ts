import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import {
  listRuns, getRunDetail, stopRun, rerunInstance,
  createBackfill, getInstanceRelation,
  getTaskRelation, listAttempts, getAttemptLog,
  getScheduleDetail, getInstanceStats,
  type StudioConfig,
} from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error, isHandledCliError } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getStudioContext, type StudioContext } from "./studio-context.js"
import { confirm } from "../confirm.js"
import { resolveTaskId, resolveRunIdOrTaskName } from "../resolver.js"
import { opsUrl } from "./studio-url.js"
import { normalizeRunIdentity, normalizeRunIdentityList } from "../identity.js"
import { t } from "../locale.js"
import {
  StudioTaskRunStatus,
  StudioTaskRunType,
  taskRunStatusName,
} from "../studio-contracts.js"

const STATUS_MAP: Record<string, number> = {
  SUCCESS: StudioTaskRunStatus.Success,
  WAITING: StudioTaskRunStatus.NotStarted,
  FAILED: StudioTaskRunStatus.Failed,
  RUNNING: StudioTaskRunStatus.Running,
}
const RUN_TYPE_MAP: Record<string, number> = {
  SCHEDULE: StudioTaskRunType.Schedule,
  TEMP: StudioTaskRunType.Temp,
  REFILL: StudioTaskRunType.Refill,
  "1": StudioTaskRunType.Schedule,
  "3": StudioTaskRunType.Temp,
  "4": StudioTaskRunType.Refill,
}

// ---------------------------------------------------------------------------
// Field converters — mirrors MCP server schedule_instance_tools.py converters
// ---------------------------------------------------------------------------
const TASK_RUN_FIELDS: Record<string, string> = {
  taskInstanceId: "run_id", instanceType: "task_run_type", instanceStatus: "task_run_status",
  scheduleTaskId: "task_id", cycleTaskName: "task_name", cycleTaskType: "task_type",
  tenantId: "tenant_id", userId: "user_id", projectId: "project_id", projectName: "project_name",
  taskOwnerCn: "task_owner_cn", taskOwnerEn: "task_owner_en",
  executorUserName: "executor_user_name", executorUserId: "executor_user_id",
  taskGroupId: "task_group_id", taskGroupName: "task_group_name",
  planTriggerTime: "plan_trigger_time", triggerTime: "trigger_time",
  executeStartTime: "execute_start_time", executeEndTime: "execute_end_time",
  startWaitTime: "start_wait_time", endWaitTime: "end_wait_time", waitSpanTime: "wait_span_time",
  failType: "fail_type", failMsg: "fail_msg", rerunStatus: "rerun_status",
  showTaskParam: "task_param", taskPriority: "task_priority", vcCode: "vc_code",
  env: "env", version: "version",
}

const EXECUTION_FIELDS: Record<string, string> = {
  scheduleTaskId: "task_id", scheduleInstanceId: "task_run_id", executeLogId: "execution_id",
  createdTime: "created_time", startTime: "start_time", endTime: "end_time",
  finishResult: "finish_result", createdBy: "created_by",
}

const RUN_STATS_FIELDS: Record<string, string> = {
  instanceStatus: "task_run_status", taskType: "task_type", instanceType: "task_run_type", count: "count",
}

function convertFields(data: Record<string, unknown>, mapping: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    out[mapping[k] ?? k] = v
  }
  return out
}

function convertRunList(items: Record<string, unknown>[]): Record<string, unknown>[] {
  // Keep only snake_case fields; drop unmapped camelCase API noise (extraParams,
  // applicationEnv, groupNumber, complementTaskId, etc.) to reduce agent context.
  return items.map((item) =>
    Object.fromEntries(
      Object.entries(convertFields(item, TASK_RUN_FIELDS)).filter(([k]) => !/[A-Z]/.test(k)),
    ),
  )
}

function convertRunStats(items: unknown[]): Record<string, unknown>[] {
  return (items as Record<string, unknown>[]).map((item) => convertFields(item, RUN_STATS_FIELDS))
}

function convertExecutions(items: unknown[]): Record<string, unknown>[] {
  return (items as Record<string, unknown>[]).map((item) => convertFields(item, EXECUTION_FIELDS))
}

const RUN_DEPENDENCY_FIELDS: Record<string, string> = {
  scheduleInstanceId: "task_run_id", taskInstanceStatus: "task_run_status",
  scheduleTaskId: "task_id", scheduleTaskName: "task_name", cycleTaskType: "task_type",
  projectId: "project_id", projectName: "project_name", tenantId: "tenant_id",
  planTriggerTime: "plan_trigger_time", executeStartTime: "execute_start_time",
  executeEndTime: "execute_end_time", taskOwnerDisplayName: "task_owner_display_name",
  taskOwnerUserId: "task_owner_user_id", cronExpression: "cron_expression",
  rerunStatus: "rerun_status", vcCode: "vc_code", nextLevelCount: "next_level_count",
}

function convertRunDependency(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (k in RUN_DEPENDENCY_FIELDS) {
      out[RUN_DEPENDENCY_FIELDS[k]!] = v
    } else if (k === "parentScheduleTaskInstanceBeans") {
      out["parent_task_runs"] = Array.isArray(v) ? v.map((i) => convertRunDependency(i as Record<string, unknown>)) : v
    } else if (k === "childScheduleTaskInstanceBeans") {
      out["child_task_runs"] = Array.isArray(v) ? v.map((i) => convertRunDependency(i as Record<string, unknown>)) : v
    }
  }
  return out
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

async function ctx(argv: Record<string, unknown>): Promise<StudioContext> {
  return getStudioContext(argv)
}

function reportRunsError(err: unknown, format: string | undefined): void {
  if (isHandledCliError(err)) return
  error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
}

export function registerRunsCommand(cli: Argv<GlobalArgs>): void {
  cli.command("runs", "Manage task run instances", (yargs) => {
    yargs
      .command(
        "list",
        "List run instances",
        (y) =>
          y
            .option("task", { type: "string", describe: "Filter by task name or ID" })
            .option("status", { type: "array", string: true, choices: ["SUCCESS", "WAITING", "FAILED", "RUNNING"], describe: "Filter by status (multiple allowed). SUCCESS=completed OK, WAITING=queued, FAILED=errored, RUNNING=in progress" })
            .option("run-type", { type: "string", choices: ["SCHEDULE", "TEMP", "REFILL"], describe: "Run type: SCHEDULE=scheduled runs, TEMP=ad-hoc executions, REFILL=backfill jobs" })
            .option("from", { type: "string", describe: "Start time filter (ISO 8601 or YYYY-MM-DD). Defaults to 24h ago." })
            .option("to", { type: "string", describe: "End time filter (ISO 8601 or YYYY-MM-DD). Defaults to now." })
            .option("page", { type: "number", default: 1 })
            .option("page-size", { type: "number", default: 10 })
            .option("limit", { type: "number", describe: "Alias of --page-size" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const pageSize = argv.limit ?? argv["page-size"]
            const now = Date.now()
            const fromMs = argv.from ? parseWindowBoundary(argv.from as string, false) : now - 86400000
            const toMs = argv.to ? parseWindowBoundary(argv.to as string, true) : now
            const statusList = argv.status
              ? (argv.status as string[]).map((s) => STATUS_MAP[s.toUpperCase()] ?? Number(s))
              : undefined
            const taskId = argv.task ? await resolveTaskId(sc, argv.task, format) : undefined
            const resolvedRunType = argv["run-type"] ? (RUN_TYPE_MAP[(argv["run-type"] as string).toUpperCase()] ?? Number(argv["run-type"])) : undefined
            const resp = await listRuns(sc, {
              projectId: sc.projectId,
              pageIndex: argv.page,
              pageSize,
              scheduleTaskId: taskId,
              instanceStatusList: statusList,
              instanceType: resolvedRunType,
              queryStartPlanTime: fromMs,
              queryEndPlanTime: toMs,
            })
            const items = convertRunList(Array.isArray(resp.data) ? resp.data as Record<string, unknown>[] : [])
            const total = resp.count
            const aiMessage = `当前仅展示第 ${resp.pageIndex ?? argv.page} 页` +
              (total != null ? `（${items.length} 条 / 共 ${total} 条）` : "") +
              `，run_type=${resolvedRunType ?? "all"}` +
              `。如需下一页，请执行: cz-cli runs list${resolvedRunType ? ` --run-type ${argv["run-type"]}` : ""} --page ${(argv.page as number) + 1} --page-size ${pageSize}`
            logOperation("runs list", { ok: true })
            success(items, { format, aiMessage, extra: { pagination: { page: argv.page, page_size: pageSize, total } } })
          } catch (err) {
            reportRunsError(err, format)
          }
        },
      )
      .command(
        "detail <id>",
        "Get run detail",
        (y) => y.positional("id", { type: "string", demandOption: true }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const runId = await resolveRunIdOrTaskName(sc, argv.id as string, format)
            const resp = await getRunDetail(sc, runId, { projectId: sc.projectId })
            const runData = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>
            const normalized = convertFields(runData, TASK_RUN_FIELDS) as Record<string, unknown>
            normalized.run_id = runId
            const start = normalized.execute_start_time as number | undefined
            const end = normalized.execute_end_time as number | undefined
            if (start && end) normalized.duration_ms = end - start
            let scheduleConfig: Record<string, unknown> | undefined
            let aiMessage = t("runs_detail")
            const scheduleTaskId = normalized.task_id ?? runData.scheduleTaskId
            if (scheduleTaskId != null) {
              try {
                const sResp = await getScheduleDetail(sc, {
                  scheduleTaskId: Number(scheduleTaskId),
                  projectId: sc.projectId,
                })
                const sData = (sResp.data && typeof sResp.data === "object" ? sResp.data : {}) as Record<string, unknown>
                const raw = (sData.scheduleTaskDetail ?? sData.schedule_task_detail ?? sData) as Record<string, unknown>
                scheduleConfig = {
                  cron_expression: raw.cronExpression,
                  active_start_time: raw.activeStartTime,
                  active_end_time: raw.activeEndTime,
                  publish_time: raw.publishTime,
                  extra_params: raw.extraParams,
                }
              } catch {
                aiMessage += " " + t("runs_detail_degraded")
              }
            } else {
              aiMessage += " " + t("runs_detail_degraded")
            }
            normalized.schedule_config = scheduleConfig
            logOperation("runs detail", { ok: true })
            success({ ...normalized, ops_url: opsUrl(sc, runId) }, { format, aiMessage })
          } catch (err) {
            reportRunsError(err, format)
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
            .option("allow-timeout", { type: "boolean", default: false, describe: "Exit with success (code 0) when max polling attempts are reached, instead of returning an error" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const runId = await resolveRunIdOrTaskName(sc, argv.id as string, format)
            const maxAttempts = Math.max(1, argv.attempts as number)
            const intervalMs = Math.max(100, (argv.interval as number) * 1000)
            let lastPayload: Record<string, unknown> | undefined
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              const resp = await getRunDetail(sc, runId, { projectId: sc.projectId })
              const data = resp.data as Record<string, unknown> | undefined
              lastPayload = data
              const taskDetail = (typeof data?.taskDetail === "object" && data?.taskDetail !== null ? data.taskDetail : data) as Record<string, unknown> | undefined
              const statusCode = (taskDetail?.instanceStatus ?? data?.instanceStatus ?? data?.status) as number | string | undefined
              const endTime = taskDetail?.executeEndTime ?? data?.executeEndTime
              const failMsg = taskDetail?.failMsg ?? data?.failMsg
              const isTerminal = statusCode === StudioTaskRunStatus.Success || statusCode === StudioTaskRunStatus.Failed || (statusCode == null && endTime != null)
              if (isTerminal) {
                const polling = { run_id: runId, attempts_used: attempt, attempts_max: maxAttempts, interval_seconds: argv.interval, terminal_status: taskRunStatusName(statusCode) }
                if (statusCode === StudioTaskRunStatus.Failed || failMsg) {
                  return error("RUN_FAILED", String(failMsg ?? `Run ${runId} ended with terminal failure status`), { format, extra: { run_detail: convertFields(taskDetail ?? data ?? {}, TASK_RUN_FIELDS), polling } })
                }
                logOperation("runs wait", { ok: true })
                return success(convertFields(taskDetail ?? data ?? {}, TASK_RUN_FIELDS), { format, extra: { polling } })
              }
              if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, intervalMs))
            }
            const timeoutPayload = { run_id: runId, attempts_used: maxAttempts, attempts_max: maxAttempts, interval_seconds: argv.interval, last_detail: lastPayload }
            if (argv["allow-timeout"]) {
              logOperation("runs wait", { ok: true })
              return success(timeoutPayload, { format, aiMessage: "Polling reached max attempts before terminal state." })
            }
            error("RUN_WAIT_TIMEOUT", `Run ${runId} did not reach terminal state within ${maxAttempts} attempts.`, { format })
          } catch (err) {
            reportRunsError(err, format)
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
          const format = argv.format
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
            if (list.length === 0) return error("NO_ATTEMPTS", `Run ${runId} has no attempt records yet`, { format })
            const item = list[0]
            const attemptId = Number(item.executeLogId ?? item.id ?? item.attemptId ?? item.attempt_id)
            const logResp = await getAttemptLog(sc, {
              queryLogActionCode: "1",
              taskInstanceId: runId,
              executeLogId: attemptId,
              ...(argv.offset != null ? { offset: argv.offset as number } : {}),
            })
            const logData = (logResp.data as Record<string, unknown>) ?? {}
            const normalized = { ...convertFields(logData, EXECUTION_FIELDS), execution_id: attemptId, ops_url: opsUrl(sc, runId) + "?tab=executeLog" }
            logOperation("runs logs", { ok: true })
            success(normalized, { format })
          } catch (err) {
            reportRunsError(err, format)
          }
        },
      )
      .command(
        "deps <id>",
        "View run instance upstream/downstream dependencies",
        (y) =>
          y
            .positional("id", { type: "string", demandOption: true, describe: "Run ID" })
            .option("parent-level", { type: "number", default: 1, describe: "Upstream dependency depth" })
            .option("child-level", { type: "number", default: 1, describe: "Downstream dependency depth" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const runId = await resolveRunIdOrTaskName(sc, argv.id as string, format)
            const resp = await getInstanceRelation(sc, {
              taskInstanceId: runId,
              projectId: sc.projectId,
              parentLevel: Math.max(1, argv["parent-level"] as number),
              childLevel: Math.max(1, argv["child-level"] as number),
            })
            const relation = convertRunDependency((resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>)
            relation.run_id ??= runId
            logOperation("runs deps", { ok: true })
            success(relation, { format, aiMessage: t("runs_deps") })
          } catch (err) {
            reportRunsError(err, format)
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
          const format = argv.format
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
            success(normalized, {
              format,
              aiMessage: `Stop requested for run ${runId}. Verify the final state with: cz-cli runs detail ${runId}`,
            })
          } catch (err) {
            reportRunsError(err, format)
          }
        },
      )
      .command(
        "refill <task>",
        "Submit a backfill job to re-run scheduled instances for a date range. Requires the current logged-in user name for backend createBy. Irreversible — requires confirmation.",
        (y) =>
          y
            .positional("task", { type: "string", demandOption: true, describe: "Task name or ID" })
            .option("from", { type: "string", describe: "Backfill start. Accepts YYYY-MM-DD (start of day) or ISO datetime YYYY-MM-DDTHH:MM:SS for sub-day schedules (hourly/minutely). Must be used together with --to." })
            .option("to", { type: "string", describe: "Backfill end. Accepts YYYY-MM-DD (end of day, 23:59:59) or ISO datetime YYYY-MM-DDTHH:MM:SS. For hourly/minutely tasks use exact datetime to avoid missing instances. Must be used together with --from." })
            .option("vc", { type: "string", default: "DEFAULT", describe: "VC code" })
            .option("name", { type: "string", describe: "Backfill job name. The backend operator/createBy comes from the current logged-in user and cannot be overridden here." })
            .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip confirmation" }),
        async (argv) => {
          const format = argv.format
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
              return
            }
            const createBy = sc.userName.trim()
            if (!createBy) {
              error("INVALID_ARGUMENTS", "Current login does not expose a user name required by Studio refill API. Re-authenticate or refresh your profile, then retry.", { format, exitCode: 2 })
              return
            }
            const nowMs = Date.now()
            const bizStartDate = argv.from ? parseWindowBoundary(argv.from as string, false) : nowMs
            const bizEndDate = argv.to ? parseWindowBoundary(argv.to as string, true) : nowMs
            const params: Record<string, unknown> = {
              scheduleTaskId: taskId,
              sqlVcCode: argv.vc,
              projectId: sc.projectId,
              userId: sc.userId,
              createBy,
              nextType: 0,
              complementType: 1,
              isConcurrence: 2,
              concurrenceNumber: 1,
              dateList: [{ bizStartDate, bizEndDate }],
              complementBizDateBeanList: [{ bizStartDate, bizEndDate }],
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
            reportRunsError(err, format)
          }
        },
      )
      .command(
        "rerun <id>",
        "Rerun a failed instance",
        (y) => y
          .positional("id", { type: "string", demandOption: true })
          .option("yes", { alias: "y", type: "boolean", describe: "Skip confirmation" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const runId = await resolveRunIdOrTaskName(sc, argv.id as string, format)
            if (!argv.yes) {
              const ok = await confirm(`Rerun instance ${runId}?`)
              if (!ok) {
                success({ message: "Cancelled.", action: "runs.rerun", executed: false }, { format })
                return
              }
            }
            const resp = await rerunInstance(sc, runId)
            logOperation("runs rerun", { ok: true })
            success(resp.data, {
              format,
              aiMessage: `Rerun submitted for ${runId}. Check status with: cz-cli runs detail ${runId} | View logs: cz-cli runs logs ${runId}`,
            })
          } catch (err) {
            reportRunsError(err, format)
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
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const now = Date.now()
            const fromMs = argv.from ? parseWindowBoundary(argv.from as string, false) : now - 86400000
            const toMs = argv.to ? parseWindowBoundary(argv.to as string, true) : now
            const resp = await getInstanceStats(sc, {
              projectId: sc.projectId,
              queryStartPlanTime: fromMs,
              queryEndPlanTime: toMs,
              ...(argv.task ? { scheduleTaskName: argv.task as string } : {}),
            })
            logOperation("runs stats", { ok: true })
            const statsData = Array.isArray(resp.data) ? convertRunStats(resp.data) : resp.data
            success(statsData, { format })
          } catch (err) {
            reportRunsError(err, format)
          }
        },
      )
    return commandGroup(yargs, "runs")
  })
}
