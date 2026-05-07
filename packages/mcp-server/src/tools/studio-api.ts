/**
 * Studio API client — thin HTTP wrapper for Clickzetta Studio REST APIs.
 *
 * Python equivalent: cz_mcp/utils/request_utils.py + cz_mcp/utils/config_utils.py
 *
 * All methods mirror the Python Request().post() pattern:
 *   url = read_url(env) + read_api("KEY")
 *   headers = { "X-Clickzetta-Token": token, ... }
 *   response = Request().post(url, headers, json).text
 */

import type { StudioConfig } from "../config/profile.js"
import { logger } from "../logger.js"

// ---------------------------------------------------------------------------
// URL resolution — config_utils.py:read_url + read_api
// ---------------------------------------------------------------------------

const ENV_BASE_URLS: Record<string, string> = {
  dev: "https://dev-api.clickzetta.com",
  sit: "https://sit-api.clickzetta.com",
  uat: "https://uat-api.clickzetta.com",
  prod: "https://api.clickzetta.com",
  // Alicloud regions
  "cn-shanghai-alicloud": "https://cn-shanghai-alicloud.api.clickzetta.com",
  "ap-southeast-1-alicloud": "https://ap-southeast-1-alicloud.api.singdata.com",
  // Tencent regions
  "ap-shanghai-tencentcloud": "https://ap-shanghai-tencentcloud.api.clickzetta.com",
  "ap-beijing-tencentcloud": "https://ap-beijing-tencentcloud.api.clickzetta.com",
  "ap-guangzhou-tencentcloud": "https://ap-guangzhou-tencentcloud.api.clickzetta.com",
  // AWS regions
  "cn-north-1-aws": "https://cn-north-1-aws.api.clickzetta.com",
  "ap-southeast-1-aws": "https://ap-southeast-1-aws.api.singdata.com",
}

const API_PATHS: Record<string, string> = {
  // Task development — ide_admin_server.py
  DATA_FILE_ADD: "/ide-admin/v1/dataFile/addAndReturnId",
  DATA_FOLDER_ADD: "/ide-admin/v1/dataFolder/add",
  SAVE_DATAFILE_CONFIGURATION: "/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration",
  GET_DETAIL: "/ide-admin/v1/dataFile/getDetail",
  GET_CONFIGURATION_DETAIL: "/ide-admin/v1/dataFileConfiguration/getFileConfigurationDetail",
  SUBMIT: "/ide-admin/v1/dataFile/submit",
  MCP_LIST_FOLDERS: "/ide-admin/v1/ai/mcp/listFolders",
  MCP_LIST_FILES: "/ide-admin/v1/ai/mcp/listFiles",
  MCP_TASK_STATISTICS: "/ide-admin/v1/ai/mcp/task/statistic",
  MCP_INSTANCE_STATISTICS: "/ide-admin/v1/ai/mcp/instance/statistic",
  // Execute — execute_server.py
  ADHOC_EXECUTE: "/ide-admin/v1/adhoc/execute",
  TASK_INST_GET_DETAIL: "/ide-admin/v1/taskInst/getDetail",
  // Schedule instances — schedule_instance_tools.py
  TASK_INST_LIST: "/ide-admin/v1/taskInst/list",
  SCHEDULE_INSTANCE_RELATION: "/ide-admin/v1/taskInst/queryTaskInstanceRelation",
  EXECUTE_LOGS: "/ide-admin/v1/taskInst/execute/logs",
  QUERY_TEMP_LOG_RESULTS: "/ide-admin/v1/adhoc/queryTempLogResults",
  // Datasource — datasource_server.py
  DATA_SOURCES_LIST: "/ide-authority/v1/projectDataSources/list",
  DATA_SOURCES_LIST_NAMESPACES: "/ide-authority/v1/projectDataSources/listNamespaces",
  DATA_SOURCES_LIST_DATA_OBJECTS: "/ide-authority/v1/projectDataSources/listDataObjects",
  DATA_SOURCES_GET_META_DETAIL: "/ide-authority/v1/projectDataSources/getMetaDetail",
}

export function getBaseUrl(env: string, configBaseUrl?: string): string {
  if (configBaseUrl) return configBaseUrl
  return ENV_BASE_URLS[env] ?? ENV_BASE_URLS["dev"]!
}

export function getApiPath(key: string): string {
  const path = API_PATHS[key]
  if (!path) throw new Error(`Unknown API key: ${key}`)
  return path
}

// ---------------------------------------------------------------------------
// Core POST helper — request_utils.py:Request().post()
// ---------------------------------------------------------------------------

export async function studioPost(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<string> {
  logger.debug({ url, bodyKeys: Object.keys(body) }, "Studio API POST")
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  logger.debug({ url, status: response.status }, "Studio API response")
  return text
}

// ---------------------------------------------------------------------------
// Standard header builder — mirrors Python header dicts in ide_admin_server.py
// ---------------------------------------------------------------------------

export function buildHeaders(
  config: StudioConfig,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "X-Clickzetta-Token": config.token,
    "x-clickzetta-token": config.token,
    userId: String(config.userId),
    instanceId: String(config.instanceId),
    accountId: String(config.tenantId),
    instanceName: config.instance,
    tenantId: String(config.tenantId),
  }
  if (config.workspace) {
    headers["workspaceName"] = config.workspace
  }
  if (extra) {
    Object.assign(headers, extra)
  }
  return headers
}

// ---------------------------------------------------------------------------
// Typed API wrappers — one per Python function in ide_admin_server.py
// ---------------------------------------------------------------------------

/** ide_admin_server.py:54-79 create_task */
export async function apiCreateTask(
  config: StudioConfig,
  params: {
    projectId: string
    fileType: number
    createdBy: string
    dataFileName: string
    fileDescription?: string
    dataFolderId: number
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("DATA_FILE_ADD")
  const headers = buildHeaders(config)
  return studioPost(url, headers, {
    fileType: params.fileType,
    createdBy: params.createdBy,
    projectId: params.projectId,
    dataFileName: params.dataFileName,
    fileDescription: params.fileDescription ?? "",
    dataFolderId: params.dataFolderId,
  })
}

/** ide_admin_server.py:251-271 get_task_detail */
export async function apiGetTaskDetail(
  config: StudioConfig,
  dataTaskId: number,
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("GET_DETAIL")
  const headers = buildHeaders(config)
  return studioPost(url, headers, { id: dataTaskId })
}

/** ide_admin_server.py:179-248 save_content */
export async function apiSaveContent(
  config: StudioConfig,
  params: {
    projectId: string
    dataFileId: number
    content: string
    paramValueList?: unknown[]
    updateBy: string
    adhocConfigs?: string
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("SAVE_DATAFILE_CONFIGURATION")
  const headers = buildHeaders(config)

  let contentStr = params.content
  if (typeof contentStr === "object") {
    contentStr = JSON.stringify(contentStr)
  }
  // ide_admin_server.py:206-210 — unescape newlines
  contentStr = contentStr.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")

  const body: Record<string, unknown> = {
    dataFileId: params.dataFileId,
    dataFileContent: contentStr,
    onlySaveContent: 1,
    projectId: params.projectId,
    updateBy: params.updateBy,
    paramValueList: params.paramValueList ?? [],
    instanceName: config.instance,
  }
  if (params.adhocConfigs != null) {
    body["adhocConfigs"] =
      typeof params.adhocConfigs === "object"
        ? JSON.stringify(params.adhocConfigs)
        : params.adhocConfigs
  }
  return studioPost(url, headers, body)
}

/** ide_admin_server.py:274-362 save_configuration */
export async function apiSaveConfiguration(
  config: StudioConfig,
  params: {
    projectId: string
    dataFileId: number
    cronExpress?: string
    userId: string
    userName: string
    activeStartTime?: string
    activeEndTime?: string
    retryIntervalTime?: number
    retryIntervalTimeUnits?: string
    retryCount?: number
    rerunProperty?: number
    executeTimeout?: number
    executeTimeoutUnit?: string
    selfDependsJob?: number
    dataFileInputListReqs?: unknown[]
    configProperties?: string
    schemaName?: string
    etlVcCode?: string
    etlVcId?: string
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("SAVE_DATAFILE_CONFIGURATION")
  const headers = buildHeaders(config)

  // ide_admin_server.py:307-328 — process dependencies
  const rawDeps = params.dataFileInputListReqs ?? []
  const processedDeps = rawDeps.map((item) => {
    const d = item as Record<string, unknown>
    if ("dependencyFileId" in d) return d
    return {
      parseType: "1",
      dependencyProjectId: params.projectId,
      depStrategy: 0,
      dependencyFileId: d["dependency_task_id"],
      dependencyFileName: d["dependency_task_name"],
    }
  })

  return studioPost(url, headers, {
    projectId: params.projectId,
    dataFileId: params.dataFileId,
    retryCount: params.retryCount ?? 0,
    retryIntervalTime: params.retryIntervalTime ?? 0,
    retryIntervalTimeUnit: params.retryIntervalTimeUnits ?? "MINUTE",
    rerunProperty: params.rerunProperty ?? 0,
    selfDependsJob: params.selfDependsJob ?? 0,
    activeStartTime: params.activeStartTime,
    activeEndTime: params.activeEndTime,
    ownerEnName: params.userId,
    ownerCnName: params.userName,
    cronExpress: params.cronExpress,
    schemaName: params.schemaName,
    etlVcCode: params.etlVcCode,
    etlVcId: params.etlVcId,
    executeTimeout: params.executeTimeout ?? 0,
    executeTimeoutUnit: params.executeTimeoutUnit ?? "MINUTE",
    instanceName: config.instance,
    dataFileInputListReqs: processedDeps,
    dataFileOutputListReqs: [],
    onlySaveContent: 0,
    configProperties: params.configProperties,
    taskPriority: "1",
    scheduleRateType: 2,
    scheduleType: 1,
    fileCreateType: 1,
    scheduleCreatedType: "2",
    scheduleConfigType: "1",
  })
}

/** ide_admin_server.py:365-392 get_configuration_detail */
export async function apiGetConfigurationDetail(
  config: StudioConfig,
  params: {
    projectId: string
    workspaceId: number
    dataFileId: number
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("GET_CONFIGURATION_DETAIL")
  const headers = buildHeaders(config, {
    tenantId: String(config.tenantId),
    userId: String(config.userId),
    instanceId: String(config.instanceId),
  })
  return studioPost(url, headers, {
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    dataFileId: params.dataFileId,
  })
}

/** ide_admin_server.py:395-418 submit_task */
export async function apiSubmitTask(
  config: StudioConfig,
  params: {
    projectId: string
    dataFileId: number
    dataFileVersion: string
    username: string
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("SUBMIT")
  const headers = buildHeaders(config)
  const commitMessage = `【UAT_TEST】提交于：${new Date().toISOString().replace("T", " ").slice(0, 19)}`
  return studioPost(url, headers, {
    commitMsg: commitMessage,
    dataFileId: params.dataFileId,
    dataFileVersion: params.dataFileVersion,
    projectId: params.projectId,
    updatedBy: params.username,
  })
}

/** execute_server.py:17-103 adhoc_execute */
export async function apiAdhocExecute(
  config: StudioConfig,
  params: {
    dataTaskId: number
    dataTaskContent: string
    execParams?: Record<string, string>
    updateBy: string
    collectType?: number
    maxRowSize?: number
    offsetLine?: number
    offsetCol?: number
    multiDataSource?: unknown[]
    adhocVcCode?: string
    adhocSchemaName?: string
    adhocVcId?: string
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("ADHOC_EXECUTE")
  const headers = buildHeaders(config)
  return studioPost(url, headers, {
    updateBy: params.updateBy,
    dataFileId: params.dataTaskId,
    collectType: params.collectType ?? 1,
    maxRowSize: params.maxRowSize ?? 1000,
    offsetLine: params.offsetLine ?? 0,
    offsetCol: params.offsetCol ?? 0,
    instanceName: config.instance,
    multiDataSource: params.multiDataSource ?? [],
    adhocVcCode: params.adhocVcCode ?? config.vcluster,
    adhocSchemaName: params.adhocSchemaName ?? config.schema,
    adhocVcId: params.adhocVcId ?? "",
    dataFileContent: params.dataTaskContent,
    params: params.execParams ?? {},
  })
}

/** execute_server.py:106-162 get_task_instance_detail */
export async function apiGetTaskInstanceDetail(
  config: StudioConfig,
  params: {
    taskInstanceId: number
    projectId?: string | number
    scheduleTaskId?: number
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("TASK_INST_GET_DETAIL")
  const headers = buildHeaders(config)
  return studioPost(url, headers, {
    taskInstanceId: params.taskInstanceId,
    projectId: params.projectId,
    scheduleTaskId: params.scheduleTaskId,
  })
}

/** ide_admin_server.py:571-623 instance_list */
export async function apiInstanceList(
  config: StudioConfig,
  params: {
    projectId: string
    taskNameOrTaskId?: string
    taskType?: number
    instanceType?: number
    scheduleTaskId?: number
    pageIndex?: number
    pageSize?: number
    orderBy?: string
    orderByFields?: string
    queryStartPlanTime?: number
    queryEndPlanTime?: number
    instanceStatusList?: number[]
    groupId?: number
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("TASK_INST_LIST")
  const headers = buildHeaders(config)
  return studioPost(url, headers, {
    cycleTaskType: params.taskType,
    taskNameLike: params.taskNameOrTaskId ?? "",
    scheduleTaskId: params.scheduleTaskId,
    projectId: params.projectId,
    pageIndex: params.pageIndex ?? 1,
    pageSize: params.pageSize ?? 10,
    instanceType: params.instanceType ?? 1,
    orderByFields: params.orderByFields ?? "execute_start_time",
    orderBy: params.orderBy ?? "desc",
    queryStartPlanTime: params.queryStartPlanTime,
    queryEndPlanTime: params.queryEndPlanTime,
    instanceStatusList: params.instanceStatusList,
    groupId: params.groupId,
  })
}

/** ide_admin_server.py:657-684 instance_relation */
export async function apiInstanceRelation(
  config: StudioConfig,
  params: {
    projectId: string
    taskInstanceId: number
    parentLevel?: number
    childLevel?: number
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("SCHEDULE_INSTANCE_RELATION")
  const headers = buildHeaders(config)
  return studioPost(url, headers, {
    taskInstanceId: params.taskInstanceId,
    projectId: params.projectId,
    parentLevel: params.parentLevel ?? 1,
    childLevel: params.childLevel ?? 1,
  })
}

/** ide_admin_server.py:687-714 list_execution_records */
export async function apiListExecutionRecords(
  config: StudioConfig,
  params: {
    projectId: string
    taskInstanceId: number
    pageIndex?: number
    pageSize?: number
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("EXECUTE_LOGS")
  const headers = buildHeaders(config)
  return studioPost(url, headers, {
    taskInstanceId: params.taskInstanceId,
    projectId: params.projectId,
    pageIndex: params.pageIndex ?? 1,
    pageSize: params.pageSize ?? 20,
  })
}

/** ide_admin_server.py:717-744 get_execution_log_content */
export async function apiGetExecutionLogContent(
  config: StudioConfig,
  params: {
    taskInstanceId: number
    executeLogId: number
    queryLogActionCode?: number
    offset?: number
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("QUERY_TEMP_LOG_RESULTS")
  const headers = buildHeaders(config)
  return studioPost(url, headers, {
    queryLogActionCode: params.queryLogActionCode ?? 3,
    tempInstanceId: params.taskInstanceId,
    executeLogId: params.executeLogId,
    offset: params.offset,
  })
}

/** ide_admin_server.py:1000-1056 get_instance_statistics */
export async function apiGetInstanceStatistics(
  config: StudioConfig,
  params: {
    projectId: string
    scheduleTaskName?: string
    taskType?: number
    instanceType?: number
    queryStartPlanTime?: number
    queryEndPlanTime?: number
    instanceStatusList?: number[]
    groupId?: number
    taskOwnerId?: number
    executorUserId?: number
    vcCode?: string
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("MCP_INSTANCE_STATISTICS")
  const headers = buildHeaders(config)
  const body: Record<string, unknown> = {
    cycleTaskType: params.taskType,
    scheduleTaskName: params.scheduleTaskName ?? "",
    projectId: params.projectId,
    instanceType: params.instanceType ?? 1,
    queryStartPlanTime: params.queryStartPlanTime,
    queryEndPlanTime: params.queryEndPlanTime,
    instanceStatusList: params.instanceStatusList,
    groupId: params.groupId,
  }
  if (params.taskOwnerId != null) body["taskOwnerId"] = params.taskOwnerId
  if (params.executorUserId != null) body["executorUserId"] = params.executorUserId
  if (params.vcCode != null) body["vcCodes"] = [params.vcCode]
  return studioPost(url, headers, body)
}

/** datasource_server.py:9-39 datasource_list */
export async function apiDatasourceList(
  config: StudioConfig,
  params: {
    dsName?: string
    dsType?: number
    pageIndex?: number
    pageSize?: number
  },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("DATA_SOURCES_LIST")
  const headers = buildHeaders(config)
  return studioPost(url, headers, {
    current: params.pageIndex ?? 1,
    pageSize: params.pageSize ?? 20,
    status: 1,
    pageIndex: params.pageIndex ?? 1,
    dsName: params.dsName,
    dsType: params.dsType,
  })
}

/** datasource_server.py:42-71 get_namespace_list */
export async function apiGetNamespaceList(
  config: StudioConfig,
  datasourceId: number,
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("DATA_SOURCES_LIST_NAMESPACES")
  const headers = buildHeaders(config)
  return studioPost(url, headers, { id: datasourceId })
}

/** datasource_server.py:74-100 get_meta_list */
export async function apiGetMetaList(
  config: StudioConfig,
  params: { datasourceId: number; namespace: string },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("DATA_SOURCES_LIST_DATA_OBJECTS")
  const headers = buildHeaders(config)
  return studioPost(url, headers, { id: params.datasourceId, nameSpace: params.namespace })
}

/** datasource_server.py — get_meta_detail */
export async function apiGetMetaDetail(
  config: StudioConfig,
  params: { datasourceId: number; namespace: string; dataObjectName: string },
): Promise<string> {
  const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("DATA_SOURCES_GET_META_DETAIL")
  const headers = buildHeaders(config)
  return studioPost(url, headers, {
    id: params.datasourceId,
    nameSpace: params.namespace,
    tableName: params.dataObjectName,
  })
}
