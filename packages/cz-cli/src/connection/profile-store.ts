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

/**
 * Set `default_profile` to `name`, preserving every other top-level key and the
 * profiles table. Uses the same CLICKZETTA_TEST_HOME-aware, atomic, 0600 write
 * as the rest of this module. Mirrors {@link saveProfiles}/{@link setTelemetry}:
 * a missing/corrupt file starts fresh, but a failed write propagates so the
 * caller's error handler can report it.
 */
export function setDefaultProfile(name: string): void {
  let existing: Record<string, unknown> = {}
  try {
    existing = parseTOML(readFileSync(profilesFile(), "utf-8")) as Record<string, unknown>
  } catch {
    // file doesn't exist or is invalid — start fresh
  }
  existing.default_profile = name
  writeProfilesFile(stringifyTOML(existing))
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
 * are written (userId → `user_id`, aimeshEndpointBaseUrl → same key). Best-effort:
 * never throws, and never touches the profile's `oauth` subtable or unrelated
 * fields.
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
    aimeshEndpointBaseUrl?: string
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
    assign("aimeshEndpointBaseUrl", fields.aimeshEndpointBaseUrl)
    if (typeof fields.userId === "number" && fields.userId > 0) profile["user_id"] = fields.userId
    if (typeof fields.accountId === "number" && fields.accountId > 0) profile["account_id"] = fields.accountId

    data.profiles = profiles
    writeProfilesFile(stringifyTOML(data))
  } catch {
    // best-effort: never block the CLI
  }
}

/**
 * Point a profile at a shared `[oauth.<id>]` token section by writing its
 * `oauth = "<id>"` field. Best-effort; never throws. The profile row must
 * already exist (materialize it first).
 */
export function setProfileOAuthPointer(profileName: string, oauthId: string): void {
  try {
    const data = parseTOML(readFileSync(profilesFile(), "utf-8")) as Record<string, unknown>
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
    if (!profiles[profileName]) return
    profiles[profileName].oauth = oauthId
    data.profiles = profiles
    writeProfilesFile(stringifyTOML(data))
  } catch {
    // best-effort: never block the CLI
  }
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

/** Generate a short random id naming a shared top-level `[oauth.<id>]` section. */
export function generateOAuthId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `cz${hex}`
}

/**
 * Make a user-supplied session name safe as a TOML bare key for `[oauth.<id>]`
 * and as a profile-name prefix: collapse anything outside [A-Za-z0-9_-] to '_'.
 * Empty input falls back to "default".
 */
export function sanitizeOAuthId(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_-]/g, "_")
  return cleaned.length > 0 ? cleaned : "default"
}

/** Parse a raw `[oauth.<id>]` entry into an AuthToken, or undefined if invalid. */
function parseOAuthEntry(entry: Record<string, unknown> | undefined): AuthToken | undefined {
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
}

function tokenToEntry(token: AuthToken): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    access_token: token.token,
    expire_time_ms: token.expireTimeMs,
    obtained_at: token.obtainedAt,
    instance_id: token.instanceId,
    user_id: token.userId,
  }
  if (token.refreshToken !== undefined) entry.refresh_token = token.refreshToken
  return entry
}

/**
 * Resolve the shared-oauth id a profile points at. New layout stores a string
 * pointer (`oauth = "<id>"`); returns undefined when absent or (legacy) an
 * inline object — the caller falls back to the legacy inline read.
 */
function profileOAuthPointer(profile: Record<string, unknown> | undefined): string | undefined {
  const p = profile?.oauth
  return typeof p === "string" && p.length > 0 ? p : undefined
}

/**
 * Build a profile-backed {@link TokenStore} for the SHARED-oauth layout: the
 * token lives once in a top-level `[oauth.<id>]` section, and each profile that
 * uses it carries an `oauth = "<id>"` pointer. Many profiles (one per
 * instance×workspace) can share a single login this way.
 *
 * - `oauthId` (optional): the shared section id. Provisioning passes it so all
 *   the profiles it writes point at the same token. When omitted (the runtime
 *   SQL path), the id is resolved from the profile's own `oauth` pointer.
 * - Backward compatibility: if a profile still has an inline
 *   `[profiles.<name>.oauth.<key>]` object (pre-migration), `load` reads the
 *   first entry from it so existing logins keep working until migrated.
 * - `clear` is intentionally a NO-OP: a shared token must not be deleted on one
 *   profile's refresh failure (that would sign out every sibling profile).
 *   Matching gh/aws/gcloud/kubectl, a failed refresh surfaces an error telling
 *   the user to re-run `cz-cli login`; only an explicit logout removes tokens.
 *
 * All operations are best-effort and never throw. Token values are never logged.
 */
export function makeProfileTokenStore(profileName: string | undefined, oauthId?: string): TokenStore {
  return {
    load(): AuthToken | undefined {
      try {
        const data = parseTOML(readFileSync(profilesFile(), "utf-8")) as Record<string, unknown>
        const name = resolveProfileName(data, profileName)
        if (!name) return undefined
        const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
        const profile = profiles[name]

        // New shared layout: profile.oauth is a string id → top-level [oauth.<id>].
        const id = oauthId ?? profileOAuthPointer(profile)
        if (id) {
          const shared = (data.oauth ?? {}) as Record<string, unknown>
          const entry = shared[id] as Record<string, unknown> | undefined
          const parsed = parseOAuthEntry(entry)
          if (parsed) return parsed
        }

        // Legacy fallback: inline [profiles.<name>.oauth.<key>] object.
        const inline = profile?.oauth
        if (inline && typeof inline === "object" && !Array.isArray(inline)) {
          for (const value of Object.values(inline as Record<string, unknown>)) {
            const parsed = parseOAuthEntry(value as Record<string, unknown>)
            if (parsed) return parsed
          }
        }
        return undefined
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

        // Resolve the shared id: explicit > existing pointer > freshly generated.
        const id = oauthId ?? profileOAuthPointer(profile) ?? generateOAuthId()

        const shared = (data.oauth ?? {}) as Record<string, unknown>
        shared[id] = tokenToEntry(token)
        data.oauth = shared

        // Point this profile at the shared section.
        profile.oauth = id
        profiles[name] = profile
        data.profiles = profiles
        writeProfilesFile(stringifyTOML(data))
      } catch {
        // best-effort: never block the CLI on persistence failure
      }
    },

    clear(): void {
      // Intentional no-op — see the docblock. A shared token is never deleted on
      // a single profile's refresh failure; the error surface prompts re-login.
    },
  }
}

/**
 * Write a shared OAuth token section `[oauth.<id>]` once. Used by provisioning
 * when it creates several profiles from a single login that all point at the
 * same token. Best-effort; never throws.
 */
export function saveSharedOAuthToken(id: string, token: AuthToken): void {
  try {
    let data: Record<string, unknown> = {}
    try {
      data = parseTOML(readFileSync(profilesFile(), "utf-8")) as Record<string, unknown>
    } catch {
      // start fresh
    }
    const shared = (data.oauth ?? {}) as Record<string, unknown>
    shared[id] = tokenToEntry(token)
    data.oauth = shared
    writeProfilesFile(stringifyTOML(data))
  } catch {
    // best-effort
  }
}

/**
 * One-time startup migration: convert legacy inline
 * `[profiles.<name>.oauth.<key>]` token objects to the shared layout —
 * a top-level `[oauth.<id>]` section plus an `oauth = "<id>"` pointer on the
 * profile. Idempotent: profiles already using a string pointer are left alone.
 * Best-effort; never throws and never blocks the CLI.
 */
export function migrateInlineOAuthTokens(): void {
  try {
    const raw = readFileSync(profilesFile(), "utf-8")
    const data = parseTOML(raw) as Record<string, unknown>
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
    const shared = (data.oauth ?? {}) as Record<string, unknown>
    let changed = false

    for (const [name, profile] of Object.entries(profiles)) {
      const inline = profile?.oauth
      // Only migrate inline objects; string pointers are already migrated.
      if (!inline || typeof inline !== "object" || Array.isArray(inline)) continue

      // Take the first valid token entry from the inline object.
      let token: AuthToken | undefined
      for (const value of Object.values(inline as Record<string, unknown>)) {
        token = parseOAuthEntry(value as Record<string, unknown>)
        if (token) break
      }
      if (!token) {
        // Inline object with no usable token — drop the dangling subtable.
        delete profile.oauth
        changed = true
        continue
      }
      const id = generateOAuthId()
      shared[id] = tokenToEntry(token)
      profile.oauth = id
      changed = true
      void name
    }

    if (changed) {
      data.oauth = shared
      data.profiles = profiles
      writeProfilesFile(stringifyTOML(data))
    }
  } catch {
    // best-effort: missing/corrupt file → nothing to migrate
  }
}
