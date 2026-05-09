/**
 * Backfill tools — port of cz-mcp-server/cz_mcp/tools/backfill_task_tools.py
 *
 * Python → TS mapping:
 *   backfill_task_tools.py:23-108  handle_list_backfill_tasks      → handleListBackfillTasks()
 *   backfill_task_tools.py:111-191 list_backfill_tasks_tools()     → (tool definition in registerBackfillTools)
 *   backfill_task_tools.py:194-259 handle_get_backfill_task_detail → handleGetBackfillTaskDetail()
 *   backfill_task_tools.py:262-293 get_backfill_task_detail_tools() → (tool definition in registerBackfillTools)
 *   backfill_task_tools.py:296-370 handle_list_backfill_instances  → handleListBackfillInstances()
 *   backfill_task_tools.py:373-443 list_backfill_instances_tools() → (tool definition in registerBackfillTools)
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import { getBaseUrl, studioPost, buildHeaders, apiCreateComplementJob, apiGetAllDownstream, apiCheckVclusterCreatePermission } from "./studio-api.js"

// ---------------------------------------------------------------------------
// API path constants — api_properties.ini:68-81
// ---------------------------------------------------------------------------
const COMPLEMENT_LIST = "/ide-admin/v1/complementTask/list"
const COMPLEMENT_GET_DETAIL = "/ide-admin/v1/complementTask/getDetail"
const COMPLEMENT_PAGELIST = "/ide-admin/v1/complementTask/pageList"

// ---------------------------------------------------------------------------
// API helpers — ide_admin_server.py:747-861
// ---------------------------------------------------------------------------

/** ide_admin_server.py:747-789 list_backfill_tasks */
async function apiListBackfillTasks(
  config: NonNullable<LakehouseDB["connectionConfig"]>,
  params: {
    projectId: string
    taskNameLike?: string
    runStatus?: number
    submitter?: string
    queryPlanTimeLeft?: number
    queryPlanTimeRight?: number
    pageIndex: number
    pageSize: number
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + COMPLEMENT_LIST
  const headers = buildHeaders(config)
  const body: Record<string, unknown> = {
    taskNameLike: params.taskNameLike ?? "",
    projectId: params.projectId,
    pageIndex: params.pageIndex,
    pageSize: params.pageSize,
  }
  // ide_admin_server.py:776-784
  if (params.runStatus != null) body["runStatus"] = params.runStatus
  if (params.submitter != null) body["complementUserName"] = params.submitter
  if (params.queryPlanTimeLeft != null && params.queryPlanTimeRight != null) {
    body["bizStartDate"] = params.queryPlanTimeLeft
    body["bizEndDate"] = params.queryPlanTimeRight
  }
  return studioPost(url, headers, body)
}

/** ide_admin_server.py:792-821 get_backfill_task_detail */
async function apiGetBackfillTaskDetail(
  config: NonNullable<LakehouseDB["connectionConfig"]>,
  backFillTaskId: number,
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + COMPLEMENT_GET_DETAIL
  const headers = buildHeaders(config)
  return studioPost(url, headers, { complementTaskId: backFillTaskId })
}

/** ide_admin_server.py:824-861 list_backfill_instances */
async function apiListBackfillInstances(
  config: NonNullable<LakehouseDB["connectionConfig"]>,
  params: {
    backFillTaskId: number
    taskNameLike?: string
    instanceStatusList?: number[]
    pageIndex: number
    pageSize: number
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + COMPLEMENT_PAGELIST
  const headers = buildHeaders(config)
  const body: Record<string, unknown> = {
    pageSize: params.pageSize,
    pageIndex: params.pageIndex,
    complementTaskId: params.backFillTaskId,
    orderByFields: "plan_trigger_time",
    orderBy: "desc",
  }
  // ide_admin_server.py:854-857
  if (params.instanceStatusList != null) body["instanceStatusList"] = params.instanceStatusList
  if (params.taskNameLike != null) body["taskName"] = params.taskNameLike
  return studioPost(url, headers, body)
}

// ---------------------------------------------------------------------------
// handleListBackfillTasks — backfill_task_tools.py:23-108
// ---------------------------------------------------------------------------
async function handleListBackfillTasks(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // backfill_task_tools.py:33-46
    const taskNameLike = (arguments_["task_name_like"] as string | undefined) ?? ""
    const pageIndex = (arguments_["page_index"] as number | undefined) ?? 1
    const pageSize = (arguments_["page_size"] as number | undefined) ?? 20
    const runStatus = arguments_["run_status"] as number | undefined
    const submitter = arguments_["submitter"] as string | undefined
    const queryPlanTimeLeft = arguments_["query_plan_time_left"] as number | undefined
    const queryPlanTimeRight = arguments_["query_plan_time_right"] as number | undefined

    // backfill_task_tools.py:46-49
    const projectId = (arguments_["project_id"] as string | undefined) ?? config.projectId

    logger.info({ projectId }, "Listing backfill task")

    // backfill_task_tools.py:53-70
    const response = await apiListBackfillTasks(config, {
      projectId: String(projectId),
      taskNameLike,
      runStatus,
      submitter,
      queryPlanTimeLeft,
      queryPlanTimeRight,
      pageIndex,
      pageSize,
    })

    // backfill_task_tools.py:72-73
    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      // backfill_task_tools.py:75-90
      const resPageIndex = (responseData["pageIndex"] as number | undefined) ?? pageIndex
      const tasks = responseData["data"] ?? []
      const count = responseData["count"]

      return {
        success: true,
        message: "Successfully list backfill tasks",
        backfill_task_list: tasks,
        total_count: count,
        page_index: resPageIndex,
        page_size: pageSize,
      }
    } else {
      // backfill_task_tools.py:92-99
      return {
        success: false,
        message: `[handle_list_backfill_task]API request failed: ${(responseData["msg"] as string | undefined) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    // backfill_task_tools.py:101-108
    logger.error({ err: e }, "Error in list backfill tasks")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleGetBackfillTaskDetail — backfill_task_tools.py:194-259
// ---------------------------------------------------------------------------
async function handleGetBackfillTaskDetail(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // backfill_task_tools.py:204-205
    const backfillTaskId = arguments_["backfill_task_id"] as number

    logger.info({ backfillTaskId }, "Getting backfill task detail")

    // backfill_task_tools.py:213-223
    const response = await apiGetBackfillTaskDetail(config, backfillTaskId)

    // backfill_task_tools.py:225-226
    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      // backfill_task_tools.py:227-241
      const data = responseData["data"] ?? {}

      const formattedResponse: Record<string, unknown> = {
        success: true,
        message: "Successfully get backfill task detail",
        data,
      }

      return formattedResponse
    } else {
      // backfill_task_tools.py:243-250
      return {
        success: false,
        message: `[handle_get_backfill_task_detail]API request failed: ${(responseData["msg"] as string | undefined) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    // backfill_task_tools.py:252-259
    logger.error({ err: e }, "Error in get backfill task detail")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleListBackfillInstances — backfill_task_tools.py:296-370
// ---------------------------------------------------------------------------
async function handleListBackfillInstances(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // backfill_task_tools.py:306-311
    const backfillTaskId = arguments_["backfill_task_id"] as number
    const taskNameRLike = arguments_["task_name_r_like"] as string | undefined
    const instanceStatusList = arguments_["instance_status_list"] as number[] | undefined
    const pageIndex = arguments_["page_index"] as number
    const pageSize = arguments_["page_size"] as number

    logger.info({ backfillTaskId }, "Getting instance list of backfill task")

    // backfill_task_tools.py:319-333
    const response = await apiListBackfillInstances(config, {
      backFillTaskId: backfillTaskId,
      taskNameLike: taskNameRLike,
      instanceStatusList,
      pageIndex,
      pageSize,
    })

    // backfill_task_tools.py:335-336
    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      // backfill_task_tools.py:337-352
      const resPageIndex = (responseData["pageIndex"] as number | undefined) ?? pageIndex
      const tasks = responseData["data"] ?? []
      const count = responseData["count"]

      return {
        success: true,
        message: "Successfully list backfill instances",
        instance_list: tasks,
        total_count: count,
        page_index: resPageIndex,
        page_size: pageSize,
      }
    } else {
      // backfill_task_tools.py:354-361
      return {
        success: false,
        message: `[handle_list_backfill_instances]API request failed: ${(responseData["msg"] as string | undefined) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    // backfill_task_tools.py:363-370
    logger.error({ err: e }, "Error in list backfill instances")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleCreateBackfillJob — backfill_task_tools.py:477-600
// ---------------------------------------------------------------------------
async function handleCreateBackfillJob(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const scheduleTaskId = arguments_["schedule_task_id"] as number
    const bizStartTime = arguments_["biz_start_time"] as number
    const bizEndTime = arguments_["biz_end_time"] as number
    const sqlVcCode = (arguments_["sql_vc_code"] as string | undefined) ?? "DEFAULT"
    const includeRoot = (arguments_["include_root"] as number | undefined) ?? 1
    const isConcurrence = (arguments_["is_concurrence"] as number | undefined) ?? 0
    const concurrenceNumber = (arguments_["concurrence_number"] as number | undefined) ?? 1
    const selfDep = (arguments_["self_dep"] as number | undefined) ?? 0
    const complementType = (arguments_["complement_type"] as number | undefined) ?? 1
    const nextType = (arguments_["next_type"] as number | undefined) ?? 0
    const checkPermission = arguments_["check_permission"] !== false
    const checkDownstream = arguments_["check_downstream"] !== false

    const suffix = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)
    const complementJobName = (arguments_["complement_job_name"] as string | undefined) ?? `S_${scheduleTaskId}_${suffix}`

    let downstreamTasks: unknown[] = []
    if (checkDownstream) {
      const downResp = await apiGetAllDownstream(config, { scheduleTaskId })
      const downData = JSON.parse(downResp) as Record<string, unknown>
      if (String(downData["code"]) !== "200") {
        return { success: false, message: `get_all_downstream failed: ${downData["message"] ?? "Unknown error"}`, code: downData["code"] }
      }
      const raw = downData["data"]
      if (Array.isArray(raw)) downstreamTasks = raw
    }

    if (checkPermission) {
      const permResp = await apiCheckVclusterCreatePermission(config)
      const permData = JSON.parse(permResp) as Record<string, unknown>
      if (!["200", "0"].includes(String(permData["code"]))) {
        return { success: false, message: `check_permission failed: ${permData["message"] ?? "Unknown error"}`, code: permData["code"] }
      }
      if (permData["data"] === false) {
        return { success: false, message: "Permission denied: no CREATE permission on VCLUSTER." }
      }
    }

    const payload = {
      includeRoot,
      sqlVcCode,
      complementJobName,
      isConcurrence,
      complementType,
      concurrenceNumber,
      selfDep,
      dateList: [{ bizStartDate: bizStartTime, bizEndDate: bizEndTime }],
      nextType,
      complementBizDateBeanList: [{ bizStartDate: bizStartTime, bizEndDate: bizEndTime }],
      scheduleTaskId,
      userId: config.userId,
      createBy: config.username ?? "",
      projectId: config.projectId,
      workspace: config.workspace,
    }

    const response = await apiCreateComplementJob(config, payload)
    const responseData = JSON.parse(response) as Record<string, unknown>

    if (String(responseData["code"]) === "200") {
      return {
        success: true,
        message: "Successfully create backfill task",
        backfill_task_id: responseData["data"],
        schedule_task_id: scheduleTaskId,
        complement_job_name: complementJobName,
        downstream_count: downstreamTasks.length,
      }
    }
    return { success: false, message: `API request failed: ${responseData["message"] ?? "Unknown error"}`, code: responseData["code"], raw_response: responseData }
  } catch (e) {
    logger.error({ err: e }, "Error in create backfill task")
    return { success: false, message: `Internal error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// registerBackfillTools — combines get_backfill_task_detail_tools(),
//   list_backfill_tasks_tools(), list_backfill_instances_tools()
// ---------------------------------------------------------------------------
export function registerBackfillTools(registry: ToolRegistry, db: LakehouseDB): void {
  const getConfig = () => {
    if (!db.connectionConfig) throw new Error("No connection configuration available")
    return db.connectionConfig
  }

  const tools: ToolDefinition[] = [
    // backfill_task_tools.py:111-191 — list_backfill_tasks
    {
      name: "list_backfill_tasks",
      description:
        "List backfill (complement) tasks in Clickzetta Studio. " +
        "Note: 'complement' is used as a synonym for 'backfill' in this product. " +
        "This tool returns one page of results per call. When the user requests the full list, " +
        "the assistant MUST repeatedly call this tool (incrementing page_index each time) until " +
        "an empty page or a page smaller than page_size is returned.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "integer",
            description: "Project ID.",
          },
          page_index: {
            type: "integer",
            description: "Page index (1-based).",
            default: 1,
          },
          page_size: {
            type: "integer",
            description: "Page size (default 50).",
            default: 50,
          },
          task_name_r_like: {
            type: "string",
            description: "Fuzzy search string for task name (optional).",
          },
          run_status: {
            type: "integer",
            description:
              "Backfill run status. Optional values: 1 = running, 4 = finished. If omitted, returns all statuses.",
            enum: [1, 4],
          },
          submitter: {
            type: "string",
            description: "Submitter of the backfill task (optional).",
          },
          query_plan_time_left: {
            type: "integer",
            description:
              "Left bound (inclusive) of planned execution time, in milliseconds timestamp (optional).",
          },
          query_plan_time_right: {
            type: "integer",
            description:
              "Right bound (inclusive) of planned execution time, in milliseconds timestamp. Should be paired with query_plan_time_left (optional).",
          },
        },
        additionalProperties: false,
        required: ["project_id", "page_index", "page_size"],
      },
      handler: async (args: Record<string, unknown>) => handleListBackfillTasks(args, getConfig()),
      tags: ["backfill", "complement", "tasks", "pagination"],
      samples: [
        {
          description: "List first page of backfill tasks in project 2001 with default page size.",
          query: { project_id: 2001, page_index: 1, page_size: 50 },
        },
        {
          description:
            "Search backfill tasks in running status, with name like 'daily_etl', submitted by 'alice', within a plan time window.",
          query: {
            project_id: 2001,
            page_index: 1,
            page_size: 50,
            task_name_r_like: "daily_etl",
            submitter: "alice",
            query_plan_time_left: 1764691200000,
            query_plan_time_right: 1767110400000,
            run_status: 1,
          },
        },
      ],
    },
    // backfill_task_tools.py:262-293 — get_backfill_task_detail
    {
      name: "get_backfill_task_detail",
      description:
        "Get details of a backfill (complement) task in Clickzetta Studio. " +
        "This tool retrieves the full metadata and configuration for the specified backfill task.",
      inputSchema: {
        type: "object",
        properties: {
          backfill_task_id: {
            type: "integer",
            description: "Unique ID of the backfill (complement) task.",
          },
        },
        additionalProperties: false,
        required: ["backfill_task_id"],
      },
      handler: async (args: Record<string, unknown>) =>
        handleGetBackfillTaskDetail(args, getConfig()),
      tags: ["backfill", "complement", "task_detail"],
      samples: [
        {
          description: "Get configuration detail of backfill task 90001.",
          query: { backfill_task_id: 90001 },
        },
      ],
    },
    // backfill_task_tools.py:373-443 — list_backfill_instances
    {
      name: "list_backfill_instances",
      description:
        "List the instances associated with a specific backfill (complement) task in Clickzetta Studio. " +
        "Supports pagination and optional fuzzy search on task names, instance status list within the backfill task. " +
        "This tool returns one page of results per call. When the user requests the full list, " +
        "the assistant MUST repeatedly call this tool (incrementing page_index each time) until " +
        "an empty page or a page smaller than page_size is returned.",
      inputSchema: {
        type: "object",
        properties: {
          backfill_task_id: {
            type: "integer",
            description: "ID of the backfill (complement) task.",
          },
          page_index: {
            type: "integer",
            description: "Pagination start index (1-based).",
          },
          page_size: {
            type: "integer",
            description: "Page size, default is 50.",
          },
          task_name_r_like: {
            type: "string",
            description:
              "Optional fuzzy search string for task names under the backfill task. " +
              "If empty, all tasks are returned.",
            default: "",
          },
          instance_status_list: {
            type: "array",
            items: { type: "integer" },
            description:
              "List of instance status values (optional). Supported values: " +
              "1=Success, 2=Not started, 3=Failed, 4=Running, " +
              "5=Waiting for resources, 6=Waiting for upstream, " +
              "7=Paused, 8=Upstream failed blocking.",
          },
        },
        additionalProperties: false,
        required: ["backfill_task_id", "page_index", "page_size"],
      },
      handler: async (args: Record<string, unknown>) =>
        handleListBackfillInstances(args, getConfig()),
      tags: ["backfill", "complement", "instances", "pagination"],
      samples: [
        {
          description: "List instances of backfill task 90001, first page with default size.",
          query: { backfill_task_id: 90001, page_index: 1, page_size: 50 },
        },
        {
          description: "List backfill instances with fuzzy task name search 'ods_user'.",
          query: {
            backfill_task_id: 90001,
            page_index: 1,
            page_size: 50,
            task_name_r_like: "ods_user",
          },
        },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering backfill tools")
  registry.registerTools(tools)

  // create_backfill_job — backfill_task_tools.py:600-680
  registry.registerTools([{
    name: "create_backfill_job",
    description:
      "Create a backfill (complement) job for a periodic schedule task. " +
      "Optionally checks downstream relationships and VCLUSTER CREATE permission before submitting.",
    inputSchema: {
      type: "object",
      properties: {
        schedule_task_id: { type: "integer", description: "Schedule task ID for creating backfill job." },
        biz_start_time: { type: "integer", description: "Business start time in milliseconds timestamp." },
        biz_end_time: { type: "integer", description: "Business end time in milliseconds timestamp." },
        sql_vc_code: { type: "string", description: "VC code for executing complement tasks (default: DEFAULT)." },
        complement_job_name: { type: "string", description: "Optional complement job name. Auto-generated when omitted." },
        include_root: { type: "integer", description: "Include root task: 1=yes, 0=no (default: 1)." },
        is_concurrence: { type: "integer", description: "Run in parallel: 1=yes, 0=no (default: 0)." },
        concurrence_number: { type: "integer", description: "Parallel number (default: 1)." },
        self_dep: { type: "integer", description: "Self dependency flag (default: 0)." },
        complement_type: { type: "integer", description: "Complement type (default: 1)." },
        next_type: { type: "integer", description: "Next type (default: 0)." },
        check_permission: { type: "boolean", description: "Check VCLUSTER CREATE permission (default: true)." },
        check_downstream: { type: "boolean", description: "Query downstream relation (default: true)." },
      },
      additionalProperties: false,
      required: ["schedule_task_id", "biz_start_time", "biz_end_time"],
    },
    handler: async (args: Record<string, unknown>) => handleCreateBackfillJob(args, getConfig()),
    tags: ["backfill", "complement", "create"],
    samples: [{ description: "Create backfill job", query: { schedule_task_id: 12345, biz_start_time: 1700000000000, biz_end_time: 1700086400000 } }],
  }])
}
