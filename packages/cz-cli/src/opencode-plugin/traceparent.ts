import { context, trace, TraceFlags } from "@opentelemetry/api"
import { createTraceparent } from "@clickzetta/sdk"
import { getCurrentSessionTraceparent } from "./otel/context.js"

function activeTraceparent() {
  const span = trace.getSpan(context.active())
  const spanContext = span?.spanContext()
  if (!spanContext) return
  if (spanContext.traceId === "00000000000000000000000000000000") return
  return `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags === TraceFlags.SAMPLED ? "01" : "00"}`
}

export function currentTraceparent() {
  return createTraceparent(activeTraceparent() ?? getCurrentSessionTraceparent() ?? process.env.CLICKZETTA_TRACEPARENT)
}
