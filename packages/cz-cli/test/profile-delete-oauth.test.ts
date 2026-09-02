/**
 * `profile delete` must take the profile's `[oauth.<id>]` token with it — but only
 * when nothing else points at that section.
 *
 * Both halves matter. Leaving an unreferenced section behind keeps a live
 * access/refresh token readable on disk after the user believes it is gone (it
 * would only be swept on the NEXT run, by pruneOrphanOAuthSections). Removing a
 * SHARED section is worse: one login backs several profiles (robert_0..robert_3
 * → [oauth.robert]), so deleting one profile would sign the siblings out.
 */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuthToken } from "@clickzetta/sdk"
import { makeProfileTokenStore, saveProfiles } from "../src/connection/profile-store.ts"
import { execute } from "../src/execute.ts"

const previousHome = process.env.HOME
const previousTestHome = process.env.CLICKZETTA_TEST_HOME
let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cz-profile-delete-oauth-"))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = previousTestHome
  rmSync(home, { recursive: true, force: true })
})

const read = () => readFileSync(join(home, ".clickzetta", "profiles.toml"), "utf-8")
const oauthIds = () => Array.from(read().matchAll(/^\[oauth\.([^\]]+)\]/gm)).map((m) => m[1]!)
/** `success()` wraps the payload in a `data` envelope. */
const firstJson = (output: string) =>
  (JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, any>).data ?? {}

const TOKEN: AuthToken = {
  token: "access-abc",
  refreshToken: "refresh-xyz",
  expireTimeMs: 3_600_000,
  obtainedAt: 1_700_000_000_000,
  // No instanceId: it belongs to the profile, not the shared token (ConnectionConfig.instanceId).
  userId: 7,
}

test("deleting the last profile of a session removes its token immediately", async () => {
  saveProfiles({ solo_0: { instance: "i", service: "s", oauth: "solo" } })
  makeProfileTokenStore("solo_0", "solo").save(TOKEN)
  expect(oauthIds()).toEqual(["solo"])

  const result = await execute("profile delete solo_0")

  expect(result.exitCode).toBe(0)
  // Gone from disk NOW, not on the next run.
  expect(oauthIds()).toEqual([])
  expect(read()).not.toContain("access-abc")
  expect(read()).not.toContain("refresh-xyz")
  // And the outcome is reported, so "did this sign me out?" is answerable.
  const json = firstJson(result.output)
  expect(json.token_removed).toBe(true)
  expect(json.session).toBe("solo")
})

test("deleting one profile of a SHARED session keeps the token and its siblings", async () => {
  saveProfiles({
    robert_0: { instance: "a", service: "s", oauth: "robert" },
    robert_1: { instance: "b", service: "s", oauth: "robert" },
    robert_2: { instance: "c", service: "s", oauth: "robert" },
  })
  makeProfileTokenStore("robert_0", "robert").save(TOKEN)

  const result = await execute("profile delete robert_0")

  expect(result.exitCode).toBe(0)
  expect(oauthIds()).toEqual(["robert"])
  const json = firstJson(result.output)
  expect(json.token_removed).toBe(false)
  expect(json.session_shared).toBe(true)
  // The surviving siblings still resolve the login.
  expect(makeProfileTokenStore("robert_1").load()).toEqual(TOKEN)
  expect(makeProfileTokenStore("robert_2").load()).toEqual(TOKEN)
})

test("deleting the LAST sibling finally removes the shared token", async () => {
  saveProfiles({
    robert_0: { instance: "a", service: "s", oauth: "robert" },
    robert_1: { instance: "b", service: "s", oauth: "robert" },
  })
  makeProfileTokenStore("robert_0", "robert").save(TOKEN)

  await execute("profile delete robert_0")
  expect(oauthIds()).toEqual(["robert"])

  const result = await execute("profile delete robert_1")

  expect(result.exitCode).toBe(0)
  expect(firstJson(result.output).token_removed).toBe(true)
  expect(read()).not.toContain("[oauth")
})

test("a profile with no oauth pointer deletes cleanly and touches no section", async () => {
  saveProfiles({
    czcli: { instance: "i", service: "s", username: "u", password: "pw" },
    robert_0: { instance: "a", service: "s", oauth: "robert" },
  })
  makeProfileTokenStore("robert_0", "robert").save(TOKEN)

  const result = await execute("profile delete czcli")

  expect(result.exitCode).toBe(0)
  expect(firstJson(result.output).token_removed).toBe(false)
  // An unrelated session is untouched.
  expect(oauthIds()).toEqual(["robert"])
  expect(makeProfileTokenStore("robert_0").load()).toEqual(TOKEN)
})

test("a dangling pointer (no such section) deletes without error", async () => {
  // Hand-edited profiles.toml can point at a section that isn't there.
  saveProfiles({ ghost: { instance: "i", service: "s", oauth: "missing" } })

  const result = await execute("profile delete ghost")

  expect(result.exitCode).toBe(0)
  expect(firstJson(result.output).token_removed).toBe(false)
  expect(read()).not.toContain("[profiles.ghost]")
})

test("deleting the default profile still repoints default_profile", async () => {
  saveProfiles({
    solo_0: { instance: "i", service: "s", oauth: "solo" },
    other: { instance: "j", service: "s", username: "u", password: "pw" },
  })
  makeProfileTokenStore("solo_0", "solo").save(TOKEN)
  await execute("profile use solo_0")

  const result = await execute("profile delete solo_0")

  expect(result.exitCode).toBe(0)
  expect(firstJson(result.output).token_removed).toBe(true)
  // Pre-existing behaviour preserved: default moves to a remaining profile.
  expect(read()).toContain('default_profile = "other"')
  expect(oauthIds()).toEqual([])
})
