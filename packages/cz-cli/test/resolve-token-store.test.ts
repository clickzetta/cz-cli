import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuthToken } from "@clickzetta/sdk"
import { resolveConnectionConfig } from "../src/connection/config.ts"
import { makeProfileTokenStore, saveProfiles } from "../src/connection/profile-store.ts"

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
  home = mkdtempSync(join(tmpdir(), "cz-resolve-token-store-"))
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

const sampleToken: AuthToken = {
  token: "access-abc",
  refreshToken: "refresh-xyz",
  expireTimeMs: 3600_000,
  obtainedAt: 1_700_000_000_000,
  instanceId: 42,
  userId: 7,
}

test("resolveConnectionConfig attaches a token store that round-trips via the shared oauth pointer", () => {
  // The store is gated on the profile's OAuth IDENTITY (`oauth = "<id>"`), not on
  // `instance` — see oauth-section-hygiene.test.ts. A pat alongside it does not
  // suppress the store: only an EXPLICIT per-invocation credential does.
  saveProfiles({ czcli: { pat: "the-pat", instance: "myinstance", service: "api.example.com", oauth: "sess" } })

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(cfg.tokenStore).toBeDefined()

  cfg.tokenStore!.save(sampleToken)

  expect(cfg.instance).toBe("myinstance")

  // save reused the profile's existing `oauth` pointer, so a fresh store (no
  // explicit id) resolves the very same [oauth.sess] section.
  const { makeProfileTokenStore } = require("../src/connection/profile-store.ts")
  const independent = makeProfileTokenStore("czcli")
  expect(independent.load()).toEqual(sampleToken)
})

test("resolveConnectionConfig attaches the store for an oauth profile that also has username auth", () => {
  saveProfiles({
    czcli: { username: "alice", password: "secret", instance: "inst2", service: "api.example.com", oauth: "sess" },
  })

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(cfg.tokenStore).toBeDefined()

  cfg.tokenStore!.save(sampleToken)

  expect(cfg.instance).toBe("inst2")

  const { makeProfileTokenStore } = require("../src/connection/profile-store.ts")
  expect(makeProfileTokenStore("czcli").load()).toEqual(sampleToken)
})

test("a pure-OAuth profile (no pat/username) attaches the store", () => {
  // No credential fields at all — just the OAuth pointer, which is the identity.
  saveProfiles({ czcli: { instance: "oauthonly", service: "api.example.com", oauth: "sess" } })

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(cfg.pat).toBeFalsy()
  expect(cfg.username).toBeFalsy()
  expect(cfg.instance).toBe("oauthonly")
  expect(cfg.tokenStore).toBeDefined()

  cfg.tokenStore!.save(sampleToken)
  const { makeProfileTokenStore } = require("../src/connection/profile-store.ts")
  expect(makeProfileTokenStore("czcli").load()).toEqual(sampleToken)
})

test("an instance alone does NOT attach the store (no OAuth identity to persist under)", () => {
  // Regression: the old `cfg.instance || hasOAuthPointer` gate attached the store
  // here, and a password/pat login's JWT was then saved into a random
  // [oauth.cz<hex>] section that nothing owned.
  saveProfiles({ czcli: { instance: "myinstance", service: "api.example.com", username: "u", password: "p" } })

  expect(resolveConnectionConfig({ profile: "czcli" }).tokenStore).toBeUndefined()
})

test("resolveConnectionConfig leaves tokenStore undefined when no auth identity resolves", () => {
  const cfg = resolveConnectionConfig({})
  expect(cfg.tokenStore).toBeUndefined()
})

test("an explicit --pat does NOT attach a token store (so a persisted OAuth token cannot shadow it)", () => {
  // Regression: a profile that once ran `cz-cli login` has an OAuth token
  // persisted under its instance slot. Running with an explicit --pat must
  // authenticate as that pat, not silently reuse the stored OAuth token.
  saveProfiles({ czcli: { instance: "inst", service: "api.example.com" } })
  makeProfileTokenStore("czcli", "inst").save(sampleToken)

  const cfg = resolveConnectionConfig({ profile: "czcli", pat: "explicit-pat" })
  expect(cfg.pat).toBe("explicit-pat")
  expect(cfg.tokenStore).toBeUndefined()
})

test("an explicit --username/--password does NOT attach a token store", () => {
  saveProfiles({ czcli: { instance: "inst", service: "api.example.com" } })
  makeProfileTokenStore("czcli", "inst").save(sampleToken)

  const cfg = resolveConnectionConfig({ profile: "czcli", username: "alice", password: "secret" })
  expect(cfg.username).toBe("alice")
  expect(cfg.tokenStore).toBeUndefined()
})

test("CZ_PAT from the environment does NOT attach a token store", () => {
  saveProfiles({ czcli: { instance: "inst", service: "api.example.com" } })
  makeProfileTokenStore("czcli", "inst").save(sampleToken)
  process.env.CZ_PAT = "env-pat"

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(cfg.pat).toBe("env-pat")
  expect(cfg.tokenStore).toBeUndefined()
})

test("a profile-level pat STILL attaches the store when the profile has an OAuth identity", () => {
  // Provenance rule: only EXPLICIT --pat/CZ_PAT/--username+--password suppress the
  // store. A pat stored ON the profile does not, so a profile carrying both a pat
  // and a real OAuth login can still reach the persisted token.
  saveProfiles({ czcli: { pat: "profile-pat", instance: "inst", service: "api.example.com", oauth: "sess" } })

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(cfg.pat).toBe("profile-pat")
  expect(cfg.tokenStore).toBeDefined()
})

test("--username alone against a profile-stored password STILL attaches the store", () => {
  // pickCredential enters the flag tier as soon as EITHER --username or
  // --password is set and fills the missing half from the profile — that is
  // how `--username alice` against a profile-stored password keeps working.
  // The credential is only HALF the user speaking now; the OAuth login the
  // other half came from must not be suppressed by it.
  saveProfiles({
    czcli: { username: "alice", password: "profile-secret", instance: "inst", service: "api.example.com", oauth: "sess" },
  })

  const cfg = resolveConnectionConfig({ profile: "czcli", username: "alice" })
  expect(cfg.username).toBe("alice")
  expect(cfg.password).toBe("profile-secret")
  expect(cfg.tokenStore).toBeDefined()
})

test("CZ_USERNAME/CZ_PASSWORD from the environment does NOT suppress the store", () => {
  // Unlike CZ_PAT (a single value, unambiguously the user's), an env
  // username/password pair has never been treated as explicit here.
  saveProfiles({ czcli: { instance: "inst", service: "api.example.com", oauth: "sess" } })
  process.env.CZ_USERNAME = "envuser"
  process.env.CZ_PASSWORD = "envpass"

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(cfg.username).toBe("envuser")
  expect(cfg.tokenStore).toBeDefined()
})

test("--username/--password that LOSE to a profile pat still attach the store (source, not fields, decides explicitness)", () => {
  // Confirms the intent behind keying explicitCredential off credential.source
  // rather than "which fields were set": --pat > CZ_PAT > profile pat >
  // --username/--password, so a profile pat with no auth_type pin wins over an
  // explicit --username/--password pair, and pickCredential tags that result
  // source: "profile" — not "flag". The flags LOST the priority tier, so by the
  // same reasoning as the profile-level-pat and --username-alone tests above,
  // they should not suppress the store either: the profile pat is what's
  // actually speaking here, same as if no credential flag had been passed.
  saveProfiles({
    czcli: { pat: "profile-pat", instance: "inst", service: "api.example.com", oauth: "sess" },
  })

  const cfg = resolveConnectionConfig({ profile: "czcli", username: "alice", password: "secret" })
  expect(cfg.pat).toBe("profile-pat") // profile pat outranks the flag pair
  expect(cfg.tokenStore).toBeDefined()
})

test("a lone CZ_USERNAME (no CZ_PASSWORD) plus --password merges with the env username, not the profile's", () => {
  // Confirms the intent behind dropping getEnvConfig()'s old gate (return
  // non-auth fields only unless the env holds CZ_PAT or a COMPLETE
  // CZ_USERNAME+CZ_PASSWORD pair): ConnectionEnv.read() has no such gate, so a
  // half-set CZ_USERNAME now participates in the flag-tier merge alongside a
  // --password flag, consistent with this file's documented env > profile
  // layering — instead of falling through to the profile's own username the
  // way the pre-refactor code did.
  saveProfiles({ czcli: { username: "profileuser", password: "profilepass", instance: "inst", service: "api.example.com" } })
  process.env.CZ_USERNAME = "envuser"

  const cfg = resolveConnectionConfig({ profile: "czcli", password: "p" })
  expect(cfg.username).toBe("envuser")
  expect(cfg.password).toBe("p")
})

test("a pat-only profile gets no store, with or without an instance", () => {
  // Nothing here is an OAuth login, so there is no section to read and none to
  // create: the PAT-exchanged token stays in memory.
  saveProfiles({ czcli: { pat: "the-pat", service: "api.example.com" } })
  expect(resolveConnectionConfig({ profile: "czcli" }).tokenStore).toBeUndefined()

  saveProfiles({ czcli: { pat: "the-pat", instance: "inst", service: "api.example.com" } })
  expect(resolveConnectionConfig({ profile: "czcli" }).tokenStore).toBeUndefined()
})
