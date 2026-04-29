import type { ConnectionConfig } from "@clickzetta/sdk"

export function parseJdbcUrl(jdbc: string): Partial<ConnectionConfig> | undefined {
  let url = jdbc
  if (url.startsWith("jdbc:")) url = url.slice(5)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }

  const hostParts = parsed.hostname.split(".")
  if (hostParts.length < 4) return undefined

  const instance = hostParts[0]
  const service = hostParts.slice(1).join(".")
  const workspace = parsed.pathname.replace(/^\//, "") || undefined
  const params = parsed.searchParams

  const result: Partial<ConnectionConfig> = {
    instance,
    service,
  }
  if (workspace) result.workspace = workspace
  if (params.get("username")) result.username = params.get("username")!
  if (params.get("password")) result.password = params.get("password")!
  if (params.get("schema")) result.schema = params.get("schema")!
  if (params.get("virtualCluster")) result.vcluster = params.get("virtualCluster")!
  if (params.get("workspace")) result.workspace = params.get("workspace")!
  if (params.get("protocol")) result.protocol = params.get("protocol")!

  return result
}
