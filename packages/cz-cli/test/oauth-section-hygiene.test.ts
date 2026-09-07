/**
 * Regression: `[oauth.<id>]` sections used to accumulate without bound.
 *
 * Two independent bugs fed each other. resolveConnectionConfig attached the
 * OAuth token store to ANY profile with an `instance` — including pure
 * username/password and pat profiles — and makeProfileTokenStore().save()
 * invented a random id when the profile had no `oauth` pointer. So a plain
 * password login's JWT was filed under `[oauth.cz<random>]`, once per profile
 * per re-login, and `profile delete` left those sections behind.
 *
 * The three fixes, one describe block each:
 *   - the store is gated on an OAuth IDENTITY, not on `instance`
 *   - save never mints an id; no explicit id and no pointer → no write
 *   - pruneOrphanOAuthSections sweeps sections no profile references
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuthToken } from "@clickzetta/sdk"
import {
  makeProfileTokenStore,
  pruneOrphanOAuthSections,
  saveProfiles,
} from "../src/connection/profile-store.ts"
import { resolveConnectionConfig } from "../src/connection/config.ts"

const previousTestHome = process.env.CLICKZETTA_TEST_HOME
let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cz-oauth-hygiene-"))
  process.env.CLICKZETTA_TEST_HOME = home
})

afterEach(() => {
  if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = previousTestHome
  rmSync(home, { recursive: true, force: true })
})

const profilesPath = () => join(home, ".clickzetta", "profiles.toml")
const readProfiles = () => readFileSync(profilesPath(), "utf-8")
/** The `[oauth.<id>]` section ids currently in the file. */
const oauthIds = () =>
  Array.from(readProfiles().matchAll(/^\[oauth\.([^\]]+)\]/gm)).map((m) => m[1]!)

/**
 * No instanceId. It is a property of the CONNECTION, not the credential — a shared
 * `[oauth.<id>]` cannot hold one id for profiles on different instances — so it is neither
 * written nor read here any more. See ConnectionConfig.instanceId.
 */
const TOKEN: AuthToken = {
  token: "access-abc",
  refreshToken: "refresh-xyz",
  expireTimeMs: 3_600_000,
  obtainedAt: 1_700_000_000_000,
  userId: 7,
}

describe("the token store is gated on an OAuth identity, not on `instance`", () => {
  test("a username/password profile gets NO store (its JWT must not be filed as OAuth)", () => {
    saveProfiles({ czcli: { instance: "clickzetta", service: "s", username: "czcli", password: "pw" } })

    expect(resolveConnectionConfig({ profile: "czcli" }).tokenStore).toBeUndefined()
  })

  test("a profile-pat profile gets NO store", () => {
    saveProfiles({ czcli: { instance: "clickzetta", service: "s", pat: "profile-pat" } })

    const cfg = resolveConnectionConfig({ profile: "czcli" })
    expect(cfg.pat).toBe("profile-pat")
    expect(cfg.tokenStore).toBeUndefined()
  })

  test("an `oauth = \"<id>\"` pointer DOES attach the store, and keys the cache by it", () => {
    saveProfiles({ czcli: { instance: "clickzetta", service: "s", oauth: "robert" } })

    const cfg = resolveConnectionConfig({ profile: "czcli" })
    expect(cfg.tokenStore).toBeDefined()
    expect(cfg.cacheKey).toBe("robert")
  })

  test("a pre-migration inline oauth subtable still attaches the store", () => {
    // Legacy shape: the token lived at [profiles.czcli.oauth.<key>]. It is a real
    // OAuth identity, so it must keep working until migrateInlineOAuthTokens runs.
    saveProfiles({
      czcli: { instance: "clickzetta", service: "s", oauth: { inst: { access_token: "t" } } },
    })

    expect(resolveConnectionConfig({ profile: "czcli" }).tokenStore).toBeDefined()
  })

  test("an OAuth profile with NO instance still gets the store", () => {
    // Accounts whose userinfo reports an empty instanceList: the identity is the
    // pointer, so a missing instance must not withhold the store.
    saveProfiles({ czcli: { service: "s", oauth: "robert" } })

    expect(resolveConnectionConfig({ profile: "czcli" }).tokenStore).toBeDefined()
  })
})

describe("save never mints an oauth id", () => {
  test("no explicit id and no pointer → nothing is written", () => {
    saveProfiles({ czcli: { instance: "clickzetta", username: "czcli", password: "pw" } })

    makeProfileTokenStore("czcli").save(TOKEN)

    expect(oauthIds()).toEqual([])
    // No stray pointer either — the profile is untouched.
    expect(readProfiles()).not.toContain("oauth =")
  })

  test("repeated saves on distinct profiles of one identity write nothing (was: one id each)", () => {
    saveProfiles({
      czcli: { instance: "i", username: "czcli", password: "pw" },
      p1: { instance: "i", username: "czcli", password: "pw" },
      p2: { instance: "i", username: "czcli", password: "pw" },
    })

    for (const p of ["czcli", "p1", "p2"]) makeProfileTokenStore(p).save(TOKEN)

    expect(oauthIds()).toEqual([])
  })

  test("an explicit id (the login path) still writes the section and the pointer", () => {
    saveProfiles({ robert_0: { instance: "i", service: "s" } })

    makeProfileTokenStore("robert_0", "robert").save(TOKEN)

    expect(oauthIds()).toEqual(["robert"])
    expect(makeProfileTokenStore("robert_0").load()).toEqual(TOKEN)
  })

  test("an existing pointer is reused on re-save — a refresh never adds a section", () => {
    saveProfiles({ robert_0: { instance: "i", oauth: "robert" } })

    const refreshed: AuthToken = { ...TOKEN, token: "rotated", obtainedAt: 1_700_000_009_999 }
    makeProfileTokenStore("robert_0").save(refreshed)

    expect(oauthIds()).toEqual(["robert"])
    expect(makeProfileTokenStore("robert_0").load()?.token).toBe("rotated")
  })
})

describe("pruneOrphanOAuthSections", () => {
  test("removes sections no profile points at, keeps referenced ones", () => {
    saveProfiles({ robert_0: { instance: "i", oauth: "robert" } })
    makeProfileTokenStore("robert_0", "robert").save(TOKEN)
    // Accumulated junk from the old bug.
    makeProfileTokenStore("robert_0", "cz58464a6324c5").save(TOKEN)
    makeProfileTokenStore("robert_0", "cz3dee309c257b").save(TOKEN)
    // save repoints the profile at the id it just wrote, so restore the real one.
    saveProfiles({ robert_0: { instance: "i", oauth: "robert" } })
    expect(oauthIds().sort()).toEqual(["cz3dee309c257b", "cz58464a6324c5", "robert"])

    pruneOrphanOAuthSections()

    expect(oauthIds()).toEqual(["robert"])
    // The live login still loads — pruning must never sign anyone out.
    expect(makeProfileTokenStore("robert_0").load()).toEqual(TOKEN)
  })

  test("keeps a section shared by several profiles", () => {
    saveProfiles({
      robert_0: { instance: "a", oauth: "robert" },
      robert_1: { instance: "b", oauth: "robert" },
    })
    makeProfileTokenStore("robert_0", "robert").save(TOKEN)

    pruneOrphanOAuthSections()

    expect(oauthIds()).toEqual(["robert"])
  })

  test("sweeps the section a deleted profile left behind", () => {
    saveProfiles({ robert_0: { instance: "i", oauth: "robert" } })
    makeProfileTokenStore("robert_0", "robert").save(TOKEN)
    // `profile delete` drops the row but not the section.
    saveProfiles({})

    pruneOrphanOAuthSections()

    expect(readProfiles()).not.toContain("[oauth")
  })

  test("preserves unrelated top-level keys and the file mode", () => {
    saveProfiles({ robert_0: { instance: "i", oauth: "robert" } })
    makeProfileTokenStore("robert_0", "orphan").save(TOKEN)
    saveProfiles({ robert_0: { instance: "i", oauth: "robert" } })
    makeProfileTokenStore("robert_0", "robert").save(TOKEN)

    pruneOrphanOAuthSections()

    const text = readProfiles()
    expect(text).toContain('oauth = "robert"')
    expect(text).toContain('instance = "i"')
    expect(oauthIds()).toEqual(["robert"])
  })

  test("is idempotent and a no-op on a clean or missing file", () => {
    pruneOrphanOAuthSections() // no file at all
    saveProfiles({ robert_0: { instance: "i", oauth: "robert" } })
    makeProfileTokenStore("robert_0", "robert").save(TOKEN)

    const before = readProfiles()
    pruneOrphanOAuthSections()
    pruneOrphanOAuthSections()

    expect(readProfiles()).toBe(before)
  })
})

/**
 * The instance id moving off the credential has to be safe in BOTH directions on one
 * disk: a section written by an older version still carries `instance_id`, and a reader
 * that demanded it — as this one used to — would have judged every newly written section
 * invalid and silently signed the user out.
 */
describe("[oauth.*] and the instance id", () => {
  test("a section written now carries no instance_id, even from a token that has one", () => {
    saveProfiles({ robert_0: { instance: "i", service: "s" } })
    // A standalone SDK login still puts an id on the token (the login response is its only
    // source), so the token being SAVED is the one shape that can regress this. Asserting
    // with a token that has no instanceId proves nothing: the write would serialize
    // `undefined` and TOML would drop the key either way.
    makeProfileTokenStore("robert_0", "robert").save({ ...TOKEN, instanceId: 271502 })
    expect(readProfiles()).not.toContain("instance_id")
    expect(readProfiles()).not.toContain("271502")
    // Everything else still round-trips — and the id does not come back.
    expect(makeProfileTokenStore("robert_0").load()).toEqual(TOKEN)
  })

  test("a section written by an older version still loads, its instance_id ignored", () => {
    saveProfiles({ robert_0: { instance: "i", service: "s", oauth: "robert" } })
    // Exactly what the buggy version wrote: the shared section carrying one instance id.
    writeFileSync(
      profilesPath(),
      [
        readProfiles().trimEnd(),
        "",
        "[oauth.robert]",
        `access_token = "${TOKEN.token}"`,
        `refresh_token = "${TOKEN.refreshToken}"`,
        `expire_time_ms = ${TOKEN.expireTimeMs}`,
        `obtained_at = ${TOKEN.obtainedAt}`,
        "instance_id = 271502",
        `user_id = ${TOKEN.userId}`,
        "",
      ].join("\n"),
      "utf-8",
    )
    const loaded = makeProfileTokenStore("robert_0").load()
    expect(loaded).toEqual(TOKEN)
    expect(loaded && "instanceId" in loaded).toBe(false)
  })
})
