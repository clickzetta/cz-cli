import type { LlmEntry } from "../config/profiles-llm"

export interface ResolveInput {
  // Highest-priority sources, evaluated in order.
  cliModel?: string
  configModel?: string

  // LLM entry context.
  defaultLlmEntry?: string
  llmEntries?: LlmEntry[]

  // Available providers known to the runtime, keyed by provider id.
  // Each provider must expose its model ids; pickBest is what selects one.
  providers: Record<string, ProviderShape>

  // Recent-history file (model.json). Already validated upstream.
  recent: ModelRef[]

  // Optional restriction on which providers count as fallback candidates.
  // For provider.ts this maps to cfg.provider keys. TUI passes nothing.
  allowedProviderIds?: string[]

  // Returns the best model id from a provider, or undefined if none qualifies.
  // Each call site brings its own policy (priority list, deprecated filter, etc.).
  pickBest: (provider: ProviderShape) => string | undefined

  // When true (default), cliModel and configModel are returned as-is without
  // checking that the model exists in the runtime provider catalog. The agent-run
  // path uses this because the catalog may not have caught up with custom models
  // and silently downgrading would surprise the user. The TUI sets this to false
  // because an invalid stored model should fall through to a usable default
  // rather than render a broken state.
  trustExplicit?: boolean
}

export interface ProviderShape {
  id: string
  models: Record<string, unknown>
}

export interface ModelRef {
  providerID: string
  modelID: string
}

export type ResolutionSource = "cli" | "config" | "entry-default" | "recent" | "fallback"

export interface ResolutionResult extends ModelRef {
  source: ResolutionSource
}

/**
 * Single source of truth for picking a default model.
 *
 * Priority:
 *  1. cliModel (explicit --model on the command line)
 *  2. configModel (cfg.model — auto-derived when default_llm entry has a model field)
 *  3. default_llm entry's provider best model (when entry has no model field)
 *  4. recent history (model.json) — only when no default_llm is set
 *  5. any allowed provider's best model
 *
 * cliModel and configModel are trusted as-is — they represent explicit user
 * intent. The runtime catalog may not yet have learned about a custom model,
 * and validating against it would silently downgrade to the wrong model.
 *
 * When default_llm is set, recent history is ignored entirely. The user has
 * stated an explicit preference; recalling the last-used model from a different
 * LLM would silently override that preference.
 */
export function resolveDefaultModel(input: ResolveInput): ResolutionResult | undefined {
  const trust = input.trustExplicit ?? true

  const cliRef = parseRef(input.cliModel)
  if (cliRef && (trust || isValid(cliRef, input.providers))) {
    return { ...cliRef, source: "cli" }
  }

  const defaultEntry = input.defaultLlmEntry
    ? input.llmEntries?.find((e) => e.name === input.defaultLlmEntry)
    : undefined

  if (defaultEntry) {
    // Providers are keyed by entry name — look up by name, not provider type.
    const provider = input.providers[defaultEntry.name]
    if (provider) {
      const modelID = defaultEntry.model && provider.models[defaultEntry.model]
        ? defaultEntry.model
        : input.pickBest(provider)
      if (modelID) {
        return { providerID: provider.id, modelID, source: "entry-default" }
      }
    }
    // Default LLM points at an unknown provider — fall through to last-resort
    // fallback rather than honoring recent history (which would cross provider).
    return fallback(input, "fallback")
  }

  const configRef = parseRef(input.configModel)
  if (configRef && (trust || isValid(configRef, input.providers))) {
    return { ...configRef, source: "config" }
  }

  for (const ref of input.recent) {
    if (isValid(ref, input.providers)) {
      return { ...ref, source: "recent" }
    }
  }

  return fallback(input, "fallback")
}

function parseRef(model: string | undefined): ModelRef | undefined {
  if (!model) return undefined
  const slash = model.indexOf("/")
  if (slash <= 0 || slash === model.length - 1) return undefined
  return {
    providerID: model.slice(0, slash),
    modelID: model.slice(slash + 1),
  }
}

function isValid(ref: ModelRef, providers: Record<string, ProviderShape>): boolean {
  const provider = providers[ref.providerID]
  if (!provider) return false
  return ref.modelID in provider.models
}

function fallback(input: ResolveInput, source: ResolutionSource): ResolutionResult | undefined {
  const candidates = Object.values(input.providers).filter((p) => {
    if (!input.allowedProviderIds) return true
    return input.allowedProviderIds.includes(p.id)
  })
  for (const provider of candidates) {
    const modelID = input.pickBest(provider)
    if (modelID) return { providerID: provider.id, modelID, source }
  }
  return undefined
}
