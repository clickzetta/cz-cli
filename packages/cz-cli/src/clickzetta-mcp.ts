import type { ConnectionConfig } from "@clickzetta/sdk"

type LakehouseConnection = Pick<
  ConnectionConfig,
  "pat" | "username" | "password" | "service" | "instance" | "workspace" | "schema" | "vcluster" | "customHeaders"
>

const VW_UAT_HOST = "lakehouse-studio.uat.cn-vw.volkswagen-cea.com"

function centralApiUrl(host: string): string {
  if (host.startsWith("uat-")) return "https://uat-api.clickzetta.com"
  if (host.startsWith("dev-") || host.startsWith("localhost") || host.startsWith("0.0.0.0")) return "https://dev-api.clickzetta.com"
  if (host.endsWith("singdata.com")) return "https://ap-southeast-1-alicloud.api.singdata.com"
  if (host.endsWith("clickzetta-inc.com") || host.endsWith("kuaishou.com")) return `https://${host}`
  if (host.endsWith("clickzetta.com") && !host.includes(".api.clickzetta.com")) {
    if (!host.startsWith("cn-") && !host.startsWith("ap-") && !host.startsWith("us-") && !host.startsWith("eu-")) return `https://${host}`
    return "https://cn-shanghai-alicloud.api.clickzetta.com"
  }
  if (host.endsWith("clickzetta.com")) return "https://cn-shanghai-alicloud.api.clickzetta.com"
  return `https://${host}`
}

export function normalizeHost(serviceUrl: string): string {
  if (!serviceUrl) return ""
  const value = serviceUrl.trim().toLowerCase()
  const withScheme = value.includes("://") ? value : `https://${value}`
  try {
    return new URL(withScheme).host
  } catch {
    return value.replace(/^https?:\/\//, "").split("/", 1)[0]!
  }
}

export function serviceUrlToMcpUrl(serviceUrl: string): string {
  const host = normalizeHost(serviceUrl)
  if (host === VW_UAT_HOST) return `http://${VW_UAT_HOST}/mcp`
  const apiHost = normalizeHost(centralApiUrl(host))
  if (!apiHost.includes("api")) return `https://${apiHost}/mcp`
  return `https://${apiHost.replace(/([.-])api(?=\.)/, "-mcp$1api")}/mcp`
}

export function hasLakehouseAuth(connection: Pick<LakehouseConnection, "pat" | "username" | "password">): boolean {
  return !!connection.pat || (!!connection.username && !!connection.password)
}

export function buildLakehouseAuthHeaders(connection: LakehouseConnection): Record<string, string> {
  const headers: Record<string, string> = {}
  if (connection.pat) headers["X-Lakehouse-Token"] = `Bearer ${connection.pat}`
  if (connection.username && !connection.pat) headers["x-Lakehouse-Username"] = connection.username
  if (connection.password && !connection.pat) headers["x-Lakehouse-Password"] = connection.password
  if (connection.service) headers["x-Lakehouse-Service"] = normalizeHost(connection.service)
  if (connection.instance) headers["x-Lakehouse-Instance"] = connection.instance
  if (connection.workspace) headers["x-Lakehouse-Workspace"] = connection.workspace
  if (connection.schema) headers["x-Lakehouse-Schema"] = connection.schema
  if (connection.vcluster) headers["x-Lakehouse-VCluster"] = connection.vcluster
  if (!connection.customHeaders || Object.keys(connection.customHeaders).length === 0) return headers
  return { ...headers, ...connection.customHeaders }
}
