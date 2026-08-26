import { context, trace, TraceFlags, type Span, type SpanContext } from "@opentelemetry/api"
import { serializeTraceparent } from "./traceparent"

//: Per-session turn spans, so a consumer that knows its sessionID gets its own trace
//: rather than whichever session happened to fill the single slot below first.
const sessionSpanContexts = new Map<string, SpanContext>()
let currentSessionSpanContext: SpanContext | undefined
let currentLlmSpan: Span | undefined
let rawRequestCaptureEnabled = true

export function setCurrentSessionSpanContext(spanContext: SpanContext | undefined) {
  currentSessionSpanContext = spanContext
}

export function setSessionSpanContext(sessionID: string, spanContext: SpanContext | undefined) {
  if (!sessionID) return
  if (spanContext) sessionSpanContexts.set(sessionID, spanContext)
  else sessionSpanContexts.delete(sessionID)
}

function serialize(spanContext: SpanContext) {
  return serializeTraceparent({
    version: "00",
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    flags: spanContext.traceFlags === TraceFlags.SAMPLED ? "01" : "00",
  })
}

/**
 * Traceparent for a named session, falling back to the process-wide slot only when the
 * caller has no sessionID — the pty paths, where a missing parent is the honest answer.
 * Everything else (`chat.headers`, `shell.env` from the shell and task tools) does know
 * its session, and handing it another session's trace is worse than handing it none.
 */
export function getSessionTraceparent(sessionID?: string): string | undefined {
  const own = sessionID ? sessionSpanContexts.get(sessionID) : undefined
  if (own) return serialize(own)
  if (sessionID) return undefined
  return currentSessionSpanContext ? serialize(currentSessionSpanContext) : undefined
}

export function setCurrentLlmSpan(span: Span | undefined) {
  currentLlmSpan = span
}

export function clearCurrentLlmSpan(span: Span | undefined) {
  if (currentLlmSpan !== span) return
  currentLlmSpan = undefined
}

export function setRawRequestCaptureEnabled(enabled: boolean) {
  rawRequestCaptureEnabled = enabled
}

export function recordRawProviderRequest(event: {
  providerID: string
  modelID: string
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  bodyBase64?: string
  bytes?: number
}) {
  if (!rawRequestCaptureEnabled || !currentLlmSpan) return
  currentLlmSpan.setAttributes({
    "clickzetta.llm.raw_request.provider": event.providerID,
    "clickzetta.llm.raw_request.model": event.modelID,
    "clickzetta.llm.raw_request.url": event.url,
    "clickzetta.llm.raw_request.method": event.method,
    "clickzetta.llm.raw_request.headers": JSON.stringify(event.headers),
    "clickzetta.llm.raw_request.body": event.body ?? "",
    "clickzetta.llm.raw_request.body_base64": event.bodyBase64 ?? "",
    "clickzetta.llm.raw_request.bytes": event.bytes ?? 0,
  })
}

export function getSessionSpanRef(): { traceId: string; spanId: string } | undefined {
  if (!currentSessionSpanContext) return undefined
  return { traceId: currentSessionSpanContext.traceId, spanId: currentSessionSpanContext.spanId }
}

export function clearSessionSpanContexts() {
  sessionSpanContexts.clear()
}

export function getSessionOtelContext() {
  if (!currentSessionSpanContext) return context.active()
  return trace.setSpanContext(context.active(), currentSessionSpanContext)
}

export function withSessionOtelContext<T>(fn: () => T): T {
  return context.with(getSessionOtelContext(), fn)
}
