import type { Argv } from "yargs"
import { listAttempts, getAttemptLog, type StudioConfig } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getStudioContext } from "./studio-context.js"
import { resolveRunIdOrTaskName, resolveLatestRunId } from "../resolver.js"
import { normalizeRunIdentity } from "../identity.js"

async function ctx(argv: Record<string, unknown>): Promise<StudioConfig> {
  return getStudioContext(argv)
}

async function resolveAttemptId(
  sc: StudioConfig,
  runId: number,
): Promise<number> {
  const resp = await listAttempts(sc, {
    taskInstanceId: runId,
    projectId: sc.projectId,
    pageIndex: 1,
    pageSize: 20,
  })
  const items = (resp.data as Record<string, unknown>)?.list ?? resp.data
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) throw new Error(`No attempts found for run ${runId}`)
  const item = list[0] as Record<string, unknown>
  return (item.executeLogId ?? item.id ?? item.attemptId ?? item.attempt_id) as number
}

async function logHandler(argv: Record<string, unknown>): Promise<void> {
  const format = (argv as { output: string }).output
  try {
    const sc = await ctx(argv)
    let runId: number
    const idArg = argv.id as string | undefined
    if (idArg) {
      runId = await resolveRunIdOrTaskName(sc, idArg, format)
    } else if (argv["run-id"]) {
      runId = await resolveRunIdOrTaskName(sc, String(argv["run-id"]), format)
    } else if (argv["task-id"]) {
      const taskId = await (async () => {
        const { resolveTaskId } = await import("../resolver.js")
        return resolveTaskId(sc, String(argv["task-id"]), format)
      })()
      const r = await resolveLatestRunId(sc, format, { taskId })
      if (r === undefined) return
      runId = r
    } else {
      return error("USAGE_ERROR", "Provide a run_id/task_name argument, --run-id, or --task-id", { format })
    }
    const attemptId = argv["attempt-id"]
      ? (argv["attempt-id"] as number)
      : await resolveAttemptId(sc, runId)
    const logParams = {
      queryLogActionCode: "1" as const,
      taskInstanceId: runId,
      executeLogId: attemptId,
      offset: (argv.offset != null && argv.offset !== 0) ? (argv.offset as number) : 0,
    }
    const resp = await getAttemptLog(sc, logParams)
    const normalized = normalizeRunIdentity(
      (resp.data as Record<string, unknown>) ?? {},
      { attempt_id: attemptId },
    )
    logOperation("attempts log", { ok: true })
    success(normalized, { format })
  } catch (err) {
    error("ATTEMPTS_ERROR", err instanceof Error ? err.message : String(err), { format })
  }
}

const logOptions = (y: Argv) =>
  y
    .positional("id", { type: "string", describe: "Run instance ID or task name. Priority: positional > --run-id > --task-id." })
    .option("run-id", { type: "string", describe: "Run instance ID or task name (alternative to positional argument)" })
    .option("task-id", { type: "string", describe: "Task name or ID — auto-selects the most recent run" })
    .option("attempt-id", { type: "number", describe: "Attempt log ID. Auto-selects the first attempt if omitted." })
    .option("offset", { type: "number", default: 0, describe: "Log byte offset for paginating large logs" })

export function registerAttemptsCommand(cli: Argv<GlobalArgs>): void {
  cli.command("attempts", "Manage attempt records", (yargs) =>
    yargs
      .command(
        "list [id]",
        "List attempts for a run",
        (y) =>
          y
            .positional("id", { type: "string", describe: "Run instance ID or task name. Priority: positional > --run-id > --task-id > auto-select latest run." })
            .option("run-id", { type: "string", describe: "Run instance ID or task name (alternative to positional argument)" })
            .option("task-id", { type: "string", describe: "Task name or ID — auto-selects the most recent run for that task" })
            .option("page", { type: "number", default: 1 })
            .option("page-size", { type: "number", default: 10 })
            .option("limit", { type: "number", describe: "Alias of --page-size" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const pageSize = argv.limit ?? argv["page-size"]
            let runId: number
            const idArg = argv.id as string | undefined
            if (idArg) {
              runId = await resolveRunIdOrTaskName(sc, idArg, format)
            } else if (argv["run-id"]) {
              runId = await resolveRunIdOrTaskName(sc, String(argv["run-id"]), format)
            } else if (argv["task-id"]) {
              const { resolveTaskId } = await import("../resolver.js")
              const taskId = await resolveTaskId(sc, String(argv["task-id"]), format)
              const r = await resolveLatestRunId(sc, format, { taskId })
              if (r === undefined) return
              runId = r
            } else {
              const r = await resolveLatestRunId(sc, format)
              if (r === undefined) return
              runId = r
            }
            const resp = await listAttempts(sc, {
              taskInstanceId: runId,
              projectId: sc.projectId,
              pageIndex: argv.page,
              pageSize,
            })
            const data = resp.data as Record<string, unknown> | undefined
            const items = Array.isArray(data?.list) ? data.list as Record<string, unknown>[] : []
            const total = data?.total ?? data?.totalCount
            const normalized = items.map((item) => normalizeRunIdentity(item, { run_id: runId }))
            const aiMessage = `Showing page ${argv.page}` +
              (total != null ? ` (${normalized.length} of ${total} total)` : "") +
              ` for run_id=${runId}.` +
              ` For next page: cz-cli attempts list ${runId} --page ${(argv.page as number) + 1} --page-size ${pageSize}`
            logOperation("attempts list", { ok: true })
            success(normalized, { format, aiMessage, extra: { pagination: { page: argv.page, page_size: pageSize, total }, selected_run_id: runId, run_id: runId } })
          } catch (err) {
            error("ATTEMPTS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command("log [id]", "Get attempt log", logOptions, logHandler)
      .command("logs [id]", "Get attempt log (alias)", logOptions, logHandler)
      .strictCommands().strictOptions().demandCommand(1, ""),
  )
}
