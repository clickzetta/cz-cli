import type { Argv } from "yargs"
import type { GlobalArgs } from "./cli.js"
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
import { registerGatewayCommand } from "./commands/gateway.js"

export function registerCommands(cli: Argv<GlobalArgs>): Argv<GlobalArgs> {
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
  registerGatewayCommand(cli)
  return cli
}
