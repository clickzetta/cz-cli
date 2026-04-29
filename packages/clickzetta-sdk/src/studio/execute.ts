import type { StudioConfig } from "../types/index.js"
import { studioRequest } from "./client.js"

export interface ExecuteAdhocParams {
  updateBy: string
  dataFileId: number
  collectType: number
  maxRowSize: number
  offsetLine: number
  offsetCol: number
  instanceName: string
  multiDataSource: unknown[]
  adhocVcCode: string
  adhocSchemaName: string
  adhocVcId: number
  dataFileContent: string
  params?: unknown
}

export function executeAdhoc(config: StudioConfig, params: ExecuteAdhocParams) {
  return studioRequest(config, "/ide-admin/v1/adhoc/execute", {
    updateBy: params.updateBy,
    dataFileId: params.dataFileId,
    collectType: params.collectType,
    maxRowSize: params.maxRowSize,
    offsetLine: params.offsetLine,
    offsetCol: params.offsetCol,
    instanceName: params.instanceName,
    multiDataSource: params.multiDataSource,
    adhocVcCode: params.adhocVcCode,
    adhocSchemaName: params.adhocSchemaName,
    adhocVcId: params.adhocVcId,
    dataFileContent: params.dataFileContent,
    params: params.params,
  })
}
