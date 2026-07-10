import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { resolveConnectionConfig, type CliArgs } from "./connection/config.js"
import { buildLakehouseAuthHeaders, hasLakehouseAuth, serviceUrlToMcpUrl } from "./clickzetta-mcp.js"

type OAuthConfig = {
  clientId?: string
  clientSecret?: string
  scope?: string
  redirectUri?: string
}

type LocalMcpConfig = {
  type: "local"
  command: string[]
  environment?: Record<string, string>
  enabled?: boolean
  timeout?: number
}

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled?: boolean
  headers?: Record<string, string>
  oauth?: OAuthConfig | false
  timeout?: number
}

type McpConfig = LocalMcpConfig | RemoteMcpConfig
type McpOverride = { enabled: boolean }

type ClickZettaRemoteManifest = {
  kind: "clickzetta_remote"
  enabled?: boolean
  headers?: Record<string, string>
  oauth?: OAuthConfig | false
  profile?: string
  timeout?: number
}

type Manifest = McpConfig | McpOverride | ClickZettaRemoteManifest
type McpEntry = McpConfig | McpOverride

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string")
}

function parseTimeout(value: unknown): number | undefined {
  return Number.isInteger(value) && typeof value === "number" && value > 0 ? value : undefined
}

function parseOAuth(value: unknown): OAuthConfig | false | undefined {
  if (value === false) return false
  if (!isRecord(value)) return undefined
  const next: OAuthConfig = {}
  if (typeof value.clientId === "string") next.clientId = value.clientId
  if (typeof value.clientSecret === "string") next.clientSecret = value.clientSecret
  if (typeof value.scope === "string") next.scope = value.scope
  if (typeof value.redirectUri === "string") next.redirectUri = value.redirectUri
  return Object.keys(next).length > 0 ? next : undefined
}

function enabledOnly(value: unknown): McpOverride | undefined {
  if (!isRecord(value) || typeof value.enabled !== "boolean" || Object.keys(value).length !== 1) return undefined
  return { enabled: value.enabled }
}

function parseLocalConfig(value: Record<string, unknown>): LocalMcpConfig | undefined {
  if (value.type !== "local" || !Array.isArray(value.command) || value.command.some((item) => typeof item !== "string")) return undefined
  return {
    type: "local",
    command: [...value.command],
    enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
    environment: isStringRecord(value.environment) ? value.environment : undefined,
    timeout: parseTimeout(value.timeout),
  }
}

function parseRemoteConfig(value: Record<string, unknown>): RemoteMcpConfig | undefined {
  if (value.type !== "remote" || typeof value.url !== "string" || value.url.length === 0) return undefined
  return compactEntry({
    type: "remote",
    url: value.url,
    enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
    headers: isStringRecord(value.headers) ? value.headers : undefined,
    oauth: parseOAuth(value.oauth),
    timeout: parseTimeout(value.timeout),
  })
}

function parseClickZettaRemote(value: Record<string, unknown>): ClickZettaRemoteManifest | undefined {
  if (value.kind !== "clickzetta_remote") return undefined
  return {
    kind: "clickzetta_remote",
    enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
    headers: isStringRecord(value.headers) ? value.headers : undefined,
    oauth: parseOAuth(value.oauth),
    profile: typeof value.profile === "string" && value.profile.length > 0 ? value.profile : undefined,
    timeout: parseTimeout(value.timeout),
  }
}

function parseManifest(value: unknown): Manifest | undefined {
  if (!isRecord(value)) return undefined
  return enabledOnly(value) ?? parseLocalConfig(value) ?? parseRemoteConfig(value) ?? parseClickZettaRemote(value)
}

function compactEntry<T extends McpEntry>(entry: T): T {
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)) as T
}

function mergeStringRecords(
  base?: Record<string, string>,
  override?: Record<string, string>,
): Record<string, string> | undefined {
  if (!base && !override) return undefined
  return { ...(base ?? {}), ...(override ?? {}) }
}

function mergeOAuth(base?: OAuthConfig | false, override?: OAuthConfig | false): OAuthConfig | false | undefined {
  if (override === false) return false
  if (base === false) return override ?? false
  if (!base && !override) return undefined
  return { ...(base ?? {}), ...(override ?? {}) }
}

function isConfiguredEntry(entry: McpEntry | undefined): entry is McpConfig {
  return !!entry && "type" in entry
}

function mergeEntry(base: McpEntry | undefined, override: McpEntry): McpEntry {
  if (!base) return override
  if (!("type" in override)) {
    if (!isConfiguredEntry(base)) return override
    return compactEntry({ ...base, enabled: override.enabled })
  }
  if (!isConfiguredEntry(base)) {
    return compactEntry({ ...override, enabled: override.enabled ?? base.enabled })
  }
  if (base.type !== override.type) return override
  if (override.type === "local") {
    const localBase = base as LocalMcpConfig
    return compactEntry({
      ...localBase,
      ...override,
      environment: mergeStringRecords(localBase.environment, override.environment),
    })
  }
  const remoteBase = base as RemoteMcpConfig
  return compactEntry({
    ...remoteBase,
    ...override,
    headers: mergeStringRecords(remoteBase.headers, override.headers),
    oauth: mergeOAuth(remoteBase.oauth, override.oauth),
  })
}

function mergeEntries(base: Record<string, McpEntry>, override: Record<string, McpEntry>) {
  const next = { ...base }
  for (const [name, entry] of Object.entries(override)) {
    next[name] = mergeEntry(next[name], entry)
  }
  return next
}

function clickzettaHome() {
  return process.env.CLICKZETTA_TEST_HOME || homedir()
}

function projectMcpRoots(cwd: string) {
  const roots: string[] = []
  let current = resolve(cwd)
  while (true) {
    roots.unshift(join(current, ".clickzetta", "mcp"))
    const parent = dirname(current)
    if (parent === current) return roots
    current = parent
  }
}

async function scanManifestFiles(root: string, excludeBuiltin: boolean) {
  if (!existsSync(root)) return []
  const matches = (await Array.fromAsync(new Bun.Glob("**/mcp.json").scan({ cwd: root, dot: true }))).sort()
  return excludeBuiltin ? matches.filter((match) => !match.startsWith(".builtin/")) : matches
}

function manifestName(relativePath: string) {
  const segments = relativePath.split(/[\\/]/).filter(Boolean)
  return segments.at(-2)
}

function resolveClickZettaRemote(manifest: ClickZettaRemoteManifest, cliArgs: Partial<CliArgs>): RemoteMcpConfig | undefined {
  const connection = resolveConnectionConfig({
    ...cliArgs,
    profile: manifest.profile ?? cliArgs.profile,
  })
  if (!hasLakehouseAuth(connection) && manifest.enabled !== false) return undefined
  return compactEntry({
    type: "remote",
    url: serviceUrlToMcpUrl(connection.service),
    enabled: manifest.enabled,
    headers: mergeStringRecords(buildLakehouseAuthHeaders(connection), manifest.headers),
    oauth: manifest.oauth,
    timeout: manifest.timeout,
  })
}

async function loadManifestRoot(root: string, cliArgs: Partial<CliArgs>, excludeBuiltin = false) {
  const files = await scanManifestFiles(root, excludeBuiltin)
  const entries: Record<string, McpEntry> = {}
  for (const relativePath of files) {
    const name = manifestName(relativePath)
    if (!name) continue
    const parsed = parseManifest(await Bun.file(join(root, relativePath)).json().catch(() => undefined))
    if (!parsed) continue
    const entry = "kind" in parsed ? resolveClickZettaRemote(parsed, cliArgs) : parsed
    if (!entry) continue
    entries[name] = mergeEntry(entries[name], entry)
  }
  return entries
}

function parseExistingMcp(value: unknown) {
  if (!isRecord(value)) return {}
  const entries: Record<string, McpEntry> = {}
  for (const [name, entry] of Object.entries(value)) {
    const parsed = parseManifest(entry)
    if (!parsed || "kind" in parsed) continue
    entries[name] = parsed
  }
  return entries
}

export async function discoverAgentMcp(cliArgs: Partial<CliArgs> = {}, cwd = process.cwd()) {
  const homeRoot = join(clickzettaHome(), ".clickzetta", "mcp")
  const builtin = await loadManifestRoot(join(homeRoot, ".builtin"), cliArgs)
  const home = await loadManifestRoot(homeRoot, cliArgs, true)
  const project = await (async () => {
    let merged: Record<string, McpEntry> = {}
    for (const root of projectMcpRoots(cwd)) {
      merged = mergeEntries(merged, await loadManifestRoot(root, cliArgs, true))
    }
    return merged
  })()
  return mergeEntries(mergeEntries(builtin, home), project)
}

export async function injectAgentMcp(cliArgs: Partial<CliArgs> = {}, cwd = process.cwd()) {
  const discovered = await discoverAgentMcp(cliArgs, cwd)
  if (Object.keys(discovered).length === 0) return
  const injected = { mcp: discovered }
  if (!process.env.OPENCODE_CONFIG_CONTENT) {
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(injected)
    return
  }
  try {
    const existing = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT) as Record<string, unknown>
    const existingMcp = parseExistingMcp(existing.mcp)
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      ...existing,
      mcp: mergeEntries(discovered, existingMcp),
    })
  } catch {}
}
