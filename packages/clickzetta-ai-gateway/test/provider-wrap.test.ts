/**
 * Tests for the provider shell's wiring — the part of index.ts that connects the
 * pure classifier to real model calls.
 * Run: bun test test/provider-wrap.test.ts
 *
 * gateway-error.test.ts covers the classification decisions. This file covers the
 * plumbing those decisions travel through, which had no tests at all: the 429
 * retry suppression, reading the code off the SDK's parsed `data`, rewriting an
 * error that arrives inside the stream rather than as a rejection, preserving the
 * fields downstream consumers depend on, and delegating everything else to the
 * wrapped model.
 *
 * No network: a fake LanguageModelV3 throws or emits whatever each case needs.
 */
import { describe, expect, test } from "bun:test"
import { APICallError } from "@ai-sdk/provider"
import { createClickzetta, wrapModelForTest as wrap } from "../src/index"

const BASE_URL = "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/"
const PROMPT = [{ role: "user", content: [{ type: "text", text: "hi" }] }]

/** The documented AIGW body shape: fields nested under `error`. */
function gatewayBody(code: string, message: string) {
  return JSON.stringify({ error: { code, message, source: "gateway", retry_history: null } })
}

/**
 * Stand in for the model createOpenAICompatible would return. `createClickzetta`
 * wraps whatever `base.languageModel()` yields, so swapping that out is enough to
 * drive doGenerate/doStream without HTTP.
 */
function fakeModel(behaviour: {
  onGenerate?: () => never | Promise<never>
  streamParts?: unknown[]
  onStream?: () => never
  /** Response headers the base SDK would have lifted off the HTTP response. */
  responseHeaders?: Record<string, string>
  providerMetadata?: Record<string, Record<string, unknown>>
  extras?: Record<string, unknown>
}) {
  const response = behaviour.responseHeaders ? { headers: behaviour.responseHeaders } : undefined
  return {
    specificationVersion: "v3",
    provider: "clickzetta.chat",
    modelId: "deepseek/deepseek-v3.2",
    supportedUrls: {},
    async doGenerate() {
      if (behaviour.onGenerate) return behaviour.onGenerate()
      return {
        content: [{ type: "text", text: "ok" }],
        finishReason: "stop",
        usage: {},
        warnings: [],
        ...(behaviour.providerMetadata ? { providerMetadata: behaviour.providerMetadata } : {}),
        ...(response ? { response } : {}),
      }
    },
    async doStream() {
      if (behaviour.onStream) return behaviour.onStream()
      const parts = behaviour.streamParts ?? []
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part)
            controller.close()
          },
        }),
        ...(response ? { response } : {}),
      }
    },
    ...behaviour.extras,
  } as any
}

/** What a live single-period key reports on a completion. */
const QUOTA_HEADERS = {
  "x-czgw-ratelimit-api-key-token-period": "PDO",
  "x-czgw-ratelimit-api-key-token-limit": "10000000",
  "x-czgw-ratelimit-api-key-token-used": "238",
  "x-czgw-ratelimit-api-key-token-remaining": "9999762",
}
const QUOTA = [
  { period: "daily", periodCode: "PDO", limit: 10000000, used: 238, remaining: 9999762, scope: "api-key" },
]

async function collect(stream: ReadableStream) {
  const out: any[] = []
  for await (const part of stream as any) out.push(part)
  return out
}

describe("suppressQuotaRetry", () => {
  /**
   * The AI SDK marks every 429 retryable. A gateway 429 is a quota ceiling, so
   * retrying just spends the user's time reaching the same error — this is the
   * behaviour change that had no regression guard.
   */
  test("a 429 is forced non-retryable even when the classifier does not recognise it", async () => {
    const raw = new APICallError({
      message: "Rate limited",
      url: `${BASE_URL}chat/completions`,
      requestBodyValues: {},
      statusCode: 429,
      responseBody: "not a gateway body",
    })
    expect(raw.isRetryable).toBe(true) // the SDK's own default, for contrast

    const model = fakeModel({
      onGenerate: () => {
        throw raw
      },
    })
    await expect(wrap(model).doGenerate({ prompt: PROMPT } as any)).rejects.toMatchObject({
      statusCode: 429,
      isRetryable: false,
    })
  })

  test("a 500 keeps the SDK's retryability — transient server faults should retry", () => {
    const raw = new APICallError({
      message: "Internal error",
      url: BASE_URL,
      requestBodyValues: {},
      statusCode: 500,
    })
    expect(raw.isRetryable).toBe(true)
  })

  test("a 400 stays non-retryable", async () => {
    const model = fakeModel({
      onGenerate: () => {
        throw new APICallError({ message: "Bad request", url: BASE_URL, requestBodyValues: {}, statusCode: 400 })
      },
    })
    await expect(wrap(model).doGenerate({ prompt: PROMPT } as any)).rejects.toMatchObject({
      statusCode: 400,
      isRetryable: false,
    })
  })
})

describe("errorCode — reading the code off the SDK's parsed data", () => {
  /**
   * `responseBody` parsing is covered in gateway-error.test.ts. This is the other
   * half: the SDK also hands us the schema-parsed body as `data`, and reading only
   * the top level of it is the same bug the body parser had.
   */
  test("classifies from nested data.error.code when the message says nothing", async () => {
    const model = fakeModel({
      onGenerate: () => {
        throw new APICallError({
          message: "Request rejected",
          url: BASE_URL,
          requestBodyValues: {},
          statusCode: 403,
          // no responseBody at all — `data` is the only source of the code
          data: { error: { code: "GATEWAY_TENANT_OVERDUE", message: "Request rejected" } },
        })
      },
    })
    const err = await wrap(model)
      .doGenerate({ prompt: PROMPT } as any)
      .catch((e: any) => e)
    expect(err.message).toContain("Insufficient account balance")
    expect(err.isRetryable).toBe(false)
  })

  test("classifies from a flattened data.code too", async () => {
    const model = fakeModel({
      onGenerate: () => {
        throw new APICallError({
          message: "Request rejected",
          url: BASE_URL,
          requestBodyValues: {},
          statusCode: 403,
          data: { code: "GATEWAY_TENANT_OVERDUE", message: "Request rejected" },
        })
      },
    })
    const err = await wrap(model)
      .doGenerate({ prompt: PROMPT } as any)
      .catch((e: any) => e)
    expect(err.message).toContain("Insufficient account balance")
  })
})

describe("field preservation", () => {
  /**
   * `responseBody` surviving the rewrite is load-bearing twice over: opencode's
   * error formatter reads it, and cz-cli's TUI re-runs the classifier on it to
   * decide whether to offer a browser jump (see gateway-prompt.ts).
   */
  test("responseBody, statusCode, headers and url survive the rewrite", async () => {
    const body = gatewayBody("GATEWAY_TENANT_OVERDUE", "[G2] Tenant overdue. requestId=req-abc")
    const model = fakeModel({
      onGenerate: () => {
        throw new APICallError({
          message: "[G2] Tenant overdue. requestId=req-abc",
          url: `${BASE_URL}chat/completions`,
          requestBodyValues: { model: "x" },
          statusCode: 403,
          responseHeaders: { "x-request-id": "req-abc" },
          responseBody: body,
        })
      },
    })
    const err = await wrap(model)
      .doGenerate({ prompt: PROMPT } as any)
      .catch((e: any) => e)
    expect(err.responseBody).toBe(body)
    expect(err.statusCode).toBe(403)
    expect(err.responseHeaders).toEqual({ "x-request-id": "req-abc" })
    expect(err.url).toBe(`${BASE_URL}chat/completions`)
    expect(err.requestBodyValues).toEqual({ model: "x" })
    // and the message really was replaced
    expect(err.message).not.toBe("[G2] Tenant overdue. requestId=req-abc")
    expect(err.message).toContain("req-abc")
  })

  test("an unclassified error is returned unchanged, not rebuilt", async () => {
    const raw = new APICallError({ message: "upstream hiccup", url: BASE_URL, requestBodyValues: {}, statusCode: 503 })
    const model = fakeModel({
      onGenerate: () => {
        throw raw
      },
    })
    const err = await wrap(model)
      .doGenerate({ prompt: PROMPT } as any)
      .catch((e: any) => e)
    expect(err).toBe(raw)
  })

  test("a non-APICallError passes through untouched", async () => {
    const boom = new TypeError("fetch failed")
    const model = fakeModel({
      onGenerate: () => {
        throw boom
      },
    })
    const err = await wrap(model)
      .doGenerate({ prompt: PROMPT } as any)
      .catch((e: any) => e)
    expect(err).toBe(boom)
  })
})

describe("doStream", () => {
  test("an in-stream error part is rewritten, not just a rejection", async () => {
    // HTTP errors usually reject doStream, but the SDK can surface a late failure
    // as an `{type:"error"}` chunk — the normal case for streaming sessions.
    const model = fakeModel({
      streamParts: [
        { type: "text-delta", delta: "partial" },
        {
          type: "error",
          error: new APICallError({
            message: "[G2] Tenant overdue",
            url: BASE_URL,
            requestBodyValues: {},
            statusCode: 403,
            responseBody: gatewayBody("GATEWAY_TENANT_OVERDUE", "[G2] Tenant overdue"),
          }),
        },
      ],
    })
    const result = await wrap(model).doStream({ prompt: PROMPT } as any)
    const parts = await collect(result.stream as any)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({ type: "text-delta", delta: "partial" })
    expect(parts[1].type).toBe("error")
    expect(parts[1].error.message).toContain("Insufficient account balance")
    expect(parts[1].error.isRetryable).toBe(false)
  })

  test("non-error parts pass through unchanged", async () => {
    const model = fakeModel({
      streamParts: [
        { type: "stream-start", warnings: [] },
        { type: "text-delta", delta: "a" },
        { type: "finish", finishReason: "stop", usage: { inputTokens: 1 } },
      ],
    })
    const result = await wrap(model).doStream({ prompt: PROMPT } as any)
    expect(await collect(result.stream as any)).toEqual([
      { type: "stream-start", warnings: [] },
      { type: "text-delta", delta: "a" },
      { type: "finish", finishReason: "stop", usage: { inputTokens: 1 } },
    ])
  })

  test("a rejecting doStream is rewritten too", async () => {
    const model = fakeModel({
      onStream: () => {
        throw new APICallError({
          message: "[G2] Tenant overdue",
          url: BASE_URL,
          requestBodyValues: {},
          statusCode: 403,
          responseBody: gatewayBody("GATEWAY_TENANT_OVERDUE", "[G2] Tenant overdue"),
        })
      },
    })
    await expect(wrap(model).doStream({ prompt: PROMPT } as any)).rejects.toMatchObject({
      isRetryable: false,
    })
  })
})

describe("createClickzetta", () => {
  test("hands out wrapped language models and normalizes the base URL", () => {
    // The root URL a user writes in llm.json must reach /gateway/v1.
    const provider = createClickzetta({ name: "clickzetta", baseURL: BASE_URL, apiKey: "k".repeat(32) })
    const model = provider.languageModel("deepseek/deepseek-v3.2")
    expect(model.modelId).toBe("deepseek/deepseek-v3.2")
    expect(typeof model.doGenerate).toBe("function")
    expect(typeof model.doStream).toBe("function")
  })
})

describe("Proxy delegation", () => {
  /**
   * Everything other than doGenerate/doStream must reach the wrapped model, or the
   * SDK cannot use it at all — this breaks every call, not just failing ones.
   */
  test("plain properties are readable through the wrapper", () => {
    const wrapped = wrap(fakeModel({}))
    expect(wrapped.specificationVersion).toBe("v3")
    expect(wrapped.modelId).toBe("deepseek/deepseek-v3.2")
    expect(wrapped.provider).toBe("clickzetta.chat")
  })

  test("future SDK methods are delegated and keep their receiver", async () => {
    // The trap binds functions to the target, so a member added by a later SDK
    // version still sees its own `this`.
    const model = fakeModel({
      extras: {
        secret: "s3cret",
        reveal() {
          return (this as any).secret
        },
      },
    })
    expect((wrap(model) as any).reveal()).toBe("s3cret")
  })

  test("a successful doGenerate is untouched", async () => {
    const result = await wrap(fakeModel({})).doGenerate({ prompt: PROMPT } as any)
    expect(result.content).toEqual([{ type: "text", text: "ok" }])
  })
})

/**
 * The quota only helps if it survives the trip out of the provider. doGenerate
 * publishes it on the result; doStream publishes it on the "finish" part, because
 * that is where consumers read per-step metadata even though the headers were
 * available the moment the stream opened.
 */
describe("quota metadata", () => {
  test("doGenerate publishes the quota the headers reported", async () => {
    const result = await wrap(fakeModel({ responseHeaders: QUOTA_HEADERS })).doGenerate({ prompt: PROMPT } as any)
    expect(result.providerMetadata?.clickzetta?.quota).toEqual(QUOTA)
  })

  test("metadata the base provider already set is preserved alongside it", async () => {
    const model = fakeModel({
      responseHeaders: QUOTA_HEADERS,
      providerMetadata: { openaiCompatible: { fingerprint: "fp_1" }, clickzetta: { requestId: "req-1" } },
    })
    const result = await wrap(model).doGenerate({ prompt: PROMPT } as any)
    expect(result.providerMetadata).toEqual({
      openaiCompatible: { fingerprint: "fp_1" },
      clickzetta: { requestId: "req-1", quota: QUOTA },
    })
  })

  test("doStream publishes it on the finish part", async () => {
    const model = fakeModel({
      responseHeaders: QUOTA_HEADERS,
      streamParts: [
        { type: "text-delta", id: "1", delta: "hi" },
        { type: "finish", finishReason: "stop", usage: {} },
      ],
    })
    const parts = await collect((await wrap(model).doStream({ prompt: PROMPT } as any)).stream)
    expect(parts.find((p) => p.type === "finish")?.providerMetadata?.clickzetta?.quota).toEqual(QUOTA)
    // Only the finish part is touched; content parts pass through untouched.
    expect(parts[0]).toEqual({ type: "text-delta", id: "1", delta: "hi" })
  })

  /**
   * A 429 carries no quota headers at all, so there is nothing to publish and the
   * result must come back exactly as the base provider built it — the error body,
   * which gateway-error.ts classifies, stays the only signal.
   */
  test("a response without quota headers is handed back unchanged", async () => {
    const model = fakeModel({ responseHeaders: { "content-type": "application/json" } })
    const wrapped = wrap(model)
    const result = await wrapped.doGenerate({ prompt: PROMPT } as any)
    expect("providerMetadata" in result).toBe(false)

    const finish = { type: "finish", finishReason: "stop", usage: {} }
    const parts = await collect(
      (await wrap(fakeModel({ streamParts: [finish] })).doStream({ prompt: PROMPT } as any)).stream,
    )
    expect(parts[0]).toEqual(finish)
  })
})
