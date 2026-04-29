#!/usr/bin/env bun
import { createCli } from "./cli.js"
import { registerSqlCommand } from "./commands/sql.js"
import { registerSchemaCommand } from "./commands/schema.js"
import { registerTableCommand } from "./commands/table.js"
import { registerWorkspaceCommand } from "./commands/workspace.js"
import { registerStatusCommand } from "./commands/status.js"

const cli = createCli(process.argv.slice(2))
registerSqlCommand(cli)
registerSchemaCommand(cli)
registerTableCommand(cli)
registerWorkspaceCommand(cli)
registerStatusCommand(cli)
cli.demandCommand(1, "").help().parse()
