import type { Argv } from "yargs"
import { JobStatus } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { loadProfiles, saveProfiles, getDefaultProfileName } from "../connection/profile-store.js"
import { logOperation } from "../logger.js"
import { getExecContext, execSql, isQueryResult } from "./exec.js"

export function registerWorkspaceCommand(cli: Argv<GlobalArgs>): void {
  cli.command("workspace", "Manage workspace", (yargs) =>
    yargs
      .command(
        "current",
        "Show current workspace",
        () => {},
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const sql = "SELECT current_workspace()"
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("workspace current", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format })
            }
            const ws = r.rows[0] ? Object.values(r.rows[0])[0] : null
            logOperation("workspace current", { sql, ok: true, timeMs: Date.now() - t0 })
            success({ workspace: ws }, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "use <name>",
        "Switch workspace",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true, describe: "Workspace name" })
            .option("persist", { type: "boolean", default: false, describe: "Save to profile" }),
        async (argv) => {
          const format = argv.output
          const name = argv.name as string
          if (argv.persist) {
            try {
              const profiles = loadProfiles()
              const profileName = argv.profile ?? getDefaultProfileName() ?? Object.keys(profiles)[0]
              if (!profileName || !profiles[profileName]) {
                error("NO_PROFILE", "No profile found to update. Create a profile first.", { format })
              }
              profiles[profileName].workspace = name
              saveProfiles(profiles)
              logOperation("workspace use", { ok: true })
              success(
                { workspace: name, persisted: true, profile: profileName },
                { format, aiMessage: `Workspace set to '${name}' in profile '${profileName}'.` },
              )
            } catch (err) {
              error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format })
            }
          } else {
            success(
              { workspace: name, persisted: false },
              {
                format,
                aiMessage: `To use workspace '${name}', pass --workspace ${name} to each command, or run 'cz-tool workspace use ${name} --persist' to save it.`,
              },
            )
          }
        },
      )
      .demandCommand(1, ""),
  )
}
