import { request, type ClientOptions } from "../client.js"

export interface WorkspaceInfo {
  workspaceId: number
  workspaceName: string
  projectId: number
}

export async function listUserWorkspaces(
  baseUrl: string,
  token: string,
  userId: number,
  tenantId: number,
  instanceId: number,
  instanceName: string,
): Promise<WorkspaceInfo[]> {
  const opts: ClientOptions = {
    baseUrl,
    token,
    customHeaders: {
      instanceId: String(instanceId),
      userId: String(userId),
      accountId: String(tenantId),
      instanceName,
      tenantId: String(tenantId),
    },
  }
  const resp = await request<WorkspaceInfo[]>(
    opts,
    "/ide-authority/v1/workspace/listUserWorkspaces",
    {
      forWrite: "true",
      listType: 4,
      pageIndex: 1,
      pageSize: 99999,
      tenantId,
      userId,
    },
  )
  return resp.data ?? []
}

export async function getWorkspaceByName(
  baseUrl: string,
  token: string,
  userId: number,
  tenantId: number,
  instanceId: number,
  instanceName: string,
  workspaceName: string,
): Promise<WorkspaceInfo | undefined> {
  const all = await listUserWorkspaces(
    baseUrl,
    token,
    userId,
    tenantId,
    instanceId,
    instanceName,
  )
  return all.find((w) => w.workspaceName === workspaceName)
}
