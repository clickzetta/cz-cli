/**
 * Pins the per-model context windows used for ClickZetta gateway models.
 * Run: bun test test/provider/clickzetta-context-limit.test.ts
 *
 * The gateway's /v1/models returns ids only, so every discovered model used to be
 * declared at a flat 128000. Probing the live cn-shanghai gateway showed that
 * single number was wrong in both directions, by up to 7.7x:
 *
 *   qwen/qwen3.6-flash        983616  (upstream rejects above this)
 *   deepseek/deepseek-r1       98304  (BELOW the old default)
 *
 * `limit.context` drives auto-compaction (session/overflow.ts), so under-declaring
 * silently throws away history the model could still hold, and over-declaring means
 * no compaction happens and the upstream rejects the request outright.
 *
 * The expected values here come from the gateway's own rejection messages
 * ("Range of input length should be [1, N]") or the largest prompt observed
 * accepted; they are not re-probed at test time.
 */
import { describe, expect, test } from "bun:test"
import { buildClickzettaModel, clickzettaContextLimit } from "../../src/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"

const FALLBACK = 98_304

describe("clickzettaContextLimit", () => {
  test("verified ceilings are reported per model", () => {
    const verified: Array<[string, number]> = [
      ["deepseek/deepseek-r1", 98_304],
      ["deepseek/deepseek-v3.2", 131_072],
      ["z-ai/glm-4.7", 169_984],
      ["qwen/qwen3-max", 258_048],
      ["moonshotai/kimi-k2.6", 262_144],
      ["qwen/qwen3.6-flash", 983_616],
      ["qwen/qwen3.7-max", 983_616],
    ]
    for (const [id, context] of verified) expect(clickzettaContextLimit(id), id).toBe(context)
  })

  test("the longest matching prefix wins", () => {
    // qwen3.6-flash (983616, probed) and qwen3.6-plus (1000000, from the price list
    // and not probed) share a family but not a window, so a shorter prefix must not
    // shadow a longer one. If 1M turns out wrong for qwen3.6-plus, the table is what
    // to correct — this assertion just mirrors it.
    expect(clickzettaContextLimit("qwen/qwen3.6-flash")).toBe(983_616)
    expect(clickzettaContextLimit("qwen/qwen3.6-plus")).toBe(1_000_000)
    // Same for the deepseek generations.
    expect(clickzettaContextLimit("deepseek/deepseek-r1")).toBe(98_304)
    expect(clickzettaContextLimit("deepseek/deepseek-v3.2")).toBe(131_072)
    expect(clickzettaContextLimit("deepseek/deepseek-v4-pro")).toBe(500_000)
  })

  test("a point release inherits its family's window", () => {
    // Prefixes exist so a new id in a known family does not silently drop to the
    // fallback the day the gateway adds it.
    expect(clickzettaContextLimit("moonshotai/kimi-k2.7")).toBe(262_144)
    // glm-5.9 inherits `z-ai/glm-5` (198000), NOT glm-5.2's 500000 — "5.9" does not
    // start with "5.2", so the newest sibling is irrelevant. Inheriting the family
    // base is the whole point: an unlisted point release gets a real window instead
    // of dropping to the global fallback.
    expect(clickzettaContextLimit("z-ai/glm-5.9")).toBe(198_000)
    expect(clickzettaContextLimit("deepseek/deepseek-v4-turbo")).toBe(500_000)
  })

  test("an unknown model falls back to the smallest measured window", () => {
    // Compacting early is recoverable; overflowing is not. So the fallback is the
    // floor, never a midpoint or an optimistic guess.
    expect(clickzettaContextLimit("brand-new/model-x")).toBe(FALLBACK)
    expect(clickzettaContextLimit("")).toBe(FALLBACK)
    const known = [
      "deepseek/deepseek-r1",
      "deepseek/deepseek-v3.2",
      "z-ai/glm-4.7",
      "qwen/qwen3-max",
      "moonshotai/kimi-k2.6",
      "qwen/qwen3.6-flash",
    ]
    for (const id of known) expect(clickzettaContextLimit(id), id).toBeGreaterThanOrEqual(FALLBACK)
  })

  test("no model is declared at the old flat default", () => {
    // 128000 was the value that made this wrong for every model; if it reappears as
    // an answer, the table has been bypassed.
    for (const id of ["qwen/qwen3.6-flash", "deepseek/deepseek-r1", "unknown/model"]) {
      expect(clickzettaContextLimit(id), id).not.toBe(128_000)
    }
  })
})

describe("buildClickzettaModel", () => {
  const build = (id: string) =>
    buildClickzettaModel(ProviderV2.ID.make("cz"), id, "https://gw.example/gateway/v1", "file:///cz.js")

  test("the model carries its own context window, not a shared constant", () => {
    expect(build("qwen/qwen3.6-flash").limit.context).toBe(983_616)
    expect(build("deepseek/deepseek-r1").limit.context).toBe(98_304)
    // Two models from one gateway must not agree by construction.
    expect(build("qwen/qwen3.6-flash").limit.context).not.toBe(build("deepseek/deepseek-r1").limit.context)
  })

  test("the whole gateway id stays the model id", () => {
    // parseModel splits on the first "/", so the ref stays <entry>/<vendor>/<model>.
    const model = build("deepseek/deepseek-v4-pro")
    // `id` is a branded ModelV2.ID, so compare as a plain string.
    expect(String(model.id)).toBe("deepseek/deepseek-v4-pro")
    expect(model.api.id).toBe("deepseek/deepseek-v4-pro")
    expect(model.family).toBe("deepseek")
  })
})
