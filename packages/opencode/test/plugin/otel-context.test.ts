import { afterEach, describe, expect, test } from "bun:test"
import { context, trace } from "@opentelemetry/api"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { MockLanguageModelV3 } from "ai/test"
import { streamText } from "ai"
import { withSessionOtelContext, setCurrentSessionSpanContext } from "../../src/plugin/otel/context"

const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
const manager = new AsyncLocalStorageContextManager()
const tracer = provider.getTracer("otel-context-test")

trace.setGlobalTracerProvider(provider)
manager.enable()
context.setGlobalContextManager(manager)

function createModel() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] })
          controller.enqueue({
            type: "response-metadata",
            id: "resp-1",
            timestamp: new Date(0),
            modelId: "mock-model",
          })
          controller.enqueue({ type: "text-start", id: "text-1" })
          controller.enqueue({ type: "text-delta", id: "text-1", delta: "hello" })
          controller.enqueue({ type: "text-end", id: "text-1" })
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: {
                total: 1,
                text: 1,
                reasoning: 0,
              },
            },
          })
          controller.close()
        },
      }),
    }),
  })
}

async function runStreamText() {
  const result = streamText({
    model: createModel(),
    prompt: "hello",
    experimental_telemetry: {
      isEnabled: true,
      functionId: "session.llm",
      tracer,
      metadata: { sessionId: "ses-otel-test" },
    },
  })
  await result.consumeStream()
}

function findAiStreamSpan() {
  const spans = exporter.getFinishedSpans()
  const span = spans.find((item) => item.name === "ai.streamText")
  if (!span) throw new Error(`ai.streamText span not found, got: ${spans.map((item) => item.name).join(", ")}`)
  return span
}

afterEach(() => {
  exporter.reset()
  setCurrentSessionSpanContext(undefined)
})

describe("plugin otel context", () => {
  test("session span ref alone does not make AI SDK telemetry inherit the session trace", async () => {
    const promptSpan = tracer.startSpan("prompt")
    setCurrentSessionSpanContext(promptSpan.spanContext())

    await runStreamText()

    const aiSpan = findAiStreamSpan()
    expect(aiSpan.spanContext().traceId).not.toBe(promptSpan.spanContext().traceId)
    expect(aiSpan.parentSpanContext).toBeUndefined()
    promptSpan.end()
  })

  test("running AI SDK telemetry inside the session otel context inherits the session trace", async () => {
    const promptSpan = tracer.startSpan("prompt")
    setCurrentSessionSpanContext(promptSpan.spanContext())

    await withSessionOtelContext(async () => {
      await runStreamText()
    })

    const aiSpan = findAiStreamSpan()
    expect(aiSpan.spanContext().traceId).toBe(promptSpan.spanContext().traceId)
    expect(aiSpan.parentSpanContext?.spanId).toBe(promptSpan.spanContext().spanId)
    promptSpan.end()
  })
})
