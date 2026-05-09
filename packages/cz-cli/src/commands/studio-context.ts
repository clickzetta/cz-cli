import type { StudioConfig } from "@clickzetta/sdk"
import { getToken, toServiceUrl, getCurrentUser, getWorkspaceByName, detectEnv } from "@clickzetta/sdk"
import { resolveConnectionConfig, type CliArgs } from "../connection/config.js"
import { error } from "../output/index.js"

export async function getStudioContext(args: Partial<CliArgs> & { output?: string }): Promise<StudioConfig> {
  const format = args.output ?? "json"
  const config = resolveConnectionConfig(args)
  const token = await getToken(config)
  const baseUrl = toServiceUrl(config.service, config.protocol)

  const user = await getCurrentUser(baseUrl, token.token)  
  const tenantId = user.accountId

  if (!config.workspace) {
    error("NO_WORKSPACE", "Workspace is required for studio commands. Use --workspace or set it in your profile.", { format })
  }

  const ws = await getWorkspaceByName(
    baseUrl,
    token.token,
    token.userId,
    tenantId,
    token.instanceId,
    config.instance,
    config.workspace,
  )

  if (!ws) {
    error("WORKSPACE_NOT_FOUND", `Workspace '${config.workspace}' not found.`, { format })
    return undefined as never
  }

  if (!ws.projectId) {
    error("PROJECT_NOT_FOUND", `Workspace '${config.workspace}' has no associated project.`, { format })
    return undefined as never
  }

  return {
    token: token.token,
    instanceId: token.instanceId,
    workspaceId: ws.workspaceId,
    projectId: ws.projectId,
    userId: token.userId,
    tenantId,
    instanceName: config.instance,
    workspaceName: config.workspace,
    env: detectEnv(config.service),
    baseUrl,
    customHeaders: config.customHeaders,
  }
}
