import { describe, expect, test } from "bun:test"
import {
  resolveDefaultModel,
  type ProviderShape,
  type ModelRef,
} from "../../src/provider/model-resolution"

function provider(id: string, models: string[]): ProviderShape {
  return {
    id,
    models: Object.fromEntries(models.map((m) => [m, {}])),
  }
}

function providerMap(...providers: ProviderShape[]): Record<string, ProviderShape> {
  return Object.fromEntries(providers.map((p) => [p.id, p]))
}

// Pick the first model id deterministically. Each test verifies the resolver,
// not the picking policy, so a trivial picker keeps assertions readable.
const firstModel = (p: ProviderShape) => Object.keys(p.models)[0]

describe("resolveDefaultModel", () => {
  test("explicit cliModel beats everything else", () => {
    const result = resolveDefaultModel({
      cliModel: "clickzetta/deepseek/deepseek-v4-pro",
      configModel: "openai-compatible/gpt-5.5",
      defaultLlmEntry: "my-relay",
      llmEntries: [{ name: "my-relay", provider: "openai-compatible", model: "gpt-5.5" }],
      providers: providerMap(
        provider("clickzetta", ["deepseek/deepseek-v4-pro"]),
        provider("openai-compatible", ["gpt-5.5"]),
      ),
      recent: [],
      pickBest: firstModel,
    })

    expect(result).toEqual({
      providerID: "clickzetta",
      modelID: "deepseek/deepseek-v4-pro",
      source: "cli",
    })
  })

  test("invalid cliModel falls through to configModel when trustExplicit=false", () => {
    const result = resolveDefaultModel({
      cliModel: "ghost/missing",
      configModel: "clickzetta/deepseek/deepseek-v4-pro",
      providers: providerMap(provider("clickzetta", ["deepseek/deepseek-v4-pro"])),
      recent: [],
      pickBest: firstModel,
      trustExplicit: false,
    })

    expect(result?.source).toBe("config")
    expect(result?.providerID).toBe("clickzetta")
  })

  test("invalid cliModel is trusted by default (agent-run semantics)", () => {
    // The agent-run path trusts whatever the user passed and lets the LLM
    // request fail naturally if the model id is wrong, rather than silently
    // swapping in a different model.
    const result = resolveDefaultModel({
      cliModel: "ghost/missing",
      configModel: "clickzetta/deepseek/deepseek-v4-pro",
      providers: providerMap(provider("clickzetta", ["deepseek/deepseek-v4-pro"])),
      recent: [],
      pickBest: firstModel,
    })

    expect(result?.source).toBe("cli")
    expect(result?.providerID).toBe("ghost")
  })

  test("default_llm entry with explicit model resolves via entry-default", () => {
    // When default_llm is set, the entry-default path resolves the model
    // directly (using the entry's model field) and takes precedence over
    // configModel.
    const result = resolveDefaultModel({
      configModel: "clickzetta/deepseek/deepseek-v4-pro",
      defaultLlmEntry: "clickzetta",
      llmEntries: [
        { name: "clickzetta", provider: "clickzetta", model: "deepseek/deepseek-v4-pro" },
      ],
      providers: providerMap(provider("clickzetta", ["deepseek/deepseek-v4-pro"])),
      recent: [],
      pickBest: firstModel,
    })

    expect(result).toEqual({
      providerID: "clickzetta",
      modelID: "deepseek/deepseek-v4-pro",
      source: "entry-default",
    })
  })

  test("default_llm entry without model picks provider's best", () => {
    const result = resolveDefaultModel({
      defaultLlmEntry: "clickzetta",
      llmEntries: [{ name: "clickzetta", provider: "clickzetta" }],
      providers: providerMap(
        provider("clickzetta", ["qwen/qwen3-max", "deepseek/deepseek-v4-pro"]),
      ),
      recent: [],
      pickBest: firstModel,
    })

    expect(result).toEqual({
      providerID: "clickzetta",
      modelID: "qwen/qwen3-max",
      source: "entry-default",
    })
  })

  test("default_llm entry without model returns the entry-named provider id", () => {
    const result = resolveDefaultModel({
      defaultLlmEntry: "team-a",
      llmEntries: [{ name: "team-a", provider: "clickzetta" }],
      providers: providerMap(provider("team-a", ["deepseek/deepseek-v4-pro"])),
      recent: [],
      pickBest: firstModel,
    })

    expect(result).toEqual({
      providerID: "team-a",
      modelID: "deepseek/deepseek-v4-pro",
      source: "entry-default",
    })
  })

  test("default_llm set: recent from another provider is ignored", () => {
    const recent: ModelRef[] = [{ providerID: "openai-compatible", modelID: "gpt-5.5" }]
    const result = resolveDefaultModel({
      defaultLlmEntry: "clickzetta",
      llmEntries: [
        { name: "clickzetta", provider: "clickzetta" },
        { name: "my-relay", provider: "openai-compatible", model: "gpt-5.5" },
      ],
      providers: providerMap(
        provider("clickzetta", ["deepseek/deepseek-v4-pro"]),
        provider("openai-compatible", ["gpt-5.5"]),
      ),
      recent,
      pickBest: firstModel,
    })

    expect(result?.source).toBe("entry-default")
    expect(result?.providerID).toBe("clickzetta")
  })

  test("default_llm set: recent from same provider is also ignored", () => {
    // Once default_llm is set, recent is irrelevant. The resolver always picks
    // the entry-default (or the configured model on the entry).
    const recent: ModelRef[] = [{ providerID: "clickzetta", modelID: "deepseek/deepseek-v4-pro" }]
    const result = resolveDefaultModel({
      defaultLlmEntry: "clickzetta",
      llmEntries: [{ name: "clickzetta", provider: "clickzetta" }],
      providers: providerMap(
        provider("clickzetta", ["qwen/qwen3-max", "deepseek/deepseek-v4-pro"]),
      ),
      recent,
      pickBest: firstModel,
    })

    expect(result?.source).toBe("entry-default")
    expect(result?.modelID).toBe("qwen/qwen3-max")
  })

  test("no default_llm: recent is honored", () => {
    const result = resolveDefaultModel({
      providers: providerMap(
        provider("clickzetta", ["deepseek/deepseek-v4-pro"]),
        provider("openai-compatible", ["gpt-5.5"]),
      ),
      recent: [{ providerID: "openai-compatible", modelID: "gpt-5.5" }],
      pickBest: firstModel,
    })

    expect(result).toEqual({
      providerID: "openai-compatible",
      modelID: "gpt-5.5",
      source: "recent",
    })
  })

  test("no default_llm, no recent: first allowed provider wins", () => {
    const result = resolveDefaultModel({
      providers: providerMap(
        provider("clickzetta", ["deepseek/deepseek-v4-pro"]),
        provider("openai-compatible", ["gpt-5.5"]),
      ),
      recent: [],
      allowedProviderIds: ["clickzetta"],
      pickBest: firstModel,
    })

    expect(result?.source).toBe("fallback")
    expect(result?.providerID).toBe("clickzetta")
  })

  test("invalid recent entries are skipped", () => {
    const result = resolveDefaultModel({
      providers: providerMap(provider("clickzetta", ["deepseek/deepseek-v4-pro"])),
      recent: [
        { providerID: "ghost", modelID: "x" },
        { providerID: "clickzetta", modelID: "missing" },
        { providerID: "clickzetta", modelID: "deepseek/deepseek-v4-pro" },
      ],
      pickBest: firstModel,
    })

    expect(result?.source).toBe("recent")
    expect(result?.modelID).toBe("deepseek/deepseek-v4-pro")
  })

  test("default_llm pointing at unknown provider falls back globally", () => {
    const result = resolveDefaultModel({
      defaultLlmEntry: "missing",
      llmEntries: [{ name: "missing", provider: "ghost" }],
      providers: providerMap(provider("clickzetta", ["deepseek/deepseek-v4-pro"])),
      recent: [],
      pickBest: firstModel,
    })

    expect(result?.source).toBe("fallback")
    expect(result?.providerID).toBe("clickzetta")
  })

  test("returns undefined when no providers are available", () => {
    const result = resolveDefaultModel({
      providers: {},
      recent: [],
      pickBest: firstModel,
    })

    expect(result).toBeUndefined()
  })

  test("entry model that no longer exists in provider falls back to pickBest", () => {
    // Defensive: the entry references a stale model id (provider catalog
    // changed). Resolver should not crash; it falls through to pickBest.
    const result = resolveDefaultModel({
      defaultLlmEntry: "clickzetta",
      llmEntries: [{ name: "clickzetta", provider: "clickzetta", model: "stale-model" }],
      providers: providerMap(provider("clickzetta", ["deepseek/deepseek-v4-pro"])),
      recent: [],
      pickBest: firstModel,
    })

    expect(result).toEqual({
      providerID: "clickzetta",
      modelID: "deepseek/deepseek-v4-pro",
      source: "entry-default",
    })
  })

  test("multi-slash model ids in configModel are parsed correctly", () => {
    // Provider IDs do not contain slashes; the first slash separates provider
    // from model id. Model ids may contain further slashes (e.g. "deepseek/v4").
    const result = resolveDefaultModel({
      configModel: "clickzetta/deepseek/deepseek-v4-pro",
      providers: providerMap(provider("clickzetta", ["deepseek/deepseek-v4-pro"])),
      recent: [],
      pickBest: firstModel,
    })

    expect(result).toEqual({
      providerID: "clickzetta",
      modelID: "deepseek/deepseek-v4-pro",
      source: "config",
    })
  })
})
