import type { StudioConfig } from "../types/index.js"
import { studioRequest } from "./client.js"

export interface ListWorkspaceParamsParams {
  projectId: number
  pageIndex?: number
  pageSize?: number
}

export interface AddWorkspaceParamParams {
  projectId: number
  paramKey: string
  paramValue: string
  sourceType?: number
  encrypt?: number
}

export interface UpdateWorkspaceParamParams extends AddWorkspaceParamParams {
  id: number
}

export interface WorkspaceParamByIdParams {
  projectId: number
  id: number
}

export function listWorkspaceParams(config: StudioConfig, params: ListWorkspaceParamsParams) {
  return studioRequest(config, "/ide-admin/v1/workspaceParams/list", {
    projectId: params.projectId,
    pageIndex: params.pageIndex ?? 1,
    pageSize: params.pageSize ?? 10,
  })
}

export function addWorkspaceParam(config: StudioConfig, params: AddWorkspaceParamParams) {
  return studioRequest(config, "/ide-admin/v1/workspaceParams/add", {
    projectId: params.projectId,
    paramKey: params.paramKey,
    paramValue: params.paramValue,
    sourceType: params.sourceType ?? 0,
    encrypt: params.encrypt ?? 0,
  })
}

export function updateWorkspaceParam(config: StudioConfig, params: UpdateWorkspaceParamParams) {
  return studioRequest(config, "/ide-admin/v1/workspaceParams/update", {
    projectId: params.projectId,
    id: params.id,
    paramKey: params.paramKey,
    paramValue: params.paramValue,
    sourceType: params.sourceType ?? 0,
    encrypt: params.encrypt ?? 0,
  })
}

export function enableWorkspaceParam(config: StudioConfig, params: WorkspaceParamByIdParams) {
  return studioRequest(config, "/ide-admin/v1/workspaceParams/publish", {
    projectId: params.projectId,
    id: params.id,
  })
}

export function disableWorkspaceParam(config: StudioConfig, params: WorkspaceParamByIdParams) {
  return studioRequest(config, "/ide-admin/v1/workspaceParams/offline", {
    projectId: params.projectId,
    paramIds: [params.id],
  })
}

export function deleteWorkspaceParam(config: StudioConfig, params: WorkspaceParamByIdParams) {
  return studioRequest(config, "/ide-admin/v1/workspaceParams/delete", {
    projectId: params.projectId,
    paramIds: [params.id],
  })
}
