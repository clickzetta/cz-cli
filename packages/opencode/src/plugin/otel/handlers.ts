import { trace, type Span } from "@opentelemetry/api"
import { SeverityNumber, type Logger } from "@opentelemetry/api-logs"
import { setCurrentSessionSpanContext, getSessionOtelContext } from "./context"

const tracer = trace.getTracer("opencode")

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

export function initHandlers(logger: Logger) {
  _logger = logger
}

function sessionAttributes(
  sessionID?: string,
  attrs?: Record<string, string | number | boolean>,
) {
  return {
    ...(sessionID ? { "opencode.session.id": sessionID } : {}),
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

export function handleEvent(event: { type: string; properties: Record<string, any> }) {
  try {
    const p = event.properties
    switch (event.type) {
      case "session.created":
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "Session created",
          eventName: "opencode.session.created",
          attributes: sessionAttributes(p.sessionID),
        })
        break
      case "session.deleted":
        endPromptSpan()
        setCurrentSessionSpanContext(undefined)
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "Session deleted",
          eventName: "opencode.session.deleted",
          attributes: sessionAttributes(p.sessionID),
        })
        break
      case "session.status": {
        const statusType = p.status?.type
        if (statusType === "busy") {
          endPromptSpan()
          if (tracingEnabled("prompt")) {
            const span = tracer.startSpan("prompt", { attributes: { "opencode.session.id": p.sessionID ?? "" } })
            promptSpan = span
            setCurrentSessionSpanContext(span.spanContext())
          }
          emitLog({
            severityNumber: SeverityNumber.INFO,
            severityText: "INFO",
            body: "User prompt started",
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
      case "session.idle":
        endPromptSpan()
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "Session idle",
          eventName: "opencode.session.idle",
          attributes: sessionAttributes(p.sessionID),
        })
        break
      }
  } catch {}
}

export function shutdown() {
  endPromptSpan()
  setCurrentSessionSpanContext(undefined)
}
