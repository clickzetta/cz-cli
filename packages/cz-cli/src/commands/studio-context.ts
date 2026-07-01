import type { StudioConfig } from "@clickzetta/sdk"
import { getToken, toServiceUrl, getCurrentUser, getWorkspaceByName, detectEnv } from "@clickzetta/sdk"
import { resolveConnectionConfig, type CliArgs } from "../connection/config.js"
import { getCookieToken } from "../connection/cookie-token.js"
import { handledError } from "../output/index.js"

async function resolveInstanceId(baseUrl: string, token: string, tenantId: number, instanceName: string, fallbackId: number, debug?: boolean): Promise<number> {
  try {
    const resp = await fetch(`${baseUrl}/clickzetta-portal/service/serviceInstanceList?accountId=${tenantId}`, {
      headers: { "x-clickzetta-token": token, Accept: "application/json" },
    })
    if (!resp.ok) return fallbackId
    const data = (await resp.json()) as { data?: Array<{ id: number; name: string; serviceId: number }> }
    const match = (data.data ?? []).find((i) => i.name === instanceName && i.serviceId === 1)
    if (debug) process.stderr.write(`[debug] resolveInstanceId: name=${instanceName} matched=${match?.id ?? "none"} fallback=${fallbackId}\n`)
    return match?.id ?? fallbackId
  } catch {
    return fallbackId
  }
}

/**
 * Account/tenant-level context for AIGW admin APIs. Unlike
 * {@link getStudioContext} it skips workspace/project resolution — gateway
 * virtual keys are tenant-scoped and only need tenantId/userId/instanceId.
 */
export interface GatewayContext extends StudioConfig {
  userName: string
}

export interface StudioContext extends StudioConfig {
  userName: string
}

export async function getGatewayContext(args: Partial<CliArgs> & { format?: string; debug?: boolean }): Promise<GatewayContext> {
  const debug = !!args.debug
  const config = resolveConnectionConfig(args)
  const token = await getCookieToken(config) ?? await getToken(config)
  const baseUrl = toServiceUrl(config.service, config.protocol)
  const user = await getCurrentUser(baseUrl, token.token)
  const instanceId = await resolveInstanceId(baseUrl, token.token, user.accountId, config.instance, token.instanceId, debug)
  return {
    token: token.token,
    instanceId,
    workspaceId: 0,
    projectId: 0,
    userId: token.userId,
    tenantId: user.accountId,
    instanceName: config.instance,
    workspaceName: config.workspace ?? "",
    env: detectEnv(config.service),
    baseUrl,
    customHeaders: config.customHeaders,
    debug,
    userName: user.name,
  }
}

export async function getStudioContext(args: Partial<CliArgs> & { format?: string; debug?: boolean }): Promise<StudioContext> {
  const format = args.format ?? "json"
  const debug = !!args.debug
  const config = resolveConnectionConfig(args)
  const token = await getCookieToken(config) ?? await getToken(config)
  const baseUrl = toServiceUrl(config.service, config.protocol)

  const user = await getCurrentUser(baseUrl, token.token)  
  const tenantId = user.accountId

  if (debug) process.stderr.write(`[debug] studio-context: baseUrl=${baseUrl} userId=${token.userId} tenantId=${tenantId} instanceId=${token.instanceId} instance=${config.instance} workspace=${config.workspace}\n`)

  const instanceId = await resolveInstanceId(baseUrl, token.token, tenantId, config.instance, token.instanceId, debug)

  if (!config.workspace) {
    handledError("NO_WORKSPACE", "Workspace is required for studio commands. Use --workspace or set it in your profile.", { format })
  }

  const ws = await getWorkspaceByName(
    baseUrl,
    token.token,
    token.userId,
    tenantId,
    instanceId,
    config.instance,
    config.workspace,
    debug,
  )

  if (!ws) {
    handledError("WORKSPACE_NOT_FOUND", `Workspace '${config.workspace}' not found.`, { format })
  }

  if (!ws.projectId) {
    handledError("PROJECT_NOT_FOUND", `Workspace '${config.workspace}' has no associated project.`, { format })
  }

  return {
    token: token.token,
    instanceId,
    workspaceId: ws.workspaceId,
    projectId: ws.projectId,
    userId: token.userId,
    tenantId,
    instanceName: config.instance,
    workspaceName: config.workspace,
    env: detectEnv(config.service),
    baseUrl,
    customHeaders: config.customHeaders,
    debug,
    userName: user.name,
  }
}
