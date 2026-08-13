// cz_change: unit coverage for ClickZetta dynamic model discovery helpers
// (provider.ts). These back the runtime loop that fetches {baseURL}/models for
// every clickzetta gateway provider and merges the result into Provider.list().
import { describe, expect, test } from "bun:test"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { clickzettaModelsUrl, buildClickzettaModel, CLICKZETTA_FALLBACK_MODELS } from "@/provider/provider"

describe("clickzettaModelsUrl", () => {
  test("appends /models to the normalized runtime base", () => {
    expect(clickzettaModelsUrl("https://gw.example.com/gateway/v1")).toBe("https://gw.example.com/gateway/v1/models")
  })

  test("tolerates a trailing slash", () => {
    expect(clickzettaModelsUrl("https://gw.example.com/gateway/v1/")).toBe("https://gw.example.com/gateway/v1/models")
  })

  // This helper does NOT normalize — it only trims and appends. It relies on the cz
  // layer sending a base that already carries /gateway/vN (bootstrap/runtime-config.ts
  // providerNpmStubs). That contract was broken once: the stub carried only `npm`, so
  // opencode read llm.json's raw base_url, and a bare host — the shape
  // `ai-gateway --add-to-llm` writes — produced `{host}/models`. The gateway answers
  // that with 400 `40101 Invalid API key`, blaming the credential for a path bug, and
  // the entry ended up with a single phantom fallback model instead of the catalog.
  // Pinning the un-normalized inputs here so a regression on either side is visible:
  // if these ever start returning /gateway/v1 URLs, normalization moved into this
  // function and the cz-side injection can be reconsidered.
  test("does NOT normalize — a base without /gateway is passed through as-is", () => {
    expect(clickzettaModelsUrl("https://gw.example.com")).toBe("https://gw.example.com/models")
    expect(clickzettaModelsUrl("https://gw.example.com/v1")).toBe("https://gw.example.com/v1/models")
  })
})

describe("buildClickzettaModel", () => {
  const providerID = ProviderV2.ID.make("clickzetta")

  test("keeps the vendor-prefixed id intact as the modelID (no double prefix)", () => {
    const m = buildClickzettaModel(providerID, "deepseek/deepseek-v4-pro", "https://gw/gateway/v1", "file:///pkg")
    // parseModel later splits on the first "/", so the full ref clickzetta/deepseek/…
    // resolves to providerID=clickzetta, modelID=deepseek/deepseek-v4-pro.
    expect(String(m.id)).toBe("deepseek/deepseek-v4-pro")
    expect(String(m.providerID)).toBe("clickzetta")
    expect(m.api.id).toBe("deepseek/deepseek-v4-pro")
  })

  test("derives family from the vendor segment", () => {
    expect(buildClickzettaModel(providerID, "qwen/qwen3.6-flash", "https://gw", "npm").family).toBe("qwen")
    expect(buildClickzettaModel(providerID, "gpt-5.5", "https://gw", "npm").family).toBe("")
  })

  test("inherits the provider npm so the file:// specifier reaches the SDK loader", () => {
    const npm = "file:///abs/clickzetta-ai-gateway.js"
    expect(buildClickzettaModel(providerID, "openai/gpt-5.5", "https://gw", npm).api.npm).toBe(npm)
  })

  test("uses conservative defaults (cost 0, tool calls on) since /v1/models has no metadata", () => {
    const m = buildClickzettaModel(providerID, "openai/gpt-5.5", "https://gw", "npm")
    expect(m.cost).toEqual({ input: 0, output: 0, cache: { read: 0, write: 0 } })
    expect(m.capabilities.toolcall).toBe(true)
    expect(m.status).toBe("active")
  })
})

// A provider whose model table is empty is deleted by the loop right after
// discovery, taking the entry out of `/model` with no error to act on — including
// the billing error that would explain a 403ing gateway. The fallback exists to
// keep that entry reachable; these pin the contract it depends on.
describe("CLICKZETTA_FALLBACK_MODELS", () => {
  const providerID = ProviderV2.ID.make("clickzetta")

  test("is non-empty, so a zero-model provider is never left to be deleted", () => {
    expect(CLICKZETTA_FALLBACK_MODELS.length).toBeGreaterThan(0)
  })

  test("holds only vendor-prefixed gateway ids, which parseModel keeps intact", () => {
    for (const modelID of CLICKZETTA_FALLBACK_MODELS) {
      expect(modelID).toMatch(/^[a-z0-9-]+\/[A-Za-z0-9._-]+$/)
      // The whole string stays the modelID: <entry>/<vendor>/<model> resolves back
      // with no double prefix, same as a discovered id.
      expect(String(buildClickzettaModel(providerID, modelID, "https://gw/gateway/v1", "npm").id)).toBe(modelID)
    }
  })

  test("has no duplicates, so seeding cannot silently drop an entry", () => {
    expect(new Set(CLICKZETTA_FALLBACK_MODELS).size).toBe(CLICKZETTA_FALLBACK_MODELS.length)
  })

  test("index 0 is the id a fresh session auto-selects", () => {
    // Pinned deliberately: opencode picks the first available model when nothing is
    // configured, so reordering this list changes what users land on.
    expect(CLICKZETTA_FALLBACK_MODELS[0]).toBe("deepseek/deepseek-v4-pro")
  })
})
