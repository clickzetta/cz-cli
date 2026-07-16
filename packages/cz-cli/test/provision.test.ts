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
  ProvisionError,
} from "../src/connection/provision"
import { loadProfiles, makeProfileTokenStore, getDefaultProfileName, saveProfiles } from "../src/connection/profile-store"
import { readLlmEntries } from "../src/llm/native-config"

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
    // First entry becomes the default.
    expect(llm.default_llm).toBe("p1")
  })

  test("no-ops and returns false when apiKey absent", () => {
    expect(configureClickzettaLlm("p1", { baseURL: "https://gw.example.com/" })).toBe(false)
    expect(readLlmEntries().llm).toEqual({})
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
      service: "https://uat-api.clickzetta.com",
      protocol: "https",
      analysis_agent_endpoint: "https://analysis-agent.clickzetta.com",
      aimeshEndpointBaseUrl: "https://uat-aimesh.clickzetta.com/",
    })

    const llm = readLlmEntries()
    expect(llm.default_llm).toBe("uat")
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
    expect(makeProfileTokenStore("czcli", "89b94150").load()).toEqual(TOKEN)

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
    expect(makeProfileTokenStore("czcli", "89b94150").load()?.token).toBe("access-2")
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
