import { describe, expect, test } from "bun:test"
import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import type { LLMTraceEvent } from "@opencode-ai/plugin"
import { wrapLanguageModel } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { Effect, Stream } from "effect"
import { LLMTrace } from "../../src/session/llm/trace"
import { ProviderRequest } from "../../src/provider/request-context"

const context = { sessionID: "session-one", model: { providerID: "test", modelID: "model-one" }, agent: "test" }
const finish: LanguageModelV3StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
}

function model(run: LanguageModelV3["doStream"]): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "model-one",
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error("Unexpected generate call")),
    doStream: run,
  }
}

const request: LanguageModelV3CallOptions = {
  prompt: [
    { role: "system", content: "Final system instructions" },
    { role: "user", content: [{ type: "text", text: "Original question" }] },
    { role: "assistant", content: [{ type: "text", text: "x".repeat(100_000) }] },
  ],
  tools: [
    { type: "function", name: "lookup", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
  ],
  temperature: 0.4,
  providerOptions: { test: { custom: true } },
}

describe("LLM request observations", () => {
  test("captures the transformed request and wire body before sending and preserves all response chunks", async () => {
    const events: LLMTraceEvent[] = []
    const body = { model: "model-one", messages: request.prompt, tools: request.tools, temperature: 0.4 }
    const result = await wrapLanguageModel({
      model: model(async (params) => {
        const start = events[0]
        expect(start?.type).toBe("start")
        if (start?.type !== "start") throw new Error("Missing start event")
        expect(start.request.messages).toEqual(params.prompt)
        await ProviderRequest.record("https://example.com/v1/chat/completions", {
          method: "POST",
          body: JSON.stringify(body),
        })
        expect(events.at(-1)?.type).toBe("request")
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "text-delta", id: "text-one", delta: "Complete response" })
              controller.enqueue(finish)
              controller.close()
            },
          }),
        }
      }),
      middleware: [
        { specificationVersion: "v3", transformParams: async ({ params }) => ({ ...params, topP: 0.8 }) },
        LLMTrace.middleware(context, async (event) => {
          events.push(event)
        }),
      ],
    }).doStream(request)
    const chunks = await Effect.runPromise(
      Stream.fromReadableStream({ evaluate: () => result.stream, onError: (error) => error }).pipe(Stream.runCollect),
    )
    const start = events[0]
    expect(start?.type === "start" && start.request.options.topP).toBe(0.8)
    expect(start?.type === "start" && start.request.tools).toEqual(request.tools)
    expect(events.find((event) => event.type === "request")?.body).toBe(JSON.stringify(body))
    expect(chunks).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({ type: "end", outcome: "completed" })
    expect(new Set(events.map((event) => event.requestID)).size).toBe(1)
  })

  test("records the same complete body that reaches an HTTP provider", async () => {
    const events: LLMTraceEvent[] = []
    const received: unknown[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        received.push(await request.json())
        return new Response(
          [
            `data: ${JSON.stringify({ id: "response-one", model: "test", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] })}`,
            `data: ${JSON.stringify({ id: "response-one", model: "test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}`,
            "data: [DONE]",
            "",
          ].join("\n\n"),
          { headers: { "Content-Type": "text/event-stream" } },
        )
      },
    })
    try {
      const provider = createOpenAICompatible({
        name: "test",
        baseURL: server.url.toString(),
        fetch: Object.assign(
          async (input: RequestInfo | URL, init?: RequestInit) => {
            await ProviderRequest.record(input, init)
            return fetch(input, init)
          },
          { preconnect: () => undefined },
        ),
      })
      const result = await wrapLanguageModel({
        model: provider.chatModel("test"),
        middleware: LLMTrace.middleware(context, async (event) => {
          events.push(event)
        }),
      }).doStream(request)
      await Effect.runPromise(
        Stream.fromReadableStream({ evaluate: () => result.stream, onError: (error) => error }).pipe(Stream.runDrain),
      )
      const wire = events.find((event) => event.type === "request")
      expect(wire?.type === "request" && JSON.parse(String(wire.body))).toEqual(received[0])
      expect(JSON.stringify(received[0])).toContain("Original question")
      expect(JSON.stringify(received[0])).toContain("x".repeat(100_000))
      expect(events.at(-1)).toMatchObject({ type: "end", outcome: "completed" })
    } finally {
      server.stop(true)
    }
  })

  test("records failures before response headers and gives retries distinct identities", async () => {
    const events: LLMTraceEvent[] = []
    const observed = wrapLanguageModel({
      model: model(() => {
        throw new Error("Connection refused")
      }),
      middleware: LLMTrace.middleware(context, async (event) => {
        events.push(event)
      }),
    })
    await expect(observed.doStream(request)).rejects.toThrow("Connection refused")
    await expect(observed.doStream(request)).rejects.toThrow("Connection refused")
    expect(events.filter((event) => event.type === "start")).toHaveLength(2)
    expect(events.filter((event) => event.type === "end")).toMatchObject([
      { outcome: "error", error: "Connection refused" },
      { outcome: "error", error: "Connection refused" },
    ])
    expect(new Set(events.map((event) => event.requestID)).size).toBe(2)
  })

  test("keeps partial output when a consumer cancels", async () => {
    const events: LLMTraceEvent[] = []
    const result = await wrapLanguageModel({
      model: model(async () => ({
        stream: new ReadableStream({
          pull(controller) {
            controller.enqueue({ type: "text-delta", id: "partial", delta: "Partial response" })
          },
        }),
      })),
      middleware: LLMTrace.middleware(context, async (event) => {
        events.push(event)
      }),
    }).doStream(request)
    const reader = result.stream.getReader()
    await reader.read()
    await reader.cancel()
    expect(events.filter((event) => event.type === "event")).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: "end", outcome: "canceled" })
    expect(events.filter((event) => event.type === "end")).toHaveLength(1)
  })

  test("records cancellation before response headers", async () => {
    const events: LLMTraceEvent[] = []
    const dispatched = Promise.withResolvers<void>()
    const abort = new AbortController()
    const observed = wrapLanguageModel({
      model: model(
        (params) =>
          new Promise((_, reject) => {
            params.abortSignal?.addEventListener("abort", () => reject(params.abortSignal?.reason), { once: true })
            dispatched.resolve()
          }),
      ),
      middleware: LLMTrace.middleware(context, async (event) => {
        events.push(event)
      }),
    })
    const result = observed.doStream({ ...request, abortSignal: abort.signal })
    await dispatched.promise
    abort.abort(new Error("Canceled before headers"))
    await expect(result).rejects.toThrow("Canceled before headers")
    expect(events[0]).toMatchObject({ type: "start", request: { messages: request.prompt } })
    expect(events.at(-1)).toMatchObject({ type: "end", outcome: "canceled" })
  })

  test("closes a pending read exactly once when canceled", async () => {
    const events: LLMTraceEvent[] = []
    const reading = Promise.withResolvers<void>()
    const result = await wrapLanguageModel({
      model: model(async () => ({
        stream: new ReadableStream(
          {
            pull() {
              reading.resolve()
            },
          },
          { highWaterMark: 0 },
        ),
      })),
      middleware: LLMTrace.middleware(context, async (event) => {
        events.push(event)
      }),
    }).doStream(request)
    const reader = result.stream.getReader()
    const pending = reader.read()
    await reading.promise
    await reader.cancel()
    expect(await pending).toMatchObject({ done: true })
    expect(events.filter((event) => event.type === "end")).toEqual([expect.objectContaining({ outcome: "canceled" })])
  })

  test("does not mark provider error finishes as completed", async () => {
    const events: LLMTraceEvent[] = []
    const result = await wrapLanguageModel({
      model: model(async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ ...finish, finishReason: { unified: "error", raw: "error" } })
            controller.close()
          },
        }),
      })),
      middleware: LLMTrace.middleware(context, async (event) => {
        events.push(event)
      }),
    }).doStream(request)
    await Effect.runPromise(
      Stream.fromReadableStream({ evaluate: () => result.stream, onError: (error) => error }).pipe(Stream.runDrain),
    )
    expect(events.at(-1)).toMatchObject({ type: "end", outcome: "error" })
  })

  test("marks streams without finish events as failed", async () => {
    const events: LLMTraceEvent[] = []
    const result = await wrapLanguageModel({
      model: model(async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.close()
          },
        }),
      })),
      middleware: LLMTrace.middleware(context, async (event) => {
        events.push(event)
      }),
    }).doStream(request)
    await Effect.runPromise(
      Stream.fromReadableStream({ evaluate: () => result.stream, onError: (error) => error }).pipe(Stream.runCollect),
    )
    expect(events.at(-1)).toMatchObject({ type: "end", outcome: "error" })
  })

  test("does not let observer failures affect the model", async () => {
    const result = await wrapLanguageModel({
      model: model(async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(finish)
            controller.close()
          },
        }),
      })),
      middleware: LLMTrace.middleware(context, async () => {
        throw new Error("Collector unavailable")
      }),
    }).doStream(request)
    expect(
      await Effect.runPromise(
        Stream.fromReadableStream({ evaluate: () => result.stream, onError: (error) => error }).pipe(Stream.runCollect),
      ),
    ).toEqual([finish])
  })

  test("keeps concurrent wire request observers isolated", async () => {
    const captures: string[][] = [[], []]
    await Promise.all(
      captures.map((capture, index) =>
        ProviderRequest.observe(
          async (event) => {
            capture.push(event.body)
          },
          async () => {
            await Promise.resolve()
            await ProviderRequest.record(
              new Request("https://example.com", { method: "POST", body: `request-${index}` }),
            )
          },
        ),
      ),
    )
    expect(captures).toEqual([["request-0"], ["request-1"]])
  })
})
