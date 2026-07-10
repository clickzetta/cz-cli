import type { ConnectionConfig } from "@clickzetta/sdk"

export function parseJdbcUrl(jdbc: string): Partial<ConnectionConfig> | undefined {
  let url = jdbc.trim()
  if (url.startsWith("jdbc:")) url = url.slice(5)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }

  const hostParts = parsed.hostname.split(".")
  // Need at least instance + one service segment (e.g. "instance.host.com")
  if (hostParts.length < 2 || !hostParts[0]) return undefined

  const instance = hostParts[0]
  // Keep the port: downstream toServiceUrl builds `${protocol}://${service}`,
  // so the port must travel with the host (e.g. "10.155.2.214:8033").
  const host = hostParts.slice(1).join(".")
  if (!host) return undefined

  // Handle /api/ path prefix: when the first segment is "api", it belongs to the
  // service URL and the workspace is the next segment (mirrors SDK parseConnectionUrl).
  const pathSegments = parsed.pathname.replace(/^\//, "").split("/")
  let workspace: string | undefined
  let serviceSuffix = ""
  if (pathSegments.length >= 2 && pathSegments[0]!.toLowerCase() === "api") {
    serviceSuffix = "/api"
    workspace = pathSegments[1] || undefined
  } else {
    workspace = pathSegments[0] || undefined
  }

  const service = (parsed.port ? `${host}:${parsed.port}` : host) + serviceSuffix
  const params = parsed.searchParams

  const result: Partial<ConnectionConfig> = { instance, service }
  if (workspace) result.workspace = workspace
  if (params.get("username")) result.username = params.get("username")!
  if (params.get("password")) result.password = params.get("password")!
  if (params.get("schema")) result.schema = params.get("schema")!
  // vcluster has three accepted aliases (see SDK parseUrl.ts), match them all.
  const vcluster =
    params.get("vcluster") || params.get("virtualCluster") || params.get("virtualcluster")
  if (vcluster) result.vcluster = vcluster
  if (params.get("workspace")) result.workspace = params.get("workspace")!
  if (params.get("protocol")) result.protocol = params.get("protocol")!
  // JDBC strings carry transport as use_http=true rather than protocol=http.
  else if (params.get("use_http")) {
    result.protocol = params.get("use_http") === "true" ? "http" : "https"
  }

  return result
}
