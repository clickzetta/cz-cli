//======================== cz-cli change ========================
// cz_change: the TUI's startup model-selection chain, extracted so a CLI command
// can answer "which model will `cz-cli agent` actually use?" with the same code
// the TUI runs — not a second copy of the rules that drifts from it. Whole file
// is cz-owned (see UPSTREAM-PATCHES.md entry 9).
//
// Previously `cz-cli agent llm show` printed "Default model: automatic (OpenCode
// selects at runtime)" whenever config.model was unset. That was wrong twice
// over: it leaked the upstream brand into cz output, and it implied the outcome
// was indeterminate. It never is — the last tier below is unconditional, so with
// any usable provider the TUI always lands on one concrete model.
//
// The chain lived inline in packages/tui/src/context/local.tsx's `fallbackModel`
// memo. Only the four inputs below were ever read from TUI state, so the logic
// moves out whole; `fallbackModel` now calls this and keeps its memo wrapper.

/** A resolved provider/model pair. Stringly-typed to serve both callers: the TUI
 * holds plain strings from the HTTP API, opencode's services use branded ids. */
export type ModelSelection = {
  providerID: string
  modelID: string
}

/** A provider and the models currently available under it. Shape-compatible with
 * both the TUI's `sync.data.provider` entries and `Provider.toPublicInfo()`. */
export type ModelSelectionProvider = {
  id: string
  models: Readonly<Record<string, unknown>>
}

export type ModelSelectionInput = {
  /** `--model` on the command line. Absent for CLI callers that take no such flag. */
  argsModel?: string
  /** `config.model` — the explicit pin written by `agent llm use`. */
  configModel?: string
  /** Recent selections, newest first, as persisted in state `model.json`. */
  recent?: ReadonlyArray<{ providerID?: unknown; modelID?: unknown }>
  /**
   * Providers in the order the caller received them. Tier 4 takes the first
   * entry, so this order is part of the contract: both callers derive it from
   * `Object.values()` over the same `Provider.list()` record.
   */
  providers: ReadonlyArray<ModelSelectionProvider>
  /** Per-provider preferred model, from `Provider.defaultModelIDs()`. */
  providerDefault?: Readonly<Record<string, string>>
}

/** Which tier produced the result — lets callers explain the choice instead of
 * just printing a name. Mirrors the tier order in `resolveModelSelection`. */
export type ModelSelectionSource = "args" | "config" | "recent" | "first"

export type ResolvedModelSelection = ModelSelection & { source: ModelSelectionSource }

export function parseModelRef(model: string): ModelSelection {
  const [providerID, ...rest] = model.split("/")
  return { providerID, modelID: rest.join("/") }
}

/**
 * Resolve the model a fresh session starts on, in the TUI's own precedence:
 *
 *   1. `--model`, if it names a model that exists
 *   2. `config.model`, if it names a model that exists
 *   3. the newest entry in `recent` that still exists
 *   4. the first provider's preferred model (else its first model)
 *
 * Tiers 1-3 are validated against `providers`, so a pin naming a model the
 * gateway no longer serves falls through rather than resolving to a dead ref.
 *
 * Returns undefined only when no provider has any model at all — the caller's
 * "nothing is configured" case, not an indeterminate one.
 */
export function resolveModelSelection(input: ModelSelectionInput): ResolvedModelSelection | undefined {
  const exists = (providerID: unknown, modelID: unknown): boolean => {
    if (typeof providerID !== "string" || typeof modelID !== "string") return false
    const provider = input.providers.find((item) => item.id === providerID)
    return !!provider && modelID in provider.models
  }

  for (const [source, ref] of [
    ["args", input.argsModel],
    ["config", input.configModel],
  ] as const) {
    if (!ref) continue
    const parsed = parseModelRef(ref)
    if (exists(parsed.providerID, parsed.modelID)) return { ...parsed, source }
  }

  for (const item of input.recent ?? []) {
    if (exists(item?.providerID, item?.modelID)) {
      return { providerID: item.providerID as string, modelID: item.modelID as string, source: "recent" }
    }
  }

  const provider = input.providers[0]
  if (!provider) return undefined
  // `providerDefault` is Provider.defaultModelIDs() — the same priority sort the
  // TUI's /model picker surfaces first. Fall back to insertion order only when a
  // caller has no such map to hand.
  const modelID = input.providerDefault?.[provider.id] ?? Object.keys(provider.models)[0]
  if (!modelID) return undefined
  return { providerID: provider.id, modelID, source: "first" }
}
//====================== end cz-cli change ======================
