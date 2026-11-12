import * as client from "openid-client"

import { OAUTH_CLIENT_ID, type AuthToken } from "@clickzetta/sdk"

import { isLakehouseServiceId } from "../connection/instance-id.js"
import { msUntilJwtExpiry } from "../connection/jwt.js"

import { oauthBodyError, toInterfaceError } from "./oauth-error.js"

/**
 * Everything both OAuth login flows do that is NOT about how the user proved
 * their identity.
 *
 * `login-browser.ts` (authorization code + loopback) and `login-device.ts`
 * (device authorization grant + QR) differ only in how they obtain an
 * authorization: discovery, the `requestId` header the gateway correlates logs
 * by, the userinfo round trip, and the gatewayMapping → region-service parsing
 * are identical afterwards. They live here so the two flows cannot drift — a
 * second copy of {@link serviceFromGatewayMapping} in particular would be a
 * silent wrong-region bug rather than a visible duplication.
 */

/** One accessible instance with its resolved region service (no protocol). */
export interface OAuthInstance {
  instanceId: number
  instanceName: string
  /** Region business service host (no protocol) from gatewayMapping, or undefined if unresolved. */
  service?: string
}

/**
 * Connection context parsed from the `/oauth2/userinfo` response. Carried back
 * to `runLogin` so it can backfill the persisted token (userId/instanceId) and
 * write the logged-in context (instance/workspace/schema/vcluster/accountName)
 * into the current profile. All fields are optional: userinfo is best-effort.
 */
export interface OAuthLoginResult {
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

export function isOauthDebug(): boolean {
  const flag = process.env.CZ_OAUTH_DEBUG
  return flag === "1" || flag === "true"
}

function str(val: unknown): string | undefined {
  return typeof val === "string" && val.length > 0 ? val : undefined
}

/**
 * Generate the `requestId` header value the gateway logs correlate OAuth calls
 * by (requirement 7.7). Mirrors the SDK's format so gateway-side log queries
 * keep working across both paths. Random hex, no sensitive material.
 */
export function generateRequestId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `tssdk-oauth-${hex}`
}

/**
 * Build the `customFetch` that injects our `requestId` header into every request
 * the library makes. The high-level helpers expose no header option, so this is
 * the only seam — and dropping the header is not an option: gateway log
 * correlation is a real operational dependency.
 */
function fetchWithRequestId(requestId: string): client.CustomFetch {
  return (url, options) =>
    fetch(url, {
      ...options,
      headers: { ...options.headers, requestId },
      // The library's FetchBody admits Uint8Array, which the DOM RequestInit
      // type does not, though fetch accepts it at runtime. Cast the body alone
      // rather than the whole init so the rest stays checked.
      body: options.body as BodyInit | null | undefined,
    })
}

/**
 * RFC 8414 discovery against the login entry host.
 *
 * `algorithm: "oauth2"` selects RFC 8414's /.well-known/oauth-authorization-server.
 * The library defaults to OIDC's /.well-known/openid-configuration, which the
 * server does not serve — this is a live server constraint, not a preference.
 */
export async function discoverOAuthConfig(baseUrl: string, requestId: string): Promise<client.Configuration> {
  return await client
    .discovery(new URL(baseUrl), OAUTH_CLIENT_ID, undefined, undefined, {
      algorithm: "oauth2",
      [client.customFetch]: fetchWithRequestId(requestId),
    })
    .catch((err) => {
      throw toInterfaceError(err, requestId)
    })
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
 * An account's `instanceList` can carry other products' service instances, which
 * this CLI has no way to connect to. The judgement itself lives in
 * {@link isLakehouseServiceId} — shared with instance-id.ts and
 * profile-bootstrap.ts — because picking a non-Lakehouse row resolves not just the
 * wrong instance id but the wrong region gateway: `service` is looked up from that
 * row's own cspId/regionId.
 *
 * setup.ts's `filterLakehouseInstances` deliberately does NOT share it: there the
 * `serviceId === 1` test is the strict first stage of a cascade that falls back to
 * serviceType/productType text, so an absent `serviceId` must fail it and drop
 * through — the opposite of what this helper answers for the same input.
 */
function isLakehouseInstance(instance: Record<string, unknown>): boolean {
  return isLakehouseServiceId(instance.serviceId)
}

/**
 * Map the raw `/oauth2/userinfo` body to our connection context per the
 * confirmed dev response shape. `userId` falls back to parsing `sub`; both id
 * fields guard against NaN/absent so callers can decide whether to override.
 */
export function parseUserInfo(body: Record<string, unknown>): NonNullable<OAuthLoginResult["userInfo"]> {
  const userId = typeof body.userId === "number" ? body.userId : parseInt(String(body.sub), 10)
  const instanceList = Array.isArray(body.instanceList) ? (body.instanceList as Array<Record<string, unknown>>) : []
  // The first LAKEHOUSE instance, not the first instance: see isLakehouseInstance.
  const defaultInstance = instanceList.find(isLakehouseInstance)
  const instanceId = defaultInstance && typeof defaultInstance.id === "number" ? defaultInstance.id : 0
  const instanceName = str(body.instanceName) ?? (defaultInstance ? str(defaultInstance.name) : undefined)

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
    service: serviceFromGatewayMapping(body, defaultInstance),
    tenantId: typeof body.account_id === "number" ? body.account_id : undefined,
  }
}

/**
 * Build the full list of accessible LAKEHOUSE instances, each resolved to its own
 * region service via gatewayMapping[cspId-regionId]. Feeds the (instance ×
 * workspace) enumeration that generates one profile per combination. An instance
 * whose region has no gatewayMapping entry gets `service: undefined` — the caller
 * skips it (a workspace listing there would hit the wrong gateway).
 *
 * Filtered by the same {@link isLakehouseInstance} judgement parseUserInfo uses:
 * the default instance and the enumerated ones have to agree about what this CLI
 * can connect to, or a profile would be generated for a service that cannot serve
 * a workspace listing at all.
 */
export function parseInstances(body: Record<string, unknown>): OAuthInstance[] {
  const list = Array.isArray(body.instanceList) ? (body.instanceList as Array<Record<string, unknown>>) : []
  return list
    .filter(isLakehouseInstance)
    .map((inst): OAuthInstance | undefined => {
      const instanceId = typeof inst.id === "number" ? inst.id : 0
      const instanceName = str(inst.name) ?? ""
      if (!instanceId || !instanceName) return undefined
      return { instanceId, instanceName, service: serviceFromGatewayMapping(body, inst) }
    })
    .filter((x): x is OAuthInstance => x !== undefined)
}

/**
 * GET the discovered `userinfo_endpoint` with the access token and return the raw
 * body.
 *
 * Uses `fetchProtectedResource` rather than the library's `fetchUserInfo`: that
 * one runs `processUserInfoResponse`, which demands a string `sub` and an
 * `expectedSubject` we cannot know before the call. We want the untouched body,
 * since it is archived verbatim onto the profile.
 *
 * A 401 with a WWW-Authenticate header throws out of `fetchProtectedResource`
 * itself (as WWWAuthenticateChallengeError); a body-only error response comes
 * back as a non-ok Response, so both are converted here. Either way the caller
 * treats a userinfo failure as non-fatal (requirement 11.7).
 */
async function fetchUserInfoBody(
  config: client.Configuration,
  userinfoEndpoint: string | undefined,
  accessToken: string,
  requestId: string,
): Promise<Record<string, unknown>> {
  if (!userinfoEndpoint) throw new Error("discovery document has no userinfo_endpoint")

  let res: Response
  try {
    res = await client.fetchProtectedResource(config, accessToken, new URL(userinfoEndpoint), "GET")
  } catch (err) {
    throw toInterfaceError(err, requestId)
  }

  // Narrowed to an object before anything is read off it: `null` parses fine and
  // then every field read — here and inside oauthBodyError — throws a TypeError,
  // which collectUserInfo would swallow as "userinfo failed" with a message about
  // types rather than about the response.
  const parsed: unknown = await res.json().catch(() => undefined)
  const body =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  if (!body) throw new Error(`userinfo answered HTTP ${res.status} with a body that is not a JSON object`)
  if (!res.ok || typeof body.error === "string") throw oauthBodyError(body, res.status, requestId)
  return body
}

/**
 * Convert an `openid-client` token response into our persisted {@link AuthToken}.
 *
 * `expireTimeMs` is a DURATION in ms, paired with `obtainedAt`: the refresh
 * decision is `now - obtainedAt > expireTimeMs * EXPIRED_FACTOR` (0.8) in the
 * SDK's token.ts isTokenExpired, and `auth status` reports the remainder via
 * auth.ts msUntilExpiry. It must NOT be an absolute timestamp — as one it reads
 * as billions of ms of validity and the token is never refreshed until the
 * server rejects it.
 *
 * The duration comes from the access token's own `exp` claim, NOT from
 * `expires_in`: see {@link msUntilJwtExpiry}. `expires_in` is the token's total
 * lifetime measured from the moment the SERVER issued it, and in the device flow
 * we receive the token well after that — 300s later on a real dev-api sign-in,
 * because the user is on the verification page in between. Anchoring the duration
 * at our receipt time spends that offset out of the 0.8 safety margin, leaving
 * the refresh later than intended relative to the server's own deadline. The
 * `exp` claim is that deadline, so use it directly. `expires_in` remains the
 * fallback for an opaque token with no readable claim.
 *
 * `instanceId`/`userId` default to 0 and are backfilled from userinfo by
 * {@link collectUserInfo}; the token store and legacy consumers keep
 * working when userinfo is unavailable.
 */
export function tokenFromResponse(tokens: { access_token: string; refresh_token?: string; expires_in?: number }): AuthToken {
  return {
    token: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expireTimeMs: msUntilJwtExpiry(tokens.access_token)
      ?? (tokens.expires_in !== undefined ? tokens.expires_in * 1000 : 0),
    obtainedAt: Date.now(),
    instanceId: 0,
    userId: 0,
  }
}

/**
 * Best-effort userinfo backfill shared by both login flows (requirement
 * 11.6/11.7).
 *
 * A userinfo failure must NOT fail the login: the token is already minted and
 * usable, so on error this returns empty context and leaves `token.userId` /
 * `token.instanceId` at 0. The caller surfaces the consequences as login
 * warnings rather than as a failure.
 *
 * Mutates `token` in place for the two identity fields, because the persisted
 * token and the reported context must not disagree about who logged in.
 */
export async function collectUserInfo(
  config: client.Configuration,
  userinfoEndpoint: string | undefined,
  token: AuthToken,
  requestId: string,
): Promise<Pick<OAuthLoginResult, "userInfo" | "instances" | "raw">> {
  try {
    const body = await fetchUserInfoBody(config, userinfoEndpoint, token.token, requestId)
    const parsed = parseUserInfo(body)
    if (isOauthDebug()) console.error(`[oauth-userinfo] keys=[${Object.keys(parsed).join(",")}]`)
    // Only override when the parsed identity is a real, positive value.
    if (parsed.userId !== undefined && parsed.userId > 0) token.userId = parsed.userId
    if (parsed.instanceId !== undefined && parsed.instanceId > 0) token.instanceId = parsed.instanceId
    return { userInfo: parsed, instances: parseInstances(body), raw: body }
  } catch (err) {
    if (isOauthDebug()) console.error(`[oauth-userinfo] failed: ${err instanceof Error ? err.message : String(err)}`)
    return {}
  }
}
