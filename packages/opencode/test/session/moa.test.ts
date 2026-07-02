import { test, expect, describe } from "bun:test"
import { parseSlot, normalizeMoAConfig, resolveMoAPreset, DEFAULT_REFERENCE_CONCURRENCY } from "../../src/session/moa"

describe("parseSlot", () => {
  test("splits provider from model on first slash", () => {
    expect(parseSlot("anthropic/claude-opus-4.8")).toEqual({ providerID: "anthropic", modelID: "claude-opus-4.8" })
  })
  test("keeps later slashes in the model id", () => {
    expect(parseSlot("openrouter/deepseek/deepseek-v4-pro")).toEqual({
      providerID: "openrouter",
      modelID: "deepseek/deepseek-v4-pro",
    })
  })
})

describe("normalizeMoAConfig", () => {
  const good = {
    presets: {
      default: {
        reference_models: ["openai/gpt-5.5", "openrouter/deepseek/deepseek-v4-pro"],
        aggregator: "anthropic/claude-opus-4.8",
      },
    },
  }

  test("normalizes a valid preset", () => {
    const cfg = normalizeMoAConfig(good)
    expect(cfg.default_preset).toBe("default")
    expect(cfg.reference_concurrency).toBe(DEFAULT_REFERENCE_CONCURRENCY)
    expect(cfg.presets.default.aggregator).toEqual({ providerID: "anthropic", modelID: "claude-opus-4.8" })
    expect(cfg.presets.default.reference_models).toHaveLength(2)
    expect(cfg.presets.default.enabled).toBe(true)
  })

  test("drops moa/* recursion slots (aggregator)", () => {
    const cfg = normalizeMoAConfig({
      presets: { p: { reference_models: ["openai/gpt-5.5"], aggregator: "moa/other" } },
    })
    expect(cfg.presets.p).toBeUndefined()
  })

  test("drops moa/* reference slots but keeps valid ones", () => {
    const cfg = normalizeMoAConfig({
      presets: { p: { reference_models: ["moa/x", "openai/gpt-5.5"], aggregator: "anthropic/claude-opus-4.8" } },
    })
    expect(cfg.presets.p.reference_models).toEqual([{ providerID: "openai", modelID: "gpt-5.5" }])
  })

  test("drops a preset with no valid references", () => {
    const cfg = normalizeMoAConfig({
      presets: { p: { reference_models: ["moa/x"], aggregator: "anthropic/claude-opus-4.8" } },
    })
    expect(cfg.presets.p).toBeUndefined()
  })

  test("respects enabled:false and custom concurrency + max_tokens", () => {
    const cfg = normalizeMoAConfig({
      reference_concurrency: 3,
      presets: {
        p: {
          enabled: false,
          reference_models: ["openai/gpt-5.5"],
          aggregator: "anthropic/claude-opus-4.8",
          max_tokens: 2048,
        },
      },
    })
    expect(cfg.reference_concurrency).toBe(3)
    expect(cfg.presets.p.enabled).toBe(false)
    expect(cfg.presets.p.max_tokens).toBe(2048)
  })

  test("default_preset falls back to first preset when unset/invalid", () => {
    const cfg = normalizeMoAConfig({ default_preset: "nope", presets: (good as any).presets })
    expect(cfg.default_preset).toBe("default")
  })

  test("bad input degrades to empty presets", () => {
    expect(normalizeMoAConfig(null).presets).toEqual({})
    expect(normalizeMoAConfig(42 as any).presets).toEqual({})
  })
})

describe("resolveMoAPreset", () => {
  test("resolves default when name omitted", () => {
    const cfg = normalizeMoAConfig({
      presets: { default: { reference_models: ["openai/gpt-5.5"], aggregator: "anthropic/claude-opus-4.8" } },
    })
    expect(resolveMoAPreset(cfg).aggregator.modelID).toBe("claude-opus-4.8")
  })
  test("throws with available names when preset missing", () => {
    const cfg = normalizeMoAConfig({
      presets: { default: { reference_models: ["openai/gpt-5.5"], aggregator: "anthropic/claude-opus-4.8" } },
    })
    expect(() => resolveMoAPreset(cfg, "ghost")).toThrow(/not found.*default/)
  })
})
