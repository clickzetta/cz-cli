import { createTraceContext, formatTraceQueryTag } from "@clickzetta/sdk"

export function currentTraceContext() {
  return createTraceContext(process.env.CLICKZETTA_TRACEPARENT)
}

export function defaultQueryTag(traceContext = currentTraceContext()) {
  return formatTraceQueryTag(traceContext)
}

export function withDefaultQueryTag(hints?: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(hints ?? {}, "query_tag")) {
    return hints ?? {}
  }
  return {
    query_tag: defaultQueryTag(),
    ...hints,
  } satisfies Record<string, unknown>
}
