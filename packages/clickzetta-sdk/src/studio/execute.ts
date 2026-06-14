import type { StudioConfig } from "../types/index.js"
import { studioRequest } from "./client.js"

export interface VclusterInfo {
  id: string
  name: string
  type: string  // "INTEGRATION" | "ANALYTICS" | "GENERAL"
}

export async function listVclusters(config: StudioConfig): Promise<VclusterInfo[]> {
  const r = await studioRequest(config, "/clickzetta-lakeconsole/api/v1/vcluster/list", {
    instanceId: (config as unknown as Record<string, unknown>).lakeHouseInstanceId ?? (config as unknown as Record<string, unknown>).instanceId,
    workspaceId: config.workspaceId,
  })
  return (r?.data as VclusterInfo[]) ?? []
}

export async function resolveVclusterId(config: StudioConfig, vcName: string): Promise<string | undefined> {
  const list = await listVclusters(config)
  return list.find(v => v.name === vcName || v.id === vcName)?.id
}

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
  adhocVcId: number | string  // string VC name works as ID for Sync VClusters
  dataFileContent: string
  params?: unknown
  datasourceId?: number
  sessionSchemaName?: string
  dsType?: number
  etlVcCode?: string
  etlVcId?: string | number
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
    ...(params.datasourceId != null && { datasourceId: params.datasourceId }),
    ...(params.sessionSchemaName != null && { sessionSchemaName: params.sessionSchemaName }),
    ...(params.dsType != null && { dsType: params.dsType }),
    ...(params.etlVcCode != null && { etlVcCode: params.etlVcCode }),
    ...(params.etlVcId != null && { etlVcId: params.etlVcId }),
  },
    {
      env: "prod",
      workspaceName:config.workspaceName
    })
}
