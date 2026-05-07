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
import { registerInstallSkillsCommand } from "./commands/install-skills.js"
import { registerSetupCommand } from "./commands/setup.js"
import { checkAndUpdate } from "./auto-update.js"

process.on("SIGINT", () => {
  process.stdout.write(JSON.stringify({ ok: false, error: { code: "ABORTED", message: "Operation aborted by user." } }) + "\n")
  process.exit(130)
})

const cli = createCli(process.argv.slice(2))
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
registerInstallSkillsCommand(cli)
registerSetupCommand(cli)
cli.demandCommand(1, "").help().parse()

// Run update check in background on exit (non-blocking, like Python's __main__.py)
// Fire-and-forget: don't let update check failures affect CLI exit code
checkAndUpdate().catch(() => {})
