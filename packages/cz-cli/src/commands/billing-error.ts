import { accountLoginUrlForService } from "./account-login.js"
import { getDefaultProfileName, loadProfiles } from "../connection/profile-store.js"

const INSUFFICIENT_BALANCE_CODE = "CZLH-60029"
const GATEWAY_BILLING_CODES = new Set(["GATEWAY_TENANT_OVERDUE", "GATEWAY_TENANT_OVER_QUOTA"])
const INSUFFICIENT_BALANCE_RE = /insufficient account balance|overdue payments|job submission is currently restricted/i
const GATEWAY_BILLING_RE = /\[G2\]\s*Tenant (?:overdue|over quota)\b|Tenant (?:overdue|over quota)\b|GATEWAY_TENANT_OVERDUE|GATEWAY_TENANT_OVER_QUOTA/i

export function isBillingError(input: { code?: string; message?: string }) {
  const message = input.message ?? ""
  return input.code === INSUFFICIENT_BALANCE_CODE
    || (input.code ? GATEWAY_BILLING_CODES.has(input.code) : false)
    || INSUFFICIENT_BALANCE_RE.test(message)
    || GATEWAY_BILLING_RE.test(message)
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

function resolveAccountsUrl(input: {
  profileName?: string
  service?: string
  accountDisplayName?: string
}) {
  const profile = activeProfileEntry(input.profileName)
  if (typeof profile?.accounts_url === "string" && profile.accounts_url.trim()) {
    return normalizeAccountsUrl(profile.accounts_url)
  }
  const accountName = input.accountDisplayName?.trim()
  const service = input.service
  if (!accountName || !service) return undefined
  return accountLoginUrlForService(service, accountName)
}

export function formatBillingError(input: {
  code?: string
  message?: string
  profileName?: string
  service?: string
  accountDisplayName?: string
}) {
  const message = input.message ?? "Query failed"
  if (!isBillingError({ code: input.code, message })) {
    return message
  }

  const accountsUrl = resolveAccountsUrl({
    profileName: input.profileName,
    service: input.service,
    accountDisplayName: input.accountDisplayName,
  })
  if (!accountsUrl) return message

  return `Insufficient account balance. Please visit ${accountsUrl} to add funds.`
}
