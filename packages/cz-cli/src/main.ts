#!/usr/bin/env bun
import { createCli } from "./cli.js"
import { registerSqlCommand } from "./commands/sql.js"
import { registerSchemaCommand } from "./commands/schema.js"
import { registerTableCommand } from "./commands/table.js"
import { registerWorkspaceCommand } from "./commands/workspace.js"
import { registerStatusCommand } from "./commands/status.js"
import { registerProfileCommand } from "./commands/profile.js"
import { registerTaskCommand } from "./commands/task.js"
import { registerRunsCommand } from "./commands/runs.js"
import { registerAttemptsCommand } from "./commands/attempts.js"
import { registerAgentCommand } from "./commands/agent.js"
import { registerJobCommand } from "./commands/job.js"
import { registerAiGuideCommand } from "./commands/ai-guide.js"
import { registerSetupCommand } from "./commands/setup.js"
import { registerUpdateCommand } from "./commands/update.js"
import { registerDatasourceCommand } from "./commands/datasource.js"
import { trackCommand } from "./telemetry.js"
import { checkAndUpdate } from "./auto-update.js"

const startMs = Date.now()

process.on("SIGINT", () => {
  process.stdout.write(JSON.stringify({ error: { code: "ABORTED", message: "Operation aborted by user." } }) + "\n")
  process.exit(130)
})

const cliArgs = process.argv.slice(2)
const cli = createCli(cliArgs)
registerSqlCommand(cli)
registerSchemaCommand(cli)
registerTableCommand(cli)
registerWorkspaceCommand(cli)
registerStatusCommand(cli)
registerProfileCommand(cli)
registerTaskCommand(cli)
registerRunsCommand(cli)
registerAttemptsCommand(cli)
registerAgentCommand(cli)
registerJobCommand(cli)
registerAiGuideCommand(cli)
registerSetupCommand(cli)
registerUpdateCommand(cli)
registerDatasourceCommand(cli)
cli.demandCommand(1, "").help()

const positional = cliArgs.filter(a => !a.startsWith("-"))
const args: Record<string, string> = {}
if (positional.length > 2) {
  args["_positional"] = positional.slice(2).join(" ")
}
for (let i = 0; i < cliArgs.length; i++) {
  const a = cliArgs[i]
  if (!a.startsWith("-")) continue
  const eqIdx = a.indexOf("=")
  if (eqIdx > 0) {
    args[a.slice(0, eqIdx).replace(/^-+/, "")] = a.slice(eqIdx + 1)
  } else {
    const next = cliArgs[i + 1]
    const key = a.replace(/^-+/, "")
    if (next && !next.startsWith("-")) {
      args[key] = next
      i++
    } else {
      args[key] = "true"
    }
  }
}

const track = (success: boolean, error?: string) =>
  trackCommand({
    command: positional[0] ?? "unknown",
    subcommand: positional[1],
    args: Object.keys(args).length > 0 ? args : undefined,
    duration_ms: Date.now() - startMs,
    success,
    error,
    response_bytes: (process as unknown as Record<string, unknown>).responseBytes as number | undefined,
  })

cli.parseAsync().then(async () => {
  const lastError = (process as unknown as Record<string, unknown>).lastError as string | undefined
  await track(!process.exitCode, process.exitCode ? lastError ?? `exit_code=${process.exitCode}` : undefined)
}).catch(async (e) => {
  if (positional[0] !== "setup") await track(false, e instanceof Error ? e.message : `exit_code=${process.exitCode ?? 1}`)
})

// Exit with the code set by success/error/fail handlers
if (process.exitCode) process.exit()

// Run update check in background on exit (non-blocking, like Python's __main__.py)
// Fire-and-forget: don't let update check failures affect CLI exit code
checkAndUpdate().catch(() => {})
