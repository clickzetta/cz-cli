import { context, trace, TraceFlags } from "@opentelemetry/api"
import { createTraceparent, parseTraceparent, serializeTraceparent, type ParsedTraceparent } from "@clickzetta/sdk"
import { getCurrentSessionTraceparent } from "@/plugin/otel/context"

function activeTraceparent() {
  const span = trace.getSpan(context.active())
  const spanContext = span?.spanContext()
  if (!spanContext) return
  if (spanContext.traceId === "00000000000000000000000000000000") return
  return serializeTraceparent({
    version: "00",
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    flags: spanContext.traceFlags === TraceFlags.SAMPLED ? "01" : "00",
  })
}

export function currentTraceparent() {
  return createTraceparent(activeTraceparent() ?? getCurrentSessionTraceparent() ?? process.env.CLICKZETTA_TRACEPARENT)
}

export { createTraceparent, parseTraceparent, serializeTraceparent, type ParsedTraceparent }
