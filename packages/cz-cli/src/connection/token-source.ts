import {
  connectionTokenSource,
  staticTokenSource,
  type ConnectionConfig,
  type Credential,
  type TokenSource,
} from "@clickzetta/sdk"
import { getCookieToken, hasCookieToken } from "./cookie-token.js"

/**
 * The one place cz-cli decides how a profile authenticates.
 *
 * A cookie-pinned profile's credential IS its `Cookie`: it was issued by a
 * browser session, the profile gets no OAuth token store
 * (`connection/config.ts`), and rotating would mint an identity the server never
 * saw. That is expressed by handing back a source with no rotation path rather
 * than by a flag every request has to carry — which is what let the Studio
 * commands lose 401 recovery while `sql` kept it.
 *
 * Everything else (OAuth, PAT, username/password) gets the standard connection
 * source: cached, proactively refreshed, rotatable on 401.
 */
export function profileTokenSource(config: ConnectionConfig): TokenSource {
  if (!hasCookieToken(config)) return connectionTokenSource(config)
  return {
    async get(): Promise<Credential> {
      const token = await getCookieToken(config)
      if (!token) throw new Error("profile cookie token disappeared while resolving credentials")
      return { token: token.token, instanceId: token.instanceId, userId: token.userId }
    },
    rotate: async () => undefined,
  }
}

/**
 * A credential the caller already holds and cannot rotate: a token a login flow
 * minted seconds ago, or a profile `[agent]` block's own identity. Prefer
 * {@link profileTokenSource} whenever a `ConnectionConfig` is in reach.
 */
export function verbatimTokenSource(token: string, ids?: { instanceId?: number; userId?: number }): TokenSource {
  return staticTokenSource({ token, instanceId: ids?.instanceId ?? 0, userId: ids?.userId ?? 0 })
}
