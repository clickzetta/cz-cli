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
import { recordGatewayQuota } from "./quota-store"
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
 *    `providerMetadata.clickzetta.quota` and cached for out-of-process readers,
 *    so a caller can show it without a second request or portal credentials.
 *    See quota.ts and quota-store.ts.
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
 * The endpoint/key a wrapped model answers for, so a quota reading can be filed
 * against the credential it describes. Absent when the provider was built without
 * an apiKey, in which case only the in-band metadata is published.
 */
type QuotaTarget = { baseURL: string; apiKey: string } | undefined

/**
 * Read the quota off a response's headers and cache it for the sidebar indicator,
 * which reads it from another process (quota-store.ts).
 *
 * Called as soon as the headers exist — for a stream that is when it opens, not when
 * it finishes. Caching at `finish` would throw away a reading already in hand
 * whenever the turn is aborted or errors mid-stream, and the numbers describe the
 * request's admission, so waiting adds nothing.
 *
 * Total: an HTTP call that already succeeded must not fail over a local cache. The
 * guard is HERE rather than at the two call sites so neither can forget it, and so a
 * third can't: `recordGatewayQuota` swallows its own write errors, but the parse and
 * the read-modify-write around it can still throw (a truncated store from a racing
 * writer, a homedir that resolves somewhere unreadable). In doStream that would
 * escape uncaught; in doGenerate it would be worse — `mapThrown` would dress a local
 * cache problem up as a ClickZetta gateway error.
 */
function recordQuota(headers: SharedV3Headers | undefined, target: QuotaTarget) {
  try {
    const quota = parseClickzettaQuota(headers)
    if (quota && target) recordGatewayQuota({ ...target, quotas: quota })
    return quota
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
function wrapModel(model: LanguageModelV3, modelId: string, target?: QuotaTarget): LanguageModelV3 {
  const doGenerate = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => {
    try {
      const result = await model.doGenerate(withClickzettaPromptCaching(options, modelId))
      const quota = recordQuota(result.response?.headers, target)
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
    // Response headers are already available here — they arrive before the body — so
    // the cache is written now, while the reading cannot be lost to an aborted turn.
    // Only the in-band publication waits for the "finish" part, because that is where
    // consumers read per-step metadata.
    const quota = recordQuota(result.response?.headers, target)
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

  // Recorded against the normalized URL so a reader that resolved the same endpoint
  // from llm.json's raw form lands on the same cache key.
  const target = options.apiKey ? { baseURL: normalizeClickzettaGatewayUrl(options.baseURL), apiKey: options.apiKey } : undefined
  const languageModel = (modelId: string): LanguageModelV3 => wrapModel(base.languageModel(modelId), modelId, target)

  const provider = ((modelId: string) => languageModel(modelId)) as OpenAICompatibleProvider
  provider.languageModel = languageModel
  provider.chatModel = (modelId: string) => wrapModel(base.chatModel(modelId), modelId, target)
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
  gatewayQuotaCacheKey,
  readGatewayQuota,
  recordGatewayQuota,
  type GatewayQuotaEntry,
} from "./quota-store"
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
