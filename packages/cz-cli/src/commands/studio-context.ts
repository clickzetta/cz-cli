import type { StudioConfig } from "@clickzetta/sdk"
import { toServiceUrl, getCurrentUser, getWorkspaceByName, detectEnv } from "@clickzetta/sdk"
import { resolveConnectionConfig, type CliArgs } from "../connection/config.js"
import { readAgentProfile } from "../connection/profile-store.js"
import { profileTokenSource, verbatimTokenSource } from "../connection/token-source.js"
import { resolveInstanceIdByName } from "../connection/instance-id.js"
import { handledError } from "../output/index.js"

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
  const tokens = profileTokenSource(config)
  const baseUrl = toServiceUrl(config.service, config.protocol)
  const user = await getCurrentUser(baseUrl, { tokens, customHeaders: config.customHeaders })
  const credential = await tokens.get()
  const instanceId = await resolveInstanceIdByName(baseUrl, tokens, user.accountId, config.instance, {
    customHeaders: config.customHeaders,
    // The connection's own id first: it is the authoritative one now (see
    // ConnectionConfig.instanceId), and for an OAuth profile the credential's is 0 —
    // `[oauth.<id>]` no longer stores one, so it cannot be a fallback for anything.
    fallbackId: config.instanceId ?? credential.instanceId,
    debug,
  })
  return {
    tokens,
    instanceId,
    workspaceId: 0,
    projectId: 0,
    userId: credential.userId,
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

export interface StudioContextOptions {
  /**
   * When true, a missing workspace (empty listUserWorkspaces / name not found)
   * is non-fatal: workspaceId/projectId fall back to 0 instead of erroring.
   * Used by tenant-scoped features (e.g. Analytics Agent) whose resources are
   * not gated on Studio workspace membership.
   */
  allowMissingWorkspace?: boolean
}

export async function getStudioContext(
  args: Partial<CliArgs> & { format?: string; debug?: boolean },
  opts: StudioContextOptions = {},
): Promise<StudioContext> {
  const format = args.format ?? "json"
  const debug = !!args.debug
  const config = resolveConnectionConfig(args)
  const tokens = profileTokenSource(config)
  const baseUrl = toServiceUrl(config.service, config.protocol)

  const user = await getCurrentUser(baseUrl, { tokens, customHeaders: config.customHeaders })
  const credential = await tokens.get()
  const tenantId = user.accountId

  if (debug) process.stderr.write(`[debug] studio-context: baseUrl=${baseUrl} userId=${credential.userId} tenantId=${tenantId} instanceId=${credential.instanceId} instance=${config.instance} workspace=${config.workspace}\n`)

  const instanceId = await resolveInstanceIdByName(baseUrl, tokens, tenantId, config.instance, {
    customHeaders: config.customHeaders,
    // The connection's own id first: it is the authoritative one now (see
    // ConnectionConfig.instanceId), and for an OAuth profile the credential's is 0 —
    // `[oauth.<id>]` no longer stores one, so it cannot be a fallback for anything.
    fallbackId: config.instanceId ?? credential.instanceId,
    debug,
  })

  if (!config.workspace && !opts.allowMissingWorkspace) {
    handledError("NO_WORKSPACE", "Workspace is required for studio commands. Use --workspace or set it in your profile.", { format })
  }

  const ws = config.workspace
    ? await getWorkspaceByName(
        baseUrl,
        credential.userId,
        tenantId,
        instanceId,
        config.instance,
        config.workspace,
        { tokens, debug, customHeaders: config.customHeaders },
      )
    : undefined

  if (!ws && !opts.allowMissingWorkspace) {
    handledError("WORKSPACE_NOT_FOUND", `Workspace '${config.workspace}' not found.`, { format })
  }

  if (ws && !ws.projectId && !opts.allowMissingWorkspace) {
    handledError("PROJECT_NOT_FOUND", `Workspace '${config.workspace}' has no associated project.`, { format })
  }

  if (!ws && debug) process.stderr.write(`[debug] studio-context: workspace '${config.workspace}' unresolved, falling back to workspaceId=0 projectId=0 (allowMissingWorkspace)\n`)

  return {
    tokens,
    instanceId,
    workspaceId: ws?.workspaceId ?? 0,
    projectId: ws?.projectId ?? 0,
    userId: credential.userId,
    tenantId,
    instanceName: config.instance,
    workspaceName: config.workspace ?? "",
    env: detectEnv(config.service),
    baseUrl,
    customHeaders: config.customHeaders,
    debug,
    userName: user.name,
  }
}

/** Build a StudioContext from a profile's [agent] token block, if present. Lets a
 *  profile carry a dedicated analytics-agent identity (token + tenant/user id) that
 *  authenticates without the main-login workspace lookup. Returns undefined when the
 *  profile has no usable [agent] block, so callers fall back to getStudioContext.
 *  Ported from origin/main — dropped during the a2 rebase. */
export function getProfileAgentContext(args: Partial<CliArgs> & { format?: string; debug?: boolean }): StudioContext | undefined {
  const profileName = typeof args.profile === "string" ? args.profile : undefined
  const agent = readAgentProfile(profileName)
  if (!agent?.token || agent.tenantId === undefined || agent.userId === undefined) return undefined
  const config = resolveConnectionConfig(args)
  return {
    // The [agent] block's token is its OWN identity, unrelated to the profile's
    // OAuth login: rotating that login would not replace this token, so this
    // source reports "cannot rotate" and callers wanting recovery re-resolve
    // via getStudioContext (analytics-agent.ts).
    tokens: verbatimTokenSource(agent.token, { instanceId: agent.instanceId, userId: agent.userId }),
    instanceId: agent.instanceId ?? 0,
    workspaceId: 0,
    projectId: 0,
    userId: agent.userId,
    tenantId: agent.tenantId,
    instanceName: config.instance,
    workspaceName: config.workspace ?? "",
    env: detectEnv(config.service),
    baseUrl: toServiceUrl(config.service, config.protocol),
    customHeaders: config.customHeaders,
    debug: !!args.debug,
    userName: "profile-agent",
  }
}
