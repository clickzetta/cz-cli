import type { Argv } from "yargs"
import { JobStatus } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { VERSION } from "../version.js"
import { success } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getExecContext, execSql, isQueryResult } from "./exec.js"

export function registerStatusCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "status",
    "Check connection status",
    () => {},
    async (argv) => {
      const format = argv.format
      const t0 = Date.now()
      try {
        const ctx = await getExecContext(argv)

        const [wsResult, schemaResult] = await Promise.all([
          execSql(ctx, "SELECT current_workspace()"),
          execSql(ctx, "SELECT current_schema()"),
        ])

        const workspace =
          isQueryResult(wsResult) && wsResult.status === JobStatus.SUCCEEDED && wsResult.rows[0]
            ? wsResult.rows[0][0]
            : null
        const schema =
          isQueryResult(schemaResult) && schemaResult.status === JobStatus.SUCCEEDED && schemaResult.rows[0]
            ? schemaResult.rows[0][0]
            : null

        logOperation("status", { ok: true, timeMs: Date.now() - t0 })
        success(
          {
            connected: true,
            workspace,
            schema,
            cli_version: VERSION,
            time_ms: Date.now() - t0,
          },
          { format },
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logOperation("status", { ok: false, errorCode: "CONNECTION_ERROR", timeMs: Date.now() - t0 })
        success(
          {
            connected: false,
            error: msg,
            cli_version: VERSION,
            time_ms: Date.now() - t0,
          },
          { format },
        )
      }
    },
  )
}
