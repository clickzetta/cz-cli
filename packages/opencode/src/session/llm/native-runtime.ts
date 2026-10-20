import { LLMTrace } from "./trace"
import { ProviderRequest } from "@/provider/request-context"
import type { Auth } from "@/auth"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { asSchema, type ModelMessage, type Tool } from "ai"
import { Cause, Effect, Exit, FiberSet, Queue } from "effect"
import * as Stream from "effect/Stream"
import { FetchHttpClient } from "effect/unstable/http"
import {
  LLMRequest,
  Tool as NativeTool,
  ToolFailure,
  ToolRuntime,
  toDefinitions,
  type JsonSchema,
  type LLMEvent,
} from "@opencode-ai/llm"
import type { LLMClientShape } from "@opencode-ai/llm/route"
import { LLMNative } from "./native-request"

export type RuntimeStatus =
  | { readonly type: "supported"; readonly apiKey: string; readonly baseURL?: string }
  | { readonly type: "unsupported"; readonly reason: string }
export type StreamResult =
  | { readonly type: "supported"; readonly stream: Stream.Stream<LLMEvent, unknown> }
  | { readonly type: "unsupported"; readonly reason: string }

type StreamInput = {
  readonly model: Provider.Model
  readonly provider: Provider.Info
  readonly auth: Auth.Info | undefined
  readonly llmClient: LLMClientShape
  readonly messages: ModelMessage[]
  readonly tools: Record<string, Tool>
  readonly toolChoice?: "auto" | "required" | "none"
  readonly temperature?: number
  readonly topP?: number
  readonly topK?: number
  readonly maxOutputTokens?: number
  readonly providerOptions?: Record<string, any>
  readonly headers: Record<string, string>
  readonly abort: AbortSignal
  readonly trace?: { context: LLMTrace.Context; observe: LLMTrace.Observer }
}

export function status(input: Pick<StreamInput, "model" | "provider" | "auth">): RuntimeStatus {
  return statusWithFetch(input, providerFetch(input))
}

function statusWithFetch(
  input: Pick<StreamInput, "model" | "provider" | "auth">,
  transport: typeof fetch | undefined,
): RuntimeStatus {
  const providerID = input.model.providerID
  if (providerID !== "openai" && providerID !== "anthropic" && !providerID.startsWith("opencode"))
    return { type: "unsupported", reason: "provider is not openai, opencode, or anthropic" }
  const npm = input.model.api.npm
  if (npm !== "@ai-sdk/openai" && npm !== "@ai-sdk/openai-compatible" && npm !== "@ai-sdk/anthropic")
    return { type: "unsupported", reason: "provider package is not OpenAI, OpenAI-compatible, or Anthropic" }
  if (input.auth?.type === "oauth" && !(input.provider.id === "openai" && transport)) {
    return { type: "unsupported", reason: "OAuth auth requires a provider fetch override" }
  }

  const apiKey = typeof input.provider.options.apiKey === "string" ? input.provider.options.apiKey : input.provider.key
  if (!apiKey) return { type: "unsupported", reason: "API key is not configured" }

  return {
    type: "supported",
    apiKey,
    baseURL: typeof input.provider.options.baseURL === "string" ? input.provider.options.baseURL : undefined,
  }
}

export function stream(input: StreamInput): StreamResult {
  const providerTransport = providerFetch(input)
  const current = statusWithFetch(input, providerTransport)
  if (current.type === "unsupported") return current

  // Integration point with @opencode-ai/llm: native-request lowers session data
  // into an LLMRequest, then LLMClient handles route selection and transport.
  //
  // ProviderTransform.providerOptions builds AI-SDK-shaped options for the
  // selected SDK key (e.g. "openai") and the native LLM SDK reads the same
  // keys via OpenAIOptions.* (store, reasoningEffort, reasoningSummary,
  // include, textVerbosity, promptCacheKey). Both sides intentionally use
  // OpenAI's official wire field names, so this is identity, not translation
  // — if a field ever needs to differ between the two surfaces, the
  // translation belongs here, not split across both packages.
  const tools = nativeTools(input.tools, input)
  const request = LLMNative.request({
    model: input.model,
    apiKey: current.apiKey,
    baseURL: current.baseURL,
    messages: ProviderTransform.message(input.messages, input.model, input.providerOptions ?? {}),
    toolChoice: input.toolChoice,
    temperature: input.temperature,
    topP: input.topP,
    topK: input.topK,
    maxOutputTokens: input.maxOutputTokens,
    providerOptions: ProviderTransform.providerOptions(input.model, input.providerOptions ?? {}),
    headers: { ...providerHeaders(input.provider.options.headers), ...input.headers },
  })
  const stream = Stream.scoped(
    Stream.unwrap(
      Effect.gen(function* () {
        const settlements = yield* FiberSet.make<void>()
        const results = yield* Queue.unbounded<LLMEvent, Cause.Done>()
        const provider = input.llmClient
          .stream(
            LLMRequest.update(request, {
              tools: [...request.tools, ...toDefinitions(tools)],
            }),
          )
          .pipe(
            Stream.flatMap((event) =>
              event.type !== "tool-call" || event.providerExecuted
                ? Stream.make(event)
                : Stream.make(event).pipe(
                    Stream.concat(
                      Stream.fromEffectDrain(
                        ToolRuntime.dispatch(tools, event).pipe(
                          Effect.flatMap((dispatched) => Queue.offerAll(results, dispatched.events)),
                          Effect.catchCause((cause) => Queue.failCause(results, cause)),
                          Effect.asVoid,
                          FiberSet.run(settlements, { startImmediately: true }),
                        ),
                      ),
                    ),
                  ),
            ),
            Stream.concat(
              Stream.fromEffectDrain(
                FiberSet.awaitEmpty(settlements).pipe(Effect.andThen(Queue.end(results)), Effect.asVoid),
              ),
            ),
          )
        const observed = provider.pipe(Stream.concat(Stream.fromQueue(results)))
        const trace = input.trace
        if (!trace) return observed
        let call: Awaited<ReturnType<typeof LLMTrace.start>> | undefined
        let finished = false
        let failure: string | undefined
        // The transport can retry before emitting any model events. Give every HTTP
        // attempt its own identity so failed requests cannot overwrite later ones.
        const transport: typeof fetch = Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
          const current = await LLMTrace.start(
            {
              ...trace.context,
              runtime: "native",
              request: {
                messages: request.messages,
                system: request.system,
                tools: [...request.tools, ...toDefinitions(tools)],
                options: {
                  maxTokens: request.generation?.maxTokens,
                  temperature: request.generation?.temperature,
                  topP: request.generation?.topP,
                  topK: request.generation?.topK,
                  frequencyPenalty: request.generation?.frequencyPenalty,
                  presencePenalty: request.generation?.presencePenalty,
                  seed: request.generation?.seed,
                  stop: request.generation?.stop,
                  toolChoice: request.toolChoice,
                  providerOptions: request.providerOptions,
                },
              },
            },
            trace.observe,
          )
          call = current
          finished = false
          failure = undefined
          await ProviderRequest.record(url, init, current.request).catch(() => {})
          const response = await ProviderRequest.observe(current.request, () =>
            Promise.resolve().then(() => (providerTransport ?? fetch)(url, init)),
          ).catch(async (error: unknown) => {
            await current.end(input.abort.aborted ? "canceled" : "error", errorMessage(error))
            throw error
          })
          if (!response.ok) {
            await current.event({
              type: "provider-error",
              message: await response
                .clone()
                .text()
                .catch(() => response.statusText),
              status: response.status,
            })
            await current.end("error", `HTTP ${response.status}`)
          }
          return response
        }, fetch)
        return observed.pipe(
          Stream.tap((event) =>
            Effect.promise(async () => {
              await call?.event(event)
              if (event.type === "provider-error") failure = event.message
              if (event.type === "finish") {
                finished = true
                if (event.reason === "error") failure ??= "Provider reported an error finish reason"
                await call?.end(failure ? "error" : "completed", failure)
              }
            }),
          ),
          Stream.onExit((exit) =>
            Effect.promise(async () => {
              await call?.end(
                input.abort.aborted || (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause))
                  ? "canceled"
                  : Exit.isFailure(exit) || failure || !finished
                    ? "error"
                    : "completed",
                Exit.isFailure(exit)
                  ? Cause.pretty(exit.cause)
                  : (failure ?? (finished ? undefined : "Provider stream ended without a finish event")),
              )
            }),
          ),
          Stream.provideService(FetchHttpClient.Fetch, transport),
        )
      }),
    ),
  )

  return {
    ...current,
    stream: providerTransport ? stream.pipe(Stream.provideService(FetchHttpClient.Fetch, providerTransport)) : stream,
  }
}

function providerFetch(input: Pick<StreamInput, "provider" | "auth">): typeof fetch | undefined {
  if (input.provider.id !== "openai" || input.auth?.type !== "oauth") return undefined
  const value: unknown = input.provider.options.fetch
  if (typeof value !== "function") return undefined
  return value as typeof fetch
}

function providerHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function nativeSchema(value: unknown): JsonSchema {
  if (!value || typeof value !== "object") return { type: "object", properties: {} }
  if ("jsonSchema" in value && value.jsonSchema && typeof value.jsonSchema === "object")
    return value.jsonSchema as JsonSchema
  return asSchema(value as Parameters<typeof asSchema>[0]).jsonSchema as JsonSchema
}

export function nativeTools(tools: Record<string, Tool>, input: Pick<StreamInput, "messages" | "abort">) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, item]) => [
      name,
      // Tool execution remains opencode-owned. The native runtime only adapts
      // the @opencode-ai/llm tool call back into the AI SDK Tool.execute shape.
      NativeTool.make({
        description: item.description ?? "",
        jsonSchema: nativeSchema(item.inputSchema),
        execute: (args: unknown, ctx) =>
          Effect.tryPromise({
            try: () => {
              if (!item.execute) throw new Error(`Tool has no execute handler: ${name}`)
              return item.execute(args, {
                toolCallId: ctx?.id ?? name,
                messages: input.messages,
                abortSignal: input.abort,
              })
            },
            catch: (error) => new ToolFailure({ message: errorMessage(error), error }),
          }),
      }),
    ]),
  )
}

export * as LLMNativeRuntime from "./native-runtime"
