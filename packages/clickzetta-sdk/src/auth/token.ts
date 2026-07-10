import type { AuthToken, ConnectionConfig } from "../types/index.js"
import { loginWithPat, loginWithPassword } from "./login.js"
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

export async function getToken(config: ConnectionConfig): Promise<AuthToken> {
  const key = cacheKey(config)
  if (cachedToken && cachedKey === key && !isTokenExpired(cachedToken)) {
    return cachedToken
  }
  if (pendingFetch) {
    return pendingFetch
  }
  pendingFetch = (async () => {
    try {
      const token = await fetchToken(config)      
      cachedToken = token
      cachedKey = key
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
