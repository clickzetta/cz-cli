/**
 * The profile's `user_id` — telemetry's `enduser.id` — gets filled in on the agent path.
 * Run: bun test test/telemetry-identity.test.ts
 *
 * A login normally writes it, but one that could not learn it keeps the token anyway
 * (login-browser leaves userId at 0), and nothing on the agent path reads the user
 * afterwards: `identity()` is lazy, so it never resolved and whole sessions were exported
 * attributed to no one. Two fills, one per path — the TUI's profile panel, from the portal
 * response it already makes, and `ensureIdentityResolved` for a headless run where that
 * panel never paints.
 */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { requireTestHome, stubStudioContext } from "./support/cz-fixtures"

const { profileTelemetryAttributes } = await import("../src/connection/telemetry.ts")
const { clearConnectionContextForTest, ensureIdentityResolved } = await import("../src/connection/context.ts")
const { fetchProfileUserName } = await import("../src/opencode-plugin/tui-quota-data.ts")

const previousProfile = process.env.CZ_PROFILE
const profilesPath = () => join(requireTestHome(), ".clickzetta", "profiles.toml")

/**
 * An OAuth profile that does not know its user: no `user_id` on the row, none on the token,
 * and no `account_id` — so nothing short-circuits and the portal has to answer. No
 * `username` either, which is what sends the profile panel to the portal for a display name.
 */
function writeProfileWithoutUserId() {
  writeFileSync(
    profilesPath(),
    [
      'default_profile = "sess_0"', "",
      "[oauth.sess]",
      'access_token = "at"', 'refresh_token = "rt"',
      "expire_time_ms = 3600000", `obtained_at = ${Date.now()}`, "",
      "[profiles.sess_0]",
      'service = "uat-api.clickzetta.com"', 'instance = "inst"', 'workspace = "wanxin_test_04"',
      'oauth = "sess"', 'auth_type = "oauth"', "",
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

test("the profile panel's name lookup records the id that came with it", async () => {
  writeProfileWithoutUserId()
  const ctx = stubStudioContext()

  expect(profileTelemetryAttributes()["enduser.id"]).toBeUndefined()
  await expect(fetchProfileUserName()).resolves.toEqual({ profile: "sess_0", name: ctx.userName })

  expect(readFileSync(profilesPath(), "utf-8")).toContain(`user_id = ${ctx.userId}`)
  expect(profileTelemetryAttributes()["enduser.id"]).toBe(String(ctx.userId))
})

test("a headless run resolves it without that panel", async () => {
  writeProfileWithoutUserId()
  const ctx = stubStudioContext()

  await ensureIdentityResolved()

  expect(profileTelemetryAttributes()["enduser.id"]).toBe(String(ctx.userId))
})

test("resolving is memoised and never rejects, even with nothing to resolve against", async () => {
  writeFileSync(profilesPath(), 'default_profile = "gone"\n', "utf-8")

  await ensureIdentityResolved()
  await ensureIdentityResolved()

  expect(profileTelemetryAttributes()).toEqual({})
})
