/**
 * Schedule-task tools — port of cz-mcp-server/cz_mcp/tools/schedule_task_tools.py
 *
 * Python → TS mapping:
 *   schedule_task_tools.py:28-71   convert_task_statistics_fields        → convertTaskStatisticsFields()
 *   schedule_task_tools.py:74-161  convert_published_task_relation_fields → convertPublishedTaskRelationFields()
 *   schedule_task_tools.py:164-234 handle_get_published_task_relation     → handleGetPublishedTaskDependencies()
 *   schedule_task_tools.py:237-324 handle_get_task_statistics             → handleGetTaskStatistics()
 *   schedule_task_tools.py:327-427 get_task_statistics_tools()            → (tool definition in registerScheduleTaskTools)
 *   schedule_task_tools.py:430-494 get_published_task_dependencies_tools() → (tool definition in registerScheduleTaskTools)
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import {
  getBaseUrl,
  studioPost,
  buildHeaders,
} from "./studio-api.js"

// ---------------------------------------------------------------------------
// API path constants — api_properties.ini
// ---------------------------------------------------------------------------
const SCHEDULE_TASK_RELATION = "/ide-admin/v1/scheduleTask/queryTaskRelation"
const MCP_TASK_STATISTICS = "/ide-admin/v1/ai/mcp/task/statistic"

// ---------------------------------------------------------------------------
// API helpers — ide_admin_server.py:626-654 task_relation
//              ide_admin_server.py:954-997 get_task_statistics
// ---------------------------------------------------------------------------

/** ide_admin_server.py:626-654 task_relation */
async function apiTaskRelation(
  config: NonNullable<LakehouseDB["connectionConfig"]>,
  params: {
    projectId: string
    scheduleTaskId: number
    parentLevel: number
    childLevel: number
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + SCHEDULE_TASK_RELATION
  const headers = buildHeaders(config)
  return studioPost(url, headers, {
    scheduleTaskId: params.scheduleTaskId,
    projectId: params.projectId,
    parentLevel: params.parentLevel,
    childLevel: params.childLevel,
  })
}

/** ide_admin_server.py:954-997 get_task_statistics */
async function apiGetTaskStatistics(
  config: NonNullable<LakehouseDB["connectionConfig"]>,
  params: {
    projectId: string
    taskNameLike?: string
    taskOwner?: string
    fileType?: number
    fileFlowStatus?: number
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + MCP_TASK_STATISTICS
  const headers = buildHeaders(config)
  const body: Record<string, unknown> = {
    projectId: params.projectId,
    env: "prod",
  }
  if (params.taskNameLike != null) body["cycleTaskName"] = params.taskNameLike
  if (params.taskOwner != null) body["taskOwnerEn"] = params.taskOwner
  if (params.fileType != null) body["fileType"] = params.fileType
  if (params.fileFlowStatus != null) body["fileFlowStatus"] = params.fileFlowStatus
  return studioPost(url, headers, body)
}

// ---------------------------------------------------------------------------
// convertTaskStatisticsFields — schedule_task_tools.py:28-71
// ---------------------------------------------------------------------------
function convertTaskStatisticsFields(apiData: Record<string, unknown>): Record<string, unknown> {
  // schedule_task_tools.py:44-45
  if (!apiData) return {}

  // schedule_task_tools.py:47-51
  const fieldMapping: Record<string, string> = {
    fileFlowStatus: "task_edit_state",
    owner: "task_owner",
    cnt: "count",
  }

  const converted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(apiData)) {
    if (key in fieldMapping) {
      // schedule_task_tools.py:55-57
      converted[fieldMapping[key]!] = value
    } else if (key === "fileType") {
      // schedule_task_tools.py:58-65 — skip fileType→taskType conversion (no reverse map needed here)
      // Keep as-is since we don't have _convert_file_type_to_task_type in TS
      converted["task_type"] = value
    } else {
      // schedule_task_tools.py:67-69 — keep other fields as-is
      converted[key] = value
    }
  }

  return converted
}

// ---------------------------------------------------------------------------
// convertPublishedTaskRelationFields — schedule_task_tools.py:74-161
// ---------------------------------------------------------------------------
function convertPublishedTaskRelationFields(apiData: Record<string, unknown>): Record<string, unknown> {
  // schedule_task_tools.py:104-105
  if (!apiData) return {}

  // schedule_task_tools.py:107-131
  const fieldMapping: Record<string, string> = {
    tenantId: "tenant_id",
    projectId: "project_id",
    projectName: "project_name",
    scheduleTaskId: "task_id",
    scheduleTaskName: "task_name",
    taskStatus: "task_status",
    cycleTaskType: "task_type",
    scheduleRateType: "schedule_rate_type",
    taskOwnerUserName: "task_owner_user_name",
    taskOwnerUserId: "task_owner_user_id",
    createTime: "create_time",
    updateTime: "update_time",
    publishTime: "publish_time",
    nextLevelCount: "next_level_count",
    instanceCount: "task_run_count",
    lastInstanceStatus: "last_run_status",
  }

  const converted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(apiData)) {
    if (key in fieldMapping) {
      // schedule_task_tools.py:134-136
      converted[fieldMapping[key]!] = value
    } else if (key === "childScheduleTaskBeans") {
      // schedule_task_tools.py:137-143 — recursively convert child tasks
      if (Array.isArray(value)) {
        converted["child_tasks"] = value.map((item) =>
          convertPublishedTaskRelationFields(item as Record<string, unknown>),
        )
      } else {
        converted["child_tasks"] = value
      }
    } else if (key === "parentScheduleTaskBeans") {
      // schedule_task_tools.py:144-155 — recursively convert parent tasks
      if (Array.isArray(value)) {
        converted["parent_tasks"] = value.map((item) =>
          convertPublishedTaskRelationFields(item as Record<string, unknown>),
        )
      } else if (value === null) {
        converted["parent_tasks"] = null
      } else {
        converted["parent_tasks"] = value
      }
    }
    // schedule_task_tools.py:156-158 — skip fields not in mapping
  }

  return converted
}

// ---------------------------------------------------------------------------
// handleGetPublishedTaskDependencies — schedule_task_tools.py:164-234
// ---------------------------------------------------------------------------
async function handleGetPublishedTaskDependencies(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // schedule_task_tools.py:173-178
    const projectId = (arguments_["project_id"] as string | undefined) ?? config.projectId
    const scheduleTaskId = arguments_["task_id"] as number
    const childLevel = (arguments_["child_level"] as number | undefined) ?? 1
    const parentLevel = (arguments_["parent_level"] as number | undefined) ?? 1

    logger.info(
      { scheduleTaskId, projectId },
      "Getting task relation",
    )

    // schedule_task_tools.py:189-199
    const response = await apiTaskRelation(config, {
      projectId: String(projectId),
      scheduleTaskId,
      parentLevel,
      childLevel,
    })

    // schedule_task_tools.py:201-202
    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      // schedule_task_tools.py:203-215
      const data = responseData["data"] as Record<string, unknown>
      const convertedData = convertPublishedTaskRelationFields(data)

      return {
        success: true,
        message: "Successfully get published task relation",
        graph: convertedData,
      }
    } else {
      // schedule_task_tools.py:216-222
      return {
        success: false,
        message: `[handle_get_schedule_task_relation]API request failed: ${(responseData["msg"] as string | undefined) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    // schedule_task_tools.py:224-233
    logger.error({ err: e }, "Error in get task relation")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleGetTaskStatistics — schedule_task_tools.py:237-324
// ---------------------------------------------------------------------------
async function handleGetTaskStatistics(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // schedule_task_tools.py:247-253
    const projectId = (arguments_["project_id"] as string | undefined) ?? config.projectId
    const taskNameLike = arguments_["task_name_like"] as string | undefined
    const taskOwner = arguments_["task_owner"] as string | undefined
    const taskType = arguments_["task_type"] as number | undefined
    const taskEditState = arguments_["task_edit_state"] as number | undefined

    // schedule_task_tools.py:260-267 — convert TaskType to FileType for API
    // In TS we pass task_type directly as fileType (same numeric value)
    const fileType = taskType

    logger.info({ projectId }, "Getting task statistics")

    // schedule_task_tools.py:271-285
    const response = await apiGetTaskStatistics(config, {
      projectId: String(projectId),
      taskNameLike,
      taskOwner,
      fileType,
      fileFlowStatus: taskEditState,
    })

    // schedule_task_tools.py:287-288
    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      // schedule_task_tools.py:289-299
      const data = responseData["data"]
      let convertedStats: Record<string, unknown>[]
      if (Array.isArray(data)) {
        convertedStats = data.map((stat) =>
          convertTaskStatisticsFields(stat as Record<string, unknown>),
        )
      } else {
        convertedStats = data ? [convertTaskStatisticsFields(data as Record<string, unknown>)] : []
      }

      return {
        success: true,
        message: "Successfully get task statistics",
        statistics: convertedStats,
      }
    } else {
      // schedule_task_tools.py:308-314
      return {
        success: false,
        message: `[handle_get_task_statistics]API request failed: ${(responseData["msg"] as string | undefined) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    // schedule_task_tools.py:316-323
    logger.error({ err: e }, "Error in get task statistics")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// registerScheduleTaskTools — combines get_published_task_dependencies_tools()
//   (schedule_task_tools.py:430-494) and get_task_statistics_tools()
//   (schedule_task_tools.py:327-427)
// ---------------------------------------------------------------------------
export function registerScheduleTaskTools(registry: ToolRegistry, db: LakehouseDB): void {
  const getConfig = () => {
    if (!db.connectionConfig) throw new Error("No connection configuration available")
    return db.connectionConfig
  }

  const tools: ToolDefinition[] = [
    // schedule_task_tools.py:327-427 — get_task_statistics
    {
      name: "get_task_statistics",
      description:
        "Get task statistics aggregated by task in Clickzetta Studio. " +
        "Supports filtering by project space, task name pattern (like), " +
        "task owner, task type, and task edit state. " +
        "\n\n" +
        "**When to Use This Tool:**\n" +
        "✅ **PRIORITIZE this tool** when users ask vague questions about tasks, such as:\n" +
        "- 'What tasks do I have?'\n" +
        "- 'What's my task status?'\n" +
        "- 'Show me task statistics'\n" +
        "- 'How many tasks are there?'\n" +
        "- 'What's the task situation?'\n" +
        "\n" +
        "❌ **DO NOT use this tool** when users explicitly request:\n" +
        "- 'List all my tasks' (use list_tasks instead)\n" +
        "- 'Show me task details' (use get_task_detail instead)\n" +
        "- 'Get specific task information' (use get_task_detail instead)\n" +
        "\n" +
        "**Aggregation Dimensions:**\n" +
        "The returned statistics are aggregated by three dimensions:\n" +
        "- Task type (task_type)\n" +
        "- Task edit state (task_edit_state)\n Available values: 10=WAIT_FOR_SAVE, 20=WAIT_FOR_PUBLISH, 80=MODIFIED_AFTER_PUBLISH, 100=PUBLISHED" +
        "- Task owner (task_owner)\n" +
        "\n" +
        "**Secondary Aggregation:**\n" +
        "If the user needs higher-level aggregation (e.g., aggregated only by task owner, " +
        "or only by task type), you need to perform secondary aggregation on the returned data. " +
        "For example, to get statistics grouped only by task owner, sum up the 'count' field " +
        "for all records with the same 'task_owner' value.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "integer",
            description: "Project space ID. Optional; defaults to current project if not provided.",
          },
          task_name_like: {
            type: "string",
            description:
              "Task name pattern filter (partial match). " +
              "Optional; returns all tasks if omitted.",
          },
          task_owner: {
            type: "string",
            description:
              "Task owner filter (English name). " +
              "Optional; returns all tasks if omitted.",
          },
          task_type: {
            type: "integer",
            description:
              "Task type filter. " +
              "Optional; returns all task types if omitted. " +
              "Common values: 1=LakehouseSQL, 3=Shell, 4=Python, 5=Notebook, 10=DataIntegration, 28=RealTimeDI",
          },
          task_edit_state: {
            type: "integer",
            description:
              "Task edit state filter (fileFlowStatus). " +
              "Optional; returns all states if omitted. " +
              "Common values: 10=WAIT_FOR_SAVE, 20=WAIT_FOR_PUBLISH, 80=MODIFIED_AFTER_PUBLISH, 100=PUBLISHED",
          },
        },
        additionalProperties: false,
        required: [],
      },
      handler: async (args: Record<string, unknown>) => handleGetTaskStatistics(args, getConfig()),
      tags: ["schedule", "task_statistics", "statistics", "aggregation"],
      samples: [
        {
          description: "Get statistics for all tasks in project 2001.",
          query: { project_id: 2001 },
        },
        {
          description: "Get statistics for SQL tasks with name containing 'etl'.",
          query: { task_name_like: "etl", task_type: 23 },
        },
        {
          description: "Get statistics for tasks owned by a specific user.",
          query: { task_owner: "user123" },
        },
      ],
    },
    // schedule_task_tools.py:430-494 — get_published_task_dependencies
    {
      name: "get_published_task_dependencies",
      description:
        "Get upstream and downstream dependency tasks of a specific published task. " +
        "Returns dependency information as a tree structure, with configurable " +
        "parent (upstream) and child (downstream) depth levels.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "integer",
            description: "Project space ID of the task. Optional.",
          },
          task_id: {
            type: "integer",
            description: "Task ID for which to retrieve dependency relations. Required.",
          },
          parent_level: {
            type: "integer",
            description: "Number of upstream dependency levels to retrieve. Default is 1.",
            default: 1,
          },
          child_level: {
            type: "integer",
            description: "Number of downstream dependency levels to retrieve. Default is 1.",
            default: 1,
          },
        },
        additionalProperties: false,
        required: ["task_id"],
      },
      handler: async (args: Record<string, unknown>) =>
        handleGetPublishedTaskDependencies(args, getConfig()),
      tags: ["task_relation", "dependency", "graph"],
      samples: [
        {
          description:
            "Get 1-level upstream and downstream dependencies for task 9001 under project 2001.",
          query: {
            project_id: 2001,
            task_id: 9001,
            parent_level: 1,
            child_level: 1,
          },
        },
        {
          description:
            "Get 3 levels of upstream and 2 levels of downstream dependencies for the given task.",
          query: {
            project_id: 2001,
            task_id: 9001,
            parent_level: 3,
            child_level: 2,
          },
        },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering schedule-task tools")
  registry.registerTools(tools)
}
