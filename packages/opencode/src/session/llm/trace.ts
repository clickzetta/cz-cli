import type { LanguageModelV3Middleware, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import type { LLMTraceEvent } from "@opencode-ai/plugin"
import { ProviderRequest } from "@/provider/request-context"
import { errorMessage } from "@/util/error"

export type Observer = (event: LLMTraceEvent) => Promise<void>
export type Context = { sessionID: string; model: { providerID: string; modelID: string }; agent: string }
type Start = Extract<LLMTraceEvent, { type: "start" }>

export async function start(input: Omit<Start, "type" | "requestID">, observer: Observer) {
  const identity = { sessionID: input.sessionID, requestID: crypto.randomUUID() }
  // Observability failures must never change model execution or mask its original error.
  const notify = (event: LLMTraceEvent) =>
    Promise.resolve()
      .then(() => observer(event))
      .catch(() => {})
  let ended = false
  await notify({ ...input, ...identity, type: "start" })
  return {
    event: (event: Extract<LLMTraceEvent, { type: "event" }>["event"]) => notify({ ...identity, type: "event", event }),
    request: (request: { body: unknown; url?: string; method?: string }) =>
      notify({ ...identity, type: "request", ...request }),
    async end(outcome: "completed" | "canceled" | "error", error?: string) {
      if (ended) return
      ended = true
      await notify({ ...identity, type: "end", outcome, ...(error ? { error } : {}) })
    },
  }
}

/** Observe the final SDK prompt, after all request and provider transformations. */
export function middleware(context: Context, observer: Observer): LanguageModelV3Middleware {
  return {
    specificationVersion: "v3",
    async wrapStream({ doStream, params }) {
      const { prompt, tools, abortSignal, headers: _headers, ...options } = params
      const call = await start(
        { ...context, runtime: "ai-sdk", request: { messages: prompt, tools, options } },
        observer,
      )
      let captured = false
      const result = await ProviderRequest.observe(
        async (request) => {
          captured = true
          await call.request(request)
        },
        () => Promise.resolve().then(() => doStream()),
      ).catch(async (error: unknown) => {
        await call.end(abortSignal?.aborted ? "canceled" : "error", errorMessage(error))
        throw error
      })
      // Some custom providers bypass the shared fetch wrapper but expose the sent body.
      if (!captured && result.request?.body !== undefined) await call.request({ body: result.request.body })
      const reader = result.stream.getReader()
      let finished = false
      let failure: string | undefined
      return {
        ...result,
        stream: new ReadableStream<LanguageModelV3StreamPart>(
          {
            async pull(controller) {
              try {
                const next = await reader.read()
                if (next.done) {
                  await call.end(
                    finished && !failure ? "completed" : abortSignal?.aborted ? "canceled" : "error",
                    failure ??
                      (finished || abortSignal?.aborted ? undefined : "Provider stream ended without a finish event"),
                  )
                  controller.close()
                  return
                }
                if (next.value.type === "finish") {
                  finished = true
                  if (next.value.finishReason.unified === "error")
                    failure ??= "Provider reported an error finish reason"
                }
                if (next.value.type === "error") failure = errorMessage(next.value.error)
                await call.event({ ...next.value })
                controller.enqueue(next.value)
              } catch (error) {
                await call.end(abortSignal?.aborted ? "canceled" : "error", errorMessage(error))
                controller.error(error)
              }
            },
            async cancel(reason) {
              await call.end(finished && !failure ? "completed" : "canceled")
              await reader.cancel(reason)
            },
          },
          { highWaterMark: 0 },
        ),
      }
    },
  }
}

export * as LLMTrace from "./trace"
