import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import {
  CLICKZETTA_DEFAULT_GATEWAY_URL,
  CLICKZETTA_PROVIDER_NAME,
  CLICKZETTA_PROVIDER_NPM,
  isClickzettaGatewayUrl,
} from "./clickzetta-provider.js"

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
  plugin?: string[]
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

export function llmConfigPath() {
  return path.join(process.env.CLICKZETTA_TEST_HOME || os.homedir(), ".clickzetta", "llm.json")
}

export function readLlmConfig(): NativeLlmConfig {
  const file = llmConfigPath()
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as NativeLlmConfig : {}
  } catch {
    return {}
  }
}

export function writeLlmConfig(config: NativeLlmConfig) {
  const file = llmConfigPath()
  // llm.json stores api_key in plaintext — keep it owner-only. writeFileSync's
  // mode only applies when creating a new file, so chmod explicitly to also
  // tighten a pre-existing world-readable file.
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }, null, 2) + "\n", {
    mode: 0o600,
  })
  try {
    chmodSync(file, 0o600)
  } catch {
    // best-effort: non-POSIX filesystems may not support chmod
  }
}

export function providerFromInput(input: {
  provider: string
  apiKey: string
  baseURL?: string
  model?: string
  // cz_change: the llm.json entry key (= profile/entry name). It becomes the
  // provider's `name`, which is what the TUI `/model` picker groups by
  // (dialog-model.tsx category = provider.name). Without it every ClickZetta
  // entry shared the hardcoded "ClickZetta" name and collapsed into one group
  // with every model duplicated per entry. One entry key → one distinct group.
  entryName?: string
}): NativeProvider {
  if (input.provider === "clickzetta") {
    // cz_change: no `models` here. ClickZetta's catalog is discovered at runtime
    // from the gateway's `GET /v1/models` endpoint (see the clickzetta custom
    // loader in opencode's provider.ts). llm.json holds connection info only —
    // matching opencode's native model where `auth login` never writes a model
    // list. This kills the per-provider CLICKZETTA_MODELS duplication + drift.
    return {
      name: input.entryName ?? CLICKZETTA_PROVIDER_NAME,
      npm: CLICKZETTA_PROVIDER_NPM,
      api: "",
      env: [],
      options: { apiKey: input.apiKey, baseURL: input.baseURL ?? CLICKZETTA_DEFAULT_GATEWAY_URL },
    }
  }
  const provider: NativeProvider = {
    ...(input.entryName ? { name: input.entryName } : {}),
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

export function upsertProvider(input: {
  name: string
  provider: string
  apiKey: string
  baseURL?: string
  model?: string
  setDefault?: boolean
}) {
  const config = readLlmConfig()
  config.provider = config.provider ?? {}
  // cz_change: entryName = the provider key so name groups the /model picker per entry.
  config.provider[input.name] = providerFromInput({ ...input, entryName: input.name })
  // cz_change: only pin config.model when a concrete model is given — a bare
  // `<name>` breaks opencode's parseModel. Without a model, opencode auto-selects.
  if (input.setDefault && input.model) config.model = `${input.name}/${input.model}`
  writeLlmConfig(config)
}

export function removeProvider(name: string) {
  const config = readLlmConfig()
  if (config.provider) delete config.provider[name]
  if (typeof config.model === "string" && config.model.split("/")[0] === name) delete config.model
  writeLlmConfig(config)
}

export interface LlmEntryView {
  provider: string
  api_key?: string
  base_url?: string
  model?: string
}

const NPM_TO_PROVIDER = Object.fromEntries(
  Object.entries(VALID_PROVIDER_NPM).map(([key, value]) => [value, key]),
)

function entryFromProvider(provider: NativeProvider): LlmEntryView {
  const npm = typeof provider.npm === "string" ? provider.npm : "@ai-sdk/openai-compatible"
  const baseURL = typeof provider.options?.baseURL === "string" ? provider.options.baseURL : undefined
  const resolvedProvider =
    npm === CLICKZETTA_PROVIDER_NPM
      ? "clickzetta"
      : npm === "@ai-sdk/openai-compatible" && isClickzettaGatewayUrl(baseURL)
        ? "clickzetta"
        : (NPM_TO_PROVIDER[npm] ?? "openai-compatible")
  const models = provider.models ? Object.keys(provider.models) : []
  return {
    provider: resolvedProvider,
    ...(typeof provider.options?.apiKey === "string" && { api_key: provider.options.apiKey }),
    ...(baseURL && { base_url: baseURL }),
    ...(resolvedProvider !== "clickzetta" && models.length === 1 && { model: models[0] }),
  }
}

// cz_change: aligned with opencode — there is no cz-specific "default_llm"
// concept anymore. opencode's single source of truth for the active model is the
// top-level `config.model` string (`provider/model`, e.g. anthropic/claude-2, or
// clickzetta/deepseek/deepseek-v4-pro). We surface it raw as `model` for display;
// callers set it explicitly via setActiveModel (the `agent llm use` command).
export function readLlmEntries(): { llm: Record<string, LlmEntryView>; model?: string } {
  const config = readLlmConfig()
  const llm = Object.fromEntries(
    Object.entries(config.provider ?? {}).map(([name, provider]) => [name, entryFromProvider(provider)]),
  )
  return { llm, ...(typeof config.model === "string" && config.model ? { model: config.model } : {}) }
}

function viewsEqual(a: LlmEntryView, b: LlmEntryView): boolean {
  return a.provider === b.provider && a.api_key === b.api_key && a.base_url === b.base_url && a.model === b.model
}

// cz_change: writes only the provider map. The active model (config.model) is
// opencode-native and managed separately via setActiveModel / clearActiveModel —
// writing providers must never touch it (adding/removing an entry shouldn't
// silently change which model is active). config.model is left untouched here.
export function writeLlmEntries(input: { llm: Record<string, LlmEntryView> }) {
  const config = readLlmConfig()
  const prevProviders = config.provider ?? {}

  config.provider = Object.fromEntries(
    Object.entries(input.llm).map(([name, entry]) => {
      const existing = prevProviders[name]
      // Preserve the full raw provider block when this entry is unchanged.
      // LlmEntryView is a lossy projection (drops models map, reasoning flags,
      // limits, env, custom headers), so regenerating every entry via
      // providerFromInput would clobber that metadata on untouched providers.
      // Only rebuild entries whose reduced view actually changed (genuinely new
      // input) — for those the CLI only has the reduced info anyway.
      if (existing && viewsEqual(entryFromProvider(existing), entry)) {
        // cz_change: still normalize name = key so pre-existing entries written
        // before this fix (all name="ClickZetta") get regrouped per entry in /model.
        return [name, existing.name === name ? existing : { ...existing, name }]
      }
      return [
        name,
        providerFromInput({
          provider: entry.provider,
          apiKey: entry.api_key ?? "",
          baseURL: entry.base_url,
          model: entry.model,
          entryName: name,
        }),
      ]
    }),
  )

  // If the active model points at an entry that no longer exists, drop it so a
  // stale selection can't linger (opencode then auto-selects). Keeps config.model
  // honest without inventing a replacement.
  if (typeof config.model === "string") {
    const entry = config.model.split("/")[0]
    if (entry && !config.provider[entry]) delete config.model
  }
  writeLlmConfig(config)
}

// cz_change: set opencode's active model (config.model). `providerModel` is a full
// `provider/model` reference (e.g. anthropic/claude-2 or clickzetta/deepseek/…).
// This is the one explicit way to pin the active model — the `agent llm use`
// command. Absence of config.model means opencode auto-selects (recent → first).
export function setActiveModel(providerModel: string) {
  const config = readLlmConfig()
  config.model = providerModel
  writeLlmConfig(config)
}

// cz_change: validate a `use <model>` argument before pinning it. A model ref
// must be `<entry>/<modelId>` where <entry> is a defined provider (opencode's
// parseModel splits on the first "/", so a bare entry name yields an empty
// modelID and breaks selection). Pure so the command layer and tests share it.
export type ModelRefValidation =
  | { ok: true; entry: string }
  | { ok: false; code: "INVALID_MODEL_REF" | "NOT_FOUND"; entry?: string }

export function validateModelRef(model: string, entries: Record<string, unknown>): ModelRefValidation {
  if (!model.includes("/")) return { ok: false, code: "INVALID_MODEL_REF" }
  const entry = model.split("/")[0]
  if (!entry || !entries[entry]) return { ok: false, code: "NOT_FOUND", entry }
  return { ok: true, entry }
}

export function clearActiveModel() {
  const config = readLlmConfig()
  delete config.model
  writeLlmConfig(config)
}

// cz_change: heal a pre-existing llm.json where provider.name != its key. Older
// a2 builds hardcoded name="ClickZetta" on EVERY entry, so the TUI /model picker
// (groups by provider.name) collapsed all ClickZetta profiles into one group with
// each model duplicated per profile. The invariant is name = entry key (one entry
// → one /model group). Idempotent: writes only when a name actually changed, so it
// no-ops on every run after the first. Returns the keys whose name was corrected.
export function normalizeLlmProviderNames(): string[] {
  const config = readLlmConfig()
  if (!config.provider) return []
  const changed: string[] = []
  for (const [key, prov] of Object.entries(config.provider)) {
    if (prov && prov.name !== key) {
      prov.name = key
      changed.push(key)
    }
  }
  if (changed.length === 0) return []
  writeLlmConfig(config)
  return changed
}

function profilesTomlPath() {
  return path.join(process.env.CLICKZETTA_TEST_HOME || os.homedir(), ".clickzetta", "profiles.toml")
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

// cz_change: migrate origin/main's LLM store into llm.json. origin/main kept LLM
// under `[llm.<entryName>]` tables in profiles.toml (+ top-level `default_llm`);
// see origin clickzetta-rotation.ts writeRotatedKey. a2 keeps LLM ONLY in
// ~/.clickzetta/llm.json. This lifts each `[llm.<entryName>]` into
// llm.json provider[<entryName>] (entryName = provider key = TUI /model group),
// maps `default_llm` → llm.json `model`, then strips the migrated keys from
// profiles.toml so it goes back to holding connection profiles only.
// Idempotent + non-destructive: skips entryNames already present in llm.json;
// no-ops when profiles.toml has no `[llm.*]`. Returns migrated entry names.
export function migrateProfilesLlmToJson(): string[] {
  const tomlPath = profilesTomlPath()
  if (!existsSync(tomlPath)) return []
  let root: Record<string, unknown>
  try {
    const parsed = parseTOML(readFileSync(tomlPath, "utf-8"))
    root = isRecord(parsed) ? parsed : {}
  } catch {
    return []
  }
  const llm = isRecord(root.llm) ? root.llm : undefined
  if (!llm || Object.keys(llm).length === 0) return []

  const config = readLlmConfig()
  config.provider = config.provider ?? {}
  const migrated: string[] = []

  for (const [entryName, raw] of Object.entries(llm)) {
    if (config.provider[entryName]) continue // already in llm.json — don't clobber
    if (!isRecord(raw)) continue
    const provider = typeof raw.provider === "string" ? raw.provider : "clickzetta"
    const apiKey = typeof raw.api_key === "string" ? raw.api_key : ""
    const baseURL = typeof raw.base_url === "string" ? raw.base_url : undefined
    const model = typeof raw.model === "string" ? raw.model : undefined
    config.provider[entryName] = providerFromInput({ provider, apiKey, baseURL, model, entryName })
    migrated.push(entryName)
  }

  if (migrated.length === 0) {
    // Still clean up: profiles.toml carried [llm.*] but all already in llm.json.
    stripProfilesLlm(root, tomlPath)
    return []
  }

  // Carry over legacy default selection into opencode's config.model, but ONLY
  // when a concrete model is known — a bare `<entry>` (no model) would break
  // opencode's parseModel (empty modelID). Without a model we leave config.model
  // unset and let opencode auto-select (recent → first available).
  if (config.model === undefined && typeof root.default_llm === "string" && llm[root.default_llm]) {
    const raw = llm[root.default_llm]
    const model = isRecord(raw) && typeof raw.model === "string" ? raw.model : undefined
    if (model) config.model = `${root.default_llm}/${model}`
  }

  writeLlmConfig(config)
  stripProfilesLlm(root, tomlPath)
  return migrated
}

// Remove `llm` + `default_llm` from an already-parsed profiles.toml root and
// rewrite the file (atomic, 0600). Best-effort: profiles.toml is machine-managed.
function stripProfilesLlm(root: Record<string, unknown>, tomlPath: string) {
  if (!("llm" in root) && !("default_llm" in root)) return
  delete root.llm
  delete root.default_llm
  try {
    const tmp = tomlPath + ".tmp." + Date.now()
    writeFileSync(tmp, stringifyTOML(root) + "\n", { encoding: "utf-8", mode: 0o600 })
    renameSync(tmp, tomlPath)
    try {
      chmodSync(tomlPath, 0o600)
    } catch {
      // non-POSIX fs
    }
  } catch {
    // best-effort: leaving stale [llm.*] is harmless (llm.json is the source of truth)
  }
}
