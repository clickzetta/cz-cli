import { test, expect, describe } from "bun:test"
import { parseProfilesToml, hasUsableLlm, normalizeLlmBaseUrl } from "../../src/config/profiles-llm"

describe("parseProfilesToml", () => {
  test("ClickZetta-only profile → clickzetta provider + deepseek-v4-pro", () => {
    const toml = `default_profile = "default"

[profiles.default]
instance = "abc"
api_key = "cz-key-123"
aimesh_endpoint = "https://aimesh.example.com/"
`
    const result = parseProfilesToml(toml)
    expect(result.providers["clickzetta"]).toBeDefined()
    expect(result.providers["clickzetta"].options.apiKey).toBe("cz-key-123")
    expect(result.providers["clickzetta"].options.baseURL).toBe("https://aimesh.example.com/v1")
    expect(result.warnings).toEqual([])
  })

  test("default_llm points at valid [llm.my-claude] → anthropic provider, no model pinned", () => {
    const toml = `default_profile = "default"
default_llm = "my-claude"

[profiles.default]
api_key = "cz-key"
aimesh_endpoint = "https://aimesh.example.com/"

[llm.my-claude]
provider = "anthropic"
api_key = "sk-ant-xxx"
`
    const result = parseProfilesToml(toml)
    // No explicit model → opencode's sort() picks the best; we don't pin
    expect(result.providers["anthropic"]).toBeDefined()
    expect(result.providers["anthropic"].options.apiKey).toBe("sk-ant-xxx")
    // ClickZetta is also registered (always, when creds present)
    expect(result.providers["clickzetta"]).toBeDefined()
    expect(result.warnings).toEqual([])
  })

  test("[llm.*] with explicit model overrides default", () => {
    const toml = `default_profile = "default"
default_llm = "my-claude"

[profiles.default]
api_key = "cz-key"

[llm.my-claude]
provider = "anthropic"
api_key = "sk-ant-xxx"
model = "claude-opus-4-1"
`
    const result = parseProfilesToml(toml)
  })

  test("model field is optional — only provider + api_key required, no model pinned", () => {
    const toml = `default_profile = "default"
default_llm = "my-openai"

[profiles.default]
api_key = "cz-key"

[llm.my-openai]
provider = "openai"
api_key = "sk-xxx"
`
    const result = parseProfilesToml(toml)
    // No explicit model → opencode picks best via sort()
    expect(result.providers["openai"]).toBeDefined()
    expect(result.warnings).toEqual([])
  })

  test("all [llm.*] entries are registered, not just the selected one", () => {
    const toml = `default_profile = "default"
default_llm = "my-claude"

[profiles.default]
api_key = "cz-key"

[llm.my-claude]
provider = "anthropic"
api_key = "sk-ant-xxx"

[llm.my-openai]
provider = "openai"
api_key = "sk-oai-xxx"
`
    const result = parseProfilesToml(toml)
    expect(result.providers["anthropic"]).toBeDefined()
    expect(result.providers["openai"]).toBeDefined()
    expect(result.providers["clickzetta"]).toBeDefined()
  })

  test("default_llm points at missing entry → falls back to ClickZetta with warning, no model pinned", () => {
    const toml = `default_profile = "default"
default_llm = "missing"

[profiles.default]
api_key = "cz-key"
aimesh_endpoint = "https://aimesh.example.com/"
`
    const result = parseProfilesToml(toml)
    // ClickZetta is the only provider; model pinned to deepseek-v4-pro (only option)
    expect(result.providers["clickzetta"]).toBeDefined()
    expect(result.warnings.some((w) => w.includes("missing") && w.includes("falling back"))).toBe(true)
  })

  test("legacy llm_* fields in profile section → ignored with one warning", () => {
    const toml = `default_profile = "default"

[profiles.default]
api_key = "cz-key"
aimesh_endpoint = "https://aimesh.example.com/"
llm_provider = "anthropic"
llm_model = "claude-sonnet-4-6"
llm_api_key = "sk-ant-old"
llm_base_url = "https://old.example.com"
`
    const result = parseProfilesToml(toml)
    // Legacy values NOT applied — still ClickZetta deepseek
    expect(result.providers["clickzetta"]).toBeDefined()
    expect(result.providers["anthropic"]).toBeUndefined()
    const legacyWarnings = result.warnings.filter((w) => w.includes("deprecated llm_*"))
    expect(legacyWarnings.length).toBe(1)
  })

  test("[llm.*] with unknown provider → skipped with warning, ClickZetta model pinned", () => {
    const toml = `default_profile = "default"
default_llm = "weird"

[profiles.default]
api_key = "cz-key"

[llm.weird]
provider = "unknown-provider"
api_key = "sk-x"
`
    const result = parseProfilesToml(toml)
    expect(result.providers["unknown-provider"]).toBeUndefined()
    expect(result.warnings.some((w) => w.includes("unknown provider"))).toBe(true)
  })

  test("no api_key in profile AND no [llm.*] → no providers", () => {
    const toml = `default_profile = "default"

[profiles.default]
instance = "abc"
`
    const result = parseProfilesToml(toml)
    expect(Object.keys(result.providers)).toHaveLength(0)
  })

  test("base_url with /v1 already present is not double-appended", () => {
    const toml = `default_profile = "default"
default_llm = "my-openai"

[profiles.default]
api_key = "cz-key"

[llm.my-openai]
provider = "openai"
api_key = "sk-x"
base_url = "https://api.openai.com/v1"
`
    const result = parseProfilesToml(toml)
    expect(result.providers["openai"].options.baseURL).toBe("https://api.openai.com/v1")
  })

  test("[llm.*] missing api_key → entry skipped silently, ClickZetta model pinned", () => {
    const toml = `default_profile = "default"
default_llm = "bad"

[profiles.default]
api_key = "cz-key"

[llm.bad]
provider = "anthropic"
`
    const result = parseProfilesToml(toml)
    // bad entry skipped, falls back to clickzetta
    expect(result.providers["anthropic"]).toBeUndefined()
  })
})

describe("hasUsableLlm", () => {
  test("profile api_key present → usable", () => {
    const toml = `default_profile = "default"
[profiles.default]
api_key = "cz-key"
`
    expect(hasUsableLlm(toml).hasValidConfig).toBe(true)
  })

  test("no api_key AND no [llm.*] → not usable", () => {
    const toml = `default_profile = "default"
[profiles.default]
instance = "abc"
`
    expect(hasUsableLlm(toml).hasValidConfig).toBe(false)
  })

  test("no api_key but valid [llm.*] (provider + api_key, no model) → usable", () => {
    const toml = `default_profile = "default"
[profiles.default]
instance = "abc"
[llm.foo]
provider = "anthropic"
api_key = "k"
`
    expect(hasUsableLlm(toml).hasValidConfig).toBe(true)
  })

  test("invalid TOML → not usable, no throw", () => {
    expect(hasUsableLlm("not = valid = toml").hasValidConfig).toBe(false)
  })
})

describe("normalizeLlmBaseUrl", () => {
  test("appends /v1 for bare host on anthropic/openai/openai-compatible/clickzetta", () => {
    expect(normalizeLlmBaseUrl("anthropic", "https://api.anthropic.com")).toBe("https://api.anthropic.com/v1")
    expect(normalizeLlmBaseUrl("openai", "https://api.openai.com/")).toBe("https://api.openai.com/v1")
    expect(normalizeLlmBaseUrl("openai-compatible", "https://gw.example.com")).toBe("https://gw.example.com/v1")
    expect(normalizeLlmBaseUrl("clickzetta", "https://aimesh.example.com")).toBe("https://aimesh.example.com/v1")
  })

  test("leaves existing /vN path intact", () => {
    expect(normalizeLlmBaseUrl("openai", "https://api.openai.com/v2")).toBe("https://api.openai.com/v2")
  })

  test("does not append /v1 for non-OpenAI-style providers", () => {
    expect(normalizeLlmBaseUrl("bedrock", "https://bedrock.example.com")).toBe("https://bedrock.example.com")
  })

  test("undefined in → undefined out", () => {
    expect(normalizeLlmBaseUrl("openai", undefined)).toBeUndefined()
  })
})
