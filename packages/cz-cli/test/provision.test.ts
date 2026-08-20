import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
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
      // What the command computes from oauthSectionExists.
      relogin: oauthSectionExists("sess"),
      ...overrides,
    } as Parameters<typeof provisionProfilesFromOAuthCombos>[2]
  }

  test("first login provisions everything and reports what it created", () => {
    const combos = [combo("i1", "ws1"), combo("i1", "ws2")]
    const result = provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    expect(result).toEqual({
      profiles: ["sess_0", "sess_1"],
      defaultProfile: "sess_0",
      llmConfigured: true,
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

  test("re-login does not resurrect an llm entry the user deleted", () => {
    const combos = [combo("i1", "ws1")]
    provisionProfilesFromOAuthCombos("sess", combos, input(combos))
    writeLlmEntries({ llm: {} })

    const result = provisionProfilesFromOAuthCombos("sess", combos, input(combos))

    expect(result.llmConfigured).toBe(false)
    expect(readLlmEntries().llm.sess).toBeUndefined()
  })
})
