//======================== cz-cli change ========================
// cz_change: unit coverage for the extracted model-selection chain (UPSTREAM-PATCHES.md entry 9)
import { describe, expect, test } from "bun:test"
import { parseModelRef, resolveModelSelection, type ModelSelectionProvider } from "@opencode-ai/core/model-selection"

const providers: ModelSelectionProvider[] = [
  { id: "anthropic", models: { "claude-1": {}, "claude-2": {} } },
  { id: "openai", models: { "gpt-4": {} } },
]

describe("parseModelRef", () => {
  test("splits on the first slash, keeping the rest as the model id", () => {
    expect(parseModelRef("clickzetta/deepseek/deepseek-v4")).toEqual({
      providerID: "clickzetta",
      modelID: "deepseek/deepseek-v4",
    })
  })
})

describe("resolveModelSelection", () => {
  test("tier 1: argsModel wins when it names an existing model", () => {
    expect(
      resolveModelSelection({ argsModel: "openai/gpt-4", configModel: "anthropic/claude-1", providers }),
    ).toEqual({ providerID: "openai", modelID: "gpt-4", source: "args" })
  })

  test("falls through argsModel to configModel when argsModel names a dead ref", () => {
    expect(
      resolveModelSelection({ argsModel: "openai/gpt-9-does-not-exist", configModel: "anthropic/claude-1", providers }),
    ).toEqual({ providerID: "anthropic", modelID: "claude-1", source: "config" })
  })

  test("tier 3: newest still-existing entry in recent, skipping dead refs", () => {
    expect(
      resolveModelSelection({
        recent: [
          { providerID: "openai", modelID: "gpt-3-retired" },
          { providerID: "anthropic", modelID: "claude-2" },
        ],
        providers,
      }),
    ).toEqual({ providerID: "anthropic", modelID: "claude-2", source: "recent" })
  })

  test("tier 4: first provider's preferred model from providerDefault", () => {
    expect(
      resolveModelSelection({ providers, providerDefault: { anthropic: "claude-2" } }),
    ).toEqual({ providerID: "anthropic", modelID: "claude-2", source: "first" })
  })

  test("tier 4 without providerDefault falls back to the first provider's first model", () => {
    expect(resolveModelSelection({ providers })).toEqual({ providerID: "anthropic", modelID: "claude-1", source: "first" })
  })

  // The one case this resolver treats as genuinely unresolved, not indeterminate:
  // no provider has any model at all.
  test("returns undefined only when no provider has any model", () => {
    expect(resolveModelSelection({ providers: [{ id: "anthropic", models: {} }] })).toBeUndefined()
    expect(resolveModelSelection({ providers: [] })).toBeUndefined()
  })
})
