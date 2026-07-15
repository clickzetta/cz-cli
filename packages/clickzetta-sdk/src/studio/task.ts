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
  nodeId?: number
  collectType?: number
}

export interface ParseTaskDependencyOutParams {
  projectId: number
  workspaceId: number | string
  schemaName: string
  dataFileContent: string
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
  inputParamValueList?: unknown[]
  outputParamValueList?: unknown[]
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
  dataFileOutputListReqs?: unknown[]
  configProperties?: unknown
  taskPriority?: string
  dependencyTimeout?: number
  dependencyTimeoutUnit?: string
  connectionParam?: string
  dataFileVersion?: number
  scheduleRateType?: number
  schedule?: unknown[][]
  frequency?: string
  scheduleStartTime?: string
  scheduleEndTime?: string
  isScheduleRateTypeOff?: boolean
  useActiveEndTime?: boolean
  enableAutoMv?: boolean
  triggerType?: number
  fileType?: number
  dataFileName?: string
  fileDescription?: string
  useFlowConfig?: boolean
  paramValueList?: unknown[]
}

export interface SubmitTaskParams {
  commitMsg: string
  dataFileId: number
  dataFileVersion?: string
  projectId: number
  updatedBy: string
}

export interface WorkspaceParamInvalidParam {
  paramKey?: string
  reason?: string
}

export interface TaskPreCheckDetail {
  fileId?: number
  fileName?: string
  invalidParams?: WorkspaceParamInvalidParam[]
}

export interface TaskPreCheckParams {
  projectId: number
  fileIds: number[]
}

export interface TaskPreCheckResult {
  pass?: boolean
  details?: TaskPreCheckDetail[]
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
      ...(params.nodeId !== undefined && { nodeId: params.nodeId }),
      ...(params.collectType !== undefined && { collectType: params.collectType }),
    },
  )
}

export function parseTaskDependencyOut(config: StudioConfig, params: ParseTaskDependencyOutParams) {
  return studioRequest(config, "/ide-admin/v1/dataFileConfiguration/parseDataFileDependencyOut", {
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    schemaName: params.schemaName,
    dataFileContent: params.dataFileContent,
    dataFileId: params.dataFileId,
  })
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
      collectType: 1,
      onlySaveContent: 1,
      projectId: params.projectId,
      updateBy: params.updateBy,
      instanceName: params.instanceName,
      ...(params.paramValueList !== undefined && { paramValueList: params.paramValueList }),
      ...(params.inputParamValueList !== undefined && { inputParamValueList: params.inputParamValueList }),
      ...(params.outputParamValueList !== undefined && { outputParamValueList: params.outputParamValueList }),
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
      dataFileOutputListReqs: params.dataFileOutputListReqs ?? [],
      configProperties: params.configProperties,
      taskPriority: params.taskPriority ?? "1",
      ...(params.dependencyTimeout !== undefined && { dependencyTimeout: params.dependencyTimeout }),
      ...(params.dependencyTimeoutUnit !== undefined && { dependencyTimeoutUnit: params.dependencyTimeoutUnit }),
      ...(params.connectionParam !== undefined && { connectionParam: params.connectionParam }),
      ...(params.dataFileVersion !== undefined && { dataFileVersion: params.dataFileVersion }),
      scheduleRateType: params.scheduleRateType ?? 2,
      scheduleType: 1,
      fileCreateType: 1,
      scheduleCreatedType: "2",
      scheduleConfigType: "1",
      ...(params.schedule !== undefined && { schedule: params.schedule }),
      ...(params.frequency !== undefined && { frequency: params.frequency }),
      ...(params.scheduleStartTime !== undefined && { scheduleStartTime: params.scheduleStartTime }),
      ...(params.scheduleEndTime !== undefined && { scheduleEndTime: params.scheduleEndTime }),
      ...(params.isScheduleRateTypeOff !== undefined && { isScheduleRateTypeOff: params.isScheduleRateTypeOff }),
      ...(params.useActiveEndTime !== undefined && { useActiveEndTime: params.useActiveEndTime }),
      ...(params.enableAutoMv !== undefined && { enableAutoMv: params.enableAutoMv }),
      ...(params.triggerType !== undefined && { triggerType: params.triggerType }),
      ...(params.fileType !== undefined && { fileType: params.fileType }),
      ...(params.dataFileName !== undefined && { dataFileName: params.dataFileName }),
      ...(params.fileDescription !== undefined && { fileDescription: params.fileDescription }),
      ...(params.useFlowConfig !== undefined && { useFlowConfig: params.useFlowConfig }),
      ...(params.paramValueList !== undefined && { paramValueList: params.paramValueList }),
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

export function taskPreCheck(config: StudioConfig, params: TaskPreCheckParams) {
  return studioRequest<TaskPreCheckResult>(
    config,
    "/ide-admin/v1/workspaceParams/task/preCheck",
    {
      projectId: params.projectId,
      fileIds: params.fileIds,
    },
  )
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

// REALTIME (type=14) single-table streaming task — different API from MULTI_REALTIME
export function startRealtimeTask(
  config: StudioConfig,
  timelyId: number,
  updateBy: string,
  workspace: string,
  projectId: number,
  startupMode = 0,
) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/startTimelyTask", {
    timelyId,
    updateBy,
    workspace,
    projectId,
    env: "prod",
    startupMode,
  })
}

export function stopRealtimeTask(
  config: StudioConfig,
  timelyId: number,
  updateBy: string,
  workspace: string,
  projectId: number,
) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/stopTimelyTask", {
    timelyId,
    updateBy,
    workspace,
    projectId,
    env: "prod",
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


/** Take a realtime pipeline task offline (back to draft, offlines table mappings).
 *  fileId is sent as a number to match the Studio backend (timelyTask/pipeline/offline). */
export function offlineCdcTask(config: StudioConfig, fileId: number, updateBy: string) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/pipeline/offline", {
    fileId,
    updateBy,
  })
}

/** Normalize a scalar/array of table ids into an int array. */
function normalizeTableIds(value: number | string | (number | string)[]): number[] {
  const arr = Array.isArray(value) ? value : [value]
  return arr.map((v) => Math.trunc(Number(v))).filter((n) => Number.isFinite(n))
}

/** Start incremental sync for specific pipeline tables. Field name: taskIds. */
export function startCdcTables(config: StudioConfig, pipelineId: number, tableIds: number | string | (number | string)[], workspace: string) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/start/table", {
    pipelineId,
    taskIds: normalizeTableIds(tableIds),
    workspace,
  })
}

/** Stop incremental sync for specific pipeline tables. Field name: taskIds. */
export function stopCdcTables(config: StudioConfig, pipelineId: number, tableIds: number | string | (number | string)[], workspace: string) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/stop/table", {
    pipelineId,
    taskIds: normalizeTableIds(tableIds),
    workspace,
  })
}

/** Re-sync (re-snapshot) specific pipeline tables. Field name: tables (per backend RocketTaskWrapper). */
export function resyncCdcTables(config: StudioConfig, pipelineId: number, tableIds: number | string | (number | string)[], workspace: string) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/resync/table", {
    pipelineId,
    tables: normalizeTableIds(tableIds),
    workspace,
  })
}

/** Pause incremental sync for specific tables. Includes sourceTables:[]. Field name: taskIds. */
export function pauseCdcTables(config: StudioConfig, pipelineId: number, tableIds: number | string | (number | string)[], workspace: string) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/pause/cdc", {
    pipelineId,
    taskIds: normalizeTableIds(tableIds),
    sourceTables: [],
    workspace,
  })
}

/** Recover (resume) incremental sync for specific tables. Field name: taskIds. No sourceTables. */
export function recoverCdcTables(config: StudioConfig, pipelineId: number, tableIds: number | string | (number | string)[], workspace: string) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/recover/cdc", {
    pipelineId,
    taskIds: normalizeTableIds(tableIds),
    workspace,
  })
}

export interface ListRealtimeTasksParams {
  projectId: number
  taskNameLike?: string
  taskStatus?: number
  page?: number
  pageSize?: number
}

/** List realtime (CDC) tasks. */
export function listRealtimeTasks(config: StudioConfig, params: ListRealtimeTasksParams) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/list", {
    pageIndex: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
    projectId: params.projectId,
    taskNameLike: params.taskNameLike ?? "",
    ...(params.taskStatus !== undefined && { taskStatus: params.taskStatus }),
  })
}

export interface ListPipelineTablesParams {
  fileId: number
  table?: string
  schema?: string
  page?: number
  pageSize?: number
}

/** List the tables inside a realtime pipeline (returns each table's id for single-table ops). */
export function listPipelineTables(config: StudioConfig, params: ListPipelineTablesParams) {
  return studioRequest(config, "/ide-admin/v1/timelyTask/micro/schedule/list", {
    fileId: params.fileId,
    pageIndex: params.page ?? 1,
    pageSize: params.pageSize ?? 50,
    ...(params.table && { table: params.table }),
    ...(params.schema && { schema: params.schema }),
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
