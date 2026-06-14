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
  paramValueList?: unknown[]
  adhocConfigs?: string
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
  selfDependsJob?: number
  activeStartTime?: string
  activeEndTime?: string
  ownerEnName?: string
  ownerCnName?: string
  schemaName?: string
  etlVcCode?: string
  etlVcId?: number | string
  executeTimeout?: number
  executeTimeoutUnit?: string
  dataFileInputListReqs?: unknown[]
  configProperties?: unknown
  taskPriority?: string
  connectionParam?: string
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
  }, {workspaceName:config.workspaceName})
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
      collectType: 0,
      onlySaveContent: 1,
      projectId: params.projectId,
      updateBy: params.updateBy,
      paramValueList: params.paramValueList ?? [],
      instanceName: params.instanceName,
      ...(params.replaceEscapedChars !== undefined && { replace_escaped_chars: params.replaceEscapedChars }),
      ...(params.adhocConfigs !== undefined && { adhocConfigs: params.adhocConfigs }),
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
      rerunProperty: params.rerunProperty ?? "3",
      selfDependsJob: params.selfDependsJob ?? 0,
      ...(params.activeStartTime !== undefined && { activeStartTime: params.activeStartTime }),
      ...(params.activeEndTime !== undefined && { activeEndTime: params.activeEndTime }),
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
      ...(params.connectionParam !== undefined && { connectionParam: params.connectionParam }),
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
    updatedBy: String(config.userId),
  })
}

export function offlineTask(config: StudioConfig, taskId: number, projectId: number) {
  return studioRequest(config, "/ide-admin/v1/scheduleTask/batchDeleteCycleTask", {
    scheduleTasks: [{ entityId: taskId, workspace: config.workspaceName }],
    updatedBy: String(config.userId),
  })
}

export function offlineTaskWithDownstream(config: StudioConfig, taskId: number, projectId: number) {
  return studioRequest(config, "/ide-admin/v1/scheduleTask/offlineTaskWithDownstream", {
    scheduleTaskId: taskId,
    projectId,
  })
}


export interface DeleteTaskParams {
  scheduleTaskId: number
  projectId: number
}

export function deleteTask(config: StudioConfig, params: DeleteTaskParams) {
  return studioRequest(config, "/ide-admin/v1/dataFile/deleteFile", {
    id: params.scheduleTaskId,
    tenantId: config.tenantId,
    updateBy: String(config.userId),
    userId:config.userId
  })
}

export interface GetTaskRunStatsParams {
  projectId: number
  queryPlanTimeLeft?: number | string
  queryPlanTimeRight?: number | string
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

export interface SaveCdcTaskParams {
  dataFileId: number
  projectId: number
  pipelineType: number      // 1=multi-table mirror, 2=multi-table merge, 3=whole-database mirror
  saveMode?: number         // 1=overwrite, 2=append (default), 3=modify
  syncMode?: number         // 1=full+incremental (default), 2=incremental only
  sourceDatasourceList: { datasourceId: number; datasourceType: number; slotName?: string; logicPlugin?: string }[]
  syncObjectList: { schemaName: string; tableName?: string }[]
  targetDatasource: { datasourceId: number; datasourceType: number }
}

export interface CdcStartupPositionConfig {
  datasourceId: number | string
  startupMode: number   // 2=指定时间, 3=指定文件
  startTimestamp?: string   // unix ms string, for startupMode=2
  file?: string             // binlog file, for startupMode=3
  pos?: string              // binlog offset, for startupMode=3
}

export interface CdcTaskStartParams {
  fileId: number
  updateBy: string
  workspace: string
  startupMode?: number          // 0=无状态启动, 1=从上次保存状态恢复, 4=自定义起始位置
  engineType?: number           // 5=default
  snapshotTaskSwitch?: number   // 0=off, 1=on
  snapshotTaskPoolSize?: number // snapshot concurrency (default 1, only when snapshotTaskSwitch=1)
  blacklistStrategy?: number    // 2=default
  config?: CdcStartupPositionConfig[]  // required when startupMode=4
}

export function startCdcTask(config: StudioConfig, params: CdcTaskStartParams) {
  const startupMode = params.startupMode ?? 0
  return studioRequest(config, "/ide-admin/v1/timelyTask/micro/start", {
    fileId: String(params.fileId),
    updateBy: params.updateBy,
    startupMode,
    startupParams: {
      engineType: params.engineType ?? 5,
      startupMode,
      snapshotTaskSwitch: params.snapshotTaskSwitch ?? 0,
      ...(params.snapshotTaskSwitch === 1 && { snapshotTaskPoolSize: params.snapshotTaskPoolSize ?? 1 }),
      blacklistStrategy: params.blacklistStrategy ?? 2,
      ...(params.config && params.config.length > 0 && { config: params.config }),
    },
    workspace: params.workspace,
  })
}

export function stopCdcTask(config: StudioConfig, fileId: number, updateBy: string, workspace: string) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/micro/stop", {
    fileId: String(fileId),
    updateBy,
    workspace,
  })
}

export function getCdcTaskRunStatus(config: StudioConfig, timelyId: number) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/getDetail", {
    timelyId,
  })
}

export interface PgSlotInfo {
  slotName: string
  slotType: string
  active: string
}

export interface PgSlotListItem {
  datasourceId: number
  db: string
  pipelineSlotMetaVos: PgSlotInfo[]
}

export function listPgSlots(config: StudioConfig, datasourceIds: number[]): Promise<{ data: PgSlotListItem[] }> {
  return studioRequest(config, "/ide-admin/v1/timelyTask/pipeline/slotList", {
    datasourceIds,
  })
}

export interface PgPublicationInfo {
  name: string
  owner: string
  allTables: boolean
  publishInsert: boolean
  publishUpdate: boolean
  publishDelete: boolean
  publishTruncate: boolean
  publishViaPartitionRoot: boolean
}

export interface PgPublicationListItem {
  datasourceId: number
  publications: PgPublicationInfo[]
}

export function listPgPublications(config: StudioConfig, datasourceIds: number[]): Promise<{ data: PgPublicationListItem[] }> {
  return studioRequest(config, "/clickzetta-rocket/api/v1/task/pipeline/listPublications", {
    datasourceIds,
  })
}

export function checkCdcTables(config: StudioConfig, pipelineId: number, workspace: string, pipelineType: number, heterogeneous = false) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/pipeline/checkTables", {
    pipelineId,
    workspace,
    heterogeneous,
    pipelineType,
  })
}


export function saveCdcTask(config: StudioConfig, params: SaveCdcTaskParams) {
  return studioRequest(config, "/ide-admin/v1/ai/mcp/saveCdcTask", {
    dataFileId: params.dataFileId,
    pipelineType: params.pipelineType,
    projectId: params.projectId,
    saveMode: params.saveMode ?? 2,
    syncMode: params.syncMode ?? 1,
    sourceDatasourceList: params.sourceDatasourceList,
    syncObjectList: params.syncObjectList,
    targetDatasource: params.targetDatasource,
  }, { workspaceName: config.workspaceName })
}
