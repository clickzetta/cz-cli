const VERSION = "00"
const TRACE_ID_RE = /^[0-9a-f]{32}$/
const SPAN_ID_RE = /^[0-9a-f]{16}$/

function hex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((value) => value.toString(16).padStart(2, "0"))
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
  if (!validTraceId(traceId) || !validSpanId(spanId) || !/^[0-9a-f]{2}$/.test(flags)) return
  return { version, traceId, spanId, flags }
}

export function serializeTraceparent(parsed: { version: string; traceId: string; spanId: string; flags: string }) {
  return `${parsed.version}-${parsed.traceId}-${parsed.spanId}-${parsed.flags}`
}

export function createTraceparent(parent?: string, flags = "01") {
  const parsed = parseTraceparent(parent)
  return serializeTraceparent(
    parsed
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
        },
  )
}
