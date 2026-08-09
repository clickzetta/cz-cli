import { describe, expect, test } from "bun:test"
import { parse as parseToml } from "smol-toml"
import {
  addLlmEntry,
  hasUsableLlm,
  migrateLegacyClickzettaConfig,
  parseProfilesToml,
} from "../../src/config/profiles-llm"

describe("parseProfilesToml", () => {
  test("loads clickzetta from [llm.clickzetta]", () => {
    const result = parseProfilesToml(`
default_profile = "uat"
default_llm = "clickzetta"

[llm.clickzetta]
provider = "clickzetta"
api_key = "ck-test"
base_url = "https://gateway.clickzetta.com"
source_profile = "uat"
model = "deepseek/deepseek-v4-pro"
`)

    expect(result.providers.clickzetta.options).toEqual({
      apiKey: "ck-test",
      baseURL: "https://gateway.clickzetta.com/gateway/v1",
    })
    expect(result.providers.clickzetta.models?.["deepseek/deepseek-v4-pro"]).toBeDefined()
    expect(result.defaultModel).toBe("clickzetta/deepseek/deepseek-v4-pro")
    expect(result.entries).toEqual([
      {
        name: "clickzetta",
        provider: "clickzetta",
        model: "deepseek/deepseek-v4-pro",
      },
    ])
    expect(result.warnings).toEqual([])
  })

  test("keeps reading legacy profile fields with a migration warning", () => {
    const result = parseProfilesToml(`
default_profile = "default"

[profiles.default]
api_key = "legacy-key"
aimesh_endpoint = "https://legacy.clickzetta.com"
`)

    expect(result.providers).toEqual({
      clickzetta: {
        options: {
          apiKey: "legacy-key",
          baseURL: "https://legacy.clickzetta.com/gateway/v1",
        },
      },
    })
    expect(result.warnings).toContain(
      'found deprecated [profiles.default].api_key/aimesh_endpoint; migrate them to [llm.clickzetta]',
    )
  })

  test("returns the top-level [moa] section", () => {
    const result = parseProfilesToml(`
default_llm = "clickzetta"

[llm.clickzetta]
provider = "clickzetta"
api_key = "ck-test"
base_url = "https://gateway.clickzetta.com"

[moa]
default_preset = "balanced"
reference_concurrency = 4

[moa.presets.balanced]
enabled = true
reference_models = ["clickzetta/anthropic/claude-sonnet-4.6"]
aggregator = "clickzetta/anthropic/claude-sonnet-4.6"
max_tokens = 8192
`)

    expect(result.moa).toEqual({
      default_preset: "balanced",
      reference_concurrency: 4,
      presets: {
        balanced: {
          enabled: true,
          reference_models: ["clickzetta/anthropic/claude-sonnet-4.6"],
          aggregator: "clickzetta/anthropic/claude-sonnet-4.6",
          max_tokens: 8192,
        },
      },
    })
  })

  test("moa is undefined when profiles.toml has no [moa] section", () => {
    const result = parseProfilesToml(`
default_llm = "clickzetta"

[llm.clickzetta]
provider = "clickzetta"
api_key = "ck-test"
base_url = "https://gateway.clickzetta.com"
`)

    expect(result.moa).toBeUndefined()
  })

  test("uses default_llm to resolve duplicate provider entries", () => {
    const result = parseProfilesToml(`
default_llm = "prod-openai"

[llm.prod-openai]
provider = "openai-compatible"
api_key = "sk-prod"
base_url = "https://prod.example.com/v1"
model = "gpt-5"

[llm.dev-openai]
provider = "openai-compatible"
api_key = "sk-dev"
base_url = "https://dev.example.com/v1"

[llm.my-claude]
provider = "anthropic"
api_key = "sk-ant"
base_url = "https://api.anthropic.com"
`)

    expect(result.providers).toEqual({
      "prod-openai": {
        options: {
          apiKey: "sk-prod",
          baseURL: "https://prod.example.com/v1",
        },
        name: "prod-openai",
        npm: "@ai-sdk/openai-compatible",
        api: "https://prod.example.com/v1",
        env: [],
        models: {
          "gpt-5": {
            name: "gpt-5",
            tool_call: true,
            reasoning: false,
            attachment: false,
            temperature: true,
            limit: { context: 128000, output: 16384 },
            modalities: { input: ["text"], output: ["text"] },
          },
        },
      },
      "dev-openai": {
        name: "dev-openai",
        options: {
          apiKey: "sk-dev",
          baseURL: "https://dev.example.com/v1",
        },
      },
      "my-claude": {
        name: "my-claude",
        options: {
          apiKey: "sk-ant",
          baseURL: "https://api.anthropic.com/v1",
        },
      },
    })
    expect(result.defaultModel).toBe("prod-openai/gpt-5")
    expect(result.warnings).toEqual([])
  })

  test("registers duplicate clickzetta llm entries as distinct runtime providers", () => {
    const result = parseProfilesToml(`
default_llm = "team-a"

[llm.team-a]
provider = "clickzetta"
api_key = "ck-team-a"
base_url = "https://team-a.example.com"
model = "deepseek/deepseek-v4-pro"

[llm.team-b]
provider = "clickzetta"
api_key = "ck-team-b"
base_url = "https://team-b.example.com"
model = "deepseek/deepseek-v4-pro"
`)

    expect(Object.keys(result.providers).sort()).toEqual(["team-a", "team-b"])
    expect(result.providers["team-a"].options).toEqual({
      apiKey: "ck-team-a",
      baseURL: "https://team-a.example.com/gateway/v1",
    })
    expect(result.providers["team-b"].options).toEqual({
      apiKey: "ck-team-b",
      baseURL: "https://team-b.example.com/gateway/v1",
    })
    expect(result.providers["team-a"].models?.["deepseek/deepseek-v4-pro"]).toBeDefined()
    expect(result.providers["team-b"].models?.["deepseek/deepseek-v4-pro"]).toBeDefined()
    expect(result.defaultModel).toBe("team-a/deepseek/deepseek-v4-pro")
    expect(result.entries).toEqual([
      {
        name: "team-a",
        provider: "clickzetta",
        model: "deepseek/deepseek-v4-pro",
      },
      {
        name: "team-b",
        provider: "clickzetta",
        model: "deepseek/deepseek-v4-pro",
      },
    ])
  })

  test("bridges selected openai-compatible entry into a runnable provider model", () => {
    const result = parseProfilesToml(`
default_llm = "codzen"

[llm.codzen]
provider = "openai-compatible"
api_key = "sk-codzen"
base_url = "https://codzen.ai/v1"
model = "glm-5.1"
`)

    expect(result.providers.codzen).toEqual({
      options: {
        apiKey: "sk-codzen",
        baseURL: "https://codzen.ai/v1",
      },
      name: "codzen",
      npm: "@ai-sdk/openai-compatible",
      api: "https://codzen.ai/v1",
      env: [],
      models: {
        "glm-5.1": {
          name: "glm-5.1",
          tool_call: true,
          reasoning: false,
          attachment: false,
          temperature: true,
          limit: { context: 128000, output: 16384 },
          modalities: { input: ["text"], output: ["text"] },
        },
      },
    })
    expect(result.defaultModel).toBe("codzen/glm-5.1")
  })

  test("does not derive a default model when default_llm has no model", () => {
    const result = parseProfilesToml(`
default_llm = "my-claude"

[llm.my-claude]
provider = "anthropic"
api_key = "sk-ant"
`)

    expect(result.defaultModel).toBeUndefined()
    expect(result.warnings).toEqual([])
  })

  test("adds a UI-provided LLM entry and makes it default", () => {
    const data = parseToml(`
default_llm = "clickzetta"

[llm.clickzetta]
provider = "clickzetta"
api_key = "ck-old"
base_url = "https://gateway.clickzetta.com"
`) as Record<string, unknown>

    const result = addLlmEntry(data, {
      provider: "openai-compatible",
      apiKey: "sk-user",
      baseUrl: "https://models.example.com",
      use: true,
    })

    expect(result).toEqual({
      name: "openai-compatible",
      model: "gpt-4.1-mini",
      provider: "openai-compatible",
    })
    expect(data.default_llm).toBe("openai-compatible")
    expect(data.llm).toMatchObject({
      clickzetta: {
        provider: "clickzetta",
        api_key: "ck-old",
      },
      "openai-compatible": {
        provider: "openai-compatible",
        api_key: "sk-user",
        base_url: "https://models.example.com/v1",
        model: "gpt-4.1-mini",
      },
    })
  })

})

describe("migrateLegacyClickzettaConfig", () => {
  test("moves legacy clickzetta fields into [llm.clickzetta]", () => {
    const data = parseToml(`
default_profile = "default"

[profiles.default]
service = "https://service.clickzetta.com"
api_key = "legacy-key"
aimesh_endpoint = "https://legacy.clickzetta.com"
`) as Record<string, unknown>

    expect(migrateLegacyClickzettaConfig(data)).toBe(true)
    expect(data).toEqual({
      default_profile: "default",
      default_llm: "clickzetta",
      profiles: {
        default: {
          service: "https://service.clickzetta.com",
        },
      },
      llm: {
        clickzetta: {
          provider: "clickzetta",
          api_key: "legacy-key",
          base_url: "https://legacy.clickzetta.com",
        },
      },
    })
  })

  test("preserves an existing default_llm while refreshing clickzetta", () => {
    const data = parseToml(`
default_profile = "default"
default_llm = "my-claude"

[profiles.default]
api_key = "legacy-key"
aimesh_endpoint = "https://legacy.clickzetta.com"

[llm.clickzetta]
provider = "clickzetta"
model = "deepseek/deepseek-v4-pro"
`) as Record<string, unknown>

    expect(migrateLegacyClickzettaConfig(data)).toBe(true)
    expect(data).toEqual({
      default_profile: "default",
      default_llm: "my-claude",
      profiles: {
        default: {},
      },
      llm: {
        clickzetta: {
          provider: "clickzetta",
          model: "deepseek/deepseek-v4-pro",
          api_key: "legacy-key",
          base_url: "https://legacy.clickzetta.com",
        },
      },
    })
  })

  test("hasUsableLlm accepts migrated-style clickzetta entries", () => {
    expect(hasUsableLlm(`
[llm.clickzetta]
provider = "clickzetta"
api_key = "ck-test"
`).hasValidConfig).toBe(true)
  })
})
