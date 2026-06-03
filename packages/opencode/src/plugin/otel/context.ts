import { context, trace, TraceFlags, type SpanContext } from "@opentelemetry/api"
import { serializeTraceparent } from "@clickzetta/sdk"

let currentSessionSpanContext: SpanContext | undefined

export function setCurrentSessionSpanContext(spanContext: SpanContext | undefined) {
  currentSessionSpanContext = spanContext
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
