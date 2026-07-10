/**
 * --help output tests for all cz-cli commands and subcommands.
 * Verifies: no error output, correct command name in header, key options present.
 * Run: bun test/e2e-help.ts
 */
import { agentGatewayHelpCases } from "./e2e-help/agent-gateway-cases.ts"
import { coreHelpCases } from "./e2e-help/core-cases.ts"
import { profileJobHelpCases } from "./e2e-help/profile-job-cases.ts"
import { runHelpCases } from "./e2e-help-runner.ts"
import { runsTaskHelpCases } from "./e2e-help/runs-task-cases.ts"

runHelpCases([
  ...coreHelpCases,
  ...profileJobHelpCases,
  ...runsTaskHelpCases,
  ...agentGatewayHelpCases,
])
