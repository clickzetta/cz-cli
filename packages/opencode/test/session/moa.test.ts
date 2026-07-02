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

import type { ModelMessage } from "ai"
import { referenceMessages, toolListText, referenceSystemPrompt, synthesizeContext, injectContext } from "../../src/session/moa"

describe("referenceMessages", () => {
  test("keeps user/assistant text, drops system and tool roles", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "SYS" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "1", toolName: "x", output: { type: "text", value: "r" } }] } as any,
    ]
    const out = referenceMessages(msgs)
    expect(out).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ])
  })

  test("drops assistant turns that are pure tool calls (no text)", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "do it" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "1", toolName: "bash", input: {} }] } as any,
    ]
    expect(referenceMessages(msgs)).toEqual([{ role: "user", content: "do it" }])
  })

  test("extracts text parts from array assistant content", () => {
    const msgs: ModelMessage[] = [
      { role: "assistant", content: [{ type: "text", text: "thinking" }, { type: "tool-call", toolCallId: "1", toolName: "b", input: {} }] } as any,
    ]
    expect(referenceMessages(msgs)).toEqual([{ role: "assistant", content: "thinking" }])
  })
})

describe("toolListText / referenceSystemPrompt", () => {
  test("renders bullet list of tools", () => {
    const t = toolListText([{ name: "bash", description: "Run a shell command" }, { name: "read" }])
    expect(t).toContain("bash")
    expect(t).toContain("Run a shell command")
    expect(t).toContain("read")
  })
  test("empty tools ⇒ empty string", () => {
    expect(toolListText([])).toBe("")
  })
  test("system prompt embeds the tool list", () => {
    const sys = referenceSystemPrompt(toolListText([{ name: "bash", description: "shell" }]))
    expect(sys).toContain("bash")
    expect(sys.toLowerCase()).toContain("tool")
  })
})

describe("synthesizeContext / injectContext", () => {
  const ctx = synthesizeContext({
    preset: "default",
    aggregatorLabel: "anthropic/claude-opus-4.8",
    referenceLabels: ["openai/gpt-5.5"],
    outputs: [{ label: "openai/gpt-5.5", text: "use grep first" }],
  })

  test("context block contains preset, aggregator, and reference output", () => {
    expect(ctx).toContain("Mixture of Agents reference context")
    expect(ctx).toContain("default")
    expect(ctx).toContain("anthropic/claude-opus-4.8")
    expect(ctx).toContain("Reference 1")
    expect(ctx).toContain("use grep first")
  })

  test("injects at tail of last user message", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second" },
    ]
    const out = injectContext(msgs, "CTX")
    expect(out[2].content).toBe("second\n\nCTX")
    expect(msgs[2].content).toBe("second") // original not mutated
  })

  test("appends a user message when none present", () => {
    const out = injectContext([{ role: "assistant", content: "x" }], "CTX")
    expect(out[out.length - 1]).toEqual({ role: "user", content: "CTX" })
  })
})
