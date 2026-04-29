import type { Argv } from "yargs"
import { listAttempts, getAttemptLog, type StudioConfig } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getStudioContext } from "./studio-context.js"

async function ctx(argv: Record<string, unknown>): Promise<StudioConfig> {
  return getStudioContext(argv)
}

export function registerAttemptsCommand(cli: Argv<GlobalArgs>): void {
  cli.command("attempts", "Manage attempt records", (yargs) =>
    yargs
      .command(
        "list",
        "List attempts for a run",
        (y) =>
          y
            .option("run-id", { type: "number", demandOption: true, describe: "Run instance ID" })
            .option("page", { type: "number", default: 1 })
            .option("page-size", { type: "number", default: 10 }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await listAttempts(sc, {
              taskInstanceId: argv["run-id"] as number,
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
      .command(
        "log",
        "Get attempt log",
        (y) =>
          y
            .option("run-id", { type: "number", demandOption: true, describe: "Run instance ID" })
            .option("attempt-id", { type: "number", demandOption: true, describe: "Attempt/execute log ID" })
            .option("offset", { type: "number", default: 0, describe: "Log byte offset" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await getAttemptLog(sc, {
              queryLogActionCode: "1",
              taskInstanceId: argv["run-id"] as number,
              executeLogId: argv["attempt-id"] as number,
              offset: argv.offset as number,
            })
            logOperation("attempts log", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("ATTEMPTS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .demandCommand(1, ""),
  )
}
