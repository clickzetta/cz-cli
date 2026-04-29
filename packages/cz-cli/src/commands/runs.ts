import type { Argv } from "yargs"
import {
  listRuns, getRunDetail, stopRun, rerunInstance,
  createBackfill, getRunContent, getInstanceRelation,
  type StudioConfig,
} from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getStudioContext } from "./studio-context.js"

const STATUS_MAP: Record<string, string> = {
  SUCCESS: "1", WAITING: "2", FAILED: "3", RUNNING: "4",
}
const RUN_TYPE_MAP: Record<string, string> = {
  SCHEDULE: "1", TEMP: "3", REFILL: "4",
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
            .option("task", { type: "string", describe: "Task ID filter" })
            .option("status", { type: "string", describe: "Status: SUCCESS/WAITING/FAILED/RUNNING" })
            .option("run-type", { type: "string", default: "SCHEDULE", describe: "SCHEDULE/TEMP/REFILL" })
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
            const fromMs = argv.from ? new Date(argv.from).getTime() : now - 86400000
            const toMs = argv.to ? new Date(argv.to).getTime() : now
            const statusList = argv.status
              ? [STATUS_MAP[argv.status.toUpperCase()] ?? argv.status]
              : undefined
            const resp = await listRuns(sc, {
              projectId: sc.projectId,
              pageIndex: argv.page,
              pageSize,
              scheduleTaskId: argv.task ? Number(argv.task) : undefined,
              instanceStatusList: statusList,
              cycleTaskType: RUN_TYPE_MAP[(argv["run-type"] as string).toUpperCase()] ?? argv["run-type"],
              queryStartPlanTime: String(fromMs),
              queryEndPlanTime: String(toMs),
            })
            logOperation("runs list", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "detail <id>",
        "Get run detail",
        (y) => y.positional("id", { type: "number", demandOption: true }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await getRunDetail(sc, argv.id as number, { projectId: sc.projectId })
            logOperation("runs detail", { ok: true })
            success(resp.data, { format })
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
            .positional("id", { type: "number", demandOption: true })
            .option("timeout", { type: "number", default: 300, describe: "Max wait seconds" })
            .option("interval", { type: "number", default: 10, describe: "Poll interval seconds" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const runId = argv.id as number
            const deadline = Date.now() + (argv.timeout as number) * 1000
            const interval = (argv.interval as number) * 1000
            while (Date.now() < deadline) {
              const resp = await getRunDetail(sc, runId, { projectId: sc.projectId })
              const data = resp.data as Record<string, unknown> | undefined
              const status = data?.instanceStatus ?? data?.status
              if (status === 1 || status === "SUCCESS") {
                logOperation("runs wait", { ok: true })
                success({ run_id: runId, status: "SUCCESS", detail: data }, { format })
              }
              if (status === 3 || status === "FAILED") {
                error("RUN_FAILED", `Run ${runId} failed`, { format })
              }
              await new Promise((r) => setTimeout(r, interval))
            }
            error("RUN_WAIT_TIMEOUT", `Run ${runId} did not complete within ${argv.timeout}s`, { format })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "logs <id>",
        "Get run logs (delegates to attempts)",
        (y) =>
          y
            .positional("id", { type: "number", demandOption: true })
            .option("offset", { type: "number", describe: "Log byte offset" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const content = await getRunContent(sc, argv.id as number)
            logOperation("runs logs", { ok: true })
            success(content.data, { format })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "deps <id>",
        "View run dependencies",
        (y) =>
          y
            .positional("id", { type: "number", demandOption: true })
            .option("parent-level", { type: "number", default: 1 })
            .option("child-level", { type: "number", default: 1 }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await getInstanceRelation(sc, {
              taskInstanceId: argv.id as number,
              projectId: sc.projectId,
              parentLevel: argv["parent-level"] as number,
              childLevel: argv["child-level"] as number,
            })
            logOperation("runs deps", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "stop <id>",
        "Stop a running instance",
        (y) => y.positional("id", { type: "number", demandOption: true }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await stopRun(sc, argv.id as number)
            logOperation("runs stop", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "refill",
        "Submit backfill job",
        (y) =>
          y
            .option("task-id", { type: "number", demandOption: true })
            .option("from", { type: "string", describe: "Backfill start (YYYY-MM-DD or ISO)" })
            .option("to", { type: "string", describe: "Backfill end (YYYY-MM-DD or ISO)" })
            .option("vc", { type: "string", default: "DEFAULT", describe: "VC code" })
            .option("name", { type: "string", describe: "Backfill job name" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const params: Record<string, unknown> = {
              scheduleTaskId: argv["task-id"],
              sqlVcCode: argv.vc,
              projectId: sc.projectId,
            }
            if (argv.from && argv.to) {
              params.bizStartTime = new Date(argv.from).getTime()
              params.bizEndTime = new Date(argv.to).getTime()
            }
            if (argv.name) params.complementJobName = argv.name
            const resp = await createBackfill(sc, params)
            logOperation("runs refill", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "rerun <id>",
        "Rerun a failed instance",
        (y) => y.positional("id", { type: "number", demandOption: true }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await rerunInstance(sc, argv.id as number)
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
            .option("task", { type: "string", describe: "Task ID filter" })
            .option("from", { type: "string", describe: "Start time (ISO)" })
            .option("to", { type: "string", describe: "End time (ISO)" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const now = Date.now()
            const fromMs = argv.from ? new Date(argv.from).getTime() : now - 86400000
            const toMs = argv.to ? new Date(argv.to).getTime() : now
            const base = {
              projectId: sc.projectId,
              pageIndex: 1,
              pageSize: 1,
              scheduleTaskId: argv.task ? Number(argv.task) : undefined,
              queryStartPlanTime: String(fromMs),
              queryEndPlanTime: String(toMs),
            }
            const [all, succeeded, failed, running, waiting] = await Promise.all([
              listRuns(sc, { ...base }),
              listRuns(sc, { ...base, instanceStatusList: ["1"] }),
              listRuns(sc, { ...base, instanceStatusList: ["3"] }),
              listRuns(sc, { ...base, instanceStatusList: ["4"] }),
              listRuns(sc, { ...base, instanceStatusList: ["2"] }),
            ])
            const total = (r: typeof all) => {
              const d = r.data as Record<string, unknown> | undefined
              return (d?.totalCount ?? d?.total ?? 0) as number
            }
            logOperation("runs stats", { ok: true })
            success({
              total: total(all),
              succeeded: total(succeeded),
              failed: total(failed),
              running: total(running),
              waiting: total(waiting),
              from: new Date(fromMs).toISOString(),
              to: new Date(toMs).toISOString(),
            }, { format })
          } catch (err) {
            error("RUNS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .demandCommand(1, ""),
  )
}
