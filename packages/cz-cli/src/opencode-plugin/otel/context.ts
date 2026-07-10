import { context, trace, TraceFlags, type Span, type SpanContext } from "@opentelemetry/api"
import { serializeTraceparent } from "./traceparent"

let currentSessionSpanContext: SpanContext | undefined
let currentLlmSpan: Span | undefined
let rawRequestCaptureEnabled = true

export function setCurrentSessionSpanContext(spanContext: SpanContext | undefined) {
  currentSessionSpanContext = spanContext
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

export function getCurrentSessionTraceparent(): string | undefined {
  if (!currentSessionSpanContext) return undefined
  return serializeTraceparent({
    version: "00",
    traceId: currentSessionSpanContext.traceId,
    spanId: currentSessionSpanContext.spanId,
    flags: currentSessionSpanContext.traceFlags === TraceFlags.SAMPLED ? "01" : "00",
  })
}

export function getSessionOtelContext() {
  if (!currentSessionSpanContext) return context.active()
  return trace.setSpanContext(context.active(), currentSessionSpanContext)
}

export function withSessionOtelContext<T>(fn: () => T): T {
  return context.with(getSessionOtelContext(), fn)
}
