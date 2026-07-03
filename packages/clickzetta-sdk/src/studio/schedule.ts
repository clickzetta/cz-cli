import type { StudioConfig } from "../types/index.js"
import { studioRequest } from "./client.js"

export interface GetScheduleDetailParams {
  scheduleTaskId: number
  projectId: number
}

export interface ListScheduleTasksParams {
  taskType?: string
  taskNameLike?: string
  projectId: number
  pageIndex: number
  pageSize: number
  orderBy?: string
  orderByFields?: string
  groupId?: number
}

export interface GetTaskRelationParams {
  scheduleTaskId: number
  projectId: number
  parentLevel: number
  childLevel: number
}

export interface GetInstanceRelationParams {
  taskInstanceId: number
  projectId: number
  parentLevel: number
  childLevel: number
}

export function getScheduleDetail(config: StudioConfig, params: GetScheduleDetailParams) {
  return studioRequest(
    config,
    "/ide-admin/v1/scheduleTask/getDetail",
    {
      scheduleTaskId: params.scheduleTaskId,
      projectId: params.projectId,
    },
    {
      instanceId: String(config.instanceId),
      env: "prod",
    },
  )
}

export function listScheduleTasks(config: StudioConfig, params: ListScheduleTasksParams) {
  return studioRequest(config, "/ide-admin/v1/scheduleTask/list", {
    taskType: params.taskType,
    taskNameLike: params.taskNameLike,
    projectId: params.projectId,
    pageIndex: params.pageIndex,
    pageSize: params.pageSize,
    scheduleType: 1,
    orderBy: params.orderBy,
    orderByFields: params.orderByFields,
    groupId: params.groupId,
  })
}

export function getTaskRelation(config: StudioConfig, params: GetTaskRelationParams) {
  return studioRequest(config, "/ide-admin/v1/scheduleTask/queryTaskRelation", {
    scheduleTaskId: params.scheduleTaskId,
    projectId: params.projectId,
    parentLevel: params.parentLevel,
    childLevel: params.childLevel,
  })
}

export function getInstanceRelation(config: StudioConfig, params: GetInstanceRelationParams) {
  return studioRequest(config, "/ide-admin/v1/taskInst/queryTaskInstanceRelation", {
    taskInstanceId: params.taskInstanceId,
    projectId: params.projectId,
    parentLevel: params.parentLevel,
    childLevel: params.childLevel,
  })
}

export function getAllDownstream(config: StudioConfig, scheduleTaskId: number, projectId: number) {
  return studioRequest(config, "/ide-admin/v1/scheduleTask/flatAllDownstream", {
    scheduleTaskId,
    projectId,
  })
}

export interface PreviewScheduleInstanceTimesParams {
  cronExpress: string
  scheduleStartTime?: string
  scheduleEndTime?: string
  scheduleEnv?: string
}

export function previewScheduleInstanceTimes(
  config: StudioConfig,
  params: PreviewScheduleInstanceTimesParams,
) {
  return studioRequest(
    config,
    "/ide-admin/v1/dataFileConfiguration/generateInstanceTimeList",
    {
      cron: params.cronExpress,
      scheduleStartTime: params.scheduleStartTime ?? "00:00",
      scheduleEndTime: params.scheduleEndTime ?? "23:59",
    },
    params.scheduleEnv ? { env: params.scheduleEnv } : undefined,
  )
}
