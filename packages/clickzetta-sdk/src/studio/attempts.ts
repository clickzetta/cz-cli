import type { StudioConfig } from "../types/index.js"
import { studioRequest } from "./client.js"

export interface ListAttemptsParams {
  taskInstanceId: number
  projectId: number
  pageIndex: number
  pageSize: number
}

export interface GetAttemptLogParams {
  queryLogActionCode: string
  taskInstanceId: number
  executeLogId: number
  offset?: number
}

export function listAttempts(config: StudioConfig, params: ListAttemptsParams) {
  return studioRequest(config, "/ide-admin/v1/taskInst/execute/logs", {
    taskInstanceId: params.taskInstanceId,
    projectId: params.projectId,
    pageIndex: params.pageIndex,
    pageSize: params.pageSize,
  })
}

export function getAttemptLog(config: StudioConfig, params: GetAttemptLogParams) {
  const body: Record<string, unknown> = {
    queryLogActionCode: params.queryLogActionCode,
    tempInstanceId: params.taskInstanceId,
    executeLogId: params.executeLogId,
  }
  if (params.offset != null) body.offset = params.offset
  return studioRequest(config, "/ide-admin/v1/adhoc/queryTempLogResults", body)
}
