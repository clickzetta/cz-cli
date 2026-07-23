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

export interface StudioConfig {
  token: string
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
