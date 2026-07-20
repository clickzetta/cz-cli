import { test, expect } from "bun:test"
import path from "path"

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Effect } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"

async function run<A, E>(fn: (provider: Provider.Interface) => Effect.Effect<A, E, never>) {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      return yield* fn(provider)
    }),
  )
}

// A local tool-calling provider used as the MoA aggregator so the test needs no
// real API key. The moa preset's aggregator points at test-agg/agg-model, and
// reference_models needs >=1 non-moa slot to survive normalization.
const CONFIG = {
  $schema: "https://opencode.ai/config.json",
  provider: {
    "test-agg": {
      name: "Test Aggregator",
      npm: "@ai-sdk/openai-compatible",
      env: [],
      models: {
        "agg-model": {
          name: "Aggregator Model",
          tool_call: true,
          limit: { context: 128000, output: 4096 },
        },
      },
      options: { apiKey: "test-key" },
    },
  },
  moa: {
    presets: {
      default: {
        reference_models: ["test-agg/agg-model"],
        aggregator: "test-agg/agg-model",
      },
    },
  },
}

test("moa provider exposes presets as models with MoA: prefix and aggregator capabilities", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify(CONFIG))
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await run((p) => p.list())
      const moa = providers[ProviderID.make("moa")]
      expect(moa).toBeDefined()
      expect(moa.name).toBe("Mixture of Agents")
      const model = moa.models["default"]
      expect(model).toBeDefined()
      expect(model.name).toBe("MoA: default")
      expect(String(model.providerID)).toBe("moa")
      expect(String(model.id)).toBe("default")
      // capability copied from aggregator (test-agg/agg-model has tool_call: true)
      expect(model.capabilities.toolcall).toBe(true)
    },
  })
})

test("getLanguage on a moa model throws (not directly callable)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify(CONFIG))
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // getLanguage throws for moa/* models; the thrown error surfaces as a
      // rejected promise from the runtime (it's a defect on the never-error
      // channel, so Effect.flip does not capture it).
      let message = ""
      try {
        await run((p) =>
          p.getModel(ProviderID.make("moa"), ModelID.make("default")).pipe(Effect.flatMap((m) => p.getLanguage(m))),
        )
      } catch (e) {
        message = String(e)
      }
      expect(message).toMatch(/moa.*aggregator|not directly callable/i)
    },
  })
})
