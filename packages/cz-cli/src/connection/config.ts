import { DEFAULT_CONNECTION, type ConnectionConfig } from "@clickzetta/sdk"
import { getProfileConfig, makeProfileTokenStore, readProfileEntry } from "./profile-store.js"
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
  const profileName = cliArgs.profile ?? process.env.CZ_PROFILE
  const profileCfg = getProfileConfig(profileName) ?? (profileName ? undefined : getProfileConfig())
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

  // Propagate customHeaders from profile (highest priority: env headers could override if needed)
  if (profileCfg?.customHeaders && Object.keys(profileCfg.customHeaders).length > 0) {
    cfg.customHeaders = { ...profileCfg.customHeaders, ...cfg.customHeaders }
  }

  // Attach a profile-backed OAuth token store so callers routing through this
  // function (exec.ts, studio-context.ts) get cross-process persistence
  // (requirement 9.3, 9.7). The OAuth token represents the user's own login,
  // so the slot is keyed by INSTANCE ONLY (not pat/username): removing or
  // rotating a pat must not orphan the persisted token (requirement 9.6/11.6).
  // The store is self-keyed — the SDK calls load/save/clear on it without
  // re-deriving a key — so this key need not mirror token.ts's in-memory key.
  //
  // BUT never attach it when the caller supplied an EXPLICIT per-invocation
  // credential (--pat / CZ_PAT, or --username+--password). getToken() consults
  // the store before fetchToken(), so an attached store would return a cached
  // OAuth token and silently shadow the credential the user just passed —
  // violating the documented auth priority (--pat > CZ_PAT > …) and defeating
  // PAT rotation. Skipping the store also stops the PAT-exchanged token from
  // being persisted. Profile-level and pure-OAuth flows still attach it.
  const explicitCredential = Boolean(cliPat) || Boolean(envPat) || Boolean(cliUsername && cliPassword)
  // Attach the OAuth token store when the profile can carry an OAuth login:
  // either it has an instance (the common case) OR it has an `oauth = "<id>"`
  // pointer to a shared [oauth.<id>] token. The old `cfg.instance`-only gate
  // dropped the store for accounts with NO instance (userinfo instanceList
  // empty) — the token was persisted but unreadable, so a genuinely logged-in
  // user was reported as "no credentials". The OAuth token is keyed by the
  // profile pointer, not by instance, so instance must not gate it.
  const hasOAuthPointer = typeof readProfileEntry(profileName)?.oauth === "string"
  if ((cfg.instance || hasOAuthPointer) && !explicitCredential) {
    // No oauthId passed: the store resolves the shared-token id from this
    // profile's `oauth = "<id>"` pointer (or a legacy inline subtable).
    cfg.tokenStore = makeProfileTokenStore(profileName)
  }

  return cfg
}

function getEnvConfig(): Partial<ConnectionConfig> | undefined {
  const env = process.env
  const result: Partial<ConnectionConfig> = {}

  const pat = env.CZ_PAT || ""
  const username = env.CZ_USERNAME || ""
  const password = env.CZ_PASSWORD || ""

  // Require PAT or both username+password to return auth config (matching Python)
  if (!pat && !(username && password)) {
    // Still return non-auth fields if any are set
    const nonAuthMap: Array<[string, keyof ConnectionConfig]> = [
      ["CZ_SERVICE", "service"],
      ["CZ_PROTOCOL", "protocol"],
      ["CZ_INSTANCE", "instance"],
      ["CZ_WORKSPACE", "workspace"],
      ["CZ_SCHEMA", "schema"],
      ["CZ_VCLUSTER", "vcluster"],
    ]
    let hasAny = false
    for (const [envKey, cfgKey] of nonAuthMap) {
      const val = env[envKey]
      if (val) {
        ;(result as Record<string, string>)[cfgKey] = val
        hasAny = true
      }
    }
    return hasAny ? result : undefined
  }

  if (pat) result.pat = pat
  if (username) result.username = username
  if (password) result.password = password

  const nonAuthMap: Array<[string, keyof ConnectionConfig]> = [
    ["CZ_SERVICE", "service"],
    ["CZ_PROTOCOL", "protocol"],
    ["CZ_INSTANCE", "instance"],
    ["CZ_WORKSPACE", "workspace"],
    ["CZ_SCHEMA", "schema"],
    ["CZ_VCLUSTER", "vcluster"],
  ]
  for (const [envKey, cfgKey] of nonAuthMap) {
    const val = env[envKey]
    if (val) {
      ;(result as Record<string, string>)[cfgKey] = val
    }
  }
  return result
}

function applyNonAuth(target: ConnectionConfig, src: Partial<ConnectionConfig> | undefined): void {
  if (!src) return
  if (src.service) target.service = src.service
  if (src.protocol) target.protocol = normalizeProtocol(src.protocol)
  if (src.instance) target.instance = src.instance
  if (src.workspace) target.workspace = src.workspace
  if (src.schema) target.schema = src.schema
  if (src.vcluster) target.vcluster = src.vcluster
  if (src.customHeaders && Object.keys(src.customHeaders).length > 0) {
    target.customHeaders = { ...target.customHeaders, ...src.customHeaders }
  }
}

function normalizeProtocol(value?: string): string {
  if (!value) return "https"
  const lower = value.toLowerCase().replace(/:\/\/$/, "")
  if (lower === "http") return "http"
  return "https"
}
