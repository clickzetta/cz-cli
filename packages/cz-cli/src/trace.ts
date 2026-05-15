import {
  createTraceContext,
  formatTraceQueryTag,
  parseTraceparent,
} from "@clickzetta/sdk"

export function currentTraceContext() {
  return createTraceContext(process.env.CLICKZETTA_TRACEPARENT)
}

export function defaultQueryTag(traceContext = currentTraceContext()) {
  return formatTraceQueryTag(traceContext)
}

export function parseCurrentTraceparent() {
  return parseTraceparent(process.env.CLICKZETTA_TRACEPARENT)
}
