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
cli.demandCommand(1, "").help().parse()
