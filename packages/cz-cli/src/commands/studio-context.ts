import type { StudioConfig } from "@clickzetta/sdk"
import { getWorkspaceByName, detectEnv, toServiceUrl } from "@clickzetta/sdk"
import { resolveConnectionConfig, type CliArgs } from "../connection/config.js"
import { readAgentProfile } from "../connection/profile-store.js"
import { verbatimTokenSource } from "../connection/token-source.js"
import { connectionContext } from "../connection/context.js"
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
  // One chain for instance/user/tenant, shared with getExecContext and getStudioContext —
  // this used to resolve the instance id itself and take whatever came back, which for an
  // OAuth profile was 0 (see connection/context.ts). The DISPLAY name stays a caller
  // concern: the chain answers with ids, which are what the wire carries, and profiles.toml
  // caches them — so once cached this is the only getCurrentUser call on the path.
  const ctx = await connectionContext(args)
  const config = ctx.config()
  const tokens = ctx.tokens()
  const baseUrl = ctx.baseUrl()
  const { userId, tenantId } = await ctx.identity()
  return {
    tokens,
    instanceId: ctx.instanceId(),
    workspaceId: 0,
    projectId: 0,
    userId,
    tenantId,
    instanceName: config.instance,
    workspaceName: config.workspace ?? "",
    env: detectEnv(config.service),
    baseUrl,
    customHeaders: config.customHeaders,
    debug,
    userName: await ctx.userName(),
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
  // Same chain as getGatewayContext and getExecContext; see connection/context.ts.
  const ctx = await connectionContext(args)
  const config = ctx.config()
  const tokens = ctx.tokens()
  const baseUrl = ctx.baseUrl()
  const { userId, tenantId } = await ctx.identity()
  const instanceId = ctx.instanceId()

  if (debug) process.stderr.write(`[debug] studio-context: baseUrl=${baseUrl} userId=${userId} tenantId=${tenantId} instanceId=${instanceId} instance=${config.instance} workspace=${config.workspace}\n`)

  if (!config.workspace && !opts.allowMissingWorkspace) {
    handledError("NO_WORKSPACE", "Workspace is required for studio commands. Use --workspace or set it in your profile.", { format })
  }

  const ws = config.workspace
    ? await getWorkspaceByName(
        baseUrl,
        userId,
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
    userId,
    tenantId,
    instanceName: config.instance,
    workspaceName: config.workspace ?? "",
    env: detectEnv(config.service),
    baseUrl,
    customHeaders: config.customHeaders,
    debug,
    userName: await ctx.userName(),
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
  // An [agent] block with no instance_id is not usable, and joins the same guard rather than
  // becoming instance 0: this block bypasses the profile chain (its token is its own
  // identity), so there is no source to resolve one from. Reported as "no usable block" —
  // never as a throw — because callers treat undefined as "fall back to getStudioContext",
  // and an expired or half-written block must not take the fallback down with it.
  if (!agent?.token || agent.tenantId === undefined || agent.userId === undefined || !agent.instanceId) {
    return undefined
  }
  const config = resolveConnectionConfig(args)
  return {
    // The [agent] block's token is its OWN identity, unrelated to the profile's
    // OAuth login: rotating that login would not replace this token, so this
    // source reports "cannot rotate" and callers wanting recovery re-resolve
    // via getStudioContext (analytics-agent.ts).
    tokens: verbatimTokenSource(agent.token, { instanceId: agent.instanceId, userId: agent.userId }),
    // Guaranteed by the guard above, so no `?? 0` here.
    instanceId: agent.instanceId,
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
