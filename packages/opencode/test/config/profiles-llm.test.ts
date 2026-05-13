import { describe, expect, test } from "bun:test"
import { parse as parseToml } from "smol-toml"
import {
  hasUsableLlm,
  migrateLegacyClickzettaConfig,
  parseProfilesToml,
} from "../../src/config/profiles-llm"

describe("parseProfilesToml", () => {
  test("loads clickzetta from [llm.clickzetta]", () => {
    const result = parseProfilesToml(`
default_llm = "clickzetta"

[llm.clickzetta]
provider = "clickzetta"
api_key = "ck-test"
base_url = "https://gateway.clickzetta.com"
`)

    expect(result.providers).toEqual({
      clickzetta: {
        options: {
          apiKey: "ck-test",
          baseURL: "https://gateway.clickzetta.com/v1",
        },
      },
    })
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
          baseURL: "https://legacy.clickzetta.com/v1",
        },
      },
    })
    expect(result.warnings).toContain(
      'found deprecated [profiles.default].api_key/aimesh_endpoint; migrate them to [llm.clickzetta]',
    )
  })

  test("uses default_llm to resolve duplicate provider entries", () => {
    const result = parseProfilesToml(`
default_llm = "prod-openai"

[llm.prod-openai]
provider = "openai-compatible"
api_key = "sk-prod"
base_url = "https://prod.example.com/v1"

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
      "openai-compatible": {
        options: {
          apiKey: "sk-prod",
          baseURL: "https://prod.example.com/v1",
        },
      },
    })
    expect(result.warnings).toEqual([])
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
model = "deepseek-v4-pro"
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
          model: "deepseek-v4-pro",
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
