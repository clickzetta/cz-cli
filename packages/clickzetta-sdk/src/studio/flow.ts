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

export interface SubmitFlowParams {
  fileId: number
  projectId: number
  env: string
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
  configProperties?: unknown
  taskPriority?: string
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

export function submitFlow(config: StudioConfig, params: SubmitFlowParams) {
  return studioRequest(
    config,
    "/ide-admin/v1/flow/submit",
    {
      fileId: params.fileId,
      projectId: params.projectId,
      env: params.env,
    },
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      ...FLOW_HEADERS,
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
      paramValueList: [],
      inputParamValueList: null,
      outputParamValueList: null,
      instanceName: params.instanceName,
      adhocConfigs: JSON.stringify({
        multiDataSource: [],
        schema: "public",
        adhocVcCode: "DEFAULT",
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
      dataFileOutputListReqs: [],
      configProperties: params.configProperties,
      taskPriority: params.taskPriority ?? "1",
      scheduleRateType: 2,
      scheduleType: 1,
      fileCreateType: 1,
      scheduleCreatedType: "2",
      scheduleConfigType: "1",
    },
    {
      tenantId: String(config.tenantId),
      userId: String(config.userId),
      ...FLOW_HEADERS,
    },
  )
}
