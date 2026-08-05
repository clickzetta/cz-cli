import type { StudioConfig } from "../types/index.js"
import { studioRequest } from "./client.js"

// Flow endpoints use these extra headers in addition to the standard studioRequest headers
const FLOW_HEADERS = { env: "prod", openApi: "false" }

export interface CreateFlowNodeParams {
  dataFileId: number
  projectId: number
  nodeName: string
  fileType: string
  env: string
  nodeDescription?: string
  dependencyNodeId?: number
  position?: unknown
  content?: unknown
}

export interface BindFlowNodeParams {
  currentFileId: number
  currentNodeId: number
  currentProjectId: number
  dependencyFileId: number
  dependencyNodeId: number
  dependencyProjectId: number
}

export interface UnbindFlowNodeParams {
  depId: number
  fileId: number
}

export interface RemoveFlowNodeParams {
  fileId: number
  nodeId: number
}

export interface ExecuteFlowParams {
  dataFileId: number
  instanceName: string
  updateBy: string
  vcCode: string
  vcId: string
  paramValueList?: unknown[]
  nodeParams?: { id: number; name: string; paramValueList?: unknown[] }[]
}

export interface SubmitFlowParams {
  fileId: number
  projectId: number
  env?: string
  commitMsg?: string
  approvers?: number[]
}

export interface CheckFlowSubmitStatusParams {
  submitTraceId: string
}

export interface ListFlowInstancesParams {
  flowId: number
  flowInstanceId?: number
  flowNodeId?: number
  flowNodeInstanceId?: number
}

export interface SaveFlowNodeContentParams {
  dataFileId: number
  nodeId: number
  dataFileContent: unknown
  projectId: number
  updateBy: string
  instanceName: string
  paramValueList?: unknown[]
  inputParamValueList?: unknown[]
  outputParamValueList?: unknown[]
  vcCode?: string
  vcId?: number | string
  schemaName?: string
}

export interface SaveFlowNodeConfigParams {
  dataFileId: number
  nodeId: number
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
  dataFileOutputListReqs?: unknown[]
  configProperties?: unknown
  taskPriority?: string
  scheduleRateType?: number
  schedule?: unknown[][]
  frequency?: string
  scheduleStartTime?: string
  scheduleEndTime?: string
  isScheduleRateTypeOff?: boolean
  useActiveEndTime?: boolean
  enableAutoMv?: boolean
}

export function getFlowDag(config: StudioConfig, dataFileId: number) {
  return studioRequest(
    config,
    `/ide-admin/v1/flow/getDag?dataFileId=${dataFileId}`,
    {},
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      ...FLOW_HEADERS,
    },
  )
}

export function createFlowNode(config: StudioConfig, params: CreateFlowNodeParams) {
  return studioRequest(
    config,
    "/ide-admin/v1/flow/node/create",
    {
      tenantId: config.tenantId,
      userId: config.userId,
      dataFileId: params.dataFileId,
      projectId: params.projectId,
      nodeName: params.nodeName,
      fileType: params.fileType,
      env: params.env,
      nodeDescription: params.nodeDescription,
      dependencyNodeId: params.dependencyNodeId,
      position: params.position,
      content: params.content,
    },
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      ...FLOW_HEADERS,
    },
  )
}

export function bindFlowNode(config: StudioConfig, params: BindFlowNodeParams) {
  return studioRequest(
    config,
    "/ide-admin/v1/flow/node/bind",
    {
      tenantId: config.tenantId,
      userId: config.userId,
      currentFileId: params.currentFileId,
      currentNodeId: params.currentNodeId,
      currentProjectId: params.currentProjectId,
      dependencyFileId: params.dependencyFileId,
      dependencyNodeId: params.dependencyNodeId,
      dependencyProjectId: params.dependencyProjectId,
    },
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      ...FLOW_HEADERS,
    },
  )
}

export function unbindFlowNode(config: StudioConfig, params: UnbindFlowNodeParams) {
  return studioRequest(
    config,
    "/ide-admin/v1/flow/node/unbind",
    {
      tenantId: config.tenantId,
      userId: config.userId,
      depId: params.depId,
      fileId: params.fileId,
    },
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      ...FLOW_HEADERS,
    },
  )
}

export function removeFlowNode(config: StudioConfig, params: RemoveFlowNodeParams) {
  return studioRequest(
    config,
    "/ide-admin/v1/flow/node/remove",
    {
      tenantId: config.tenantId,
      userId: config.userId,
      fileId: params.fileId,
      nodeId: params.nodeId,
    },
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      ...FLOW_HEADERS,
    },
  )
}

export function getFlowParams(config: StudioConfig, dataFileId: number) {
  return studioRequest(
    config,
    `/ide-admin/v1/flow/list/params?fileId=${dataFileId}`,
    undefined,
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      ...FLOW_HEADERS,
    },
    "GET",
  )
}

export function executeFlow(config: StudioConfig, params: ExecuteFlowParams) {
  const nodeParams = params.nodeParams ?? []
  return studioRequest(
    config,
    "/ide-admin/v1/adhoc/flow/execute",
    {
      sqlVcId: params.vcId,
      sqlVcCode: params.vcCode,
      flowParamValuesDto: {
        id: params.dataFileId,
        paramValueList: params.paramValueList ?? [],
        children: nodeParams,
      },
      useAdHocSchema: true,
      updateBy: params.updateBy,
      dataFileId: params.dataFileId,
      instanceName: params.instanceName,
    },
  )
}

export function submitFlow(config: StudioConfig, params: SubmitFlowParams) {
  return studioRequest(
    config,
    "/ide-admin/v1/flow/submit",
    {
      fileId: params.fileId,
      projectId: params.projectId,
      env: params.env ?? config.env,
      ...(params.commitMsg !== undefined && { commitMsg: params.commitMsg }),
      ...(params.approvers !== undefined && { approvers: params.approvers }),
    },
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      env: config.env,
      openApi: "false",
    },
  )
}

export function checkFlowSubmitStatus(config: StudioConfig, params: CheckFlowSubmitStatusParams) {
  return studioRequest<number>(
    config,
    `/ide-admin/v1/flow/checkSubmitStatus?submitTraceId=${encodeURIComponent(params.submitTraceId)}`,
    {},
    {
      tenantId: String(config.tenantId),
      openApi: "false",
    },
  )
}

export function listFlowInstances(config: StudioConfig, params: ListFlowInstancesParams) {
  return studioRequest(
    config,
    "/ide-admin/v1/flow/inst/listWithExtraInfo",
    {
      tenantId: config.tenantId,
      flowId: params.flowId,
      flowInstanceId: params.flowInstanceId,
      flowNodeId: params.flowNodeId,
      flowNodeInstanceId: params.flowNodeInstanceId,
    },
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      ...FLOW_HEADERS,
    },
  )
}

export function saveFlowNodeContent(config: StudioConfig, params: SaveFlowNodeContentParams) {
  const content =
    typeof params.dataFileContent === "string"
      ? params.dataFileContent
      : JSON.stringify(params.dataFileContent)
  return studioRequest(
    config,
    "/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration",
    {
      dataFileId: params.dataFileId,
      nodeId: params.nodeId,
      dataFileContent: content,
      projectId: params.projectId,
      collectType: 2,
      onlySaveContent: 1,
      updateBy: params.updateBy,
      paramValueList: params.paramValueList ?? [],
      inputParamValueList: params.inputParamValueList ?? null,
      outputParamValueList: params.outputParamValueList ?? null,
      instanceName: params.instanceName,
      adhocConfigs: JSON.stringify({
        multiDataSource: [],
        schema: params.schemaName ?? "public",
        adhocVcCode: params.vcCode ?? "DEFAULT",
        ...(params.vcId !== undefined && { adhocVcId: params.vcId }),
      }),
      extendConfigs: null,
    },
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      ...FLOW_HEADERS,
    },
  )
}

export function getFlowNodeDetail(config: StudioConfig, dataFileId: number, nodeId: number) {
  return studioRequest(
    config,
    "/ide-admin/v1/dataFile/getDetail",
    { id: dataFileId, nodeId, collectType: 2 },
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      ...FLOW_HEADERS,
    },
  )
}

export function saveFlowNodeConfig(config: StudioConfig, params: SaveFlowNodeConfigParams) {
  return studioRequest(
    config,
    "/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration",
    {
      dataFileId: params.dataFileId,
      nodeId: params.nodeId,
      projectId: params.projectId,
      updateBy: params.updateBy,
      instanceName: params.instanceName,
      useFlowConfig: true,
      collectType: 2,
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
      dataFileOutputListReqs: params.dataFileOutputListReqs ?? [],
      configProperties: params.configProperties,
      taskPriority: params.taskPriority ?? "1",
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
    },
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      ...FLOW_HEADERS,
    },
  )
}
