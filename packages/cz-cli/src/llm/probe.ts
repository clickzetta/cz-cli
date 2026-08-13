import { normalizeClickzettaGatewayUrl } from "./clickzetta-provider.js"

export function normalizeLlmBaseUrl(provider: string, url: string | undefined) {
  if (!url) return undefined
  let baseURL = url.replace(/\/+$/, "")
  if (provider === "clickzetta") return normalizeClickzettaGatewayUrl(baseURL)
  const needsVersionPrefix = ["anthropic", "openai", "openai-compatible"].includes(provider)
  const hasVersionPath = /\/v\d+(\/|$)/.test(baseURL) || /\/openai(\/|$)/.test(baseURL)
  if (needsVersionPrefix && !hasVersionPath) baseURL += "/v1"
  return baseURL
}

/**
 * cz_change: the first model the gateway actually serves this key, for probing.
 *
 * `agent llm test` needs SOME model id to send a chat request. For ClickZetta entries
 * llm.json never stores one (native-config.ts providerFromInput deliberately keeps no
 * catalog — it is discovered at runtime), so the probe fell back to a hardcoded
 * DEFAULT_PROBE_MODELS id. On a tenant that does not serve that id, `llm test`
 * reported a 404 failure for an entry the TUI was using happily: two surfaces, two
 * verdicts, from the same credential.
 *
 * Asking the catalog first makes the verdicts agree — the probe uses a model the
 * gateway just said it has, which is exactly the set the TUI's picker is built from.
 * Best-effort: any failure returns undefined and the caller keeps the old default, so
 * the diagnostic never gets worse than before. The URL is built from the same
 * normalizer every other reader uses; opencode's discovery loop carries its own copy
 * of this concat (provider/provider.ts clickzettaModelsUrl) because it cannot import
 * from this package.
 */
export async function firstClickzettaModel(baseUrl: string | undefined, apiKey: string): Promise<string | undefined> {
  const base = normalizeLlmBaseUrl("clickzetta", baseUrl)
  if (!base) return undefined
  try {
    const response = await fetch(`${base}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!response.ok) return undefined
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> }
    for (const entry of body.data ?? []) if (typeof entry?.id === "string") return entry.id
    return undefined
  } catch {
    return undefined
  }
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

  if (provider === "bedrock") return undefined

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
