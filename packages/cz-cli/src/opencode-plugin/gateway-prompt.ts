// cz_change: turn an AI-gateway billing/quota failure into an actionable TUI
// dialog (see gateway-prompt-view.tsx for the confirm dialog and the handlers).
//
// "Actionable" means one of two things, per GatewayNoticeAction: hand off to a
// billing page, or mint the user's own key and swap it in place. This module only
// DECIDES which — it performs neither, so it stays plain .ts and unit-testable.
//
// Split from the renderer for the same reason as the quota indicator: this half
// is plain .ts, so it is unit-testable under `bun test` and can be pre-bundled
// into the sibling runtime asset. Nothing here may import @opentui or solid-js.
//
// Why the classification does not travel with the error: opencode's APIError
// schema (packages/core/src/v1/session.ts) carries message/statusCode/
// responseBody and nothing custom, and the rewrite happens inside the file://
// provider asset, a different module graph. `responseBody` survives both hops
// intact (rewriteApiCallError keeps it, parseAPICallError forwards it), so the
// classifier is simply run a second time here — same function, same verdict, no
// schema change and no private field smuggled through the event.
import { getCurrentUser, toServiceUrl } from "@clickzetta/sdk"
import { browserOpenCommandForPlatform } from "../util/browser.js"
import { resolveAccountsUrl } from "../commands/billing-error.js"
import { resolveConnectionConfig } from "../connection/config.js"
import * as Profile from "../connection/profile-context.js"
import { loadProfiles } from "../connection/profile-store.js"
import { rewriteClickzettaGatewayError, type GatewayErrorCode } from "../llm/gateway-error.js"
import { readLlmEntries } from "../llm/native-config.js"
import { profileTokenSource } from "../connection/token-source.js"

export { browserOpenCommandForPlatform }

/**
 * What confirming the dialog does. Two shapes because the remedies differ in
 * kind, not just in text: an unpaid balance can only be settled on a web page we
 * hand the user off to, while a spent complimentary key is fixed entirely
 * in-process (mint a key, swap it in). Discriminated so the renderer cannot
 * accidentally treat one as the other.
 */
export type GatewayNoticeAction =
  /** Hand off to a page the user acts on; nothing is changed locally. */
  | { kind: "open-url"; url: string }
  /**
   * Replace `entry`'s api_key in llm.json with a freshly minted virtual key.
   * The entry name is reused deliberately, so `config.model` stays valid and the
   * user's active model does not change.
   */
  | { kind: "provision-key"; entry: string }

export type GatewayNoticePlan = {
  /** The gateway code that produced this notice. */
  code: GatewayErrorCode
  /** Dialog title. */
  title: string
  /** Dialog body, already including the account name and any URL. */
  message: string
  /** Performed when the user confirms. */
  action: GatewayNoticeAction
}

/**
 * The codes worth offering a browser jump for — the test is whether a page exists
 * that the user can act on.
 *
 * Only the two overdue codes qualify. `GATEWAY_TENANT_OVER_QUOTA` does not: a
 * cycle cap is not lifted by paying, and the per-key console cannot lift it
 * either, since raising one virtual key's ceiling leaves the tenant-level cap in
 * force. Its advice is text-only, so it gets no dialog.
 */
const PROMPTABLE_CODES: readonly string[] = [
  "GATEWAY_TENANT_OVERDUE",
  "CZLH-60029",
  // A spent complimentary key qualifies for the opposite reason to the overdue
  // codes: no page fixes it, but we can fix it outright by minting the user's own
  // key. Only offered when the classifier confirms the blamed key is the
  // complimentary grant (isComplimentaryKey) — a user's own spent key needs its
  // quota raised, which this flow does not do.
  "GATEWAY_TOO_MANY_REQUESTS",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function str(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

/**
 * Recover the fields the classifier needs from a `session.error` event payload.
 *
 * The event nests them under `error.data` (NamedError.toObject), but the same
 * shape also arrives as a bare APIError-like object depending on the caller, so
 * both are accepted.
 */
export function gatewayErrorFields(error: unknown) {
  if (!isRecord(error)) return undefined
  const data = isRecord(error.data) ? error.data : error
  const message = str(data.message)
  if (!message) return undefined
  const statusCode = typeof data.statusCode === "number" ? data.statusCode : undefined
  return { message, statusCode, responseBody: str(data.responseBody) }
}

/** Classify a `session.error` payload without touching the network. */
export function classifyGatewayError(error: unknown) {
  const fields = gatewayErrorFields(error)
  if (!fields) return undefined
  const rewrite = rewriteClickzettaGatewayError(fields)
  if (!rewrite || !PROMPTABLE_CODES.includes(rewrite.code)) return undefined
  return rewrite
}

function activeProfile() {
  const profiles = loadProfiles()
  // Profile.current() is the single source (CZ_PROFILE, else the default_profile
  // fallback). The sole-profile guess remains as a last resort for a profiles.toml
  // with no default_profile set.
  const name = Profile.current() ?? Object.keys(profiles)[0]
  if (!name) return undefined
  const profile = profiles[name]
  if (!profile) return undefined
  return { name, profile }
}

/**
 * The account name of the identity the CLI is authenticated as right now.
 *
 * Asked of the portal rather than read from the profile because the profile's
 * `account_name` can be stale or absent (see resolveAccountsUrl): the env
 * override layer means `CZ_PAT=…` authenticates as someone the profile never
 * names, and opening that other tenant's billing page would be worse than
 * opening none. This runs on the error path, where one round-trip while the user
 * reads the failure is affordable — unlike startup, where it is not.
 *
 * Best-effort: on any failure the caller falls back to the profile field.
 */
async function runtimeAccountName(input: {
  name: string
  profile: Record<string, unknown>
  signal?: AbortSignal
}) {
  try {
    const service = str(input.profile.service)
    const instance = str(input.profile.instance)
    const config = resolveConnectionConfig({
      profile: input.name,
      ...(service ? { service } : {}),
      ...(input.profile.protocol === "http" || input.profile.protocol === "https"
        ? { protocol: input.profile.protocol }
        : {}),
      ...(instance ? { instance } : {}),
    })
    if (input.signal?.aborted) return undefined
    const user = await getCurrentUser(toServiceUrl(config.service, config.protocol), {
      tokens: profileTokenSource(config),
    })
    return str(user.accountDisplayName)
  } catch {
    return undefined
  }
}

function overduePlan(code: GatewayErrorCode, accountName: string | undefined, url: string): GatewayNoticePlan {
  // The account is named so a user with several keys can check this is the tenant
  // that actually owes money before paying anything.
  const target = accountName ? `the billing page for ${accountName}` : "the billing page"
  return {
    code,
    title: "Account has unpaid charges",
    message:
      "This API key is blocked by unpaid charges. Adding funds restores access.\n" +
      `Open ${target}? You will need to sign in to pay.\n${url}`,
    action: { kind: "open-url", url },
  }
}

/**
 * Confirm `providerID` names a ClickZetta entry we can swap a key into.
 *
 * The provider id IS the llm.json entry key, so no derivation is needed — the
 * caller passes the ACTIVE provider from the runtime context (active-model.ts) and
 * this only validates it. An earlier version derived the entry from
 * `config.model` instead and swapped the key into the wrong entry whenever
 * opencode had auto-selected a different provider, leaving the exhausted one
 * untouched: the error kept firing with a fresh key sitting unused elsewhere.
 */
function clickzettaEntry(providerID: string | undefined): string | undefined {
  if (!providerID) return undefined
  const config = readLlmEntries()
  return config.llm[providerID]?.provider === "clickzetta" ? providerID : undefined
}

/**
 * The complimentary grant is spent. Its allowance is fixed, so the way forward is
 * a key of the user's own — which we can mint and swap in without the user
 * leaving the session or re-picking a model.
 *
 * The billing consequence is stated plainly: the free ride is over, and anything
 * from here bills the account.
 */
function freeKeyExhaustedPlan(code: GatewayErrorCode, entry: string): GatewayNoticePlan {
  return {
    code,
    title: "Free trial quota exhausted",
    message:
      "Your complimentary token quota is used up. Choose how to continue —\n" +
      "either way, usage from here is billed to your account.\n" +
      "Option 1 keeps your current model.",
    action: { kind: "provision-key", entry },
  }
}

/**
 * Build the confirm-dialog plan for a `session.error`, or undefined when the TUI
 * should stay quiet (not a billing block, a code no page can fix, or no reachable
 * account console).
 */
export async function planGatewayNotice(
  error: unknown,
  options: {
    signal?: AbortSignal
    /**
     * The provider currently serving this session, from the runtime context
     * (active-model.ts). Required to offer a key swap: it names the llm.json entry
     * to replace, and nothing else here can determine it correctly.
     */
    activeProviderID?: string
  } = {},
): Promise<GatewayNoticePlan | undefined> {
  const classified = classifyGatewayError(error)
  if (!classified) return undefined

  // A spent key is handled entirely locally, so it short-circuits before the
  // account-name lookup and URL derivation the overdue path needs. Only the
  // complimentary grant qualifies: a key the user provisioned needs its quota
  // raised, and silently replacing it would discard settings they chose.
  if (classified.code === "GATEWAY_TOO_MANY_REQUESTS") {
    if (!classified.isComplimentaryKey) return undefined
    const entry = clickzettaEntry(options.activeProviderID)
    if (!entry) return undefined
    return freeKeyExhaustedPlan(classified.code, entry)
  }

  const active = activeProfile()
  const accountDisplayName = active
    ? await runtimeAccountName({ ...active, ...(options.signal ? { signal: options.signal } : {}) })
    : undefined
  if (options.signal?.aborted) return undefined

  const service = str(active?.profile.service)
  const target = { accountDisplayName, ...(service ? { service } : {}) }

  // The name shown in the dialog must be the account the URL actually points at,
  // or the check we are asking the user to make is worthless. resolveAccountsUrl
  // falls back to the profile's `account_name` when the portal lookup failed, so
  // read the same fallback here instead of leaving the copy unnamed.
  const named = accountDisplayName ?? str(active?.profile.account_name)

  // An accounts URL is the only place to pay, so without one there is nothing to
  // offer and the raw error stands alone.
  const accountsUrl = resolveAccountsUrl(target)
  if (!accountsUrl) return undefined
  // An explicit profile `accounts_url` may point anywhere, so only name the
  // account when the URL was derived from that account's own site.
  return overduePlan(classified.code, accountsUrl.includes(`//${named}.`) ? named : undefined, accountsUrl)
}
