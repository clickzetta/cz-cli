# Mixture of Agents (MoA) Port — Design

## Overview

Port the "Mixture of Agents" feature from hermes-agent (Python) into cz-cli (TypeScript). MoA lets a hard task benefit from multiple model perspectives while still running through cz-cli's normal agent loop: tool calls, follow-up iterations, streaming, and the same session context as any other message.

MoA is implemented as a **virtual model provider** named `moa`. Each named preset appears as a selectable model under the `moa` provider, so it is chosen through the existing model-selection surfaces (`/model <preset> --provider moa`, config `model: "moa/<preset>"`, model pickers). Selecting a preset makes the preset's **aggregator** the acting model — the model that writes the assistant response and emits tool calls. **Reference models** run first, in parallel, and provide advisory text for the aggregator to use.

This is the "classic MoA / variant 1" scope: reference models give perspective only. They do NOT execute tools. Only the aggregator, as the acting model, calls tools that the agent loop actually executes.

## Motivation

On hard tasks, aggregating a second model's perspective lifts quality over any single model (hermes reports a two-model MoA preset beating its strongest component by ~6 points on HermesBench). We want the same capability in cz-cli, delivered cheaply and without breaking prompt caching.

Requirements:

1. **Multiple perspectives** — one or more reference models advise before the acting model responds.
2. **Normal agent loop** — the aggregator is a normal acting model: full tool schema, tool execution, iteration, streaming, transcript persistence.
3. **Selected like any model** — MoA presets are picked through the existing model system, not a separate mode/toggle.
4. **Cheap and cache-friendly** — reference calls are short advisory calls; the main conversation's prompt cache is never broken.

## Non-goals

- **Reference tool execution.** References do not run tools. They receive a *text list* of available tools (names + short descriptions) so their advice is tool-aware, but they never emit or execute tool calls. (This is the deliberate boundary of variant 1; multi-agent orchestration where several models each act independently is out of scope — that would be the existing subtask/delegate machinery, not MoA.)
- **A separate aggregator "synthesis" call.** The aggregator ingests the raw reference outputs in one pass as the acting model. No extra model round-trip to pre-synthesize reference advice.
- **Recursive MoA.** A preset's aggregator or reference cannot be another MoA preset.
- **Per-preset temperature knobs.** Reference and aggregator use cz-cli's existing temperature resolution (`ProviderTransform.temperature(model)` / agent temperature), which already handles models where `temperature: false`.

## Architecture context

cz-cli's model call path (relevant files, cz-cli @ e7acfb2eb):

```
provider.getModel(providerID, modelID) → Provider.Model
  → LLM.stream({ model, tools, messages, ... })          packages/opencode/src/session/llm.ts
      → run(): provider.getLanguage(model) → LanguageModelV3
      → streamText({ model: language, tools, messages })   ← the actual model request (llm.ts:356)
```

- The agent loop drives this at `packages/opencode/src/session/processor.ts:754` (`llm.stream(activeStreamInput)`), which is transparent to how the model is resolved.
- Providers are assembled by merging a model database + config + loaders in `provider.ts` (`mergeProvider`, ~line 1244). `Provider.Model` schema is at `provider.ts:996`. `getLanguage` is at `provider.ts:1719`.
- Config is a zod `Info` struct in `packages/opencode/src/config/config.ts:93`. Models are referenced as `provider/model` strings (`model`, `small_model`) and parsed with `parseModel`.
- AI SDK is `ai@6.0.158`. `generateText({ model, system, messages })` accepts a `LanguageModel` instance directly (the same object `getLanguage` returns) and returns `{ text }` — used for non-streaming reference calls.

## Design

### Approach: A2 — virtual provider for selection, mechanism in `llm.ts`

The `moa` provider is registered so selection works through the normal model system (transparent picker/​config UX). The reference fan-out and context injection are performed in `llm.ts`'s `run()`, where `ModelMessage[]`, the resolved `tools`, and the `Provider` service are all in hand. Injecting reference context at the tail of the last user message there is naturally cache-friendly and avoids the AI-SDK-internal prompt format that the `wrapLanguageModel` middleware operates on.

### 1. Config schema

Add an optional `moa` block to the `Info` schema in `config.ts`:

```ts
moa: z.object({
  default_preset: z.string().optional(),
  reference_concurrency: z.number().int().positive().optional(),  // unset ⇒ default 8
  presets: z.record(z.string(), z.object({
    enabled: z.boolean().optional().default(true),
    reference_models: z.array(z.string()).min(1),   // ["openai/gpt-5.5", "openrouter/deepseek/deepseek-v4-pro"]
    aggregator: z.string(),                          // "anthropic/claude-opus-4.8" — the acting model
    max_tokens: z.number().int().positive().optional(),  // unset ⇒ model's own maximum (no hardcoded cap)
  })),
}).optional()
```

Decisions:
- Models are `provider/model` strings (consistent with `model`/`small_model`, reuses `parseModel`).
- `max_tokens` is optional with **no hardcoded default**. Unset means each model uses its own maximum. (hermes's old hardcoded 4096 truncated long output; a hardcoded default is the trap, not the field itself.)
- `reference_concurrency` is top-level (a resource/socket concern, consistent across presets), default 8.
- No per-preset temperature fields (see Non-goals).

### 2. Register `moa` as a virtual provider

In the provider assembly in `provider.ts`, if config has `moa.presets`, synthesize a `moa` provider entry whose models are derived from preset names. Reuse the existing `Info`/`Model` schema (no new types):

```
providers["moa"] = {
  id: "moa",
  name: "Mixture of Agents",
  source: "config",
  models: {
    <presetName>: {
      id: presetName,
      name: `MoA: ${presetName}`,
      ...capabilities-inherited-from-aggregator,
    }
  }
}
```

- **Capabilities inherited from aggregator.** When synthesizing a preset's model, resolve its `aggregator` (`parseModel` → `getModel`) and copy the aggregator's capability-bearing fields (`tool_call`, `temperature`, `limit`, `cost`, reasoning, etc.). The aggregator is the real acting model, so the agent loop's decisions about tool support and temperature are automatically correct.
- **Display name** uses the `MoA: <preset>` prefix so presets are distinguishable in model lists.
- **Recursion guard (registration layer).** If a preset's `aggregator` or any `reference_models` entry points at `moa/*`, drop that slot / reject that preset with a warning.

### 3. Reference fan-out + context injection (mechanism, `llm.ts`)

In `run()`, before constructing `streamText(...)`, if `prepared.model.providerID === "moa"`:

1. **Resolve preset** from config by `prepared.model.id` (the preset name).
2. **`enabled === false`** → skip fan-out; swap `model` to the aggregator's real model and proceed as a plain call (per-preset off switch).
3. Otherwise:

   **Step 1 — resolve real models.** `aggregator` string → `parseModel` → `getModel` → aggregator `Model` + `getLanguage`. Each `reference_models[i]` likewise resolved to its own `Model` + language model. If the aggregator cannot be resolved, **raise a clear error and abort the turn** (naming the preset and the bad model id) — the aggregator is the acting model, so there is no safe degradation.

   **Step 2 — reference conversation view.** From `prepared.request.messages`, keep only user/assistant *text* turns; drop the system prompt, `tool`-role messages, and assistant turns that are purely tool calls. (Advisory calls don't re-bill the system prompt and avoid strict-provider 400s on orphan tool messages.)

   **Step 3 — tool-list injection (variant 1).** Build a short text block listing the currently-available tools (`resolveTools(prepared)`): each tool's name + short description. Put it in the reference's **`system`** string, alongside a brief advisory framing. Reference models get NO tool schema, so they never emit tool calls.

   **Step 4 — parallel references.** `Effect.all(refCalls, { concurrency: cfg.moa?.reference_concurrency ?? 8 })`, where each `refCall = generateText({ model: refLanguage, system, messages: refMessages, maxOutputTokens? })` → take `.text`. **Failure degradation:** a reference that throws is captured as `Reference i — <label>: [failed: <msg>]` and does not abort the turn.

   **Step 5 — synthesize context, inject into aggregator messages.** Join reference outputs:
   ```
   [Mixture of Agents reference context]
   Preset: <name>
   Aggregator/acting model: <agg>
   References: <list>

   Reference 1 — <label>: <text>
   Reference 2 — ...
   ```
   Append this to the **tail of the last user message**. Sitting below the entire stable prefix (system + prior history), it does not invalidate the cached prefix — same cost as any normal new user turn. No extra aggregator synthesis call: the aggregator ingests the raw references directly.

   **Step 6 — aggregator is the acting model.** Set `streamText({...})`'s `model` to the aggregator's language model and `messages` to the injected version. Everything else (`tools`, `toolChoice`, `maxOutputTokens`, streaming, telemetry) is unchanged. The aggregator streams with the full tool schema; its tool calls are executed normally by the agent loop.

### Data flow

```
processor.ts: llm.stream(input)  [model = moa/<preset>]
        │
        ▼
llm.ts run():  providerID === "moa"?
        │ yes
        ├─ resolve preset from config
        ├─ enabled=false ─────────────► use aggregator model directly (plain call)
        │
        ├─ resolve aggregator + reference models (getModel/getLanguage)
        │       └─ aggregator unresolvable ─► ERROR, abort turn
        ├─ build reference view (strip system/tool/tool-call-only)
        ├─ build tool-list text → reference system
        ├─ Effect.all(references, concurrency=N)   [generateText, .text, fail→note]
        ├─ join outputs → append to tail of last user message
        │
        ▼
streamText({ model: aggregatorLanguage, tools, messages: injected, ... })  ← acting model, streams, tool calls executed
```

### 4. Error handling & guards

- **Reference failure** → captured as a `[failed: …]` note; turn continues. All-failed → aggregator still acts (equivalent to no MoA).
- **Aggregator unresolvable** → explicit error, abort turn (config error; no acting model = can't work).
- **Recursion guard** → registration layer rejects `moa/*` slots; mechanism layer re-asserts and throws if one slips through (defense in depth).
- **`getLanguage(moa/*)` called directly** → throws a clear error (`"moa provider models are resolved via aggregator; not directly callable"`). Normal paths never hit this; it is a guard rail.
- **Preset not found** (`moa/<unknown>`) → error listing available preset names.

### 5. Testing

Fake-based unit tests (reuse `packages/opencode/test/fake/provider.ts`, no network):
- **Config:** preset normalization, default preset resolution, recursive slot rejection, `enabled: false` semantics, bad-config degradation.
- **Provider registration:** presets → `moa` provider model list, capabilities inherited from aggregator, `MoA:` prefix.
- **Mechanism:** reference message filtering (system/tool stripped), tool list injected into reference system, parallel fan-out, single-reference failure degradation, injection at tail of last user message, `enabled: false` skips fan-out and uses aggregator directly, aggregator-missing raises.

Real end-to-end test (marked manual / requires real credentials, not in the default CI suite — mirrors hermes's gateway-level tests):
- Configure a preset with multiple real models (e.g. 2 references + 1 aggregator), run one real conversation turn, and verify: references actually fire in parallel and return; context is injected into the aggregator; the aggregator streams with tools and can execute a tool call; `enabled: false` degrades to aggregator-only.

## Reference: hermes source mapped

- `hermes_cli/moa_config.py` — preset normalization, defaults, recursion guard (`_clean_slot`), enable flag.
- `agent/moa_loop.py` — `_reference_messages` (advisory view), `_run_references_parallel` (fan-out + failure degradation), `MoAChatCompletions.create` (inject raw references into last user message, aggregator as acting model).
- `website/docs/user-guide/features/mixture-of-agents.md` — virtual-provider selection model, prompt-cache guarantees, per-preset off switch.
