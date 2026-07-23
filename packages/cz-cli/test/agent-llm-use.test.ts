import { beforeEach, describe, expect, test } from "bun:test"
import {
  clearActiveModel,
  readLlmConfig,
  setActiveModel,
  validateModelRef,
  writeLlmEntries,
} from "../src/llm/native-config.js"

// Covers the `agent llm use <model>` contract (replacing the removed default_llm):
// validateModelRef is the pure guard the command runs before setActiveModel writes
// opencode's native config.model. The command handler itself delegates to the
// agent runtime (execute() can't drive it), so we exercise the shared logic here.

const ENTRIES = {
  "my-openai": { provider: "openai", api_key: "sk-o" },
  clickzetta: {
    provider: "clickzetta",
    api_key: "ck",
    base_url: "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1",
  },
}

beforeEach(() => {
  writeLlmEntries({ llm: { ...ENTRIES } })
  clearActiveModel()
})

describe("validateModelRef", () => {
  test("accepts a plain <entry>/<model> ref for a defined entry", () => {
    expect(validateModelRef("my-openai/gpt-4o", ENTRIES)).toEqual({ ok: true, entry: "my-openai" })
  })

  test("accepts a vendor-prefixed clickzetta ref (whole tail is the modelId)", () => {
    // parseModel splits on the FIRST "/", so entry=clickzetta and the rest stays intact.
    expect(validateModelRef("clickzetta/deepseek/deepseek-v4-pro", ENTRIES)).toEqual({
      ok: true,
      entry: "clickzetta",
    })
  })

  test("rejects a bare provider name (no slash → empty modelID in opencode)", () => {
    expect(validateModelRef("my-openai", ENTRIES)).toEqual({ ok: false, code: "INVALID_MODEL_REF" })
  })

  test("rejects an undefined entry", () => {
    expect(validateModelRef("ghost/some-model", ENTRIES)).toEqual({
      ok: false,
      code: "NOT_FOUND",
      entry: "ghost",
    })
  })
})

describe("use → setActiveModel round-trip", () => {
  test("pins config.model to the full ref, preserving a vendor-prefixed id", () => {
    setActiveModel("clickzetta/deepseek/deepseek-v4-pro")
    expect(readLlmConfig().model).toBe("clickzetta/deepseek/deepseek-v4-pro")
  })

  test("clearActiveModel unsets config.model so opencode auto-selects", () => {
    setActiveModel("my-openai/gpt-4o")
    expect(readLlmConfig().model).toBe("my-openai/gpt-4o")
    clearActiveModel()
    expect(readLlmConfig().model).toBeUndefined()
  })
})
