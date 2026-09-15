import { readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import {
  DEFAULT_CONNECTION,
  toServiceUrl,
  type ConnectionConfig,
  type TokenStore,
  type AuthToken,
} from "@clickzetta/sdk"
import { withProfilesTransaction, refreshOAuthToken, resolveOAuthToken, retireOAuthTokens } from "./oauth-state.js"

function profilesFile() {
  return join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "profiles.toml")
}

/**
 * A fingerprint of the profile store: its path plus the bytes at that path.
 *
 * Anything caching a profile-derived answer must key on this rather than on the profile NAME
 * (see connection/context.ts). Two reasons, and the second is the load-bearing one:
 *
 *  - two homes are two different profile universes, so the same name in each is a different
 *    account, instance and credential;
 *  - profiles.toml can change UNDER a long-lived process — a user editing it, or
 *    `cz-cli profile use` in another terminal, between two turns of an agent session. Every
 *    other read of it goes through the file on each call, so a cache that ignored the content
 *    would be the one place still answering with the previous file.
 *
 * Cheap next to what it guards: one read of a small file, against a portal round trip.
 */
export function profileStoreFingerprint(): string {
  const file = profilesFile()
  try {
    return `${file}#${createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16)}`
  } catch {
    // Absent or unreadable is itself a state worth keying on: a context derived with no
    // profiles.toml must not answer for one that appears later.
    return `${file}#none`
  }
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

/**
 * Read the parsed document WITHOUT taking the lock, for a caller that must first
 * decide whether it has anything to write at all.
 *
 * The startup pair (`migrateInlineOAuthTokens`, `pruneOrphanOAuthSections`) are
 * no-ops in the steady state but run on every invocation, and taking the write lock
 * before discovering that would put two acquisitions in front of every `cz-cli`
 * start — worst case the whole sync wait, twice, while a peer holds the lock across
 * a token round trip. That is this PR's own motivating scenario (an agent shelling
 * out to N processes), so: check unlocked, then lock only if there is work.
 * `mutateProfilesFile` re-reads inside the lock, so the check being stale is safe —
 * it can only cost a lock taken for nothing, never a decision made on old bytes.
 */
function peekProfilesFile(): Record<string, unknown> {
  try {
    return parseTOML(readFileSync(profilesFile(), "utf-8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * THE read-modify-write primitive for profiles.toml. Every mutator goes through
 * it, and that is the point: the parse and the write have to happen inside one
 * cross-process lock, or two processes interleave and one update is lost.
 *
 * The lost update that made this necessary is a rotated OAuth token — the loser's
 * write puts a refresh token the server has already invalidated back on disk, and
 * the next process to use it gets `invalid_grant`. Profile edits (`profile use`,
 * `auth login`, instance-id backfill) lose the same way, just less loudly.
 *
 * `mutate` receives the freshly parsed document and returns the one to write, or
 * `undefined` to write nothing (every "already set → leave it" branch). A missing
 * or corrupt file parses as `{}`, matching what each mutator did on its own.
 *
 * Exported because the profile-editing commands (`profile create/update/delete/use`,
 * `auth logout`, `setup`) each grew their own `loadFullFile`/`saveFullFile` pair over
 * the whole TOML document. Those pairs are this same read-modify-write with the lock
 * missing — and one of them wrote the file without the 0600 the credentials in it
 * require. They call this instead.
 *
 * Callers stay synchronous. A SQLite write transaction serializes the whole
 * read/modify/write; contention fails rather than running unlocked.
 */
export function mutateProfilesFile(
  mutate: (data: Record<string, unknown>) => Record<string, unknown> | undefined,
): void {
  withProfilesTransaction(() => {
    let data: Record<string, unknown> = {}
    try {
      data = parseTOML(readFileSync(profilesFile(), "utf-8")) as Record<string, unknown>
    } catch {
      // absent or corrupt — start fresh, exactly as every mutator did before
    }
    const tokens = oauthTokens(data)
    const next = mutate(data)
    if (next) {
      retireOAuthTokens(tokens, oauthTokens(next))
      writeProfilesFile(stringifyTOML(next))
    }
  })
}

/** Include legacy inline credentials so migration and logout preserve replay history. */
function oauthTokens(data: Record<string, unknown>): AuthToken[] {
  const shared = Object.values((data.oauth ?? {}) as Record<string, Record<string, unknown>>)
  const profiles = Object.values((data.profiles ?? {}) as Record<string, Record<string, unknown>>)
  const inline = profiles.flatMap((profile) =>
    profile.oauth && typeof profile.oauth === "object"
      ? Object.values(profile.oauth as Record<string, Record<string, unknown>>)
      : [],
  )
  return [...shared, ...inline].map(parseOAuthEntry).filter((token): token is AuthToken => token !== undefined)
}

// This queue reduces duplicate work within one process. The persistent refresh
// claim, keyed by the token itself, excludes other processes and survives crashes.
const refreshes = new Map<string, Promise<unknown>>()

export function withOAuthRefreshLock<T>(oauthId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${profilesFile()}:${oauthId}`
  const previous = refreshes.get(key) ?? Promise.resolve()
  const result = previous.then(fn, fn)
  refreshes.set(key, result)
  return result.finally(() => {
    if (refreshes.get(key) === result) refreshes.delete(key)
  })
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

/**
 * Numeric coercion for a raw TOML value; undefined when it is not a finite number.
 *
 * Exported as `numericField` so callers outside this module stop growing their own copies —
 * exec.ts had a third one whose docstring described THIS behaviour while its body returned
 * 0 and accepted whitespace-only strings.
 */
export function numericField(val: unknown): number | undefined {
  return num(val)
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
    const name =
      profileName ??
      (data.default_profile as string | undefined) ??
      Object.keys((data.profiles ?? {}) as Record<string, unknown>)[0]
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

/**
 * Replace the whole profiles table with `profiles`.
 *
 * Locked, but that only makes the WRITE atomic — the caller decided what to write
 * from a read it took earlier, and this replaces the entire table with that
 * snapshot. Any field a peer wrote in between (an `oauth` pointer, `instance_id`,
 * `auth_type`) is gone. Prefer {@link updateProfiles}, which reads inside the lock;
 * this remains for callers that legitimately own the whole table.
 */
export function saveProfiles(profiles: Record<string, ProfileEntry>): void {
  mutateProfilesFile((existing) => {
    existing.profiles = profiles
    return existing
  })
}

/**
 * Read-modify-write the profiles table INSIDE the lock: `mutate` receives the table
 * as it is on disk right now and edits it in place, returning false to write nothing.
 *
 * This is the half a locked `saveProfiles` cannot give you. `loadProfiles()` →
 * edit one field → `saveProfiles()` leaves the read outside the exclusion, so a peer
 * that wrote between the two has its field replaced by the caller's older snapshot of
 * the whole table — the same lost update as before, just narrower. `workspace use`
 * and every profile-materializing step of a login are that shape.
 *
 * Errors propagate, like {@link saveProfiles}: these callers report failures.
 */
export function updateProfiles(mutate: (profiles: Record<string, ProfileEntry>) => boolean | void): void {
  mutateProfilesFile((data) => {
    const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
    if (mutate(profiles) === false) return undefined
    data.profiles = profiles
    return data
  })
}

/**
 * Set `default_profile` to `name`, preserving every other top-level key and the
 * profiles table. Uses the same CLICKZETTA_TEST_HOME-aware, atomic, 0600 write
 * as the rest of this module. Mirrors {@link saveProfiles}:
 * a missing/corrupt file starts fresh, but a failed write propagates so the
 * caller's error handler can report it.
 */
export function setDefaultProfile(name: string): void {
  mutateProfilesFile((existing) => {
    existing.default_profile = name
    return existing
  })
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

// cz_change: WHICH profile is active is NOT here — it is process state that can
// change mid-session, so it lives in connection/profile-context.ts as a
// `current()` / `set()` / `onChange()` trio (import it as a namespace:
// `import * as Profile from "./profile-context.js"`). This module owns the
// profiles.toml STORE — reading and writing entries — and deliberately does not
// re-export that trio: a second name for the same function is a second entry point
// in practice, which is the duplication the split exists to remove.
//
// `getDefaultProfileName` above is the FALLBACK, not the active profile. Reading it
// directly is almost always a bug — see Profile.current().

export function readProfileEntry(profileName?: string): ProfileEntry | undefined {
  const profiles = loadProfiles()
  if (Object.keys(profiles).length === 0) return undefined
  if (profileName) return profiles[profileName]
  const defaultName = getDefaultProfileName()
  if (defaultName) return profiles[defaultName]
  return Object.values(profiles)[0]
}

/**
 * Which credential a profile authenticates with. One value per login path:
 * `pat` (loginWithPat), `password` (loginWithPassword), `oauth` (loginWithBrowser's
 * refresh token via `[oauth.<id>]`), `cookie` (a pasted `header.Cookie`).
 */
export type AuthType = "pat" | "password" | "oauth" | "cookie"

/**
 * The `auth_type` values, as named constants.
 *
 * Write sites MUST use these rather than a bare string literal. `ProfileEntry` is
 * `Record<string, unknown>`, so `auth_type: "passwrod"` typechecks silently, and the
 * mistake would only surface as a runtime INVALID_AUTH_TYPE for the end user — after
 * shipping. Referencing a constant turns it into a build failure instead. A value a
 * USER hand-writes gets the runtime check ({@link invalidAuthType}); this guards the
 * values WE write.
 */
export const AUTH_TYPE = {
  pat: "pat",
  password: "password",
  oauth: "oauth",
  cookie: "cookie",
} as const satisfies Record<AuthType, AuthType>

const AUTH_TYPES: readonly AuthType[] = Object.values(AUTH_TYPE)

/**
 * Infer the credential a profile would use from the fields it actually carries.
 *
 * ONLY for profiles with no explicit `auth_type` — i.e. every profile written
 * before that field existed. The order mirrors the effective runtime precedence
 * so a derived value reproduces today's behavior exactly rather than changing it:
 * a cookie is consulted before the OAuth token (`getCookieToken() ?? getToken()`),
 * and a persisted OAuth token is consulted before a profile pat/password
 * (`getToken` reads `config.tokenStore` before `fetchToken`).
 *
 * Returns undefined when the profile carries no credential at all, which the
 * callers surface rather than guessing.
 */
export function deriveAuthType(profile: ProfileEntry | undefined): AuthType | undefined {
  if (!profile) return undefined
  if (hasCookieHeader(profile)) return "cookie"
  if (typeof profile.oauth === "string" && profile.oauth.length > 0) return "oauth"
  if (typeof profile.pat === "string" && profile.pat.length > 0) return "pat"
  if (
    typeof profile.username === "string" &&
    profile.username.length > 0 &&
    typeof profile.password === "string" &&
    profile.password.length > 0
  )
    return "password"
  return undefined
}

/** True when the profile carries a `Cookie` header in either storage shape. */
function hasCookieHeader(profile: ProfileEntry): boolean {
  const header = profile.header
  if (header && typeof header === "object" && !Array.isArray(header)) {
    if (Object.keys(header as Record<string, unknown>).some((k) => k.toLowerCase() === "cookie")) return true
  }
  return Object.keys(profile).some((k) => k.toLowerCase() === "header.cookie")
}

/**
 * An `auth_type` that is present but not one of the four known values.
 *
 * Reported rather than ignored: profiles.toml is hand-editable, so `auth_type =
 * "passwrod"` is a realistic typo, and silently treating it as absent falls back
 * to the ambiguous credential precedence this field exists to remove — the CLI
 * could authenticate as a different identity than the user pinned, with no
 * message anywhere. A wrong credential is worth a hard error.
 *
 * Returns the offending raw string, or undefined when `auth_type` is absent
 * (legitimate — every pre-existing profile) or valid.
 */
export function invalidAuthType(profile: ProfileEntry | undefined): string | undefined {
  const raw = profile?.auth_type
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== "string") return String(raw)
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined // `auth_type = ""` reads as "unset"
  return AUTH_TYPES.includes(trimmed.toLowerCase() as AuthType) ? undefined : raw
}

/** The message used wherever an invalid `auth_type` is surfaced. */
export function invalidAuthTypeMessage(profileName: string | undefined, raw: string): string {
  return (
    `Profile '${profileName ?? "(default)"}' has an invalid auth_type: ${JSON.stringify(raw)}. ` +
    `Valid values are ${AUTH_TYPES.map((t) => `"${t}"`).join(", ")}. ` +
    `Fix it in ~/.clickzetta/profiles.toml, or remove the line to fall back to automatic detection.`
  )
}

/**
 * A profile's EXPLICIT `auth_type`, or undefined when absent/unrecognized.
 *
 * Deliberately separate from {@link deriveAuthType}: an explicit value is
 * authoritative and selects the credential outright, so callers must be able to
 * tell "the user pinned this" from "we guessed".
 *
 * An unrecognized string returns undefined HERE, but callers that act on the
 * credential must reject it first via {@link invalidAuthType} — this function is
 * also used by read-only surfaces (`profile list`) that need to keep working so
 * the user can actually see the bad value.
 */
export function explicitAuthType(profile: ProfileEntry | undefined): AuthType | undefined {
  const raw = profile?.auth_type
  if (typeof raw !== "string") return undefined
  const value = raw.trim().toLowerCase() as AuthType
  return AUTH_TYPES.includes(value) ? value : undefined
}

/**
 * The credential this profile uses: its explicit `auth_type` when set, otherwise
 * a derived guess. Never writes — reading a profile must not mutate it, so
 * `profile list` stays free of write side effects and an old profile keeps
 * working untouched.
 */
export function readAuthType(profileName?: string): AuthType | undefined {
  const profile = readProfileEntry(profileName)
  return explicitAuthType(profile) ?? deriveAuthType(profile)
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
    // Absent on profiles written before instance_id moved off the token; getExecContext
    // resolves it by name and writes it back, so this fills in on first use.
    ...(num(profileData.instance_id) !== undefined ? { instanceId: num(profileData.instance_id) } : {}),
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
    const name =
      profileName ??
      (data.default_profile as string | undefined) ??
      Object.keys((data.profiles ?? {}) as Record<string, unknown>)[0]
    if (!name) return undefined
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
    const profile = profiles[name]
    if (!profile) return undefined
    if (typeof profile.analysis_agent_endpoint === "string" && profile.analysis_agent_endpoint) {
      return profile.analysis_agent_endpoint
    }
    const agent = profile.agent as Record<string, unknown> | undefined
    if (typeof agent?.endpoint === "string" && agent.endpoint) {
      return agent.endpoint
    }
    return inferAgentEndpoint(profile)
  } catch {
    return undefined
  }
}

function inferAgentEndpoint(profile: Record<string, unknown>): string | undefined {
  const service = str(profile.service, "")
  if (!service) return undefined
  return `${toServiceUrl(service, normalizeProtocol(str(profile.protocol, undefined)))}/clickzetta-campaign-data`
}

/**
 * Record how a profile authenticates — but ONLY when it has no `auth_type` yet.
 *
 * Never overwrites, deliberately, including on re-login. `auth_type` selects which
 * of a profile's credentials is used, so it is a user-owned setting: a `cz-cli
 * profile create --pat` (or a hand-added pat) on a profile pinned to `oauth` must
 * not silently repoint it and change which identity every later command runs as.
 * Someone who wants to change it edits profiles.toml.
 *
 * Best-effort; never throws (a login must not fail over a bookkeeping field).
 */
export function setAuthTypeIfAbsent(profileName: string | undefined, authType: AuthType): void {
  if (!profileName) return
  try {
    if (!needsField(peekProfilesFile(), profileName, "auth_type")) return
    mutateProfilesFile((data) => {
      const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
      const profile = profiles[profileName]
      if (!profile) return undefined
      // Any pre-existing value wins, including an invalid one. Overwriting would
      // "fix" a typo by silently choosing a credential for the user; instead the
      // credential-selecting path rejects it loudly (see invalidAuthType).
      if (typeof profile.auth_type === "string" && profile.auth_type.trim().length > 0) return undefined
      profile.auth_type = authType
      data.profiles = profiles
      return data
    })
  } catch {
    // best-effort: never block a login
  }
}

/** Legacy content preference; new settings are written to czcli.json. */
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

/**
 * Write userId into the active profile entry so it can be used as enduser.id
 * in telemetry. No-op if the profile already has user_id — never throws.
 */
export function patchProfileUserId(profileName: string | undefined, userId: number): void {
  try {
    // Checked unlocked first: this runs on every exec and writes nothing once
    // backfilled, and taking the write lock to discover that would put a contended
    // acquire in front of every command. `mutateProfilesFile` re-reads inside the
    // lock, so a stale check can only cost a lock taken for nothing.
    if (!needsField(peekProfilesFile(), profileName, "user_id")) return
    mutateProfilesFile((data) => {
      const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
      const name = resolveProfileName(data, profileName)
      if (!name || !profiles[name]) return undefined

      // Already has user_id — done forever
      if (profiles[name]["user_id"] != null) return undefined

      profiles[name]["user_id"] = userId
      data.profiles = profiles
      return data
    })
  } catch {
    // best-effort: never block the CLI
  }
}

/**
 * Backfill a profile's numeric `instance_id`, resolved from its instance NAME.
 *
 * Only for profiles written before the id moved off the token — a login now records it
 * from the enumeration it already has (see provisionOAuthProfiles), so this runs once
 * per stale profile and then never again. Best-effort like patchProfileUserId: the CLI
 * has the value in hand either way, and failing to cache it must not fail the command.
 *
 * Writes only when absent, so it can never overwrite a value the server told a login.
 */
export function patchProfileInstanceId(profileName: string | undefined, instanceId: number): void {
  if (!Number.isFinite(instanceId) || instanceId <= 0) return
  try {
    if (!needsField(peekProfilesFile(), profileName, "instance_id")) return
    mutateProfilesFile((data) => {
      const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
      const name = resolveProfileName(data, profileName)
      if (!name || !profiles[name]) return undefined
      if (profiles[name]["instance_id"] != null) return undefined
      profiles[name]["instance_id"] = instanceId
      data.profiles = profiles
      return data
    })
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
    /** Numeric id of `instance`. A login already knows it; see ConnectionConfig.instanceId. */
    instanceId?: number
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
    mutateProfilesFile((data) => {
      const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>

      const name = resolveProfileName(data, profileName)
      if (!name || !profiles[name]) return undefined

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
      // Written unconditionally, unlike patchProfileInstanceId's write-only-if-absent: this
      // is a login reporting what the server just said, so it also CORRECTS a value an older
      // version cached from the wrong source.
      if (typeof fields.instanceId === "number" && fields.instanceId > 0) profile["instance_id"] = fields.instanceId
      if (typeof fields.accountId === "number" && fields.accountId > 0) profile["account_id"] = fields.accountId

      data.profiles = profiles
      return data
    })
  } catch {
    // best-effort: never block the CLI
  }
}

/**
 * Clear residue that would shadow or contradict a fresh OAuth login on `name`:
 *   - `header.Cookie` (both the `[profiles.<name>.header]` sub-table entry and
 *     any flattened `header.Cookie` key). A stale cookie token is consulted
 *     BEFORE the OAuth token at runtime (getCookieToken ?? getToken), so leaving
 *     it makes a freshly re-provisioned profile keep using the old cookie.
 *   - stale connection identity keys (`instance`, `workspace`, `service`) when
 *     the new login does NOT supply them. patchProfileConnection only writes
 *     non-empty values, so without this a weaker re-login (e.g. a trial account
 *     with no instance) would retain a previous `instance="default"` placeholder
 *     that the backend rejects. `keep` lists the keys the new login WILL set, so
 *     we only strip the ones it won't.
 * Best-effort; never throws. Call BEFORE patchProfileConnection writes the new
 * values so the subsequent patch re-populates whatever the login does provide.
 */
export function clearOAuthLoginResidue(
  profileName: string | undefined,
  keep: { instance?: boolean; workspace?: boolean; service?: boolean },
): void {
  try {
    mutateProfilesFile((data) => {
      const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
      const name = resolveProfileName(data, profileName)
      if (!name || !profiles[name]) return undefined
      const profile = profiles[name]

      // Drop the cookie header in both storage shapes.
      const header = profile.header
      if (header && typeof header === "object" && !Array.isArray(header)) {
        for (const k of Object.keys(header as Record<string, unknown>)) {
          if (k.toLowerCase() === "cookie") delete (header as Record<string, unknown>)[k]
        }
        if (Object.keys(header as Record<string, unknown>).length === 0) delete profile.header
      }
      for (const k of Object.keys(profile)) {
        if (k.toLowerCase() === "header.cookie") delete profile[k]
      }

      // Strip stale connection identity the new login won't overwrite.
      if (!keep.instance) delete profile.instance
      if (!keep.workspace) delete profile.workspace
      if (!keep.service) delete profile.service

      profiles[name] = profile
      data.profiles = profiles
      return data
    })
  } catch {
    // best-effort: never block login on cleanup
  }
}

/**
 * Point a profile at a shared `[oauth.<id>]` token section by writing its
 * `oauth = "<id>"` field. Best-effort; never throws. The profile row must
 * already exist (materialize it first).
 */
export function setProfileOAuthPointer(profileName: string, oauthId: string): void {
  try {
    mutateProfilesFile((data) => {
      const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
      if (!profiles[profileName]) return undefined
      profiles[profileName].oauth = oauthId
      data.profiles = profiles
      return data
    })
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
  const userId = num(entry.user_id)
  // entry.instance_id is deliberately NOT read. Older versions wrote one here and REQUIRED
  // it, which is why dropping it needs this to change in the same commit: a reader that
  // still demanded it would treat every newly written section as invalid.
  if (token === undefined || expireTimeMs === undefined || obtainedAt === undefined) return undefined
  if (userId === undefined) return undefined
  const refreshToken = str(entry.refresh_token, undefined)
  // OAuth issuer host — required to target `/oauth2/token` on refresh (the
  // region business host in the profile's `service` returns invalid_grant).
  const issuer = str(entry.issuer, undefined)
  const result: AuthToken = { token, userId, expireTimeMs, obtainedAt }
  if (refreshToken !== undefined) result.refreshToken = refreshToken
  if (issuer !== undefined) result.issuer = issuer
  return result
}

function tokenToEntry(token: AuthToken): Record<string, unknown> {
  // No instance_id: this section is SHARED by every profile the login can reach, and an
  // instance is per-profile — see ConnectionConfig.instanceId. Sections written by older
  // versions still carry one; parseOAuthEntry ignores it.
  const entry: Record<string, unknown> = {
    access_token: token.token,
    expire_time_ms: token.expireTimeMs,
    obtained_at: token.obtainedAt,
    user_id: token.userId,
  }
  if (token.refreshToken !== undefined) entry.refresh_token = token.refreshToken
  if (token.issuer !== undefined) entry.issuer = token.issuer
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
 * - `withLock` coalesces local work. `refresh` durably records one use per refresh
 *   token in SQLite, independent of profile/session names. `load` resolves legacy
 *   TOML seeds to the latest result there. Keep both files when backing up.
 *
 * Runtime-state read/refresh failures propagate: they must never become permission
 * to reuse an old token. Token values are never logged.
 */
export function makeProfileTokenStore(profileName: string | undefined, oauthId?: string): TokenStore {
  function readToken(): AuthToken | undefined {
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
  }

  return {
    load(): AuthToken | undefined {
      const token = readToken()
      return token ? resolveOAuthToken(token) : undefined
    },

    refresh: refreshOAuthToken,

    save(token: AuthToken, condition?: { expected: AuthToken | undefined }): boolean {
      // Whether the write landed. A CAS miss is not an error — it means a peer wrote a
      // newer token, which is the answer the caller wanted anyway.
      let wrote = false
      try {
        mutateProfilesFile((data) => {
          const name = resolveProfileName(data, profileName)
          if (!name) return undefined

          const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
          const profile = profiles[name] ?? {}

          // Resolve the shared id: explicit (provisioning) > the profile's existing
          // pointer. NEVER freshly generated.
          //
          // Minting an id here is what produced drifts of orphan `[oauth.cz<random>]`
          // sections. Only `cz-cli login` establishes an OAuth identity, and it always
          // passes an explicit, stable id (the session name). A save with neither an
          // explicit id nor an existing pointer is therefore never an OAuth login —
          // it is some other credential's token arriving through an over-attached
          // store, and a random id gives it a section nothing owns: the next run
          // reads no pointer, mints another, and the file grows without bound.
          // Dropping the write keeps such a token in memory only, which is where a
          // non-OAuth credential's token belongs.
          const id = oauthId ?? profileOAuthPointer(profile)
          if (!id) return undefined

          const shared = (data.oauth ?? {}) as Record<string, unknown>
          // The compare half of compare-and-swap, evaluated INSIDE the lock against the
          // bytes on disk. `condition` carries what the caller read before it rotated; if
          // the slot has moved on since, a peer rotated and this write would undo it.
          if (
            condition &&
            !sameToken(parseOAuthEntry(shared[id] as Record<string, unknown> | undefined), condition.expected)
          ) {
            return undefined
          }
          shared[id] = tokenToEntry(token)
          data.oauth = shared

          // Point this profile at the shared section.
          profile.oauth = id
          profiles[name] = profile
          data.profiles = profiles
          wrote = true
          return data
        })
      } catch {
        return false
      }
      return wrote
    },

    clear(): void {
      // Intentional no-op — see the docblock. A shared token is never deleted on
      // a single profile's refresh failure; the error surface prompts re-login.
    },

    withLock<T>(critical: () => Promise<T>): Promise<T> {
      // Local queue only; the durable refresh claim provides cross-process safety.
      const id = oauthId ?? profileOAuthPointer(readProfileEntry(profileName) as Record<string, unknown> | undefined)
      return id ? withOAuthRefreshLock(id, critical) : critical()
    },
  }
}

/**
 * Does `[oauth.<id>]` already exist? One of the two inputs to
 * {@link oauthSessionProvisioned}, which is what classifies a login — the section
 * alone is not enough, and that function explains why. Best-effort: an unreadable
 * file reads as "no section".
 */
export function oauthSectionExists(id: string): boolean {
  try {
    const data = parseTOML(readFileSync(profilesFile(), "utf-8")) as Record<string, unknown>
    const shared = data.oauth
    if (!shared || typeof shared !== "object" || Array.isArray(shared)) return false
    return (shared as Record<string, unknown>)[id] !== undefined
  } catch {
    return false
  }
}

/**
 * Has this session name been provisioned before? The signal a login uses to tell a
 * first login from a re-login.
 *
 * Two sources, because either one alone is incomplete. The token section is the
 * obvious one, but `auth logout <name> --keep-profiles` deletes it while leaving
 * every `<base>_N` row (pointer, auth_type and the user's edits included), so a
 * section check alone would call the next login a FIRST login and let it rewrite
 * llm.json, header.Cookie and default_profile over state the user asked to keep.
 * Profiles pointing at the session close that gap.
 *
 * Still no account comparison: `[oauth.*].user_id` is backfilled from userinfo and
 * may be absent, and a missing field must never be able to reclassify a re-login.
 * Best-effort: an unreadable file reads as "not provisioned", which provisions
 * rather than skips.
 */
export function oauthSessionProvisioned(id: string): boolean {
  if (oauthSectionExists(id)) return true
  try {
    return Object.values(loadProfiles()).some((entry) => entry.oauth === id)
  } catch {
    return false
  }
}

/**
 * Write a shared OAuth token section `[oauth.<id>]` once. Used by provisioning
 * when it creates several profiles from a single login that all point at the
 * same token. Persistence errors must fail login rather than report success.
 */
export function saveSharedOAuthToken(id: string, token: AuthToken): void {
  mutateProfilesFile((data) => {
    const shared = (data.oauth ?? {}) as Record<string, unknown>
    shared[id] = tokenToEntry(token)
    data.oauth = shared
    return data
  })
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
    if (!hasInlineOAuth(peekProfilesFile())) return
    mutateProfilesFile((data) => {
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

      if (!changed) return undefined
      data.oauth = shared
      data.profiles = profiles
      return data
    })
  } catch {
    // best-effort: missing/corrupt file → nothing to migrate
  }
}

/**
 * Delete `[oauth.<id>]` sections that no profile points at.
 *
 * Two ways they arise:
 *   - the fixed over-attachment bug: a username/password or pat profile got an
 *     OAuth token store, and its login JWT was saved under a freshly minted
 *     random id. Every distinct profile sharing one identity minted its own, so
 *     the file accumulated a section per profile per re-login.
 *   - `profile delete` removes the profile row but not the section it pointed at.
 *
 * Only unreferenced sections go. A section any profile still points at is a live
 * login and is kept, so this can never sign a user out. Runs after
 * {@link migrateInlineOAuthTokens} so freshly migrated pointers count as
 * references. Best-effort; never throws.
 */
export function pruneOrphanOAuthSections(): void {
  try {
    if (!hasOrphanOAuthSection(peekProfilesFile())) return
    mutateProfilesFile((data) => {
      const shared = data.oauth
      if (!shared || typeof shared !== "object" || Array.isArray(shared)) return undefined
      const sections = shared as Record<string, unknown>

      const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
      const referenced = new Set<string>()
      for (const profile of Object.values(profiles)) {
        const id = profileOAuthPointer(profile)
        if (id) referenced.add(id)
      }

      let removed = false
      for (const id of Object.keys(sections)) {
        if (referenced.has(id)) continue
        delete sections[id]
        removed = true
      }
      if (!removed) return undefined

      // Drop an emptied table rather than leaving a bare `[oauth]` header behind.
      if (Object.keys(sections).length === 0) delete data.oauth
      else data.oauth = sections
      return data
    })
  } catch {
    // best-effort: missing/corrupt file → nothing to prune
  }
}

/** Does any profile still carry a legacy inline `oauth` table? The unlocked
 *  precondition for {@link migrateInlineOAuthTokens}. */
function hasInlineOAuth(data: Record<string, unknown>): boolean {
  const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
  return Object.values(profiles).some((profile) => {
    const inline = profile?.oauth
    return Boolean(inline) && typeof inline === "object" && !Array.isArray(inline)
  })
}

/** Is any `[oauth.<id>]` section unreferenced? The unlocked precondition for
 *  {@link pruneOrphanOAuthSections}. */
function hasOrphanOAuthSection(data: Record<string, unknown>): boolean {
  const shared = data.oauth
  if (!shared || typeof shared !== "object" || Array.isArray(shared)) return false
  const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
  const referenced = new Set(
    Object.values(profiles)
      .map((profile) => profileOAuthPointer(profile))
      .filter(Boolean),
  )
  return Object.keys(shared as Record<string, unknown>).some((id) => !referenced.has(id))
}

/**
 * Would writing `field` on the resolved profile change anything? The unlocked
 * precondition for the write-only-if-absent backfills, which run on every exec and
 * are no-ops once the value is there. Absent profile → false: those helpers write
 * nothing in that case either.
 */
function needsField(data: Record<string, unknown>, profileName: string | undefined, field: string): boolean {
  const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
  const name = resolveProfileName(data, profileName)
  if (!name || !profiles[name]) return false
  const value = profiles[name][field]
  // auth_type treats a blank string as absent, matching setAuthTypeIfAbsent.
  if (typeof value === "string") return value.trim().length === 0
  return value == null
}

/**
 * Do these two describe the same stored token? The comparison for a conditional save.
 *
 * `access_token` plus `obtained_at` is the identity: the pair changes on every rotation,
 * including the case where the issuer returns no new refresh token — so comparing the
 * refresh token alone could not discriminate. Absent on both sides counts as equal, which
 * is how "the slot was empty and must still be" gets asserted.
 */
function sameToken(a: AuthToken | undefined, b: AuthToken | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.token === b.token && a.obtainedAt === b.obtainedAt
}
