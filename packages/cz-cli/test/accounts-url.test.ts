import { afterEach, describe, expect, test } from "bun:test"
import { accountsBaseUrl } from "../src/connection/accounts-url"

const ENV_KEY = "CZ_OAUTH_ACCOUNTS_URL"
const original = process.env[ENV_KEY]

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = original
})

describe("accountsBaseUrl", () => {
  test("prod api host derives bare accounts host", () => {
    delete process.env[ENV_KEY]
    expect(accountsBaseUrl("api.clickzetta.com")).toBe("https://accounts.clickzetta.com")
  })

  test("dev api host derives env-prefixed accounts host", () => {
    delete process.env[ENV_KEY]
    expect(accountsBaseUrl("dev-api.clickzetta.com")).toBe("https://dev-accounts.clickzetta.com")
  })

  test("sit and uat api hosts derive env-prefixed accounts hosts", () => {
    delete process.env[ENV_KEY]
    expect(accountsBaseUrl("sit-api.clickzetta.com")).toBe("https://sit-accounts.clickzetta.com")
    expect(accountsBaseUrl("uat-api.clickzetta.com")).toBe("https://uat-accounts.clickzetta.com")
  })

  test("singdata root domain is preserved", () => {
    delete process.env[ENV_KEY]
    expect(accountsBaseUrl("api.singdata.com")).toBe("https://accounts.singdata.com")
    expect(accountsBaseUrl("dev-api.singdata.com")).toBe("https://dev-accounts.singdata.com")
  })

  test("accepts a full URL service input", () => {
    delete process.env[ENV_KEY]
    expect(accountsBaseUrl("https://dev-api.clickzetta.com")).toBe("https://dev-accounts.clickzetta.com")
    expect(accountsBaseUrl("https://api.clickzetta.com/")).toBe("https://accounts.clickzetta.com")
  })

  test("CZ_OAUTH_ACCOUNTS_URL overrides derivation and is trimmed without trailing slash", () => {
    process.env[ENV_KEY] = "  https://custom-accounts.example.com/  "
    expect(accountsBaseUrl("api.clickzetta.com")).toBe("https://custom-accounts.example.com")
  })
})
