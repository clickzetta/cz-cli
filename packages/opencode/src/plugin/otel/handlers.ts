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

function emitLog(severity: SeverityNumber, body: string, attrs?: Record<string, string>) {
  _logger?.emit({ severityNumber: severity, body, attributes: attrs, context: getSessionOtelContext() })
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
        emitLog(SeverityNumber.INFO, "session.created", { "session.id": p.sessionID ?? "" })
        break
      case "session.deleted":
        endPromptSpan()
        setCurrentSessionSpanContext(undefined)
        emitLog(SeverityNumber.INFO, "session.deleted", { "session.id": p.sessionID ?? "" })
        break
      case "session.status": {
        const statusType = p.status?.type
        if (statusType === "busy") {
          endPromptSpan()
          if (tracingEnabled("prompt")) {
            const span = tracer.startSpan("prompt", { attributes: { "session.id": p.sessionID ?? "" } })
            promptSpan = span
            setCurrentSessionSpanContext(span.spanContext())
          }
          emitLog(SeverityNumber.INFO, "user.prompt", { "session.id": p.sessionID ?? "" })
        } else if (statusType === "idle") {
          endPromptSpan()
        }
        break
      }
      case "session.idle":
        endPromptSpan()
        emitLog(SeverityNumber.INFO, "session.idle", { "session.id": p.sessionID ?? "" })
        break
    }
  } catch {}
}

export function shutdown() {
  endPromptSpan()
  setCurrentSessionSpanContext(undefined)
}
