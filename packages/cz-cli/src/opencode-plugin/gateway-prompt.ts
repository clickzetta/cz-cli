// cz_change: turn an AI-gateway billing/quota failure into an actionable browser
// jump for the TUI (see gateway-prompt-view.tsx for the confirm dialog).
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
import { getCurrentUser, getToken, toServiceUrl } from "@clickzetta/sdk"
import { browserOpenCommandForPlatform } from "../util/browser.js"
import { resolveAccountsUrl } from "../commands/billing-error.js"
import { resolveConnectionConfig } from "../connection/config.js"
import { getCookieToken } from "../connection/cookie-token.js"
import { getDefaultProfileName, loadProfiles } from "../connection/profile-store.js"
import { rewriteClickzettaGatewayError, type GatewayErrorCode } from "../llm/gateway-error.js"

export { browserOpenCommandForPlatform }

export type GatewayPromptPlan = {
  /** The gateway code that produced this prompt. */
  code: GatewayErrorCode
  /** Dialog title. */
  title: string
  /** Dialog body, already including the account name and the URL. */
  message: string
  /** Opened on confirm. */
  url: string
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
const PROMPTABLE_CODES: readonly string[] = ["GATEWAY_TENANT_OVERDUE", "CZLH-60029"]

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
  const name = process.env.CZ_PROFILE ?? getDefaultProfileName() ?? Object.keys(profiles)[0]
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
    const token = (await getCookieToken(config)) ?? (await getToken(config))
    if (input.signal?.aborted) return undefined
    const user = await getCurrentUser(toServiceUrl(config.service, config.protocol), token.token)
    return str(user.accountDisplayName)
  } catch {
    return undefined
  }
}

function overduePlan(code: GatewayErrorCode, accountName: string | undefined, url: string): GatewayPromptPlan {
  // The account is named so a user with several keys can check this is the tenant
  // that actually owes money before paying anything.
  const target = accountName ? `the billing page for ${accountName}` : "the billing page"
  return {
    code,
    title: "Account has unpaid charges",
    message:
      "This API key is blocked by unpaid charges. Adding funds restores access.\n" +
      `Open ${target}? You will need to sign in to pay.\n${url}`,
    url,
  }
}

/**
 * Build the confirm-dialog plan for a `session.error`, or undefined when the TUI
 * should stay quiet (not a billing block, a code no page can fix, or no reachable
 * account console).
 */
export async function planGatewayPrompt(
  error: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<GatewayPromptPlan | undefined> {
  const classified = classifyGatewayError(error)
  if (!classified) return undefined

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
