import type { AuthToken, ConnectionConfig } from "../types/index.js"
import { loginWithPat, loginWithPassword } from "./login.js"
import { refreshAccessToken } from "./oauth.js"
import { toServiceUrl } from "../config/region.js"

const EXPIRED_FACTOR = 0.8

let cachedToken: AuthToken | undefined
let cachedKey: string | undefined
/**
 * In-flight login promise. When multiple callers race for a token
 * we coalesce them onto a single login call to avoid hammering the
 * auth endpoint (matches the mutex used by the Python connector).
 */
let pendingFetch: Promise<AuthToken> | undefined

export function isTokenExpired(token: AuthToken): boolean {
  if (!token.expireTimeMs || token.expireTimeMs === 0) return false
  const elapsed = Date.now() - token.obtainedAt
  return elapsed > token.expireTimeMs * EXPIRED_FACTOR
}

function cacheKey(config: ConnectionConfig): string {
  return `${config.instance}:${config.pat || config.username}`
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

/**
 * Rotate an expired OAuth token via `/oauth2/token`. On success the rotated
 * refresh token replaces the old one (requirement 5.3) so the next refresh
 * uses the latest value. On any refresh failure (e.g. `invalid_grant`) the
 * cache is dropped and we fall back to a full portal login (requirement 5.4).
 * When a `tokenStore` is injected, a refresh failure also clears the persisted
 * token so a stale refresh token is not reused next process (requirement 9.5).
 */
async function refreshOrLogin(
  config: ConnectionConfig,
  previous: AuthToken,
  refreshTokenValue: string,
): Promise<AuthToken> {
  const baseUrl = toServiceUrl(config.service, config.protocol)
  try {
    const oauth = await refreshAccessToken(baseUrl, refreshTokenValue)
    return {
      token: oauth.accessToken,
      refreshToken: oauth.refreshToken ?? refreshTokenValue,
      instanceId: previous.instanceId,
      userId: previous.userId,
      expireTimeMs: oauth.expiresInMs,
      obtainedAt: Date.now(),
    }
  } catch {
    clearTokenCache()
    config.tokenStore?.clear()
    return fetchToken(config)
  }
}

export async function getToken(config: ConnectionConfig): Promise<AuthToken> {
  const key = cacheKey(config)
  if (cachedToken && cachedKey === key && !isTokenExpired(cachedToken)) {
    return cachedToken
  }
  if (pendingFetch) {
    return pendingFetch
  }
  // Reaching here means any in-memory token for this key is expired/absent.
  // A persisted token (requirement 9) is consulted when memory has nothing:
  // an unexpired persisted token is reused without any network call
  // (requirement 9.3); an expired one with a refresh token feeds the refresh
  // path below (requirement 9.4).
  const store = config.tokenStore
  let candidate = cachedToken && cachedKey === key ? cachedToken : undefined
  if (!candidate && store) {
    const loaded = store.load()
    if (loaded) {
      if (!isTokenExpired(loaded)) {
        cachedToken = loaded
        cachedKey = key
        return loaded
      }
      candidate = loaded
    }
  }
  // If the candidate carries a refresh token, rotate it instead of a full
  // login (requirement 5.1); legacy tokens without one always re-login
  // (requirement 5.5). On success the token is persisted (requirement 9.1).
  pendingFetch = (async () => {
    try {
      const token = candidate?.refreshToken
        ? await refreshOrLogin(config, candidate, candidate.refreshToken)
        : await fetchToken(config)
      cachedToken = token
      cachedKey = key
      store?.save(token)
      return token
    } finally {
      pendingFetch = undefined
    }
  })()
  return pendingFetch
}

/**
 * Drop the cached token and obtain a fresh one. Used by the 401
 * retry path in `client.ts`. Concurrent callers are coalesced via
 * the same `pendingFetch` promise used by {@link getToken}.
 */
export async function forceRefreshToken(config: ConnectionConfig): Promise<AuthToken> {
  clearTokenCache()
  return getToken(config)
}

export function clearTokenCache(): void {
  cachedToken = undefined
  cachedKey = undefined
}
