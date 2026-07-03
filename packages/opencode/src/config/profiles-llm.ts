import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unwatchFile, watchFile, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"
import { CLICKZETTA_PROVIDER_ENTRY } from "../provider/clickzetta"

export interface LlmEntry {
  name: string
  provider: string
  model?: string
}

export interface ProfilesLlmResult {
  providers: Record<
    string,
    {
      options: { apiKey: string; baseURL?: string }
      name?: string
      npm?: string
      api?: string
      env?: string[]
      models?: Record<
        string,
        {
          name?: string
          tool_call: boolean
          reasoning: boolean
          attachment: boolean
          temperature: boolean
          limit: { context: number; output: number }
          modalities: { input: string[]; output: string[] }
        }
      >
    }
  >
  entries: LlmEntry[]
  defaultLlmEntry?: string
  defaultModel?: string
  moa?: unknown
  warnings: string[]
}

export interface ProfilesLlmGuardResult {
  hasValidConfig: boolean
  warnings: string[]
}

interface ParsedLlmEntry {
  name: string
  provider: (typeof VALID_PROVIDERS)[number]
  apiKey: string
  baseURL?: string
  model?: string
}

const LEGACY_FIELDS = ["llm_provider", "llm_model", "llm_api_key", "llm_base_url"] as const

const VALID_PROVIDERS = [
  "clickzetta",
  "anthropic",
  "openai",
  "openai-compatible",
  "bedrock",
  "google",
  "azure",
  "openrouter",
] as const

const CLICKZETTA_DIR = path.join(process.env.CLICKZETTA_TEST_HOME || os.homedir(), ".clickzetta")
const PROFILES_PATH = path.join(CLICKZETTA_DIR, "profiles.toml")

export function resolveCurrentProfileLabel(): string {
  if (process.env.CZ_PROFILE) return process.env.CZ_PROFILE
  const profilesPath = path.join(process.env.CLICKZETTA_TEST_HOME || os.homedir(), ".clickzetta", "profiles.toml")
  if (!existsSync(profilesPath)) return "default"
  try {
    const parsed = parseToml(readFileSync(profilesPath, "utf-8"))
    if (!isRecord(parsed)) return "default"
    return asString(parsed.default_profile) ?? "default"
  } catch {
    return "default"
  }
}

export function watchCurrentProfileLabel(onChange: (label: string) => void, interval = 500): () => void {
  if (process.env.CZ_PROFILE) return () => {}
  const profilesPath = path.join(process.env.CLICKZETTA_TEST_HOME || os.homedir(), ".clickzetta", "profiles.toml")
  const listener = () => onChange(resolveCurrentProfileLabel())
  watchFile(profilesPath, { interval }, listener)
  return () => unwatchFile(profilesPath, listener)
}

export function normalizeLlmBaseUrl(provider: string, url: string | undefined): string | undefined {
  if (!url) return undefined
  let baseURL = url.replace(/\/+$/, "")
  if (provider === "clickzetta") {
    if (!/\/gateway(\/|$)/.test(baseURL)) baseURL += "/gateway"
    if (!/\/v\d+(\/|$)/.test(baseURL)) baseURL += "/v1"
    return baseURL
  }
  const needsVersionPrefix = ["anthropic", "openai", "openai-compatible"].includes(provider)
  const hasVersionPath = /\/v\d+(\/|$)/.test(baseURL) || /\/openai(\/|$)/.test(baseURL)
  if (needsVersionPrefix && !hasVersionPath) baseURL += "/v1"
  return baseURL
}

export interface LlmProbe {
  url: string
  method: "POST"
  kind: "chat.completions"
  headers: Record<string, string>
  body: string
}

const DEFAULT_PROBE_MODELS: Record<string, string> = {
  clickzetta: "deepseek/deepseek-v4-pro",
  anthropic: "claude-haiku-4-5-20241022",
  openai: "gpt-4.1-mini",
  "openai-compatible": "gpt-4.1-mini",
  openrouter: "openai/gpt-4.1-mini",
  google: "gemini-2.0-flash",
  azure: "gpt-4.1-mini",
}

export type AddLlmEntryInput = {
  name?: string
  provider: string
  apiKey: string
  baseUrl?: string
  model?: string
  use?: boolean
}

function uniqueLlmName(llms: Record<string, unknown>, base: string, index = 0): string {
  const name = index === 0 ? base : `${base}-${index + 1}`
  if (!(name in llms)) return name
  return uniqueLlmName(llms, base, index + 1)
}

function defaultEntryModel(provider: string) {
  if (provider === "openai-compatible") return DEFAULT_PROBE_MODELS[provider]
  return undefined
}

function normalizeEntryName(input: AddLlmEntryInput) {
  return (input.name ?? input.provider).trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "custom"
}

export function addLlmEntry(data: Record<string, unknown>, input: AddLlmEntryInput): LlmEntry {
  const provider = input.provider.trim()
  if (!VALID_PROVIDERS.includes(provider as (typeof VALID_PROVIDERS)[number])) {
    throw new Error(`Invalid provider "${provider}". Valid providers: ${VALID_PROVIDERS.join(", ")}`)
  }
  if (!input.apiKey.trim()) throw new Error("API key is required")
  const model = input.model?.trim() || defaultEntryModel(provider)
  const llms = getLlms(data)
  const name = uniqueLlmName(llms, normalizeEntryName(input))
  llms[name] = {
    provider,
    api_key: input.apiKey.trim(),
    ...(input.baseUrl?.trim() && { base_url: normalizeLlmBaseUrl(provider, input.baseUrl.trim()) }),
    ...(model && { model }),
  }
  data.llm = llms
  if (input.use !== false) data.default_llm = name
  return { name, provider, ...(model && { model }) }
}

export function saveLlmEntry(input: AddLlmEntryInput): LlmEntry {
  const parsed = existsSync(PROFILES_PATH) ? parseToml(readFileSync(PROFILES_PATH, "utf-8")) : {}
  const data = isRecord(parsed) ? parsed : {}
  const result = addLlmEntry(data, input)
  mkdirSync(CLICKZETTA_DIR, { recursive: true })
  const tmp = PROFILES_PATH + ".tmp." + Date.now()
  writeFileSync(tmp, stringifyToml(data as never) + "\n", { encoding: "utf-8", mode: 0o600 })
  renameSync(tmp, PROFILES_PATH)
  chmodSync(PROFILES_PATH, 0o600)
  return result
}

export function buildLlmProbeRequest(provider: string, baseUrl: string | undefined, apiKey: string, model?: string): LlmProbe | undefined {
  const probeModel = model ?? DEFAULT_PROBE_MODELS[provider] ?? "gpt-4.1-mini"

  if (provider === "anthropic") {
    const base = normalizeLlmBaseUrl(provider, baseUrl) ?? "https://api.anthropic.com/v1"
    return {
      url: base + "/messages",
      method: "POST",
      kind: "chat.completions",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        model: probeModel,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    }
  }

  if (provider === "google") {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${probeModel}:generateContent?key=${apiKey}`,
      method: "POST",
      kind: "chat.completions",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    }
  }

  if (provider === "azure") {
    const base = (normalizeLlmBaseUrl(provider, baseUrl) ?? baseUrl)?.replace(/\/+$/, "")
    if (!base) return undefined
    return {
      url: base + `/deployments/${probeModel}/chat/completions?api-version=2024-10-21`,
      method: "POST",
      kind: "chat.completions",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
    }
  }

  if (provider === "bedrock") {
    return undefined
  }

  if (provider === "clickzetta") {
    const normalized = normalizeLlmBaseUrl(provider, baseUrl)
    if (!normalized) return undefined
    return {
      url: normalized + "/chat/completions",
      method: "POST",
      kind: "chat.completions",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        model: probeModel,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
    }
  }

  // openai, openai-compatible, openrouter
  const normalized = normalizeLlmBaseUrl(provider, baseUrl)
  if (!normalized) return undefined
  return {
    url: normalized + "/chat/completions",
    method: "POST",
    kind: "chat.completions",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      model: probeModel,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}


function customProviderFromEntry(entry: ParsedLlmEntry) {
  if (entry.provider === "clickzetta") {
    return {
      name: entry.name,
      npm: CLICKZETTA_PROVIDER_ENTRY.npm,
      api: CLICKZETTA_PROVIDER_ENTRY.api,
      env: [],
      models: CLICKZETTA_PROVIDER_ENTRY.models,
    }
  }
  if (!entry.model) return undefined
  return {
    name: entry.name,
    npm: (
      {
        "anthropic": "@ai-sdk/anthropic",
        "openai": "@ai-sdk/openai",
        "openai-compatible": "@ai-sdk/openai-compatible",
        "google": "@ai-sdk/google",
        "azure": "@ai-sdk/azure",
        "bedrock": "@ai-sdk/amazon-bedrock",
        "openrouter": "@openrouter/ai-sdk-provider",
      } as Record<string, string>
    )[entry.provider] ?? "@ai-sdk/openai-compatible",
    api: entry.baseURL,
    env: [],
    models: {
      [entry.model]: {
        name: entry.model,
        tool_call: true,
        reasoning: false,
        attachment: false,
        temperature: true,
        limit: { context: 128000, output: 16384 },
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  }
}

function getProfiles(data: Record<string, unknown>) {
  return isRecord(data.profiles) ? data.profiles : {}
}

function getLlms(data: Record<string, unknown>) {
  return isRecord(data.llm) ? data.llm : {}
}

function providerFromEntry(entry: ParsedLlmEntry) {
  return {
    options: {
      apiKey: entry.apiKey,
      ...(entry.baseURL && { baseURL: entry.baseURL }),
      _providerType: entry.provider,
    },
    name: entry.name,
    ...customProviderFromEntry(entry),
  }
}
export function setDefaultLlmModel(data: Record<string, unknown>, model: string): boolean {
  const defaultLlm = asString(data.default_llm)
  if (!defaultLlm) return false
  const llms = getLlms(data)
  const entry = llms[defaultLlm]
  if (!isRecord(entry)) return false
  entry.model = model
  return true
}

export function persistDefaultLlmModel(model: string): boolean {
  if (!existsSync(PROFILES_PATH)) return false
  let parsed: unknown
  try {
    parsed = parseToml(readFileSync(PROFILES_PATH, "utf-8"))
  } catch {
    return false
  }
  if (!isRecord(parsed)) return false
  if (!setDefaultLlmModel(parsed, model)) return false
  mkdirSync(CLICKZETTA_DIR, { recursive: true })
  writeFileSync(PROFILES_PATH, stringifyToml(parsed as never) + "\n")
  return true
}

function getProfileSection(data: Record<string, unknown>, name: string) {
  const profiles = getProfiles(data)
  return isRecord(profiles[name]) ? profiles[name] : undefined
}

function getClickzettaLegacyFields(profileSection: Record<string, unknown> | undefined) {
  return {
    apiKey: profileSection ? asString(profileSection.api_key) : undefined,
    baseUrl: profileSection ? asString(profileSection.aimesh_endpoint) : undefined,
  }
}

export function migrateLegacyClickzettaConfig(data: Record<string, unknown>): boolean {
  const defaultProfile = process.env.CZ_PROFILE ?? asString(data.default_profile) ?? "default"
  const profileSection = getProfileSection(data, defaultProfile)
  const legacy = getClickzettaLegacyFields(profileSection)
  if (!legacy.apiKey && !legacy.baseUrl) return false

  const llms = getLlms(data)
  const clickzetta = isRecord(llms.clickzetta) ? { ...llms.clickzetta } : {}
  let changed = false

  if (clickzetta.provider !== "clickzetta") {
    clickzetta.provider = "clickzetta"
    changed = true
  }
  if (legacy.apiKey && clickzetta.api_key !== legacy.apiKey) {
    clickzetta.api_key = legacy.apiKey
    changed = true
  }
  if (legacy.baseUrl && clickzetta.base_url !== legacy.baseUrl) {
    clickzetta.base_url = legacy.baseUrl
    changed = true
  }
  if (!asString(data.default_llm)) {
    data.default_llm = "clickzetta"
    changed = true
  }

  if (profileSection) {
    if ("api_key" in profileSection) {
      delete profileSection.api_key
      changed = true
    }
    if ("aimesh_endpoint" in profileSection) {
      delete profileSection.aimesh_endpoint
      changed = true
    }
  }

  data.llm = {
    ...llms,
    clickzetta,
  }
  return changed
}

export function parseProfilesToml(toml: string): ProfilesLlmResult {
  const warnings: string[] = []
  const providers: ProfilesLlmResult["providers"] = {}
  const resultEntries: LlmEntry[] = []
  let defaultModel: string | undefined

  let parsed: unknown
  try {
    parsed = parseToml(toml)
  } catch (e) {
    warnings.push(`failed to parse profiles.toml: ${String(e)}`)
    return { providers, entries: resultEntries, defaultLlmEntry: undefined, defaultModel, warnings }
  }
  if (!isRecord(parsed)) return { providers, entries: resultEntries, defaultLlmEntry: undefined, defaultModel, warnings }

  const defaultProfile = process.env.CZ_PROFILE ?? asString(parsed.default_profile) ?? "default"
  const defaultLlm = asString(parsed.default_llm)
  const profileSection = getProfileSection(parsed, defaultProfile)
  const moa = isRecord(parsed.moa) ? parsed.moa : undefined

  if (profileSection) {
    const hasLegacy = LEGACY_FIELDS.some((f) => f in profileSection)
    if (hasLegacy) {
      warnings.push(
        "profiles.toml contains deprecated llm_* fields in [profiles.*] — they are ignored. " +
          "Clean up with: cz-cli agent llm purge-legacy " +
          "(and re-add your LLM via: cz-cli agent llm add <name> --provider ... --api-key ... --use)",
      )
    }
  }

  const legacyClickzetta = getClickzettaLegacyFields(profileSection)
  const legacyClickzettaProvider = legacyClickzetta.apiKey || legacyClickzetta.baseUrl
    ? {
        provider: "clickzetta" as const,
        options: {
          ...(legacyClickzetta.apiKey && { apiKey: legacyClickzetta.apiKey }),
          ...(normalizeLlmBaseUrl("clickzetta", legacyClickzetta.baseUrl) && {
            baseURL: normalizeLlmBaseUrl("clickzetta", legacyClickzetta.baseUrl),
          }),
        } as { apiKey: string; baseURL?: string },
      }
    : null
  if (legacyClickzetta.apiKey || legacyClickzetta.baseUrl) {
    warnings.push(
      `found deprecated [profiles.${defaultProfile}].api_key/aimesh_endpoint; migrate them to [llm.clickzetta]`,
    )
  }

  const llms = getLlms(parsed)
  const parsedEntries: ParsedLlmEntry[] = []
  for (const [name, raw] of Object.entries(llms)) {
    if (!isRecord(raw)) continue
    const provider = asString(raw.provider)
    const apiKey = asString(raw.api_key)
    const baseUrl = asString(raw.base_url)
    if (!provider || !apiKey) continue
    if (!VALID_PROVIDERS.includes(provider as (typeof VALID_PROVIDERS)[number])) {
      warnings.push(`[llm.${name}] has unknown provider "${provider}" — skipped`)
      continue
    }
    parsedEntries.push({
      name,
      provider: provider as (typeof VALID_PROVIDERS)[number],
      apiKey,
      baseURL: normalizeLlmBaseUrl(provider, baseUrl),
      model: asString(raw.model),
    })
  }

  const entriesByProvider = parsedEntries.reduce<Record<string, ParsedLlmEntry[]>>((result, entry) => {
    result[entry.provider] = [...(result[entry.provider] ?? []), entry]
    return result
  }, {})

  for (const entry of parsedEntries) {
    resultEntries.push({
      name: entry.name,
      provider: entry.provider,
      model: entry.model,
    })
  }

  if (defaultLlm) {
    const entry = llms[defaultLlm]
    if (!isRecord(entry)) {
      warnings.push(`default_llm = "${defaultLlm}" but [llm.${defaultLlm}] is not defined`)
    } else {
      const provider = asString(entry.provider)
      const apiKey = asString(entry.api_key)
      if (!provider || !apiKey) {
        warnings.push(`[llm.${defaultLlm}] missing required fields`)
      } else if (!VALID_PROVIDERS.includes(provider as (typeof VALID_PROVIDERS)[number])) {
        warnings.push(`[llm.${defaultLlm}] unknown provider "${provider}"`)
      }
    }
  }

  const selectedDefault = defaultLlm ? parsedEntries.find((entry) => entry.name === defaultLlm) : undefined
  if (selectedDefault) {
    defaultModel = selectedDefault.model ? `${selectedDefault.name}/${selectedDefault.model}` : undefined
    for (const entry of parsedEntries) providers[entry.name] = providerFromEntry(entry)
    return { providers, entries: resultEntries, defaultLlmEntry: defaultLlm, defaultModel, moa, warnings }
  }

  if (legacyClickzettaProvider) {
    providers.clickzetta = { options: legacyClickzettaProvider.options }
  }

  if (parsedEntries.length === 1) {
    const selected = parsedEntries[0]
    providers[selected.name] = providerFromEntry(selected)
    return { providers, entries: resultEntries, defaultLlmEntry: defaultLlm, defaultModel, moa, warnings }
  }

  if (parsedEntries.length > 1) {
    warnings.push(
      "multiple [llm.*] entries are configured but default_llm is not set; using one entry per provider until you run `cz-cli agent llm use <name>`",
    )
  }

  for (const entry of parsedEntries) providers[entry.name] = providerFromEntry(entry)

  return { providers, entries: resultEntries, defaultLlmEntry: defaultLlm, defaultModel, moa, warnings }
}

export function hasUsableLlm(toml: string): ProfilesLlmGuardResult {
  const warnings: string[] = []
  let parsed: unknown
  try {
    parsed = parseToml(toml)
  } catch {
    return { hasValidConfig: false, warnings }
  }
  if (!isRecord(parsed)) return { hasValidConfig: false, warnings }

  const defaultProfile = process.env.CZ_PROFILE ?? asString(parsed.default_profile) ?? "default"
  const profileSection = getProfileSection(parsed, defaultProfile)
  const llms = getLlms(parsed)

  const legacyClickzetta = getClickzettaLegacyFields(profileSection)
  if (legacyClickzetta.apiKey || legacyClickzetta.baseUrl) {
    return { hasValidConfig: true, warnings }
  }

  const defaultLlm = asString(parsed.default_llm)

  for (const raw of Object.values(llms)) {
    if (!isRecord(raw)) continue
    if (asString(raw.provider) && asString(raw.api_key)) return { hasValidConfig: true, warnings }
  }

  return { hasValidConfig: false, warnings }
}
