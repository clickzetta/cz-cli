import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseToml } from "smol-toml"
import type { AuthToken } from "@clickzetta/sdk"
import {
  configureClickzettaLlm,
  decodeCredential,
  provisionProfileFromCredential,
  provisionProfileFromOAuth,
  provisionProfilesFromOAuthCombos,
  ProvisionError,
} from "../src/connection/provision"
import {
  loadProfiles,
  makeProfileTokenStore,
  getDefaultProfileName,
  oauthSectionExists,
  oauthSessionProvisioned,
  saveProfiles,
  setDefaultProfile,
} from "../src/connection/profile-store"
import { readLlmEntries, setActiveModel, writeLlmEntries } from "../src/llm/native-config"

const previousTestHome = process.env.CLICKZETTA_TEST_HOME
let home: string

function profilesPath() {
  return join(home, ".clickzetta", "profiles.toml")
}

function readProfilesToml(): Record<string, unknown> {
  return parseToml(readFileSync(profilesPath(), "utf-8")) as Record<string, unknown>
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cz-provision-"))
  process.env.CLICKZETTA_TEST_HOME = home
})

afterEach(() => {
  if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = previousTestHome
  rmSync(home, { recursive: true, force: true })
})

describe("decodeCredential", () => {
  test("decodes base64(JSON) into an object", () => {
    const encoded = Buffer.from(JSON.stringify({ instanceName: "i", accessToken: "t" }), "utf-8").toString("base64")
    expect(decodeCredential(encoded)).toEqual({ instanceName: "i", accessToken: "t" })
  })

  test("throws on invalid JSON", () => {
    const encoded = Buffer.from("not json", "utf-8").toString("base64")
    expect(() => decodeCredential(encoded)).toThrow()
  })
})

describe("configureClickzettaLlm", () => {
  test("writes provider fields and returns true when apiKey present", () => {
    const configured = configureClickzettaLlm("p1", { apiKey: "ck_key", baseURL: "https://gw.example.com/" })
    expect(configured).toBe(true)
    const llm = readLlmEntries()
    expect(llm.llm.p1).toEqual({ provider: "clickzetta", api_key: "ck_key", base_url: "https://gw.example.com/" })
    // cz_change: no default_llm. config.model is left unset — opencode auto-selects
    // (this is the only provider, so it's chosen). The entry just needs to exist.
    expect(llm.model).toBeUndefined()
  })

  test("no-ops and returns false when apiKey absent", () => {
    expect(configureClickzettaLlm("p1", { baseURL: "https://gw.example.com/" })).toBe(false)
    expect(readLlmEntries().llm).toEqual({})
  })

  test("preserves the legacy gateway URL and pinned model when renaming an entry", () => {
    configureClickzettaLlm("login_0", { apiKey: "old-key", baseURL: "https://legacy-gateway.example/v1" })
    setActiveModel("login_0/deepseek/deepseek-v4-pro")

    configureClickzettaLlm("login", { apiKey: "new-key", legacyName: "login_0" })

    expect(readLlmEntries()).toEqual({
      llm: {
        login: {
          provider: "clickzetta",
          api_key: "new-key",
          base_url: "https://legacy-gateway.example/v1",
        },
      },
      model: "login/deepseek/deepseek-v4-pro",
    })
  })
})

describe("provisionProfileFromCredential", () => {
  const CRED = {
    instanceName: "jnsxwfyr",
    workspaceName: "wanxin_test_04",
    service: "https://uat-api.clickzetta.com",
    username: "UAT_TEST",
    schema: "clickzetta_account",
    virtualCluster: "CXH_TEST_1",
    accessToken: "czt_test_pat",
    analysisAgentEndpoint: "https://analysis-agent.clickzetta.com",
    apiKey: "ck_test_api_key",
    aimeshEndpointBaseUrl: "https://uat-aimesh.clickzetta.com/",
  }

  test("creates the profile, sets default, and configures the LLM", () => {
    provisionProfileFromCredential("uat", CRED)

    const data = readProfilesToml()
    expect(data.default_profile).toBe("uat")
    expect((data.profiles as Record<string, unknown>).uat).toEqual({
      username: "UAT_TEST",
      instance: "jnsxwfyr",
      workspace: "wanxin_test_04",
      schema: "clickzetta_account",
      vcluster: "CXH_TEST_1",
      pat: "czt_test_pat",
      // The credential blob's accessToken is a PAT, so the profile is pinned to it.
      auth_type: "pat",
      service: "https://uat-api.clickzetta.com",
      protocol: "https",
      analysis_agent_endpoint: "https://analysis-agent.clickzetta.com",
      aimeshEndpointBaseUrl: "https://uat-aimesh.clickzetta.com/",
    })

    const llm = readLlmEntries()
    // cz_change: no default_llm; opencode auto-selects the sole provisioned entry.
    expect(llm.model).toBeUndefined()
    expect(llm.llm.uat).toEqual({
      provider: "clickzetta",
      api_key: "ck_test_api_key",
      base_url: "https://uat-aimesh.clickzetta.com/",
    })
  })

  test("applies defaults for optional fields", () => {
    provisionProfileFromCredential("min", { instanceName: "inst", accessToken: "tok" })
    const profile = (readProfilesToml().profiles as Record<string, Record<string, unknown>>).min
    expect(profile).toEqual({
      instance: "inst",
      workspace: "default",
      schema: "public",
      vcluster: "default",
      pat: "tok",
      auth_type: "pat",
      service: "dev-api.clickzetta.com",
      protocol: "https",
    })
  })

  test("throws INVALID_CREDENTIAL when required fields are missing", () => {
    try {
      provisionProfileFromCredential("x", { instanceName: "inst" })
      throw new Error("expected to throw")
    } catch (e) {
      expect(e).toBeInstanceOf(ProvisionError)
      expect((e as ProvisionError).code).toBe("INVALID_CREDENTIAL")
    }
  })

  test("throws PROFILE_EXISTS and does not clobber an existing profile", () => {
    saveProfiles({ dup: { instance: "existing" } })
    try {
      provisionProfileFromCredential("dup", { instanceName: "new", accessToken: "tok" })
      throw new Error("expected to throw")
    } catch (e) {
      expect(e).toBeInstanceOf(ProvisionError)
      expect((e as ProvisionError).code).toBe("PROFILE_EXISTS")
    }
    // Untouched.
    expect(loadProfiles().dup).toEqual({ instance: "existing" })
  })
})

describe("provisionProfileFromOAuth", () => {
  const TOKEN: AuthToken = {
    token: "access-xyz",
    refreshToken: "refresh-xyz",
    expireTimeMs: 3600 * 1000,
    obtainedAt: Date.now(),
    instanceId: 159973,
    userId: 110000011361,
  }
  const USERINFO = {
    instanceName: "89b94150",
    workspace: "quick_start",
    schema: "public",
    vcluster: "DEFAULT_AP",
    accountName: "wynptmks",
    accountId: 112407,
    userId: 110000011361,
    instanceId: 159973,
    apiKey: "secret-api-key",
    aimeshEndpointBaseUrl: "https://dev-aimesh.clickzetta.com/",
  }
  test("creates a profile from scratch with flattened connection context + token + LLM", () => {
    const result = provisionProfileFromOAuth("czcli", {
      token: TOKEN,
      userInfo: USERINFO,
      service: "https://api.example.com",
      protocol: "https",
      instance: "old-instance",
    })

    expect(result.instance).toBe("89b94150")
    expect(result.llmConfigured).toBe(true)

    const data = readProfilesToml()
    expect(data.default_profile).toBe("czcli")
    const profile = (data.profiles as Record<string, Record<string, unknown>>).czcli
    expect(profile.instance).toBe("89b94150")
    expect(profile.workspace).toBe("quick_start")
    expect(profile.vcluster).toBe("DEFAULT_AP")
    expect(profile.service).toBe("https://api.example.com")
    expect(profile.account_id).toBe(112407)
    expect(profile.account_name).toBe("wynptmks")
    // aimeshEndpointBaseUrl flattens to the top-level field of the same name
    // (also what the credential path writes); no verbatim userinfo subtable is kept.
    expect(profile.aimeshEndpointBaseUrl).toBe("https://dev-aimesh.clickzetta.com/")
    expect(profile.userinfo).toBeUndefined()

    // Token under the instance-only slot.
    expect(makeProfileTokenStore("czcli").load()).toEqual(TOKEN)

    // LLM configured from userinfo.
    expect(readLlmEntries().llm.czcli).toEqual({
      provider: "clickzetta",
      api_key: "secret-api-key",
      base_url: "https://dev-aimesh.clickzetta.com/",
    })
  })

  test("idempotent: re-running patches + refreshes, never duplicates", () => {
    const input = {
      token: TOKEN,
      userInfo: USERINFO,
      service: "https://api.example.com",
      protocol: "https",
      instance: "old-instance",
    }
    provisionProfileFromOAuth("czcli", input)
    provisionProfileFromOAuth("czcli", { ...input, token: { ...TOKEN, token: "access-2" } })

    const profiles = loadProfiles()
    expect(Object.keys(profiles)).toEqual(["czcli"])
    // Token refreshed in the same slot.
    expect(makeProfileTokenStore("czcli").load()?.token).toBe("access-2")
  })

  test("falls back to config instance when userinfo carries none", () => {
    const result = provisionProfileFromOAuth("czcli", {
      token: TOKEN,
      service: "https://api.example.com",
      protocol: "https",
      instance: "fallback-instance",
    })
    expect(result.instance).toBe("fallback-instance")
    // No userinfo apiKey → LLM not configured.
    expect(result.llmConfigured).toBe(false)
    expect(getDefaultProfileName()).toBe("czcli")
  })
})

// A re-login owns exactly one thing: the token. Everything else in these files is
// state the user may have changed since the first login — a gateway virtual key
// swapped into llm.json when the complimentary quota ran out (llm/key-provision.ts),
// hand-edited schema/vcluster, a deliberately chosen default_profile — so it must
// survive. The signal is `[oauth.<name>]` existing, nothing else.
describe("provisionProfilesFromOAuthCombos re-login", () => {
  const TOKEN: AuthToken = {
    token: "access-1",
    refreshToken: "refresh-1",
    expireTimeMs: 3600 * 1000,
    obtainedAt: Date.now(),
    instanceId: 1,
    userId: 42,
  }
  const combo = (instance: string, workspace: string) => ({
    instance,
    workspace,
    service: "cn-shanghai-alicloud.api.clickzetta.com",
  })
  function input(combos: ReturnType<typeof combo>[], overrides: Record<string, unknown> = {}) {
    return {
      token: TOKEN,
      userInfo: {
        instanceName: combos[0]?.instance,
        workspace: combos[0]?.workspace,
        apiKey: "free-key",
        accountId: 7,
        accountName: "acct",
      },
      service: "cn-shanghai-alicloud.api.clickzetta.com",
      protocol: "https",
      issuer: "cn-shanghai-alicloud.api.clickzetta.com",
      // What the command computes from oauthSessionProvisioned.
      relogin: oauthSessionProvisioned("sess"),
      ...overrides,
    } as Parameters<typeof provisionProfilesFromOAuthCombos>[2]
  }

  test("first login provisions everything and reports what it created", () => {
    const combos = [combo("i1", "ws1"), combo("i1", "ws2")]
    const result = provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    expect(result).toEqual({
      profiles: ["sess_0", "sess_1"],
      cookiePinned: [],
      defaultProfile: "sess_0",
      llmConfigured: true,
      llmAction: "written",
      created: ["sess_0", "sess_1"],
    })
    expect(getDefaultProfileName()).toBe("sess_0")
    expect(readLlmEntries().llm.sess?.api_key).toBe("free-key")
  })

  test("re-login refreshes the token but leaves llm.json, edited profiles and default_profile alone", () => {
    const combos = [combo("i1", "ws1"), combo("i1", "ws2")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    // What the user does between the two logins.
    const llm = readLlmEntries()
    llm.llm.sess = { ...llm.llm.sess!, api_key: "virtual-key-after-quota" }
    writeLlmEntries({ llm: llm.llm })
    const edited = loadProfiles()
    edited.sess_0 = { ...edited.sess_0, schema: "my_schema", vcluster: "MY_VC" }
    saveProfiles(edited)
    setDefaultProfile("sess_1")

    const result = provisionProfilesFromOAuthCombos(
      "sess",
      combos,
      input(combos, { token: { ...TOKEN, token: "access-2" } }),
    )

    expect(result.created).toEqual([])
    expect(result.defaultProfile).toBe("sess_1")
    expect(getDefaultProfileName()).toBe("sess_1")
    // The one thing a re-login does own.
    expect(makeProfileTokenStore("sess_0").load()?.token).toBe("access-2")
    // The three things it does not.
    expect(readLlmEntries().llm.sess?.api_key).toBe("virtual-key-after-quota")
    expect(loadProfiles().sess_0?.schema).toBe("my_schema")
    expect(loadProfiles().sess_0?.vcluster).toBe("MY_VC")
  })

  test("re-login adds a newly appeared workspace without renumbering the existing ones", () => {
    const first = [combo("i1", "ws1"), combo("i1", "ws2")]
    provisionProfilesFromOAuthCombos("sess", first, input(first))

    // A new workspace appeared AND the server returns the combos in another order —
    // matching is by connection, so N must not shift.
    const second = [combo("i1", "ws2"), combo("i9", "ws_new"), combo("i1", "ws1")]
    const result = provisionProfilesFromOAuthCombos("sess", second, input(second))

    expect(result.created).toEqual(["sess_2"])
    expect(result.profiles).toEqual(["sess_0", "sess_1", "sess_2"])
    const profiles = loadProfiles()
    expect(profiles.sess_0?.workspace).toBe("ws1")
    expect(profiles.sess_1?.workspace).toBe("ws2")
    expect(profiles.sess_2).toMatchObject({ instance: "i9", workspace: "ws_new", oauth: "sess" })
  })

  // Enumeration returning nothing is a transient server condition, not a licence to
  // rewrite the file: the zero-combos fallback provisions a profile named `<base>`
  // while the normal path names them `<base>_N`, so keying "is this a refresh?" on
  // that row's existence classified the mixed transition as a first login and
  // handed llm.json + default_profile back to userinfo.
  test("re-login that enumerates nothing refreshes only the token", () => {
    const combos = [combo("i1", "ws1"), combo("i1", "ws2")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    const llm = readLlmEntries()
    llm.llm.sess = { ...llm.llm.sess!, api_key: "virtual-key-after-quota" }
    writeLlmEntries({ llm: llm.llm })
    setDefaultProfile("sess_1")

    const result = provisionProfilesFromOAuthCombos(
      "sess",
      [],
      input([], { token: { ...TOKEN, token: "access-2" } }),
    )

    expect(result).toEqual({
      profiles: ["sess_0", "sess_1"],
      cookiePinned: [],
      defaultProfile: "sess_1",
      llmConfigured: false,
      llmAction: "skipped_relogin",
      created: [],
    })
    // No bare `sess` row beside sess_0/sess_1.
    expect(Object.keys(loadProfiles()).sort()).toEqual(["sess_0", "sess_1"])
    expect(readLlmEntries().llm.sess?.api_key).toBe("virtual-key-after-quota")
    expect(getDefaultProfileName()).toBe("sess_1")
    // The token is still refreshed — every session profile shares [oauth.sess].
    expect(makeProfileTokenStore("sess_0").load()?.token).toBe("access-2")
  })

  // default_profile is one global string with nothing tying it to a session, so
  // reporting it unvalidated can name a profile this login has nothing to do with.
  test("re-login reports its own default when the on-disk one belongs to another session", () => {
    const combos = [combo("i1", "ws1")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    const other = loadProfiles()
    other.other_0 = { instance: "z1", workspace: "wsz" }
    saveProfiles(other)
    setDefaultProfile("other_0")

    const result = provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    expect(result.defaultProfile).toBe("sess_0")
    // Reported, not written: the user's selection stands.
    expect(getDefaultProfileName()).toBe("other_0")
  })

  // Combo→profile matching is by connection content on BOTH paths. Gating it on
  // `relogin` while counting indexes unconditionally appended a duplicate profile
  // for a connection that already had one (reachable when [oauth.<base>] is gone
  // but the profiles remain, e.g. a hand-repaired file).
  test("first login reuses an owned <base>_N row instead of duplicating it", () => {
    const combos = [combo("i1", "ws1")]
    // A row this session owns, with no token section: `relogin` is computed by the
    // caller, and the pointer alone already makes this a re-login (see
    // oauthSessionProvisioned) — so pass relogin:false explicitly to exercise the
    // first-login branch's matching, which is what could duplicate.
    saveProfiles({ sess_0: { instance: "i1", workspace: "ws1", oauth: "sess" } })
    expect(oauthSectionExists("sess")).toBe(false)

    const result = provisionProfilesFromOAuthCombos("sess", combos, input(combos, { relogin: false }))

    expect(result.profiles).toEqual(["sess_0"])
    expect(result.created).toEqual([])
    expect(Object.keys(loadProfiles())).toEqual(["sess_0"])
  })

  // logout --keep-profiles deletes [oauth.<name>] but keeps the rows pointing at it.
  test("a session with profiles but no token section still counts as provisioned", () => {
    saveProfiles({ sess_0: { instance: "i1", workspace: "ws1", oauth: "sess" } })
    expect(oauthSectionExists("sess")).toBe(false)
    expect(oauthSessionProvisioned("sess")).toBe(true)
  })

  // Session "sess" and session "sess_2" both own a profile that `<base>_N` parsing
  // reads as "index 2 of sess". The oauth pointer is what separates them.
  test("re-login does not repoint another session's profile that parses as <base>_N", () => {
    const combos = [combo("i1", "ws1")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    const profiles = loadProfiles()
    // What the zero-combos path writes for a session literally named "sess_2".
    profiles.sess_2 = { instance: "i1", workspace: "ws1", oauth: "sess_2" }
    saveProfiles(profiles)

    const result = provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    expect(result.profiles).toEqual(["sess_0"])
    expect(loadProfiles().sess_2?.oauth).toBe("sess_2")
  })

  // The name `sess_2` being taken by another session is still a name collision:
  // allocating over it would overwrite that session's profile.
  test("a new profile never takes a <base>_N name another session already owns", () => {
    const profiles = loadProfiles()
    profiles.sess_2 = { instance: "zz", workspace: "wszz", oauth: "sess_2", schema: "keep_me" }
    saveProfiles(profiles)

    const combos = [combo("i1", "ws1"), combo("i1", "ws2"), combo("i1", "ws3")]
    const result = provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    expect(result.created).toEqual(["sess_3", "sess_4", "sess_5"])
    // Untouched.
    expect(loadProfiles().sess_2).toEqual({ instance: "zz", workspace: "wszz", oauth: "sess_2", schema: "keep_me" })
  })

  // A default_profile naming a deleted profile is a dangling pointer, not a choice:
  // leaving it would hand back a file whose only usable profile needs --profile.
  test("re-login repairs a dangling default_profile but never a live one", () => {
    const combos = [combo("i1", "ws1")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    setDefaultProfile("deleted-profile")

    const repaired = provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    expect(repaired.defaultProfile).toBe("sess_0")
    expect(getDefaultProfileName()).toBe("sess_0")

    // A default that still resolves is left exactly as the user set it, even when it
    // belongs to another session.
    const profiles = loadProfiles()
    profiles.other_0 = { instance: "z1", workspace: "wsz" }
    saveProfiles(profiles)
    setDefaultProfile("other_0")
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    expect(getDefaultProfileName()).toBe("other_0")
  })

  // Writing `oauth`/`auth_type` onto a hand-made row would switch the credential it
  // authenticates with — the very thing setAuthTypeIfAbsent's contract prevents — so
  // a row is only adopted when it explicitly points at THIS session.
  test("a hand-written <base>_N row with no oauth pointer is never adopted", () => {
    const combos = [combo("i1", "ws1")]
    const profiles = loadProfiles()
    profiles.sess_0 = { instance: "i1", workspace: "ws1", pat: "user-pat" }
    saveProfiles(profiles)

    const result = provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    expect(result.profiles).toEqual(["sess_1"])
    // Untouched: no oauth pointer, no auth_type, pat intact.
    expect(loadProfiles().sess_0).toEqual({ instance: "i1", workspace: "ws1", pat: "user-pat" })
  })

  // `service` and `aimeshEndpointBaseUrl` are facts userinfo just re-read, not user
  // preferences: freezing them at the first login's values would mean a region or
  // endpoint move could never be picked up by the natural remedy (log in again).
  test("re-login refreshes server-owned fields while keeping user-owned ones", () => {
    const combos = [combo("i1", "ws1")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    const edited = loadProfiles()
    edited.sess_0 = { ...edited.sess_0, schema: "my_schema", vcluster: "MY_VC", header: { Cookie: "stale" } }
    saveProfiles(edited)

    const moved = [{ ...combo("i1", "ws1"), service: "us-east-1-aws.api.singdata.com" }]
    provisionProfilesFromOAuthCombos("sess", moved, input(moved, {
      userInfo: {
        instanceName: "i1",
        workspace: "ws1",
        apiKey: "free-key",
        accountId: 8,
        accountName: "renamed",
        aimeshEndpointBaseUrl: "https://new-aimesh.example.com/",
      },
    }))

    const after = loadProfiles().sess_0!
    expect(after.service).toBe("us-east-1-aws.api.singdata.com")
    expect(after.aimeshEndpointBaseUrl).toBe("https://new-aimesh.example.com/")
    expect(after.account_name).toBe("renamed")
    expect(after.schema).toBe("my_schema")
    expect(after.vcluster).toBe("MY_VC")
    expect(after.header).toEqual({ Cookie: "stale" })
  })

  // The documented remedy for "your account has no accessible instance yet" is to
  // provision one and log in again. That transition goes zero-combos (bare `<base>`
  // row, made default) → combos (`<base>_0`), and the bare row parses as nobody's
  // `<base>_N`, so it used to stay default and every bare command kept failing.
  test("zero-combos then combos: the default moves off the instance-less row", () => {
    // First login, nothing enumerable: the fallback writes the bare `sess` row.
    provisionProfilesFromOAuthCombos("sess", [], {
      ...input([]),
      userInfo: { apiKey: "free-key", accountId: 7, accountName: "acct" },
    } as Parameters<typeof provisionProfilesFromOAuthCombos>[2])
    expect(getDefaultProfileName()).toBe("sess")
    expect(String(loadProfiles().sess?.instance ?? "")).toBe("")

    // Instance provisioned, re-login now enumerates.
    const combos = [combo("i1", "ws1")]
    const result = provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    expect(result.created).toEqual(["sess_0"])
    expect(getDefaultProfileName()).toBe("sess_0")
    expect(result.defaultProfile).toBe("sess_0")
    // The bare row is this session's too — it shows up in `profiles`, like
    // `auth logout` sees it via the same oauth pointer — but AFTER the usable rows, so
    // `profiles[0]` is not the instance-less one.
    expect(result.profiles).toEqual(["sess_0", "sess"])
  })

  // enumerateOAuthCombos swallows a failed listUserWorkspaces per instance, so a
  // re-login routinely enumerates a subset of what the session owns. `profiles` and
  // the reported default must describe the session, not that subset — otherwise
  // profile_count drops with nothing deleted, and a caller feeding the reported
  // default_profile into --profile targets a different workspace than bare commands.
  test("partial enumeration still reports the whole session and the on-disk default", () => {
    const both = [combo("i1", "ws1"), combo("i2", "ws2")]
    provisionProfilesFromOAuthCombos("sess", both, input(both))
    setDefaultProfile("sess_1")

    // Only instance i1 could be enumerated this time.
    const partial = [combo("i1", "ws1")]
    const result = provisionProfilesFromOAuthCombos("sess", partial, input(partial))

    expect(result.profiles).toEqual(["sess_0", "sess_1"])
    expect(result.created).toEqual([])
    expect(result.defaultProfile).toBe("sess_1")
    expect(getDefaultProfileName()).toBe("sess_1")
  })

  // The re-login contract must not depend on enumeration succeeding: `service` comes
  // from input and the identity from userinfo, neither of which needs combos.
  test("a re-login that enumerates nothing still refreshes server-owned fields", () => {
    const combos = [combo("i1", "ws1"), combo("i2", "ws2")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    const edited = loadProfiles()
    edited.sess_0 = { ...edited.sess_0, schema: "my_schema" }
    saveProfiles(edited)

    provisionProfilesFromOAuthCombos("sess", [], {
      ...input([]),
      service: "us-east-1-aws.api.singdata.com",
      userInfo: {
        // userinfo describes the DEFAULT instance only — i1 here, not i2.
        instanceName: "i1",
        apiKey: "free-key",
        accountId: 8,
        accountName: "renamed",
        aimeshEndpointBaseUrl: "https://new-aimesh.example.com/",
      },
    } as Parameters<typeof provisionProfilesFromOAuthCombos>[2])

    const after = loadProfiles()
    // Account-wide facts land on every row.
    for (const name of ["sess_0", "sess_1"]) {
      expect(after[name]?.account_name).toBe("renamed")
      expect(after[name]?.aimeshEndpointBaseUrl).toBe("https://new-aimesh.example.com/")
    }
    // `service` is per-INSTANCE, and without combos all this path has is the default
    // instance's host: only the row userinfo describes may take it. Writing it to the
    // other row would move a second region's profile onto the wrong host.
    expect(after.sess_0?.service).toBe("us-east-1-aws.api.singdata.com")
    expect(after.sess_1?.service).toBe("cn-shanghai-alicloud.api.clickzetta.com")
    // User-owned still survives.
    expect(after.sess_0?.schema).toBe("my_schema")
  })

  // The one mechanism that keeps a preserved header.Cookie from shadowing the refreshed
  // token is the auth_type pin, so every re-login path must re-assert it.
  test("a re-login that enumerates nothing still pins auth_type and the oauth pointer", () => {
    const combos = [combo("i1", "ws1")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    // A row whose pin the user removed, carrying a stale cookie.
    const edited = loadProfiles()
    edited.sess_0 = { ...edited.sess_0, header: { Cookie: "stale" } }
    delete edited.sess_0.auth_type
    saveProfiles(edited)

    provisionProfilesFromOAuthCombos("sess", [], input([]))

    const after = loadProfiles().sess_0!
    expect(after.auth_type).toBe("oauth")
    expect(after.oauth).toBe("sess")
    expect(after.header).toEqual({ Cookie: "stale" })
  })

  // `service` may be the OAuth entry host standing in for a region host (no
  // gatewayMapping in userinfo); writing that over a real one breaks a working profile.
  test("a combo-less re-login does not overwrite a real service with the entry-host fallback", () => {
    const combos = [combo("i1", "ws1")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    provisionProfilesFromOAuthCombos("sess", [], {
      ...input([]),
      service: "api.clickzetta.com",
      serviceIsEntryFallback: true,
      userInfo: { instanceName: "i1", apiKey: "free-key", accountId: 7, accountName: "acct" },
    } as Parameters<typeof provisionProfilesFromOAuthCombos>[2])

    expect(loadProfiles().sess_0?.service).toBe("cn-shanghai-alicloud.api.clickzetta.com")
  })

  // Reaching the "provision an instance, then log in again" remedy through the
  // combo-less branch (userinfo names an instance now, the enumeration still failed) has
  // to heal the row: filling an EMPTY field is not overwriting a user edit, and without
  // it login reports success, no warning fires, and every bare command keeps failing.
  test("a combo-less re-login fills an instance-less row from userinfo", () => {
    // First login with nothing enumerable: the bare `sess` row, no instance.
    provisionProfilesFromOAuthCombos("sess", [], {
      ...input([]),
      userInfo: { apiKey: "free-key", accountId: 7, accountName: "acct" },
    } as Parameters<typeof provisionProfilesFromOAuthCombos>[2])
    expect(String(loadProfiles().sess?.instance ?? "")).toBe("")

    // Instance provisioned, but the workspace listing still fails.
    provisionProfilesFromOAuthCombos("sess", [], {
      ...input([]),
      userInfo: { instanceName: "i9", workspace: "ws9", apiKey: "free-key", accountId: 7, accountName: "acct" },
    } as Parameters<typeof provisionProfilesFromOAuthCombos>[2])

    const after = loadProfiles().sess!
    expect(after.instance).toBe("i9")
    expect(after.workspace).toBe("ws9")
    expect(after.service).toBe("cn-shanghai-alicloud.api.clickzetta.com")
  })

  // The single-profile refresh path must honour the entry-host guard too.
  test("a single-profile refresh does not overwrite a real service with the entry-host fallback", () => {
    provisionProfilesFromOAuthCombos("sess", [], {
      ...input([]),
      userInfo: { instanceName: "i1", workspace: "ws1", apiKey: "free-key", accountId: 7, accountName: "acct" },
    } as Parameters<typeof provisionProfilesFromOAuthCombos>[2])
    expect(loadProfiles().sess?.service).toBe("cn-shanghai-alicloud.api.clickzetta.com")
    // Drop the pointer so sessionProfiles is empty and the single-profile path runs.
    const rows = loadProfiles()
    delete rows.sess!.oauth
    saveProfiles(rows)

    provisionProfilesFromOAuthCombos("sess", [], {
      ...input([]),
      service: "api.clickzetta.com",
      serviceIsEntryFallback: true,
      userInfo: { instanceName: "i1", workspace: "ws1", apiKey: "free-key", accountId: 7, accountName: "acct" },
    } as Parameters<typeof provisionProfilesFromOAuthCombos>[2])

    expect(loadProfiles().sess?.service).toBe("cn-shanghai-alicloud.api.clickzetta.com")
  })

  // A cookie pin makes resolveConnectionConfig keep the Cookie header AND withhold the
  // OAuth token store, so for that row the login is a no-op — and setAuthTypeIfAbsent
  // deliberately will not repoint an explicit pin. Both fields are the user's, so the
  // result reports the rows and the command warns.
  test("re-login reports rows pinned to cookie auth", () => {
    const combos = [combo("i1", "ws1"), combo("i1", "ws2")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    const rows = loadProfiles()
    rows.sess_1 = { ...rows.sess_1, auth_type: "cookie", header: { Cookie: "stale" } }
    saveProfiles(rows)

    const result = provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    expect(result.cookiePinned).toEqual(["sess_1"])
    // Neither field is overwritten.
    expect(loadProfiles().sess_1?.auth_type).toBe("cookie")
    expect(loadProfiles().sess_1?.header).toEqual({ Cookie: "stale" })
  })

  // A per-instance enumeration failure must not leave its rows staler than a total failure
  // would: the account-wide fields and the token-binding fields are owed to every row of
  // the session, matched or not.
  test("partial enumeration still refreshes the un-enumerated rows' account-wide fields", () => {
    const both = [combo("i1", "ws1"), combo("i2", "ws2")]
    provisionProfilesFromOAuthCombos("sess", both, input(both))
    // The user cleared sess_1's pin and left a cookie behind; i2 stops enumerating.
    const edited = loadProfiles()
    edited.sess_1 = { ...edited.sess_1, header: { Cookie: "stale" } }
    delete edited.sess_1.auth_type
    saveProfiles(edited)

    provisionProfilesFromOAuthCombos("sess", [combo("i1", "ws1")], input([combo("i1", "ws1")], {
      userInfo: {
        instanceName: "i1",
        workspace: "ws1",
        apiKey: "free-key",
        accountId: 9,
        accountName: "renamed",
        aimeshEndpointBaseUrl: "https://new-aimesh.example.com/",
      },
    }))

    const after = loadProfiles().sess_1!
    expect(after.account_name).toBe("renamed")
    expect(after.aimeshEndpointBaseUrl).toBe("https://new-aimesh.example.com/")
    // The pin is re-asserted, so the preserved cookie cannot shadow the refreshed token.
    expect(after.auth_type).toBe("oauth")
    expect(after.oauth).toBe("sess")
    // Its per-connection fields are untouched — only a matched combo knows those.
    expect(after.instance).toBe("i2")
    expect(after.workspace).toBe("ws2")
  })

  // The entry-host guard protects a REAL host; on a row that has none, skipping the write
  // leaves the profile unusable for SQL, and the sign-in host beats nothing.
  test("the entry-host guard still fills a row that has no service", () => {
    saveProfiles({ sess: { oauth: "sess", instance: "i1" } })

    provisionProfilesFromOAuthCombos("sess", [], {
      ...input([]),
      service: "api.clickzetta.com",
      serviceIsEntryFallback: true,
      userInfo: { instanceName: "i1", workspace: "ws1", apiKey: "free-key", accountId: 7, accountName: "acct" },
    } as Parameters<typeof provisionProfilesFromOAuthCombos>[2])

    expect(loadProfiles().sess?.service).toBe("api.clickzetta.com")
  })

  // enumerateOAuthCombos does not dedupe, so the same connection can arrive twice.
  test("a repeated combo is reported once", () => {
    const combos = [combo("i1", "ws1"), combo("i1", "ws1")]
    const result = provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    expect(result.profiles).toEqual(["sess_0"])
    expect(result.created).toEqual(["sess_0"])
  })

  // The skip cannot tell a provisioned gateway key from a revoked complimentary one,
  // so overwriting is an explicit request rather than an unreachable path.
  test("--refresh-llm rewrites the entry on a re-login", () => {
    const combos = [combo("i1", "ws1")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    const llm = readLlmEntries()
    llm.llm.sess = { ...llm.llm.sess!, api_key: "revoked-key" }
    writeLlmEntries({ llm: llm.llm })

    const skipped = provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    expect(skipped.llmConfigured).toBe(false)
    expect(readLlmEntries().llm.sess?.api_key).toBe("revoked-key")

    const refreshed = provisionProfilesFromOAuthCombos("sess", combos, input(combos, { refreshLlm: true }))
    expect(refreshed.llmConfigured).toBe(true)
    expect(readLlmEntries().llm.sess?.api_key).toBe("free-key")
  })

  // The caller used to reconstruct llm_configuration from argv, which got this wrong:
  // the zero-combos early return ignored refreshLlm entirely and the payload then said
  // "no_api_key" for a run that never looked at the key and had been asked to refresh.
  test("--refresh-llm works on the zero-combos path and reports the action taken", () => {
    const combos = [combo("i1", "ws1")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    const llm = readLlmEntries()
    llm.llm.sess = { ...llm.llm.sess!, api_key: "revoked-key" }
    writeLlmEntries({ llm: llm.llm })

    // Enumeration failed this time, and the user asked for the refresh.
    const result = provisionProfilesFromOAuthCombos("sess", [], input([], { refreshLlm: true }))

    expect(result.llmAction).toBe("written")
    expect(result.llmConfigured).toBe(true)
    expect(readLlmEntries().llm.sess?.api_key).toBe("free-key")

    // Without the flag the same run reports the skip, not a missing key.
    const skipped = provisionProfilesFromOAuthCombos("sess", [], input([]))
    expect(skipped.llmAction).toBe("skipped_relogin")
  })

  // legacyName is an entry configureClickzettaLlm absorbs AND DELETES, so it must name
  // the historical key, never a user-mutable one like the current default profile.
  test("--refresh-llm does not swallow an unrelated entry named after the default profile", () => {
    const combos = [combo("i1", "ws1"), combo("i1", "ws2"), combo("i1", "ws3")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    setDefaultProfile("sess_2")
    const llm = readLlmEntries()
    llm.llm.sess_2 = { provider: "clickzetta", api_key: "unrelated-key" }
    writeLlmEntries({ llm: llm.llm })

    provisionProfilesFromOAuthCombos("sess", combos, input(combos, { refreshLlm: true }))

    expect(readLlmEntries().llm.sess_2?.api_key).toBe("unrelated-key")
  })

  // A session name that needs sanitizing was keyed raw by the single-profile path
  // before; renaming without the migration would orphan the entry config.model uses.
  test("the single-profile path migrates a raw-named llm entry to the sanitized key", () => {
    const raw = "my.prod"
    provisionProfilesFromOAuthCombos(raw, [], {
      ...input([]),
      userInfo: { instanceName: "i1", workspace: "ws1", apiKey: "free-key", accountId: 7, accountName: "acct" },
    } as Parameters<typeof provisionProfilesFromOAuthCombos>[2])

    const entries = readLlmEntries().llm
    expect(entries["my_prod"]?.api_key).toBe("free-key")
    expect(entries[raw]).toBeUndefined()
  })

  test("re-login does not resurrect an llm entry the user deleted", () => {
    const combos = [combo("i1", "ws1")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    writeLlmEntries({ llm: {} })

    const result = provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    expect(result.llmConfigured).toBe(false)
    expect(readLlmEntries().llm.sess).toBeUndefined()
  })
})
