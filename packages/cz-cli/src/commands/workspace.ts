import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import { JobStatus } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { loadProfiles, saveProfiles } from "../connection/profile-store.js"
import * as Profile from "../connection/profile-context.js"
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
        "current",
        "Show current workspace",
        () => {},
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const sql = "SELECT current_workspace()"
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("workspace current", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format }); return
            }
            const ws = r.rows[0] ? r.rows[0][0] : null
            if (!ws) {
              logOperation("workspace current", { sql, ok: false, timeMs: Date.now() - t0 })
              error("NO_RESULT", "No current workspace set. Use `cz-cli workspace use <name>` to set one.", {
                format,
                aiMessage: "No workspace is active. List available workspaces with: cz-cli workspace list, then set one with: cz-cli workspace use <name>",
              })
              return
            }
            logOperation("workspace current", { sql, ok: true, timeMs: Date.now() - t0 })
            success({ workspace: ws }, { format, timeMs: Date.now() - t0 })
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
              // Profile.current() (CZ_PROFILE, falling back to profiles.toml's
              // default_profile) is the single semantic source for "which profile is
              // active" — see its own docstring. The old fallback here
              // (getDefaultProfileName() ?? Object.keys(profiles)[0]) skipped
              // CZ_PROFILE entirely, so a `-p other` invocation with --no-persist-arg
              // could WRITE workspace/schema into a different profile than the one
              // the rest of the command actually queried against. Falling further to
              // "the first profile in the file" when even the default is unset is
              // worse here than on a read path: this persists a mutation into
              // profiles.toml, and Profile.current()'s own contract is that an
              // undefined result means "no profile configured", not "guess one".
              const profileName = argv.profile ?? Profile.current()
              if (!profileName) {
                error("PROFILE_NOT_FOUND", "No profile is active. Pass -p <profile> or set default_profile in profiles.toml.", { format })
                return
              }
              if (!profiles[profileName]) {
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
