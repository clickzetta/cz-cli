import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuthToken } from "@clickzetta/sdk"
import { hasUsableCredentials } from "../src/commands/exec.ts"
import { resolveConnectionConfig } from "../src/connection/config.ts"
import { makeProfileTokenStore, saveProfiles } from "../src/connection/profile-store.ts"

// getExecContext's auth precheck is extracted into the pure `hasUsableCredentials`
// so it can be unit-tested hermetically (no network). It must treat a valid
// persisted OAuth token as sufficient even when the profile carries no
// pat/username (requirement 11.8), while still rejecting profiles with neither.

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
  home = mkdtempSync(join(tmpdir(), "cz-exec-auth-"))
  process.env.CLICKZETTA_TEST_HOME = home
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

const oauthToken: AuthToken = {
  token: "access-oauth",
  refreshToken: "refresh-oauth",
  expireTimeMs: 3600_000,
  obtainedAt: Date.now(),
  instanceId: 42,
  userId: 7,
}

test("a pure-OAuth profile (no pat/username) with a persisted token is usable", () => {
  saveProfiles({ czcli: { instance: "oauthonly", service: "api.example.com" } })
  // Seed the OAuth slot under the instance-only key.
  makeProfileTokenStore("czcli", "oauthonly").save(oauthToken)

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(cfg.pat).toBeFalsy()
  expect(cfg.username).toBeFalsy()
  expect(hasUsableCredentials(cfg)).toBe(true)
})

test("a profile with neither creds nor a persisted OAuth token is not usable", () => {
  saveProfiles({ czcli: { instance: "oauthonly", service: "api.example.com" } })

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(hasUsableCredentials(cfg)).toBe(false)
})

test("a pat profile is usable regardless of any persisted token", () => {
  saveProfiles({ czcli: { pat: "the-pat", instance: "inst", service: "api.example.com" } })

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(hasUsableCredentials(cfg)).toBe(true)
})

test("a username/password profile is usable", () => {
  saveProfiles({ czcli: { username: "alice", password: "secret", instance: "inst", service: "api.example.com" } })

  const cfg = resolveConnectionConfig({ profile: "czcli" })
  expect(hasUsableCredentials(cfg)).toBe(true)
})
