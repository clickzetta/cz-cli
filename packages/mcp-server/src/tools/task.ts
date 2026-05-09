/**
 * Task tools — port of cz-mcp-server/cz_mcp/tools/file_tools.py
 *
 * Python → TS mapping:
 *   file_tools.py:423-513  handle_create_task          → handleCreateTask()
 *   file_tools.py:516-570  create_task_tool()          → (tool definition in registerTaskTools)
 *   file_tools.py:573-644  handle_task_detail          → handleGetTaskDetail()
 *   file_tools.py:647-687  get_task_detail_tool()      → (tool definition)
 *   file_tools.py:690-782  _save_task_content_base     → savTaskContentBase()
 *   file_tools.py:785-882  save_non_integration_task_content → (tool definition)
 *   file_tools.py:274-362  save_configuration          → handleSaveTaskConfiguration()
 *   file_tools.py:395-418  submit_task                 → handlePublishTask()
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import {
  apiCreateTask,
  apiGetTaskDetail,
  apiSaveContent,
  apiSaveConfiguration,
  apiGetConfigurationDetail,
  apiSubmitTask,
  apiListFiles,
  apiDeleteFile,
  apiGetCurrentUser,
} from "./studio-api.js"

// ---------------------------------------------------------------------------
// TaskType / FileType mapping — file_tools.py:375-420
// Mirrors TASK_FILE_TYPE_MAPPING from common/task_type.py
// TaskType → FileType (they are NOT 1:1 for most types)
// ---------------------------------------------------------------------------
const TASK_TYPE_TO_FILE_TYPE: Record<number, number> = {
  0: 0,     // Virtual
  10: 1,    // DataIntegration
  23: 4,    // LakeHouse SQL
  24: 5,    // Shell
  26: 7,    // Python3
  28: 14,   // RealTimeDI
  29: 15,   // JDBC
  30: 16,   // DynamicTable
  31: 17,   // ContinuousJob
  280: 280, // FullIncrementalSync
  281: 281, // MultipleRISync
  291: 291, // MultipleDISync
  300: 300, // DatabrickSql
  301: 301, // DatabrickNotebook
  400: 400, // Spark
  500: 500, // Flow
}

function convertTaskTypeToFileType(taskType: number): number {
  const fileType = TASK_TYPE_TO_FILE_TYPE[taskType]
  if (fileType == null) {
    throw new Error(`Invalid task_type ${taskType}: no corresponding FileType mapping`)
  }
  return fileType
}

// Reverse mapping: FileType → TaskType
const FILE_TYPE_TO_TASK_TYPE: Record<number, number> = Object.fromEntries(
  Object.entries(TASK_TYPE_TO_FILE_TYPE).map(([k, v]) => [v, Number(k)]),
)

function convertFileTypeToTaskType(fileType: number): number {
  const taskType = FILE_TYPE_TO_TASK_TYPE[fileType]
  if (taskType == null) {
    throw new Error(`Invalid fileType ${fileType}: no corresponding TaskType mapping`)
  }
  return taskType
}

// ---------------------------------------------------------------------------
// Field conversion helpers — file_tools.py:120-240
// ---------------------------------------------------------------------------
function convertTaskDetailFields(apiData: Record<string, unknown>): Record<string, unknown> {
  if (!apiData) return {}
  const fieldMapping: Record<string, string> = {
    id: "task_id",
    tenantId: "tenant_id",
    userId: "user_id",
    projectId: "project_id",
    location: "location",
    dataFolderId: "folder_id",
    dataFileName: "task_name",
    ownerCnName: "owner_cn_name",
    ownerEnName: "owner_en_name",
    lastEditTime: "last_edit_time",
    lastEditUser: "last_edit_user",
    createdBy: "created_by",
    createdTime: "created_time",
    updatedBy: "updated_by",
    updatedTime: "updated_time",
    lockTime: "lock_time",
    fileFlowStatus: "task_edit_state",
    showFileStatusName: "show_file_status_name",
    lockUserName: "lock_user_name",
    hasConfig: "has_config",
    currentVersion: "current_version",
    fileContent: "task_content",
    fileDescription: "task_description",
    paramValueList: "param_value_list",
    executeParam: "execute_param",
    workspaceId: "workspace_id",
    defaultSchemaName: "default_schema_name",
    defaultVcName: "default_vc_name",
    datasourceId: "datasource_id",
    dsType: "ds_type",
    sessionSchemaName: "session_schema_name",
    cdcTaskId: "cdc_task_id",
    groupId: "group_id",
    instanceName: "instance_name",
    multiDataSource: "multi_data_source",
    nodeId: "node_id",
    adhocConfigs: "adhoc_configs",
    fileCreateType: "file_create_type",
    fileStatus: "file_status",
    deployStatus: "deploy_status",
    isLock: "is_lock",
  }

  const converted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(apiData)) {
    if (key in fieldMapping) {
      converted[fieldMapping[key]!] = value
    } else if (key === "fileType") {
      try {
        converted["task_type"] = convertFileTypeToTaskType(value as number)
      } catch {
        logger.warn({ fileType: value }, "Failed to convert fileType to task_type, skipping")
      }
    }
  }
  return converted
}

// ---------------------------------------------------------------------------
// handleCreateTask — file_tools.py:423-513
// ---------------------------------------------------------------------------
async function handleCreateTask(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const taskType = arguments_["task_type"] as number
    let fileType: number
    try {
      fileType = convertTaskTypeToFileType(taskType)
    } catch (e) {
      return {
        success: false,
        message: `Invalid task_type ${taskType}: ${e instanceof Error ? e.message : String(e)}`,
        error_type: "InvalidTaskType",
      }
    }

    const taskName = arguments_["task_name"] as string
    const taskDescription = (arguments_["task_description"] as string | undefined) ?? ""
    const dataFolderId = arguments_["data_folder_id"] as number
    const projectId = config.projectId
    const createdBy = config.username ?? ""

    logger.info(
      { projectId, taskType, fileType },
      "Creating task",
    )

    const response = await apiCreateTask(config, {
      projectId,
      fileType,
      createdBy,
      dataFileName: taskName,
      fileDescription: taskDescription,
      dataFolderId,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      const taskId = responseData["data"]
      return {
        success: true,
        message: "Successfully create task",
        task_id: taskId,
      }
    } else {
      return {
        success: false,
        message: `[handle_create_task]API request failed: ${responseData["message"] ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Error in create task")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleGetTaskDetail — file_tools.py:573-644
// ---------------------------------------------------------------------------
async function handleGetTaskDetail(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const taskId = arguments_["task_id"] as number

    const response = await apiGetTaskDetail(config, taskId)
    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      const data = responseData["data"] as Record<string, unknown>
      const convertedData = convertTaskDetailFields(data)
      return {
        success: true,
        message: "Successfully get task detail",
        task_detail: convertedData,
      }
    } else {
      return {
        success: false,
        message: `[handle_task_detail]API request failed: ${responseData["message"] ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Error in get task detail")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// saveTaskContentBase — file_tools.py:690-782
// ---------------------------------------------------------------------------
async function saveTaskContentBase(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
  adhocConfigs?: string,
): Promise<Record<string, unknown>> {
  try {
    // file_tools.py:708-709 — support both naming conventions
    const taskId =
      (arguments_["task_id"] as number | undefined) ??
      (arguments_["data_task_id"] as number | undefined)
    const taskContent =
      (arguments_["task_content"] as string | undefined) ??
      (arguments_["data_task_content"] as string | undefined)
    const paramValueList = arguments_["param_value_list"] as unknown[] | undefined

    const projectId = config.projectId
    const updateBy = config.username ?? ""

    // file_tools.py:720-729 — fill param defaults
    const processedParams = (paramValueList ?? []).map((p) => {
      const param = p as Record<string, unknown>
      return {
        encrypt: false,
        ignore: false,
        ref: 0,
        paramType: "manual",
        id: "1761124251997",
        ...param,
      }
    })

    logger.info({ taskId }, "Saving content to task")

    const response = await apiSaveContent(config, {
      projectId,
      dataFileId: taskId!,
      content: taskContent ?? "",
      paramValueList: processedParams,
      updateBy,
      adhocConfigs,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      return {
        success: true,
        message: "Successfully saved task content",
        save_result: responseData["data"],
      }
    } else {
      return {
        success: false,
        message: `[_save_task_content_base]API request failed: ${responseData["message"] ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Error in saving task content")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleSaveTaskConfiguration — ide_admin_server.py:274-362
// ---------------------------------------------------------------------------
async function handleSaveTaskConfiguration(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const taskId = arguments_["task_id"] as number
    const projectId = config.projectId

    const response = await apiSaveConfiguration(config, {
      projectId,
      dataFileId: taskId,
      cronExpress: arguments_["cron_express"] as string | undefined,
      userId: String(config.userId),
      userName: config.username ?? "",
      activeStartTime: arguments_["active_start_time"] as string | undefined,
      activeEndTime: arguments_["active_end_time"] as string | undefined,
      retryIntervalTime: arguments_["retry_interval_time"] as number | undefined,
      retryIntervalTimeUnits: arguments_["retry_interval_time_unit"] as string | undefined,
      retryCount: arguments_["retry_count"] as number | undefined,
      rerunProperty: arguments_["rerun_property"] as number | undefined,
      executeTimeout: arguments_["execute_timeout"] as number | undefined,
      executeTimeoutUnit: arguments_["execute_timeout_unit"] as string | undefined,
      selfDependsJob: arguments_["self_depends_job"] as number | undefined,
      dataFileInputListReqs: arguments_["task_dependencies"] as unknown[] | undefined,
      configProperties: arguments_["config_properties"] as string | undefined,
      schemaName: arguments_["schema_name"] as string | undefined,
      etlVcCode: arguments_["etl_vc_code"] as string | undefined,
      etlVcId: arguments_["etl_vc_id"] as string | undefined,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      return {
        success: true,
        message: "Successfully saved task configuration",
        save_result: responseData["data"],
      }
    } else {
      return {
        success: false,
        message: `[handle_save_task_configuration]API request failed: ${responseData["message"] ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Error in save task configuration")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleGetTaskConfigurationDetail — ide_admin_server.py:365-392
// ---------------------------------------------------------------------------
async function handleGetTaskConfigurationDetail(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const taskId = arguments_["task_id"] as number
    const projectId = config.projectId

    const response = await apiGetConfigurationDetail(config, {
      projectId,
      workspaceId: config.workspaceId,
      dataFileId: taskId,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      return {
        success: true,
        message: "Successfully get task configuration detail",
        configuration: responseData["data"],
      }
    } else {
      return {
        success: false,
        message: `[handle_get_task_configuration_detail]API request failed: ${responseData["message"] ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Error in get task configuration detail")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handlePublishTask — ide_admin_server.py:395-418
// ---------------------------------------------------------------------------
async function handlePublishTask(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const taskId = arguments_["task_id"] as number
    const dataFileVersion = (arguments_["data_file_version"] as string | undefined) ?? ""
    const projectId = config.projectId

    const response = await apiSubmitTask(config, {
      projectId,
      dataFileId: taskId,
      dataFileVersion,
      username: config.username ?? "",
    })

    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      return {
        success: true,
        message: "Successfully published task",
        publish_result: responseData["data"],
      }
    } else {
      return {
        success: false,
        message: `[handle_publish_task]API request failed: ${responseData["message"] ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Error in publish task")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// helper: resolve username with getCurrentUser fallback — login_server.py
// ---------------------------------------------------------------------------
async function resolveUsername(config: NonNullable<LakehouseDB["connectionConfig"]>): Promise<string> {
  if (config.username) return config.username
  try {
    const resp = await apiGetCurrentUser(config)
    const data = JSON.parse(resp) as Record<string, unknown>
    if (data["code"] === "200") {
      const user = data["data"] as Record<string, unknown> | undefined
      return (user?.["name"] as string) ?? ""
    }
  } catch { /* ignore */ }
  return ""
}

// ---------------------------------------------------------------------------
// handleSaveIntegrationTask — file_tools.py:885-1400
// ---------------------------------------------------------------------------
async function handleSaveIntegrationTask(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const taskId = arguments_["task_id"] as number | undefined
    if (!taskId) return { success: false, message: "task_id is required" }

    const sourceDatasourceName = arguments_["source_datasource_name"] as string | undefined
    const sourceSchema = arguments_["source_schema"] as string | undefined
    const sourceTable = arguments_["source_table"] as string | undefined
    const sourceDsType = arguments_["source_ds_type"] as number | undefined
    const sinkDatasourceName = arguments_["sink_datasource_name"] as string | undefined
    const sinkSchema = (arguments_["sink_schema"] as string | undefined) ?? "public"
    const sinkTable = (arguments_["sink_table"] as string | undefined) ?? sourceTable
    const sinkDsType = arguments_["sink_ds_type"] as number | undefined

    if (!sourceDatasourceName || !sourceSchema || !sourceTable || sourceDsType == null) {
      return { success: false, message: "source_datasource_name, source_schema, source_table, and source_ds_type are required" }
    }
    if (!sinkDatasourceName || sinkDsType == null) {
      return { success: false, message: "sink_datasource_name and sink_ds_type are required" }
    }

    // NOTE: The full integration workflow (datasource lookup, table existence check,
    // sink table creation, integration config generation) requires datasource_utils
    // which depends on multiple API calls. This is a placeholder that saves the
    // integration parameters as content. The full workflow should be implemented
    // when datasource_utils are ported.
    const updateBy = await resolveUsername(config)
    const integrationConfig = {
      source: { datasource_name: sourceDatasourceName, schema: sourceSchema, table: sourceTable, ds_type: sourceDsType },
      sink: { datasource_name: sinkDatasourceName, schema: sinkSchema, table: sinkTable, ds_type: sinkDsType },
    }

    const response = await apiSaveContent(config, {
      projectId: config.projectId,
      dataFileId: taskId,
      content: JSON.stringify(integrationConfig),
      paramValueList: (arguments_["param_value_list"] as unknown[]) ?? [],
      updateBy,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>
    if (responseData["code"] === "200") {
      return {
        success: true,
        message: "Successfully saved data integration task configuration",
        task_id: taskId,
        source: { datasource: sourceDatasourceName, table: `${sourceSchema}.${sourceTable}` },
        sink: { datasource: sinkDatasourceName, table: `${sinkSchema}.${sinkTable}` },
        integration_config: responseData["data"],
      }
    }
    return {
      success: false,
      message: `API error: ${responseData["message"] ?? "Unknown error"}`,
      code: responseData["code"],
      raw_response: responseData,
    }
  } catch (e) {
    logger.error({ err: e }, "Error in save_integration_task")
    return { success: false, message: `Internal error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// handleSaveTaskCronConfiguration — file_tools.py:1590-1730
// ---------------------------------------------------------------------------
async function handleSaveTaskCronConfiguration(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const taskId = arguments_["task_id"] as number | undefined
    if (!taskId) return { success: false, message: "task_id is required" }

    const userName = await resolveUsername(config)

    // Fetch existing configuration to merge defaults
    const oldConfigResp = await apiGetConfigurationDetail(config, {
      projectId: config.projectId,
      workspaceId: config.workspaceId,
      dataFileId: taskId,
    })
    const oldConfigData = JSON.parse(oldConfigResp) as Record<string, unknown>
    const oldConfig = ((oldConfigData["code"] === "200" ? oldConfigData["data"] : {}) ?? {}) as Record<string, unknown>

    const cronExpress = (arguments_["cron_express"] as string | undefined) ?? "0 00 00 * * ? *"
    const schemaName = (arguments_["schema_name"] as string | undefined) ?? (oldConfig["schemaName"] as string | undefined) ?? "public"
    const etlVcCode = (arguments_["etl_vc_code"] as string | undefined) ?? (oldConfig["etlVcCode"] as string | undefined) ?? "DEFAULT"
    const etlVcId = (arguments_["etl_vc_id"] as string | undefined) ?? (oldConfig["etlVcId"] as string | undefined) ?? ""

    const response = await apiSaveConfiguration(config, {
      projectId: config.projectId,
      dataFileId: taskId,
      cronExpress: cronExpress,
      userId: String(config.userId ?? ""),
      userName,
      activeStartTime: oldConfig["activeStartTime"] as string | undefined,
      activeEndTime: (oldConfig["activeEndTime"] as string | undefined) ?? "2099-01-01",
      retryIntervalTime: (oldConfig["retryIntervalTime"] as number | undefined) ?? 1,
      retryIntervalTimeUnits: (oldConfig["retryIntervalTimeUnit"] as string | undefined) ?? "m",
      retryCount: (oldConfig["retryCount"] as number | undefined) ?? 1,
      rerunProperty: (oldConfig["rerunProperty"] as number | undefined) ?? 3,
      executeTimeout: (oldConfig["executeTimeout"] as number | undefined) ?? 0,
      executeTimeoutUnit: (oldConfig["executeTimeoutUnit"] as string | undefined) ?? "m",
      selfDependsJob: (oldConfig["selfDependsJob"] as number | undefined) ?? 0,
      dataFileInputListReqs: (oldConfig["dataFileDependencyDTOS"] as unknown[]) ?? [],
      configProperties: JSON.stringify(oldConfig["configProperties"] ?? {}),
      schemaName,
      etlVcCode,
      etlVcId,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>
    if (responseData["code"] === "200") {
      return { success: true, message: "Successfully save configuration", save_config_result: responseData["data"] }
    }
    return { success: false, message: `API request failed: ${responseData["message"] ?? "Unknown error"}`, code: responseData["code"], raw_response: responseData }
  } catch (e) {
    logger.error({ err: e }, "Error in save_task_cron_configuration")
    return { success: false, message: `Internal error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// handleSaveTaskNonCronConfiguration — file_tools.py:1733-1900
// ---------------------------------------------------------------------------
async function handleSaveTaskNonCronConfiguration(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const taskId = arguments_["task_id"] as number | undefined
    if (!taskId) return { success: false, message: "task_id is required" }

    const userName = await resolveUsername(config)

    // Fetch existing configuration
    const oldConfigResp = await apiGetConfigurationDetail(config, {
      projectId: config.projectId,
      workspaceId: config.workspaceId,
      dataFileId: taskId,
    })
    const oldConfigData = JSON.parse(oldConfigResp) as Record<string, unknown>
    const oldConfig = ((oldConfigData["code"] === "200" ? oldConfigData["data"] : {}) ?? {}) as Record<string, unknown>

    const cronExpress = (oldConfig["cronExpress"] as string | undefined) ?? "0 00 00 * * ? *"
    const retryIntervalTime = (arguments_["retry_interval_time"] as number | undefined) ?? (oldConfig["retryIntervalTime"] as number | undefined) ?? 1
    const retryIntervalTimeUnit = (arguments_["retry_interval_time_unit"] as string | undefined) ?? (oldConfig["retryIntervalTimeUnit"] as string | undefined) ?? "m"
    const retryCount = (arguments_["retry_count"] as number | undefined) ?? (oldConfig["retryCount"] as number | undefined) ?? 1
    const rerunProperty = (arguments_["rerun_property"] as number | undefined) ?? (oldConfig["rerunProperty"] as number | undefined) ?? 3
    const selfDependsJob = (arguments_["self_depends_job"] as number | undefined) ?? (oldConfig["selfDependsJob"] as number | undefined) ?? 0
    const schemaName = (arguments_["schema_name"] as string | undefined) ?? (oldConfig["schemaName"] as string | undefined) ?? ""
    const etlVcCode = (arguments_["etl_vc_code"] as string | undefined) ?? (oldConfig["etlVcCode"] as string | undefined) ?? "DEFAULT"
    const etlVcId = (arguments_["etl_vc_id"] as string | undefined) ?? (oldConfig["etlVcId"] as string | undefined) ?? ""
    const executeTimeout = (arguments_["execute_timeout"] as number | undefined) ?? (oldConfig["executeTimeout"] as number | undefined)
    const executeTimeoutUnit = (arguments_["execute_timeout_unit"] as string | undefined) ?? (oldConfig["executeTimeoutUnit"] as string | undefined) ?? "m"

    // Dependencies: support keep/replace/clear
    const action = arguments_["task_dependencies_action"] as string | undefined
    let taskDependencies: unknown[]
    if (action === "clear") taskDependencies = []
    else if (action === "replace") taskDependencies = (arguments_["task_dependencies"] as unknown[]) ?? []
    else if ("task_dependencies" in arguments_) taskDependencies = (arguments_["task_dependencies"] as unknown[]) ?? []
    else taskDependencies = (oldConfig["dataFileDependencyDTOS"] as unknown[]) ?? []

    const response = await apiSaveConfiguration(config, {
      projectId: config.projectId,
      dataFileId: taskId,
      cronExpress,
      userId: String(config.userId ?? ""),
      userName,
      activeStartTime: oldConfig["activeStartTime"] as string | undefined,
      activeEndTime: (oldConfig["activeEndTime"] as string | undefined) ?? "2099-01-01",
      retryIntervalTime,
      retryIntervalTimeUnits: retryIntervalTimeUnit,
      retryCount,
      rerunProperty,
      executeTimeout,
      executeTimeoutUnit,
      selfDependsJob,
      dataFileInputListReqs: taskDependencies,
      configProperties: JSON.stringify(oldConfig["configProperties"] ?? {}),
      schemaName,
      etlVcCode,
      etlVcId,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>
    if (responseData["code"] === "200") {
      return { success: true, message: "Successfully save configuration", save_config_result: responseData["data"] }
    }
    return { success: false, message: `API request failed: ${responseData["message"] ?? "Unknown error"}`, code: responseData["code"], raw_response: responseData }
  } catch (e) {
    logger.error({ err: e }, "Error in save_task_non_cron_configuration")
    return { success: false, message: `Internal error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// handleListClickzettaTasks — file_tools.py:3013-3100
// ---------------------------------------------------------------------------
async function handleListClickzettaTasks(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const folderId = arguments_["folderId"] as number | undefined
    const taskName = arguments_["taskName"] as string | undefined
    const taskType = arguments_["taskType"] as number | undefined
    const page = (arguments_["page"] as number | undefined) ?? 1
    const pageSize = (arguments_["pageSize"] as number | undefined) ?? 10

    let fileType: number | undefined
    if (taskType != null) {
      fileType = TASK_TYPE_TO_FILE_TYPE[taskType] ?? taskType
    }

    const response = await apiListFiles(config, {
      projectId: config.projectId,
      folderId,
      fileName: taskName,
      fileType,
      page,
      pageSize,
    })

    const responseData = JSON.parse(response) as Record<string, unknown>
    if (responseData["code"] === "200") {
      const data = (responseData["data"] ?? {}) as Record<string, unknown>
      const taskList = (data["list"] ?? []) as Record<string, unknown>[]
      const total = data["total"] as number ?? 0
      const totalPages = data["totalPages"] as number ?? 0
      const convertedTasks = taskList.map(convertTaskDetailFields)
      return {
        success: true,
        message: `Successfully retrieved ${convertedTasks.length} tasks (page ${page}/${totalPages})`,
        tasks: convertedTasks,
        pagination: { page, pageSize, total, totalPages },
      }
    }
    return { success: false, message: `API request failed: ${responseData["message"] ?? "Unknown error"}`, raw_response: responseData }
  } catch (e) {
    logger.error({ err: e }, "Error in list_clickzetta_tasks")
    return { success: false, message: `Internal error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// handleDeleteTask — file_tools.py:3204-3260
// ---------------------------------------------------------------------------
async function handleDeleteTask(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const taskId = arguments_["task_id"] as number | undefined
    if (!taskId) return { success: false, message: "task_id is required" }

    const updateBy = await resolveUsername(config)

    const response = await apiDeleteFile(config, { fileId: taskId, updateBy })
    const responseData = JSON.parse(response) as Record<string, unknown>

    if (responseData["code"] === "200") {
      return { success: true, message: "Successfully deleted task", task_id: taskId }
    }
    return {
      success: false,
      message: `API request failed: ${responseData["message"] ?? "Unknown error"}`,
      code: responseData["code"],
      raw_response: responseData,
    }
  } catch (e) {
    logger.error({ err: e }, "Error in delete_task")
    return { success: false, message: `Internal error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// registerTaskTools — file_tools.py tool definitions
// ---------------------------------------------------------------------------
export function registerTaskTools(registry: ToolRegistry, db: LakehouseDB): void {
  const getConfig = () => {
    if (!db.connectionConfig) throw new Error("No connection configuration available")
    return db.connectionConfig
  }

  const tools: ToolDefinition[] = [
    // file_tools.py:516-570 — create_task
    {
      name: "create_task",
      description:
        "Create a new data task in a Clickzetta Studio project workspace and return a direct link to open it. " +
        "Specify the task name, type, owner, description, and target folder. " +
        "Supports various task types including SQL, Shell, Python, data integration, and notebook tasks.\n\n" +
        "**For Flow tasks (组合任务, task_type=500):** After creation, use flow-specific tools to manage nodes.\n\n" +
        "The response includes a 'studio_url' field providing a direct link to open the task in Clickzetta Studio IDE.",
      inputSchema: {
        type: "object",
        properties: {
          task_type: {
            type: "integer",
            description:
              "Task type ID. Common values: 1=LakehouseSQL, 3=Shell, 4=Python, 5=Notebook, 10=DataIntegration(离线同步), 28=RealTimeDI(实时同步), 280=FullIncrementalSync, 281=MultipleRISync, 291=MultipleDISync, 500=Flow(组合任务)",
          },
          task_name: {
            type: "string",
            description: "Name of the task to be created.",
          },
          task_description: {
            type: "string",
            description: "Optional description or notes for the task.",
          },
          data_folder_id: {
            type: "integer",
            description: "Target folder ID where the task will be created.",
          },
        },
        additionalProperties: false,
        required: ["task_type", "task_name", "data_folder_id"],
      },
      handler: async (args: Record<string, unknown>) => handleCreateTask(args, getConfig()),
      tags: ["studio", "project", "tasks", "normalize"],
      samples: [
        {
          description: "Create a Lakehouse SQL task named 'test_task_name' in folder 294001",
          query: {
            task_name: "test_task_name",
            data_folder_id: 294001,
            task_description: "Sample task for testing",
            task_type: 4,
          },
        },
      ],
    },
    // file_tools.py:647-687 — get_task_detail
    {
      name: "get_task_detail",
      description:
        "CRITICAL: This tool's only purpose is to retrieve detailed information about a task in Clickzetta Studio. " +
        "Returns task metadata including name, type, owner, description, content, version, and configuration. " +
        "Finally output the 'studio_url' as the final answer. " +
        "The returned 'studio_url' MUST be presented directly to the user without any additional text.\n\n" +
        "❌ Do NOT use this tool for Flow task nodes (组合任务节点). " +
        "Flow nodes are NOT standalone tasks — use get_flow_node_detail instead.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "Unique task ID to retrieve details for.",
          },
        },
        additionalProperties: false,
        required: ["task_id"],
      },
      handler: async (args: Record<string, unknown>) => handleGetTaskDetail(args, getConfig()),
      tags: ["studio", "project", "tasks", "normalize"],
      samples: [
        {
          description: "Retrieve details for task with ID 11955233",
          query: { task_id: 11955233 },
        },
      ],
    },
    // file_tools.py:807-882 — save_non_integration_task_content
    {
      name: "save_non_integration_task_content",
      description:
        "CRITICAL: This tool's only purpose is to save content to a Clickzetta task and output the 'studio_url' as the final answer. " +
        "The returned 'studio_url' MUST be presented directly to the user without any additional text. " +
        "Save content to a non-data-integration task in Clickzetta Studio. Supports SQL scripts, Shell scripts, Python code, and other text-based task content. " +
        "Use this for task types such as Lakehouse SQL, JDBC SQL, Shell, Python, and Notebook tasks. Includes support for parameterized content with dynamic variables.\n\n" +
        "❌ Do NOT use this tool to create flow nodes — use create_flow_node instead. " +
        "**IMPORTANT:** When save task_content properties, preserve actual newline characters (\\n) as line breaks, " +
        "not as literal string '\\\\n'. Ensure proper formatting is maintained in the saved content.\n\n" +
        "Upon success, it provides the URL to open the task in the studio.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "Unique task ID of the target task.",
          },
          task_content: {
            type: "string",
            description:
              "Task content to save. The format depends on the task type: " +
              "SQL statements for query tasks, Shell scripts for Shell tasks, " +
              "Python code for Python tasks, etc.",
          },
          param_value_list: {
            type: "array",
            description:
              "List of parameter key-value pairs for dynamic variables within the task content.",
            items: {
              type: "object",
              properties: {
                paramKey: {
                  type: "string",
                  description: "Parameter name (e.g., 'today', 'yesterday').",
                },
                paramValue: {
                  type: "string",
                  description:
                    "Parameter value or expression (e.g., '$[yyyyMMdd]', '$[yyyyMMdd, -1d]').",
                },
              },
            },
          },
        },
        required: ["task_id", "task_content", "param_value_list"],
      },
      handler: async (args: Record<string, unknown>) =>
        saveTaskContentBase(args, getConfig()),
      tags: ["studio", "project", "tasks", "save"],
      samples: [
        {
          task_content:
            "--LAKEHOUSE SQL\n--********************************************************************--\n-- author: 110000001376\n-- create time: 2025-10-22 15:28:01\n--********************************************************************--\nselect 1; ",
          task_id: 11955233,
          param_value_list: [
            { paramKey: "today", paramValue: "$[yyyyMMdd]" },
            { paramKey: "yesterday", paramValue: "$[yyyyMMdd, -1d]" },
          ],
        },
      ],
    },
    // ide_admin_server.py:274-362 — save_task_configuration
    {
      name: "save_task_configuration",
      description:
        "Save scheduling configuration for a task in Clickzetta Studio. " +
        "Configures cron schedule, retry policy, dependencies, VC, schema, and other execution parameters. " +
        "Use this after creating a task to set up its scheduling and execution settings.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "Task ID to configure.",
          },
          cron_express: {
            type: "string",
            description: "Cron expression for scheduling (e.g., '0 0 * * *').",
          },
          active_start_time: {
            type: "string",
            description: "Schedule active start time (ISO format: YYYY-MM-DDTHH:mm:ss.000Z).",
          },
          active_end_time: {
            type: "string",
            description: "Schedule active end time (ISO format: YYYY-MM-DDTHH:mm:ss.000Z).",
          },
          retry_count: {
            type: "integer",
            description: "Number of retry attempts on failure.",
          },
          retry_interval_time: {
            type: "integer",
            description: "Retry interval duration.",
          },
          retry_interval_time_unit: {
            type: "string",
            description: "Retry interval unit (MINUTE, HOUR, etc.).",
          },
          rerun_property: {
            type: "integer",
            description: "Rerun property (0=not allowed, 1=allowed).",
          },
          self_depends_job: {
            type: "integer",
            description: "Self-dependency setting.",
          },
          schema_name: {
            type: "string",
            description: "Schema name for task execution.",
          },
          etl_vc_code: {
            type: "string",
            description: "ETL virtual cluster code.",
          },
          etl_vc_id: {
            type: "string",
            description: "ETL virtual cluster ID.",
          },
          execute_timeout: {
            type: "integer",
            description: "Execution timeout duration.",
          },
          execute_timeout_unit: {
            type: "string",
            description: "Execution timeout unit (MINUTE, HOUR, etc.).",
          },
          task_dependencies: {
            type: "array",
            description: "List of upstream task dependencies.",
            items: {
              type: "object",
              properties: {
                dependency_task_id: { type: "integer" },
                dependency_task_name: { type: "string" },
                dep_strategy: { type: "integer" },
              },
            },
          },
          config_properties: {
            type: "string",
            description: "Additional configuration properties as JSON string.",
          },
        },
        additionalProperties: false,
        required: ["task_id"],
      },
      handler: async (args: Record<string, unknown>) =>
        handleSaveTaskConfiguration(args, getConfig()),
      tags: ["studio", "project", "tasks", "configure"],
      samples: [
        {
          description: "Configure daily schedule for task 11955233",
          query: {
            task_id: 11955233,
            cron_express: "0 0 * * *",
            retry_count: 3,
            retry_interval_time: 5,
            retry_interval_time_unit: "MINUTE",
            schema_name: "public",
            etl_vc_code: "DEFAULT",
          },
        },
      ],
    },
    // ide_admin_server.py:365-392 — get_task_configuration_detail
    {
      name: "get_task_configuration_detail",
      description:
        "Get the scheduling and execution configuration details of a task in Clickzetta Studio. " +
        "Returns cron schedule, retry policy, dependencies, VC settings, and other configuration parameters.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "Task ID to retrieve configuration for.",
          },
        },
        additionalProperties: false,
        required: ["task_id"],
      },
      handler: async (args: Record<string, unknown>) =>
        handleGetTaskConfigurationDetail(args, getConfig()),
      tags: ["studio", "project", "tasks", "configure"],
      samples: [
        {
          description: "Get configuration for task 11955233",
          query: { task_id: 11955233 },
        },
      ],
    },
    // ide_admin_server.py:395-418 — publish_task
    {
      name: "publish_task",
      description:
        "Publish (submit) a task in Clickzetta Studio to make it available for scheduling. " +
        "This commits the current task version and enables it for scheduled execution. " +
        "Must be called after saving task content and configuration.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "Task ID to publish.",
          },
          data_file_version: {
            type: "string",
            description: "Version of the task to publish (optional, defaults to current version).",
          },
        },
        additionalProperties: false,
        required: ["task_id"],
      },
      handler: async (args: Record<string, unknown>) => handlePublishTask(args, getConfig()),
      tags: ["studio", "project", "tasks", "publish"],
      samples: [
        {
          description: "Publish task 11955233",
          query: { task_id: 11955233 },
        },
      ],
    },
    // file_tools.py:885-1400 — save_integration_task
    {
      name: "save_integration_task",
      description:
        "Save a complete data integration task with source and sink parameters. " +
        "Handles table existence checks, automatic sink table creation, and integration configuration building.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "integer", description: "Unique task ID of the integration task." },
          source_datasource_name: { type: "string", description: "Name of the source datasource." },
          source_schema: { type: "string", description: "Schema/database containing the source table." },
          source_table: { type: "string", description: "Name of the source table." },
          source_ds_type: { type: "integer", description: "Source datasource type (1=Lakehouse, 5=MySQL, 7=PostgreSQL, etc.)." },
          sink_datasource_name: { type: "string", description: "Name of the sink datasource." },
          sink_schema: { type: "string", description: "Schema for the sink table (default: public)." },
          sink_table: { type: "string", description: "Name of the sink table (defaults to source_table name)." },
          sink_ds_type: { type: "integer", description: "Sink datasource type." },
        },
        additionalProperties: false,
        required: ["task_id", "source_datasource_name", "source_schema", "source_table", "source_ds_type", "sink_datasource_name", "sink_ds_type"],
      },
      handler: async (args: Record<string, unknown>) => handleSaveIntegrationTask(args, getConfig()),
      tags: ["studio", "project", "tasks", "integration", "save"],
      samples: [{ description: "Save integration task", query: { task_id: 1234566, source_datasource_name: "MySQL_Prod", source_schema: "app", source_table: "users", source_ds_type: 5, sink_datasource_name: "LAKEHOUSE_ws", sink_schema: "public", sink_table: "users_from_mysql", sink_ds_type: 1 } }],
    },
    // file_tools.py:1590-1730 — save_task_cron_configuration
    {
      name: "save_task_cron_configuration",
      description:
        "Save cron-based scheduling configuration to a task. Fetches existing config and merges with the new cron expression. " +
        "Use this when you want to SET or CHANGE the cron schedule of a task.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "integer", description: "Task ID to configure." },
          cron_express: { type: "string", description: "Cron expression (e.g. '0 0 2 * * ? *' for 2AM daily)." },
          schema_name: { type: "string", description: "Schema name for execution." },
          etl_vc_code: { type: "string", description: "Virtual cluster code." },
          etl_vc_id: { type: "string", description: "Virtual cluster ID." },
        },
        additionalProperties: false,
        required: ["task_id", "cron_express"],
      },
      handler: async (args: Record<string, unknown>) => handleSaveTaskCronConfiguration(args, getConfig()),
      tags: ["studio", "project", "tasks", "configure", "cron"],
      samples: [{ description: "Set daily 2AM schedule", query: { task_id: 11955233, cron_express: "0 0 2 * * ? *" } }],
    },
    // file_tools.py:1733-1900 — save_task_non_cron_configuration
    {
      name: "save_task_non_cron_configuration",
      description:
        "Save non-cron configuration fields (retry, dependencies, VC, timeout) without changing the cron expression. " +
        "Preserves the existing cron schedule while updating other scheduling parameters.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "integer", description: "Task ID to configure." },
          retry_count: { type: "integer", description: "Max retry attempts on failure." },
          retry_interval_time: { type: "integer", description: "Retry interval duration." },
          retry_interval_time_unit: { type: "string", description: "Retry interval unit ('m' or 's')." },
          rerun_property: { type: "integer", description: "Rerun policy: 1=ANY_TIME, 2=FAILED_ONLY, 3=NOT_RERUN." },
          self_depends_job: { type: "integer", description: "Self-dependency: 0=no, 1=yes." },
          schema_name: { type: "string", description: "Schema name." },
          etl_vc_code: { type: "string", description: "Virtual cluster code." },
          etl_vc_id: { type: "string", description: "Virtual cluster ID." },
          execute_timeout: { type: "integer", description: "Execution timeout." },
          execute_timeout_unit: { type: "string", description: "Timeout unit." },
          task_dependencies_action: { type: "string", description: "Action for dependencies: 'keep', 'replace', or 'clear'." },
          task_dependencies: { type: "array", description: "Dependency list (used with action='replace').", items: { type: "object" } },
        },
        additionalProperties: false,
        required: ["task_id"],
      },
      handler: async (args: Record<string, unknown>) => handleSaveTaskNonCronConfiguration(args, getConfig()),
      tags: ["studio", "project", "tasks", "configure"],
      samples: [{ description: "Update retry policy", query: { task_id: 11955233, retry_count: 3, retry_interval_time: 5, retry_interval_time_unit: "m" } }],
    },
    // file_tools.py:3110-3200 — list_clickzetta_tasks
    {
      name: "list_clickzetta_tasks",
      description:
        "List tasks in Clickzetta Studio with optional filtering by folder, name, or type. " +
        "Returns both draft and published tasks in any state.",
      inputSchema: {
        type: "object",
        properties: {
          folderId: { type: "integer", description: "Folder ID to filter tasks." },
          taskName: { type: "string", description: "Task name for fuzzy search." },
          taskType: { type: "integer", description: "Task type filter (e.g. 1=LakehouseSQL, 10=DataIntegration)." },
          page: { type: "integer", description: "Page number (default: 1)." },
          pageSize: { type: "integer", description: "Items per page (default: 10)." },
        },
        additionalProperties: false,
        required: [],
      },
      handler: async (args: Record<string, unknown>) => handleListClickzettaTasks(args, getConfig()),
      tags: ["studio", "project", "tasks", "normalize"],
      samples: [
        { description: "List all tasks", query: { page: 1, pageSize: 20 } },
        { description: "Search tasks by name", query: { taskName: "test", page: 1, pageSize: 20 } },
      ],
    },
    // file_tools.py:3262-3300 — delete_task
    {
      name: "delete_task",
      description:
        "Delete a task in Clickzetta Studio. The task must be in draft/offline state. " +
        "Published (online) tasks must be taken offline first.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "integer", description: "ID of the task to delete." },
        },
        additionalProperties: false,
        required: ["task_id"],
      },
      handler: async (args: Record<string, unknown>) => handleDeleteTask(args, getConfig()),
      tags: ["studio", "project", "tasks"],
      samples: [{ description: "Delete task 12345", query: { task_id: 12345 } }],
    },
  ]

  logger.info({ count: tools.length }, "Registering task tools")
  registry.registerTools(tools)
}
