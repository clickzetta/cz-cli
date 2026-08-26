import { context, trace, TraceFlags } from "@opentelemetry/api"
import { createTraceparent } from "@clickzetta/sdk"
import { getSessionTraceparent } from "./otel/context.js"

function activeTraceparent() {
  const span = trace.getSpan(context.active())
  const spanContext = span?.spanContext()
  if (!spanContext) return
  if (spanContext.traceId === "00000000000000000000000000000000") return
  return `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags === TraceFlags.SAMPLED ? "01" : "00"}`
}

/**
 * `sessionID` is optional only for callers that genuinely lack one (the pty paths). Pass it
 * whenever it is available: without it the fallback is the process-wide slot, which under
 * `serve` belongs to whichever session opened a turn first.
 */
export function currentTraceparent(sessionID?: string) {
  return createTraceparent(activeTraceparent() ?? getSessionTraceparent(sessionID) ?? process.env.CLICKZETTA_TRACEPARENT)
}
