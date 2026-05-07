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

// ---------------------------------------------------------------------------
// task_type_desc — schedule_instance_tools.py:25-28
// ---------------------------------------------------------------------------
const OFFLINE_TASK_TYPE_MAP: Record<number, string> = {
  1: "LakehouseSQL",
  2: "JdbcSQL",
  3: "Shell",
  4: "Python",
  5: "Notebook",
  6: "Spark",
  7: "Flink",
  8: "Hive",
  9: "Presto",
  10: "DataIntegration",
  11: "DataQuality",
  200: "Workflow",
  280: "FullIncrementalSync",
  291: "MultipleDISync",
  500: "Flow",
}

const REALTIME_TASK_TYPE_MAP: Record<number, string> = {
  28: "RealTimeDI",
  281: "MultipleRISync",
}

function buildTaskTypeDesc(): string {
  let desc = "Available offline task types:\n"
  desc += Object.entries(OFFLINE_TASK_TYPE_MAP)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([ft, name]) => `  - ${ft}: ${name}`)
    .join("\n")
  desc += "\nAvailable realtime task types:\n"
  desc += Object.entries(REALTIME_TASK_TYPE_MAP)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([ft, name]) => `  - ${ft}: ${name}`)
    .join("\n")
  return desc
}

const TASK_TYPE_DESC = buildTaskTypeDesc()

// ---------------------------------------------------------------------------
// convertTaskRunFields — schedule_instance_tools.py:30-126
// ---------------------------------------------------------------------------
function convertTaskRunFields(apiData: Record<string, unknown>): Record<string, unknown> {
  if (!apiData) return {}

  const fieldMapping: Record<string, string> = {
    // Core task run fields
    taskInstanceId: "task_run_id",
    instanceType: "task_run_type",
    instanceStatus: "task_run_status",
    scheduleTaskId: "task_id",
    cycleTaskName: "task_name",
    cycleTaskType: "task_type",
    // User and project fields
    tenantId: "tenant_id",
    userId: "user_id",
    projectId: "project_id",
    projectName: "project_name",
    taskOwnerCn: "task_owner_cn",
    taskOwnerEn: "task_owner_en",
    executorUserName: "executor_user_name",
    executorUserId: "executor_user_id",
    // Task group fields
    taskGroupId: "task_group_id",
    taskGroupName: "task_group_name",
    // Time fields
    planTriggerTime: "plan_trigger_time",
    triggerTime: "trigger_time",
    executeStartTime: "execute_start_time",
    executeEndTime: "execute_end_time",
    startWaitTime: "start_wait_time",
    endWaitTime: "end_wait_time",
    waitSpanTime: "wait_span_time",
    // Status and result fields
    failType: "fail_type",
    failMsg: "fail_msg",
    rerunStatus: "rerun_status",
    // Configuration fields
    showTaskParam: "task_param",
    taskPriority: "task_priority",
    vcCode: "vc_code",
    env: "env",
    version: "version",
  }

  const converted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(apiData)) {
    if (key in fieldMapping) {
      converted[fieldMapping[key]!] = value
    }
  }
  return converted
}

// ---------------------------------------------------------------------------
// convertTaskRunDependencyFields — schedule_instance_tools.py:129-222
// ---------------------------------------------------------------------------
function convertTaskRunDependencyFields(apiData: Record<string, unknown>): Record<string, unknown> {
  if (!apiData) return {}

  const fieldMapping: Record<string, string> = {
    scheduleInstanceId: "task_run_id",
    taskInstanceStatus: "task_run_status",
    scheduleTaskId: "task_id",
    scheduleTaskName: "task_name",
    cycleTaskType: "task_type",
    projectId: "project_id",
    projectName: "project_name",
    tenantId: "tenant_id",
    planTriggerTime: "plan_trigger_time",
    executeStartTime: "execute_start_time",
    executeEndTime: "execute_end_time",
    taskOwnerDisplayName: "task_owner_display_name",
    taskOwnerUserId: "task_owner_user_id",
    cronExpression: "cron_expression",
    rerunStatus: "rerun_status",
    vcCode: "vc_code",
    nextLevelCount: "next_level_count",
  }

  const converted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(apiData)) {
    if (key in fieldMapping) {
      converted[fieldMapping[key]!] = value
    } else if (key === "parentScheduleTaskInstanceBeans") {
      // schedule_instance_tools.py:197-204
      if (Array.isArray(value)) {
        converted["parent_task_runs"] = value.map((item) =>
          convertTaskRunDependencyFields(item as Record<string, unknown>),
        )
      } else {
        converted["parent_task_runs"] = value
      }
    } else if (key === "childScheduleTaskInstanceBeans") {
      // schedule_instance_tools.py:205-212
      if (Array.isArray(value)) {
        converted["child_task_runs"] = value.map((item) =>
          convertTaskRunDependencyFields(item as Record<string, unknown>),
        )
      } else {
        converted["child_task_runs"] = value
      }
    } else if (key === "parent" || key === "children") {
      // schedule_instance_tools.py:213-220
      if (Array.isArray(value)) {
        converted[key] = value.map((item) =>
          convertTaskRunDependencyFields(item as Record<string, unknown>),
        )
      } else {
        converted[key] = value
      }
    }
  }
  return converted
}

// ---------------------------------------------------------------------------
// convertExecutionFields — schedule_instance_tools.py:225-273
// ---------------------------------------------------------------------------
function convertExecutionFields(apiData: Record<string, unknown>): Record<string, unknown> {
  if (!apiData) return {}

  const fieldMapping: Record<string, string> = {
    scheduleTaskId: "task_id",
    scheduleInstanceId: "task_run_id",
    executeLogId: "execution_id",
    createdTime: "created_time",
    startTime: "start_time",
    endTime: "end_time",
    finishResult: "finish_result",
    createdBy: "created_by",
  }

  const converted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(apiData)) {
    if (key in fieldMapping) {
      converted[fieldMapping[key]!] = value
    }
  }
  return converted
}

// ---------------------------------------------------------------------------
// convertRunStatsFields — schedule_instance_tools.py:276-304
// ---------------------------------------------------------------------------
function convertRunStatsFields(apiData: Record<string, unknown>): Record<string, unknown> {
  if (!apiData) return {}

  const fieldMapping: Record<string, string> = {
    instanceStatus: "task_run_status",
    taskType: "task_type",
    instanceType: "task_run_type",
    count: "count",
  }

  const converted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(apiData)) {
    if (key in fieldMapping) {
      converted[fieldMapping[key]!] = value
    }
  }
  return converted
}

// ---------------------------------------------------------------------------
// handleListTaskRun — schedule_instance_tools.py:307-423
// ---------------------------------------------------------------------------
async function handleListTaskRun(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // schedule_instance_tools.py:316-320 — default time range
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    const yesterdayZeroMs = yesterday.getTime()
    const tomorrowEndMs = new Date(
      tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59,
    ).getTime()

    const taskNameOrId = (arguments_["task_name_or_id"] as string | undefined) ?? ""
    const taskType = arguments_["task_type"] as number | undefined
    const taskRunType = (arguments_["task_run_type"] as number | undefined) ?? 1
    const scheduleTaskId = arguments_["task_id"] as number | undefined
    const pageIndex = (arguments_["page_index"] as number | undefined) ?? 1
    const pageSize = (arguments_["page_size"] as number | undefined) ?? 10

    // schedule_instance_tools.py:329-333 — page_size limit
    if (pageSize > 20) {
      return { success: false, message: "page_size exceeds the maximum limit of 20." }
    }

    const orderBy = ((arguments_["order_by"] as string | undefined) ?? "desc").toUpperCase()
    const orderByField = (arguments_["order_by_field"] as string | undefined) ?? "execute_start_time"
    const queryStartTime = (arguments_["query_plan_time_left"] as number | undefined) ?? yesterdayZeroMs
    const queryEndTime = (arguments_["query_plan_time_right"] as number | undefined) ?? tomorrowEndMs
    let taskRunStatusList = arguments_["task_run_status_list"] as number[] | undefined
    const groupId = arguments_["group_id"] as number | undefined

    // schedule_instance_tools.py:342-349 — if status list contains 2, also add 5, 6, 8
    if (taskRunStatusList != null && Array.isArray(taskRunStatusList)) {
      if (taskRunStatusList.includes(2)) {
        for (const status of [5, 6, 8]) {
          if (!taskRunStatusList.includes(status)) {
            taskRunStatusList.push(status)
          }
        }
        logger.info({ taskRunStatusList }, "Added statuses 5, 6, 8 because list contains 2")
      }
    }

    const projectId = config.projectId
    logger.info({ projectId }, "Listing schedule task runs")

    const response = await apiInstanceList(config, {
      projectId,
      taskNameOrTaskId: taskNameOrId,
      taskType,
      instanceType: taskRunType,
      scheduleTaskId,
      pageIndex,
      pageSize,
      orderBy,
      orderByFields: orderByField,
      queryStartPlanTime: queryStartTime,
      queryEndPlanTime: queryEndTime,
      instanceStatusList: taskRunStatusList,
      groupId,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      const resPageIndex = (responseData["pageIndex"] as number | undefined) ?? pageIndex
      const tasks = (responseData["data"] as unknown[] | undefined) ?? []
      const count = responseData["count"]
      const convertedTasks = tasks.map((task) =>
        convertTaskRunFields(task as Record<string, unknown>),
      )
      return {
        success: true,
        message: "Successfully list task runs",
        task_run_list: convertedTasks,
        total_count: count,
        page_index: resPageIndex,
        page_size: pageSize,
      }
    } else {
      return {
        success: false,
        message: `[handle_list_schedule_task_run]API request failed: ${(responseData["msg"] as string | undefined) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Error in list task runs")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleGetTaskRunDependencies — schedule_instance_tools.py:585-655
// ---------------------------------------------------------------------------
async function handleGetTaskRunDependencies(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    let projectId = arguments_["project_id"] as string | undefined
    const taskRunId = arguments_["task_run_id"] as number
    const childLevel = (arguments_["child_level"] as number | undefined) ?? 1
    const parentLevel = (arguments_["parent_level"] as number | undefined) ?? 1

    if (projectId == null) {
      projectId = config.projectId
    }

    logger.info({ taskRunId, projectId }, "Getting schedule task run relation")

    const response = await apiInstanceRelation(config, {
      projectId: String(projectId),
      taskInstanceId: taskRunId,
      parentLevel,
      childLevel,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      const data = (responseData["data"] ?? {}) as Record<string, unknown>
      const convertedData = convertTaskRunDependencyFields(data)
      return {
        success: true,
        message: "Successfully get task run dependencies",
        graph: convertedData,
      }
    } else {
      return {
        success: false,
        message: `[handle_get_schedule_task_run_dependencies]API request failed: ${(responseData["msg"] as string | undefined) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Error in get task run dependencies")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleGetExecutionLog — schedule_instance_tools.py:725-797
// ---------------------------------------------------------------------------
async function handleGetExecutionLog(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const taskRunId = arguments_["task_run_id"] as number
    const executionId = arguments_["execution_id"] as number
    const offset = arguments_["offset"] as number | undefined
    const queryAction = (arguments_["query_action"] as number | undefined) ?? 3

    logger.info({ taskRunId, executionId }, "Getting execution logs")

    const response = await apiGetExecutionLogContent(config, {
      taskInstanceId: taskRunId,
      executeLogId: executionId,
      queryLogActionCode: queryAction,
      offset,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      const data = (responseData["data"] ?? {}) as Record<string, unknown>
      const logContent = data["logContent"] ?? ""
      const startOffset = data["startOffset"] ?? 0
      const endOffset = data["endOffset"] ?? 0
      const hasNext = data["hasNext"] ?? false
      return {
        success: true,
        message: "Successfully get execution logs",
        log_content: logContent,
        start_offset: startOffset,
        end_offset: endOffset,
        has_next: hasNext,
      }
    } else {
      return {
        success: false,
        message: `[handle_get_execution_log_content]API request failed: ${(responseData["msg"] as string | undefined) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Error in get execution logs")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleListExecutions — schedule_instance_tools.py:870-944
// ---------------------------------------------------------------------------
async function handleListExecutions(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    let projectId = arguments_["project_id"] as string | undefined
    const taskRunId = arguments_["task_run_id"] as number
    const pageIndex = (arguments_["page_index"] as number | undefined) ?? 1
    const pageSize = (arguments_["page_size"] as number | undefined) ?? 20

    if (projectId == null) {
      projectId = config.projectId
    }

    logger.info({ taskRunId, projectId }, "Getting executions for task run")

    const response = await apiListExecutionRecords(config, {
      projectId: String(projectId),
      taskInstanceId: taskRunId,
      pageIndex,
      pageSize,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      const data = (responseData["data"] as unknown[] | undefined) ?? []
      const count = responseData["count"]
      const convertedExecutions = data.map((execution) =>
        convertExecutionFields(execution as Record<string, unknown>),
      )
      return {
        success: true,
        message: "Successfully get executions",
        executions: convertedExecutions,
        total_count: count,
        page_index: pageIndex,
      }
    } else {
      return {
        success: false,
        message: `[handle_list_executions]API request failed: ${(responseData["msg"] as string | undefined) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Error in get executions")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleGetTaskRunStats — schedule_instance_tools.py:1009-1097
// ---------------------------------------------------------------------------
async function handleGetTaskRunStats(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // schedule_instance_tools.py:1018-1022 — default time range
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    const yesterdayZeroMs = yesterday.getTime()
    const tomorrowEndMs = new Date(
      tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59,
    ).getTime()

    const taskNameOrId = (arguments_["task_name_rlike"] as string | undefined) ?? ""
    const taskType = arguments_["task_type"] as number | undefined
    const taskRunType = (arguments_["task_run_type"] as number | undefined) ?? 1
    const queryStartTime = (arguments_["query_plan_time_left"] as number | undefined) ?? yesterdayZeroMs
    const queryEndTime = (arguments_["query_plan_time_right"] as number | undefined) ?? tomorrowEndMs
    const taskRunStatusList = arguments_["task_run_status_list"] as number[] | undefined
    const taskOwnerId = arguments_["task_owner_id"] as number | undefined
    const executorUserId = arguments_["executor_user_id"] as number | undefined
    const groupId = arguments_["group_id"] as number | undefined
    const vcCode = arguments_["vc_code"] as string | undefined

    const projectId = config.projectId
    logger.info({ projectId }, "Getting task run stats")

    const response = await apiGetInstanceStatistics(config, {
      projectId,
      scheduleTaskName: taskNameOrId,
      taskType,
      instanceType: taskRunType,
      queryStartPlanTime: queryStartTime,
      queryEndPlanTime: queryEndTime,
      instanceStatusList: taskRunStatusList,
      groupId,
      taskOwnerId,
      executorUserId,
      vcCode,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      const stats = (responseData["data"] as unknown[] | undefined) ?? []
      const convertedStats = stats.map((statistic) =>
        convertRunStatsFields(statistic as Record<string, unknown>),
      )
      return {
        success: true,
        message: "Successfully get task run stats",
        stats: convertedStats,
      }
    } else {
      return {
        success: false,
        message: `[handle_get_task_run_stats]API request failed: ${(responseData["msg"] as string | undefined) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Error in get task run stats")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}