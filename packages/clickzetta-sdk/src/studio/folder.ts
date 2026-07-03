import type { StudioConfig } from "../types/index.js"
import { studioRequest } from "./client.js"

export interface ListFoldersParams {
  projectId: number
  page: number
  pageSize: number
  parentFolderId?: number
  folderName?: string
  folderType?: string
}

export interface CreateFolderParams {
  createdBy: string
  projectId: number
  dataFolderName: string
  parentFolderId: number
}

export function listFolders(config: StudioConfig, params: ListFoldersParams) {
  return studioRequest(config, "/ide-admin/v1/ai/mcp/listFolders", {
    projectId: params.projectId,
    page: params.page,
    pageSize: params.pageSize,
    ...(params.parentFolderId !== undefined && { parentFolderId: params.parentFolderId }),
    ...(params.folderName !== undefined && { folderName: params.folderName }),
    ...(params.folderType !== undefined && { folderType: params.folderType }),
  },{workspaceName:config.workspaceName})
}

export function createFolder(config: StudioConfig, params: CreateFolderParams) {
  return studioRequest(config, "/ide-admin/v1/dataFolder/add", {
    createdBy: params.createdBy,
    projectId: params.projectId,
    dataFolderName: params.dataFolderName,
    parentFolderId: params.parentFolderId,
    dataFolderType: 1,
  },
  { workspaceName: config.workspaceName }
  )
}

export interface DeleteFolderParams {
  folderId: number
  projectId: number
}

export function deleteFolder(config: StudioConfig, params: DeleteFolderParams) {
  return studioRequest(config, "/ide-admin/v1/dataFolder/delete", {
    id: params.folderId,
    tenantId: config.tenantId,
    projectId: params.projectId,
    updateBy:String(config.userId),
    env: 'prod'
  },{ workspaceName: config.workspaceName})
}
