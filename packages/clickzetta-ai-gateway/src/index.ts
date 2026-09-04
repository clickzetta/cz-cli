import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type {
  OpenAICompatibleProvider,
  OpenAICompatibleProviderSettings,
} from "@ai-sdk/openai-compatible"
import { APICallError } from "@ai-sdk/provider"
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  SharedV3Headers,
  SharedV3ProviderMetadata,
} from "@ai-sdk/provider"
import { rewriteClickzettaGatewayError } from "./gateway-error"
import { parseClickzettaQuota, type ClickzettaQuota } from "./quota"
import { normalizeClickzettaGatewayUrl } from "./url"

/**
 * @clickzetta/ai-gateway — a thin shell over @ai-sdk/openai-compatible for the
 * ClickZetta AI gateway.
 *
 * ClickZetta speaks the OpenAI-compatible wire protocol, so the base SDK does
 * all the real work. This shell adds two behaviours:
 *
 *  - when the gateway returns a billing / quota error, the raw APICallError is
 *    rewritten into an actionable, user-facing message and marked non-retryable —
 *    so the retry loop stops and the user sees a clear next step instead of a raw
 *    429/402 body;
 *  - the key's remaining token quota, which the gateway reports on every
 *    successful completion's headers, is published as
 *    `providerMetadata.clickzetta.quota` — on the result for doGenerate, on the
 *    "finish" part for doStream, which is where per-step metadata is read. From
 *    there opencode carries it onto the step-finish part and the sidebar reads it
 *    off its own state store. See quota.ts.
 *
 * Everything else (model listing, streaming, tool calls, prompt caching) passes
 * straight through.
 */

/** Read the gateway's `code` off the parsed error payload the SDK kept for us. */
function errorCode(error: APICallError): string | undefined {
  const data = error.data
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined
  const nested = (data as { error?: unknown }).error
  const from = (value: unknown) => {
    if (!value || typeof value !== "object") return undefined
    const code = (value as { code?: unknown }).code
    return typeof code === "string" ? code : undefined
  }
  return from(nested) ?? from(data)
}

/** Rebuild an APICallError with a rewritten message and forced retryability. */
function rewriteApiCallError(error: APICallError): APICallError {
  const rewrite = rewriteClickzettaGatewayError({
    statusCode: error.statusCode,
    message: error.message,
    responseBody: error.responseBody,
    // `data` is the schema-parsed body; passing its code lets the rewriter
    // classify by code even when the message wording gives nothing away.
    code: errorCode(error),
  })
  if (!rewrite) return error
  return new APICallError({
    message: rewrite.message,
    url: error.url,
    requestBodyValues: error.requestBodyValues,
    statusCode: error.statusCode,
    responseHeaders: error.responseHeaders,
    responseBody: error.responseBody,
    cause: error.cause,
    isRetryable: rewrite.isRetryable,
    data: error.data,
  })
}

/**
 * A 429 from the gateway is a quota ceiling, not congestion.
 *
 * The AI SDK marks every 429 retryable, so the loop backs off and retries a call
 * that cannot succeed until the quota resets — burning the user's time to arrive
 * at the same error. The documented guidance for 429 is to lower concurrency and
 * back off, which is the caller's decision to make, not something to spend
 * retries discovering. Applies to any 429 the gateway returns; nothing here reads
 * the response body.
 */
function suppressQuotaRetry(error: APICallError): APICallError {
  if (error.statusCode !== 429 || !error.isRetryable) return error
  return new APICallError({
    message: error.message,
    url: error.url,
    requestBodyValues: error.requestBodyValues,
    statusCode: error.statusCode,
    responseHeaders: error.responseHeaders,
    responseBody: error.responseBody,
    cause: error.cause,
    isRetryable: false,
    data: error.data,
  })
}

/** Map any thrown value through the rewriter; non-APICallErrors pass through. */
function mapThrown(error: unknown): unknown {
  if (!APICallError.isInstance(error)) return error
  return suppressQuotaRetry(rewriteApiCallError(error))
}

const CLICKZETTA_CACHE_CONTROL_MODELS = new Set(["qwen/qwen3.6-plus"])

export function applyClickzettaPromptCaching(prompt: LanguageModelV3CallOptions["prompt"], modelId: string) {
  if (!CLICKZETTA_CACHE_CONTROL_MODELS.has(modelId)) return prompt
  const system = prompt.find((message) => message.role === "system")
  if (!system || typeof system.content !== "string" || system.content === "") return prompt
  return prompt.map((message) => {
    if (message !== system) return message
    return {
      ...message,
      content: [
        {
          type: "text",
          text: system.content,
          cache_control: { type: "ephemeral" },
        },
      ],
    }
  }) as unknown as LanguageModelV3CallOptions["prompt"]
}

function withClickzettaPromptCaching(options: LanguageModelV3CallOptions, modelId: string): LanguageModelV3CallOptions {
  const prompt = applyClickzettaPromptCaching(options.prompt, modelId)
  if (prompt === options.prompt) return options
  return { ...options, prompt }
}

/**
 * Parse the quota off a response's headers.
 *
 * Guarded because an HTTP call that already succeeded must not fail over a defect in
 * quota reporting: in doStream a throw here would escape uncaught, and in doGenerate
 * `mapThrown` would dress it up as a ClickZetta gateway error.
 */
function quotaFromHeaders(headers: SharedV3Headers | undefined): ClickzettaQuota[] | undefined {
  try {
    return parseClickzettaQuota(headers)
  } catch {
    return undefined
  }
}

/**
 * Publish the quota on a result's provider metadata, leaving any metadata the base
 * provider already set untouched. Returns the input unchanged when there is nothing
 * to add, so a response the wrapper has nothing to say about stays identical.
 */
function withQuota(
  metadata: SharedV3ProviderMetadata | undefined,
  quota: ClickzettaQuota[] | undefined,
): SharedV3ProviderMetadata | undefined {
  if (!quota) return metadata
  return {
    ...metadata,
    clickzetta: { ...metadata?.clickzetta, quota },
  }
}

/**
 * Wrap a LanguageModelV3 so doGenerate/doStream errors run through the rewriter.
 * Delegates every other member to the underlying model via prototype so future
 * SDK additions keep working without changes here.
 */
function wrapModel(model: LanguageModelV3, modelId: string): LanguageModelV3 {
  const doGenerate = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => {
    try {
      const result = await model.doGenerate(withClickzettaPromptCaching(options, modelId))
      const quota = quotaFromHeaders(result.response?.headers)
      const providerMetadata = withQuota(result.providerMetadata, quota)
      // Same object back when the gateway reported no quota, so a response the
      // wrapper has nothing to add to stays byte-identical.
      return providerMetadata === result.providerMetadata ? result : { ...result, providerMetadata }
    } catch (error) {
      throw mapThrown(error)
    }
  }

  const doStream = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
    let result: LanguageModelV3StreamResult
    try {
      result = await model.doStream(withClickzettaPromptCaching(options, modelId))
    } catch (error) {
      throw mapThrown(error)
    }
    // Headers are already available here — they arrive before the body — but the quota is
    // published on the "finish" part below, because that is where per-step metadata is read.
    // A turn aborted before finish reports no quota, which is correct: the sidebar shows
    // what a completed step reported.
    const quota = quotaFromHeaders(result.response?.headers)
    // HTTP errors usually reject doStream above, but the SDK can also surface a
    // late error as an in-stream "error" part — rewrite those too.
    const stream = result.stream.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          if (chunk?.type === "error") {
            controller.enqueue({ ...chunk, error: mapThrown(chunk.error) })
            return
          }
          if (chunk?.type === "finish") {
            const providerMetadata = withQuota(chunk.providerMetadata, quota)
            controller.enqueue(providerMetadata === chunk.providerMetadata ? chunk : { ...chunk, providerMetadata })
            return
          }
          controller.enqueue(chunk)
        },
      }),
    )
    return { ...result, stream }
  }

  return new Proxy(model, {
    get(target, prop, receiver) {
      if (prop === "doGenerate") return doGenerate
      if (prop === "doStream") return doStream
      const value = Reflect.get(target, prop, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

/**
 * The error-mapping wrapper, exposed for tests.
 *
 * `createClickzetta` closes over the base provider it builds, so there is no seam
 * to substitute a fake model through from outside. Exporting the wrapper lets the
 * suite drive doGenerate/doStream against a stub instead of the network — which is
 * the only way to cover the in-stream error branch and the Proxy delegation.
 */
export const wrapModelForTest = wrapModel

export type ClickzettaProviderSettings = OpenAICompatibleProviderSettings

/**
 * Create a ClickZetta AI-gateway provider. Drop-in replacement for
 * `createOpenAICompatible` — same settings, same returned shape — plus gateway
 * billing/quota error rewriting on every language model it hands out.
 */
export function createClickzetta(options: ClickzettaProviderSettings): OpenAICompatibleProvider {
  const base = createOpenAICompatible({
    ...options,
    baseURL: normalizeClickzettaGatewayUrl(options.baseURL),
  })

  // No endpoint/key attribution here: the quota rides the assistant message that
  // reported it, and that message already names the provider it was served by — so the
  // sidebar matches on providerID rather than on a credential the provider had to carry.
  const languageModel = (modelId: string): LanguageModelV3 => wrapModel(base.languageModel(modelId), modelId)

  const provider = ((modelId: string) => languageModel(modelId)) as OpenAICompatibleProvider
  provider.languageModel = languageModel
  provider.chatModel = (modelId: string) => wrapModel(base.chatModel(modelId), modelId)
  provider.completionModel = base.completionModel.bind(base)
  provider.embeddingModel = base.embeddingModel.bind(base)
  provider.textEmbeddingModel = base.textEmbeddingModel.bind(base)
  provider.imageModel = base.imageModel.bind(base)
  return provider
}

export { createClickzetta as createOpenAICompatible }
export { normalizeClickzettaGatewayUrl } from "./url"
export {
  parseClickzettaQuota,
  formatClickzettaQuota,
  type ClickzettaQuota,
  type ClickzettaQuotaPeriod,
} from "./quota"
export {
  rewriteClickzettaGatewayError,
  clickzettaGatewayCode,
  isClickzettaBillingCode,
  parseGatewayBody,
  TENANT_OVER_QUOTA_MESSAGE,
  FREE_KEY_EXHAUSTED_MESSAGE,
  KEY_QUOTA_EXHAUSTED_MESSAGE,
  clickzettaKeyAlias,
  type GatewayErrorCode,
  type GatewayErrorInput,
  type GatewayErrorRewrite,
} from "./gateway-error"
