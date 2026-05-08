import { parse as parseToml } from "smol-toml"

export interface ProfilesLlmResult {
  providers: Record<string, { options: { apiKey: string; baseURL?: string } }>
  warnings: string[]
}

export interface ProfilesLlmGuardResult {
  hasValidConfig: boolean
  warnings: string[]
}

const LEGACY_FIELDS = ["llm_provider", "llm_model", "llm_api_key", "llm_base_url"] as const

const VALID_PROVIDERS = [
  "anthropic",
  "openai",
  "openai-compatible",
  "bedrock",
  "google",
  "azure",
  "openrouter",
] as const

export function normalizeLlmBaseUrl(provider: string, url: string | undefined): string | undefined {
  if (!url) return undefined
  let baseURL = url.replace(/\/+$/, "")
  const needsVersionPrefix = ["anthropic", "openai", "openai-compatible", "clickzetta"].includes(provider)
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

export function parseProfilesToml(toml: string): ProfilesLlmResult {
  const warnings: string[] = []
  const providers: ProfilesLlmResult["providers"] = {}

  let parsed: unknown
  try {
    parsed = parseToml(toml)
  } catch (e) {
    warnings.push(`failed to parse profiles.toml: ${String(e)}`)
    return { providers, warnings }
  }
  if (!isRecord(parsed)) return { providers, warnings }

  const defaultProfile = process.env.CZ_PROFILE ?? asString(parsed.default_profile) ?? "default"
  const defaultLlm = asString(parsed.default_llm)

  const profiles = isRecord(parsed.profiles) ? parsed.profiles : {}
  const profileSection = isRecord(profiles[defaultProfile]) ? profiles[defaultProfile] : undefined

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

  if (profileSection) {
    const aimeshEndpoint = asString(profileSection.aimesh_endpoint)
    const apiKey = asString(profileSection.api_key)
    if (aimeshEndpoint || apiKey) {
      const baseURL = normalizeLlmBaseUrl("clickzetta", aimeshEndpoint)
      const opts: { baseURL?: string; apiKey?: string } = {}
      if (baseURL) opts.baseURL = baseURL
      if (apiKey) opts.apiKey = apiKey
      providers["clickzetta"] = { options: opts as { apiKey: string; baseURL?: string } }
    }
  }

  const llms = isRecord(parsed.llm) ? parsed.llm : {}
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
    const baseURL = normalizeLlmBaseUrl(provider, baseUrl)
    providers[provider] = { options: { apiKey, ...(baseURL && { baseURL }) } }
  }

  if (defaultLlm) {
    const entry = llms[defaultLlm]
    if (!isRecord(entry)) {
      warnings.push(`default_llm = "${defaultLlm}" but [llm.${defaultLlm}] is not defined — falling back to ClickZetta`)
    } else {
      const provider = asString(entry.provider)
      const apiKey = asString(entry.api_key)
      if (!provider || !apiKey) {
        warnings.push(`[llm.${defaultLlm}] missing required fields — falling back to ClickZetta`)
      } else if (!VALID_PROVIDERS.includes(provider as (typeof VALID_PROVIDERS)[number])) {
        warnings.push(`[llm.${defaultLlm}] unknown provider "${provider}" — falling back to ClickZetta`)
      }
    }
  }

  return { providers, warnings }
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
  const profiles = isRecord(parsed.profiles) ? parsed.profiles : {}
  const profileSection = isRecord(profiles[defaultProfile]) ? profiles[defaultProfile] : undefined
  const llms = isRecord(parsed.llm) ? parsed.llm : {}

  if (profileSection && (asString(profileSection.api_key) || asString(profileSection.aimesh_endpoint))) {
    return { hasValidConfig: true, warnings }
  }

  for (const raw of Object.values(llms)) {
    if (!isRecord(raw)) continue
    if (asString(raw.provider) && asString(raw.api_key)) return { hasValidConfig: true, warnings }
  }

  return { hasValidConfig: false, warnings }
}
