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

  // Resolved once per source, not per request: `getCookieToken` parses the cookie
  // AND may resolve the instance id over the network when the JWT lacks it, while
  // the transport calls `get()` before every attempt of every request on the
  // premise that it is cache-backed.
  let resolved: Promise<Credential | undefined> | undefined
  const fallback = connectionTokenSource(config)
  return {
    async get(): Promise<Credential> {
      resolved ??= getCookieToken(config).then((token) =>
        token
          ? {
              token: token.token,
              instanceId: token.instanceId,
              userId: token.userId,
              // The Cookie travels WITH the credential: a session credential is
              // only accepted alongside it, and the transport merges these.
              ...(cookieHeader(config) ? { headers: { Cookie: cookieHeader(config)! } } : {}),
            }
          : undefined,
      )
      // `hasCookieToken` accepts an empty `X-ClickZetta-Token=` value that
      // `getCookieToken` rejects. That profile still has a pat/OAuth login to fall
      // back to, exactly as it did before this seam existed.
      return (await resolved) ?? await fallback.get()
    },
    async rotate(rejected: Credential): Promise<Credential | undefined> {
      // A cookie is not rotatable; a profile that fell through to pat/OAuth is.
      return (await resolved) ? undefined : fallback.rotate(rejected)
    },
  }
}

function cookieHeader(config: ConnectionConfig): string | undefined {
  return Object.entries(config.customHeaders ?? {})
    .find(([key]) => key.toLowerCase() === "cookie")?.[1]
}

/**
 * A credential the caller already holds and cannot rotate: a token a login flow
 * minted seconds ago, or a profile `[agent]` block's own identity. Prefer
 * {@link profileTokenSource} whenever a `ConnectionConfig` is in reach.
 */
export function verbatimTokenSource(token: string, ids?: { instanceId?: number; userId?: number }): TokenSource {
  return staticTokenSource({ token, instanceId: ids?.instanceId ?? 0, userId: ids?.userId ?? 0 })
}
