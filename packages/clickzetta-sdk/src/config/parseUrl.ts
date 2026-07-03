/**
 * parseUrl.ts — parse a clickzetta:// connection URL into ConnectionConfig.
 *
 * Python → TS mapping:
 *   parse_url.py:25-98  parse_url  → parseConnectionUrl
 *   parse_url.py:101-113 generate_url → generateConnectionUrl
 *
 * URL format (parse_url.py:23-24):
 *   clickzetta://username:password@instance.host:port/workspace
 *     ?virtualcluster=default&schema=public&magic_token=xxx&protocol=https
 *     &token_expire_time_ms=7200000
 */

import type { ConnectionConfig } from "../types/index.js"

// parse_url.py:7-8
const GROUP_DELIMITER = /\s*,\s*/
const KEY_VALUE_DELIMITER = /\s*:\s*/

// parse_url.py:14-21
function parseBoolean(s: string): boolean {
  const lower = s.toLowerCase()
  if (lower === "true") return true
  if (lower === "false") return false
  throw new Error(`Cannot parse boolean: ${s}`)
}

export interface ParsedUrl {
  service: string
  username: string
  password: string
  instance: string
  workspace: string
  vcluster: string
  schema: string | null
  magicToken: string | null
  protocol: string
  host: string
  port: number | null
  tokenExpireTimeMs: number | null
  extra: Record<string, string>
}

/**
 * parse_url.py:25-98 parse_url
 *
 * Parses a clickzetta:// URL into its components. The URL must contain
 * at least one of virtualcluster / virtualCluster / vcluster.
 */
export function parseConnectionUrl(originUrl: string): ParsedUrl {
  // Use the URL constructor after normalising the scheme to https so the
  // built-in parser handles host/port/path/query correctly.
  const normalised = originUrl.replace(/^clickzetta:\/\//, "https://")
  const url = new URL(normalised)

  const query: Record<string, string> = {}
  url.searchParams.forEach((v, k) => { query[k] = v })

  // parse_url.py:30-32 — instance is the first label of the hostname
  const hostParts = url.hostname.split(".")
  const instance = hostParts[0]!
  const host = hostParts.slice(1).join(".")

  // parse_url.py:34-44 — workspace from path, handle /api/ prefix
  let path = url.pathname.replace(/^\//, "")
  let workspace = path
  let apiInPath = false
  if (path.includes("/")) {
    const parts = path.split("/")
    if (parts.length >= 2 && parts[0]!.toLowerCase() === "api") {
      workspace = parts[1]!
      apiInPath = true
    } else {
      workspace = parts[0]!
    }
  }

  // parse_url.py:46-56 — protocol and service URL
  const protocol = query["protocol"] ?? "https"
  delete query["protocol"]
  if (protocol !== "http" && protocol !== "https") {
    throw new Error("protocol parameter must be http or https.")
  }
  const port = url.port ? Number(url.port) : null
  let serviceBase = `${protocol}://${host}`
  if (port) serviceBase += `:${port}`
  const service = apiInPath ? `${serviceBase}/api` : serviceBase

  // parse_url.py:63-71 — vcluster (three alias keys)
  const vclusterKeys = ["virtualcluster", "virtualCluster", "vcluster"]
  let vcluster: string | null = null
  for (const key of vclusterKeys) {
    if (key in query) {
      vcluster = query[key]!
      delete query[key]
      break
    }
  }
  if (!vcluster) {
    throw new Error("url must have `virtualcluster` or `virtualCluster` or `vcluster` parameter.")
  }

  // parse_url.py:73-76 — optional params
  const schema = query["schema"] ?? null
  delete query["schema"]
  const magicToken = query["magic_token"] ?? null
  delete query["magic_token"]
  let tokenExpireTimeMs: number | null = null
  if ("token_expire_time_ms" in query) {
    tokenExpireTimeMs = Number.parseInt(query["token_expire_time_ms"]!, 10)
    delete query["token_expire_time_ms"]
  }

  return {
    service,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    instance,
    workspace,
    vcluster,
    schema,
    magicToken,
    protocol,
    host,
    port,
    tokenExpireTimeMs,
    extra: query,
  }
}

/**
 * parse_url.py:101-113 generate_url
 * Reconstructs a clickzetta:// URL from a ConnectionConfig.
 */
export function generateConnectionUrl(config: ConnectionConfig & {
  host?: string
  magicToken?: string
  tokenExpireTimeMs?: number
  extra?: Record<string, string>
}): string {
  const host = config.host ?? config.service
  let url =
    `clickzetta://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}` +
    `@${config.instance}.${host}/${config.workspace}` +
    `?vcluster=${config.vcluster ?? "default"}`
  if (config.schema) url += `&schema=${config.schema}`
  if (config.magicToken) url += `&magic_token=${config.magicToken}`
  if (config.tokenExpireTimeMs != null) url += `&token_expire_time_ms=${config.tokenExpireTimeMs}`
  if (config.protocol) url += `&protocol=${config.protocol}`
  for (const [k, v] of Object.entries(config.extra ?? {})) {
    url += `&${k}=${v}`
  }
  return url
}

/**
 * Convenience: parse a clickzetta:// URL and return a ConnectionConfig
 * ready for use with SqlSession or getToken.
 */
export function connectionConfigFromUrl(originUrl: string): ConnectionConfig {
  const p = parseConnectionUrl(originUrl)
  return {
    pat: p.magicToken ?? "",
    username: p.username,
    password: p.password,
    service: p.service,
    protocol: p.protocol,
    instance: p.instance,
    workspace: p.workspace,
    schema: p.schema ?? "public",
    vcluster: p.vcluster,
  }
}

// Re-export for completeness
export { parseBoolean, GROUP_DELIMITER, KEY_VALUE_DELIMITER }
