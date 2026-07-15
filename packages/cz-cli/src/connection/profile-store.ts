import { readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import { DEFAULT_CONNECTION, type ConnectionConfig, type TokenStore, type AuthToken } from "@clickzetta/sdk"

function profilesFile() {
  return join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "profiles.toml")
}

/**
 * Atomically write profiles.toml and tighten its mode to 0600.
 * The profile file may contain plaintext credentials (password / PAT), so it
 * must never be world-readable. chmod is a no-op on Windows but harmless.
 */
function writeProfilesFile(content: string): void {
  const file = profilesFile()
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true })
  const tmpFile = file + ".tmp." + Date.now()
  writeFileSync(tmpFile, content, { encoding: "utf-8", mode: 0o600 })
  renameSync(tmpFile, file)
  try {
    chmodSync(file, 0o600)
  } catch {
    // best-effort: filesystems without POSIX modes (FAT, some network mounts) just skip
  }
}

export type ProfileEntry = Record<string, unknown>

/** A profile's [agent] block: a dedicated analytics-agent identity/token, distinct
 *  from the main login. Ported from origin/main — dropped during the a2 rebase. */
export interface AgentProfileEntry {
  endpoint?: string
  token?: string
  userId?: number
  tenantId?: number
  instanceId?: number
}

function num(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) return val
  if (typeof val === "string" && val.trim() !== "") {
    const parsed = Number(val)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** Read a profile's [profiles.<name>.agent] block, if present. Returns undefined
 *  when the profile has no agent identity (the common case). */
export function readAgentProfile(profileName?: string): AgentProfileEntry | undefined {
  try {
    const text = readFileSync(profilesFile(), "utf-8")
    const data = parseTOML(text) as Record<string, unknown>
    const name = profileName ?? (data.default_profile as string | undefined) ?? Object.keys((data.profiles ?? {}) as Record<string, unknown>)[0]
    if (!name) return undefined
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
    const profile = profiles[name]
    if (!profile) return undefined
    const agent = profile.agent as Record<string, unknown> | undefined
    if (!agent || typeof agent !== "object" || Array.isArray(agent)) return undefined
    const result: AgentProfileEntry = {
      endpoint: typeof agent.endpoint === "string" ? agent.endpoint : undefined,
      token: typeof agent.token === "string" ? agent.token : undefined,
      userId: num(agent.user_id),
      tenantId: num(agent.tenant_id),
      instanceId: num(agent.instance_id),
    }
    return Object.values(result).some((value) => value !== undefined) ? result : undefined
  } catch {
    return undefined
  }
}

export function loadProfiles(): Record<string, ProfileEntry> {
  try {
    const text = readFileSync(profilesFile(), "utf-8")
    const data = parseTOML(text)
    const profiles = data.profiles
    if (profiles && typeof profiles === "object" && !Array.isArray(profiles)) {
      return profiles as Record<string, ProfileEntry>
    }
    return {}
  } catch {
    return {}
  }
}

export function saveProfiles(profiles: Record<string, ProfileEntry>): void {
  let existing: Record<string, unknown> = {}
  try {
    const text = readFileSync(profilesFile(), "utf-8")
    existing = parseTOML(text) as Record<string, unknown>
  } catch {
    // file doesn't exist or is invalid — start fresh
  }

  existing.profiles = profiles
  const content = stringifyTOML(existing)
  writeProfilesFile(content)
}

export function getDefaultProfileName(): string | undefined {
  try {
    const text = readFileSync(profilesFile(), "utf-8")
    const data = parseTOML(text)
    const name = data.default_profile
    return typeof name === "string" ? name : undefined
  } catch {
    return undefined
  }
}

export function readProfileEntry(profileName?: string): ProfileEntry | undefined {
  const profiles = loadProfiles()
  if (Object.keys(profiles).length === 0) return undefined
  if (profileName) return profiles[profileName]
  const defaultName = getDefaultProfileName()
  if (defaultName) return profiles[defaultName]
  return Object.values(profiles)[0]
}

export function getProfileConfig(profileName?: string): Partial<ConnectionConfig> | undefined {
  const profileData = readProfileEntry(profileName)
  if (!profileData) return undefined

  const cfg: Partial<ConnectionConfig> = {
    pat: str(profileData.pat, ""),
    username: str(profileData.username, ""),
    password: str(profileData.password, ""),
    service: str(profileData.service, DEFAULT_CONNECTION.service),
    protocol: normalizeProtocol(str(profileData.protocol, undefined)),
    instance: str(profileData.instance, ""),
    workspace: str(profileData.workspace, ""),
    schema: str(profileData.schema, DEFAULT_CONNECTION.schema),
    vcluster: str(profileData.vcluster, DEFAULT_CONNECTION.vcluster),
  }

  const headers: Record<string, string> = {}
  const raw = profileData.header
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      headers[String(k)] = String(v)
    }
  }
  for (const [k, v] of Object.entries(profileData)) {
    if (k.toLowerCase().startsWith("header.") && k.length > 7) {
      headers[k.slice(7)] = String(v)
    }
  }
  if (Object.keys(headers).length > 0) {
    cfg.customHeaders = headers
  }

  return cfg
}

function str(val: unknown, fallback: string): string
function str(val: unknown, fallback: undefined): string | undefined
function str(val: unknown, fallback: string | undefined): string | undefined {
  if (typeof val === "string") return val
  return fallback
}

function normalizeProtocol(value?: string): string {
  if (!value) return "https"
  const lower = value.toLowerCase().replace(/:\/\/$/, "")
  if (lower === "http") return "http"
  return "https"
}

export function readAgentEndpoint(profileName?: string): string | undefined {
  try {
    const text = readFileSync(profilesFile(), "utf-8")
    const data = parseTOML(text) as Record<string, unknown>
    const name = profileName ?? (data.default_profile as string | undefined) ?? Object.keys((data.profiles ?? {}) as Record<string, unknown>)[0]
    if (!name) return undefined
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
    const profile = profiles[name]
    if (!profile) return undefined
    if (typeof profile.analysis_agent_endpoint === "string" && profile.analysis_agent_endpoint) {
      return profile.analysis_agent_endpoint
    }
    const agent = profile.agent as Record<string, unknown> | undefined
    return (agent?.endpoint as string) || undefined
  } catch {
    return undefined
  }
}

/** Returns the current telemetry setting, or undefined if not yet configured. */
export function getTelemetry(): boolean | undefined {
  try {
    const text = readFileSync(profilesFile(), "utf-8")
    const data = parseTOML(text) as Record<string, unknown>
    if (typeof data.telemetry === "boolean") return data.telemetry
    return undefined
  } catch {
    return undefined
  }
}

export function setTelemetry(enabled: boolean): void {
  let existing: Record<string, unknown> = {}
  try {
    const text = readFileSync(profilesFile(), "utf-8")
    existing = parseTOML(text) as Record<string, unknown>
  } catch {}
  existing.telemetry = enabled
  const content = stringifyTOML(existing)
  writeProfilesFile(content)
}

/**
 * Write userId into the active profile entry so it can be used as enduser.id
 * in telemetry. No-op if the profile already has user_id — never throws.
 */
export function patchProfileUserId(profileName: string | undefined, userId: number): void {  try {
    const text = readFileSync(profilesFile(), "utf-8")
    const data = parseTOML(text) as Record<string, unknown>
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>

    const name = profileName
      ?? (typeof data.default_profile === "string" ? data.default_profile : undefined)
      ?? Object.keys(profiles)[0]
    if (!name || !profiles[name]) return

    // Already has user_id — done forever
    if (profiles[name]["user_id"] != null) return

    profiles[name]["user_id"] = userId
    data.profiles = profiles
    writeProfilesFile(stringifyTOML(data))
  } catch {
    // best-effort: never block the CLI
  }
}

/**
 * Merge logged-in connection context into the active profile entry so a later
 * `resolveConnectionConfig` picks up the instance/workspace/schema/etc. the
 * user actually authenticated against (requirement 11.6/11.7). Resolves the
 * target profile the same way other helpers do (explicit → default_profile →
 * first profile); no-op when none resolvable. Only defined, non-empty fields
 * are written (userId → `user_id`). Best-effort: never throws, and never
 * touches the profile's `oauth` subtable or unrelated fields.
 */
export function patchProfileConnection(
  profileName: string | undefined,
  fields: {
    service?: string
    protocol?: string
    instance?: string
    workspace?: string
    schema?: string
    vcluster?: string
    userId?: number
    accountId?: number
    accountName?: string
  },
): void {
  try {
    const data = parseTOML(readFileSync(profilesFile(), "utf-8")) as Record<string, unknown>
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>

    const name = resolveProfileName(data, profileName)
    if (!name || !profiles[name]) return

    const profile = profiles[name]
    const assign = (key: string, value: string | undefined) => {
      if (value !== undefined && value.length > 0) profile[key] = value
    }
    assign("service", fields.service)
    assign("protocol", fields.protocol)
    assign("instance", fields.instance)
    assign("workspace", fields.workspace)
    assign("schema", fields.schema)
    assign("vcluster", fields.vcluster)
    assign("account_name", fields.accountName)
    if (typeof fields.userId === "number" && fields.userId > 0) profile["user_id"] = fields.userId
    if (typeof fields.accountId === "number" && fields.accountId > 0) profile["account_id"] = fields.accountId

    data.profiles = profiles
    writeProfilesFile(stringifyTOML(data))
  } catch {
    // best-effort: never block the CLI
  }
}

/**
 * Archive the FULL `/oauth2/userinfo` body verbatim into the active profile
 * under `[profiles.<name>.userinfo]` so nothing is discarded (requirement
 * 11.9). The userinfo carries nested values (`instanceList` is an array of
 * objects, `gatewayMapping` is a JSON string); smol-toml `stringify` round-
 * trips these losslessly (verified: write → re-parse → deep-equal), so we
 * persist as a native nested TOML subtable rather than a JSON blob. Resolves
 * the target profile like the other helpers do; no-ops when none resolvable or
 * the body is empty. Best-effort: never throws, and never touches the profile's
 * `oauth` subtable or unrelated fields. Sensitive values (e.g. `apiKey`) are
 * stored under the same `0o600` file and are never printed.
 */
export function patchProfileUserInfo(profileName: string | undefined, userInfo: Record<string, unknown>): void {
  if (!userInfo || Object.keys(userInfo).length === 0) return
  try {
    const data = parseTOML(readFileSync(profilesFile(), "utf-8")) as Record<string, unknown>
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>

    const name = resolveProfileName(data, profileName)
    if (!name || !profiles[name]) return

    profiles[name]["userinfo"] = userInfo
    data.profiles = profiles
    writeProfilesFile(stringifyTOML(data))
  } catch {
    // best-effort: never block the CLI
  }
}

/**
 * Deterministically map a cacheKey (e.g. "instance:pat-or-username") to a TOML
 * bare-key-safe string. The raw cacheKey may contain ':' and other characters
 * that complicate quoting, so we collapse anything outside [A-Za-z0-9_] to '_'.
 * The mapping is stable, so save/load/clear stay consistent for the same key.
 */
function sanitizeCacheKey(cacheKey: string): string {
  return cacheKey.replace(/[^A-Za-z0-9_]/g, "_")
}

/**
 * Resolve the profile entry name the same way the other helpers do:
 * explicit name → default_profile → first profile. Returns undefined when no
 * profile can be resolved (e.g. empty/missing profiles.toml).
 */
function resolveProfileName(data: Record<string, unknown>, profileName: string | undefined): string | undefined {
  const profiles = (data.profiles ?? {}) as Record<string, unknown>
  if (profileName) return profileName
  if (typeof data.default_profile === "string") return data.default_profile
  return Object.keys(profiles)[0]
}

// cz-cli merge: the PR shipped its own simplified `num()` here; the target branch
// already has a fuller `num()` (string-parsing, used by readAgentProfile) above.
// Kept the fuller one and dropped the duplicate — both callers are number-safe.

/**
 * Build a profile-backed {@link TokenStore} that persists OAuth tokens under
 * `[profiles.<name>.oauth.<sanitizedCacheKey>]` in `~/.clickzetta/profiles.toml`.
 *
 * All operations are best-effort and never throw: the CLI must keep working
 * even when the profile file is missing, corrupt, or unwritable (requirement
 * 9.2). Token values are never logged. Writes reuse {@link writeProfilesFile}
 * for atomic replace + `0o600` permissions.
 */
export function makeProfileTokenStore(profileName: string | undefined, cacheKey: string): TokenStore {
  const key = sanitizeCacheKey(cacheKey)

  return {
    load(): AuthToken | undefined {
      try {
        const data = parseTOML(readFileSync(profilesFile(), "utf-8")) as Record<string, unknown>
        const name = resolveProfileName(data, profileName)
        if (!name) return undefined
        const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
        const oauth = profiles[name]?.oauth as Record<string, unknown> | undefined
        const entry = oauth?.[key] as Record<string, unknown> | undefined
        if (!entry) return undefined

        const token = str(entry.access_token, undefined)
        const expireTimeMs = num(entry.expire_time_ms)
        const obtainedAt = num(entry.obtained_at)
        const instanceId = num(entry.instance_id)
        const userId = num(entry.user_id)
        if (token === undefined || expireTimeMs === undefined || obtainedAt === undefined) return undefined
        if (instanceId === undefined || userId === undefined) return undefined

        const refreshToken = str(entry.refresh_token, undefined)
        const result: AuthToken = { token, instanceId, userId, expireTimeMs, obtainedAt }
        if (refreshToken !== undefined) result.refreshToken = refreshToken
        return result
      } catch {
        // best-effort: missing/corrupt file → behave as no cached token
        return undefined
      }
    },

    save(token: AuthToken): void {
      try {
        let data: Record<string, unknown> = {}
        try {
          data = parseTOML(readFileSync(profilesFile(), "utf-8")) as Record<string, unknown>
        } catch {
          // file doesn't exist or is invalid — start fresh
        }
        const name = resolveProfileName(data, profileName)
        if (!name) return

        const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
        const profile = profiles[name] ?? {}
        const oauth = (profile.oauth ?? {}) as Record<string, unknown>

        const entry: Record<string, unknown> = {
          access_token: token.token,
          expire_time_ms: token.expireTimeMs,
          obtained_at: token.obtainedAt,
          instance_id: token.instanceId,
          user_id: token.userId,
        }
        if (token.refreshToken !== undefined) entry.refresh_token = token.refreshToken

        oauth[key] = entry
        profile.oauth = oauth
        profiles[name] = profile
        data.profiles = profiles
        writeProfilesFile(stringifyTOML(data))
      } catch {
        // best-effort: never block the CLI on persistence failure
      }
    },

    clear(): void {
      try {
        const data = parseTOML(readFileSync(profilesFile(), "utf-8")) as Record<string, unknown>
        const name = resolveProfileName(data, profileName)
        if (!name) return
        const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
        const oauth = profiles[name]?.oauth as Record<string, unknown> | undefined
        if (!oauth || !(key in oauth)) return

        delete oauth[key]
        data.profiles = profiles
        writeProfilesFile(stringifyTOML(data))
      } catch {
        // best-effort: missing/corrupt file → nothing to clear
      }
    },
  }
}
