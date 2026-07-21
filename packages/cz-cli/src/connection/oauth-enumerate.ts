import { listUserWorkspaces, toServiceUrl } from "@clickzetta/sdk"
import type { AuthToken } from "@clickzetta/sdk"
import type { OAuthInstance } from "../commands/login-browser.js"

/**
 * One (instance × workspace) connection combination discovered after an OAuth
 * login. Each becomes its own profile entry, all sharing the single OAuth token.
 */
export interface OAuthConnCombo {
  service: string // region business host (no protocol), an attribute of the instance
  instance: string
  instanceId: number
  workspace: string
}

function isOauthDebug(): boolean {
  const flag = process.env.CZ_OAUTH_DEBUG
  return flag === "1" || flag === "true"
}

/**
 * Enumerate every (instance × workspace) combination the account can reach.
 *
 * userinfo only reports the DEFAULT instance's single workspace, so to build
 * the full matrix we call `listUserWorkspaces` once per instance, each against
 * that instance's OWN region service (resolved from gatewayMapping — the OAuth
 * central host does not serve business APIs). Per the agreed design this is a
 * best-effort fan-out: an instance whose region is unresolved or whose workspace
 * listing fails is SKIPPED (its error is swallowed), never aborting the others.
 *
 * Only the connection essentials (service/instance/workspace) are captured.
 * schema/vcluster are deliberately NOT persisted at login: exec only requires
 * instance + workspace, schema/vcluster have runtime defaults and can be
 * overridden per-call with --schema/--vcluster.
 */
export async function enumerateOAuthCombos(input: {
  token: AuthToken
  userId: number
  tenantId: number
  instances: OAuthInstance[]
}): Promise<OAuthConnCombo[]> {
  const { token, userId, tenantId, instances } = input
  const combos: OAuthConnCombo[] = []

  for (const inst of instances) {
    if (!inst.service) {
      if (isOauthDebug()) console.error(`[oauth-enumerate] skip ${inst.instanceName}: no region service`)
      continue
    }
    try {
      const rows = await listUserWorkspaces(
        toServiceUrl(inst.service),
        token.token,
        userId,
        tenantId,
        inst.instanceId,
        inst.instanceName,
      )
      for (const row of rows) {
        const raw = row as unknown as Record<string, unknown>
        const workspace = String(raw.workspaceName ?? raw.showName ?? raw.projectName ?? "").trim()
        if (!workspace) continue
        combos.push({
          service: inst.service,
          instance: inst.instanceName,
          instanceId: inst.instanceId,
          workspace,
        })
      }
    } catch (err) {
      // Best-effort: a failing instance is skipped, the rest still enumerate.
      if (isOauthDebug()) {
        console.error(`[oauth-enumerate] skip ${inst.instanceName}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  return combos
}
