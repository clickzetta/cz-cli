import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { parse as parseTOML } from "smol-toml"
import type { AuthToken } from "@clickzetta/sdk"
import {
  makeProfileTokenStore,
  patchProfileConnection,
  patchProfileUserInfo,
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

const cacheKey = "myinstance:czcli-user"

test("save then load returns an equal AuthToken including refreshToken", () => {
  saveProfiles({ czcli: { pat: "p", instance: "myinstance" } })

  const store = makeProfileTokenStore("czcli", cacheKey)
  store.save(sampleToken)

  expect(store.load()).toEqual(sampleToken)
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
  const store = makeProfileTokenStore("czcli", cacheKey)
  store.save(legacy)

  const loaded = store.load()
  expect(loaded).toEqual(legacy)
  expect(loaded?.refreshToken).toBeUndefined()
})

test("profiles.toml stays mode 0o600 after save", () => {
  saveProfiles({ czcli: { pat: "p", instance: "myinstance" } })

  makeProfileTokenStore("czcli", cacheKey).save(sampleToken)

  if (process.platform !== "win32") {
    expect(statSync(profilesPath()).mode & 0o777).toBe(0o600)
  }
})

test("clear removes the entry so load returns undefined", () => {
  saveProfiles({ czcli: { pat: "p", instance: "myinstance" } })

  const store = makeProfileTokenStore("czcli", cacheKey)
  store.save(sampleToken)
  expect(store.load()).toBeDefined()

  store.clear()
  expect(store.load()).toBeUndefined()
})

test("tokens are isolated across profiles", () => {
  saveProfiles({
    a: { pat: "pa", instance: "myinstance" },
    b: { pat: "pb", instance: "myinstance" },
  })

  makeProfileTokenStore("a", cacheKey).save(sampleToken)

  expect(makeProfileTokenStore("a", cacheKey).load()).toEqual(sampleToken)
  expect(makeProfileTokenStore("b", cacheKey).load()).toBeUndefined()
})

test("tokens are isolated across cache keys within the same profile", () => {
  saveProfiles({ czcli: { pat: "p", instance: "myinstance" } })

  const tokenA: AuthToken = { ...sampleToken, token: "access-A", refreshToken: "refresh-A" }
  const tokenB: AuthToken = { ...sampleToken, token: "access-B", refreshToken: "refresh-B" }

  makeProfileTokenStore("czcli", "instance:userA").save(tokenA)
  makeProfileTokenStore("czcli", "instance:userB").save(tokenB)

  expect(makeProfileTokenStore("czcli", "instance:userA").load()).toEqual(tokenA)
  expect(makeProfileTokenStore("czcli", "instance:userB").load()).toEqual(tokenB)
})

test("save does not clobber the profile's existing fields", () => {
  saveProfiles({ czcli: { pat: "p", instance: "myinstance", workspace: "ws" } })

  makeProfileTokenStore("czcli", cacheKey).save(sampleToken)

  const reloaded = makeProfileTokenStore("czcli", cacheKey).load()
  expect(reloaded).toEqual(sampleToken)
})

// Requirement 11.6/11.7: patchProfileConnection merges the logged-in context
// into the profile entry without touching oauth or unrelated fields.
test("patchProfileConnection merges connection context into the profile", () => {
  saveProfiles({ czcli: { pat: "p", instance: "old-instance", region: "cn" } })
  // Seed an oauth slot to prove it stays untouched.
  makeProfileTokenStore("czcli", cacheKey).save(sampleToken)

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
  // oauth subtable untouched: the persisted token still loads.
  expect(makeProfileTokenStore("czcli", cacheKey).load()).toEqual(sampleToken)
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

// The full `/oauth2/userinfo` body (dev shape), used to prove lossless archival.
const SAMPLE_USERINFO: Record<string, unknown> = {
  userId: 110000011361,
  accountName: "wynptmks",
  gatewayMapping: '{"1-1":"https://dev-api.clickzetta.com","1-2":"https://dev-api.clickzetta.com"}',
  instanceList: [{ cspId: 1, regionId: 1, serviceId: 1, id: 159973, name: "89b94150" }],
  instanceName: "89b94150",
  workspaceName: "quick_start",
  schema: "public",
  virtualCluster: "DEFAULT_AP",
  aimeshEndpointBaseUrl: "https://dev-aimesh.clickzetta.com/",
  apiKey: "secret-api-key",
  sub: "110000011361",
  preferred_username: "weiliu",
  name: "weiliu",
  account_id: 112407,
}

// Requirement 11.9: patchProfileUserInfo archives the FULL userinfo verbatim
// under [profiles.<name>.userinfo] — lossless including the instanceList array
// of objects, the gatewayMapping JSON string, and the apiKey.
test("patchProfileUserInfo round-trips the full userinfo losslessly", () => {
  saveProfiles({ czcli: { pat: "p", instance: "myinstance" } })
  // Seed an oauth slot to prove it stays untouched.
  makeProfileTokenStore("czcli", cacheKey).save(sampleToken)

  patchProfileUserInfo("czcli", SAMPLE_USERINFO)

  const data = parseTOML(readFileSync(profilesPath(), "utf-8")) as Record<string, unknown>
  const profiles = data.profiles as Record<string, Record<string, unknown>>
  const stored = profiles.czcli.userinfo as Record<string, unknown>

  // Deep-equal proves nothing was discarded or mangled across write+reparse.
  expect(isDeepStrictEqual(stored, SAMPLE_USERINFO)).toBe(true)
  // Spot-check the trickier nested + sensitive shapes explicitly.
  expect(stored.instanceList).toEqual(SAMPLE_USERINFO.instanceList)
  expect(stored.gatewayMapping).toBe(SAMPLE_USERINFO.gatewayMapping)
  expect(stored.apiKey).toBe("secret-api-key")

  // 0o600 preserved.
  if (process.platform !== "win32") {
    expect(statSync(profilesPath()).mode & 0o777).toBe(0o600)
  }

  // oauth subtable untouched: the persisted token still loads.
  expect(makeProfileTokenStore("czcli", cacheKey).load()).toEqual(sampleToken)
})

test("patchProfileUserInfo preserves unrelated fields and no-ops on empty/unresolvable", () => {
  saveProfiles({ czcli: { pat: "p", instance: "myinstance", region: "cn" } })

  patchProfileUserInfo("czcli", SAMPLE_USERINFO)

  const text = readFileSync(profilesPath(), "utf-8")
  expect(text).toContain('region = "cn"')
  expect(text).toContain("[profiles.czcli.userinfo]")

  // Empty body is a safe no-op.
  expect(() => patchProfileUserInfo("czcli", {})).not.toThrow()
  // Unresolvable profile name is a safe no-op (does not throw).
  expect(() => patchProfileUserInfo("does-not-exist", SAMPLE_USERINFO)).not.toThrow()
})
