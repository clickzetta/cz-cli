import type { AuthToken, ConnectionConfig, Credential, TokenSource } from "../types/index.js"
import { loginWithPat, loginWithPassword } from "./login.js"
import { refreshAccessToken } from "./oauth.js"
import { toServiceUrl } from "../config/region.js"
import { ClickZettaError, InterfaceError } from "../types/errors.js"

const EXPIRED_FACTOR = 0.8

// In-memory token cache, keyed by cacheKey(config). A Map (not a single slot)
// so distinct profiles/instances never evict or shadow each other.
const cache = new Map<string, AuthToken>()
/**
 * In-flight fetches, keyed by cacheKey(config). When multiple callers race for
 * the SAME key we coalesce them onto one login call (matches the Python
 * connector's mutex). Keying by cacheKey — not a single module global — stops a
 * concurrent fetch for profile A from handing A's token to a caller for
 * profile B (which has a different config/store/refresh token).
 */
const pendingFetches = new Map<string, Promise<AuthToken>>()

export function isTokenExpired(token: AuthToken): boolean {
  if (!token.expireTimeMs || token.expireTimeMs === 0) return false
  const elapsed = Date.now() - token.obtainedAt
  return elapsed > token.expireTimeMs * EXPIRED_FACTOR
}

// Cache identity for a config. OAuth logins carry no pat/username, so the
// legacy `instance:pat|username` key collapses to `instance:` and collides
// across distinct OAuth logins on the same instance. cz-cli supplies an
// explicit `cacheKey` (the profile's [oauth.<id>] pointer) to disambiguate;
// PAT/password configs keep the legacy key.
function cacheKey(config: ConnectionConfig): string {
  if (config.cacheKey) return `oauth:${config.cacheKey}`
  return `${config.instance}:${config.pat || config.username}`
}

/** True when the config has NO credentials to perform a fresh portal login
 *  (pure OAuth profile). Such a profile can only refresh via its refresh token;
 *  when that fails the only recovery is an interactive `cz-cli auth login`. */
function hasLoginCredentials(config: ConnectionConfig): boolean {
  return Boolean(config.pat || (config.username && config.password))
}

async function fetchToken(config: ConnectionConfig): Promise<AuthToken> {
  const baseUrl = toServiceUrl(config.service, config.protocol)
  return config.pat
    ? await loginWithPat(baseUrl, config.pat, config.instance)
    : await loginWithPassword(
        baseUrl,
        config.username,
        config.password,
        config.instance,
      )
}

/** OAuth `error` codes that mean the refresh token itself is dead — retrying or
 *  re-fetching won't help; only an interactive re-login recovers. Distinct from
 *  transient failures (network, 5xx) which must NOT trigger a credential-less
 *  login dead-end. */
const REFRESH_TOKEN_DEAD = new Set(["invalid_grant", "invalid_token", "invalid_request"])

/** Raised when an OAuth session cannot be refreshed and there are no fallback
 *  credentials to re-login with. Carries an actionable message so callers show
 *  "run cz-cli auth login" instead of a generic AUTH_FAILED. */
function sessionExpiredError(cause?: unknown): InterfaceError {
  const detail = cause instanceof Error && cause.message ? ` (${cause.message})` : ""
  return new InterfaceError(
    `OAuth session expired and could not be refreshed${detail}. Run \`cz-cli auth login <name>\` to sign in again.`,
    { code: "SESSION_EXPIRED" },
  )
}

/**
 * Rotate an expired OAuth token via `/oauth2/token`. On success the rotated
 * refresh token replaces the old one (requirement 5.3) so the next refresh
 * uses the latest value.
 *
 * On failure the recovery depends on WHY and on whether the config has
 * credentials:
 *   - refresh token dead (invalid_grant/…) + no credentials (pure OAuth) →
 *     throw SESSION_EXPIRED telling the user to re-login. We must NOT attempt a
 *     password login with empty credentials (it wastes ~6s of retries and ends
 *     in a misleading "Login failed").
 *   - credentials present (PAT/password) → fall back to a full login (it can
 *     genuinely re-authenticate; requirement 5.4).
 *   - transient failure (network/5xx) with no credentials → rethrow the
 *     original error; a dead-end login would only mask a retryable condition.
 * The shared tokenStore.clear() is a documented no-op, so we don't rely on it.
 */
async function refreshOrLogin(
  config: ConnectionConfig,
  previous: AuthToken,
  refreshTokenValue: string,
): Promise<AuthToken> {
  // OAuth `/oauth2/token` is served ONLY by the issuer that minted the refresh
  // token (persisted on the token as `issuer`), NOT the region business host in
  // `config.service` — sending the refresh there returns `invalid_grant`. Fall
  // back to config.service only when issuer is absent (legacy tokens /
  // non-OAuth), preserving prior behavior.
  const baseUrl = previous.issuer
    ? toServiceUrl(previous.issuer, config.protocol)
    : toServiceUrl(config.service, config.protocol)
  try {
    const oauth = await refreshAccessToken(baseUrl, refreshTokenValue)
    return {
      token: oauth.accessToken,
      refreshToken: oauth.refreshToken ?? refreshTokenValue,
      instanceId: previous.instanceId,
      userId: previous.userId,
      expireTimeMs: oauth.expiresInMs,
      obtainedAt: Date.now(),
      // Carry the issuer forward so the NEXT rotation also targets it.
      ...(previous.issuer ? { issuer: previous.issuer } : {}),
    }
  } catch (err) {
    cache.delete(cacheKey(config))
    config.tokenStore?.clear()
    const code = err instanceof ClickZettaError ? err.code : undefined
    const refreshDead = typeof code === "string" && REFRESH_TOKEN_DEAD.has(code)
    if (hasLoginCredentials(config)) {
      // PAT/password present → a full login can genuinely re-authenticate.
      return fetchToken(config)
    }
    // Pure OAuth profile: no credentials to log in with.
    if (refreshDead) throw sessionExpiredError(err)
    // Transient failure (network/5xx) — surface it as-is so it's retryable and
    // not misread as a permanent auth failure.
    throw err
  }
}

export async function getToken(config: ConnectionConfig): Promise<AuthToken> {
  return acquireToken(config, false)
}

/** Reload after a rejection, adopting a peer's different valid token when available. */
export async function forceRefreshToken(config: ConnectionConfig, rejected?: string): Promise<AuthToken> {
  const key = cacheKey(config)
  const rejectedToken = rejected ?? cache.get(key)?.token
  cache.delete(key)
  return acquireToken(config, true, rejectedToken)
}

async function acquireToken(config: ConnectionConfig, force: boolean, rejected?: string): Promise<AuthToken> {
  const key = cacheKey(config)
  if (!force) {
    const cached = cache.get(key)
    if (cached && !isTokenExpired(cached)) return cached
  }
  for (;;) {
    const inflight = pendingFetches.get(key)
    if (!inflight) break
    const joined = await inflight
    if (!force || rejected === undefined || joined.token !== rejected) return joined
  }

  // Always reload before refreshing: another process may have replaced both tokens.
  // Overlapping requests are allowed; the issuer handles refresh-token reuse within
  // its grace window. The local promise only coalesces callers in this process.
  const store = config.tokenStore
  const candidate = store ? store.load() : cache.get(key)
  if (candidate && !isTokenExpired(candidate) && (!force || (rejected !== undefined && candidate.token !== rejected))) {
    cache.set(key, candidate)
    return candidate
  }
  const fetch = (async () => {
    const token = candidate?.refreshToken
      ? await refreshOrLogin(config, candidate, candidate.refreshToken)
      : await fetchToken(config)
    store?.save(token)
    cache.set(key, token)
    return token
  })()
  pendingFetches.set(key, fetch)
  try {
    return await fetch
  } finally {
    if (pendingFetches.get(key) === fetch) pendingFetches.delete(key)
  }
}

/**
 * The standard source: an OAuth/PAT/password connection whose token is cached,
 * refreshed proactively when stale, and rotated on demand. `get`/`rotate` are
 * the existing `getToken`/`forceRefreshToken` engine — single-flight and
 * persistence come with them.
 */
/**
 * Whether this connection has anything to authenticate or rotate WITH: a persisted
 * token to refresh, or credentials to log in with. False means every recovery path
 * would drive a login with empty values — ~6 s of retries ending in a misleading
 * "Login failed" that hides the error the server actually sent.
 *
 * An `oauth = "<id>"` pointer attaches a store whether or not its `[oauth.<id>]`
 * section still exists, so the store is asked for a token rather than for its
 * existence. Exported because callers outside the transport (a command deciding
 * whether a 401 is worth retrying) need the same answer, and a second copy of this
 * predicate is exactly what drifts.
 */
export function isRotatable(config: ConnectionConfig): boolean {
  return Boolean(config.tokenStore?.load()) || hasLoginCredentials(config)
}

export function connectionTokenSource(config: ConnectionConfig): TokenSource {
  return {
    async get(): Promise<Credential> {
      return toCredential(await getToken(config))
    },
    async rotate(rejected: Credential): Promise<Credential | undefined> {
      if (!isRotatable(config)) return undefined
      // A concurrent request may already have rotated this connection while this
      // one was in flight; its 401 is then about a credential we have already
      // replaced. Hand back the current one instead of rotating again, so N
      // parallel requests cost one rotation rather than N.
      const current = toCredential(await getToken(config))
      if (current.token !== rejected.token) return current
      // Throws SESSION_EXPIRED when the refresh token is dead and there are no
      // credentials to fall back on — a terminal answer, not a missing path.
      return toCredential(await forceRefreshToken(config, rejected.token))
    },
  }
}

/**
 * A credential supplied verbatim by the caller: a token minted moments ago by a
 * login flow, a profile `[agent]` block, or a cookie session. There is no
 * rotation path, so `rotate` reports that rather than pretending — which is how
 * "this identity cannot self-heal" is expressed now that no request carries a
 * flag for it.
 */
export function staticTokenSource(credential: Credential): TokenSource {
  return {
    get: async () => credential,
    rotate: async () => undefined,
  }
}

/** Unauthenticated endpoint (health probes, public metadata). */
export function anonymous(): TokenSource {
  return staticTokenSource({ token: "", instanceId: 0, userId: 0 })
}

function toCredential(token: AuthToken): Credential {
  // 0 when the token carries none: the connection is the authoritative source now (see
  // ConnectionConfig.instanceId), and a Credential's copy is only a convenience for the
  // standalone-SDK login path that still has one.
  return { token: token.token, instanceId: token.instanceId ?? 0, userId: token.userId }
}

export function clearTokenCache(): void {
  cache.clear()
}
