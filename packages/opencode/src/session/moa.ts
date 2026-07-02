import type { ModelMessage } from "ai"

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

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter((p: any) => p && p.type === "text" && typeof p.text === "string")
    .map((p: any) => p.text)
    .join("")
}

export function referenceMessages(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") continue
    const text = textFromContent(msg.content)
    if (!text.trim()) continue
    out.push({ role: msg.role, content: text })
  }
  return out
}

export function toolListText(tools: { name: string; description?: string }[]): string {
  if (tools.length === 0) return ""
  return tools
    .map((t) => (t.description ? `- ${t.name}: ${t.description.split("\n")[0]}` : `- ${t.name}`))
    .join("\n")
}

export function referenceSystemPrompt(toolList: string): string {
  const base =
    "You are a reference model in a Mixture of Agents process. Give concise, actionable advice " +
    "for the acting agent: next steps, tool-use strategy, risks. You cannot call tools yourself; " +
    "describe the strategy in text."
  if (!toolList) return base
  return `${base}\n\nThe acting agent has these tools available:\n${toolList}`
}

export function synthesizeContext(input: {
  preset: string
  aggregatorLabel: string
  referenceLabels: string[]
  outputs: { label: string; text: string }[]
}): string {
  const joined = input.outputs
    .map((o, i) => `Reference ${i + 1} — ${o.label}:\n${o.text}`)
    .join("\n\n")
  return (
    "[Mixture of Agents reference context]\n" +
    `Preset: ${input.preset}\n` +
    `Aggregator/acting model: ${input.aggregatorLabel}\n` +
    `References: ${input.referenceLabels.join(", ")}\n\n` +
    "Use the reference responses below as private context. You are the aggregator and acting model: " +
    "answer the user directly or call tools as needed.\n\n" +
    joined
  )
}

export function injectContext(messages: ModelMessage[], context: string): ModelMessage[] {
  const out = messages.map((m) => ({ ...m }))
  for (let i = out.length - 1; i >= 0; i--) {
    const msg = out[i]
    if (msg.role !== "user") continue
    if (typeof msg.content === "string") {
      out[i] = { ...msg, role: "user", content: `${msg.content}\n\n${context}` }
      return out
    }
    // Production case: convertToModelMessages yields user content as an array of
    // parts. Copy the content array (the shallow message spread above does not
    // clone it) and append the context as a trailing text part.
    out[i] = { ...msg, role: "user", content: [...msg.content, { type: "text", text: context }] }
    return out
  }
  out.push({ role: "user", content: context })
  return out
}

// Build a synthesized MoA preset Model by copying capability-bearing fields
// from the aggregator's Model. `Model` is intentionally typed loosely here to
// avoid a provider→session import cycle; the provider layer passes its real
// Model and gets a Model-shaped object back.
export function synthesizePresetModel(presetName: string, aggregatorModel: any): any {
  return {
    ...aggregatorModel,
    id: presetName,
    providerID: "moa",
    name: `MoA: ${presetName}`,
  }
}

export type ReferenceCall = { label: string; call: () => Promise<string> }

export async function runReferenceFanout(
  calls: ReferenceCall[],
  concurrency: number,
): Promise<{ label: string; text: string }[]> {
  const results: { label: string; text: string }[] = new Array(calls.length)
  let next = 0
  const limit = Math.max(1, concurrency)
  async function worker() {
    while (true) {
      const i = next++
      if (i >= calls.length) return
      const { label, call } = calls[i]
      try {
        results[i] = { label, text: await call() }
      } catch (e) {
        results[i] = { label, text: `[failed: ${e instanceof Error ? e.message : String(e)}]` }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, calls.length) }, worker))
  return results
}
