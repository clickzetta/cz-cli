import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  llmConfigPath,
  readLlmConfig,
  readLlmEntries,
  writeLlmEntries,
  upsertProvider,
  removeProvider,
  migrateProfilesLlmToJson,
  normalizeLlmProviderNames,
  type LlmEntryView,
} from "../src/llm/native-config.js"
import { writeFileSync } from "node:fs"

const HOME = join(tmpdir(), `cz-native-${process.pid}-${Date.now()}`)
const orig = process.env.CLICKZETTA_TEST_HOME

beforeEach(() => {
  mkdirSync(join(HOME, ".clickzetta"), { recursive: true })
  process.env.CLICKZETTA_TEST_HOME = HOME
})

afterEach(() => {
  if (orig === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = orig
  rmSync(HOME, { recursive: true, force: true })
})

describe("native-config llm.json", () => {
  test("path is ~/.clickzetta/llm.json", () => {
    expect(llmConfigPath()).toBe(join(HOME, ".clickzetta", "llm.json"))
  })

  test("authoring-view round-trip is lossless (write → read = identity)", () => {
    const entries: Record<string, LlmEntryView> = {
      "my-relay": { provider: "openai-compatible", api_key: "sk-x", base_url: "https://x/v1", model: "qwen-max" },
      "my-claude": { provider: "anthropic", api_key: "sk-ant", model: "claude-sonnet-4-6" },
      clickzetta: { provider: "clickzetta", api_key: "cz-key", base_url: "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1" },
    }
    writeLlmEntries({ llm: entries, default_llm: "my-relay" })
    const got = readLlmEntries()
    expect(got.default_llm).toBe("my-relay")
    expect(got.llm["my-relay"]).toEqual(entries["my-relay"])
    expect(got.llm["my-claude"]).toEqual(entries["my-claude"])
    expect(got.llm["clickzetta"].provider).toBe("clickzetta")
    expect(got.llm["clickzetta"].api_key).toBe("cz-key")
    expect(got.llm["clickzetta"].model).toBeUndefined()
  })

  test("stored file is opencode-native (provider/options/model), not TOML shape", () => {
    writeLlmEntries({
      llm: { "my-relay": { provider: "openai-compatible", api_key: "sk-x", base_url: "https://x/v1", model: "qwen-max" } },
      default_llm: "my-relay",
    })
    const raw = JSON.parse(readFileSync(llmConfigPath(), "utf-8"))
    expect(raw.$schema).toBe("https://opencode.ai/config.json")
    expect(raw.provider["my-relay"].npm).toBe("@ai-sdk/openai-compatible")
    expect(raw.provider["my-relay"].options.apiKey).toBe("sk-x")
    expect(raw.provider["my-relay"].options.baseURL).toBe("https://x/v1")
    expect(raw.model).toBe("my-relay/qwen-max")
    expect(raw.provider["my-relay"].api_key).toBeUndefined()
  })

  test("upsertProvider + removeProvider", () => {
    upsertProvider({ name: "p1", provider: "openai", apiKey: "sk-1", model: "gpt-4o", setDefault: true })
    expect(readLlmConfig().model).toBe("p1/gpt-4o")
    expect(readLlmEntries().llm["p1"].provider).toBe("openai")
    removeProvider("p1")
    expect(readLlmEntries().llm["p1"]).toBeUndefined()
    expect(readLlmConfig().model).toBeUndefined()
  })

  test("no llm.json → empty entries", () => {
    expect(existsSync(llmConfigPath())).toBe(false)
    expect(readLlmEntries()).toEqual({ llm: {} })
  })

  test("writeLlmEntries sets provider.name = entry key (per-entry /model group)", () => {
    writeLlmEntries({
      llm: {
        alpha: { provider: "clickzetta", api_key: "k1", base_url: "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1" },
        beta: { provider: "clickzetta", api_key: "k2", base_url: "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1" },
      },
      default_llm: "alpha",
    })
    const raw = JSON.parse(readFileSync(llmConfigPath(), "utf-8"))
    expect(raw.provider.alpha.name).toBe("alpha")
    expect(raw.provider.beta.name).toBe("beta")
  })
})

describe("normalizeLlmProviderNames", () => {
  test("heals legacy llm.json where every name is the hardcoded 'ClickZetta'", () => {
    // Simulate an older a2 build's output: distinct keys, identical name.
    const legacy = {
      $schema: "https://opencode.ai/config.json",
      provider: {
        default: { name: "ClickZetta", npm: "@clickzetta/ai-gateway", options: { apiKey: "a" }, models: {} },
        uat: { name: "ClickZetta", npm: "@clickzetta/ai-gateway", options: { apiKey: "b" }, models: {} },
      },
      model: "default",
    }
    writeFileSync(llmConfigPath(), JSON.stringify(legacy), { mode: 0o600 })

    const changed = normalizeLlmProviderNames()
    expect(changed.sort()).toEqual(["default", "uat"])
    const raw = JSON.parse(readFileSync(llmConfigPath(), "utf-8"))
    expect(raw.provider.default.name).toBe("default")
    expect(raw.provider.uat.name).toBe("uat")
    // idempotent: second run is a no-op
    expect(normalizeLlmProviderNames()).toEqual([])
  })

  test("no llm.json → no-op", () => {
    expect(normalizeLlmProviderNames()).toEqual([])
  })
})

describe("migrateProfilesLlmToJson", () => {
  function profilesPath() {
    return join(HOME, ".clickzetta", "profiles.toml")
  }

  test("lifts [llm.*] tables into llm.json (name=key, default_llm→model) and strips them, preserving profiles", () => {
    writeFileSync(
      profilesPath(),
      [
        'default_profile = "demo"',
        'default_llm = "demo"',
        "",
        "[profiles.demo]",
        'username = "u"',
        "",
        "[profiles.demo.oauth.tok]",
        'access_token = "AT-SECRET"',
        "",
        "[llm.demo]",
        'provider = "clickzetta"',
        'api_key = "sk-demo"',
        'base_url = "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1"',
        "",
        "[llm.demo_1]",
        'provider = "clickzetta"',
        'api_key = "sk-demo1"',
        'base_url = "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1"',
        "",
      ].join("\n"),
      { mode: 0o600 },
    )

    const migrated = migrateProfilesLlmToJson().sort()
    expect(migrated).toEqual(["demo", "demo_1"])

    const raw = JSON.parse(readFileSync(llmConfigPath(), "utf-8"))
    expect(raw.provider.demo.name).toBe("demo")
    expect(raw.provider.demo_1.name).toBe("demo_1")
    expect(raw.provider.demo.options.apiKey).toBe("sk-demo")
    expect(raw.model).toBe("demo")

    // profiles.toml: [llm.*]/default_llm stripped, connection profile + OAuth intact
    const toml = readFileSync(profilesPath(), "utf-8")
    expect(toml).not.toContain("[llm.demo]")
    expect(toml).not.toContain("default_llm")
    expect(toml).toContain("[profiles.demo]")
    expect(toml).toContain("AT-SECRET")

    // idempotent: nothing left to migrate
    expect(migrateProfilesLlmToJson()).toEqual([])
  })

  test("does not clobber an entry already present in llm.json", () => {
    upsertProvider({ name: "demo", provider: "anthropic", apiKey: "keep-me", model: "claude-sonnet-4-6", setDefault: true })
    writeFileSync(
      profilesPath(),
      ['[llm.demo]', 'provider = "clickzetta"', 'api_key = "should-not-win"', ""].join("\n"),
      { mode: 0o600 },
    )
    expect(migrateProfilesLlmToJson()).toEqual([])
    const raw = JSON.parse(readFileSync(llmConfigPath(), "utf-8"))
    expect(raw.provider.demo.options.apiKey).toBe("keep-me")
    expect(raw.provider.demo.npm).toBe("@ai-sdk/anthropic")
  })

  test("no profiles.toml → no-op", () => {
    expect(migrateProfilesLlmToJson()).toEqual([])
  })
})
