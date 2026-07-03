import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import { JobStatus } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { loadProfiles, saveProfiles, getDefaultProfileName } from "../connection/profile-store.js"
import { logOperation } from "../logger.js"
import { getExecContext, execSql, isQueryResult, classifyExecError } from "./exec.js"

export function registerWorkspaceCommand(cli: Argv<GlobalArgs>): void {
  cli.command("workspace", "Manage workspace", (yargs) => {
    yargs
      .command(
        "list",
        "List available workspaces",
        () => {},
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const sql = "SHOW WORKSPACES"
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format }); return
            }
            const workspaces = r.rows.map((row) => row[0])
            success(workspaces, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
            error(_ec, _em, { format, ...(_ea && { aiMessage: _ea }) })
          }
        },
      )
      .command(
        "use <name>",
        "Switch workspace (use --persist to save to profile)",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true, describe: "Workspace name" })
            .option("schema", { type: "string", describe: "Default schema to set alongside workspace" })
            .option("persist", { type: "boolean", default: true, describe: "Save workspace to profile config (permanent). Use --no-persist to only show the SDK hint without saving." }),
        async (argv) => {
          const format = argv.format
          const name = argv.name as string
          const schemaVal = argv.schema as string | undefined
          if (argv.persist) {
            try {
              const profiles = loadProfiles()
              const profileName = argv.profile ?? getDefaultProfileName() ?? Object.keys(profiles)[0]
              if (!profileName || !profiles[profileName]) {
                error("PROFILE_NOT_FOUND", `Profile '${profileName}' not found. Create a profile first.`, { format })
                return
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
              const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
              error(_ec, _em, { format, ...(_ea && { aiMessage: _ea }) })
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
    return commandGroup(yargs, "workspace")
  })
}
