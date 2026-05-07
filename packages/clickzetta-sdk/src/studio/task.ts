import type { StudioConfig } from "../types/index.js"
import { studioRequest } from "./client.js"

export interface ListTasksParams {
  projectId: number
  page: number
  pageSize: number
  folderId?: number
  fileName?: string
  fileType?: string
}

export interface CreateTaskParams {
  fileType: string
  createdBy: string
  projectId: number
  dataFileName: string
  fileDescription?: string
  dataFolderId: number
  workspaceName?: string
}

export interface GetTaskConfigDetailParams {
  projectId: number
  workspaceId: number
  dataFileId: number
}

export interface SaveTaskContentParams {
  dataFileId: number
  dataFileContent: unknown
  projectId: number
  updateBy: string
  instanceName: string
  replaceEscapedChars?: boolean
}

export interface SaveTaskConfigParams {
  dataFileId: number
  projectId: number
  updateBy: string
  instanceName: string
  cronExpress?: string
  retryCount?: number
  retryIntervalTime?: number
  retryIntervalTimeUnit?: string
  rerunProperty?: string
  selfDependsJob?: boolean
  activeStartTime?: string
  activeEndTime?: string
  ownerEnName?: string
  ownerCnName?: string
  schemaName?: string
  etlVcCode?: string
  etlVcId?: number
  executeTimeout?: number
  executeTimeoutUnit?: string
  dataFileInputListReqs?: unknown[]
  configProperties?: unknown
  taskPriority?: string
}

export interface SubmitTaskParams {
  commitMsg: string
  dataFileId: number
  dataFileVersion?: string
  projectId: number
  updatedBy: string
}

export interface GetTaskDependenciesParams {
  currentId: number
  fileIds: number[]
}

export function listTasks(config: StudioConfig, params: ListTasksParams) {
  const { projectId, page, pageSize, folderId, fileName, fileType } = params
  return studioRequest(config, "/ide-admin/v1/ai/mcp/listFiles", {
    projectId,
    page,
    pageSize,
    ...(folderId !== undefined && { folderId }),
    ...(fileName !== undefined && { fileName }),
    ...(fileType !== undefined && { fileType }),
  })
}

export function createTask(config: StudioConfig, params: CreateTaskParams) {
  const { workspaceName, ...rest } = params
  return studioRequest(
    config,
    "/ide-admin/v1/dataFile/addAndReturnId",
    {
      fileType: rest.fileType,
      createdBy: rest.createdBy,
      projectId: rest.projectId,
      dataFileName: rest.dataFileName,
      fileDescription: rest.fileDescription,
      dataFolderId: rest.dataFolderId,
    },
    workspaceName ? { workspaceName } : undefined,
  )
}

export function getTaskDetail(config: StudioConfig, fileId: number) {
  return studioRequest(config, "/ide-admin/v1/dataFile/getDetail", { id: fileId })
}

export function getTaskConfigDetail(config: StudioConfig, params: GetTaskConfigDetailParams) {
  return studioRequest(
    config,
    "/ide-admin/v1/dataFileConfiguration/getFileConfigurationDetail",
    {
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      dataFileId: params.dataFileId,
    },
  )
}

export function saveTaskContent(config: StudioConfig, params: SaveTaskContentParams) {
  const content =
    typeof params.dataFileContent === "string"
      ? params.dataFileContent
      : JSON.stringify(params.dataFileContent)
  return studioRequest(
    config,
    "/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration",
    {
      dataFileId: params.dataFileId,
      dataFileContent: content,
      onlySaveContent: 1,
      projectId: params.projectId,
      updateBy: params.updateBy,
      paramValueList: [],
      instanceName: params.instanceName,
      ...(params.replaceEscapedChars !== undefined && { replace_escaped_chars: params.replaceEscapedChars }),
    },
  )
}

export function saveTaskConfig(config: StudioConfig, params: SaveTaskConfigParams) {
  return studioRequest(
    config,
    "/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration",
    {
      dataFileId: params.dataFileId,
      projectId: params.projectId,
      updateBy: params.updateBy,
      instanceName: params.instanceName,
      onlySaveContent: 0,
      cronExpress: params.cronExpress,
      retryCount: params.retryCount,
      retryIntervalTime: params.retryIntervalTime,
      retryIntervalTimeUnit: params.retryIntervalTimeUnit,
      rerunProperty: params.rerunProperty,
      selfDependsJob: params.selfDependsJob,
      activeStartTime: params.activeStartTime,
      activeEndTime: params.activeEndTime,
      ownerEnName: params.ownerEnName,
      ownerCnName: params.ownerCnName,
      schemaName: params.schemaName,
      etlVcCode: params.etlVcCode,
      etlVcId: params.etlVcId,
      executeTimeout: params.executeTimeout,
      executeTimeoutUnit: params.executeTimeoutUnit,
      dataFileInputListReqs: params.dataFileInputListReqs,
      dataFileOutputListReqs: [],
      configProperties: params.configProperties,
      taskPriority: params.taskPriority ?? "1",
      scheduleRateType: 2,
      scheduleType: 1,
      fileCreateType: 1,
      scheduleCreatedType: "2",
      scheduleConfigType: "1",
    },
  )
}

export function submitTask(config: StudioConfig, params: SubmitTaskParams) {
  return studioRequest(config, "/ide-admin/v1/dataFile/submit", {
    commitMsg: params.commitMsg,
    dataFileId: params.dataFileId,
    dataFileVersion: params.dataFileVersion,
    projectId: params.projectId,
    updatedBy: params.updatedBy,
  })
}

export function onlineTask(config: StudioConfig, taskId: number, projectId: number) {
  return studioRequest(config, "/ide-admin/v1/scheduleTask/onlineTask", {
    scheduleTaskId: taskId,
    projectId,
  })
}

export function offlineTask(config: StudioConfig, taskId: number, projectId: number) {
  return studioRequest(config, "/ide-admin/v1/scheduleTask/offlineTask", {
    scheduleTaskId: taskId,
    projectId,
  })
}

export function offlineTaskWithDownstream(config: StudioConfig, taskId: number, projectId: number) {
  return studioRequest(config, "/ide-admin/v1/scheduleTask/offlineTaskWithDownstream", {
    scheduleTaskId: taskId,
    projectId,
  })
}

export function getTaskDependencies(config: StudioConfig, params: GetTaskDependenciesParams) {
  return studioRequest(config, "/ide-admin/v1/dataFileConfiguration/queryDependencyDetail", {
    currentId: params.currentId,
    fileIds: params.fileIds,
  })
}

export interface DeleteTaskParams {
  scheduleTaskId: number
  projectId: number
}

export function deleteTask(config: StudioConfig, params: DeleteTaskParams) {
  return studioRequest(config, "/ide-admin/v1/scheduleTask/deleteTask", {
    scheduleTaskId: params.scheduleTaskId,
    projectId: params.projectId,
  })
}

export interface GetTaskRunStatsParams {
  projectId: number
  queryPlanTimeLeft?: string
  queryPlanTimeRight?: string
  taskNameRlike?: string
}

export function getTaskRunStats(config: StudioConfig, params: GetTaskRunStatsParams) {
  return studioRequest(config, "/ide-admin/v1/ai/mcp/task/statistic", {
    projectId: params.projectId,
    ...(params.queryPlanTimeLeft !== undefined && { queryPlanTimeLeft: params.queryPlanTimeLeft }),
    ...(params.queryPlanTimeRight !== undefined && { queryPlanTimeRight: params.queryPlanTimeRight }),
    ...(params.taskNameRlike !== undefined && { taskNameRlike: params.taskNameRlike }),
  })
}
