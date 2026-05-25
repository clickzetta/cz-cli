const VERSION = "00"
const TRACE_ID_RE = /^[0-9a-f]{32}$/
const SPAN_ID_RE = /^[0-9a-f]{16}$/
const FLAGS_RE = /^[0-9a-f]{2}$/

export interface ParsedTraceparent {
  version: string
  traceId: string
  spanId: string
  flags: string
}

export interface TraceContext extends ParsedTraceparent {
  traceparent: string
  parentSpanId: string
}

function hex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function validTraceId(value: string) {
  return TRACE_ID_RE.test(value) && value !== "00000000000000000000000000000000"
}

function validSpanId(value: string) {
  return SPAN_ID_RE.test(value) && value !== "0000000000000000"
}

export function parseTraceparent(value?: string | null) {
  if (!value) return
  const parts = value.trim().toLowerCase().split("-")
  if (parts.length !== 4) return
  const [version, traceId, spanId, flags] = parts
  if (version !== VERSION) return
  if (!validTraceId(traceId) || !validSpanId(spanId) || !FLAGS_RE.test(flags)) return
  return {
    version,
    traceId,
    spanId,
    flags,
  } satisfies ParsedTraceparent
}

export function serializeTraceparent(parsed: ParsedTraceparent) {
  return `${parsed.version}-${parsed.traceId}-${parsed.spanId}-${parsed.flags}`
}

export function createTraceparent(parent?: string | ParsedTraceparent, flags = "01") {
  const parsed = typeof parent === "string" ? parseTraceparent(parent) : parent
  const next = parsed
    ? {
        version: VERSION,
        traceId: parsed.traceId,
        spanId: hex(8),
        flags: parsed.flags,
      }
    : {
        version: VERSION,
        traceId: hex(16),
        spanId: hex(8),
        flags,
      }
  return serializeTraceparent(next)
}

export function createTraceContext(parent?: string | ParsedTraceparent, flags = "01") {
  const parsedParent = typeof parent === "string" ? parseTraceparent(parent) : parent
  const traceparent = createTraceparent(parsedParent, flags)
  const parsed = parseTraceparent(traceparent)
  if (!parsed) {
    throw new Error("failed to create traceparent")
  }
  return {
    ...parsed,
    traceparent,
    parentSpanId: parsedParent?.spanId ?? "",
  } satisfies TraceContext
}

export function formatTraceQueryTag(context: Pick<TraceContext, "traceparent">) {
  return context.traceparent
}

export function currentTraceparent() {
  return createTraceparent(process.env.CLICKZETTA_TRACEPARENT)
}
