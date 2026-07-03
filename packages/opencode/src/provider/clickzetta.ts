type ClickZettaModel = {
  [key: string]: unknown
  name?: string
  tool_call: boolean
  reasoning: boolean
  attachment: boolean
  temperature: boolean
  limit: { context: number; output: number }
  modalities: { input: string[]; output: string[] }
}

// ClickZetta Aimesh model catalog — hardcoded because ClickZetta is not in models.dev.
export const CLICKZETTA_MODELS = {
  "deepseek/deepseek-v4-pro": {
    id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", family: "deepseek",
    release_date: "2025-05-01", attachment: false, reasoning: true, tool_call: true, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 1, output: 4, cache_read: 0.1, cache_write: 1 },
    limit: { context: 128000, output: 16384 },
  },
  "deepseek/deepseek-v4-flash": {
    id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", family: "deepseek",
    release_date: "2025-05-01", attachment: false, reasoning: false, tool_call: true, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 0.5, output: 1.5, cache_read: 0.05, cache_write: 0.5 },
    limit: { context: 128000, output: 16384 },
  },
  "deepseek/deepseek-v3.2": {
    id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2", family: "deepseek",
    release_date: "2025-03-01", attachment: false, reasoning: false, tool_call: true, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 0.5, output: 1.5, cache_read: 0.05, cache_write: 0.5 },
    limit: { context: 128000, output: 16384 },
  },
  "deepseek/deepseek-r1": {
    id: "deepseek/deepseek-r1", name: "DeepSeek R1", family: "deepseek",
    release_date: "2025-01-01", attachment: false, reasoning: true, tool_call: false, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 1, output: 4, cache_read: 0.1, cache_write: 1 },
    limit: { context: 128000, output: 16384 },
  },
  "qwen/qwen3.6-plus": {
    id: "qwen/qwen3.6-plus", name: "Qwen3.6 Plus", family: "qwen",
    release_date: "2025-07-01", attachment: false, reasoning: true, tool_call: true, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 0.8, output: 3.2, cache_read: 0.08, cache_write: 0.8 },
    limit: { context: 128000, output: 16384 },
  },
  "qwen/qwen3.6-max-preview": {
    id: "qwen/qwen3.6-max-preview", name: "Qwen3.6 Max Preview", family: "qwen",
    release_date: "2025-07-01", attachment: false, reasoning: true, tool_call: true, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 1.6, output: 6.4, cache_read: 0.16, cache_write: 1.6 },
    limit: { context: 128000, output: 16384 },
  },
  "qwen/qwen3.6-flash": {
    id: "qwen/qwen3.6-flash", name: "Qwen3.6 Flash", family: "qwen",
    release_date: "2025-07-01", attachment: false, reasoning: false, tool_call: true, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 0.2, output: 0.6, cache_read: 0.02, cache_write: 0.2 },
    limit: { context: 128000, output: 16384 },
  },
  "qwen/qwen3.5-plus": {
    id: "qwen/qwen3.5-plus", name: "Qwen3.5 Plus", family: "qwen",
    release_date: "2025-07-01", attachment: false, reasoning: true, tool_call: true, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 0.8, output: 3.2, cache_read: 0.08, cache_write: 0.8 },
    limit: { context: 128000, output: 16384 },
  },
  "qwen/qwen3.5-flash": {
    id: "qwen/qwen3.5-flash", name: "Qwen3.5 Flash", family: "qwen",
    release_date: "2025-07-01", attachment: false, reasoning: false, tool_call: true, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 0.2, output: 0.6, cache_read: 0.02, cache_write: 0.2 },
    limit: { context: 128000, output: 16384 },
  },
  "qwen/qwen3-max": {
    id: "qwen/qwen3-max", name: "Qwen3 Max", family: "qwen",
    release_date: "2025-05-01", attachment: false, reasoning: true, tool_call: true, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 1.6, output: 6.4, cache_read: 0.16, cache_write: 1.6 },
    limit: { context: 128000, output: 16384 },
  },
  "qwen/qwen3-max-preview": {
    id: "qwen/qwen3-max-preview", name: "Qwen3 Max Preview", family: "qwen",
    release_date: "2025-05-01", attachment: false, reasoning: true, tool_call: true, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 1.6, output: 6.4, cache_read: 0.16, cache_write: 1.6 },
    limit: { context: 128000, output: 16384 },
  },
  "qwen/qwen3-coder-plus": {
    id: "qwen/qwen3-coder-plus", name: "Qwen3 Coder Plus", family: "qwen",
    release_date: "2025-07-01", attachment: false, reasoning: true, tool_call: true, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 1.2, output: 4.8, cache_read: 0.12, cache_write: 1.2 },
    limit: { context: 128000, output: 16384 },
  },
  "qwen/qwen3-coder-flash": {
    id: "qwen/qwen3-coder-flash", name: "Qwen3 Coder Flash", family: "qwen",
    release_date: "2025-07-01", attachment: false, reasoning: false, tool_call: true, temperature: true,
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    cost: { input: 0.3, output: 0.9, cache_read: 0.03, cache_write: 0.3 },
    limit: { context: 128000, output: 16384 },
  },
} satisfies Record<string, ClickZettaModel>

export const CLICKZETTA_PROVIDER_ENTRY = {
  id: "clickzetta",
  name: "ClickZetta",
  // cz_change: the ClickZetta AI-gateway shell over @ai-sdk/openai-compatible —
  // same wire protocol plus billing/quota error rewriting. Resolved via
  // BUNDLED_PROVIDERS in provider.ts.
  npm: "@clickzetta/ai-gateway",
  api: "",
  env: ["CLICKZETTA_API_KEY"],
  models: CLICKZETTA_MODELS,
}

// Single source of truth for "is this a ClickZetta AI-gateway provider".
//
// ClickZetta uses npm "@ai-sdk/openai-compatible" (indistinguishable from any
// other OpenAI-compatible provider by SDK alone), so identity is carried by the
// gateway baseURL instead of a synthetic options field. The toml→runtime mapping
// (config/profiles-llm.ts) defaults a clickzetta entry's baseURL to
// CLICKZETTA_DEFAULT_GATEWAY_URL when unset, guaranteeing this signal is always
// present — so rotation/traceparent can recognize the gateway by URL.
export const CLICKZETTA_DEFAULT_GATEWAY_URL = "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1"

export function isClickzettaGatewayUrl(url: string | undefined): boolean {
  if (typeof url !== "string" || url === "") return false
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  return host === "clickzetta.com" || host.endsWith(".clickzetta.com")
}

