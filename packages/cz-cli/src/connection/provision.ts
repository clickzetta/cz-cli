import type { AuthToken } from "@clickzetta/sdk"
import type { BrowserLoginResult } from "../commands/login-browser.js"
import type { OAuthConnCombo } from "./oauth-enumerate.js"
import { readLlmEntries, setActiveModel, writeLlmEntries } from "../llm/native-config.js"
import {
  applyOAuthLoginCleanup,
  applyProfileConnection,
  mutateProfilesFile,
  resolveProfileName,
  sanitizeOAuthId,
  tokenToEntry,
  AUTH_TYPE,
  type ProfileEntry,
} from "./profile-store.js"

/**
 * Shared provisioning primitives behind BOTH `cz-cli login` and the deprecated
 * `cz-cli setup` alias, so there is exactly one implementation of "create a
 * profile + set it default + configure the ClickZetta LLM". Migrated out of
 * setup.ts (not copied) and re-homed onto the CLICKZETTA_TEST_HOME-aware
 * profile-store / native-config writers so both entry points and their unit
 * tests share one on-disk contract.
 */

/**
 * A provisioning failure the caller maps to a CLI error code. `code` matches the
 * output error codes the two entry points already emit (INVALID_CREDENTIAL,
 * PROFILE_EXISTS), keeping their observable behavior identical after migration.
 */
export class ProvisionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ProvisionError"
  }
}

/** Decode a base64(JSON) registration credential. Throws on bad base64/JSON;
 *  callers wrap with their own INVALID_CREDENTIAL message. */
export function decodeCredential(credential: string): Record<string, unknown> {
  const decoded = Buffer.from(credential, "base64").toString("utf-8")
  return JSON.parse(decoded) as Record<string, unknown>
}

/**
 * Upsert the ClickZetta LLM provider entry for `name` in llm.json. No-op when
 * `apiKey` is absent (mirrors the old syncCredentialLlm guard). Registration
 * does not change config.model. Pure over readLlmEntries/writeLlmEntries so it
 * is home-isolatable in tests.
 */
export function configureClickzettaLlm(
  name: string,
  opts: { apiKey?: string; baseURL?: string; legacyName?: string },
): boolean {
  if (!opts.apiKey) return false
  const config = readLlmEntries()
  const legacy =
    opts.legacyName && opts.legacyName !== name && config.llm[opts.legacyName]?.provider === "clickzetta"
      ? opts.legacyName
      : undefined
  const migratedModel =
    legacy && config.model?.startsWith(`${legacy}/`) ? `${name}/${config.model.slice(legacy.length + 1)}` : undefined
  config.llm[name] = {
    ...(legacy ? config.llm[legacy] : {}),
    ...config.llm[name],
    provider: "clickzetta",
    api_key: opts.apiKey,
    ...(opts.baseURL && { base_url: opts.baseURL }),
  }
  if (legacy) delete config.llm[legacy]
  // cz_change: no default_llm anymore. The entry is written as a provider; which
  // model is active is opencode's call (config.model → recent → first available).
  // On a fresh login this is the only provider, so opencode auto-selects it.
  writeLlmEntries({ llm: config.llm })
  if (migratedModel) setActiveModel(migratedModel)
  return true
}

/** Map a decoded credential to a profile entry, preserving the exact field set
 *  and defaults the setup credential flow has always written. */
function credentialToProfileEntry(cred: Record<string, unknown>): ProfileEntry {
  return {
    ...(cred.username ? { username: String(cred.username) } : {}),
    ...(cred.userId != null ? { user_id: Number(cred.userId) } : {}),
    instance: String(cred.instanceName),
    workspace: String(cred.workspaceName ?? "default"),
    schema: String(cred.schema ?? "public"),
    vcluster: String(cred.virtualCluster ?? "default"),
    pat: String(cred.accessToken),
    // The credential blob's accessToken IS a PAT, so pin it. Written at creation
    // (this path throws on an existing profile) rather than patched afterwards,
    // so there is never a window where the profile exists without its auth_type.
    auth_type: AUTH_TYPE.pat,
    service: String(cred.service ?? "dev-api.clickzetta.com"),
    protocol: String(cred.protocol ?? "https"),
    ...(typeof cred.analysisAgentEndpoint === "string" ? { analysis_agent_endpoint: cred.analysisAgentEndpoint } : {}),
    ...(typeof cred.aimeshEndpointBaseUrl === "string"
      ? { aimeshEndpointBaseUrl: String(cred.aimeshEndpointBaseUrl) }
      : {}),
  }
}

/**
 * New-user credential path (equivalent to the old `setup --credential`): create
 * `name` from a decoded credential, set it default, and configure the LLM.
 * Validates the required credential fields and refuses to clobber an existing
 * profile — both surface as {@link ProvisionError} so callers keep emitting the
 * same INVALID_CREDENTIAL / PROFILE_EXISTS codes.
 */
export function provisionProfileFromCredential(name: string, cred: Record<string, unknown>): void {
  const instanceName = typeof cred.instanceName === "string" ? cred.instanceName : undefined
  const accessToken = typeof cred.accessToken === "string" ? cred.accessToken : undefined
  if (!instanceName || !accessToken) {
    throw new ProvisionError("INVALID_CREDENTIAL", "Missing required fields: instanceName, accessToken")
  }

  mutateProfilesFile((data) => {
    const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
    if (profiles[name]) {
      throw new ProvisionError(
        "PROFILE_EXISTS",
        `Profile '${name}' already exists. Use a different name or delete it first.`,
      )
    }
    profiles[name] = credentialToProfileEntry(cred)
    data.profiles = profiles
    data.default_profile = name
    return data
  })

  configureClickzettaLlm(name, {
    apiKey: typeof cred.apiKey === "string" ? cred.apiKey : undefined,
    baseURL: typeof cred.aimeshEndpointBaseUrl === "string" ? cred.aimeshEndpointBaseUrl : undefined,
  })
}

export interface OAuthProvisionInput {
  /** The exchanged OAuth token, already backfilled with userId/instanceId. */
  token: AuthToken
  /** Parsed userinfo connection context (undefined when userinfo failed). */
  userInfo?: BrowserLoginResult["userInfo"]
  /**
   * Region-specific business service host to persist. Derived from userinfo's
   * gatewayMapping (falling back to the login entry host), NOT from any prior
   * profile — login must not depend on a profile it may later overwrite.
   */
  service: string
  protocol: string
  /** Fallback instance when userinfo carries none (normally userinfo wins). */
  instance?: string
  /**
   * OAuth issuer host (no protocol, e.g. "api.clickzetta.com") — the login
   * entry host that served `/oauth2/token`. Persisted on the token so the
   * refresh path targets the issuer, NOT the region business `service` (which
   * returns invalid_grant for OAuth grants). Distinct from `service` on purpose.
   */
  issuer?: string

  relogin?: boolean
  /**
   * Write llm.json even on a re-login (`login --refresh-llm`). The skip protects an
   * api_key the user may have swapped for a gateway virtual key, which is worth
   * protecting — but a complimentary key that was revoked or rotated server-side is
   * then unrecoverable through login, since nothing here can tell the two apart. This
   * makes the overwrite an explicit request instead of an unreachable path.
   */
  refreshLlm?: boolean
  /**
   * True when {@link service} is NOT a resolved region host but the OAuth entry host
   * standing in for one (userinfo returned no gatewayMapping). login warns about this;
   * provisioning must additionally never write it over a row that already has a real
   * per-instance host, which would move a working profile onto the sign-in host.
   */
  serviceIsEntryFallback?: boolean
}

/** Provision one explicitly named profile and its session credentials. */
export function provisionProfileFromOAuth(
  name: string | undefined,
  input: OAuthProvisionInput,
): { instance: string; llmConfigured: boolean } {
  const instance = input.userInfo?.instanceName || input.instance || ""
  const oauthId = sanitizeOAuthId(name ?? (instance || "default"))
  let relogin = false
  mutateProfilesFile((data) => {
    const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
    const shared = (data.oauth ?? {}) as Record<string, unknown>
    relogin =
      input.relogin ?? (shared[oauthId] !== undefined || Object.values(profiles).some((p) => p.oauth === oauthId))
    const resolved = resolveProfileName(data, name)
    if (!resolved) throw new ProvisionError("PROFILE_NOT_FOUND", "No profile is available for this login.")
    applySingleOAuthProfile(profiles, resolved, oauthId, input, relogin)
    data.profiles = profiles
    shared[oauthId] = tokenToEntry(input.issuer ? { ...input.token, issuer: input.issuer } : input.token)
    data.oauth = shared
    ensureDefaultProfile(data, relogin, resolved, [resolved])
    return data
  })
  const llmConfigured =
    relogin && !input.refreshLlm
      ? false
      : configureClickzettaLlm(oauthId, {
          apiKey: input.userInfo?.apiKey,
          baseURL: input.userInfo?.aimeshEndpointBaseUrl,
          legacyName: name ?? instance,
        })
  return { instance, llmConfigured }
}

export type LlmAction = "written" | "skipped_relogin" | "no_api_key"

export interface OAuthCombosResult {
  /** Every profile this session owns, ordered for display. */
  profiles: string[]
  /** Profiles whose explicit cookie authentication ignores the new OAuth token. */
  cookiePinned: string[]
  /** This session's default, which may differ from the global default. */
  defaultProfile: string

  relogin: boolean
  llmConfigured: boolean
  llmAction: LlmAction
  created: string[]
  renamed: ProfileRename[]
  /** Unmatched profiles are retained: enumeration may have failed for their instance. */
  stale: string[]
}

export interface ProfileRename {
  from: string
  to: string
}

export function provisionProfilesFromOAuthCombos(
  baseName: string | undefined,
  combos: OAuthConnCombo[],
  input: OAuthProvisionInput,
): OAuthCombosResult {
  let result!: ReturnType<typeof applyOAuthProfiles>
  mutateProfilesFile((data) => {
    result = applyOAuthProfiles(data, baseName ?? "default", combos, input)
    return data
  })
  // LLM configuration is independent of credential publication and only changes
  // on a first login or an explicit --refresh-llm.
  const llmConfigured =
    result.relogin && !input.refreshLlm
      ? false
      : configureClickzettaLlm(sanitizeOAuthId(baseName ?? "default"), {
          apiKey: input.userInfo?.apiKey,
          baseURL: input.userInfo?.aimeshEndpointBaseUrl,
          legacyName: result.legacyLlmName,
        })
  return {
    profiles: result.profiles,
    cookiePinned: result.cookiePinned,
    defaultProfile: result.defaultProfile,
    relogin: result.relogin,
    created: result.created,
    renamed: result.renamed,
    stale: result.stale,
    llmConfigured,
    llmAction: llmConfigured ? "written" : result.relogin && !input.refreshLlm ? "skipped_relogin" : "no_api_key",
  }
}

function applyOAuthProfiles(
  data: Record<string, unknown>,
  base: string,
  combos: OAuthConnCombo[],
  input: OAuthProvisionInput,
) {
  const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
  const shared = (data.oauth ?? {}) as Record<string, unknown>
  const oauthId = sanitizeOAuthId(base)
  const sessionProfiles = Object.keys(profiles)
    .filter((name) => profiles[name].oauth === oauthId)
    .sort((a, b) => compareForReport(base, a, b))
  const relogin = input.relogin ?? (shared[oauthId] !== undefined || sessionProfiles.length > 0)
  const names: string[] = []
  const created: string[] = []
  const renamed: ProfileRename[] = []
  const single = combos.length === 0 && !(relogin && sessionProfiles.length > 0)
  data.profiles = profiles
  shared[oauthId] = tokenToEntry(input.issuer ? { ...input.token, issuer: input.issuer } : input.token)
  data.oauth = shared

  if (single) {
    if (!profiles[base]) created.push(base)
    applySingleOAuthProfile(profiles, base, oauthId, input, relogin)
    names.push(base)
  }
  if (combos.length === 0 && !single) {
    for (const name of sessionProfiles) {
      const profile = profiles[name]
      const instance = String(profile.instance ?? "").trim()
      const hasService = String(profile.service ?? "").trim().length > 0
      const described = input.userInfo?.instanceName ?? ""
      const sameInstance = described.length > 0 && instance.toLowerCase() === described.toLowerCase()
      const fillConnection = name === base && !instance && Boolean(described)
      applyProfileConnection(profile, {
        ...identityFields(input),
        protocol: input.protocol,
        ...((sameInstance || fillConnection) && (!input.serviceIsEntryFallback || !hasService)
          ? { service: input.service }
          : {}),
        ...(fillConnection ? { instance: described, workspace: input.userInfo?.workspace } : {}),
      })
      bindOAuthProfile(profile, oauthId)
      names.push(name)
    }
  }
  if (combos.length > 0) {
    const byConnection = new Map<string, string>()
    for (const name of sessionProfiles) {
      const key = connectionKey(profiles[name].instance, profiles[name].workspace)
      if (key !== EMPTY_CONNECTION_KEY && !byConnection.has(key)) byConnection.set(key, name)
      if (!relogin) continue
      applyProfileConnection(profiles[name], identityFields(input))
      bindOAuthProfile(profiles[name], oauthId)
    }
    const ordered = [...combos].sort((a, b) => {
      const left = connectionKey(a.instance, a.workspace)
      const right = connectionKey(b.instance, b.workspace)
      return left < right ? -1 : left > right ? 1 : 0
    })
    const seen = new Set<string>()
    const reserved = new Set<string>()
    // Plan before applying: another row's occupied name stays reserved even if
    // that row will move later in this same login.
    const plans = ordered.flatMap((combo) => {
      const key = connectionKey(combo.instance, combo.workspace)
      if (seen.has(key)) return []
      seen.add(key)
      const existing = byConnection.get(key)
      const desired = `${base}_${nameSegment(combo.workspace)}_${nameSegment(combo.instance)}`
      const target = allocateProfileName(
        desired,
        (name) => reserved.has(name) || (profiles[name] !== undefined && name !== existing),
      )
      reserved.add(target)
      return [{ combo, existing, target }]
    })
    for (const plan of plans) {
      if (plan.existing && plan.existing !== plan.target) {
        profiles[plan.target] = profiles[plan.existing]
        delete profiles[plan.existing]
        if (data.default_profile === plan.existing) data.default_profile = plan.target
        renamed.push({ from: plan.existing, to: plan.target })
      }
      const profile = profiles[plan.target] ?? {}
      if (!plan.existing || !relogin)
        applyOAuthLoginCleanup(profile, { instance: true, workspace: true, service: true })
      applyProfileConnection(profile, { ...identityFields(input), ...plan.combo, protocol: input.protocol })
      bindOAuthProfile(profile, oauthId)
      profiles[plan.target] = profile
      names.push(plan.target)
      if (!plan.existing) created.push(plan.target)
    }
  }

  const moved = new Map(renamed.map((r) => [r.from, r.to]))
  const owned = [...new Set([...sessionProfiles.map((name) => moved.get(name) ?? name), ...names])].sort((a, b) =>
    compareForReport(base, a, b),
  )
  names.sort((a, b) => compareForReport(base, a, b))
  created.sort((a, b) => compareForReport(base, a, b))
  const preferredKey = connectionKey(input.userInfo?.instanceName, input.userInfo?.workspace)
  const preferred =
    preferredKey === EMPTY_CONNECTION_KEY
      ? undefined
      : names.find((name) => connectionKey(profiles[name].instance, profiles[name].workspace) === preferredKey)
  ensureDefaultProfile(data, relogin, preferred ?? names[0]!, owned)
  const selected = typeof data.default_profile === "string" ? data.default_profile : undefined
  return {
    profiles: owned,
    cookiePinned: owned.filter(
      (name) =>
        String(profiles[name].auth_type ?? "")
          .trim()
          .toLowerCase() === "cookie",
    ),
    defaultProfile: relogin && selected && owned.includes(selected) ? selected : (preferred ?? names[0]!),
    relogin,
    created,
    renamed,
    stale: combos.length === 0 ? [] : owned.filter((name) => !names.includes(name)),
    legacyLlmName: single ? base : `${base}_0`,
  }
}

function applySingleOAuthProfile(
  profiles: Record<string, ProfileEntry>,
  name: string,
  oauthId: string,
  input: OAuthProvisionInput,
  relogin: boolean,
) {
  const refreshOnly = relogin && profiles[name] !== undefined
  const profile = profiles[name] ?? {}
  const instance = input.userInfo?.instanceName || input.instance || ""
  if (!refreshOnly)
    applyOAuthLoginCleanup(profile, {
      instance: Boolean(instance),
      workspace: Boolean(input.userInfo?.workspace),
      service: Boolean(input.service),
    })
  applyProfileConnection(profile, {
    ...identityFields(input),
    protocol: input.protocol,
    ...(refreshOnly && input.serviceIsEntryFallback && String(profile.service ?? "").trim()
      ? {}
      : { service: input.service }),
    ...(refreshOnly
      ? {}
      : {
          instance,
          workspace: input.userInfo?.workspace,
          schema: input.userInfo?.schema,
          vcluster: input.userInfo?.vcluster,
        }),
  })
  bindOAuthProfile(profile, oauthId)
  profiles[name] = profile
}

function identityFields(input: OAuthProvisionInput) {
  return {
    userId: input.token.userId || undefined,
    accountId: input.userInfo?.accountId,
    accountName: input.userInfo?.accountName,
    aimeshEndpointBaseUrl: input.userInfo?.aimeshEndpointBaseUrl,
  }
}

function bindOAuthProfile(profile: ProfileEntry, oauthId: string) {
  profile.oauth = oauthId
  // An explicit pin, even an invalid one, belongs to the user.
  if (typeof profile.auth_type === "string" && profile.auth_type.trim()) return
  profile.auth_type = "oauth"
}

function ensureDefaultProfile(data: Record<string, unknown>, relogin: boolean, name: string, owned: string[]) {
  const profiles = data.profiles as Record<string, ProfileEntry>
  const current = typeof data.default_profile === "string" ? data.default_profile : undefined
  if (
    !relogin ||
    !current ||
    !profiles[current] ||
    (owned.includes(current) && !String(profiles[current].instance ?? "").trim())
  ) {
    data.default_profile = name
  }
}

function connectionKey(instance: unknown, workspace: unknown): string {
  return `${String(instance ?? "").toLowerCase()}\u0000${String(workspace ?? "").toLowerCase()}`
}

const EMPTY_CONNECTION_KEY = connectionKey(undefined, undefined)

function nameSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
}

function allocateProfileName(desired: string, taken: (name: string) => boolean): string {
  if (!taken(desired)) return desired
  for (let n = 2; ; n++) {
    if (!taken(`${desired}_${n}`)) return `${desired}_${n}`
  }
}

function compareForReport(base: string, a: string, b: string): number {
  const rank = (name: string) => (name === base ? 1 : 0)
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)
}
