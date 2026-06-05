import { Cause, Deferred, Effect, Layer, Context, Scope, Exit } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import * as Session from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import { Provider as ProviderRuntime } from "@/provider"
import type { Provider } from "@/provider"
import { Question } from "@/question"
import { errorMessage } from "@/util/error"
import { Log } from "@/util"
import { isRecord } from "@/util/record"
import { Database } from "@/storage"
import { PartTable } from "./session.sql"
import { eq, desc } from "drizzle-orm"
import {
  CLICKZETTA_ROTATION_CANCEL_LABEL,
  CLICKZETTA_ROTATION_CONFIRM_LABEL,
  CLICKZETTA_ROTATION_HEADER,
  CLICKZETTA_ROTATION_PROMPT,
  isClickzettaQuotaExhausted,
  rotateClickzettaLlm,
} from "@clickzetta/cli/llm/clickzetta-rotation"

const DOOM_LOOP_THRESHOLD = 3
const log = Log.create({ service: "session.processor" })

export type Result = "compact" | "stop" | "continue"

export type Event = LLM.Event

export interface Handle {
  readonly message: MessageV2.Assistant
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
  ) => Effect.Effect<MessageV2.ToolPart | undefined>
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: MessageV2.FilePart[]
    },
  ) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
}

type Input = {
  assistantMessage: MessageV2.Assistant
  sessionID: SessionID
  model: Provider.Model
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>
}

type ToolCall = {
  partID: MessageV2.ToolPart["id"]
  messageID: MessageV2.ToolPart["messageID"]
  sessionID: MessageV2.ToolPart["sessionID"]
  toolName: string
  startMs: number
  done: Deferred.Deferred<void>
}

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  doomLoopDetected: boolean
  needsCompaction: boolean
  currentText: MessageV2.TextPart | undefined
  lastStepText: string | undefined
  stepToolCalls: Array<{ id: string; name: string; arguments: unknown }>
  reasoningMap: Record<string, MessageV2.ReasoningPart>
  stepStartMs: number
  currentStepId: string | undefined
  telemetryInputMessages: string | undefined
  telemetrySystemInstructions: string | undefined
}

type StreamEvent = Event

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionProcessor") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Session.Service
  | Config.Service
  | Bus.Service
  | Snapshot.Service
  | Agent.Service
  | LLM.Service
  | Permission.Service
  | Plugin.Service
  | Question.Service
  | ProviderRuntime.Service
  | SessionSummary.Service
  | SessionStatus.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const snapshot = yield* Snapshot.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const permission = yield* Permission.Service
    const plugin = yield* Plugin.Service
    const question = yield* Question.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service
    const provider = yield* ProviderRuntime.Service

    const approveRotation = Effect.fn("SessionProcessor.approveRotation")(function* (input: {
      sessionID: SessionID
      mode: "tui" | "auto" | "never"
    }) {
      if (input.mode === "auto") return true
      if (input.mode === "never") return false
      const answers = yield* question.ask({
        sessionID: input.sessionID,
        questions: [
          {
            header: CLICKZETTA_ROTATION_HEADER,
            question: CLICKZETTA_ROTATION_PROMPT,
            custom: false,
            options: [
              {
                label: CLICKZETTA_ROTATION_CONFIRM_LABEL,
                description: "Create a new virtual key and continue the conversation",
              },
              {
                label: CLICKZETTA_ROTATION_CANCEL_LABEL,
                description: "Keep the current key and stop this request",
              },
            ],
          },
        ],
      })
      return answers[0]?.[0] === CLICKZETTA_ROTATION_CONFIRM_LABEL
    })

    const recoverRotation = Effect.fn("SessionProcessor.recoverRotation")(function* (input: {
      sessionID: SessionID
      providerID: string
      error: MessageV2.APIError
      raw: unknown
      rotated: { done: boolean }
    }) {
      if (input.rotated.done) {
        if (input.raw instanceof Error) {
          input.raw.message = `Key rotated successfully, but LLM request failed: ${input.raw.message}. Please check base_url connectivity.`
        }
        return undefined
      }
      const exhausted = isClickzettaQuotaExhausted({
        provider: input.providerID,
        status: input.error.data.statusCode,
        detail: input.error.data.responseBody ?? input.error.data.message,
      })
      if (!exhausted) return undefined
      const mode: "tui" | "auto" = process.stdout.isTTY ? "tui" : "auto"
      const approved = yield* approveRotation({ sessionID: input.sessionID, mode }).pipe(
        Effect.catchTag("QuestionRejectedError", () => Effect.succeed(false)),
      )
      if (!approved) return undefined
      const result = yield* Effect.tryPromise(() =>
        rotateClickzettaLlm({ interactive: false }),
      ).pipe(Effect.orElseSucceed(() => undefined))
      if (!result || "failed" in result) {
        input.rotated.done = true
        const reason = result && "failed" in result ? result.reason : "unknown"
        if (input.raw instanceof Error) {
          input.raw.message = `Key rotation failed: ${reason}`
        }
        return undefined
      }
      const rotated = result
      log.info("rotation succeeded", { entry: rotated.entryName, alias: rotated.alias })
      input.rotated.done = true
      yield* config.invalidateCache()
      yield* provider.invalidate()
      return "Rotated exhausted ClickZetta key, retrying."
    })

    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      // Pre-capture snapshot before the LLM stream starts. The AI SDK
      // may execute tools internally before emitting start-step events,
      // so capturing inside the event handler can be too late.
      const initialSnapshot = yield* snapshot.track()
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        snapshot: initialSnapshot,
        blocked: false,
        doomLoopDetected: false,
        needsCompaction: false,
        currentText: undefined,
        lastStepText: undefined,
        stepToolCalls: [],
        reasoningMap: {},
        stepStartMs: Date.now(),
        currentStepId: undefined,
        telemetryInputMessages: undefined,
        telemetrySystemInstructions: undefined,
      }
      let aborted = false
      const slog = log.clone().tag("sessionID", input.sessionID).tag("messageID", input.assistantMessage.id)

      const parse = (e: unknown) =>
        MessageV2.fromError(e, {
          providerID: input.model.providerID,
          aborted,
        })

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const done = ctx.toolcalls[toolCallID]?.done
        delete ctx.toolcalls[toolCallID]
        if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID,
        })
        if (!part || part.type !== "tool") {
          delete ctx.toolcalls[toolCallID]
          return
        }
        return { call, part }
      })

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return
        const part = yield* session.updatePart(update(match.part))
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return part
      })

      const completeToolCall = Effect.fn("SessionProcessor.completeToolCall")(function* (
        toolCallID: string,
        output: {
          title: string
          metadata: Record<string, any>
          output: string
          attachments?: MessageV2.FilePart[]
        },
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "completed",
            input: match.part.state.input,
            output: output.output,
            metadata: output.metadata,
            title: output.title,
            time: { start: match.part.state.time.start, end: Date.now() },
            attachments: output.attachments,
          },
        })
        yield* settleToolCall(toolCallID)
        yield* bus.publish(Session.Event.ToolEnded, {
          sessionID: match.call.sessionID,
          messageID: match.call.messageID,
          id: toolCallID,
          name: match.call.toolName,
          success: true,
          durationMs: Date.now() - match.call.startMs,
          output: output.output || undefined,
        }).pipe(Effect.ignore)
      })

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (toolCallID: string, error: unknown) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return false
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "error",
            input: match.part.state.input,
            error: errorMessage(error),
            time: { start: match.part.state.time.start, end: Date.now() },
          },
        })
        if (error instanceof Permission.RejectedError || error instanceof Question.RejectedError) {
          ctx.blocked = ctx.shouldBreak
        }
        yield* settleToolCall(toolCallID)
        yield* bus.publish(Session.Event.ToolEnded, {
          sessionID: match.call.sessionID,
          messageID: match.call.messageID,
          id: toolCallID,
          name: match.call.toolName,
          success: false,
          durationMs: Date.now() - match.call.startMs,
          error: errorMessage(error),
        }).pipe(Effect.ignore)
        return true
      })

      const handleEvent = Effect.fn("SessionProcessor.handleEvent")(function* (value: StreamEvent) {
        switch (value.type) {
          case "start":
            yield* status.set(ctx.sessionID, { type: "busy" })
            return

          case "reasoning-start":
            if (value.id in ctx.reasoningMap) return
            ctx.reasoningMap[value.id] = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.reasoningMap[value.id])
            return

          case "reasoning-delta":
            if (!(value.id in ctx.reasoningMap)) return
            ctx.reasoningMap[value.id].text += value.text
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.reasoningMap[value.id].sessionID,
              messageID: ctx.reasoningMap[value.id].messageID,
              partID: ctx.reasoningMap[value.id].id,
              field: "text",
              delta: value.text,
            })
            return

          case "reasoning-end":
            if (!(value.id in ctx.reasoningMap)) return
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.reasoningMap[value.id].text = ctx.reasoningMap[value.id].text
            ctx.reasoningMap[value.id].time = { ...ctx.reasoningMap[value.id].time, end: Date.now() }
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePart(ctx.reasoningMap[value.id])
            delete ctx.reasoningMap[value.id]
            return

          case "tool-input-start":
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
            }
            const part = yield* session.updatePart({
              id: ctx.toolcalls[value.id]?.partID ?? PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "tool",
              tool: value.toolName,
              callID: value.id,
              state: { status: "pending", input: {}, raw: "" },
              metadata: value.providerExecuted ? { providerExecuted: true } : undefined,
            } satisfies MessageV2.ToolPart)
            ctx.toolcalls[value.id] = {
              done: yield* Deferred.make<void>(),
              partID: part.id,
              messageID: part.messageID,
              sessionID: part.sessionID,
              toolName: value.toolName,
              startMs: Date.now(),
            }
            return

          case "tool-input-delta":
            return

          case "tool-input-end":
            return

          case "tool-call": {
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
            }
            yield* updateToolCall(value.toolCallId, (match) => ({
              ...match,
              tool: value.toolName,
              state: {
                ...match.state,
                status: "running",
                input: value.input,
                time: { start: Date.now() },
              },
              metadata: match.metadata?.providerExecuted
                ? { ...value.providerMetadata, providerExecuted: true }
                : value.providerMetadata,
            }))
            yield* bus.publish(Session.Event.ToolCalled, {
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              id: value.toolCallId,
              name: value.toolName,
              input: value.input,
            }).pipe(Effect.ignore)
            ctx.stepToolCalls.push({ id: value.toolCallId, name: value.toolName, arguments: value.input })

            // Doom loop detection: query recent tool parts across ALL messages in this session
            const recentRows = Database.use((db) =>
              db
                .select()
                .from(PartTable)
                .where(eq(PartTable.session_id, ctx.sessionID))
                .orderBy(desc(PartTable.id))
                .limit(DOOM_LOOP_THRESHOLD * 4)
                .all(),
            )
            const recentToolParts = recentRows
              .map((row) => row.data as { type?: string; tool?: string; state?: { input?: unknown; status?: string } })
              .filter((p) => p.type === "tool" && p.state?.status !== "pending")
              .slice(0, DOOM_LOOP_THRESHOLD)

            // Check 1: identical tool calls (original check, now cross-message)
            const identicalLoop =
              recentToolParts.length === DOOM_LOOP_THRESHOLD &&
              recentToolParts.every(
                (part) =>
                  part.tool === value.toolName &&
                  JSON.stringify(part.state?.input) === JSON.stringify(value.input),
              )

            // Check 2: alternating/repeating pattern — same small set of tools called repeatedly
            // e.g. git status → git log → git status → git log (current = git status again)
            const ALTERNATING_WINDOW = DOOM_LOOP_THRESHOLD * 2
            const altParts = recentRows
              .map((row) => row.data as { type?: string; tool?: string; state?: { input?: unknown; status?: string } })
              .filter((p) => p.type === "tool" && p.state?.status !== "pending")
              .slice(0, ALTERNATING_WINDOW)
            const alternatingLoop =
              altParts.length >= ALTERNATING_WINDOW &&
              new Set(altParts.map((p) => `${p.tool}::${JSON.stringify(p.state?.input)}`)).size <= 2

            if (!identicalLoop && !alternatingLoop) {
              return
            }

            log.info("doom loop detected", { tool: value.toolName, sessionID: ctx.sessionID, identical: identicalLoop, alternating: alternatingLoop })

            ctx.doomLoopDetected = true
            ctx.blocked = true
            return
          }

          case "tool-result": {
            yield* completeToolCall(value.toolCallId, value.output)
            return
          }

          case "tool-error": {
            yield* failToolCall(value.toolCallId, value.error)
            return
          }

          case "error":
            throw value.error

          case "start-step":
            if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
            ctx.stepStartMs = Date.now()
            ctx.currentStepId = PartID.ascending()
            ctx.lastStepText = undefined
            ctx.stepToolCalls = []
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
            })
            yield* bus.publish(Session.Event.LlmStepStarted, {
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              stepId: ctx.currentStepId,
              model: ctx.model.id,
              providerID: ctx.model.providerID,
              inputMessages: ctx.telemetryInputMessages,
              systemInstructions: ctx.telemetrySystemInstructions,
            }).pipe(Effect.ignore)
            return

          case "finish-step": {
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage,
              metadata: value.providerMetadata,
            })
            ctx.assistantMessage.finish = value.finishReason
            ctx.assistantMessage.cost += usage.cost
            ctx.assistantMessage.tokens = usage.tokens
            yield* session.updatePart({
              id: PartID.ascending(),
              reason: value.finishReason,
              snapshot: yield* snapshot.track(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              tokens: usage.tokens,
              cost: usage.cost,
            })
            yield* session.updateMessage(ctx.assistantMessage)
            yield* bus.publish(Session.Event.LlmStepEnded, {
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              stepId: ctx.currentStepId ?? PartID.ascending(),
              model: ctx.model.id,
              providerID: ctx.model.providerID,
              finishReason: value.finishReason ?? "unknown",
              tokens: usage.tokens,
              cost: usage.cost,
              durationMs: Date.now() - ctx.stepStartMs,
              responseText: ctx.lastStepText || ctx.currentText?.text || undefined,
              toolCalls: ctx.stepToolCalls.length > 0 ? ctx.stepToolCalls : undefined,
            }).pipe(Effect.ignore)
            ctx.lastStepText = undefined
            ctx.currentStepId = undefined
            if (ctx.snapshot) {
              const patch = yield* snapshot.patch(ctx.snapshot)
              if (patch.files.length) {
                yield* session.updatePart({
                  id: PartID.ascending(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
              }
              ctx.snapshot = undefined
            }
            yield* summary
              .summarize({
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.parentID,
              })
              .pipe(Effect.ignore, Effect.forkIn(scope))
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsCompaction = true
            }
            return
          }

          case "text-start":
            ctx.currentText = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.currentText)
            return

          case "text-delta":
            if (!ctx.currentText) return
            ctx.currentText.text += value.text
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.currentText.sessionID,
              messageID: ctx.currentText.messageID,
              partID: ctx.currentText.id,
              field: "text",
              delta: value.text,
            })
            return

          case "text-end":
            if (!ctx.currentText) return
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.currentText.text = ctx.currentText.text
            ctx.currentText.text = (yield* plugin.trigger(
              "experimental.text.complete",
              {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                partID: ctx.currentText.id,
              },
              { text: ctx.currentText.text },
            )).text
            {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            }
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePart(ctx.currentText)
            ctx.lastStepText = ctx.currentText.text
            ctx.currentText = undefined
            return

          case "finish":
            return

          default:
            slog.info("unhandled", { event: value.type, value })
            return
        }
      })

      const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
        if (ctx.snapshot) {
          const patch = yield* snapshot.patch(ctx.snapshot)
          if (patch.files.length) {
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
          }
          ctx.snapshot = undefined
        }

        if (ctx.currentText) {
          const end = Date.now()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* session.updatePart(ctx.currentText)
          ctx.currentText = undefined
        }

        for (const part of Object.values(ctx.reasoningMap)) {
          const end = Date.now()
          yield* session.updatePart({
            ...part,
            time: { start: part.time.start ?? end, end },
          })
        }
        ctx.reasoningMap = {}

        yield* Effect.forEach(
          Object.values(ctx.toolcalls),
          (call) => Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore),
          { concurrency: "unbounded" },
        )

        for (const toolCallID of Object.keys(ctx.toolcalls)) {
          const match = yield* readToolCall(toolCallID)
          if (!match) continue
          const part = match.part
          const end = Date.now()
          const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : {}
          yield* session.updatePart({
            ...part,
            state: {
              ...part.state,
              status: "error",
              error: "Tool execution aborted",
              metadata: { ...metadata, interrupted: true },
              time: { start: "time" in part.state ? part.state.time.start : end, end },
            },
          })
        }
        ctx.toolcalls = {}
        ctx.assistantMessage.time.completed = Date.now()
        yield* session.updateMessage(ctx.assistantMessage)
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
        slog.error("process", { error: errorMessage(e), stack: e instanceof Error ? e.stack : undefined })
        const error = parse(e)
        if (MessageV2.ContextOverflowError.isInstance(error)) {
          ctx.needsCompaction = true
          yield* bus.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
          yield* bus.publish(Session.Event.TurnFinished, {
            sessionID: ctx.sessionID,
            messageID: ctx.assistantMessage.parentID,
            outcome: "context_overflow",
          }).pipe(Effect.ignore)
          return
        }
        ctx.assistantMessage.error = error
        yield* bus.publish(Session.Event.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error,
        })
        yield* bus.publish(Session.Event.TurnFinished, {
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.parentID,
          outcome: error.name === "MessageAbortedError" ? "cancelled" : "error",
        }).pipe(Effect.ignore)
        yield* status.set(ctx.sessionID, { type: "idle" })
      })

      const processStream = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
        slog.info("process")
        ctx.needsCompaction = false
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true
        const prepared = yield* Effect.exit(llm.prepare(streamInput))
        if (Exit.isFailure(prepared)) {
          yield* halt(Cause.squash(prepared.cause))
          return "stop"
        }
        let activeStreamInput = prepared.value
        ctx.telemetryInputMessages = activeStreamInput.telemetry?.inputMessages
        ctx.telemetrySystemInstructions = activeStreamInput.telemetry?.systemInstructions
        const rotated = { done: false }

        return yield* Effect.gen(function* () {
          yield* Effect.gen(function* () {
            ctx.currentText = undefined
            ctx.reasoningMap = {}
            const stream = llm.stream(activeStreamInput)

            yield* stream.pipe(
              Stream.tap((event) => handleEvent(event)),
              Stream.takeUntil(() => ctx.needsCompaction || ctx.doomLoopDetected),
              Stream.runDrain,
            )
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException("Aborted", "AbortError"))
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => Effect.fail(Cause.squash(cause)),
            ),
            Effect.retry(
              SessionRetry.policy({
                parse,
                set: (info) =>
                  status.set(ctx.sessionID, {
                    type: "retry",
                    attempt: info.attempt,
                    message: info.message,
                    next: info.next,
                  }),
                recover: ({ error, raw }) =>
                  Effect.gen(function* () {
                    if (!MessageV2.APIError.isInstance(error)) return undefined
                    const recovered = yield* recoverRotation({
                      sessionID: ctx.sessionID,
                      providerID: activeStreamInput.model.providerID,
                      error,
                      raw,
                      rotated,
                    })
                    if (!recovered) return undefined
                    const nextModel = yield* provider.getModel(activeStreamInput.model.providerID, activeStreamInput.model.id)
                    ctx.model = nextModel
                    const refreshed = yield* Effect.exit(
                      llm.prepare({
                        ...unprepareStreamInput(activeStreamInput),
                        model: nextModel,
                      }),
                    )
                    if (Exit.isFailure(refreshed)) return undefined
                    activeStreamInput = refreshed.value
                    ctx.telemetryInputMessages = activeStreamInput.telemetry?.inputMessages
                    ctx.telemetrySystemInstructions = activeStreamInput.telemetry?.systemInstructions
                    return recovered
                  }),
              }),
            ),
            Effect.catch(halt),
            Effect.ensuring(cleanup()),
          )

          if (ctx.needsCompaction) return "compact"
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
      })

      return {
        get message() {
          return ctx.assistantMessage
        },
        updateToolCall,
        completeToolCall,
        process: processStream,
      } satisfies Handle
    })

    return Service.of({ create })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Snapshot.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(ProviderRuntime.defaultLayer),
    Layer.provide(LLM.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Question.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
  ),
)

export function unprepareStreamInput(input: LLM.StreamInput): LLM.StreamInput {
  if (!("request" in input)) return input
  const { request: _request, telemetry: _telemetry, ...rest } = input
  return rest
}

export * as SessionProcessor from "./processor"
