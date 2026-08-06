import { TENANT_OVER_QUOTA_MESSAGE, clickzettaGatewayCode, isClickzettaBillingCode } from "../llm/gateway-error.js"
import { accountLoginUrlForService } from "./account-login.js"
import { getDefaultProfileName, loadProfiles } from "../connection/profile-store.js"

// cz_change: billing/quota error presentation for the CLI.
//
// Classification itself lives in @clickzetta/ai-gateway (llm/gateway-error.ts
// re-exports it) and is shared with the LLM path — it keys off the gateway's own
// error codes. This module owns only what needs local configuration: which
// account console to point at. The gateway package ships as a file:// runtime
// asset and must not read the filesystem, which is why the split exists.

/** Whether a code/message pair is a ClickZetta billing block. */
export function isBillingError(input: { code?: string; message?: string }) {
  return isClickzettaBillingCode(clickzettaGatewayCode(input))
}

function activeProfileEntry(profileName?: string) {
  const profiles = loadProfiles()
  const explicitName = profileName ?? process.env.CZ_PROFILE
  if (explicitName) return profiles[explicitName]
  const defaultName = getDefaultProfileName()
  if (defaultName) return profiles[defaultName]
  return Object.values(profiles)[0]
}

function normalizeAccountsUrl(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/**
 * The account console for the identity the CLI is actually authenticated as.
 *
 * `accountDisplayName` must come from the RUNTIME identity (the SQL path reads it
 * off getCurrentUser), not from the profile: resolveConnectionConfig applies an
 * env override layer with its own auth priority (--pat > CZ_PAT > profile pat >
 * …), so `CZ_PAT=… cz-cli sql` authenticates as someone the profile never names.
 * Deriving the console from a stale profile field would send the user to a
 * different tenant's billing page, where paying fixes nothing.
 *
 * The profile's `account_name` is therefore a last resort only — it is written by
 * the OAuth and setup flows (connection/provision.ts, commands/setup.ts) and is
 * absent for PAT, JDBC, and hand-written profiles. An explicit `accounts_url`
 * always wins, being the one value the user set deliberately.
 *
 * Exported for the TUI's gateway-error prompt, which has a live portal token and
 * so can supply the runtime name.
 */
export function resolveAccountsUrl(input: {
  profileName?: string
  service?: string
  accountDisplayName?: string
}) {
  const profile = activeProfileEntry(input.profileName)
  const configured = str(profile?.accounts_url)
  if (configured) return normalizeAccountsUrl(configured)
  const accountName = str(input.accountDisplayName) ?? str(profile?.account_name)
  const service = input.service ?? str(profile?.service)
  if (!accountName || !service) return undefined
  return accountLoginUrlForService(service, accountName)
}

/**
 * Format a billing block for the CLI, adding the account console link when one
 * can be derived.
 */
export function formatBillingError(input: {
  code?: string
  message?: string
  profileName?: string
  service?: string
  accountDisplayName?: string
}) {
  const message = input.message ?? "Query failed"
  const code = clickzettaGatewayCode({ code: input.code, message })
  if (!code || !isClickzettaBillingCode(code)) return message

  // A cycle cap is not a debt: topping up leaves the caller just as blocked, so
  // the add-funds link below must not be offered for it.
  if (code === "GATEWAY_TENANT_OVER_QUOTA") return TENANT_OVER_QUOTA_MESSAGE

  const accountsUrl = resolveAccountsUrl({
    profileName: input.profileName,
    service: input.service,
    accountDisplayName: input.accountDisplayName,
  })
  if (!accountsUrl) return message

  return `Insufficient account balance. Please visit ${accountsUrl} to add funds.`
}
