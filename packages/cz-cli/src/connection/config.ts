import { DEFAULT_CONNECTION, type ConnectionConfig } from "@clickzetta/sdk"
import { getProfileConfig } from "./profile-store.js"
import { parseJdbcUrl } from "./jdbc.js"

export interface CliArgs {
  pat?: string
  username?: string
  password?: string
  service?: string
  protocol?: string
  instance?: string
  workspace?: string
  schema?: string
  vcluster?: string
  jdbcUrl?: string
  profile?: string
}

export function resolveConnectionConfig(cliArgs: Partial<CliArgs> = {}): ConnectionConfig {
  const profileCfg = getProfileConfig(cliArgs.profile) ?? (cliArgs.profile ? undefined : getProfileConfig())
  const envCfg = getEnvConfig()
  const jdbcCfg = cliArgs.jdbcUrl ? parseJdbcUrl(cliArgs.jdbcUrl) : undefined

  const cfg: ConnectionConfig = { ...DEFAULT_CONNECTION }

  applyNonAuth(cfg, profileCfg)
  applyNonAuth(cfg, envCfg)
  applyNonAuth(cfg, jdbcCfg)

  const nonAuthKeys = ["service", "protocol", "instance", "workspace", "schema", "vcluster"] as const
  for (const key of nonAuthKeys) {
    const val = cliArgs[key]
    if (val !== undefined && val !== null) {
      cfg[key] = val
    }
  }
  cfg.protocol = normalizeProtocol(cfg.protocol)

  // Auth priority: --pat > CZ_PAT > profile pat > --username/--password > JDBC > env > profile
  const cliPat = cliArgs.pat || ""
  const envPat = process.env.CZ_PAT || ""
  const profilePat = profileCfg?.pat || ""

  const cliUsername = cliArgs.username
  const cliPassword = cliArgs.password
  const jdbcUsername = jdbcCfg?.username || ""
  const jdbcPassword = jdbcCfg?.password || ""
  const envUsername = envCfg?.username || ""
  const envPassword = envCfg?.password || ""
  const profileUsername = profileCfg?.username || ""
  const profilePassword = profileCfg?.password || ""

  if (cliPat) {
    cfg.pat = cliPat
  } else if (envPat) {
    cfg.pat = envPat
  } else if (profilePat) {
    cfg.pat = profilePat
  } else if (cliUsername !== undefined || cliPassword !== undefined) {
    const mergedUsername = cliUsername || jdbcUsername || envUsername || profileUsername
    const mergedPassword = cliPassword || jdbcPassword || envPassword || profilePassword
    if (mergedUsername && mergedPassword) {
      cfg.username = mergedUsername
      cfg.password = mergedPassword
    }
  } else if (jdbcUsername && jdbcPassword) {
    cfg.username = jdbcUsername
    cfg.password = jdbcPassword
  } else if (envUsername && envPassword) {
    cfg.username = envUsername
    cfg.password = envPassword
  } else if (profileUsername && profilePassword) {
    cfg.username = profileUsername
    cfg.password = profilePassword
  }

  if (cfg.pat) {
    cfg.username = ""
    cfg.password = ""
  }

  return cfg
}

function getEnvConfig(): Partial<ConnectionConfig> | undefined {
  const env = process.env
  const result: Partial<ConnectionConfig> = {}
  let hasAny = false

  const map: Array<[string, keyof ConnectionConfig]> = [
    ["CZ_PAT", "pat"],
    ["CZ_USERNAME", "username"],
    ["CZ_PASSWORD", "password"],
    ["CZ_SERVICE", "service"],
    ["CZ_PROTOCOL", "protocol"],
    ["CZ_INSTANCE", "instance"],
    ["CZ_WORKSPACE", "workspace"],
    ["CZ_SCHEMA", "schema"],
    ["CZ_VCLUSTER", "vcluster"],
  ]

  for (const [envKey, cfgKey] of map) {
    const val = env[envKey]
    if (val) {
      ;(result as Record<string, string>)[cfgKey] = val
      hasAny = true
    }
  }

  return hasAny ? result : undefined
}

function applyNonAuth(target: ConnectionConfig, src: Partial<ConnectionConfig> | undefined): void {
  if (!src) return
  if (src.service) target.service = src.service
  if (src.protocol) target.protocol = normalizeProtocol(src.protocol)
  if (src.instance) target.instance = src.instance
  if (src.workspace) target.workspace = src.workspace
  if (src.schema) target.schema = src.schema
  if (src.vcluster) target.vcluster = src.vcluster
}

function normalizeProtocol(value?: string): string {
  if (!value) return "https"
  const lower = value.toLowerCase().replace(/:\/\/$/, "")
  if (lower === "http") return "http"
  return "https"
}
