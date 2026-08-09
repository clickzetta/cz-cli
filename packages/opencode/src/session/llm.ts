import { Provider } from "@/provider"
import { Log } from "@/util"
import { Context, Effect, Layer, Record } from "effect"
import * as Stream from "effect/Stream"
import { streamText, generateText, wrapLanguageModel, type ModelMessage, type Tool, tool, jsonSchema } from "ai"
import { mergeDeep, pipe } from "remeda"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider"
import { Config } from "@/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Bus } from "@/bus"
import { Wildcard } from "@/util"
import { SessionID } from "@/session/schema"
import { Auth } from "@/auth"
import { Installation } from "@/installation"
import { InstallationVersion } from "@/installation/version"
import { EffectBridge } from "@/effect"
import * as Option from "effect/Option"
import * as Exit from "effect/Exit"
import * as Cause from "effect/Cause"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { withSessionOtelContext } from "@/plugin/otel/context"
import type { AuthError } from "@/auth"
import { ProviderID, ModelID } from "@/provider/schema"
import {
  normalizeMoAConfig,
  resolveMoAPreset,
  referenceMessages,
  toolListText,
  referenceSystemPrompt,
  synthesizeContext,
  injectContext,
  runReferenceFanout,
  type ReferenceCall,
  type MoASlot,
} from "@/session/moa"

const log = Log.create({ service: "llm" })
export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX
type Result = Awaited<ReturnType<typeof streamText>>
type RequestTelemetry = {
  inputMessages?: string
  systemInstructions?: string
}

export type StreamInput = {
  user: MessageV2.User
  sessionID: string
  parentSessionID?: string
  model: Provider.Model
  agent: Agent.Info
  permission?: Permission.Ruleset
  system: string[]
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
  telemetry?: RequestTelemetry
}

export type PreparedInput = StreamInput & {
  abort?: AbortSignal
  telemetry: RequestTelemetry
  moa?: {
    presetName: string
    referenceModels: MoASlot[]
    aggregatorLabel: string
    concurrency: number
    maxTokens?: number
  }
  request: {
    system: string[]
    messages: ModelMessage[]
    isOpenaiOauth: boolean
  }
}

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export type Event = Result["fullStream"] extends AsyncIterable<infer T> ? T : never

export interface Interface {
  readonly prepare: (input: StreamInput) => Effect.Effect<PreparedInput, AuthError>
  readonly stream: (input: StreamInput) => Stream.Stream<Event, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM") {}

const live: Layer.Layer<
  Service,
  never,
  Auth.Service | Config.Service | Provider.Service | Plugin.Service | Permission.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service

    const prepare = Effect.fn("LLM.prepare")(function* (input: StreamInput) {
      if (isPreparedInput(input)) return input

      let moaPlan: PreparedInput["moa"] | undefined
      if (input.model.providerID === "moa") {
        const cfg = yield* config.get()
        const moaCfg = normalizeMoAConfig((cfg as any).moa)
        const preset = resolveMoAPreset(moaCfg, input.model.id) // throws if unknown → aborts turn
        const agg = preset.aggregator
        const aggregatorModel = yield* provider.getModel(
          ProviderID.make(agg.providerID),
          ModelID.make(agg.modelID),
        ) // throws if aggregator unresolvable → aborts turn (intended: no acting model)
        if (preset.enabled && preset.reference_models.length > 0) {
          moaPlan = {
            presetName: input.model.id,
            referenceModels: preset.reference_models,
            aggregatorLabel: `${agg.providerID}/${agg.modelID}`,
            concurrency: moaCfg.reference_concurrency,
            maxTokens: preset.max_tokens,
          }
        }
        // The aggregator is the acting model: everything downstream uses it.
        input = { ...input, model: aggregatorModel }
      }

      const [language, item, info] = yield* Effect.all(
        [provider.getLanguage(input.model), provider.getProvider(input.model.providerID), auth.get(input.model.providerID)],
        { concurrency: "unbounded" },
      )

      const isOpenaiOauth = item.id === "openai" && info?.type === "oauth"
      const system: string[] = []
      system.push(
        [
          ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
          ...input.system,
          ...(input.user.system ? [input.user.system] : []),
        ]
          .filter((x) => x)
          .join("\n"),
      )

      const header = system[0]
      yield* plugin.trigger(
        "experimental.chat.system.transform",
        { sessionID: input.sessionID, model: input.model },
        { system },
      )
      if (system.length > 2 && system[0] === header) {
        const rest = system.slice(1)
        system.length = 0
        system.push(header, rest.join("\n"))
      }

      const messages =
        isOpenaiOauth || language instanceof GitLabWorkflowLanguageModel
          ? input.messages
          : [
              ...system.map(
                (content): ModelMessage => ({
                  role: "system",
                  content,
                }),
              ),
              ...input.messages,
            ]

      return {
        ...input,
        moa: moaPlan,
        telemetry: {
          inputMessages: serializeInputMessages(messages),
          systemInstructions: isOpenaiOauth ? serializeSystemInstructions(system) : undefined,
        },
        request: {
          system,
          messages,
          isOpenaiOauth,
        },
      } satisfies PreparedInput
    })

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest) {
      const prepared = yield* prepare(input)
      const l = log
        .clone()
        .tag("providerID", prepared.model.providerID)
        .tag("modelID", prepared.model.id)
        .tag("sessionID", prepared.sessionID)
        .tag("small", (prepared.small ?? false).toString())
        .tag("agent", prepared.agent.name)
        .tag("mode", prepared.agent.mode)
      l.info("stream", {
        modelID: prepared.model.id,
        providerID: prepared.model.providerID,
      })

      const [language, cfg, item] = yield* Effect.all(
        [
          provider.getLanguage(prepared.model),
          config.get(),
          provider.getProvider(prepared.model.providerID),
        ],
        { concurrency: "unbounded" },
      )
      const system = prepared.request.system

      const variant =
        !prepared.small && prepared.model.variants && prepared.user.model.variant
          ? prepared.model.variants[prepared.user.model.variant]
          : {}
      const base = prepared.small
        ? ProviderTransform.smallOptions(prepared.model)
        : ProviderTransform.options({
            model: prepared.model,
            sessionID: prepared.sessionID,
            providerOptions: item.options,
          })
      const options: Record<string, any> = pipe(
        base,
        mergeDeep(prepared.model.options),
        mergeDeep(prepared.agent.options),
        mergeDeep(variant),
      )
      if (prepared.request.isOpenaiOauth) {
        options.instructions = system.join("\n")
      }

      const params = yield* plugin.trigger(
        "chat.params",
        {
          sessionID: prepared.sessionID,
          agent: prepared.agent.name,
          model: prepared.model,
          provider: item,
          message: prepared.user,
        },
        {
          temperature: prepared.model.capabilities.temperature
            ? (prepared.agent.temperature ?? ProviderTransform.temperature(prepared.model))
            : undefined,
          topP: prepared.agent.topP ?? ProviderTransform.topP(prepared.model),
          topK: ProviderTransform.topK(prepared.model),
          maxOutputTokens: ProviderTransform.maxOutputTokens(prepared.model),
          options,
        },
      )

      const { headers } = yield* plugin.trigger(
        "chat.headers",
        {
          sessionID: prepared.sessionID,
          agent: prepared.agent.name,
          model: prepared.model,
          provider: item,
          message: prepared.user,
        },
        {
          headers: {},
        },
      )

      const tools = resolveTools(prepared)

      // LiteLLM and some Anthropic proxies require the tools parameter to be present
      // when message history contains tool calls, even if no tools are being used.
      // Add a dummy tool that is never called to satisfy this validation.
      // This is enabled for:
      // 1. Providers with "litellm" in their ID or API ID (auto-detected)
      // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
      const isLiteLLMProxy =
        item.options?.["litellmProxy"] === true ||
        prepared.model.providerID.toLowerCase().includes("litellm") ||
        prepared.model.api.id.toLowerCase().includes("litellm")

      // LiteLLM/Bedrock rejects requests where the message history contains tool
      // calls but no tools param is present. When there are no active tools (e.g.
      // during compaction), inject a stub tool to satisfy the validation requirement.
      // The stub description explicitly tells the model not to call it.
      if (
        (isLiteLLMProxy || prepared.model.providerID.includes("github-copilot")) &&
        Object.keys(tools).length === 0 &&
        hasToolCalls(prepared.messages)
      ) {
        tools["_noop"] = tool({
          description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              reason: { type: "string", description: "Unused" },
            },
          }),
          execute: async () => ({ output: "", title: "", metadata: {} }),
        })
      }

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      if (language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel = language as GitLabWorkflowLanguageModel & {
          sessionID?: string
          sessionPreapprovedTools?: string[]
          approvalHandler?: (approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean }>
        }
        workflowModel.sessionID = prepared.sessionID
        workflowModel.systemPrompt = system.join("\n")
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const t = tools[toolName]
          if (!t || !t.execute) {
            return { result: "", error: `Unknown tool: ${toolName}` }
          }
          try {
            const result = await t.execute!(JSON.parse(argsJson), {
              toolCallId: _requestID,
              messages: prepared.messages,
              abortSignal: prepared.abort,
            })
            const output = typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
            return {
              result: output,
              metadata: typeof result === "object" ? result?.metadata : undefined,
              title: typeof result === "object" ? result?.title : undefined,
            }
          } catch (e: any) {
            return { result: "", error: e.message ?? String(e) }
          }
        }

        const ruleset = Permission.merge(prepared.agent.permission ?? [], prepared.permission ?? [])
        workflowModel.sessionPreapprovedTools = Object.keys(tools).filter((name) => {
          const match = ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
          return !match || match.action !== "ask"
        })

        const bridge = yield* EffectBridge.make()
        const approvedToolsForSession = new Set<string>()
        workflowModel.approvalHandler = Instance.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
          // Auto-approve tools that were already approved in this session
          // (prevents infinite approval loops for server-side MCP tools)
          if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
            return { approved: true }
          }

          const id = PermissionID.ascending()
          let unsub: (() => void) | undefined
          try {
            unsub = Bus.subscribe(Permission.Event.Replied, (evt) => {
              if (evt.properties.requestID === id) void evt.properties.reply
            })
            const toolPatterns = approvalTools.map((t: { name: string; args: string }) => {
              try {
                const parsed = JSON.parse(t.args) as Record<string, unknown>
                const title = (parsed?.title ?? parsed?.name ?? "") as string
                return title ? `${t.name}: ${title}` : t.name
              } catch {
                return t.name
              }
            })
            const uniquePatterns = [...new Set(toolPatterns)] as string[]
            await bridge.promise(
              perm.ask({
                id,
                sessionID: SessionID.make(prepared.sessionID),
                permission: "workflow_tool_approval",
                patterns: uniquePatterns,
                metadata: { tools: approvalTools },
                always: uniquePatterns,
                ruleset: [],
              }),
            )
            for (const name of uniqueNames) approvedToolsForSession.add(name)
            workflowModel.sessionPreapprovedTools = [...(workflowModel.sessionPreapprovedTools ?? []), ...uniqueNames]
            return { approved: true }
          } catch {
            return { approved: false }
          } finally {
            unsub?.()
          }
        })
      }

      let messages = prepared.request.messages
      if (prepared.moa) {
        const plan = prepared.moa
        const refView = referenceMessages(messages)
        const toolList = toolListText(
          Object.entries(tools).map(([name, t]) => ({
            name,
            description: (t as Tool).description as string | undefined,
          })),
        )
        const refSystem = referenceSystemPrompt(toolList)
        const calls: ReferenceCall[] = []
        for (const slot of plan.referenceModels) {
          const label = `${slot.providerID}/${slot.modelID}`
          // Reference models are advisory/best-effort: resolution must degrade
          // exactly like call failures (captured as [failed: ...]) and must NOT
          // abort the turn. getModel/getLanguage throw defects when a provider
          // is misconfigured, so capture the full Exit (Effect.exit covers both
          // typed failures and defects) and route any failure through the
          // fan-out as a throwing call() so runReferenceFanout labels it.
          const resolved = yield* Effect.exit(
            provider
              .getModel(ProviderID.make(slot.providerID), ModelID.make(slot.modelID))
              .pipe(Effect.flatMap((refModel) => provider.getLanguage(refModel))),
          )
          if (Exit.isSuccess(resolved)) {
            const refLanguage = resolved.value
            calls.push({
              label,
              call: async () => {
                const res = await generateText({
                  model: refLanguage,
                  system: refSystem,
                  messages: refView,
                  ...(plan.maxTokens ? { maxOutputTokens: plan.maxTokens } : {}),
                  abortSignal: prepared.abort,
                })
                return res.text || "(empty response)"
              },
            })
          } else {
            const cause = Cause.squash(resolved.cause)
            const reason = cause instanceof Error ? cause.message : String(cause)
            calls.push({
              label,
              call: async () => {
                throw new Error(`resolve failed: ${label}: ${reason}`)
              },
            })
          }
        }
        const outputs = yield* Effect.promise(() => runReferenceFanout(calls, plan.concurrency))
        const context = synthesizeContext({
          preset: plan.presetName,
          aggregatorLabel: plan.aggregatorLabel,
          referenceLabels: calls.map((c) => c.label),
          outputs,
        })
        messages = injectContext(messages, context)
      }

      const tracer = cfg.experimental?.openTelemetry
        ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
        : undefined

      return withSessionOtelContext(() =>
        streamText({
          onError(error) {
            l.error("stream error", {
              error,
            })
          },
          async experimental_repairToolCall(failed) {
            const lower = failed.toolCall.toolName.toLowerCase()
            if (lower !== failed.toolCall.toolName && tools[lower]) {
              l.info("repairing tool call", {
                tool: failed.toolCall.toolName,
                repaired: lower,
              })
              return {
                ...failed.toolCall,
                toolName: lower,
              }
            }
            return {
              ...failed.toolCall,
              input: JSON.stringify({
                tool: failed.toolCall.toolName,
                error: failed.error.message,
              }),
              toolName: "invalid",
            }
          },
          temperature: params.temperature,
          topP: params.topP,
          topK: params.topK,
          providerOptions: ProviderTransform.providerOptions(prepared.model, params.options),
          activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
          tools,
          toolChoice: prepared.toolChoice,
          maxOutputTokens: params.maxOutputTokens,
          abortSignal: prepared.abort,
          headers: {
            ...(prepared.model.providerID.startsWith("opencode")
              ? {
                  "x-opencode-project": Instance.project.id,
                  "x-opencode-session": prepared.sessionID,
                  "x-opencode-request": prepared.user.id,
                  "x-opencode-client": Flag.CLICKZETTA_CLIENT,
                }
              : {
                  "x-session-affinity": prepared.sessionID,
                  ...(prepared.parentSessionID ? { "x-parent-session-id": prepared.parentSessionID } : {}),
                  "User-Agent": `opencode/${InstallationVersion}`,
                }),
            ...prepared.model.headers,
            ...headers,
          },
          maxRetries: prepared.retries ?? 0,
          messages,
          model: wrapLanguageModel({
            model: language,
            middleware: [
              {
                specificationVersion: "v3" as const,
                async transformParams(args) {
                  if (args.type === "stream") {
                    // @ts-expect-error
                    args.params.prompt = ProviderTransform.message(args.params.prompt, prepared.model, options)
                  }
                  return args.params
                },
              },
            ],
          }),
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry || Boolean(process.env.LANGFUSE_PUBLIC_KEY),
            functionId: "session.llm",
            tracer,
            metadata: {
              userId: cfg.username ?? "unknown",
              sessionId: prepared.sessionID,
            },
          },
        }),
      )
    })

    const stream: Interface["stream"] = (input) =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (ctrl) => Effect.sync(() => ctrl.abort()),
            )

            const result = yield* run({ ...input, abort: ctrl.signal })

            return Stream.fromAsyncIterable(result.fullStream, (e) => (e instanceof Error ? e : new Error(String(e))))
          }),
        ),
      )

    return Service.of({ prepare, stream })
  }),
)

export const layer = live.pipe(Layer.provide(Permission.defaultLayer))

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
  ),
)

function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">) {
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []),
  )
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}

// Check if messages contain any tool-call content
// Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
export function hasToolCalls(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}

function isPreparedInput(input: StreamInput): input is PreparedInput {
  const request = (input as StreamInput & { request?: PreparedInput["request"] }).request
  return !!request && Array.isArray(request.messages) && Array.isArray(request.system)
}

function serializeInputMessages(messages: ModelMessage[]) {
  return JSON.stringify(messages.map((message) => ({ role: message.role, parts: serializeMessageParts(message) })))
}

function serializeSystemInstructions(system: string[]) {
  const parts = system.filter(Boolean).map((content) => ({ type: "text", content }))
  return parts.length ? JSON.stringify(parts) : undefined
}

function serializeMessageParts(message: ModelMessage) {
  if (typeof message.content === "string") return [{ type: "text", content: message.content }]
  if (!Array.isArray(message.content)) return []
  return message.content.map(serializePart).filter((part) => part !== undefined)
}

function serializePart(part: unknown) {
  if (!part || typeof part !== "object") return { type: "unknown", content: String(part) }
  if (!("type" in part) || typeof part.type !== "string") return { type: "unknown", content: JSON.stringify(part) }

  if (part.type === "text" && "text" in part && typeof part.text === "string") {
    return { type: "text", content: part.text }
  }

  if (part.type === "tool-call") {
    return {
      type: "tool_call",
      ...("toolCallId" in part && typeof part.toolCallId === "string" ? { id: part.toolCallId } : {}),
      ...("toolName" in part && typeof part.toolName === "string" ? { name: part.toolName } : {}),
      ...("input" in part ? { arguments: part.input } : {}),
    }
  }

  if (part.type === "tool-result") {
    return {
      type: "tool_call_response",
      ...("toolCallId" in part && typeof part.toolCallId === "string" ? { id: part.toolCallId } : {}),
      result:
        "output" in part
          ? part.output
          : "result" in part
            ? part.result
            : "content" in part
              ? part.content
              : undefined,
    }
  }

  if (part.type === "reasoning") {
    return {
      type: "reasoning",
      content:
        "text" in part && typeof part.text === "string"
          ? part.text
          : "content" in part && typeof part.content === "string"
            ? part.content
            : "",
    }
  }

  if (part.type === "file") return serializeFilePart(part as { type: "file"; mediaType?: unknown; data?: unknown; url?: unknown })
  return { ...part }
}

function serializeFilePart(part: { type: "file"; mediaType?: unknown; data?: unknown; url?: unknown }) {
  const mimeType = typeof part.mediaType === "string" ? part.mediaType : null
  const modality = detectModality(mimeType)

  if (typeof part.data === "string") {
    const parsed = parseDataUrl(part.data)
    return {
      type: "blob",
      mime_type: parsed?.mimeType ?? mimeType,
      modality,
      content: parsed?.content ?? part.data,
    }
  }

  if (typeof part.url === "string") {
    return {
      type: "uri",
      mime_type: mimeType,
      modality,
      uri: part.url,
    }
  }

  return { type: "file" }
}

function parseDataUrl(input: string) {
  const match = input.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/)
  if (!match) return
  return {
    mimeType: match[1] ?? null,
    content: match[2],
  }
}

function detectModality(mimeType: string | null) {
  if (!mimeType) return "image"
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("audio/")) return "audio"
  if (mimeType.startsWith("video/")) return "video"
  return "image"
}

export * as LLM from "./llm"
