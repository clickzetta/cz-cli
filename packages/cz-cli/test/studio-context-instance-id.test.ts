/**
 * getStudioContext and getGatewayContext resolve the instance id through the SAME chain as
 * getExecContext, and refuse rather than fall back.
 * Run: bun test test/studio-context-instance-id.test.ts
 *
 * These two entry points had no tests at all, which is how they came to differ from the exec
 * path: each passed `fallbackId` to the lookup and took whatever came back. For an OAuth
 * profile that value is 0 — `[oauth.<id>]` no longer stores an id — so a portal blip sent
 * every studio and AIGW admin call against instance 0, silently. See connection/context.ts.
 */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onFetch, onStudio, requireTestHome, studioOk, stubStudioContext } from "./support/cz-fixtures"

const { getStudioContext, getGatewayContext } = await import("../src/commands/studio-context.ts")
const { getExecContext } = await import("../src/commands/exec.ts")
const { clearConnectionContextForTest } = await import("../src/connection/context.ts")

const previousProfile = process.env.CZ_PROFILE
const profilesPath = () => join(requireTestHome(), ".clickzetta", "profiles.toml")

/** An OAuth profile: the credential carries no instance id, so nothing absorbs a failure. */
function writeOAuthProfile(extra: string[] = []) {
  writeFileSync(
    profilesPath(),
    [
      'default_profile = "sess_0"', "",
      "[oauth.sess]",
      'access_token = "at"', 'refresh_token = "rt"',
      "expire_time_ms = 3600000", `obtained_at = ${Date.now()}`,
      "user_id = 13", "",
      "[profiles.sess_0]",
      'service = "uat-api.clickzetta.com"', 'instance = "inst"', 'workspace = "wanxin_test_04"',
      'oauth = "sess"', 'auth_type = "oauth"', "account_id = 10",
      ...extra, "",
    ].join("\n"),
    "utf-8",
  )
}

beforeEach(() => {
  delete process.env.CZ_PROFILE
  delete process.env.CZ_INSTANCE
  clearConnectionContextForTest()
})

afterEach(() => {
  if (previousProfile === undefined) delete process.env.CZ_PROFILE
  else process.env.CZ_PROFILE = previousProfile
})

test("getStudioContext resolves the id instead of defaulting to zero", async () => {
  writeOAuthProfile()
  const ctx = stubStudioContext()
  const studio = await getStudioContext({})
  expect(studio.instanceId).toBe(ctx.instanceId)
  expect(studio.tenantId).toBe(ctx.tenantId)
  expect(studio.userId).toBe(ctx.userId)
})

test("getGatewayContext resolves it too", async () => {
  writeOAuthProfile()
  const ctx = stubStudioContext()
  const gateway = await getGatewayContext({})
  expect(gateway.instanceId).toBe(ctx.instanceId)
  expect(gateway.tenantId).toBe(ctx.tenantId)
})

/**
 * The regression this file exists for: before the chain, a lookup that could not answer left
 * `fallbackId` — 0 for an OAuth profile — and every studio call proceeded against instance 0.
 */
test("a failed lookup is an error on the studio path, not instance 0", async () => {
  writeOAuthProfile()
  onStudio("/clickzetta-portal/service/serviceInstanceList", () => {
    throw new Error("portal unreachable")
  })
  stubStudioContext()
  await expect(getStudioContext({})).rejects.toThrow(/Could not determine the instance id/)
})

test("and on the gateway path", async () => {
  writeOAuthProfile()
  onStudio("/clickzetta-portal/service/serviceInstanceList", () => {
    throw new Error("portal unreachable")
  })
  stubStudioContext()
  await expect(getGatewayContext({})).rejects.toThrow(/Could not determine the instance id/)
})

test("an account that does not list the profile's instance is an error, not zero", async () => {
  writeOAuthProfile()
  onStudio("/clickzetta-portal/service/serviceInstanceList", () =>
    studioOk([{ id: 271502, name: "someone-elses-inst", serviceId: 1 }]),
  )
  stubStudioContext()
  await expect(getGatewayContext({})).rejects.toThrow(/does not list it for this account/)
})

/**
 * The cached ids avoid the call; they never override a live answer. Pinned because the two
 * halves used to disagree: getExecContext resolved the instance with profiles.toml's
 * `account_id` while getStudioContext took its tenant from getCurrentUser, so one command
 * could answer for two different tenants depending on which entry point it came through.
 */
test("cached ids skip getCurrentUser; a missing one makes the portal authoritative", async () => {
  writeOAuthProfile()
  const calls: string[] = []
  onFetch({
    match: (url) => {
      if (url.includes("getCurrentUser")) calls.push(url)
      return false
    },
    respond: () => ({}),
  })
  stubStudioContext()
  // Asserted through getExecContext: the studio and gateway entry points fetch the display
  // NAME regardless, so only this one shows that the chain itself asked nothing.
  const warm = await getExecContext({})
  expect(warm.instanceId()).toBe(86)
  expect(calls.length).toBe(0)

  // Same profile with no cached account_id: the portal answers, and its value is used.
  clearConnectionContextForTest()
  writeFileSync(
    profilesPath(),
    [
      'default_profile = "pat_0"', "",
      "[profiles.pat_0]",
      'pat = "p"', 'service = "uat-api.clickzetta.com"', 'instance = "inst"',
      'workspace = "wanxin_test_04"', "",
    ].join("\n"),
    "utf-8",
  )
  const cold = await getGatewayContext({})
  expect(cold.tenantId).toBe(10)
  expect(cold.userId).toBe(13)
})

/**
 * One chain, not three copies: the three entry points agree on the id, and the second and
 * third get it from the memo rather than asking the portal again.
 */
test("the three entry points share one lookup", async () => {
  writeOAuthProfile()
  const lookups: string[] = []
  onFetch({
    match: (url) => {
      if (url.includes("/serviceInstanceList")) lookups.push(url)
      return false
    },
    respond: () => ({}),
  })
  const ctx = stubStudioContext()

  const exec = await getExecContext({})
  const studio = await getStudioContext({})
  const gateway = await getGatewayContext({})

  expect(exec.instanceId()).toBe(ctx.instanceId)
  expect(studio.instanceId).toBe(ctx.instanceId)
  expect(gateway.instanceId).toBe(ctx.instanceId)
  expect(lookups.length).toBe(1)
})
