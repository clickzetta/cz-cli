import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"

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
  defaultModel?: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function customProviderFromEntry(entry: ParsedLlmEntry) {
  if (!entry.model) return undefined
  if (entry.provider === "clickzetta") return undefined
  return {
    name: entry.name,
    npm: entry.provider === "openai-compatible" ? "@ai-sdk/openai-compatible" : undefined,
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
  let defaultModel: string | undefined

  let parsed: unknown
  try {
    parsed = parseToml(toml)
  } catch (e) {
    warnings.push(`failed to parse profiles.toml: ${String(e)}`)
    return { providers, defaultModel, warnings }
  }
  if (!isRecord(parsed)) return { providers, defaultModel, warnings }

  const defaultProfile = process.env.CZ_PROFILE ?? asString(parsed.default_profile) ?? "default"
  const defaultLlm = asString(parsed.default_llm)
  const profileSection = getProfileSection(parsed, defaultProfile)

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
    defaultModel = selectedDefault.model ? `${selectedDefault.provider}/${selectedDefault.model}` : undefined
    providers[selectedDefault.provider] = {
      options: {
        apiKey: selectedDefault.apiKey,
        ...(selectedDefault.baseURL && { baseURL: selectedDefault.baseURL }),
      },
      ...customProviderFromEntry(selectedDefault),
    }
    for (const entry of parsedEntries) {
      if (entry === selectedDefault) continue
      if (!providers[entry.provider]) {
        providers[entry.provider] = {
          options: {
            apiKey: entry.apiKey,
            ...(entry.baseURL && { baseURL: entry.baseURL }),
          },
        }
      }
    }
    return { providers, defaultModel, warnings }
  }

  if (legacyClickzettaProvider) {
    providers.clickzetta = { options: legacyClickzettaProvider.options }
  }

  if (parsedEntries.length === 1) {
    const selected = parsedEntries[0]
    providers[selected.provider] = {
      options: {
        apiKey: selected.apiKey,
        ...(selected.baseURL && { baseURL: selected.baseURL }),
      },
    }
    return { providers, defaultModel, warnings }
  }

  if (parsedEntries.length > 1) {
    warnings.push(
      "multiple [llm.*] entries are configured but default_llm is not set; using one entry per provider until you run `cz-cli agent llm use <name>`",
    )
  }

  for (const [provider, entries] of Object.entries(entriesByProvider)) {
    const selected = entries[0]
    if (!selected) continue
    if (entries.length > 1) {
      warnings.push(
        `multiple [llm.*] entries use provider "${provider}" but default_llm does not select one; using [llm.${selected.name}]`,
      )
    }
    if (!providers[selected.provider]) {
      providers[selected.provider] = {
        options: {
          apiKey: selected.apiKey,
          ...(selected.baseURL && { baseURL: selected.baseURL }),
        },
      }
    }
  }

  return { providers, defaultModel, warnings }
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

  for (const raw of Object.values(llms)) {
    if (!isRecord(raw)) continue
    if (asString(raw.provider) && asString(raw.api_key)) return { hasValidConfig: true, warnings }
  }

  return { hasValidConfig: false, warnings }
}
