import type { AuthToken, ConnectionConfig } from "../types/index.js"
import { loginWithPat, loginWithPassword } from "./login.js"
import { toServiceUrl } from "../config/region.js"

const EXPIRED_FACTOR = 0.8

let cachedToken: AuthToken | undefined
let cachedKey: string | undefined

export function isTokenExpired(token: AuthToken): boolean {
  if (!token.expireTimeMs || token.expireTimeMs === 0) return false
  const elapsed = Date.now() - token.obtainedAt
  return elapsed > token.expireTimeMs * EXPIRED_FACTOR
}

export async function getToken(config: ConnectionConfig): Promise<AuthToken> {
  const key = `${config.instance}:${config.pat || config.username}`
  if (cachedToken && cachedKey === key && !isTokenExpired(cachedToken)) {
    return cachedToken
  }
  const baseUrl = toServiceUrl(config.service, config.protocol)
  const token = config.pat
    ? await loginWithPat(baseUrl, config.pat, config.instance)
    : await loginWithPassword(
        baseUrl,
        config.username,
        config.password,
        config.instance,
      )
  cachedToken = token
  cachedKey = key
  return token
}

export function clearTokenCache(): void {
  cachedToken = undefined
  cachedKey = undefined
}
