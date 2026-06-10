import {
  CLICKZETTA_ROTATION_CANCEL_LABEL,
  CLICKZETTA_ROTATION_CONFIRM_LABEL,
  CLICKZETTA_ROTATION_HEADER,
  CLICKZETTA_ROTATION_PROMPT,
  isClickzettaFreeQuotaErrorDetail,
  isClickzettaVirtualKeyQuotaErrorDetail,
} from "@clickzetta/cli/llm/clickzetta-rotation"

export const AI_GATEWAY_QUOTA_URL = "https://aitoken.clickzetta.com/apikey"
export const AI_GATEWAY_QUOTA_MESSAGE =
  "Your complimentary token quota has been exhausted.\nWe also offer competitively priced paid token plans, and I'd be happy to help you create and configure a paid API key."
export const AI_GATEWAY_API_KEY_QUOTA_MESSAGE =
  `The current API key has run out of quota.\nPlease go to ${AI_GATEWAY_QUOTA_URL} to add quota, or configure another token service source.`
export const AI_GATEWAY_QUOTA_CONFIGURE_MODEL_LABEL = "Configure my own model"
export const AI_GATEWAY_QUOTA_QUOTA_UPDATED_LABEL = "I've updated the quota"
export const AI_GATEWAY_QUOTA_HEADER = "Quota"

export const CUSTOM_MODEL_PROVIDER_OPTIONS = [
  { label: "clickzetta", description: "Use ClickZetta AI Gateway." },
  { label: "openai-compatible", description: "Use an OpenAI-compatible endpoint." },
  { label: "openai", description: "Use OpenAI." },
  { label: "anthropic", description: "Use Anthropic." },
  { label: "google", description: "Use Google Gemini." },
  { label: "openrouter", description: "Use OpenRouter." },
  { label: "azure", description: "Use Azure OpenAI." },
]

// Per-provider metadata for the second step of the configure flow.
const PROVIDER_META: Record<string, {
  defaultBaseURL?: string
  modelOptions?: { label: string; description: string }[]
  skipModel?: boolean
}> = {
  clickzetta: {
    skipModel: true,
    defaultBaseURL: "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1",
  },
  openai: {
    // SDK uses its own default endpoint; only needed for proxies.
    modelOptions: [
      { label: "gpt-4.1", description: "Most capable GPT-4.1 model." },
      { label: "gpt-4.1-mini", description: "Fast and affordable GPT-4.1 Mini." },
      { label: "o4-mini", description: "Reasoning model, efficient." },
    ],
  },
  anthropic: {
    // SDK uses its own default endpoint; only needed for proxies.
    modelOptions: [
      { label: "claude-sonnet-4-6", description: "Most capable Claude Sonnet." },
      { label: "claude-haiku-4-5-20251001", description: "Fast and affordable Haiku." },
      { label: "claude-opus-4-8", description: "Most powerful Claude model." },
    ],
  },
  google: {
    // SDK uses its own default endpoint; only needed for proxies.
    modelOptions: [
      { label: "gemini-2.5-pro", description: "Most capable Gemini model." },
      { label: "gemini-2.0-flash", description: "Fast and affordable." },
    ],
  },
  openrouter: {
    defaultBaseURL: "https://openrouter.ai/api/v1",
    modelOptions: [
      { label: "openai/gpt-4.1", description: "GPT-4.1 via OpenRouter." },
      { label: "anthropic/claude-sonnet-4-6", description: "Claude Sonnet via OpenRouter." },
    ],
  },
  "openai-compatible": {
    modelOptions: [],
  },
  azure: {
    modelOptions: [],
  },
  bedrock: {
    modelOptions: [],
  },
}

export function isClickzettaAiGatewayQuotaExhausted(input: {
  providerType?: string
  statusCode?: number
  message?: string
  responseBody?: string
}) {
  if (input.providerType !== "clickzetta") return false
  if (input.statusCode !== 429) return false
  const detail = [input.message, input.responseBody].filter((value): value is string => typeof value === "string").join("\n")
  return isClickzettaFreeQuotaErrorDetail(detail)
}

export function isClickzettaAiGatewayApiKeyQuotaExhausted(input: {
  providerType?: string
  statusCode?: number
  message?: string
  responseBody?: string
}) {
  if (input.providerType !== "clickzetta") return false
  if (input.statusCode !== 429) return false
  const detail = [input.message, input.responseBody].filter((value): value is string => typeof value === "string").join("\n")
  return isClickzettaVirtualKeyQuotaErrorDetail(detail) && !isClickzettaFreeQuotaErrorDetail(detail)
}

export function clickzettaQuotaRecoveryQuestion() {
  return {
    header: AI_GATEWAY_QUOTA_HEADER,
    question: AI_GATEWAY_QUOTA_MESSAGE,
    custom: false,
    options: [
      {
        label: AI_GATEWAY_QUOTA_CONFIGURE_MODEL_LABEL,
        description: "Configure a provider, base URL, and API key for your own model.",
      },
      {
        label: AI_GATEWAY_QUOTA_QUOTA_UPDATED_LABEL,
        description: "Close this prompt after updating quota, then send your request again.",
      },
    ],
  }
}

export function clickzettaFreeQuotaRotationQuestion() {
  return {
    header: CLICKZETTA_ROTATION_HEADER,
    question: CLICKZETTA_ROTATION_PROMPT,
    custom: false,
    options: [
      {
        label: CLICKZETTA_ROTATION_CONFIRM_LABEL,
        description: "Create and switch to a new ClickZetta virtual key.",
      },
      {
        label: CLICKZETTA_ROTATION_CANCEL_LABEL,
        description: "Keep the current key and stop retrying.",
      },
    ],
  }
}

export function clickzettaQuotaProviderQuestion() {
  return {
    header: "Provider",
    question: "Select the provider for your model.",
    custom: true,
    options: CUSTOM_MODEL_PROVIDER_OPTIONS,
  }
}

export function clickzettaQuotaModelQuestions(provider: string) {
  const meta = PROVIDER_META[provider] ?? {}
  const questions: {
    header: string
    question: string
    custom: boolean
    required?: boolean
    defaultValue?: string
    options: { label: string; description: string }[]
  }[] = []

  if (!meta.skipModel) {
    questions.push({
      header: "Model",
      question: "Select or enter the model ID.",
      custom: true,
      required: true,
      options: meta.modelOptions ?? [],
    })
  }

  const baseURLDescription = meta.defaultBaseURL
    ? `Enter the base URL (leave blank to use default: ${meta.defaultBaseURL}).`
    : "Enter the base URL, or leave blank to use the provider's built-in default."
  questions.push({
    header: "Base URL",
    question: baseURLDescription,
    custom: true,
    ...(meta.defaultBaseURL && { defaultValue: meta.defaultBaseURL }),
    options: meta.defaultBaseURL
      ? [{ label: meta.defaultBaseURL, description: "Default endpoint for this provider." }]
      : [],
  })

  questions.push({
    header: "API Key",
    question: "Enter the API key for your model provider.",
    custom: true,
    required: true,
    options: [],
  })

  questions.push({
    header: "Name",
    question: `Enter a name for this entry (default: ${provider}).`,
    custom: true,
    defaultValue: provider,
    options: [],
  })

  return questions
}

export function clickzettaQuotaNameConflictQuestion(name: string) {
  return {
    header: "Name conflict",
    question: `An entry named "${name}" already exists. Enter a different name.`,
    custom: true,
    required: true,
    options: [],
  }
}
