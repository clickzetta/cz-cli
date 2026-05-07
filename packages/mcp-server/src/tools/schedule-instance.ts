/**
 * Schedule-instance tools — port of cz-mcp-server/cz_mcp/tools/schedule_instance_tools.py
 *
 * Python → TS mapping:
 *   schedule_instance_tools.py:30-126   convert_task_run_fields()           → convertTaskRunFields()
 *   schedule_instance_tools.py:129-222  convert_task_run_dependency_fields() → convertTaskRunDependencyFields()
 *   schedule_instance_tools.py:225-273  convert_execution_fields()           → convertExecutionFields()
 *   schedule_instance_tools.py:276-304  convert_run_stats_fields()           → convertRunStatsFields()
 *   schedule_instance_tools.py:307-423  handle_list_task_run()               → handleListTaskRun()
 *   schedule_instance_tools.py:426-581  list_task_run_tools()                → (tool def in registerScheduleInstanceTools)
 *   schedule_instance_tools.py:585-655  handle_get_task_run_dependencies()   → handleGetTaskRunDependencies()
 *   schedule_instance_tools.py:659-722  get_task_run_dependencies_tools()    → (tool def)
 *   schedule_instance_tools.py:725-797  handle_get_execution_log()           → handleGetExecutionLog()
 *   schedule_instance_tools.py:802-866  get_execution_log_tool()             → (tool def)
 *   schedule_instance_tools.py:870-944  handle_list_executions()             → handleListExecutions()
 *   schedule_instance_tools.py:948-1006 list_executions_tools()              → (tool def)
 *   schedule_instance_tools.py:1009-1097 handle_get_task_run_stats()         → handleGetTaskRunStats()
 *   schedule_instance_tools.py:1100-1248 get_task_run_stats_tools()          → (tool def)
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import {
  apiInstanceList,
  apiInstanceRelation,
  apiListExecutionRecords,
  apiGetExecutionLogContent,
  apiGetInstanceStatistics,
} from "./studio-api.js"