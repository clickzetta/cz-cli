import type { AuthToken } from "@clickzetta/sdk"
import type { BrowserLoginResult } from "../commands/login-browser.js"
import type { OAuthConnCombo } from "./oauth-enumerate.js"
import { readLlmEntries, writeLlmEntries } from "../llm/native-config.js"
import {
  loadProfiles,
  makeProfileTokenStore,
  patchProfileConnection,
  sanitizeOAuthId,
  saveProfiles,
  saveSharedOAuthToken,
  setDefaultProfile,
  setProfileOAuthPointer,
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
 * `apiKey` is absent (mirrors the old syncCredentialLlm guard). When llm.json
 * has no default yet, this entry becomes the default. Pure over
 * readLlmEntries/writeLlmEntries so it is home-isolatable in tests.
 */
export function configureClickzettaLlm(name: string, opts: { apiKey?: string; baseURL?: string }): boolean {
  if (!opts.apiKey) return false
  const config = readLlmEntries()
  config.llm[name] = {
    ...config.llm[name],
    provider: "clickzetta",
    api_key: opts.apiKey,
    ...(opts.baseURL && { base_url: opts.baseURL }),
  }
  writeLlmEntries({
    llm: config.llm,
    ...(config.default_llm ? { default_llm: config.default_llm } : { default_llm: name }),
  })
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
   * gatewayMapping (falling back to the central login host), NOT from any prior
   * profile — login must not depend on a profile it may later overwrite.
   */
  service: string
  protocol: string
  /** Fallback instance when userinfo carries none (normally userinfo wins). */
  instance?: string
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
  const { token, userInfo, service, protocol } = input
  // Prefer the instance userinfo reports over the one used to resolve config so
  // persistence (and the token slot key) line up with what was authenticated.
  const finalInstance = userInfo?.instanceName || input.instance || ""

  // Materialize an empty profile row when absent so patchProfileConnection
  // (a no-op on a missing profile) has somewhere to write. Existing profiles
  // are left untouched here and merged by the patch below.
  if (name) {
    const profiles = loadProfiles()
    if (!profiles[name]) {
      profiles[name] = {}
      saveProfiles(profiles)
    }
  }

  // Flatten the useful userinfo onto the top-level entry. `aimeshEndpointBaseUrl`
  // is stored under its own name — the same field the credential path writes and
  // that clickzetta-rotation / ai-gateway read — so both provisioning paths
  // produce an identical profile shape.
  patchProfileConnection(name, {
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

  if (name) setDefaultProfile(name)

  const llmConfigured = configureClickzettaLlm(name ?? finalInstance, {
    apiKey: userInfo?.apiKey,
    baseURL: userInfo?.aimeshEndpointBaseUrl,
  })

  return { instance: finalInstance, llmConfigured }
}

/**
 * Provision MANY profiles from a single OAuth login — one per (instance ×
 * workspace) combination — all sharing ONE `[oauth.<id>]` token section.
 *
 * Profiles are named `<base>_0`, `<base>_1`, … in enumeration order (base
 * defaults to "default"). The first profile is set as the default. The shared
 * token is written once; each profile only carries an `oauth = "<id>"` pointer,
 * so a later `getToken` resolves the same token regardless of which profile is
 * active. LLM is configured once from userinfo (apiKey + aimesh), keyed on the
 * default profile name.
 *
 * Falls back to the single-profile path when `combos` is empty (e.g. every
 * instance's workspace listing failed) so a login still yields a usable profile
 * from userinfo alone.
 */
export function provisionProfilesFromOAuthCombos(
  baseName: string | undefined,
  combos: OAuthConnCombo[],
  input: OAuthProvisionInput,
): { profiles: string[]; defaultProfile: string; llmConfigured: boolean } {
  const { token, userInfo, protocol } = input
  const base = baseName ?? "default"

  if (combos.length === 0) {
    // Nothing enumerated — keep a working profile from userinfo alone.
    const single = provisionProfileFromOAuth(base, input)
    return { profiles: [base], defaultProfile: base, llmConfigured: single.llmConfigured }
  }

  // One shared token section named after the session: [oauth.<base>]. Reusing
  // the session name (not a random id) means re-logging in under the same name
  // refreshes the same section instead of accumulating orphans, and the profile
  // prefix (<base>_N) visibly ties each profile to its login session.
  const oauthId = sanitizeOAuthId(base)
  saveSharedOAuthToken(oauthId, token)

  const created: string[] = []
  combos.forEach((combo, i) => {
    const name = `${base}_${i}`
    // Materialize the row so patchProfileConnection has somewhere to write.
    const profiles = loadProfiles()
    profiles[name] = profiles[name] ?? {}
    saveProfiles(profiles)

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
    created.push(name)
  })

  const defaultProfile = created[0]!
  setDefaultProfile(defaultProfile)

  const llmConfigured = configureClickzettaLlm(defaultProfile, {
    apiKey: userInfo?.apiKey,
    baseURL: userInfo?.aimeshEndpointBaseUrl,
  })

  return { profiles: created, defaultProfile, llmConfigured }
}
