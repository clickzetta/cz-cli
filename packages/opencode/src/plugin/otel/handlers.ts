import { SpanKind, trace, SpanStatusCode, type Span } from "@opentelemetry/api"
import { SeverityNumber, type Logger } from "@opentelemetry/api-logs"
import {
  clearCurrentLlmSpan,
  getSessionOtelContext,
  setCurrentLlmSpan,
  setCurrentSessionSpanContext,
  setRawRequestCaptureEnabled,
} from "./context"
import * as m from "./metrics"

const tracer = trace.getTracer("opencode")

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildOutputMessages(p: Record<string, any>): string | undefined {
  const parts: Array<Record<string, unknown>> = []
  if (p.responseText) {
    parts.push({ type: "text", content: p.responseText })
  }
  if (p.toolCalls?.length) {
    for (const tc of p.toolCalls) {
      parts.push({ type: "tool_call", id: tc.id, name: tc.name, arguments: tc.arguments })
    }
  }
  if (parts.length === 0) return undefined
  return JSON.stringify([{ role: "assistant", parts, finish_reason: p.finishReason ?? "unknown" }])
}

// Parse OPENCODE_DISABLE_TRACES once. Value is comma-separated categories,
// e.g. "tool,llm". Logs and metrics are never affected.
const disabledTraceCategories: ReadonlySet<string> = new Set(
  (process.env.OPENCODE_DISABLE_TRACES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
)

function tracingEnabled(category: string): boolean {
  return !disabledTraceCategories.has(category)
}

let _logger: Logger | undefined
let promptSpan: Span | undefined
let preflightSpan: Span | undefined
let _recordContent = true
const stepSpans = new Map<string, Span>()
const toolSpans = new Map<string, Span>()
const sessionStartMs = new Map<string, number>()

export function initHandlers(logger: Logger, recordContent?: boolean) {
  _logger = logger
  _recordContent = recordContent ?? true
  setRawRequestCaptureEnabled(_recordContent)
}

function sessionAttributes(
  sessionID?: string,
  attrs?: Record<string, string | number | boolean>,
) {
  return {
    ...(sessionID ? { "opencode.session.id": sessionID, "langfuse.session.id": sessionID } : {}),
    ...attrs,
  }
}

function emitLog(input: {
  severityNumber: SeverityNumber
  severityText: string
  body: string
  eventName: string
  attributes?: Record<string, string | number | boolean>
}) {
  _logger?.emit({
    severityNumber: input.severityNumber,
    severityText: input.severityText,
    body: input.body,
    attributes: {
      "event.name": input.eventName,
      ...input.attributes,
    },
    context: getSessionOtelContext(),
  })
}

function endPromptSpan() {
  if (!promptSpan) return
  promptSpan.end()
  promptSpan = undefined
}

function endPreflightSpan() {
  if (!preflightSpan) return
  preflightSpan.end()
  preflightSpan = undefined
}

export function handleEvent(event: { type: string; properties: Record<string, any> }) {
  try {
    const p = event.properties
    switch (event.type) {
      case "session.created":
        m.sessionCounter.add(1)
        if (p.sessionID) sessionStartMs.set(p.sessionID, Date.now())
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "session.created",
          eventName: "opencode.session.created",
          attributes: sessionAttributes(p.sessionID),
        })
        break

      case "session.deleted": {
        endPromptSpan()
        setCurrentSessionSpanContext(undefined)
        const startMs = p.sessionID ? sessionStartMs.get(p.sessionID) : undefined
        const durationMs = startMs ? Date.now() - startMs : undefined
        if (p.sessionID) sessionStartMs.delete(p.sessionID)
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "session.deleted",
          eventName: "opencode.session.deleted",
          attributes: sessionAttributes(p.sessionID, {
            ...(durationMs != null ? { "opencode.session.duration_ms": durationMs } : {}),
          }),
        })
        break
      }

      case "session.status": {
        const statusType = p.status?.type
        if (statusType === "busy") {
          emitLog({
            severityNumber: SeverityNumber.INFO,
            severityText: "INFO",
            body: "session.prompt.started",
            eventName: "opencode.session.prompt.started",
            attributes: sessionAttributes(p.sessionID, {
              "gen_ai.conversation.id": p.sessionID ?? "",
              "gen_ai.operation.name": "chat",
            }),
          })
          break
        }
        if (statusType === "idle") endPromptSpan()
        break
      }

      case "session.turn.started": {
        endPromptSpan()
        endPreflightSpan()
        if (tracingEnabled("prompt")) {
          const span = tracer.startSpan("prompt", {
            attributes: {
              "opencode.session.id": p.sessionID ?? "",
              "opencode.message.id": p.messageID ?? "",
              "opencode.agent.name": p.agent ?? "",
              ...(p.model ? { "gen_ai.request.model": p.model } : {}),
              "opencode.turn.parts": p.parts ?? 0,
            },
          })
          promptSpan = span
          setCurrentSessionSpanContext(span.spanContext())
        }
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "session.turn.started",
          eventName: "opencode.session.turn.started",
          attributes: sessionAttributes(p.sessionID, {
            "opencode.message.id": p.messageID ?? "",
            "opencode.agent.name": p.agent ?? "",
            ...(p.model ? { "gen_ai.request.model": p.model } : {}),
            "opencode.turn.parts": p.parts ?? 0,
          }),
        })
        break
      }

      case "session.turn.finished":
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "session.turn.finished",
          eventName: "opencode.session.turn.finished",
          attributes: sessionAttributes(p.sessionID, {
            "opencode.message.id": p.messageID ?? "",
            "opencode.turn.outcome": p.outcome ?? "unknown",
          }),
        })
        if (promptSpan) promptSpan.setAttribute("opencode.turn.outcome", p.outcome ?? "unknown")
        endPreflightSpan()
        endPromptSpan()
        setCurrentSessionSpanContext(undefined)
        break

      case "session.preflight.started":
        endPreflightSpan()
        if (tracingEnabled("prompt")) {
          preflightSpan = tracer.startSpan(
            "preflight",
            {
              attributes: {
                "opencode.session.id": p.sessionID ?? "",
                "opencode.message.id": p.messageID ?? "",
              },
            },
            getSessionOtelContext(),
          )
        }
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "session.preflight.started",
          eventName: "opencode.session.preflight.started",
          attributes: sessionAttributes(p.sessionID, {
            "opencode.message.id": p.messageID ?? "",
          }),
        })
        break

      case "session.preflight.finished":
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "session.preflight.finished",
          eventName: "opencode.session.preflight.finished",
          attributes: sessionAttributes(p.sessionID, {
            "opencode.message.id": p.messageID ?? "",
            "opencode.preflight.outcome": p.outcome ?? "unknown",
          }),
        })
        if (preflightSpan) preflightSpan.setAttribute("opencode.preflight.outcome", p.outcome ?? "unknown")
        endPreflightSpan()
        break

      case "session.error": {
        const name = p.error?.name ?? "UnknownError"
        const message =
          (p.error?.data && typeof p.error.data === "object" && "message" in p.error.data
            ? String((p.error.data as Record<string, unknown>).message ?? "")
            : "") || name
        promptSpan?.setStatus({ code: SpanStatusCode.ERROR, message })
        preflightSpan?.setStatus({ code: SpanStatusCode.ERROR, message })
        emitLog({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "session.error",
          eventName: "opencode.session.error",
          attributes: sessionAttributes(p.sessionID, {
            "error.name": name,
            "error.message": message,
          }),
        })
        break
      }

      case "session.idle":
        endPromptSpan()
        endPreflightSpan()
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "session.idle",
          eventName: "opencode.session.idle",
          attributes: sessionAttributes(p.sessionID),
        })
        break

      // LLM step started: open a "chat {model}" span per GenAI spec
      case "v2.step.started": {
        if (!tracingEnabled("llm")) break
        const spanName = `chat ${p.model ?? "unknown"}`
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": p.providerID ?? "",
            "gen_ai.request.model": p.model ?? "",
            "gen_ai.conversation.id": p.sessionID ?? "",
            "opencode.session.id": p.sessionID ?? "",
            "langfuse.session.id": p.sessionID ?? "",
            ...(p.inputMessages && _recordContent ? { "gen_ai.input.messages": p.inputMessages } : {}),
            ...(p.systemInstructions && _recordContent
              ? { "gen_ai.system_instructions": p.systemInstructions }
              : {}),
          },
        }, getSessionOtelContext())
        stepSpans.set(p.stepId, span)
        setCurrentLlmSpan(span)
        break
      }

      // LLM step finished: close span, emit log, record metrics
      case "v2.step.ended": {
        const span = stepSpans.get(p.stepId)
        if (span) {
          const outputMessages = buildOutputMessages(p)
          span.setAttributes({
            "gen_ai.response.model": p.model ?? "",
            "gen_ai.response.finish_reasons": [p.finishReason ?? "unknown"],
            "gen_ai.usage.input_tokens": p.tokens?.input ?? 0,
            "gen_ai.usage.output_tokens": p.tokens?.output ?? 0,
            "gen_ai.usage.cache_read.input_tokens": p.tokens?.cache?.read ?? 0,
            "gen_ai.usage.cache_creation.input_tokens": p.tokens?.cache?.write ?? 0,
            "gen_ai.usage.reasoning.output_tokens": p.tokens?.reasoning ?? 0,
            ...(outputMessages && _recordContent ? { "gen_ai.output.messages": outputMessages } : {}),
          })
          span.end()
          stepSpans.delete(p.stepId)
          clearCurrentLlmSpan(span)
        }
        const tokens = p.tokens ?? {}
        if (tokens.input) m.tokenUsage.record(tokens.input, { "gen_ai.token.type": "input", "gen_ai.provider.name": p.providerID ?? "", "gen_ai.request.model": p.model ?? "" })
        if (tokens.output) m.tokenUsage.record(tokens.output, { "gen_ai.token.type": "output", "gen_ai.provider.name": p.providerID ?? "", "gen_ai.request.model": p.model ?? "" })
        if (p.durationMs) m.operationDuration.record(p.durationMs / 1000, { "gen_ai.operation.name": "chat", "gen_ai.provider.name": p.providerID ?? "", "gen_ai.request.model": p.model ?? "" })
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "llm.step.finished",
          eventName: "opencode.llm.step.finished",
          attributes: sessionAttributes(p.sessionID, {
            "gen_ai.provider.name": p.providerID ?? "",
            "gen_ai.request.model": p.model ?? "",
            "gen_ai.response.finish_reasons": p.finishReason ?? "unknown",
            "gen_ai.usage.input_tokens": tokens.input ?? 0,
            "gen_ai.usage.output_tokens": tokens.output ?? 0,
            "gen_ai.usage.cache_read.input_tokens": tokens.cache?.read ?? 0,
            "gen_ai.usage.cache_creation.input_tokens": tokens.cache?.write ?? 0,
            "gen_ai.usage.reasoning.output_tokens": tokens.reasoning ?? 0,
            "opencode.llm.cost": p.cost ?? 0,
            "opencode.llm.duration_ms": p.durationMs ?? 0,
          }),
        })
        break
      }

      // Tool call started: open "execute_tool {name}" span per GenAI spec
      case "v2.tool.called": {
        m.toolCallCounter.add(1, { "gen_ai.tool.name": p.name ?? "unknown" })
        if (!tracingEnabled("tool")) break
        const toolInput = _recordContent && p.input != null ? safeStringify(p.input) : undefined
        const span = tracer.startSpan(`execute_tool ${p.name ?? "unknown"}`, {
          attributes: {
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": p.name ?? "",
            "gen_ai.tool.call.id": p.id ?? "",
            "opencode.session.id": p.sessionID ?? "",
            ...(toolInput ? { "gen_ai.tool.call.arguments": toolInput } : {}),
          },
        }, getSessionOtelContext())
        toolSpans.set(p.id, span)
        break
      }

      // Tool call finished (success or error)
      case "v2.tool.ended": {
        const span = toolSpans.get(p.id)
        if (span) {
          if (!p.success) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: p.error ?? "unknown" })
            m.errorCounter.add(1, { source: "tool", "gen_ai.tool.name": p.name ?? "unknown" })
          }
          if (_recordContent && p.output) span.setAttribute("gen_ai.tool.call.result", p.output)
          if (p.error) span.setAttribute("error.message", p.error)
          span.end()
          toolSpans.delete(p.id)
        }
        if (p.durationMs) m.toolCallDuration.record(p.durationMs / 1000, { "gen_ai.tool.name": p.name ?? "unknown" })
        emitLog({
          severityNumber: p.success ? SeverityNumber.INFO : SeverityNumber.ERROR,
          severityText: p.success ? "INFO" : "ERROR",
          body: p.success ? "tool.call.completed" : "tool.call.failed",
          eventName: "opencode.tool.finished",
          attributes: sessionAttributes(p.sessionID, {
            "gen_ai.tool.name": p.name ?? "",
            "gen_ai.tool.call.id": p.id ?? "",
            "opencode.tool.duration_ms": p.durationMs ?? 0,
            ...(p.error ? { "error.message": p.error } : {}),
          }),
        })
        break
      }
    }
  } catch {}
}

export function shutdown() {
  endPromptSpan()
  endPreflightSpan()
  setCurrentLlmSpan(undefined)
  for (const span of stepSpans.values()) span.end()
  for (const span of toolSpans.values()) span.end()
  stepSpans.clear()
  toolSpans.clear()
  sessionStartMs.clear()
  setCurrentSessionSpanContext(undefined)
}
