import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { setTimeout as sleep } from "node:timers/promises"
import { parse as parseToml } from "smol-toml"
import { persistDefaultLlmModel, setDefaultLlmModel, watchCurrentProfileLabel } from "../../src/config/profiles-llm"

describe("setDefaultLlmModel", () => {
  test("updates the selected default_llm entry model", () => {
    const data = parseToml(`
default_llm = "codzen"

[llm.codzen]
provider = "openai-compatible"
api_key = "sk-codzen"
base_url = "https://codzen.ai/v1"
model = "glm-5.1"
`) as Record<string, unknown>

    const changed = setDefaultLlmModel(data, "glm-5.2")

    expect(changed).toBe(true)
    expect(data).toEqual({
      default_llm: "codzen",
      llm: {
        codzen: {
          provider: "openai-compatible",
          api_key: "sk-codzen",
          base_url: "https://codzen.ai/v1",
          model: "glm-5.2",
        },
      },
    })
  })

  test("does nothing when default_llm is missing", () => {
    const data = parseToml(`
[llm.codzen]
provider = "openai-compatible"
api_key = "sk-codzen"
model = "glm-5.1"
`) as Record<string, unknown>

    const changed = setDefaultLlmModel(data, "glm-5.2")

    expect(changed).toBe(false)
    expect(data).toEqual({
      llm: {
        codzen: {
          provider: "openai-compatible",
          api_key: "sk-codzen",
          model: "glm-5.1",
        },
      },
    })
  })

  test("does nothing when default_llm entry is missing", () => {
    const data = parseToml(`
default_llm = "codzen"

[llm.other]
provider = "openai-compatible"
api_key = "sk-other"
model = "glm-5.1"
`) as Record<string, unknown>

    const changed = setDefaultLlmModel(data, "glm-5.2")

    expect(changed).toBe(false)
    expect(data).toEqual({
      default_llm: "codzen",
      llm: {
        other: {
          provider: "openai-compatible",
          api_key: "sk-other",
          model: "glm-5.1",
        },
      },
    })
  })

  test("persists the model into profiles.toml for the default llm entry", async () => {
    const clickzettaDir = path.join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta")
    const profilesPath = path.join(clickzettaDir, "profiles.toml")
    await fs.mkdir(clickzettaDir, { recursive: true })
    await fs.writeFile(
      profilesPath,
      [
        'default_llm = "codzen"',
        "",
        "[llm.codzen]",
        'provider = "openai-compatible"',
        'api_key = "sk-codzen"',
        'base_url = "https://codzen.ai/v1"',
        'model = "glm-5.1"',
        "",
      ].join("\n"),
    )

    const changed = persistDefaultLlmModel("glm-5.2")

    expect(changed).toBe(true)
    expect(await fs.readFile(profilesPath, "utf-8")).toContain('model = "glm-5.2"')
  })

  test("watches default_profile changes from profiles.toml", async () => {
    const clickzettaDir = path.join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta")
    const profilesPath = path.join(clickzettaDir, "profiles.toml")
    await fs.mkdir(clickzettaDir, { recursive: true })
    await fs.writeFile(
      profilesPath,
      [
        'default_profile = "default"',
        "",
        "[profiles.default]",
        'workspace = "quick_start"',
        "",
      ].join("\n"),
    )

    const seen: string[] = []
    const stop = watchCurrentProfileLabel((label) => {
      seen.push(label)
    }, 10)

    try {
      await fs.writeFile(
        profilesPath,
        [
          'default_profile = "uat_new"',
          "",
          "[profiles.uat_new]",
          'workspace = "quick_start"',
          "",
        ].join("\n"),
      )

      for (let i = 0; i < 50; i++) {
        if (seen.includes("uat_new")) break
        await sleep(20)
      }

      expect(seen).toContain("uat_new")
    } finally {
      stop()
    }
  })
})
