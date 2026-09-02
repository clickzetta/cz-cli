/**
 * getExecContext resolves the instance id from the CONNECTION, and does it for the profile
 * the connection actually came from.
 * Run: bun test test/exec-instance-id.test.ts
 *
 * Both cases here are review findings on the commit that moved the id off the shared OAuth
 * token, and both were reachable:
 *
 *  - `Profile.current()` is `CZ_PROFILE ?? default_profile`, but `readProfileEntry(undefined)`
 *    and `patchProfileInstanceId(undefined, …)` only consult `default_profile`. Passing
 *    `undefined` therefore read one profile's account_id and cached the answer onto ANOTHER
 *    profile whenever the two disagreed.
 *  - the `token.instanceId` fallback is unreachable for an OAuth profile, because the same
 *    commit stopped storing an id in `[oauth.<id>]`. An unresolvable id would have become 0
 *    — a job submitted against instance zero — instead of a stated failure.
 *
 * Network boundary only: stubStudioContext answers the login/getCurrentUser calls
 * getExecContext makes on the way, and each case overrides serviceInstanceList.
 */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { onFetch, onStudio, requireTestHome, studioOk, stubStudioContext } from "./support/cz-fixtures"

const { getExecContext, execInstanceId } = await import("../src/commands/exec.ts")

const previousProfile = process.env.CZ_PROFILE

const profilesPath = () => join(requireTestHome(), ".clickzetta", "profiles.toml")

/** Two profiles with different accounts and instances; default_profile is NOT the CZ_PROFILE one. */
function writeTwoProfiles() {
  writeFileSync(
    profilesPath(),
    [
      'default_profile = "other"',
      "",
      "[profiles.other]",
      'pat = "pat-other"',
      'service = "uat-api.clickzetta.com"',
      'instance = "other-inst"',
      'workspace = "w"',
      "account_id = 999",
      "",
      "[profiles.wanted]",
      'pat = "pat-wanted"',
      'service = "uat-api.clickzetta.com"',
      'instance = "wanted-inst"',
      'workspace = "w"',
      "account_id = 124213",
      "",
    ].join("\n"),
    "utf-8",
  )
}

function writeOneProfile(extra: string[]) {
  writeFileSync(
    profilesPath(),
    ['default_profile = "solo"', "", "[profiles.solo]", 'pat = "p"',
     'service = "uat-api.clickzetta.com"', 'instance = "i"', 'workspace = "w"', ...extra, ""].join("\n"),
    "utf-8",
  )
}

beforeEach(() => {
  delete process.env.CZ_PROFILE
  delete process.env.CZ_INSTANCE
})

/**
 * The fetch boundary answers with the FIRST matching handler, and stubStudioContext
 * registers its own serviceInstanceList — so a case that needs a different instance list
 * must register before it, not after.
 */
function stubInstances(rows: Array<Record<string, unknown>>) {
  onStudio("/clickzetta-portal/service/serviceInstanceList", () => studioOk(rows))
  stubStudioContext()
}

/** A profile whose credential carries NO instance id — which every OAuth login now is. */
function writeOAuthProfile(extra: string[]) {
  writeFileSync(
    profilesPath(),
    [
      'default_profile = "sess_0"', "",
      "[oauth.sess]",
      'access_token = "at"',
      'refresh_token = "rt"',
      "expire_time_ms = 3600000",
      `obtained_at = ${Date.now()}`,
      "user_id = 7",
      "",
      "[profiles.sess_0]",
      'service = "uat-api.clickzetta.com"',
      'instance = "wanted-inst"',
      'workspace = "w"',
      'oauth = "sess"',
      'auth_type = "oauth"',
      ...extra,
      "",
    ].join("\n"),
    "utf-8",
  )
}

afterEach(() => {
  if (previousProfile === undefined) delete process.env.CZ_PROFILE
  else process.env.CZ_PROFILE = previousProfile
})

test("resolves and caches against the profile the connection came from, not default_profile", async () => {
  writeTwoProfiles()
  process.env.CZ_PROFILE = "wanted"
  const seen: string[] = []
  onFetch({ match: (url) => { seen.push(url); return false }, respond: () => ({}) })
  // Only the wanted profile's account owns the instance the connection names.
  stubInstances([{ id: 160813, name: "wanted-inst", serviceId: 1 }])

  const ctx = await getExecContext({})
  expect(execInstanceId(ctx)).toBe(160813)
  // Looked up with the CZ_PROFILE profile's account, not default_profile's 999.
  expect(seen.some((url) => url.includes("accountId=124213"))).toBe(true)
  expect(seen.some((url) => url.includes("accountId=999"))).toBe(false)
  // Cached onto the profile it belongs to, and NOT onto default_profile.
  const toml = readFileSync(profilesPath(), "utf-8")
  const wanted = toml.slice(toml.indexOf("[profiles.wanted]"))
  const other = toml.slice(toml.indexOf("[profiles.other]"), toml.indexOf("[profiles.wanted]"))
  expect(wanted).toContain("instance_id = 160813")
  expect(other).not.toContain("instance_id")
})

test("an unresolvable instance id is an error, never a silent zero", async () => {
  // An OAuth profile on purpose: a PAT/password credential still carries an id from its
  // login response, so the fallback would absorb the failure. OAuth is the case with
  // nothing to fall back to — the id is no longer stored in [oauth.<id>].
  writeOAuthProfile(["account_id = 124213"])
  // The account has instances, none of them the one this profile names.
  stubInstances([{ id: 271502, name: "someone-elses-inst", serviceId: 1 }])

  // The profile's OWN name, so not the explicit-override throw: it falls to the catch-all,
  // which still refuses rather than inventing an id, and says which of the causes it was.
  await expect(getExecContext({})).rejects.toThrow(/does not list it for this account/)
})

test("a profile with no account_id says so rather than looking nothing up", async () => {
  writeOAuthProfile([])
  stubInstances([{ id: 271502, name: "whatever", serviceId: 1 }])
  await expect(getExecContext({})).rejects.toThrow(/no account_id/)
})

test("an instance_id already on the profile is used as-is, with no lookup", async () => {
  writeOneProfile(["account_id = 124213", "instance_id = 160813"])
  const seen: string[] = []
  onFetch({ match: (url) => { seen.push(url); return false }, respond: () => ({}) })
  stubStudioContext()
  const ctx = await getExecContext({})
  expect(execInstanceId(ctx)).toBe(160813)
  expect(seen.some((url) => url.includes("/serviceInstanceList"))).toBe(false)
})

/**
 * A cached id is only valid for the instance it was resolved for. Both of these were
 * review findings: the `--instance` guard compared the value to itself and so never fired,
 * and clearing on ANY supplied name (rather than a different one) made an exported
 * CZ_INSTANCE pay a portal round trip on every command forever.
 */
test("--instance naming a different instance discards the profile's cached id", async () => {
  writeOneProfile(["account_id = 124213", "instance_id = 160813"])
  const seen: string[] = []
  onFetch({ match: (url) => { seen.push(url); return false }, respond: () => ({}) })
  stubInstances([{ id: 271502, name: "other-inst", serviceId: 1 }])

  const ctx = await getExecContext({ instance: "other-inst" })
  expect(execInstanceId(ctx)).toBe(271502)
  expect(seen.some((url) => url.includes("/serviceInstanceList"))).toBe(true)
})

test("CZ_INSTANCE naming the profile's own instance keeps the cached id and asks nothing", async () => {
  writeOneProfile(["account_id = 124213", "instance_id = 160813"])
  process.env.CZ_INSTANCE = "i"
  const seen: string[] = []
  onFetch({ match: (url) => { seen.push(url); return false }, respond: () => ({}) })
  stubStudioContext()
  try {
    const ctx = await getExecContext({})
    expect(execInstanceId(ctx)).toBe(160813)
    expect(seen.some((url) => url.includes("/serviceInstanceList"))).toBe(false)
  } finally {
    delete process.env.CZ_INSTANCE
  }
})

/**
 * The id resolved for an OVERRIDDEN instance name must not be cached onto the profile.
 * patchProfileInstanceId only writes when the field is absent, so one `--instance` run
 * against a not-yet-backfilled profile would pin it to another instance's id permanently,
 * with nothing to correct it. The `--instance` case above cannot catch this: its fixture
 * already carries an instance_id, so there is nothing for the write to fill in.
 */
test("--instance resolves for this run but never caches onto the profile", async () => {
  writeOneProfile(["account_id = 124213"])
  stubInstances([{ id: 271502, name: "other-inst", serviceId: 1 }])

  const ctx = await getExecContext({ instance: "other-inst" })
  expect(execInstanceId(ctx)).toBe(271502)
  // The profile still names "i" and must not have acquired the override's id.
  const toml = readFileSync(profilesPath(), "utf-8")
  expect(toml).not.toContain("instance_id")
  expect(toml).not.toContain("271502")
})

test("resolving the profile's own name does cache it", async () => {
  writeOneProfile(["account_id = 124213"])
  stubInstances([{ id: 160813, name: "i", serviceId: 1 }])

  const ctx = await getExecContext({})
  expect(execInstanceId(ctx)).toBe(160813)
  expect(readFileSync(profilesPath(), "utf-8")).toContain("instance_id = 160813")
})

/**
 * A definitive "this account has no instance by that name" is fatal even when the credential
 * carries an id of its own. The first version of the warning fired only on a lookup ERROR, so
 * this — the case where the credential's id is almost certainly for a different instance —
 * was the one that passed silently, while the sibling OAuth branch treated the same answer as
 * fatal. Severity must not depend on whether a credential happens to carry an id.
 */
test("a name the account does not list is fatal even for a PAT credential", async () => {
  writeOneProfile(["account_id = 124213"])
  stubInstances([{ id: 160813, name: "i", serviceId: 1 }])

  await expect(getExecContext({ instance: "not-mine" })).rejects.toThrow(
    /Instance 'not-mine' is not listed for this account/,
  )
})

/** A JWT whose payload carries the ids cookie auth reads out of it. No signature check. */
function cookieJwt(payload: Record<string, unknown>) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload })}.x`
}

/**
 * Cookie auth's id comes from the cookie's own JWT and is authoritative — the cookie is
 * scoped to an instance. A lookup that does not list the profile's instance name must not
 * discard it: that name can miss for reasons other than ownership (a rename, or an instance
 * that is not serviceId 1), and failing there would break a setup that works.
 */
test("a cookie credential's definitive id survives a lookup that lists nothing matching", async () => {
  writeFileSync(
    profilesPath(),
    [
      'default_profile = "ck"', "", "[profiles.ck]",
      'service = "uat-api.clickzetta.com"',
      'instance = "renamed-inst"',
      'workspace = "w"',
      "account_id = 124213",
      `"header.Cookie" = "X-ClickZetta-Token=${cookieJwt({ userId: 7, accountId: 124213, instanceId: 445566 })}"`,
      "",
    ].join("\n"),
    "utf-8",
  )
  stubInstances([{ id: 160813, name: "something-else", serviceId: 1 }])

  const ctx = await getExecContext({})
  expect(execInstanceId(ctx)).toBe(445566)
})

/**
 * The legacy read: an OAuth profile with no cached id and no usable lookup falls back to the
 * id an older version wrote into the SHARED `[oauth.<id>]` section. Wrong shape, but it is
 * the number that used to answer offline, so a portal outage does not block the command.
 */
test("an OAuth profile falls back to the legacy shared-section id rather than failing", async () => {
  writeFileSync(
    profilesPath(),
    [
      'default_profile = "sess_0"', "",
      "[oauth.sess]",
      'access_token = "at"', 'refresh_token = "rt"',
      "expire_time_ms = 3600000", `obtained_at = ${Date.now()}`,
      "instance_id = 271502", "user_id = 7", "",
      "[profiles.sess_0]",
      'service = "uat-api.clickzetta.com"', 'instance = "wanted-inst"', 'workspace = "w"',
      'oauth = "sess"', 'auth_type = "oauth"', "account_id = 124213", "",
    ].join("\n"),
    "utf-8",
  )
  // Lookup fails outright, so neither a resolved id nor a not-listed answer.
  onStudio("/clickzetta-portal/service/serviceInstanceList", () => {
    throw new Error("portal unreachable")
  })
  stubStudioContext()

  const ctx = await getExecContext({})
  expect(execInstanceId(ctx)).toBe(271502)
})

/** A PAT credential keeps working through a portal outage, and says that it could not verify. */
test("a failed lookup warns and proceeds on the credential's id", async () => {
  writeOneProfile(["account_id = 124213"])
  onStudio("/clickzetta-portal/service/serviceInstanceList", () => {
    throw new Error("portal unreachable")
  })
  stubStudioContext()

  const ctx = await getExecContext({})
  // stubStudioContext's login response carries the id.
  expect(execInstanceId(ctx)).toBeGreaterThan(0)
})
