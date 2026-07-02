export const DEFAULT_REFERENCE_CONCURRENCY = 8

export type MoASlot = { providerID: string; modelID: string }
export type MoAPreset = {
  enabled: boolean
  reference_models: MoASlot[]
  aggregator: MoASlot
  max_tokens?: number
}
export type MoAConfig = {
  default_preset: string
  reference_concurrency: number
  presets: Record<string, MoAPreset>
}

export function parseSlot(model: string): MoASlot {
  const [providerID, ...rest] = model.split("/")
  return { providerID, modelID: rest.join("/") }
}

function cleanSlot(model: unknown): MoASlot | undefined {
  if (typeof model !== "string" || !model.includes("/")) return undefined
  const slot = parseSlot(model)
  if (!slot.providerID || !slot.modelID) return undefined
  if (slot.providerID.toLowerCase() === "moa") return undefined // recursion guard
  return slot
}

export function normalizeMoAConfig(raw: unknown): MoAConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>
  const presets: Record<string, MoAPreset> = {}
  const rawPresets = obj.presets && typeof obj.presets === "object" ? obj.presets : {}
  for (const [name, p] of Object.entries<any>(rawPresets)) {
    const cleanName = String(name || "").trim()
    if (!cleanName) continue
    const aggregator = cleanSlot(p?.aggregator)
    if (!aggregator) continue // no acting model ⇒ drop preset
    const refs = (Array.isArray(p?.reference_models) ? p.reference_models : [])
      .map(cleanSlot)
      .filter((s: MoASlot | undefined): s is MoASlot => s !== undefined)
    if (refs.length === 0) continue // classic MoA needs ≥1 reference
    const maxTokens =
      typeof p?.max_tokens === "number" && p.max_tokens > 0 ? Math.floor(p.max_tokens) : undefined
    presets[cleanName] = {
      enabled: p?.enabled !== false,
      reference_models: refs,
      aggregator,
      max_tokens: maxTokens,
    }
  }
  const concurrency =
    typeof obj.reference_concurrency === "number" && obj.reference_concurrency > 0
      ? Math.floor(obj.reference_concurrency)
      : DEFAULT_REFERENCE_CONCURRENCY
  let defaultName = String(obj.default_preset || "").trim()
  if (!defaultName || !presets[defaultName]) defaultName = Object.keys(presets)[0] ?? ""
  return { default_preset: defaultName, reference_concurrency: concurrency, presets }
}

export function resolveMoAPreset(cfg: MoAConfig, name?: string): MoAPreset {
  const presetName = String(name || cfg.default_preset || "").trim()
  const preset = cfg.presets[presetName]
  if (!preset) {
    const available = Object.keys(cfg.presets).join(", ") || "(none)"
    throw new Error(`MoA preset "${presetName}" not found. Available presets: ${available}`)
  }
  return preset
}
