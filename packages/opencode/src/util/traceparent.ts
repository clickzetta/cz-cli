import { context, trace, TraceFlags } from "@opentelemetry/api"
import {
  createTraceparent,
  parseTraceparent,
  serializeTraceparent,
  type ParsedTraceparent,
} from "@clickzetta/sdk"

function activeTraceparent() {
  const span = trace.getSpan(context.active())
  const spanContext = span?.spanContext()
  if (!spanContext) return
  return serializeTraceparent({
    version: "00",
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    flags: spanContext.traceFlags === TraceFlags.SAMPLED ? "01" : "00",
  })
}

export function currentTraceparent() {
  return createTraceparent(activeTraceparent() ?? process.env.CLICKZETTA_TRACEPARENT)
}

export { createTraceparent, parseTraceparent, serializeTraceparent, type ParsedTraceparent }
