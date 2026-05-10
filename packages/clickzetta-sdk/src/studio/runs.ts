import type { StudioConfig } from "../types/index.js"
import { studioRequest } from "./client.js"

export interface ListRunsParams {
  cycleTaskType?: string
  taskNameLike?: string
  scheduleTaskId?: number
  projectId: number
  pageIndex: number
  pageSize: number
  instanceType?: string
  orderByFields?: string
  orderBy?: string
  queryStartPlanTime?: number | string
  queryEndPlanTime?: number | string
  instanceStatusList?: string[]
  groupId?: number
}

export interface GetRunDetailParams {
  projectId?: number
  scheduleTaskId?: number
}

export interface CreateBackfillParams {
  [key: string]: unknown
}

export interface ListBackfillTasksParams {
  taskNameLike?: string
  projectId: number
  pageIndex: number
  pageSize: number
  runStatus?: string
  complementUserName?: string
  bizStartDate?: string
  bizEndDate?: string
}

export function listRuns(config: StudioConfig, params: ListRunsParams) {
  return studioRequest(
    config,
    "/ide-admin/v1/taskInst/list",
    {
      cycleTaskType: params.cycleTaskType,
      taskNameLike: params.taskNameLike,
      scheduleTaskId: params.scheduleTaskId,
      projectId: params.projectId,
      pageIndex: params.pageIndex,
      pageSize: params.pageSize,
      instanceType: params.instanceType,
      orderByFields: params.orderByFields,
      orderBy: params.orderBy,
      queryStartPlanTime: params.queryStartPlanTime,
      queryEndPlanTime: params.queryEndPlanTime,
      instanceStatusList: params.instanceStatusList,
      groupId: params.groupId,
    },
    { env: "prod" },
  )
}

export function getRunDetail(
  config: StudioConfig,
  taskInstanceId: number,
  params?: GetRunDetailParams,
) {
  return studioRequest(config, "/ide-admin/v1/taskInst/getDetail", {
    taskInstanceId,
    projectId: params?.projectId,
    scheduleTaskId: params?.scheduleTaskId,
  })
}

export function stopRun(config: StudioConfig, taskInstanceId: number) {
  return studioRequest(config, "/ide-admin/v1/taskInst/stopTaskInstance", {
    taskInstanceId,
  })
}

export function rerunInstance(config: StudioConfig, taskInstanceId: number) {
  return studioRequest(config, "/ide-admin/v1/taskInst/reRunTaskInstance", {
    taskInstanceId,
  })
}

export function createBackfill(config: StudioConfig, params: CreateBackfillParams) {
  return studioRequest(config, "/ide-admin/v1/complementTask/createComplementJob", params)
}

export function listBackfillTasks(config: StudioConfig, params: ListBackfillTasksParams) {
  return studioRequest(config, "/ide-admin/v1/complementTask/list", {
    taskNameLike: params.taskNameLike,
    projectId: params.projectId,
    pageIndex: params.pageIndex,
    pageSize: params.pageSize,
    runStatus: params.runStatus,
    complementUserName: params.complementUserName,
    bizStartDate: params.bizStartDate,
    bizEndDate: params.bizEndDate,
  })
}

export function getRunContent(config: StudioConfig, taskInstanceId: number) {
  return studioRequest(config, "/ide-admin/v1/taskInst/getTaskInstanceContent", {
    taskInstanceId,
  })
}
