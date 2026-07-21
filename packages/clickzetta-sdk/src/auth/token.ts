import type { AuthToken, ConnectionConfig } from "../types/index.js"
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
    clearTokenCache()
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

/**
 * Drop this config's cached token and obtain a fresh one, bypassing BOTH the
 * in-memory cache and the "unexpired persisted token" shortcut. Used by the 401
 * retry path (client.ts) and exec's retry: the server just rejected a token the
 * client still considers valid (early revocation, clock skew), so reusing a
 * not-yet-expired persisted token would hand back the same rejected value and
 * loop. `force` drives the rotate/login path instead. Concurrent callers for
 * the same key are still coalesced.
 */
export async function forceRefreshToken(config: ConnectionConfig): Promise<AuthToken> {
  const key = cacheKey(config)
  cache.delete(key)
  return acquireToken(config, true)
}

async function acquireToken(config: ConnectionConfig, force: boolean): Promise<AuthToken> {
  const key = cacheKey(config)
  if (!force) {
    const cached = cache.get(key)
    if (cached && !isTokenExpired(cached)) return cached
  }
  const inflight = pendingFetches.get(key)
  if (inflight) return inflight

  // Reaching here means any in-memory token for this key is expired/absent (or
  // a forced refresh). A persisted token (requirement 9) is consulted when
  // memory has nothing: an unexpired persisted token is reused with no network
  // call (requirement 9.3) — UNLESS forced, in which case we always rotate so a
  // server-rejected-but-not-yet-expired token can't be handed back. An expired
  // one with a refresh token feeds the refresh path (requirement 9.4).
  const store = config.tokenStore
  let candidate = !force ? cache.get(key) : undefined
  if (!candidate && store) {
    const loaded = store.load()
    if (loaded) {
      if (!force && !isTokenExpired(loaded)) {
        cache.set(key, loaded)
        return loaded
      }
      candidate = loaded
    }
  }
  // If the candidate carries a refresh token, rotate it instead of a full login
  // (requirement 5.1); legacy tokens without one always re-login (requirement
  // 5.5). On success the token is persisted (requirement 9.1).
  const fetch = (async () => {
    try {
      const token = candidate?.refreshToken
        ? await refreshOrLogin(config, candidate, candidate.refreshToken)
        : await fetchToken(config)
      cache.set(key, token)
      store?.save(token)
      return token
    } finally {
      pendingFetches.delete(key)
    }
  })()
  pendingFetches.set(key, fetch)
  return fetch
}

export function clearTokenCache(): void {
  cache.clear()
}
