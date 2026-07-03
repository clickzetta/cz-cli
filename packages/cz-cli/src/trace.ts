import { createTraceContext, formatTraceQueryTag, parseTraceparent, type TraceContext } from "@clickzetta/sdk"

export function currentTraceContext(): TraceContext {
  const tp = process.env.CLICKZETTA_TRACEPARENT
  const parsed = parseTraceparent(tp)
  if (parsed) {
    return { ...parsed, traceparent: tp!, parentSpanId: "" }
  }
  return createTraceContext()
}

export function defaultQueryTag(traceContext = currentTraceContext()) {
  return formatTraceQueryTag(traceContext)
}

export function parseCurrentTraceparent() {
  return parseTraceparent(process.env.CLICKZETTA_TRACEPARENT)
}
