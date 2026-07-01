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
  refreshToken?: string // OAuth refresh token；传统登录模式下为 undefined
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
