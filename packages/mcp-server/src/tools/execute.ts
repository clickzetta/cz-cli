/**
 * Execute tools — port of cz-mcp-server/cz_mcp/tools/execute_tools.py
 *
 * Python → TS mapping:
 *   execute_tools.py:28-210   handle_execute_task          → handleExecuteTask()
 *   execute_tools.py:213-297  handle_get_task_instance_detail → handleGetTaskInstanceDetail()
 *   execute_tools.py:300-493  execute_tool() + Tool defs   → registerExecuteTools()
 *
 * Polling logic (execute_server.py:165-292):
 *   execute_server.py:165-292 poll_task_status             → pollTaskStatus() (inlined)
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import {
  apiAdhocExecute,
  apiGetTaskInstanceDetail,
  apiGetTaskDetail,
  getBaseUrl,
} from "./studio-api.js"

// ---------------------------------------------------------------------------
// Integration FileType constants — execute_tools.py:88-95
// The API returns fileType (FileType enum values), which must be compared here.
// FileType values: DataIntegration=1, RealTimeDI=14, FullIncrementalSync=280,
//                  MultipleRISync=281, MultipleDISync=291
// Python converts fileType→taskType before comparing; we compare fileType directly.
// ---------------------------------------------------------------------------
const INTEGRATION_FILE_TYPES = new Set([1, 14, 280, 281, 291])

// ---------------------------------------------------------------------------
// Status mapping — execute_server.py:198-207
// ---------------------------------------------------------------------------
const STATUS_NAMES: Record<number, string> = {
  1: "SUCCESS",
  2: "NOT_STARTED",
  3: "FAILED",
  4: "RUNNING",
  5: "WAITING_FOR_RESOURCES",
  6: "WAITING_FOR_UPSTREAM",
  7: "PAUSED",
  8: "UPSTREAM_FAILED_BLOCKING",
}

// Terminal statuses — execute_server.py:197
const TERMINAL_STATUSES = new Set([1, 3, 8])

// ---------------------------------------------------------------------------
// Status mapping for get_task_instance_detail — execute_tools.py:256-263
// ---------------------------------------------------------------------------
const DETAIL_STATUS_NAMES: Record<number, string> = {
  1: "WAITING",
  2: "RUNNING",
  3: "SUCCESS",
  4: "FAILED",
  5: "KILLED",
  6: "TIMEOUT",
}

// ---------------------------------------------------------------------------
// buildOpsStudioUrl — redirect_url_utils.py:57-88 _build_ops_studio_url
// ---------------------------------------------------------------------------
const ENV_WEB_URLS: Record<string, string> = {
  dev: "dev-app.clickzetta.com",
  uat: "uat-app.clickzetta.com",
  "cn-shanghai-alicloud": "cn-shanghai-alicloud.app.clickzetta.com",
  "ap-shanghai-tencentcloud": "ap-shanghai-tencentcloud.app.clickzetta.com",
  "ap-beijing-tencentcloud": "ap-beijing-tencentcloud.app.clickzetta.com",
  "ap-guangzhou-tencentcloud": "ap-guangzhou-tencentcloud.app.clickzetta.com",
  "cn-north-1-aws": "cn-north-1-aws.app.clickzetta.com",
  "ap-southeast-1-aws": "ap-southeast-1-aws.app.singdata.com",
  "ap-southeast-1-alicloud": "ap-southeast-1-alicloud.app.singdata.com",
}

function buildOpsStudioUrl(
  config: NonNullable<LakehouseDB["connectionConfig"]>,
  id: number,
  subPageName: string,
): string | null {
  try {
    const baseUrl = ENV_WEB_URLS[config.env]
    const instance = config.instance
    if (!baseUrl || !instance) return null
    return `https://${instance}.${baseUrl}/ops/${subPageName}/${id}`
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// pollTaskStatus — execute_server.py:165-292
// ---------------------------------------------------------------------------
async function pollTaskStatus(
  config: NonNullable<LakehouseDB["connectionConfig"]>,
  taskInstanceId: number,
  maxWaitSeconds: number,
  pollInterval: number,
): Promise<Record<string, unknown>> {
  const startTime = Date.now()
  let pollCount = 0

  logger.info(
    { taskInstanceId, maxWaitSeconds, pollInterval },
    "Starting to poll task status",
  )

  while (true) {
    const elapsed = (Date.now() - startTime) / 1000
    pollCount++

    // execute_server.py:216-225 — timeout check
    if (elapsed > maxWaitSeconds) {
      logger.warn({ elapsed, pollCount }, "Polling timeout")
      return {
        success: false,
        status: "POLLING_TIMEOUT",
        message: `Task polling timeout after ${maxWaitSeconds} seconds`,
        task_instance_id: taskInstanceId,
        elapsed_seconds: elapsed,
        poll_count: pollCount,
      }
    }

    try {
      const responseText = await apiGetTaskInstanceDetail(config, {
        taskInstanceId,
      })
      const responseData = JSON.parse(responseText) as Record<string, unknown>

      // execute_server.py:241-250 — API error
      if (responseData["code"] !== "200") {
        logger.error({ code: responseData["code"] }, "Failed to get task status during poll")
        return {
          success: false,
          status: "API_ERROR",
          message: responseData["message"] ?? "Unknown error",
          task_instance_id: taskInstanceId,
          elapsed_seconds: elapsed,
          poll_count: pollCount,
        }
      }

      const taskData = (responseData["data"] ?? {}) as Record<string, unknown>
      const statusCode = taskData["instanceStatus"] as number | undefined
      const statusName = statusCode != null
        ? (STATUS_NAMES[statusCode] ?? `UNKNOWN(${statusCode})`)
        : "UNKNOWN"

      logger.info(
        { pollCount, elapsed: elapsed.toFixed(1), taskInstanceId, statusName },
        "Poll result",
      )

      // execute_server.py:259-278 — terminal status check
      if (statusCode != null && TERMINAL_STATUSES.has(statusCode)) {
        const isSuccess = statusCode === 1

        const result: Record<string, unknown> = {
          success: isSuccess,
          status: statusName,
          status_code: statusCode,
          task_instance_id: taskInstanceId,
          elapsed_seconds: elapsed,
          poll_count: pollCount,
          task_detail: taskData,
        }

        if (!isSuccess) {
          result["error_message"] = taskData["errorMsg"] ?? "No error message"
        }

        return result
      }

      // execute_server.py:281 — wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000))
    } catch (e) {
      // execute_server.py:283-292 — polling error
      logger.error({ err: e }, "Error during polling")
      const elapsed2 = (Date.now() - startTime) / 1000
      return {
        success: false,
        status: "POLLING_ERROR",
        message: e instanceof Error ? e.message : String(e),
        task_instance_id: taskInstanceId,
        elapsed_seconds: elapsed2,
        poll_count: pollCount,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// handleExecuteTask — execute_tools.py:28-210
// ---------------------------------------------------------------------------
async function handleExecuteTask(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // execute_tools.py:45-58 — required param validation
    const dataTaskId = arguments_["data_task_id"] as number | undefined
    const dataTaskContent = arguments_["data_task_content"] as string | undefined

    if (!dataTaskId) {
      return { success: false, message: "data_task_id is required" }
    }
    if (!dataTaskContent) {
      return { success: false, message: "data_task_content is required" }
    }

    // execute_tools.py:60-66 — optional params with defaults
    const params = (arguments_["params"] as Record<string, string> | undefined) ?? {}
    const collectType = (arguments_["collect_type"] as number | undefined) ?? 1
    const maxRowSize = (arguments_["max_row_size"] as number | undefined) ?? 1000
    const offsetLine = (arguments_["offset_line"] as number | undefined) ?? 0
    const offsetCol = (arguments_["offset_col"] as number | undefined) ?? 0
    const multiDataSource = (arguments_["multi_data_source"] as unknown[] | undefined) ?? []

    // execute_tools.py:68-85 — get task type from task detail
    let taskType: number | null = null
    try {
      const taskDetailResponse = await apiGetTaskDetail(config, dataTaskId)
      const taskDetailData = JSON.parse(taskDetailResponse) as Record<string, unknown>
      if (taskDetailData["code"] === "200") {
        const taskData = (taskDetailData["data"] ?? {}) as Record<string, unknown>
        taskType = taskData["fileType"] as number | null
        logger.info({ taskType, dataTaskId }, "Retrieved task type")
      }
    } catch (e) {
      logger.warn({ err: e, dataTaskId }, "Failed to retrieve task type")
    }

    // execute_tools.py:87-104 — determine adhoc_vc_code based on task type
    let adhocVcCode: string
    if (taskType != null && INTEGRATION_FILE_TYPES.has(taskType)) {
      adhocVcCode = "FLINK_ON_VC"
      logger.info({ dataTaskId, taskType }, "Integration task — setting adhocVcCode=FLINK_ON_VC")
    } else {
      adhocVcCode = (arguments_["adhoc_vc_code"] as string | undefined) ?? config.vcluster
      logger.info({ dataTaskId, taskType, adhocVcCode }, "Non-integration task — using provided adhocVcCode")
    }

    const adhocSchemaName = (arguments_["adhoc_schema_name"] as string | undefined) ?? config.schema
    const adhocVcId = (arguments_["adhoc_vc_id"] as string | undefined) ?? ""

    // execute_tools.py:109-111 — polling parameters
    const maxWaitSeconds = (arguments_["max_wait_seconds"] as number | undefined) ?? 300
    const pollInterval = (arguments_["poll_interval"] as number | undefined) ?? 5

    const updateBy = config.username ?? ""

    logger.info({ dataTaskId }, "Executing task")

    // execute_tools.py:120-141 — Step 1: Submit task for execution
    const response = await apiAdhocExecute(config, {
      dataTaskId,
      dataTaskContent,
      execParams: params,
      updateBy,
      collectType,
      maxRowSize,
      offsetLine,
      offsetCol,
      multiDataSource,
      adhocVcCode,
      adhocSchemaName,
      adhocVcId,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>

    // execute_tools.py:145-152 — check submission response
    if (responseData["code"] !== "200") {
      return {
        success: false,
        message: `Failed to submit task: ${responseData["message"] ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }

    // execute_tools.py:154-163 — extract task instance ID
    const executeResult = responseData["data"] as Record<string, unknown> | undefined
    if (!executeResult) {
      return {
        success: false,
        message: "Task submitted but no task instance ID returned",
        raw_response: responseData,
      }
    }

    logger.info({ executeResult }, "Task submitted successfully")

    // execute_tools.py:170 — extract scheduleInstanceId
    const taskInstanceId = executeResult["scheduleInstanceId"] as number

    // execute_tools.py:172-182 — Step 2: Poll for task completion
    logger.info({ taskInstanceId }, "Starting to poll task status")
    const pollResult = await pollTaskStatus(config, taskInstanceId, maxWaitSeconds, pollInterval)

    // execute_tools.py:184-200 — format response
    const formattedResponse: Record<string, unknown> = {
      success: pollResult["success"],
      message: `Task execution ${pollResult["status"]}`,
      task_instance_id: taskInstanceId,
      execution_status: pollResult["status"],
      status_code: pollResult["status_code"],
      elapsed_seconds: pollResult["elapsed_seconds"],
      poll_count: pollResult["poll_count"],
    }

    if (!pollResult["success"]) {
      formattedResponse["error_message"] = pollResult["error_message"] ?? pollResult["message"]
    }

    if ("task_detail" in pollResult) {
      formattedResponse["task_detail"] = pollResult["task_detail"]
    }

    return formattedResponse
  } catch (e) {
    logger.error({ err: e }, "Error in execute_integration_task")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleGetTaskInstanceDetail — execute_tools.py:213-297
// ---------------------------------------------------------------------------
async function handleGetTaskInstanceDetail(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // execute_tools.py:224-230 — required param validation
    const taskInstanceId = arguments_["task_instance_id"] as number | undefined
    if (!taskInstanceId) {
      return { success: false, message: "task_instance_id is required" }
    }

    const scheduleTaskId = arguments_["schedule_task_id"] as number | undefined

    logger.info({ taskInstanceId }, "Getting task instance detail")

    // execute_tools.py:237-248 — call API
    const response = await apiGetTaskInstanceDetail(config, {
      taskInstanceId,
      projectId: config.projectId,
      scheduleTaskId,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>

    // execute_tools.py:252-280 — success branch
    if (responseData["code"] === "200") {
      const taskData = (responseData["data"] ?? {}) as Record<string, unknown>

      const statusCode = taskData["status"] as number | undefined
      const statusName = statusCode != null
        ? (DETAIL_STATUS_NAMES[statusCode] ?? `UNKNOWN(${statusCode})`)
        : "UNKNOWN"

      const formattedResponse: Record<string, unknown> = {
        success: true,
        message: "Task status retrieved successfully",
        task_instance_id: taskInstanceId,
        status: statusName,
        status_code: statusCode,
        task_detail: taskData,
      }

      // execute_tools.py:276-278 — add redirect URL
      const studioUrl = buildOpsStudioUrl(config, taskInstanceId, "taskInst")
      if (studioUrl) {
        formattedResponse["redirect_url"] = studioUrl
      }

      return formattedResponse
    } else {
      // execute_tools.py:281-288 — error branch
      return {
        success: false,
        message: `Failed to get task status: ${responseData["message"] ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Error in get_task_status")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// registerExecuteTools — execute_tools.py:300-493
// ---------------------------------------------------------------------------
export function registerExecuteTools(registry: ToolRegistry, db: LakehouseDB): void {
  const getConfig = () => {
    if (!db.connectionConfig) throw new Error("No connection configuration available")
    return db.connectionConfig
  }

  const tools: ToolDefinition[] = [
    // execute_tools.py:302-444 — execute_task
    {
      name: "execute_task",
      description:
        "Execute a data task asynchronously in Clickzetta Studio.\n\n" +
        "⚠️ Mandatory VC selection (STRICT, MUST DO FIRST — NO DEFAULT VC): " +
        "Before ANY task retrieval or submission, the tool MUST call `LH-show_object_list`  with `object_type='VCLUSTERS'` to fetch the available Virtual Clusters (VCs) " +
        "for the current workspace/project. " +
        "**IF** the `task_type` is **10 (离线同步), 28 (实时同步), 280 (全增量一体同步), or 281 (多表实时同步)**:" +
          "a. You **MUST** check for available Sync Virtual Clusters by calling `LH-show_object_list` with `object_type='VCLUSTERS'`." +
          "b. Filter the results to find vclusters where `vcluster_type` contains 'SYNC' or similar sync-related indicators." +
          "c. **IF** no Sync Virtual Cluster is found:" +
             " i. **CRITICAL**: You **MUST** stop execution immediately." +
              "ii. **MUST** return a clear error message to the user: **Error: This integration task requires a 'Sync VCluster', but none was found. Please create a Sync VCluster in Clickzetta before retrying.**" +
          "d. **ELSE** (a Sync Virtual Cluster was found):" +
              "i. When calling the `save_task_configuration` function, you **MUST** set the `etl_vc_code` parameter to the name of the found Sync Virtual Cluster." +
        "**ELSE** (the `task_type` is not an integration task):" +
          "a. No check for a Sync Virtual Cluster is needed." +
        "Task content resolution: If `data_task_content` is not provided, the tool retrieves the task definition using `data_task_id`. " +
        "After loading the task content, the tool scans for custom variables in the format `${varName}`. " +
        "If variables are detected, the tool MUST pause execution and request the user to supply values before continuing.\n\n" +
        "Supported task types include:\n" +
        "- Data integration tasks (source-to-sink synchronization)\n" +
        "- Lakehouse SQL tasks\n" +
        "- Other custom task types defined in Clickzetta Studio\n\n" +
        "Execution flow: After (1) calling `list_vcluster` and obtaining an explicit user-selected VC, (2) resolving the task definition, and (3) resolving all required variables, " +
        "the tool submits the task, automatically polls its execution status, waits for completion, and returns the final result.\n\n" +
        "Error handling: If `list_vcluster` fails, returns no VCs, the selected VC is invalid/unavailable, the task definition cannot be retrieved, " +
        "the task fails, or the task times out, the tool returns an appropriate error message.",
      inputSchema: {
        type: "object",
        properties: {
          data_task_id: {
            type: "integer",
            description: "The ID of the data task containing the task definition",
          },
          data_task_content: {
            type: "string",
            description:
              "The task configuration as a JSON string or SQL text. " +
              "For integration tasks: JSON with templateKey, sourceConnection, sinkConnection, and jobs array. " +
              "For Lakehouse SQL tasks: SQL query text or JSON configuration. " +
              "The format depends on the task type defined in the data task.",
          },
          params: {
            type: "object",
            description: 'Parameter key-value pairs for the task execution. Example: {"dt": "$[yyyy-MM-dd]"}',
            additionalProperties: { type: "string" },
          },
          adhoc_vc_code: {
            type: "string",
            description:
              "Virtual cluster code for execution. " +
              "REQUIRED for integration tasks (task_type: 10, 28, 280, 281) - must be a Sync VCluster. " +
              "REQUIRED for Lakehouse tasks. " +
              "Optional for other task types (default: from config).",
          },
          adhoc_schema_name: {
            type: "string",
            description: "Schema name for execution (default: from config)",
          },
          adhoc_vc_id: {
            type: "string",
            description:
              "Virtual cluster ID for execution. " +
              "REQUIRED for integration tasks (task_type: 10, 28, 280, 281) - must be a Sync VCluster ID. " +
              "REQUIRED for Lakehouse tasks. " +
              "Optional for other task types.",
          },
          collect_type: {
            type: "integer",
            description: "Collection type (default: 1)",
          },
          max_row_size: {
            type: "integer",
            description: "Maximum rows to return (default: 1000)",
          },
          offset_line: {
            type: "integer",
            description: "Line offset (default: 0)",
          },
          offset_col: {
            type: "integer",
            description: "Column offset (default: 0)",
          },
          multi_data_source: {
            type: "array",
            description: "Multi data source configuration (default: [])",
            items: { type: "object" },
          },
          max_wait_seconds: {
            type: "integer",
            description: "Maximum seconds to wait for task completion (default: 300)",
          },
          poll_interval: {
            type: "integer",
            description: "Seconds between status polls (default: 5)",
          },
        },
        required: ["data_task_id", "data_task_content", "adhoc_vc_code"],
        additionalProperties: false,
      },
      handler: async (args: Record<string, unknown>) => handleExecuteTask(args, getConfig()),
      tags: ["studio", "execute", "integration", "sql", "async", "api"],
      samples: [
        {
          description: "Execute a data integration task",
          query: {
            data_task_id: 12005907,
            data_task_content:
              '{"templateKey":1,"sourceConnection":{...},"sinkConnection":{...},"jobs":[...]}',
            params: { dt: "$[yyyy-MM-dd]" },
            adhoc_vc_code: "DEFAULT",
            adhoc_vc_id: "vc-id-123",
          },
        },
        {
          description: "Execute a Lakehouse SQL task",
          query: {
            data_task_id: 12005908,
            data_task_content: "SELECT * FROM my_table WHERE dt = '${dt}'",
            params: { dt: "2025-01-10" },
            adhoc_vc_code: "DEFAULT",
            adhoc_schema_name: "public",
          },
        },
        {
          description: "Execute a SQL query with custom timeout",
          query: {
            data_task_id: 12005907,
            data_task_content: "SELECT COUNT(*) FROM orders",
            max_wait_seconds: 600,
            poll_interval: 10,
          },
        },
      ],
    },
    // execute_tools.py:446-492 — get_task_instance_detail
    {
      name: "get_task_instance_detail",
      description:
        "Get the execution status and details of a task instance in Clickzetta Studio. " +
        "This tool retrieves comprehensive information about a task's execution, including status, " +
        "timing information, execution details, and error information if the task failed. " +
        "Use this tool to check the status of a previously submitted task or to get detailed " +
        "execution information for debugging purposes.",
      inputSchema: {
        type: "object",
        properties: {
          task_instance_id: {
            type: "integer",
            description: "The unique identifier of the task instance to query",
          },
          project_id: {
            type: "integer",
            description: "Optional project ID for the task (defaults to config project ID)",
          },
          schedule_task_id: {
            type: "integer",
            description: "Optional schedule task ID (task ID) for the task",
          },
        },
        required: ["task_instance_id"],
        additionalProperties: false,
      },
      handler: async (args: Record<string, unknown>) =>
        handleGetTaskInstanceDetail(args, getConfig()),
      tags: ["studio", "execute", "status", "monitoring", "api"],
      samples: [
        {
          description: "Get status of a task instance",
          query: { task_instance_id: 72085416 },
        },
        {
          description: "Get detailed task status with project and schedule info",
          query: {
            task_instance_id: 72085416,
            project_id: 97001,
            schedule_task_id: 12004918,
          },
        },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering execute tools")
  registry.registerTools(tools)
}
