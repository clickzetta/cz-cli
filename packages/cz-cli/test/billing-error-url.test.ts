/**
 * Unit tests for the accounts-console URL derivation behind billing/quota errors.
 * Run: bun test test/billing-error-url.test.ts
 *
 * The SQL-path end-to-end behaviour is covered by sql-billing-error.test.ts; this
 * file pins the resolver itself, including the precedence rule that matters most:
 * the RUNTIME account name must win over the profile's stored one. resolveConnection
 * Config applies an env override layer with its own auth priority (--pat > CZ_PAT >
 * profile pat > …), so `CZ_PAT=… cz-cli` authenticates as an identity the profile
 * never names — deriving the console from the stale field would send the user to a
 * different tenant's billing page, where paying fixes nothing.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { requireTestHome } from "./support/cz-fixtures.js"
import { formatBillingError, resolveAccountsUrl } from "../src/commands/billing-error.ts"

const originalProfile = process.env.CZ_PROFILE

function writeProfiles(extra: string[] = []) {
  writeFileSync(
    join(requireTestHome(), ".clickzetta", "profiles.toml"),
    [
      'default_profile = "test"',
      "[profiles.test]",
      'pat = "pat"',
      'service = "uat-api.clickzetta.com"',
      'instance = "inst"',
      ...extra,
    ].join("\n"),
  )
}

beforeEach(() => {
  delete process.env.CZ_PROFILE
  writeProfiles()
})

afterEach(() => {
  if (originalProfile === undefined) delete process.env.CZ_PROFILE
  else process.env.CZ_PROFILE = originalProfile
})

describe("resolveAccountsUrl precedence", () => {
  test("an explicit accounts_url wins over everything", () => {
    writeProfiles(['accounts_url = "https://pinned.accounts.clickzetta.com/"', 'account_name = "stored"'])
    expect(resolveAccountsUrl({ accountDisplayName: "runtime" })).toBe("https://pinned.accounts.clickzetta.com")
  })

  test("the runtime account name beats the profile's stored one", () => {
    writeProfiles(['account_name = "stale"'])
    // uat- service host → the uat accounts site, per accountLoginUrlForService.
    expect(resolveAccountsUrl({ accountDisplayName: "runtime" })).toBe("https://runtime.uat-accounts.clickzetta.com")
  })

  test("the profile's account_name is used only when no runtime name is supplied", () => {
    writeProfiles(['account_name = "stored"'])
    expect(resolveAccountsUrl({})).toBe("https://stored.uat-accounts.clickzetta.com")
  })

  test("no account name anywhere resolves to nothing", () => {
    // Profiles created from a PAT, a JDBC URL, or by hand carry no account_name.
    expect(resolveAccountsUrl({})).toBeUndefined()
  })

  test("a production region host resolves to the global accounts site", () => {
    // Regression: the region segment used to be spliced into the accounts host,
    // producing cn-shanghai-alicloud-accounts.clickzetta.com — NXDOMAIN, so the
    // dialog offered a link that could not open. Caught by pointing the real
    // cn-shanghai profile at a genuinely overdue tenant.
    expect(resolveAccountsUrl({ accountDisplayName: "bxhzbghd", service: "https://cn-shanghai-alicloud.api.clickzetta.com" })).toBe(
      "https://bxhzbghd.accounts.clickzetta.com",
    )
  })

  test("an explicit service overrides the profile's", () => {
    expect(resolveAccountsUrl({ accountDisplayName: "acct", service: "api.singdata.com" })).toBe(
      "https://acct.accounts.singdata.com",
    )
  })
})

describe("formatBillingError", () => {
  test("adds the top-up link for a billing error", () => {
    writeProfiles(['account_name = "stored"'])
    expect(formatBillingError({ code: "CZLH-60029", message: "overdue payments" })).toBe(
      "Insufficient account balance. Please visit https://stored.uat-accounts.clickzetta.com to add funds.",
    )
  })

  test("leaves a non-billing error untouched", () => {
    writeProfiles(['account_name = "stored"'])
    expect(formatBillingError({ code: "CZLH-1", message: "syntax error" })).toBe("syntax error")
  })

  test("keeps the original message when no console can be derived", () => {
    expect(formatBillingError({ code: "CZLH-60029", message: "overdue payments" })).toBe("overdue payments")
  })

  test("a tenant cycle cap does not get the add-funds link", () => {
    // Reachable on this path too: the over-quota code and its wording both land
    // here, so before the codes were separated a SQL failure on a capped tenant
    // also read "add funds" — advice that leaves the caller just as blocked.
    writeProfiles(['account_name = "stored"'])
    const out = formatBillingError({ code: "GATEWAY_TENANT_OVER_QUOTA", message: "[G2] Tenant over quota" })
    expect(out).not.toContain("add funds")
    expect(out).not.toContain("stored.uat-accounts")
    expect(out).toContain("billing cycle")
  })
})
