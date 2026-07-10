export function normalizeLlmBaseUrl(provider: string, url: string | undefined) {
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
