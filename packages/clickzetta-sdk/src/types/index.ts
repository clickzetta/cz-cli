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
