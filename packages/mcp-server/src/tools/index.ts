/**
 * tools/index.ts — registers all MCP tools into a ToolRegistry.
 *
 * Mirrors cz-mcp-server/cz_mcp/tools/__init__.py:get_all_tools()
 */

import type { ToolRegistry } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"

import { registerAdminTools } from "./admin.js"
import { registerTaskTools } from "./task.js"
import { registerExecuteTools } from "./execute.js"
import { registerDatasourceTools } from "./datasource.js"
import { registerFolderTools } from "./folder.js"
import { registerVcTools } from "./vc.js"
import { registerWorkspaceTools } from "./workspace.js"
import { registerDqcTools } from "./dqc.js"
import { registerCdcTools } from "./cdc.js"
import { registerKnowledgeTools } from "./knowledge.js"
import { registerSkillTools } from "./skill.js"
import { registerOptimizeTools } from "./optimize.js"
import { registerFlowTaskTools } from "./flow-task.js"
import { registerDatetimeTools } from "./datetime.js"
import { registerScheduleTaskTools } from "./schedule-task.js"
import { registerScheduleInstanceTools } from "./schedule-instance.js"
import { registerBackfillTools } from "./backfill.js"
import { registerSemanticViewTools } from "./semantic-view.js"
import { registerIntegrationTools } from "./integration.js"
import { registerAgentExecuteTools } from "./agent-execute.js"

/**
 * Register all available tools into the registry.
 * Mirrors __init__.py:get_all_tools() (lines 31-90).
 */
export function registerAllTools(registry: ToolRegistry, db: LakehouseDB): void {
  registerAdminTools(registry, db)
  registerDqcTools(registry, db)
  registerTaskTools(registry, db)
  registerFolderTools(registry, db)
  registerExecuteTools(registry, db)
  registerDatasourceTools(registry, db)
  registerVcTools(registry, db)
  registerWorkspaceTools(registry, db)
  registerCdcTools(registry, db)
  registerKnowledgeTools(registry, db)
  registerSkillTools(registry, db)
  registerOptimizeTools(registry, db)
  registerFlowTaskTools(registry, db)
  registerDatetimeTools(registry, db)
  registerScheduleTaskTools(registry, db)
  registerScheduleInstanceTools(registry, db)
  registerBackfillTools(registry, db)
  registerSemanticViewTools(registry, db)
  registerIntegrationTools(registry, db)
  registerAgentExecuteTools(registry, db)
}

export * from "./admin.js"
export * from "./task.js"
export * from "./execute.js"
export * from "./datasource.js"
export * from "./folder.js"
export * from "./vc.js"
export * from "./workspace.js"
export * from "./dqc.js"
export * from "./cdc.js"
export * from "./knowledge.js"
export * from "./skill.js"
export * from "./optimize.js"
export * from "./flow-task.js"
export * from "./datetime.js"
export * from "./schedule-task.js"
export * from "./schedule-instance.js"
export * from "./backfill.js"
export * from "./semantic-view.js"
export * from "./integration.js"
export * from "./agent-execute.js"
