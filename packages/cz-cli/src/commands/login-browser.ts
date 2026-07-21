import { spawn } from "node:child_process"

import {
  buildOauthLoginParam,
  encodeOauthLoginParam,
  exchangeAuthorizationCode,
  fetchUserInfo,
  generatePkce,
  startLoopbackCallback,
  type AuthToken,
} from "@clickzetta/sdk"

/**
 * Generate a random hex `state` for CSRF protection of the authorize round
 * trip (requirement 10.3/10.6). It is used once for callback validation and is
 * not a secret.
 */
function randomState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Best-effort cross-platform system browser opener (design Addendum 2, step 4).
 * darwin → `open`, win32 → `start ""`, else `xdg-open`. Failures are swallowed:
 * the authorize URL is already printed to the terminal so the user can open it
 * manually while the loopback listener keeps waiting (requirement 10.5).
 */
function openSystemBrowser(url: string): void {
  const isWindows = process.platform === "win32"
  const command = process.platform === "darwin" ? "open" : isWindows ? "start" : "xdg-open"
  // Windows `start` is a shell builtin and treats the first quoted arg as the
  // window title, hence the leading empty string.
  const args = isWindows ? ["", url] : [url]
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true, shell: isWindows })
    child.on("error", () => {})
    child.unref()
  } catch {
    // best-effort: ignore spawn failures, the URL was already printed
  }
}

/**
 * Connection context parsed from the `/oauth2/userinfo` response. Carried back
 * to `runLogin` so it can backfill the persisted token (userId/instanceId) and
 * write the logged-in context (instance/workspace/schema/vcluster/accountName)
 * into the current profile. All fields are optional: userinfo is best-effort.
 */
export interface BrowserLoginResult {
  token: AuthToken
  userInfo?: {
    instanceName?: string
    workspace?: string
    schema?: string
    vcluster?: string
    accountName?: string
    accountId?: number
    userId?: number
    instanceId?: number
    // Surfaced for LLM provisioning: the gateway API key + its base URL. These
    // also live on `raw`, but exposing them here keeps provisioning off the
    // untyped body.
    apiKey?: string
    aimeshEndpointBaseUrl?: string
    // Region-specific business service host (no protocol) derived from the
    // userinfo `gatewayMapping` for the default instance's `cspId-regionId`.
    // This is the address SQL/business calls must use — the region-independent
    // OAuth central host is only for login itself. Undefined when the mapping
    // is absent or has no entry for the instance's region.
    service?: string
    // Account/tenant id used as tenantId for portal calls (listUserWorkspaces).
    // Same value as accountId; surfaced explicitly for the enumeration step.
    tenantId?: number
  }
  // Every instance the account can access, each resolved to its own region
  // service via gatewayMapping[cspId-regionId]. Used to enumerate all
  // (instance × workspace) combinations after login. Empty when userinfo failed.
  instances?: OAuthInstance[]
  // The unmodified `/oauth2/userinfo` body, present only when userinfo
  // succeeded. Archived verbatim into the profile so nothing is discarded.
  raw?: Record<string, unknown>
}

/** One accessible instance with its resolved region service (no protocol). */
export interface OAuthInstance {
  instanceId: number
  instanceName: string
  /** Region business service host (no protocol) from gatewayMapping, or undefined if unresolved. */
  service?: string
}

function isOauthDebug(): boolean {
  const flag = process.env.CZ_OAUTH_DEBUG
  return flag === "1" || flag === "true"
}

function str(val: unknown): string | undefined {
  return typeof val === "string" && val.length > 0 ? val : undefined
}

/**
 * Resolve the region-specific business service host for the default instance.
 *
 * The backend does NOT return a `service` field in userinfo. Instead it returns
 * `gatewayMapping`, a per-account JSON string keyed by `"<cspId>-<regionId>"`
 * whose values are the real region API bases, e.g.
 *   { "1-1": "https://cn-shanghai-alicloud.api.clickzetta.com", ... }
 * Each entry in `instanceList` carries its own `cspId`/`regionId`. We look up
 * the default instance's key to get the exact host to run business calls
 * against. Confirmed against live userinfo for both prod and uat accounts; the
 * same `"1-1"` key maps to different hosts per environment, which is precisely
 * why this must be read from userinfo rather than derived from a static table.
 *
 * Returns the host WITHOUT protocol (to match how profiles store `service`),
 * or undefined when the mapping or the instance's region entry is missing.
 */
function serviceFromGatewayMapping(
  body: Record<string, unknown>,
  instance: Record<string, unknown> | undefined,
): string | undefined {
  if (!instance) return undefined
  const cspId = typeof instance.cspId === "number" ? instance.cspId : undefined
  const regionId = typeof instance.regionId === "number" ? instance.regionId : undefined
  if (cspId === undefined || regionId === undefined) return undefined

  let mapping: Record<string, unknown>
  try {
    const rawMapping = body.gatewayMapping
    if (typeof rawMapping !== "string" || !rawMapping.trim()) return undefined
    mapping = JSON.parse(rawMapping) as Record<string, unknown>
  } catch {
    return undefined
  }

  const url = mapping[`${cspId}-${regionId}`]
  if (typeof url !== "string" || !url.trim()) return undefined
  // Store as a bare host to match profile `service` semantics.
  return url.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

/**
 * Map the raw `/oauth2/userinfo` body to our connection context per the
 * confirmed dev response shape. `userId` falls back to parsing `sub`; both id
 * fields guard against NaN/absent so callers can decide whether to override.
 */
function parseUserInfo(body: Record<string, unknown>): BrowserLoginResult["userInfo"] {
  const userId = typeof body.userId === "number" ? body.userId : parseInt(String(body.sub), 10)
  const instanceList = Array.isArray(body.instanceList) ? (body.instanceList as Array<Record<string, unknown>>) : []
  const firstInstance = instanceList[0]
  const instanceId = firstInstance && typeof firstInstance.id === "number" ? firstInstance.id : 0
  const instanceName = str(body.instanceName) ?? (firstInstance ? str(firstInstance.name) : undefined)

  return {
    instanceName,
    workspace: str(body.workspaceName),
    schema: str(body.schema),
    vcluster: str(body.virtualCluster),
    accountName: str(body.accountName),
    accountId: typeof body.account_id === "number" ? body.account_id : undefined,
    userId: Number.isNaN(userId) ? undefined : userId,
    instanceId,
    apiKey: str(body.apiKey),
    aimeshEndpointBaseUrl: str(body.aimeshEndpointBaseUrl),
    service: serviceFromGatewayMapping(body, firstInstance),
    tenantId: typeof body.account_id === "number" ? body.account_id : undefined,
  }
}

/**
 * Build the full list of accessible instances, each resolved to its own region
 * service via gatewayMapping[cspId-regionId]. Feeds the (instance × workspace)
 * enumeration that generates one profile per combination. An instance whose
 * region has no gatewayMapping entry gets `service: undefined` — the caller
 * skips it (a workspace listing there would hit the wrong gateway).
 */
function parseInstances(body: Record<string, unknown>): OAuthInstance[] {
  const list = Array.isArray(body.instanceList) ? (body.instanceList as Array<Record<string, unknown>>) : []
  return list
    .map((inst): OAuthInstance | undefined => {
      const instanceId = typeof inst.id === "number" ? inst.id : 0
      const instanceName = str(inst.name) ?? ""
      if (!instanceId || !instanceName) return undefined
      return { instanceId, instanceName, service: serviceFromGatewayMapping(body, inst) }
    })
    .filter((x): x is OAuthInstance => x !== undefined)
}

export interface LoginWithBrowserOptions {
  // Service base URL used to exchange the code (toServiceUrl(service, protocol)).
  baseUrl: string
  // Accounts login-site base URL (accountsBaseUrl(service)).
  accountsBaseUrl: string
  // Injectable browser opener; defaults to the system browser. Tests inject a
  // fake that drives the loopback callback.
  openBrowser?: (url: string) => void
  // Optional callback timeout in ms (forwarded to startLoopbackCallback).
  timeoutMs?: number
}

/**
 * Browser loopback OAuth login orchestration (design Addendum 2, component I;
 * requirements 10.1/10.5/10.8/10.10). Callers MUST only invoke this when
 * `isLocalCallbackEnabled()` is true; otherwise the existing default path runs.
 *
 * Flow: generate PKCE + state → start the loopback listener to learn the
 * dynamic `redirect_uri` → build the authorize URL and open the browser (also
 * printing the URL) → wait for the validated `code` on the loopback → exchange
 * the code for tokens using the SAME `redirect_uri` (Property 11). On any
 * failure the listener is closed so it never leaks. Never logs `code_verifier`,
 * the authorization code, or tokens — printing the authorize URL is fine since
 * it only carries `code_challenge` + `state`.
 */
export async function loginWithBrowser(opts: LoginWithBrowserOptions): Promise<BrowserLoginResult> {
  const pkce = generatePkce()
  const state = randomState()
  const cb = await startLoopbackCallback({ expectedState: state, timeoutMs: opts.timeoutMs })

  try {
    const authorizeUrl =
      `${opts.accountsBaseUrl}/login?oauthLoginParam=` +
      encodeURIComponent(
        encodeOauthLoginParam(
          buildOauthLoginParam({ redirectUri: cb.redirectUri, codeChallenge: pkce.codeChallenge, state }),
        ),
      )

    console.log(`Open this URL in your browser to sign in:\n${authorizeUrl}`)
    ;(opts.openBrowser ?? openSystemBrowser)(authorizeUrl)

    const code = await cb.waitForCode()
    const result = await exchangeAuthorizationCode(opts.baseUrl, code, pkce.codeVerifier, cb.redirectUri)

    const token: AuthToken = {
      token: result.accessToken,
      refreshToken: result.refreshToken,
      // expireTimeMs is a DURATION in ms (expires_in * 1000), matching the
      // login.ts OAuth path and token.ts isTokenExpired semantics
      // (elapsed = now - obtainedAt > expireTimeMs * EXPIRED_FACTOR). It must
      // NOT be an absolute timestamp.
      expireTimeMs: result.expiresInMs,
      obtainedAt: Date.now(),
      // Populated below from userinfo when available; default to 0 so legacy
      // consumers and the token store keep working when userinfo is missing.
      instanceId: 0,
      userId: 0,
    }

    // Best-effort userinfo backfill (requirement 11.6/11.7). A userinfo failure
    // must NOT fail the login: keep the token, leave userId/instanceId at 0.
    let userInfo: BrowserLoginResult["userInfo"]
    let instances: OAuthInstance[] | undefined
    let raw: Record<string, unknown> | undefined
    try {
      const body = await fetchUserInfo(opts.baseUrl, result.accessToken)
      raw = body
      const parsed = parseUserInfo(body)
      if (isOauthDebug()) console.error(`[oauth-userinfo] keys=[${Object.keys(parsed ?? {}).join(",")}]`)
      userInfo = parsed
      instances = parseInstances(body)
      // Only override when the parsed identity is a real, positive value.
      if (parsed?.userId !== undefined && parsed.userId > 0) token.userId = parsed.userId
      if (parsed?.instanceId !== undefined && parsed.instanceId > 0) token.instanceId = parsed.instanceId
    } catch (err) {
      if (isOauthDebug()) console.error(`[oauth-userinfo] failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    return { token, userInfo, instances, raw }
  } catch (err) {
    // Ensure the listener never leaks if we fail before/after waitForCode
    // settles. close() is a no-op once the core already settled.
    cb.close()
    throw err
  }
}
