// cz_change: unit coverage for ClickZetta dynamic model discovery helpers
// (provider.ts). These back the runtime loop that fetches {baseURL}/v1/models for
// every clickzetta gateway provider and merges the result into Provider.list().
import { describe, expect, test } from "bun:test"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { clickzettaModelsUrl, buildClickzettaModel } from "@/provider/provider"

describe("clickzettaModelsUrl", () => {
  test("appends /v1/models when base lacks /v1", () => {
    expect(clickzettaModelsUrl("https://gw.example.com/gateway")).toBe("https://gw.example.com/gateway/v1/models")
  })

  test("does not double the /v1 segment when base already has it", () => {
    expect(clickzettaModelsUrl("https://gw.example.com/gateway/v1")).toBe("https://gw.example.com/gateway/v1/models")
  })

  test("tolerates a trailing slash", () => {
    expect(clickzettaModelsUrl("https://gw.example.com/gateway/v1/")).toBe("https://gw.example.com/gateway/v1/models")
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
