import { request, type ClientOptions } from "../client.js"
import type { CallAuth } from "../auth/user.js"
import { ClickZettaApiError } from "../types/api.js"

export interface WorkspaceInfo {
  workspaceId: number
  workspaceName: string
  projectId: number
}

/**
 * `customHeaders` carries the profile's own headers (notably `Cookie`) so
 * cookie-authenticated deployments accept this call. It is spread first: the
 * identity headers resolved by the caller always win over profile values.
 */
export async function listUserWorkspaces(
  baseUrl: string,
  userId: number,
  tenantId: number,
  instanceId: number,
  instanceName: string,
  auth: CallAuth & { debug?: boolean },
): Promise<WorkspaceInfo[]> {
  const { debug, customHeaders } = auth
  const opts: ClientOptions = {
    baseUrl,
    tokens: auth.tokens,
    customHeaders: {
      ...customHeaders,
      instanceid: String(instanceId),
      instancename: instanceName,
      userId: String(userId),
      accountId: String(tenantId),
      tenantId: String(tenantId),
      env: "prod",
    },
  }
  const body = {
    forWrite: "true",
    listType: 4,
    pageIndex: 1,
    pageSize: 99999,
    tenantId,
    userId,
  }
  if (debug) process.stderr.write(`[debug] listUserWorkspaces: POST ${baseUrl}/ide-authority/v1/workspace/listUserWorkspaces body=${JSON.stringify(body)} headers=${JSON.stringify(opts.customHeaders)}\n`)
  const resp = await request<WorkspaceInfo[]>(
    opts,
    "/ide-authority/v1/workspace/listUserWorkspaces",
    body,
  )
  if (debug) process.stderr.write(`[debug] listUserWorkspaces: code=${resp.code} count=${(resp.data ?? []).length} data=${JSON.stringify(resp.data ?? []).slice(0, 200)}\n`)

  if (resp.code !== 0 && resp.code !== "0" && resp.code !== 200 && resp.code !== "200") {
    throw new ClickZettaApiError(String(resp.code), resp.message ?? "Failed to list workspaces")
  }
  return resp.data ?? []
}

export async function getWorkspaceByName(
  baseUrl: string,
  userId: number,
  tenantId: number,
  instanceId: number,
  instanceName: string,
  workspaceName: string,
  auth: CallAuth & { debug?: boolean },
): Promise<WorkspaceInfo | undefined> {
  const all = await listUserWorkspaces(
    baseUrl,
    userId,
    tenantId,
    instanceId,
    instanceName,
    auth,
  )
  return all.find((w) => {
    const raw = w as unknown as Record<string, unknown>
    return w.workspaceName === workspaceName
      || raw.projectName === workspaceName
      || raw.showName === workspaceName
  })
}
