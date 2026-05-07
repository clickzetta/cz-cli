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
            if (!ws) {
              logOperation("workspace current", { sql, ok: false, timeMs: Date.now() - t0 })
              error("NO_RESULT", "No current workspace set. Use `cz-cli workspace use <name>` to set one.", { format })
            }
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
            .option("schema", { type: "string", describe: "Default schema to set alongside workspace" })
            .option("persist", { type: "boolean", default: false, describe: "Save to profile" }),
        async (argv) => {
          const format = argv.output
          const name = argv.name as string
          const schemaVal = argv.schema as string | undefined
          if (argv.persist) {
            try {
              const profiles = loadProfiles()
              const profileName = argv.profile ?? getDefaultProfileName() ?? Object.keys(profiles)[0]
              if (!profileName || !profiles[profileName]) {
                error("PROFILE_NOT_FOUND", `Profile '${profileName}' not found. Create a profile first.`, { format })
              }
              profiles[profileName].workspace = name
              if (schemaVal) profiles[profileName].schema = schemaVal
              saveProfiles(profiles)
              logOperation("workspace use", { ok: true })
              success(
                {
                  message: `Switched to workspace '${name}' and updated profile '${profileName}'`,
                  workspace: name,
                  schema: schemaVal ?? (profiles[profileName].schema as string | undefined) ?? "public",
                },
                { format },
              )
            } catch (err) {
              error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format })
            }
          } else {
            const schemaName = schemaVal ?? "public"
            logOperation("workspace use", { ok: true })
            success(
              {
                message: `To use workspace '${name}', set SDK hint: {"sdk.job.default.ns": "${name}.${schemaName}"}`,
                workspace: name,
                schema: schemaName,
                note: "Use --persist to save this to your profile configuration",
              },
              { format },
            )
          }
        },
      )
      .demandCommand(1, ""),
  )
}
