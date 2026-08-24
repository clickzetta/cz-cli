import type { Argv } from "yargs"
import { JobStatus } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { VERSION } from "../version.js"
import { EXIT_BIZ_ERROR, success } from "../output/index.js"
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

        // A probe that came back FAILED does not throw — it returns a result whose
        // status says so. Reporting `connected: true` with null fields for that case
        // claimed a working connection on the strength of a query that did not work,
        // which is the same misreport the exit code below used to make.
        const failure = [wsResult, schemaResult].find(
          (result) => !isQueryResult(result) || result.status !== JobStatus.SUCCEEDED,
        )
        if (failure !== undefined) {
          const reason = isQueryResult(failure)
            ? (failure.errorMessage ?? `Probe query returned ${failure.status}`)
            : "Probe query returned an unexpected result"
          logOperation("status", { ok: false, errorCode: "CONNECTION_ERROR", timeMs: Date.now() - t0 })
          success(
            // workspace/schema stay present as null so all three outcomes have one
            // payload shape and `--field workspace` keeps answering.
            { connected: false, error: reason, workspace: null, schema: null, cli_version: VERSION, time_ms: Date.now() - t0 },
            { format },
          )
          process.exitCode = EXIT_BIZ_ERROR
          return
        }

        const workspace = isQueryResult(wsResult) && wsResult.rows[0] ? wsResult.rows[0][0] : null
        const schema = isQueryResult(schemaResult) && schemaResult.rows[0] ? schemaResult.rows[0][0] : null

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
        // The payload stays a data envelope — `connected: false` plus the reason IS
        // the answer to "what is the status", not a failure to answer — but the EXIT
        // CODE now reports the outcome, so `cz-cli status && <next step>` stops on a
        // dead connection instead of continuing. Same contract as pg_isready.
        success(
          {
            connected: false,
            error: msg,
            // Present as null, like the other two outcomes: one payload shape means
            // `--field workspace` answers whatever happened.
            workspace: null,
            schema: null,
            cli_version: VERSION,
            time_ms: Date.now() - t0,
          },
          { format },
        )
        process.exitCode = EXIT_BIZ_ERROR
      }
    },
  )
}
