import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"
import { CLICKZETTA_PROVIDER_ENTRY, CLICKZETTA_DEFAULT_GATEWAY_URL } from "@/provider/clickzetta"

/**
 * cz_change — ClickZetta LLM config in opencode's NATIVE format.
 *
 * The canonical store is `~/.clickzetta/llm.json`, written directly in opencode's
 * native `{ provider, model }` shape. The cz entry (main.ts) points
 * `OPENCODE_CONFIG` at it, so opencode loads providers/model through its built-in
 * mechanism — no config.ts seam, no runtime conversion, no derived file.
 *
 * This module is the single source for: the file path, read/write, and the
 * projection from the cz authoring inputs (provider/apiKey/baseURL/model) onto
 * the native provider shape. `agent llm` commands and setup write through here;
 * rotation (cz-cli pkg) updates the same file via a minimal in-place key update.
 */

export interface NativeProvider {
  name?: string
  npm?: string
  api?: string
  env?: string[]
  options: { apiKey?: string; baseURL?: string; [k: string]: unknown }
  models?: Record<string, unknown>
}

export interface NativeLlmConfig {
  $schema?: string
  provider?: Record<string, NativeProvider>
  model?: string
  [k: string]: unknown
}

const VALID_PROVIDER_NPM: Record<string, string> = {
  anthropic: "@ai-sdk/anthropic",
  openai: "@ai-sdk/openai",
  "openai-compatible": "@ai-sdk/openai-compatible",
  google: "@ai-sdk/google",
  azure: "@ai-sdk/azure",
  bedrock: "@ai-sdk/amazon-bedrock",
  openrouter: "@openrouter/ai-sdk-provider",
}

export function llmConfigPath(): string {
  return path.join(process.env.CLICKZETTA_TEST_HOME || os.homedir(), ".clickzetta", "llm.json")
}

export function readLlmConfig(): NativeLlmConfig {
  const file = llmConfigPath()
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as NativeLlmConfig) : {}
  } catch {
    return {}
  }
}

export function writeLlmConfig(config: NativeLlmConfig): void {
  const file = llmConfigPath()
  mkdirSync(path.dirname(file), { recursive: true })
  const out: NativeLlmConfig = { $schema: "https://opencode.ai/config.json", ...config }
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n")
}

/** Project cz authoring inputs onto a native provider object. */
export function providerFromInput(input: {
  provider: string
  apiKey: string
  baseURL?: string
  model?: string
}): NativeProvider {
  if (input.provider === "clickzetta") {
    return {
      name: CLICKZETTA_PROVIDER_ENTRY.name,
      npm: CLICKZETTA_PROVIDER_ENTRY.npm,
      api: CLICKZETTA_PROVIDER_ENTRY.api,
      env: [],
      // default the gateway baseURL so the provider is functional + recognizable
      options: { apiKey: input.apiKey, baseURL: input.baseURL ?? CLICKZETTA_DEFAULT_GATEWAY_URL },
      models: CLICKZETTA_PROVIDER_ENTRY.models,
    }
  }
  const provider: NativeProvider = {
    npm: VALID_PROVIDER_NPM[input.provider] ?? "@ai-sdk/openai-compatible",
    options: { apiKey: input.apiKey, ...(input.baseURL && { baseURL: input.baseURL }) },
  }
  if (input.baseURL) provider.api = input.baseURL
  if (input.model) {
    provider.models = {
      [input.model]: {
        name: input.model,
        tool_call: true,
        reasoning: false,
        attachment: false,
        temperature: true,
        limit: { context: 128000, output: 16384 },
        modalities: { input: ["text"], output: ["text"] },
      },
    }
  }
  return provider
}

/** Upsert one named provider; optionally set it as the default model. */
export function upsertProvider(input: {
  name: string
  provider: string
  apiKey: string
  baseURL?: string
  model?: string
  setDefault?: boolean
}): void {
  const config = readLlmConfig()
  config.provider = config.provider ?? {}
  config.provider[input.name] = providerFromInput(input)
  if (input.setDefault) {
    config.model = input.model ? `${input.name}/${input.model}` : input.name
  }
  writeLlmConfig(config)
}

/** Remove a named provider; clears default model if it pointed at it. */
export function removeProvider(name: string): void {
  const config = readLlmConfig()
  if (config.provider) delete config.provider[name]
  if (typeof config.model === "string" && config.model.split("/")[0] === name) delete config.model
  writeLlmConfig(config)
}

/**
 * Authoring-view entry — the cz CLI's `{provider, api_key, base_url, model}`
 * shape. The `agent llm` commands operate on this; storage is native llm.json.
 */
export interface LlmEntryView {
  provider: string
  api_key?: string
  base_url?: string
  model?: string
}

const NPM_TO_PROVIDER: Record<string, string> = Object.fromEntries(
  Object.entries(VALID_PROVIDER_NPM).map(([k, v]) => [v, k]),
)

/** native provider → authoring view (deterministic reverse of providerFromInput). */
function entryFromProvider(name: string, p: NativeProvider): LlmEntryView {
  const npm = typeof p.npm === "string" ? p.npm : "@ai-sdk/openai-compatible"
  const baseURL = typeof p.options?.baseURL === "string" ? p.options.baseURL : undefined
  // The ClickZetta shell npm is unambiguously clickzetta. Also keep the legacy
  // disambiguation: openai-compatible is shared, so a ClickZetta gateway baseURL
  // identifies clickzetta entries written before the shell npm existed.
  const provider =
    npm === CLICKZETTA_PROVIDER_ENTRY.npm
      ? "clickzetta"
      : npm === "@ai-sdk/openai-compatible" && isClickzettaGatewayUrlLocal(baseURL)
        ? "clickzetta"
        : (NPM_TO_PROVIDER[npm] ?? "openai-compatible")
  const models = p.models ? Object.keys(p.models) : []
  return {
    provider,
    ...(typeof p.options?.apiKey === "string" && { api_key: p.options.apiKey }),
    ...(baseURL && { base_url: baseURL }),
    // clickzetta carries the full catalog (no single authored model); others have one
    ...(provider !== "clickzetta" && models.length === 1 && { model: models[0] }),
  }
}

// local copy to avoid importing provider just for the gateway check in reverse map
function isClickzettaGatewayUrlLocal(url: string | undefined): boolean {
  if (typeof url !== "string" || url === "") return false
  try {
    const h = new URL(url).hostname
    return h === "clickzetta.com" || h.endsWith(".clickzetta.com")
  } catch {
    return false
  }
}

/** Read llm.json as the authoring view: `{ llm: {name: entry}, default_llm }`. */
export function readLlmEntries(): { llm: Record<string, LlmEntryView>; default_llm?: string } {
  const config = readLlmConfig()
  const llm: Record<string, LlmEntryView> = {}
  for (const [name, p] of Object.entries(config.provider ?? {})) llm[name] = entryFromProvider(name, p)
  const default_llm = typeof config.model === "string" ? config.model.split("/")[0] : undefined
  return { llm, ...(default_llm && { default_llm }) }
}

/** Write the authoring view back to llm.json (forward projection). */
export function writeLlmEntries(input: { llm: Record<string, LlmEntryView>; default_llm?: string }): void {
  const config = readLlmConfig()
  config.provider = {}
  for (const [name, e] of Object.entries(input.llm)) {
    config.provider[name] = providerFromInput({
      provider: e.provider,
      apiKey: e.api_key ?? "",
      baseURL: e.base_url,
      model: e.model,
    })
  }
  if (input.default_llm && input.llm[input.default_llm]) {
    const m = input.llm[input.default_llm].model
    config.model = m ? `${input.default_llm}/${m}` : input.default_llm
  } else {
    delete config.model
  }
  writeLlmConfig(config)
}

/**
 * One-time migration of legacy `profiles.toml [llm.*]` (+ `default_llm`) into
 * native llm.json. Idempotent: a no-op once profiles.toml has no `[llm.*]`, so
 * it's safe to call on every startup. Writes llm.json BEFORE stripping the toml
 * (crash-safe), and never overwrites a provider the user already has in llm.json.
 * Returns true only when it actually migrated something.
 */
export function migrateProfilesLlmToNative(): boolean {
  const profilesPath = path.join(process.env.CLICKZETTA_TEST_HOME || os.homedir(), ".clickzetta", "profiles.toml")
  if (!existsSync(profilesPath)) return false
  let raw: string
  try {
    raw = readFileSync(profilesPath, "utf-8")
  } catch {
    return false
  }
  // Cheap early-out: skip the parse entirely once there's no [llm.*] left.
  if (!raw.includes("[llm.")) return false

  let parsed: unknown
  try {
    parsed = parseToml(raw)
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false
  const data = parsed as Record<string, unknown>
  const llm = data.llm
  if (!llm || typeof llm !== "object" || Array.isArray(llm) || Object.keys(llm).length === 0) return false

  const config = readLlmConfig()
  config.provider = config.provider ?? {}
  for (const [name, entryRaw] of Object.entries(llm as Record<string, unknown>)) {
    if (config.provider[name]) continue // never clobber an existing native provider
    if (!entryRaw || typeof entryRaw !== "object") continue
    const e = entryRaw as Record<string, unknown>
    const provider = typeof e.provider === "string" ? e.provider : "openai-compatible"
    config.provider[name] = providerFromInput({
      provider,
      apiKey: typeof e.api_key === "string" ? e.api_key : "",
      baseURL: typeof e.base_url === "string" ? e.base_url : undefined,
      model: typeof e.model === "string" ? e.model : undefined,
    })
  }
  const defaultLlm = typeof data.default_llm === "string" ? data.default_llm : undefined
  if (defaultLlm && !config.model) {
    const dm = (llm as Record<string, Record<string, unknown>>)[defaultLlm]
    const dModel = dm && typeof dm.model === "string" ? dm.model : undefined
    config.model = dModel ? `${defaultLlm}/${dModel}` : defaultLlm
  }
  writeLlmConfig(config)

  // Strip [llm.*] + default_llm from profiles.toml now that llm.json holds them.
  try {
    delete data.llm
    delete data.default_llm
    writeFileSync(profilesPath, stringifyToml(data as never) + "\n")
  } catch {
    // non-fatal: llm.json already written; stale [llm.*] is inert (nothing reads it)
  }
  return true
}


