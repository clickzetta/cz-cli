import { parse as parseToml } from "smol-toml"

export interface ProfilesLlmResult {
  /**
   * Keyed by real provider id ("clickzetta", "anthropic", "openai", ...).
   * Each entry has only options — models come from models.dev (or hardcoded
   * database injection for "clickzetta").
   */
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

/**
 * Append /v1 when the SDK expects it and the user supplied a bare host.
 */
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

/**
 * Parse ~/.clickzetta/profiles.toml.
 *
 * Returns a `providers` dict keyed by real provider id, plus an optional
 * default `model` string.
 *
 * Selection priority for `model`:
 *   1. `default_llm = "<name>"` → `[llm.<name>]` → that provider's default
 *   2. ClickZetta aimesh from `[profiles.<default>]` → `clickzetta/deepseek-v4-pro`
 *
 * All defined `[llm.*]` entries are always registered (not just the selected one),
 * so /models shows every configured provider.
 */
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

  const defaultProfile = asString(parsed.default_profile) ?? "default"
  const defaultLlm = asString(parsed.default_llm)

  const profiles = isRecord(parsed.profiles) ? parsed.profiles : {}
  const profileSection = isRecord(profiles[defaultProfile]) ? profiles[defaultProfile] : undefined

  // Warn once about legacy fields — they are ignored.
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

  // Register ClickZetta aimesh as "clickzetta" provider.
  // Only inject baseURL — apiKey comes from auth.json (written by setup.ts).
  // This way /connect can manage the key via the standard auth path.
  if (profileSection) {
    const aimeshEndpoint = asString(profileSection.aimesh_endpoint)
    const apiKey = asString(profileSection.api_key)
    if (aimeshEndpoint || apiKey) {
      const baseURL = normalizeLlmBaseUrl("clickzetta", aimeshEndpoint)
      // Include apiKey as fallback for users who haven't re-run setup after this change.
      // auth.json takes precedence via the provider custom() hook.
      const opts: { baseURL?: string; apiKey?: string } = {}
      if (baseURL) opts.baseURL = baseURL
      if (apiKey) opts.apiKey = apiKey
      providers["clickzetta"] = { options: opts as { apiKey: string; baseURL?: string } }
    }
  }

  // Register all [llm.*] entries under their real provider ids.
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
    // Later entries for the same provider id overwrite earlier ones.
    providers[provider] = { options: { apiKey, ...(baseURL && { baseURL }) } }
  }

  // Validate default_llm and emit warnings — but don't set config.model.
  // opencode's sort(release_date desc) picks the best available model, same as original opencode.
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

/**
 * Guard: returns true if the user has at least one usable LLM configured.
 */
export function hasUsableLlm(toml: string): ProfilesLlmGuardResult {
  const warnings: string[] = []
  let parsed: unknown
  try {
    parsed = parseToml(toml)
  } catch {
    return { hasValidConfig: false, warnings }
  }
  if (!isRecord(parsed)) return { hasValidConfig: false, warnings }

  const defaultProfile = asString(parsed.default_profile) ?? "default"
  const profiles = isRecord(parsed.profiles) ? parsed.profiles : {}
  const profileSection = isRecord(profiles[defaultProfile]) ? profiles[defaultProfile] : undefined
  const llms = isRecord(parsed.llm) ? parsed.llm : {}

  // ClickZetta: accept if api_key OR aimesh_endpoint present (key may be in auth.json)
  if (profileSection && (asString(profileSection.api_key) || asString(profileSection.aimesh_endpoint))) {
    return { hasValidConfig: true, warnings }
  }

  for (const raw of Object.values(llms)) {
    if (!isRecord(raw)) continue
    if (asString(raw.provider) && asString(raw.api_key)) return { hasValidConfig: true, warnings }
  }

  return { hasValidConfig: false, warnings }
}
