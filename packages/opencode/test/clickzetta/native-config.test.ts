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
  migrateProfilesLlmToNative,
  type LlmEntryView,
} from "../../src/clickzetta/native-config"
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
    // clickzetta: provider + key + gateway baseURL round-trip; no single model (catalog)
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
    expect(raw.provider["my-relay"].api_key).toBeUndefined() // not TOML shape
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
})

describe("migrateProfilesLlmToNative (one-time, idempotent)", () => {
  const profilesPath = () => join(HOME, ".clickzetta", "profiles.toml")
  const TOML = [
    `default_profile = "p1"`,
    `default_llm = "my-relay"`,
    ``,
    `[profiles.p1]`,
    `service = "x"`,
    ``,
    `[llm.my-relay]`,
    `provider = "openai-compatible"`,
    `api_key = "sk-x"`,
    `base_url = "https://x/v1"`,
    `model = "qwen-max"`,
    ``,
    `[llm.clickzetta]`,
    `provider = "clickzetta"`,
    `api_key = "cz-key"`,
    ``,
  ].join("\n")

  test("migrates [llm.*] → llm.json, sets model, strips toml, preserves [profiles.*]", () => {
    writeFileSync(profilesPath(), TOML)
    expect(migrateProfilesLlmToNative()).toBe(true)
    const entries = readLlmEntries()
    expect(Object.keys(entries.llm).sort()).toEqual(["clickzetta", "my-relay"])
    expect(entries.default_llm).toBe("my-relay")
    expect(readLlmConfig().model).toBe("my-relay/qwen-max")
    const toml = readFileSync(profilesPath(), "utf-8")
    expect(toml.includes("[llm.")).toBe(false)
    expect(toml.includes("default_llm")).toBe(false)
    expect(toml.includes("[profiles.p1]")).toBe(true) // connection preserved
  })

  test("idempotent: second run is a no-op", () => {
    writeFileSync(profilesPath(), TOML)
    expect(migrateProfilesLlmToNative()).toBe(true)
    expect(migrateProfilesLlmToNative()).toBe(false)
  })

  test("no profiles.toml → no-op", () => {
    expect(migrateProfilesLlmToNative()).toBe(false)
  })

  test("never clobbers an existing native provider", () => {
    upsertProvider({ name: "my-relay", provider: "openai", apiKey: "KEEP-ME", model: "gpt-4o" })
    writeFileSync(profilesPath(), TOML)
    migrateProfilesLlmToNative()
    // existing my-relay (openai/KEEP-ME) preserved, not overwritten by toml's
    expect(readLlmConfig().provider!["my-relay"].options.apiKey).toBe("KEEP-ME")
    // but the new clickzetta entry still migrated in
    expect(readLlmConfig().provider!["clickzetta"]).toBeDefined()
  })
})
