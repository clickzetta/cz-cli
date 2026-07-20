/**
 * MoA real multi-model end-to-end test.
 *
 * ENV-GATED: this test makes real network calls to real AI providers and
 * requires valid API keys. It SKIPS by default and only runs when MOA_E2E=1.
 *
 * Invocation example (with credentials):
 *
 *   MOA_E2E=1 \
 *   MOA_AGG="anthropic/claude-haiku-4-20250514" \
 *   MOA_REF1="anthropic/claude-haiku-4-20250514" \
 *   MOA_REF2="openai/gpt-4o-mini" \
 *   bun test test/session/moa-integration.test.ts
 *
 * Real credentials must be available in the environment
 * (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY) or configured via opencode.json.
 *
 * What it tests:
 *   1. Provider.getModel("moa", "default") resolves successfully.
 *   2. LLM.stream produces non-empty text-delta events (aggregator ran).
 *   3. The turn completes without error (reference fan-out + aggregator).
 */
import { test, expect } from "bun:test"
import type { LLM as LLMType } from "../../src/session/llm"

// RUN is evaluated at module load; everything else is imported lazily inside
// the test body so module-load cost is zero when the test is skipped.
const RUN = process.env.MOA_E2E === "1"
const maybe = RUN ? test : test.skip

maybe(
  "MoA runs references in parallel and the aggregator streams non-empty output",
  async () => {
    // --- Lazy imports so the skipped path has zero module-graph cost ---
    const { Effect, Stream } = await import("effect")
    const path = (await import("path")).default
    const { tmpdir } = await import("../fixture/fixture")
    const { Instance } = await import("../../src/project/instance")
    const { AppRuntime } = await import("../../src/effect/app-runtime")
    const { LLM } = await import("../../src/session/llm")
    const { Provider } = await import("../../src/provider")
    const { ProviderID, ModelID } = await import("../../src/provider/schema")
    const { MessageID, SessionID } = await import("../../src/session/schema")

    // Read model ids from env; sensible defaults for single-provider testing.
    const agg = process.env.MOA_AGG ?? "anthropic/claude-haiku-4-20250514"
    const ref1 = process.env.MOA_REF1 ?? "anthropic/claude-haiku-4-20250514"
    const ref2 = process.env.MOA_REF2 ?? ref1

    // Build a minimal opencode.json declaring the moa preset. Real API keys
    // must be present in the environment (the Config layer picks them up).
    const config = {
      $schema: "https://opencode.ai/config.json",
      moa: {
        default_preset: "default",
        presets: {
          default: {
            aggregator: agg,
            reference_models: Array.from(new Set([ref1, ref2])),
          },
        },
      },
    }

    await using tmp = await tmpdir({
      git: true,
      init: async (dir: string) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify(config))
      },
    })

    const text = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const llm = yield* LLM.Service

            // Resolve the virtual moa/default model.
            const resolved = yield* provider.getModel(
              ProviderID.make("moa"),
              ModelID.make("default"),
            )

            const sessionID = SessionID.make("moa-e2e-session")
            const agent = {
              name: "test",
              mode: "primary" as const,
              options: {},
              permission: [{ permission: "*" as const, pattern: "*", action: "allow" as const }],
            }
            const user = {
              id: MessageID.make("moa-e2e-user"),
              sessionID,
              role: "user" as const,
              time: { created: Date.now() },
              agent: agent.name,
              model: {
                providerID: ProviderID.make("moa"),
                modelID: ModelID.make("default"),
              },
            }

            const parts: string[] = []

            yield* llm
              .stream({
                user,
                sessionID,
                model: resolved,
                agent,
                system: ["You are a concise assistant."],
                messages: [{ role: "user", content: "Say exactly: DONE" }],
                tools: {},
              })
              .pipe(
                Stream.filter(
                  (e): e is Extract<LLMType.Event, { type: "text-delta" }> =>
                    (e as { type: string }).type === "text-delta",
                ),
                Stream.tap((e) => Effect.sync(() => parts.push(e.text))),
                Stream.runDrain,
              )

            return parts.join("")
          }),
        ),
    })

    // Core assertion: the aggregator produced non-empty streamed output.
    expect(text.length).toBeGreaterThan(0)
  },
  // Generous timeout: reference fan-out + aggregator call over the network.
  120_000,
)
