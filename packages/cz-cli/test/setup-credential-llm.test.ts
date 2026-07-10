import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { parse as parseToml } from "smol-toml"
import { readLlmEntries } from "../src/llm/native-config.js"

function runSetupWithCredential(credential: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "cz-cli-setup-credential-"))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  const encoded = Buffer.from(JSON.stringify(credential), "utf-8").toString("base64")
  const result = spawnSync(
    "bun",
    ["src/main.ts", "setup", "--name", "uat", "--credential", encoded],
    {
      cwd: import.meta.dir + "/..",
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: home,
        CLICKZETTA_SKIP_TELEMETRY_PROMPT: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const profilesPath = join(home, ".clickzetta", "profiles.toml")
  const profiles = existsSync(profilesPath)
    ? parseToml(readFileSync(profilesPath, "utf-8")) as Record<string, unknown>
    : {}
  const originalTestHome = process.env.CLICKZETTA_TEST_HOME
  process.env.CLICKZETTA_TEST_HOME = home
  const llm = readLlmEntries()
  if (originalTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = originalTestHome
  return { result, profiles, llm }
}

function runSetup(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "cz-cli-setup-jdbc-"))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  const result = spawnSync(
    "bun",
    ["src/main.ts", "setup", ...args],
    {
      cwd: import.meta.dir + "/..",
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: home,
        CLICKZETTA_SKIP_TELEMETRY_PROMPT: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const profilesPath = join(home, ".clickzetta", "profiles.toml")
  const profiles = existsSync(profilesPath)
    ? parseToml(readFileSync(profilesPath, "utf-8")) as Record<string, unknown>
    : {}
  const originalTestHome = process.env.CLICKZETTA_TEST_HOME
  process.env.CLICKZETTA_TEST_HOME = home
  const llm = readLlmEntries()
  if (originalTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = originalTestHome
  return { result, profiles, llm }
}

describe("setup --credential", () => {
  test("writes clickzetta llm provider fields from credential payload", () => {
    const { result, profiles, llm } = runSetupWithCredential({
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
    })

    expect(result.status).toBe(0)
    expect(profiles.default_profile).toBe("uat")
    expect(llm.default_llm).toBe("uat")
    expect(llm.llm).toEqual({
      uat: {
        provider: "clickzetta",
        api_key: "ck_test_api_key",
        base_url: "https://uat-aimesh.clickzetta.com/",
      },
    })
    expect(profiles.profiles).toEqual({
      uat: {
        username: "UAT_TEST",
        instance: "jnsxwfyr",
        workspace: "wanxin_test_04",
        schema: "clickzetta_account",
        vcluster: "CXH_TEST_1",
        pat: "czt_test_pat",
        service: "https://uat-api.clickzetta.com",
        protocol: "https",
        analysis_agent_endpoint: "https://analysis-agent.clickzetta.com",
        ai_gateway_url: "https://uat-aimesh.clickzetta.com/",
      },
    })
  })
})

describe("setup --login-method custom --login <jdbc>", () => {
  test("writes a profile directly from a complete JDBC connection string", () => {
    const { result, profiles } = runSetup([
      "--name", "jdbc",
      "--login-method", "custom",
      "--login", "jdbc:clickzetta://00000000.cn-hangzhou-alicloud.api.clickzetta.com/workspace?username=alice&password=secret&schema=public&virtualCluster=DEFAULT",
    ])

    expect(result.status).toBe(0)
    expect(profiles.default_profile).toBe("jdbc")
    expect(profiles.profiles).toEqual({
      jdbc: {
        username: "alice",
        password: "secret",
        service: "cn-hangzhou-alicloud.api.clickzetta.com",
        protocol: "https",
        instance: "00000000",
        workspace: "workspace",
        schema: "public",
        vcluster: "DEFAULT",
      },
    })
  })
})
