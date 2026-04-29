import type { Argv } from "yargs"
import { listAttempts, getAttemptLog, listRuns, type StudioConfig } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getStudioContext } from "./studio-context.js"

async function ctx(argv: Record<string, unknown>): Promise<StudioConfig> {
  return getStudioContext(argv)
}

async function resolveRunId(sc: StudioConfig, argv: Record<string, unknown>): Promise<number> {
  if (argv["run-id"]) return argv["run-id"] as number
  if (argv["task-id"]) {
    const resp = await listRuns(sc, {
      scheduleTaskId: argv["task-id"] as number,
      projectId: sc.projectId,
      pageIndex: 1,
      pageSize: 1,
    })
    const items = (resp.data as Record<string, unknown>)?.list ?? resp.data
    const list = Array.isArray(items) ? items : []
    if (list.length === 0) throw new Error(`No runs found for task ${argv["task-id"]}`)
    const item = list[0] as Record<string, unknown>
    return (item.taskInstanceId ?? item.id) as number
  }
  throw new Error("Provide --run-id or --task-id")
}

async function resolveAttemptId(
  sc: StudioConfig,
  runId: number,
): Promise<number> {
  const resp = await listAttempts(sc, {
    taskInstanceId: runId,
    projectId: sc.projectId,
    pageIndex: 1,
    pageSize: 1,
  })
  const items = (resp.data as Record<string, unknown>)?.list ?? resp.data
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) throw new Error(`No attempts found for run ${runId}`)
  const item = list[0] as Record<string, unknown>
  return (item.executeLogId ?? item.id) as number
}

async function logHandler(argv: Record<string, unknown>): Promise<void> {
  const format = (argv as { output: string }).output
  try {
    const sc = await ctx(argv)
    const runId = await resolveRunId(sc, argv)
    const attemptId = argv["attempt-id"]
      ? (argv["attempt-id"] as number)
      : await resolveAttemptId(sc, runId)
    const resp = await getAttemptLog(sc, {
      queryLogActionCode: "1",
      taskInstanceId: runId,
      executeLogId: attemptId,
      offset: (argv.offset as number) ?? 0,
    })
    logOperation("attempts log", { ok: true })
    success(resp.data, { format })
  } catch (err) {
    error("ATTEMPTS_ERROR", err instanceof Error ? err.message : String(err), { format })
  }
}

const logOptions = (y: Argv) =>
  y
    .option("run-id", { type: "number", describe: "Run instance ID" })
    .option("task-id", { type: "number", describe: "Task ID (auto-selects latest run)" })
    .option("attempt-id", { type: "number", describe: "Attempt/execute log ID (auto-selects first if omitted)" })
    .option("offset", { type: "number", default: 0, describe: "Log byte offset" })

export function registerAttemptsCommand(cli: Argv<GlobalArgs>): void {
  cli.command("attempts", "Manage attempt records", (yargs) =>
    yargs
      .command(
        "list",
        "List attempts for a run",
        (y) =>
          y
            .option("run-id", { type: "number", describe: "Run instance ID" })
            .option("task-id", { type: "number", describe: "Task ID (auto-selects latest run)" })
            .option("page", { type: "number", default: 1 })
            .option("page-size", { type: "number", default: 10 }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const runId = await resolveRunId(sc, argv)
            const resp = await listAttempts(sc, {
              taskInstanceId: runId,
              projectId: sc.projectId,
              pageIndex: argv.page,
              pageSize: argv["page-size"],
            })
            logOperation("attempts list", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("ATTEMPTS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command("log", "Get attempt log", logOptions, logHandler)
      .command("logs", "Get attempt log (alias)", logOptions, logHandler)
      .demandCommand(1, ""),
  )
}
