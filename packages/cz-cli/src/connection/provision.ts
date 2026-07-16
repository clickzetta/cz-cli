import type { AuthToken } from "@clickzetta/sdk"
import type { BrowserLoginResult } from "../commands/login-browser.js"
import { readLlmEntries, writeLlmEntries } from "../llm/native-config.js"
import {
  loadProfiles,
  makeProfileTokenStore,
  patchProfileConnection,
  saveProfiles,
  setDefaultProfile,
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
  /** Service/protocol the login ran against, written into the profile. */
  service: string
  protocol: string
  /** Fallback instance from the resolved config when userinfo carries none. */
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

  // Persist the token under the instance-only slot so a later
  // resolveConnectionConfig (keyed on instance) finds it.
  makeProfileTokenStore(name, finalInstance).save(token)

  if (name) setDefaultProfile(name)

  const llmConfigured = configureClickzettaLlm(name ?? finalInstance, {
    apiKey: userInfo?.apiKey,
    baseURL: userInfo?.aimeshEndpointBaseUrl,
  })

  return { instance: finalInstance, llmConfigured }
}
