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
  offset: number
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
  return studioRequest(config, "/ide-admin/v1/adhoc/queryTempLogResults", {
    queryLogActionCode: params.queryLogActionCode,
    tempInstanceId: params.taskInstanceId,
    executeLogId: params.executeLogId,
    offset: params.offset,
  })
}
