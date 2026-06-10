import { accountLoginUrlForService } from "./account-login.js"
import { getDefaultProfileName, loadProfiles } from "../connection/profile-store.js"

const INSUFFICIENT_BALANCE_CODE = "CZLH-60029"
const OVERDUE_PAYMENTS_RE = /Account\s+([a-z0-9_-]+)\s+has overdue payments\./i
const INSUFFICIENT_BALANCE_RE = /insufficient account balance|overdue payments|job submission is currently restricted/i

function activeProfileEntry(profileName?: string) {
  const profiles = loadProfiles()
  const explicitName = profileName ?? process.env.CZ_PROFILE
  if (explicitName) return profiles[explicitName]
  return profiles[getDefaultProfileName() ?? ""] ?? Object.values(profiles)[0]
}

function normalizeAccountsUrl(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function extractAccountName(message: string) {
  return OVERDUE_PAYMENTS_RE.exec(message)?.[1]
}

function resolveAccountsUrl(input: {
  accountName?: string
  profileName?: string
  service?: string
}) {
  const profile = activeProfileEntry(input.profileName)
  if (typeof profile?.accounts_url === "string" && profile.accounts_url.trim()) {
    return normalizeAccountsUrl(profile.accounts_url)
  }
  if (!input.accountName || !input.service) return undefined
  return accountLoginUrlForService(input.service, input.accountName)
}

export function formatBillingError(input: {
  code?: string
  message?: string
  profileName?: string
  service?: string
}) {
  const message = input.message ?? "Query failed"
  if (input.code !== INSUFFICIENT_BALANCE_CODE && !INSUFFICIENT_BALANCE_RE.test(message)) {
    return message
  }

  const accountsUrl = resolveAccountsUrl({
    accountName: extractAccountName(message),
    profileName: input.profileName,
    service: input.service,
  })
  if (!accountsUrl) return message

  return `Insufficient account balance. Please visit ${accountsUrl} to add funds.`
}
