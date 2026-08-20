import type { AuthToken } from "@clickzetta/sdk"
import type { BrowserLoginResult } from "../commands/login-browser.js"
import type { OAuthConnCombo } from "./oauth-enumerate.js"
import { readLlmEntries, setActiveModel, writeLlmEntries } from "../llm/native-config.js"
import {
  clearOAuthLoginResidue,
  getDefaultProfileName,
  oauthSessionProvisioned,
  loadProfiles,
  makeProfileTokenStore,
  patchProfileConnection,
  sanitizeOAuthId,
  saveProfiles,
  saveSharedOAuthToken,
  setAuthTypeIfAbsent,
  setDefaultProfile,
  setProfileOAuthPointer,
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
export function configureClickzettaLlm(name: string, opts: { apiKey?: string; baseURL?: string; legacyName?: string }): boolean {
  if (!opts.apiKey) return false
  const config = readLlmEntries()
  const legacy = opts.legacyName && opts.legacyName !== name && config.llm[opts.legacyName]?.provider === "clickzetta"
    ? opts.legacyName
    : undefined
  const migratedModel = legacy && config.model?.startsWith(`${legacy}/`)
    ? `${name}/${config.model.slice(legacy.length + 1)}`
    : undefined
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
    ...(typeof cred.aimeshEndpointBaseUrl === "string" ? { aimeshEndpointBaseUrl: String(cred.aimeshEndpointBaseUrl) } : {}),
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

  const profiles = loadProfiles()
  if (profiles[name]) {
    throw new ProvisionError("PROFILE_EXISTS", `Profile '${name}' already exists. Use a different name or delete it first.`)
  }

  profiles[name] = credentialToProfileEntry(cred)
  saveProfiles(profiles)
  setDefaultProfile(name)

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
  /**
   * True when `[oauth.<id>]` already existed, i.e. this session name has signed
   * in before. A re-login owns exactly one thing — the token — so everything the
   * user may since have changed is left alone: existing profiles keep their
   * connection fields, `default_profile` keeps whatever it points at, and
   * llm.json is not written at all (an api_key there may be a gateway virtual key
   * the quota flow swapped in — see llm/key-provision.ts — and overwriting it
   * would silently undo that remedy). Only genuinely new instance×workspace
   * combinations are added.
   *
   * Optional: {@link provisionProfilesFromOAuthCombos} derives it from
   * {@link oauthSessionProvisioned} when omitted, so the "read the disk before the
   * first write" ordering lives inside the function rather than in its caller. Pass
   * it only to state a classification the disk would not give (tests), or from a
   * caller that already read it for its own output.
   */
  relogin?: boolean
  /**
   * Write llm.json even on a re-login (`login --refresh-llm`). The skip protects an
   * api_key the user may have swapped for a gateway virtual key, which is worth
   * protecting — but a complimentary key that was revoked or rotated server-side is
   * then unrecoverable through login, since nothing here can tell the two apart. This
   * makes the overwrite an explicit request instead of an unreachable path.
   */
  refreshLlm?: boolean
}

/**
 * Default browser-OAuth path: provision (or refresh) `name` from a completed
 * browser login. Creates the profile row when missing so patchProfileConnection
 * (a no-op on a missing profile) can fill it, then flattens the useful userinfo
 * fields onto the top-level profile entry (each field to its canonical home:
 * connection context + `aimeshEndpointBaseUrl`), persists the token under the
 * instance-only slot, sets the profile default, and configures the ClickZetta
 * LLM from the userinfo apiKey. The raw userinfo is intentionally NOT archived:
 * every field consumers need has a canonical top-level home, so a verbatim
 * `[profiles.<name>.userinfo]` copy would only duplicate data and risk drift.
 * Idempotent: re-running only patches + refreshes, never duplicates. Best-effort
 * persistence helpers never throw; a failed profile materialization
 * (saveProfiles) propagates to the caller.
 */
export function provisionProfileFromOAuth(name: string | undefined, input: OAuthProvisionInput): { instance: string; llmConfigured: boolean } {
  const { userInfo, service, protocol } = input
  // Stamp the OAuth issuer host onto the token so it persists in [oauth.<id>]
  // and the refresh path can target it (see OAuthProvisionInput).
  const token = input.issuer ? { ...input.token, issuer: input.issuer } : input.token
  // Prefer the instance userinfo reports over the one used to resolve config so
  // persistence (and the token slot key) line up with what was authenticated.
  const finalInstance = userInfo?.instanceName || input.instance || ""

  // Materialize an empty profile row when absent so patchProfileConnection
  // (a no-op on a missing profile) has somewhere to write. Existing profiles
  // are left untouched here and merged by the patch below.
  const existedBefore = Boolean(name) && loadProfiles()[name!] !== undefined
  if (name && !existedBefore) {
    const profiles = loadProfiles()
    profiles[name] = {}
    saveProfiles(profiles)
  }

  // Two different questions, deliberately not one flag (they used to be, and the
  // pair drifted — see the note on `relogin` below):
  //   `relogin` alone decides the FILE-WIDE effects — default_profile and llm.json
  //     are shared by every profile, so a re-login must leave them alone no matter
  //     which profile row this call happens to be filling.
  //   `refreshOnly` decides only whether to write THIS row's connection fields:
  //     an existing row is the user's, a row we just created has nothing to lose.
  const relogin = input.relogin ?? oauthSessionProvisioned(sanitizeOAuthId(name ?? (finalInstance || "default")))
  const refreshOnly = relogin && existedBefore

  // Clear residue that would shadow/contradict this fresh login: a stale
  // header.Cookie (consulted before the OAuth token at runtime) and any stale
  // instance/workspace/service the new login won't overwrite (patch only writes
  // non-empty values, so an old `instance="default"` would otherwise survive).
  if (!refreshOnly) {
    clearOAuthLoginResidue(name, {
      instance: finalInstance.length > 0,
      workspace: Boolean(userInfo?.workspace),
      service: service.length > 0,
    })
  }

  // Flatten the useful userinfo onto the top-level entry. `aimeshEndpointBaseUrl`
  // is stored under its own name — the same field the credential path writes and
  // that clickzetta-rotation / ai-gateway read — so both provisioning paths
  // produce an identical profile shape.
  patchProfileConnection(name, refreshOnly
    // Refreshing an existing row: only what the server owns. `service` (the region
    // business host) and `aimeshEndpointBaseUrl` can move server-side, and the
    // account/user identity is re-read from userinfo — none of them is a user
    // preference. instance/workspace/schema/vcluster are left alone: unlike the
    // combos path there is no match key pinning them, so an edit here is the user's.
    ? {
      service,
      protocol,
      userId: token.userId || undefined,
      accountId: userInfo?.accountId,
      accountName: userInfo?.accountName,
      aimeshEndpointBaseUrl: userInfo?.aimeshEndpointBaseUrl,
    }
    : {
      service,
      protocol,
      instance: finalInstance,
      workspace: userInfo?.workspace,
      schema: userInfo?.schema,
      vcluster: userInfo?.vcluster,
      userId: token.userId || undefined,
      accountId: userInfo?.accountId,
      accountName: userInfo?.accountName,
      aimeshEndpointBaseUrl: userInfo?.aimeshEndpointBaseUrl,
    })

  // Persist the token in a shared [oauth.<id>] section named after the profile
  // and point this profile at it. Passing an explicit id makes save write the
  // top-level section + the profile's `oauth = "<id>"` pointer.
  const oauthId = sanitizeOAuthId(name ?? (finalInstance || "default"))
  makeProfileTokenStore(name, oauthId).save(token)

  // Pin the profile to the OAuth token we just minted, so a pat or username that
  // was already on the profile can't shadow this login. Only when unset — see
  // setAuthTypeIfAbsent: re-login must not repoint a user's explicit choice.
  setAuthTypeIfAbsent(name, AUTH_TYPE.oauth)

  // `[name]` as the owned set: this path provisions exactly one row, and it is the one
  // whose instance-less shape the repair exists for (the zero-combos first login writes
  // it). Omitting it would silently switch that branch off here.
  if (name) ensureDefaultProfile(relogin, name, [name])

  // llm.json is not a login artifact on a re-login: see OAuthProvisionInput.relogin.
  const llmConfigured = relogin && !input.refreshLlm
    ? false
    // Keyed like the combos path (sanitizeOAuthId), so one session cannot end up with
    // its entry under two different names depending on which path provisioned it —
    // which is also what the "no entry for this session" warning looks up.
    : configureClickzettaLlm(sanitizeOAuthId(name ?? finalInstance), {
      apiKey: userInfo?.apiKey,
      baseURL: userInfo?.aimeshEndpointBaseUrl,
      // The raw name is what this path used as the entry key before it was
      // sanitized, so hand it over as the legacy name: without this a session called
      // e.g. `company.prod` would get a SECOND entry under `company_prod` while
      // config.model still pointed at the orphaned original.
      legacyName: name ?? finalInstance,
    })

  return { instance: finalInstance, llmConfigured }
}

/** What a login did to llm.json — reported rather than re-derived by the caller. */
export type LlmAction = "written" | "skipped_relogin" | "no_api_key"

export interface OAuthCombosResult {
  /** Every profile this session owns, ordered for display. */
  profiles: string[]
  /** This session's default profile (see sessionDefaultProfile). */
  defaultProfile: string
  llmConfigured: boolean
  /** Why {@link llmConfigured} is what it is. Only this function knows. */
  llmAction: LlmAction
  /** The subset of {@link profiles} this call brought into being. */
  created: string[]
}

/**
 * Provision MANY profiles from a single OAuth login — one per (instance ×
 * workspace) combination — all sharing ONE `[oauth.<id>]` token section.
 *
 * Profiles are named `<base>_N` (base defaults to "default"), and a combo is tied
 * to a profile by the CONNECTION it describes, not by its position in the
 * enumeration — the server's order is not stable, so an index-derived name would
 * make the same workspace change profiles between logins. A combo with no owned row
 * yet gets a fresh `max(N) + 1`; names already on disk stay reserved even when they
 * belong to another session. The shared token is written once; each profile only
 * carries an `oauth = "<id>"` pointer, so a later `getToken` resolves the same token
 * regardless of which profile is active.
 *
 * A FIRST login (see {@link OAuthProvisionInput.relogin}) also sets the first
 * profile as the default and configures the LLM once from userinfo (apiKey +
 * aimesh), keyed on the shared OAuth name rather than an arbitrary
 * instance/workspace profile. A RE-login does neither — `llmConfigured` is then
 * always false — and refreshes only the server-owned fields of rows that already
 * exist. `created` reports the subset of `profiles` this call brought into being.
 *
 * When `combos` is empty (e.g. every instance's workspace listing failed) a first
 * login falls back to the single-profile path so it still yields a usable profile
 * from userinfo alone; a re-login with existing session profiles instead refreshes
 * the shared token and returns, since it has nothing new to write.
 */
export function provisionProfilesFromOAuthCombos(
  baseName: string | undefined,
  combos: OAuthConnCombo[],
  input: OAuthProvisionInput,
): OAuthCombosResult {
  const { userInfo, protocol } = input
  // Stamp the OAuth issuer host onto the token before it's shared across every
  // <base>_N profile, so each one's refresh targets the issuer.
  const token = input.issuer ? { ...input.token, issuer: input.issuer } : input.token
  const base = baseName ?? "default"

  // One shared token section named after the session: [oauth.<base>]. Reusing
  // the session name (not a random id) means re-logging in under the same name
  // refreshes the same section instead of accumulating orphans, and the profile
  // prefix (<base>_N) visibly ties each profile to its login session.
  const oauthId = sanitizeOAuthId(base)
  // Derived here unless the caller states it, so the "read before the first write"
  // ordering is a property of this function rather than a comment in its caller.
  const relogin = input.relogin ?? oauthSessionProvisioned(oauthId)

  // Index the session's existing profiles by the CONNECTION each describes, so a
  // re-login can tell an already-provisioned combo from a genuinely new one.
  // Matched by content rather than by name: `<base>_N` is positional and N comes
  // from the server's enumeration order, so the same workspace can land on a
  // different N between two logins. `maxIndex` then keeps new names from colliding
  // with any `<base>_N` already on disk.
  let maxIndex = -1
  const byConnection = new Map<string, string>()
  const sessionProfiles: string[] = []
  for (const [profileName, entry] of Object.entries(loadProfiles())) {
    const index = sessionProfileIndex(base, profileName)
    // Every name that parses as `<base>_N` bumps maxIndex, INCLUDING one owned by
    // another session — collision avoidance is about the name being taken, not about
    // who owns it, and allocating over it would overwrite that profile.
    if (index !== undefined) maxIndex = Math.max(maxIndex, index)
    // Ownership, on the other hand, decides whether this login may touch the row, and
    // only an explicit pointer at THIS session counts — by pointer alone, not by name
    // shape. Name shape is not enough in either direction: another session's row can
    // parse as ours (session "sess" and session "sess_2" both produce a profile
    // literally named "sess_2"), a hand-written row with a pat and no auth_type would
    // have its credential switched under it, and OUR OWN bare `<base>` row — what the
    // zero-combos fallback writes — parses as nobody's, which used to leave it out of
    // every session-scoped check including the default_profile repair.
    if (entry.oauth !== oauthId) continue
    sessionProfiles.push(profileName)
    const key = connectionKey(entry.instance, entry.workspace)
    // A row with neither instance nor workspace describes no connection, so no
    // combo can ever match it; indexing it would only let one such row shadow
    // another under the shared empty key. First write wins for the rest, so a
    // duplicated connection resolves deterministically to the lowest N.
    if (key === EMPTY_CONNECTION_KEY || byConnection.has(key)) continue
    byConnection.set(key, profileName)
  }
  sessionProfiles.sort((a, b) => reportOrder(base, a) - reportOrder(base, b))

  if (combos.length === 0) {
    // Nothing enumerated. On a re-login of a session that already has profiles the
    // token is all we have to offer: they share [oauth.<base>], so refreshing the
    // section reaches all of them. Creating the single bare `<base>` row here (the
    // first-login shape) would both add a connection-less profile beside `<base>_N`
    // and — because that row does not exist yet — run a FULL first-login
    // provisioning, handing default_profile and llm.json back to userinfo. Failing
    // to enumerate is a transient server condition (oauth-enumerate.ts swallows a
    // failed listUserWorkspaces per instance), not a reason to rewrite the file.
    if (relogin && sessionProfiles.length > 0) {
      saveSharedOAuthToken(oauthId, token)
      // Server-owned fields refresh here too, so the contract does not depend on the
      // enumeration having succeeded — a tenant whose aimesh endpoint or region host
      // moved would otherwise hit one transient listUserWorkspaces failure and get a
      // successful login that silently kept the stale value, with "log in again" as
      // the remedy that had just failed to apply.
      //
      // But `service` is the one field here that is NOT account-wide: it is the region
      // host OF AN INSTANCE (see OAuthConnCombo.service), and all this branch has is
      // `input.service` — the DEFAULT instance's host, or, when userinfo carried no
      // gatewayMapping, the OAuth entry host that login itself warns may not be a data
      // region at all. Writing that to every row would move another region's profile
      // onto the wrong host. So it goes only to the row userinfo actually describes;
      // the identity fields are account-wide and go everywhere.
      const rows = loadProfiles()
      const describedInstance = String(userInfo?.instanceName ?? "").toLowerCase()
      for (const profileName of sessionProfiles) {
        const sameInstance = describedInstance.length > 0
          && String(rows[profileName]?.instance ?? "").toLowerCase() === describedInstance
        patchProfileConnection(profileName, {
          ...(sameInstance ? { service: input.service } : {}),
          protocol,
          userId: token.userId || undefined,
          accountId: userInfo?.accountId,
          accountName: userInfo?.accountName,
          aimeshEndpointBaseUrl: userInfo?.aimeshEndpointBaseUrl,
        })
      }
      ensureDefaultProfile(relogin, sessionProfiles[0]!, sessionProfiles)
      // --refresh-llm is honoured here too: the api key comes from userinfo, which
      // this path has, not from the enumeration it lacks. Skipping it would make the
      // flag silently do nothing exactly when a transient enumeration failure sends
      // the login down this branch.
      const llmConfigured = input.refreshLlm
        ? configureClickzettaLlm(oauthId, {
          apiKey: userInfo?.apiKey,
          baseURL: userInfo?.aimeshEndpointBaseUrl,
          legacyName: `${base}_0`,
        })
        : false
      return {
        profiles: sessionProfiles,
        defaultProfile: sessionDefaultProfile(relogin, sessionProfiles),
        llmConfigured,
        llmAction: llmActionFor({ relogin, refreshLlm: input.refreshLlm, llmConfigured }),
        created: [],
      }
    }
    // Nothing to refresh — keep a working profile from userinfo alone.
    const existedBefore = loadProfiles()[base] !== undefined
    const single = provisionProfileFromOAuth(base, input)
    return {
      profiles: [base],
      defaultProfile: sessionDefaultProfile(relogin, [base]),
      llmConfigured: single.llmConfigured,
      llmAction: llmActionFor({ relogin, refreshLlm: input.refreshLlm, llmConfigured: single.llmConfigured }),
      created: existedBefore ? [] : [base],
    }
  }

  saveSharedOAuthToken(oauthId, token)

  const names: string[] = []
  const created: string[] = []
  for (const combo of combos) {
    const key = connectionKey(combo.instance, combo.workspace)
    // Content matching is NOT gated on `relogin`: `maxIndex` counts every existing
    // `<base>_N` either way, so skipping the lookup on a first login would append a
    // second profile for a connection that already has one instead of reusing it.
    // What `relogin` decides is how much of a matched row may be written.
    const existingName = byConnection.get(key)
    const name = existingName ?? `${base}_${++maxIndex}`
    if (existingName && relogin) {
      // Already provisioned for this connection. Refresh what the SERVER owns and
      // nothing else. The distinction matters in both directions: `schema`/`vcluster`
      // and `header.Cookie` are the user's and must survive (that is the point of
      // the re-login contract), while `service` (the region business host),
      // `aimeshEndpointBaseUrl` and the account/user identity are facts this login
      // just re-read from userinfo — freezing them at whatever the first login saw
      // would mean a region or endpoint move could never be picked up, and no other
      // command rewrites them. instance/workspace are what this row was MATCHED on; writing
      // them back only normalizes their casing to the server's, since the match key is
      // case-insensitive (see connectionKey) — not the no-op an exact key would make it.
      patchProfileConnection(existingName, {
        service: combo.service,
        protocol,
        instance: combo.instance,
        workspace: combo.workspace,
        userId: token.userId || undefined,
        accountId: userInfo?.accountId,
        accountName: userInfo?.accountName,
        aimeshEndpointBaseUrl: userInfo?.aimeshEndpointBaseUrl,
      })
      setProfileOAuthPointer(existingName, oauthId)
      setAuthTypeIfAbsent(existingName, AUTH_TYPE.oauth)
      if (!names.includes(existingName)) names.push(existingName)
      continue
    }

    // Materialize the row so patchProfileConnection has somewhere to write.
    const profiles = loadProfiles()
    profiles[name] = profiles[name] ?? {}
    saveProfiles(profiles)

    // Drop any stale header.Cookie residue that would shadow the OAuth token at
    // runtime. service/instance/workspace are all provided below (combo always
    // carries them), so they're kept. Only on a row this login CREATES: on a matched
    // row the cookie is user-owned state that survives (see the refresh branch above),
    // and what keeps it inert there is `auth_type` — setAuthTypeIfAbsent pins "oauth",
    // and resolveConnectionConfig strips the Cookie header whenever a non-cookie
    // auth_type is pinned (connection/config.ts).
    clearOAuthLoginResidue(name, { instance: true, workspace: true, service: true })

    // Only connection essentials at login: service/instance/workspace. schema
    // and vcluster are intentionally omitted (runtime defaults + --schema/
    // --vcluster overrides).
    patchProfileConnection(name, {
      service: combo.service,
      protocol,
      instance: combo.instance,
      workspace: combo.workspace,
      userId: token.userId || undefined,
      accountId: userInfo?.accountId,
      accountName: userInfo?.accountName,
      aimeshEndpointBaseUrl: userInfo?.aimeshEndpointBaseUrl,
    })
    setProfileOAuthPointer(name, oauthId)
    setAuthTypeIfAbsent(name, AUTH_TYPE.oauth)
    byConnection.set(key, name)
    // enumerateOAuthCombos does not dedupe (one row per listUserWorkspaces result
    // per instance), so the same connection can arrive twice; it must not be
    // reported twice.
    if (!names.includes(name)) names.push(name)
    if (!existingName && !created.includes(name)) created.push(name)
  }

  // `profiles` answers "what does this session own", not "what did this run touch" —
  // `profiles_created` covers the latter. The difference shows up when one instance's
  // workspace listing fails (oauth-enumerate.ts swallows that per instance): reporting
  // only the touched rows would shrink `profiles`/`profile_count` with nothing having
  // been deleted, and would disagree with the zero-combos branch above, which reports
  // the full set for the same failure at 100%.
  const owned = [...new Set([...sessionProfiles, ...names])]
  // Reported in `<base>_N` order, not enumeration order: N is stable across logins
  // while the server's combo order is not, so a caller diffing two logins' output
  // sees the profiles line up.
  owned.sort((a, b) => reportOrder(base, a) - reportOrder(base, b))
  names.sort((a, b) => reportOrder(base, a) - reportOrder(base, b))

  ensureDefaultProfile(relogin, names[0]!, owned)
  const defaultProfile = sessionDefaultProfile(relogin, names, owned)

  // llm.json is untouched on a re-login unless explicitly asked: see
  // OAuthProvisionInput.relogin / .refreshLlm.
  const llmConfigured = relogin && !input.refreshLlm
    ? false
    : configureClickzettaLlm(oauthId, {
      apiKey: userInfo?.apiKey,
      baseURL: userInfo?.aimeshEndpointBaseUrl,
      // Pinned to the historical key, never to a variable one: legacyName is an
      // entry configureClickzettaLlm ABSORBS AND DELETES, and the only key the rename
      // migration was written for is `<base>_0`. Passing `defaultProfile` here would
      // aim that delete at whatever the user's default happens to be — an unrelated
      // `agent llm add sess_3` entry would be swallowed.
      legacyName: `${base}_0`,
    })

  return {
    profiles: owned,
    defaultProfile,
    llmConfigured,
    llmAction: llmActionFor({ relogin, refreshLlm: input.refreshLlm, llmConfigured }),
    created,
  }
}

/**
 * Why llm.json ended up written or not. Lives next to the decision it describes: the
 * caller used to reconstruct it from argv, which then disagreed with the paths that
 * expression did not model.
 */
function llmActionFor(input: { relogin: boolean; refreshLlm?: boolean; llmConfigured: boolean }): LlmAction {
  if (input.llmConfigured) return "written"
  if (input.relogin && !input.refreshLlm) return "skipped_relogin"
  // Attempted (a first login, or a re-login with --refresh-llm) and userinfo carried
  // no apiKey — configureClickzettaLlm's only other way to return false.
  return "no_api_key"
}

/**
 * Point `default_profile` at `name` when doing so cannot override a live choice.
 *
 * A first login sets it, as it always has. A re-login does not — the selection is
 * the user's — with one exception: a `default_profile` that is missing or names a
 * profile that no longer exists is not a choice, it is a dangling pointer, and
 * leaving it would hand back a file whose only usable profile is not reachable
 * without `--profile`.
 */
function ensureDefaultProfile(relogin: boolean, name: string, owned: string[] = []): void {
  if (!relogin) {
    setDefaultProfile(name)
    return
  }
  const current = getDefaultProfileName()
  if (!current) {
    setDefaultProfile(name)
    return
  }
  const entry = loadProfiles()[current]
  if (!entry) {
    setDefaultProfile(name)
    return
  }
  // One more case that is not a choice: our OWN row with no instance. The
  // zero-combos fallback writes a bare `<base>` profile when the account had no
  // instance yet and makes it the default, and login tells the user to provision an
  // instance and log in again. That re-login enumerates combos and creates
  // `<base>_0` — if the instance-less row kept the default, every bare `cz-cli`
  // command would fail exactly as before and the advertised remedy would not work.
  const unusableOwnRow = owned.includes(current) && !String(entry.instance ?? "").trim()
  if (unusableOwnRow) setDefaultProfile(name)
}

/**
 * Which of this session's profiles to report as the default.
 *
 * A re-login keeps whatever the user selected — but only when that selection is one
 * of THIS session's profiles. `default_profile` is a single global string with
 * nothing tying it to a session, so an unvalidated read can name another session's
 * profile (or one since deleted), and a caller that feeds our `default_profile`
 * straight back into `--profile` would then target the wrong account. Either way we
 * do not WRITE it on a re-login; this only decides what to report.
 */
function sessionDefaultProfile(relogin: boolean, names: string[], owned: string[] = names): string {
  const selected = relogin ? getDefaultProfileName() : undefined
  // `owned` is every row this session has, `names` only the ones THIS run touched.
  // Validating against the narrower set would report `names[0]` whenever the user's
  // selection belongs to an instance whose workspace listing failed this time — a
  // caller feeding that back into --profile would target a different workspace than
  // every bare `cz-cli` command uses.
  return selected && owned.includes(selected) ? selected : names[0]!
}

/**
 * Stable identity of a profile's connection: what a combo is matched against.
 *
 * Case-insensitive, so a row stored as `WS1` still matches a combo reported as `ws1`
 * rather than growing a second profile for one connection. The refresh then writes
 * the server's casing onto the row — a normalization, not the no-op it would be if
 * the key were exact.
 */
function connectionKey(instance: unknown, workspace: unknown): string {
  return `${String(instance ?? "").toLowerCase()}\u0000${String(workspace ?? "").toLowerCase()}`
}

/** What {@link connectionKey} yields for a row carrying neither field. */
const EMPTY_CONNECTION_KEY = connectionKey(undefined, undefined)

/** The N of a `<base>_N` profile name, or undefined when the name isn't one. */
function sessionProfileIndex(base: string, profileName: string): number | undefined {
  if (!profileName.startsWith(`${base}_`)) return undefined
  const suffix = profileName.slice(base.length + 1)
  if (!/^\d+$/.test(suffix)) return undefined
  const index = Number(suffix)
  // `++maxIndex` must always yield a name nothing holds — past MAX_SAFE_INTEGER the
  // increment is a no-op in float precision and would hand back an existing row, which
  // the ownership logic above would then stamp with this session's oauth/auth_type.
  return Number.isSafeInteger(index) ? index : undefined
}

/**
 * Sort key for reporting: `<base>_N` by N, and the bare `<base>` row (the
 * zero-combos shape) first, since it predates every numbered row. Never used to
 * allocate a name — only `sessionProfileIndex` feeds `maxIndex`.
 */
function reportOrder(base: string, profileName: string): number {
  if (profileName === base) return -1
  // Ownership is decided by the `oauth` pointer, so a session can legitimately include
  // a row named however the user liked; `?? 0` would tie it with `<base>_0`.
  return sessionProfileIndex(base, profileName) ?? Number.MAX_SAFE_INTEGER
}
