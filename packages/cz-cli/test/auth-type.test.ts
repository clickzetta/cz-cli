import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseTOML } from "smol-toml"
import type { AuthToken } from "@clickzetta/sdk"
import { resolveConnectionConfig } from "../src/connection/config.ts"
import {
  deriveAuthType,
  explicitAuthType,
  invalidAuthType,
  invalidAuthTypeMessage,
  makeProfileTokenStore,
  readAuthType,
  saveProfiles,
  setAuthTypeIfAbsent,
} from "../src/connection/profile-store.ts"

/**
 * `auth_type` is a SELECTOR, not a label: a profile may carry a pat AND an
 * `oauth = "<id>"` pointer AND username/password at once, and before this field
 * which one won was an emergent property of two independent decisions —
 * resolveConnectionConfig setting cfg.pat, and getToken() consulting
 * config.tokenStore before fetchToken(). A profile with both therefore
 * authenticated as the OAuth identity while cfg.pat sat unused.
 *
 * Two invariants dominate these tests:
 *   1. An ABSENT auth_type must reproduce the old behavior exactly. Every existing
 *      profile on disk lacks the field, so a regression here is a silent identity
 *      change for real users.
 *   2. A PRESENT auth_type is never overwritten and never inferred-then-persisted.
 *      It is a user-owned setting; re-login must not repoint it.
 */

const previousTestHome = process.env.CLICKZETTA_TEST_HOME
const previousEnv = {
  CZ_PROFILE: process.env.CZ_PROFILE,
  CZ_PAT: process.env.CZ_PAT,
  CZ_USERNAME: process.env.CZ_USERNAME,
  CZ_PASSWORD: process.env.CZ_PASSWORD,
  CZ_INSTANCE: process.env.CZ_INSTANCE,
}
let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cz-auth-type-"))
  process.env.CLICKZETTA_TEST_HOME = home
  // Isolate from the host environment so env-derived auth never leaks in.
  delete process.env.CZ_PROFILE
  delete process.env.CZ_PAT
  delete process.env.CZ_USERNAME
  delete process.env.CZ_PASSWORD
  delete process.env.CZ_INSTANCE
})

afterEach(() => {
  if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = previousTestHome
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(home, { recursive: true, force: true })
})

const TOKEN: AuthToken = {
  token: "OAUTH-TOKEN",
  refreshToken: "refresh-xyz",
  expireTimeMs: 3600_000,
  obtainedAt: Date.now(),
  instanceId: 42,
  userId: 7,
}

/** A profile carrying EVERY credential at once — the ambiguous case. */
function saveAmbiguous(extra: Record<string, unknown> = {}) {
  saveProfiles({
    mixed: {
      pat: "PAT-VALUE",
      username: "u",
      password: "p",
      instance: "i1",
      service: "s.example.com",
      oauth: "mixed",
      header: { Cookie: "X-ClickZetta-Token=COOKIE-TOKEN" },
      ...extra,
    },
  })
  makeProfileTokenStore("mixed", "mixed").save(TOKEN)
}

function readToml() {
  return parseTOML(readFileSync(join(home, ".clickzetta", "profiles.toml"), "utf-8")) as Record<string, unknown>
}

describe("deriveAuthType", () => {
  // Order mirrors the effective runtime precedence (cookie is consulted before the
  // OAuth token; a persisted OAuth token is consulted before a profile pat), so a
  // derived value reproduces today's behavior rather than changing it.
  test("prefers cookie, then oauth, then pat, then password", () => {
    expect(deriveAuthType({ header: { Cookie: "X-ClickZetta-Token=t" }, oauth: "x", pat: "p" })).toBe("cookie")
    expect(deriveAuthType({ oauth: "x", pat: "p", username: "u", password: "p" })).toBe("oauth")
    expect(deriveAuthType({ pat: "p", username: "u", password: "p" })).toBe("pat")
    expect(deriveAuthType({ username: "u", password: "p" })).toBe("password")
  })

  test("detects a Cookie header in either storage shape, case-insensitively", () => {
    expect(deriveAuthType({ header: { Cookie: "a=b" } })).toBe("cookie")
    expect(deriveAuthType({ "header.Cookie": "a=b" })).toBe("cookie")
    expect(deriveAuthType({ "HEADER.COOKIE": "a=b" })).toBe("cookie")
  })

  test("returns undefined when no credential is present", () => {
    expect(deriveAuthType({ service: "s" })).toBeUndefined()
    expect(deriveAuthType(undefined)).toBeUndefined()
    // A username with no password cannot authenticate, so it is not "password".
    expect(deriveAuthType({ username: "u" })).toBeUndefined()
    // Empty strings are not credentials.
    expect(deriveAuthType({ pat: "", oauth: "" })).toBeUndefined()
  })
})

describe("explicitAuthType", () => {
  test("accepts the four known values, case/space insensitively", () => {
    expect(explicitAuthType({ auth_type: "pat" })).toBe("pat")
    expect(explicitAuthType({ auth_type: " OAuth " })).toBe("oauth")
    expect(explicitAuthType({ auth_type: "COOKIE" })).toBe("cookie")
  })

  test("treats an unrecognized or non-string value as absent", () => {
    // This function only reports "is there a valid pin"; it does NOT decide policy.
    // Callers that select a credential reject an unknown value outright via
    // invalidAuthType (see below) — returning undefined here is what lets read-only
    // surfaces like `profile list` keep rendering a broken profile.
    expect(explicitAuthType({ auth_type: "patt" })).toBeUndefined()
    expect(explicitAuthType({ auth_type: "" })).toBeUndefined()
    expect(explicitAuthType({ auth_type: 1 })).toBeUndefined()
    expect(explicitAuthType({})).toBeUndefined()
  })
})

describe("readAuthType", () => {
  test("prefers an explicit value over what the fields imply", () => {
    saveProfiles({ p: { pat: "x", oauth: "p", auth_type: "pat" } })
    // Derivation alone would say "oauth"; the explicit pin wins.
    expect(deriveAuthType({ pat: "x", oauth: "p" })).toBe("oauth")
    expect(readAuthType("p")).toBe("pat")
  })

  test("falls back to derivation for a profile written before the field existed", () => {
    saveProfiles({ p: { oauth: "p", service: "s" } })
    expect(readAuthType("p")).toBe("oauth")
  })

  test("never writes — reading must not mutate the profile", () => {
    saveProfiles({ p: { oauth: "p", service: "s" } })
    const before = readFileSync(join(home, ".clickzetta", "profiles.toml"), "utf-8")
    readAuthType("p")
    expect(readFileSync(join(home, ".clickzetta", "profiles.toml"), "utf-8")).toBe(before)
  })
})

describe("setAuthTypeIfAbsent", () => {
  test("writes the value when the profile has none", () => {
    saveProfiles({ p: { oauth: "p" } })
    setAuthTypeIfAbsent("p", "oauth")
    expect((readToml().profiles as Record<string, Record<string, unknown>>).p.auth_type).toBe("oauth")
  })

  test("never overwrites an existing value, including on re-login", () => {
    // The scenario: a profile pinned to oauth, then `auth login --pat` against it.
    // Repointing it would silently change which identity every later command uses.
    saveProfiles({ p: { oauth: "p", auth_type: "oauth" } })
    setAuthTypeIfAbsent("p", "pat")
    expect((readToml().profiles as Record<string, Record<string, unknown>>).p.auth_type).toBe("oauth")
  })

  test("leaves an unrecognized existing value alone", () => {
    // Overwriting would "fix" the typo by silently choosing a credential for the
    // user. The value is theirs; the CLI reports it as an error instead.
    saveProfiles({ p: { oauth: "p", auth_type: "typo" } })
    setAuthTypeIfAbsent("p", "oauth")
    expect((readToml().profiles as Record<string, Record<string, unknown>>).p.auth_type).toBe("typo")
  })

  test("is a no-op for a missing profile or absent name", () => {
    saveProfiles({ p: {} })
    expect(() => setAuthTypeIfAbsent("nope", "pat")).not.toThrow()
    expect(() => setAuthTypeIfAbsent(undefined, "pat")).not.toThrow()
    expect((readToml().profiles as Record<string, unknown>).nope).toBeUndefined()
  })
})

describe("auth_type selects the credential in resolveConnectionConfig", () => {
  // The store is the mechanism that made the old ambiguity silent: getToken()
  // reads config.tokenStore BEFORE fetchToken(), so an attached store beats
  // whatever cfg.pat/username hold. Withholding it is what makes a non-oauth pin
  // actually take effect, so every case below asserts on the store too.

  test("REGRESSION: absent auth_type behaves exactly as before (oauth store wins)", () => {
    // This is the state of every profile written before this field existed.
    saveAmbiguous()
    const cfg = resolveConnectionConfig({ profile: "mixed" })
    expect(cfg.pat).toBe("PAT-VALUE")
    expect(cfg.tokenStore).toBeDefined()
    expect(cfg.tokenStore?.load()?.token).toBe("OAUTH-TOKEN")
    // Cookie header still present, still consulted first by callers.
    expect(cfg.customHeaders?.Cookie).toContain("COOKIE-TOKEN")
  })

  test("auth_type=pat drops the store and the cookie so the pat is what remains", () => {
    saveAmbiguous({ auth_type: "pat" })
    const cfg = resolveConnectionConfig({ profile: "mixed" })
    expect(cfg.pat).toBe("PAT-VALUE")
    expect(cfg.tokenStore).toBeUndefined()
    expect(cfg.customHeaders?.Cookie).toBeUndefined()
  })

  test("auth_type=password ignores the profile pat", () => {
    saveAmbiguous({ auth_type: "password" })
    const cfg = resolveConnectionConfig({ profile: "mixed" })
    // Without the pin, profilePat would win the priority chain and blank these.
    expect(cfg.pat).toBe("")
    expect(cfg.username).toBe("u")
    expect(cfg.password).toBe("p")
    expect(cfg.tokenStore).toBeUndefined()
    expect(cfg.customHeaders?.Cookie).toBeUndefined()
  })

  test("auth_type=oauth ignores the profile pat and username, keeping the store", () => {
    saveAmbiguous({ auth_type: "oauth" })
    const cfg = resolveConnectionConfig({ profile: "mixed" })
    expect(cfg.pat).toBe("")
    expect(cfg.username).toBe("")
    expect(cfg.tokenStore).toBeDefined()
    expect(cfg.tokenStore?.load()?.token).toBe("OAUTH-TOKEN")
    // A cookie would still be consulted before the OAuth token, so it must go.
    expect(cfg.customHeaders?.Cookie).toBeUndefined()
  })

  test("auth_type=cookie keeps the cookie and drops the store and pat", () => {
    saveAmbiguous({ auth_type: "cookie" })
    const cfg = resolveConnectionConfig({ profile: "mixed" })
    expect(cfg.customHeaders?.Cookie).toContain("COOKIE-TOKEN")
    expect(cfg.pat).toBe("")
    expect(cfg.tokenStore).toBeUndefined()
  })

  test("an explicit per-invocation credential still outranks the pin", () => {
    // auth_type arbitrates a profile's OWN fields. `--pat` is the user speaking now,
    // and the documented priority (--pat > CZ_PAT > profile) must survive.
    saveAmbiguous({ auth_type: "oauth" })
    const cfg = resolveConnectionConfig({ profile: "mixed", pat: "CLI-PAT" })
    expect(cfg.pat).toBe("CLI-PAT")
    expect(cfg.tokenStore).toBeUndefined()
  })

  test("a pin does not strip non-credential headers", () => {
    saveProfiles({
      p: { pat: "x", auth_type: "pat", instance: "i", header: { Cookie: "X-ClickZetta-Token=t", "X-Trace": "keep" } },
    })
    const cfg = resolveConnectionConfig({ profile: "p" })
    expect(cfg.customHeaders?.Cookie).toBeUndefined()
    expect(cfg.customHeaders?.["X-Trace"]).toBe("keep")
  })

  test("an unrecognized auth_type is a hard error, not a silent fallback", () => {
    // profiles.toml is hand-editable, so a typo is realistic. Falling back would
    // restore the ambiguous precedence this field removes and could authenticate as
    // a different identity than the user pinned — with nothing printed anywhere.
    saveAmbiguous({ auth_type: "passwrod" })
    expect(() => resolveConnectionConfig({ profile: "mixed" })).toThrow(/invalid auth_type/)
    // The message must name the profile, echo the bad value, and list the valid ones.
    try {
      resolveConnectionConfig({ profile: "mixed" })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain("mixed")
      expect(message).toContain("passwrod")
      for (const valid of ["pat", "password", "oauth", "cookie"]) expect(message).toContain(valid)
      expect((e as { code?: string }).code).toBe("INVALID_AUTH_TYPE")
    }
  })

  test("an empty auth_type reads as unset rather than invalid", () => {
    // `auth_type = ""` is how a user clears the pin; treating it as a typo would
    // make the documented way to opt out an error.
    saveAmbiguous({ auth_type: "" })
    const cfg = resolveConnectionConfig({ profile: "mixed" })
    expect(cfg.pat).toBe("PAT-VALUE")
    expect(cfg.tokenStore).toBeDefined()
  })
})

describe("invalidAuthType", () => {
  test("flags a present-but-unknown value and passes valid/absent ones", () => {
    expect(invalidAuthType({ auth_type: "passwrod" })).toBe("passwrod")
    expect(invalidAuthType({ auth_type: 42 })).toBe("42")
    expect(invalidAuthType({ auth_type: "pat" })).toBeUndefined()
    expect(invalidAuthType({ auth_type: " OAuth " })).toBeUndefined()
    expect(invalidAuthType({ auth_type: "" })).toBeUndefined()
    expect(invalidAuthType({})).toBeUndefined()
    expect(invalidAuthType(undefined)).toBeUndefined()
  })

  test("profile list reports the error instead of throwing", () => {
    // Any command that PICKS a credential fails hard, so the read-only listing has
    // to keep working — it is where the user finds out which profile is broken.
    const raw = invalidAuthType({ auth_type: "bogus" })!
    const message = invalidAuthTypeMessage("myprofile", raw)
    expect(message).toContain("myprofile")
    expect(message).toContain("bogus")
    expect(message).toContain("profiles.toml")
  })
})
