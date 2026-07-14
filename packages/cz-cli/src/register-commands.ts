import type { Argv } from "yargs"
import type { GlobalArgs } from "./cli.js"
import { registerSqlCommand } from "./commands/sql.js"
import { registerSchemaCommand } from "./commands/schema.js"
import { registerTableCommand } from "./commands/table.js"
import { registerWorkspaceCommand } from "./commands/workspace.js"
import { registerWorkspaceParamCommand } from "./commands/workspace-param.js"
import { registerStatusCommand } from "./commands/status.js"
import { registerProfileCommand } from "./commands/profile.js"
import { registerTaskCommand } from "./commands/task.js"
import { registerRunsCommand } from "./commands/runs.js"
import { registerAttemptsCommand } from "./commands/attempts.js"
import { registerAgentCommand } from "./commands/agent.js"
import { registerJobCommand } from "./commands/job.js"
import { registerSetupCommand } from "./commands/setup.js"
import { registerUpdateCommand } from "./commands/update.js"
import { registerDatasourceCommand } from "./commands/datasource.js"
import { registerGatewayCommand } from "./commands/ai-gateway.js"
import { registerAnalyticsAgentCommand } from "./commands/analytics-agent.js"
import { registerAutoupdateCommand } from "./commands/autoupdate.js"
import { registerDqcCommand } from "./commands/dqc.js"

export function registerCommands(cli: Argv<GlobalArgs>): Argv<GlobalArgs> {
  registerSqlCommand(cli)
  registerSchemaCommand(cli)
  registerTableCommand(cli)
  registerWorkspaceCommand(cli)
  registerWorkspaceParamCommand(cli)
  registerStatusCommand(cli)
  registerProfileCommand(cli)
  registerTaskCommand(cli)
  registerRunsCommand(cli)
  registerAttemptsCommand(cli)
  registerAgentCommand(cli)
  registerJobCommand(cli)
  registerSetupCommand(cli)
  registerUpdateCommand(cli)
  registerAutoupdateCommand(cli)
  registerDatasourceCommand(cli)
  registerGatewayCommand(cli)
  registerAnalyticsAgentCommand(cli)
  registerDqcCommand(cli)
  return cli
}
