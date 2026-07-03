import { existsSync, readFileSync } from "fs"
import os from "os"
import path from "path"
import { parse as parseToml } from "smol-toml"

export interface ProfilesLlmGuardResult {
  hasValidConfig: boolean
  warnings: string[]
}

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


function getProfiles(data: Record<string, unknown>) {
  return isRecord(data.profiles) ? data.profiles : {}
}

function getLlms(data: Record<string, unknown>) {
  return isRecord(data.llm) ? data.llm : {}
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
