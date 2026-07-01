import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuthToken } from "@clickzetta/sdk"
import { resolveConnectionConfig } from "../src/connection/config.ts"
import { saveProfiles } from "../src/connection/profile-store.ts"

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

test("resolveConnectionConfig attaches a token store that round-trips under the instance-only cacheKey", () => {
  saveProfiles({ czcli: { pat: "the-pat", instance: "myinstance", service: "api.example.com" } })

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(cfg.tokenStore).toBeDefined()

  // The OAuth slot is keyed by INSTANCE ONLY (decoupled from pat/username).
  // Save via the resolved store, then load via a freshly-built store using the
  // instance key to prove they line up.
  cfg.tokenStore!.save(sampleToken)

  expect(cfg.instance).toBe("myinstance")

  const { makeProfileTokenStore } = require("../src/connection/profile-store.ts")
  const independent = makeProfileTokenStore("czcli", cfg.instance)
  expect(independent.load()).toEqual(sampleToken)
})

test("resolveConnectionConfig keys the store by instance even with username auth", () => {
  saveProfiles({
    czcli: { username: "alice", password: "secret", instance: "inst2", service: "api.example.com" },
  })

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(cfg.tokenStore).toBeDefined()

  cfg.tokenStore!.save(sampleToken)

  expect(cfg.instance).toBe("inst2")

  const { makeProfileTokenStore } = require("../src/connection/profile-store.ts")
  expect(makeProfileTokenStore("czcli", cfg.instance).load()).toEqual(sampleToken)
})

test("resolveConnectionConfig attaches a token store when only an instance is known (no pat/username)", () => {
  // A pure-OAuth profile carries no pat and no username/password, but the
  // OAuth slot must still be keyed/attached so a persisted login is reachable.
  saveProfiles({ czcli: { instance: "oauthonly", service: "api.example.com" } })

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(cfg.pat).toBeFalsy()
  expect(cfg.username).toBeFalsy()
  expect(cfg.instance).toBe("oauthonly")
  expect(cfg.tokenStore).toBeDefined()

  cfg.tokenStore!.save(sampleToken)
  const { makeProfileTokenStore } = require("../src/connection/profile-store.ts")
  expect(makeProfileTokenStore("czcli", "oauthonly").load()).toEqual(sampleToken)
})

test("resolveConnectionConfig leaves tokenStore undefined when no auth identity resolves", () => {
  const cfg = resolveConnectionConfig({})
  expect(cfg.tokenStore).toBeUndefined()
})

test("resolveConnectionConfig leaves tokenStore undefined when instance is missing", () => {
  saveProfiles({ czcli: { pat: "the-pat", service: "api.example.com" } })

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(cfg.instance).toBeFalsy()
  expect(cfg.tokenStore).toBeUndefined()
})
