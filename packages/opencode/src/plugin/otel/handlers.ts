import { trace, SpanStatusCode, type Span } from "@opentelemetry/api"
import { logs, SeverityNumber } from "@opentelemetry/api-logs"
import { setCurrentSessionSpanContext, getSessionOtelContext } from "./context"
import * as m from "./metrics"

const tracer = trace.getTracer("opencode")

let promptSpan: Span | undefined
const stepSpans = new Map<string, Span>()
const toolSpans = new Map<string, Span>()

// Parse OPENCODE_DISABLE_TRACES once. Value is comma-separated categories,
// e.g. "tool,llm". Logs and metrics are never affected.
const disabledTraceCategories: ReadonlySet<string> = new Set(
  (process.env.OPENCODE_DISABLE_TRACES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
)

function tracingEnabled(category: string): boolean {
  return !disabledTraceCategories.has(category)
}

function endPromptSpan() {
  if (!promptSpan) return
  promptSpan.end()
  promptSpan = undefined
}

function emitLog(severity: SeverityNumber, body: string, attrs?: Record<string, string>) {
  const logger = logs.getLogger("opencode")
  logger.emit({ severityNumber: severity, body, attributes: attrs, context: getSessionOtelContext() })
}

export function handleEvent(event: { type: string; properties: Record<string, any> }) {
  try {
    switch (event.type) {
      case "session.created":
        onSessionCreated(event.properties)
        break
      case "session.deleted":
        onSessionDeleted(event.properties)
        break
      case "v2.prompt":
        onPrompt(event.properties)
        break
      case "v2.step.started":
        onStepStarted(event.properties)
        break
      case "v2.step.ended":
        onStepEnded(event.properties)
        break
      case "v2.tool.called":
        onToolCalled(event.properties)
        break
      case "v2.tool.success":
      case "v2.tool.error":
        onToolEnded(event.type, event.properties)
        break
    }
  } catch {}
}

function onSessionCreated(props: Record<string, any>) {
  const sessionId = props.sessionID ?? props.sessionId
  if (!sessionId) return
  m.sessionCounter.add(1)
  emitLog(SeverityNumber.INFO, "session.created", { "session.id": sessionId })
}

function onSessionDeleted(props: Record<string, any>) {
  const sessionId = props.sessionID ?? props.sessionId
  endPromptSpan()
  setCurrentSessionSpanContext(undefined)
  emitLog(SeverityNumber.INFO, "session.deleted", { "session.id": sessionId ?? "" })
}

function onPrompt(props: Record<string, any>) {
  endPromptSpan()

  if (tracingEnabled("prompt")) {
    const span = tracer.startSpan("prompt", {
      attributes: { "prompt.length": props.text?.length ?? 0 },
    })
    promptSpan = span
    setCurrentSessionSpanContext(span.spanContext())
  }

  m.messageCounter.add(1)
  emitLog(SeverityNumber.INFO, "user.prompt", { "prompt.length": String(props.text?.length ?? 0) })
}

function onStepStarted(props: Record<string, any>) {
  const stepId = props.id
  if (!stepId) return
  if (!tracingEnabled("llm")) return
  const span = tracer.startSpan(
    "llm.step",
    { attributes: { "step.id": stepId, "model.id": props.model ?? "" } },
    getSessionOtelContext(),
  )
  stepSpans.set(stepId, span)
}

function onStepEnded(props: Record<string, any>) {
  const stepId = props.id
  if (!stepId) return
  const span = stepSpans.get(stepId)
  if (!span) return

  if (props.tokens) {
    const tokens = props.tokens
    if (tokens.input) m.tokenUsage.add(tokens.input, { type: "input" })
    if (tokens.output) m.tokenUsage.add(tokens.output, { type: "output" })
    span.setAttribute("tokens.input", tokens.input ?? 0)
    span.setAttribute("tokens.output", tokens.output ?? 0)
  }
  if (props.cost) span.setAttribute("cost", props.cost)

  m.llmCallDuration.record(props.duration ?? 0)
  span.end()
  stepSpans.delete(stepId)
}

function onToolCalled(props: Record<string, any>) {
  const toolId = props.id
  if (!toolId) return
  if (!tracingEnabled("tool")) {
    m.toolCallCounter.add(1, { name: props.name ?? "unknown" })
    return
  }
  const span = tracer.startSpan(
    "tool.call",
    { attributes: { "tool.id": toolId, "tool.name": props.name ?? "" } },
    getSessionOtelContext(),
  )
  toolSpans.set(toolId, span)
  m.toolCallCounter.add(1, { name: props.name ?? "unknown" })
}

function onToolEnded(type: string, props: Record<string, any>) {
  const toolId = props.id
  if (!toolId) return
  const span = toolSpans.get(toolId)
  if (!span) return

  if (type === "v2.tool.error") {
    span.setStatus({ code: SpanStatusCode.ERROR, message: props.error ?? "unknown" })
    m.errorCounter.add(1, { source: "tool" })
  }
  span.end()
  toolSpans.delete(toolId)
}

export function shutdown() {
  endPromptSpan()
  for (const span of stepSpans.values()) span.end()
  for (const span of toolSpans.values()) span.end()
  stepSpans.clear()
  toolSpans.clear()
  setCurrentSessionSpanContext(undefined)
}
