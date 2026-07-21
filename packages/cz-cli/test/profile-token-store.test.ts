import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuthToken } from "@clickzetta/sdk"
import {
  makeProfileTokenStore,
  patchProfileConnection,
  saveProfiles,
} from "../src/connection/profile-store.ts"

const previousTestHome = process.env.CLICKZETTA_TEST_HOME
let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cz-token-store-"))
  process.env.CLICKZETTA_TEST_HOME = home
})

afterEach(() => {
  if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = previousTestHome
  rmSync(home, { recursive: true, force: true })
})

function profilesPath() {
  return join(home, ".clickzetta", "profiles.toml")
}

const sampleToken: AuthToken = {
  token: "access-abc",
  refreshToken: "refresh-xyz",
  expireTimeMs: 3600_000,
  obtainedAt: 1_700_000_000_000,
  instanceId: 42,
  userId: 7,
}

test("save then load returns an equal AuthToken including refreshToken", () => {
  saveProfiles({ czcli: { pat: "p", instance: "myinstance" } })

  // save writes a shared [oauth.<id>] section and points the profile at it;
  // a fresh store with no explicit id resolves the token via that pointer.
  makeProfileTokenStore("czcli").save(sampleToken)

  expect(makeProfileTokenStore("czcli").load()).toEqual(sampleToken)
})

test("legacy token without refreshToken round-trips without the field", () => {
  saveProfiles({ czcli: { pat: "p", instance: "myinstance" } })

  const legacy: AuthToken = {
    token: "legacy-token",
    expireTimeMs: 1_000,
    obtainedAt: 1_700_000_000_000,
    instanceId: 1,
    userId: 2,
  }
  makeProfileTokenStore("czcli").save(legacy)

  const loaded = makeProfileTokenStore("czcli").load()
  expect(loaded).toEqual(legacy)
  expect(loaded?.refreshToken).toBeUndefined()
})

test("profiles.toml stays mode 0o600 after save", () => {
  saveProfiles({ czcli: { pat: "p", instance: "myinstance" } })

  makeProfileTokenStore("czcli").save(sampleToken)

  if (process.platform !== "win32") {
    expect(statSync(profilesPath()).mode & 0o777).toBe(0o600)
  }
})

test("clear is a no-op: shared token survives (only explicit logout removes it)", () => {
  saveProfiles({ czcli: { pat: "p", instance: "myinstance" } })

  const store = makeProfileTokenStore("czcli")
  store.save(sampleToken)
  expect(store.load()).toBeDefined()

  // A single profile's refresh failure must NOT wipe the shared token
  // (would sign out every sibling profile). clear() intentionally does nothing.
  store.clear()
  expect(store.load()).toEqual(sampleToken)
})

test("profiles sharing an oauth id share the token; unrelated profiles do not", () => {
  saveProfiles({
    a: { pat: "pa", instance: "myinstance" },
    b: { pat: "pb", instance: "myinstance" },
  })

  // Provision both a and b against the SAME shared oauth id.
  makeProfileTokenStore("a", "sharedid").save(sampleToken)
  makeProfileTokenStore("b", "sharedid").save(sampleToken)

  expect(makeProfileTokenStore("a").load()).toEqual(sampleToken)
  expect(makeProfileTokenStore("b").load()).toEqual(sampleToken)

  // A third profile with no oauth pointer sees nothing.
  saveProfiles({
    a: { pat: "pa", instance: "myinstance", oauth: "sharedid" },
    b: { pat: "pb", instance: "myinstance", oauth: "sharedid" },
    c: { pat: "pc", instance: "myinstance" },
  })
  expect(makeProfileTokenStore("c").load()).toBeUndefined()
})

test("save does not clobber the profile's existing fields", () => {
  saveProfiles({ czcli: { pat: "p", instance: "myinstance", workspace: "ws" } })

  makeProfileTokenStore("czcli").save(sampleToken)

  const reloaded = makeProfileTokenStore("czcli").load()
  expect(reloaded).toEqual(sampleToken)
  // Existing field preserved.
  expect(readFileSync(profilesPath(), "utf-8")).toContain('workspace = "ws"')
})

// Requirement 11.6/11.7: patchProfileConnection merges the logged-in context
// into the profile entry without touching oauth or unrelated fields.
test("patchProfileConnection merges connection context into the profile", () => {
  saveProfiles({ czcli: { pat: "p", instance: "old-instance", region: "cn" } })
  // Seed an oauth token to prove patchProfileConnection leaves it loadable.
  makeProfileTokenStore("czcli").save(sampleToken)

  patchProfileConnection("czcli", {
    service: "api.clickzetta.com",
    protocol: "https",
    instance: "89b94150",
    workspace: "quick_start",
    schema: "public",
    vcluster: "DEFAULT_AP",
    userId: 110000011361,
    accountId: 112407,
    accountName: "wynptmks",
  })

  const text = readFileSync(profilesPath(), "utf-8")
  // Patched fields are reflected in profiles.toml.
  expect(text).toContain('service = "api.clickzetta.com"')
  expect(text).toContain('instance = "89b94150"')
  expect(text).toContain('workspace = "quick_start"')
  expect(text).toContain('schema = "public"')
  expect(text).toContain('vcluster = "DEFAULT_AP"')
  expect(text).toContain("user_id = 110000011361")
  // account_id / account_name mapped onto the profile entry.
  expect(text).toContain("account_id = 112407")
  expect(text).toContain('account_name = "wynptmks"')
  // Unrelated field preserved.
  expect(text).toContain('region = "cn"')
  // 0o600 preserved.
  if (process.platform !== "win32") {
    expect(statSync(profilesPath()).mode & 0o777).toBe(0o600)
  }
  // oauth pointer untouched: the persisted token still loads.
  expect(makeProfileTokenStore("czcli").load()).toEqual(sampleToken)
})

test("patchProfileConnection ignores empty/undefined fields and no-ops without profile", () => {
  saveProfiles({ czcli: { pat: "p", instance: "keep-me" } })

  patchProfileConnection("czcli", { instance: "", workspace: undefined, userId: 0 })

  const text = readFileSync(profilesPath(), "utf-8")
  // Empty instance did not overwrite the existing value.
  expect(text).toContain('instance = "keep-me"')
  // Zero userId is not written.
  expect(text).not.toContain("user_id")

  // Unresolvable profile name is a safe no-op (does not throw).
  expect(() => patchProfileConnection("does-not-exist", { instance: "x" })).not.toThrow()
})

// NOTE: the former [profiles.<name>.userinfo] archival (patchProfileUserInfo) was
// removed — OAuth userinfo now flattens onto top-level profile fields
// (see provisionProfileFromOAuth + provision.test.ts), so there is no verbatim
// subtable to round-trip here.
