export interface ConnectionConfig {
  pat: string
  username: string
  password: string
  service: string
  protocol: string
  instance: string
  workspace: string
  schema: string
  vcluster: string
  customHeaders?: Record<string, string>
  tokenStore?: TokenStore
  /**
   * Stable identity for the in-memory token cache. OAuth logins carry no
   * pat/username, so the default cache key (`instance:pat|username`) collapses
   * to `instance:` and COLLIDES across distinct OAuth profiles/logins on the
   * same instance — the first token cached would be handed to the second
   * profile. cz-cli sets this to the profile's OAuth pointer (the `[oauth.<id>]`
   * section id) so each login caches independently. Optional: when absent the
   * cache falls back to `instance:pat|username` (correct for PAT/password).
   */
  cacheKey?: string
}

/**
 * Pluggable persistence seam for OAuth tokens (requirement 9). When a
 * `ConnectionConfig` carries a `tokenStore`, the token cache layer uses it to
 * load/save/clear tokens across processes (cz-cli injects a profile-backed
 * implementation). When absent, the cache falls back to in-memory only,
 * preserving the previous behavior (requirement 9.7).
 */
export interface TokenStore {
  load(): AuthToken | undefined
  save(token: AuthToken): void
  clear(): void
}

export const DEFAULT_CONNECTION: ConnectionConfig = {
  pat: "",
  username: "",
  password: "",
  service: "dev-api.clickzetta.com",
  protocol: "https",
  instance: "",
  workspace: "",
  schema: "public",
  vcluster: "default",
}

export interface AuthToken {
  token: string
  instanceId: number
  userId: number
  expireTimeMs: number
  obtainedAt: number
  refreshToken?: string // OAuth refresh token; undefined for legacy (PAT/password) logins
  // OAuth issuer host (no protocol, e.g. "api.clickzetta.com") — the OIDC
  // authorization server that issued this token. OAuth `/oauth2/token` is ONLY
  // served by the issuer, NOT the region business host in `config.service`
  // (which userinfo's gatewayMapping points at, e.g.
  // "ap-shanghai-tencentcloud.api.clickzetta.com"). Persisted at login and used
  // by the refresh path so token rotation targets the issuer. undefined for
  // PAT/password logins (they refresh via re-login against config.service) and
  // legacy OAuth tokens saved before this field existed. Named per OIDC's
  // `issuer` (RFC 8414); stored as a bare host to match profile `service`.
  issuer?: string
}

/**
 * One resolved credential, valid at the moment {@link TokenSource.get} returned
 * it. Nothing outside a TokenSource should store one: hold the source instead.
 */
export interface Credential {
  /** Wire credential for the `x-clickzetta-token` header. */
  token: string
  instanceId: number
  userId: number
  /**
   * Headers this credential itself requires — a session/cookie credential is
   * only accepted alongside its `Cookie`. Kept with the credential so the
   * transport cannot send one without the other.
   */
  headers?: Record<string, string>
}

/**
 * The single seam through which every authenticated request obtains its
 * credential. Modeled on `oauth2.TokenSource` (Go) and `TokenCredential`
 * (Azure SDK): the transport asks for a credential at request time and, on a
 * 401, asks the same source to rotate it.
 *
 * Why this shape rather than passing a token string: a token handed to a caller
 * is a snapshot, and every caller then needs its own copy of "how to replace
 * this" — which is how `sql` ended up self-healing on an expired token while
 * every Studio command surfaced a bare `401 token is invalid`. With a source,
 * there is nothing for a call site to forget: it cannot obtain a credential
 * without also holding the means to rotate it.
 *
 * An identity that cannot be rotated is a *kind of source*
 * ({@link staticTokenSource}), not a flag on every request.
 */
export interface TokenSource {
  /** Credential for the next request, refreshed proactively when near expiry. */
  get(): Promise<Credential>
  /**
   * One-shot recovery after the server rejected `rejected` with 401. Returns
   * the replacement credential, or `undefined` when this identity has no
   * rotation path (static token, cookie session) — the caller then surfaces the
   * 401. Throws when rotation was possible but failed for good (a dead refresh
   * token raises `SESSION_EXPIRED`).
   */
  rotate(rejected: Credential): Promise<Credential | undefined>
}

/**
 * Non-auth metadata that some request BODIES embed — the SQL job-submit payload
 * carries the service endpoint and the login name. It exists only because those
 * payloads need it; authentication never reads this. Deliberately separate from
 * {@link TokenSource} so the two can't be confused again.
 */
export interface RequestContext {
  service?: string
  instance?: string
  username?: string
}

export interface StudioConfig {
  /**
   * How this context authenticates. Ask it for a credential when one is needed
   * (`await sc.tokens.get()`); never cache the result on the context.
   */
  tokens: TokenSource
  instanceId: number
  workspaceId: number
  projectId: number
  userId: number
  tenantId: number
  instanceName: string
  workspaceName: string
  env: string
  baseUrl: string
  customHeaders?: Record<string, string>
  debug?: boolean
}
