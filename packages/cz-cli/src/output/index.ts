import { formatJson, formatPretty, formatTable, formatTableNoHeader, formatCsv, formatCsvNoHeader, formatJsonl, formatToon, formatText } from "./formatter.js"

export const EXIT_OK = 0
export const EXIT_BIZ_ERROR = 1
export const EXIT_USAGE_ERROR = 2

/** Set by the CLI arg parser; success/error use it for --field extraction */
export const outputState = { field: undefined as string | undefined }

export interface OutputOptions {
  format?: string
  field?: string
  aiMessage?: string
  extra?: Record<string, unknown>
  debug?: boolean
}

const TRUTHY_VALUES = new Set(["1", "true", "TRUE", "yes", "YES"])

export function shouldColorize(): boolean {
  if (process.env.NO_COLOR !== undefined) return false
  const forceColor = (process.env.CZ_FORCE_COLOR ?? process.env.CLICOLOR_FORCE ?? "").trim()
  if (TRUTHY_VALUES.has(forceColor)) return true
  return !!process.stdout.isTTY
}

export function success(
  data: unknown,
  opts?: OutputOptions & { timeMs?: number },
): void {
  const payload: Record<string, unknown> = { ok: true, data }
  if (opts?.timeMs !== undefined) payload.time_ms = opts.timeMs
  if (Array.isArray(data)) payload.count = data.length
  if (opts?.aiMessage) payload.ai_message = opts.aiMessage
  if (opts?.extra) Object.assign(payload, opts.extra)

  const output = emit(payload, opts?.format, opts?.field ?? outputState.field)
  if (output !== "") process.stdout.write(output + "\n")
  process.exitCode = EXIT_OK
}

export function successRows(
  columns: string[],
  rows: Record<string, unknown>[],
  opts?: OutputOptions & { affected?: number; timeMs?: number; noHeader?: boolean },
): void {
  const payload: Record<string, unknown> = {
    ok: true,
    columns,
    rows,
    count: rows.length,
    affected: opts?.affected ?? 0,
    time_ms: opts?.timeMs ?? 0,
  }
  if (opts?.aiMessage) payload.ai_message = opts.aiMessage
  if (opts?.extra) Object.assign(payload, opts.extra)

  const format = opts?.format ?? "json"
  const noHeader = opts?.noHeader ?? false
  let output: string

  if (format === "table") {
    output = noHeader ? formatTableNoHeader(columns, rows) : formatTable(columns, rows)
  } else if (format === "csv") {
    output = noHeader ? formatCsvNoHeader(columns, rows) : formatCsv(columns, rows)
  } else if (format === "text") {
    output = formatText(columns, rows)
  } else if (format === "jsonl") {
    output = formatJsonl(rows)
  } else {
    output = emit(payload, format)
  }

  process.stdout.write(output + "\n")
  process.exitCode = EXIT_OK
}

export function error(
  code: string,
  message: string,
  opts?: OutputOptions & { exitCode?: number },
): void {
  const errObj: Record<string, unknown> = { code, message }
  if (opts?.debug && message) {
    const err = new Error(message)
    errObj.traceback = err.stack
  }
  const payload: Record<string, unknown> = {
    ok: false,
    error: errObj,
  }
  if (opts?.aiMessage) payload.ai_message = opts.aiMessage
  if (opts?.extra) Object.assign(payload, opts.extra)

  const output = emit(payload, opts?.format, opts?.field ?? outputState.field)
  process.stdout.write(output + "\n")
  process.exitCode = opts?.exitCode ?? EXIT_BIZ_ERROR
}

function emit(payload: unknown, format?: string, field?: string): string {
  // --field extraction: search top-level → data (dict) → data[0] (list) → rows[0]
  if (field && payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    const extracted = extractField(obj, field)
    if (extracted !== undefined) {
      return typeof extracted === "object" ? JSON.stringify(extracted) : String(extracted)
    }
    // Field not found → output empty (matching Python behavior)
    return ""
  }

  switch (format) {
    case "json":
      return formatJson(payload)
    case "pretty":
      return formatPretty(payload)
    case "toon":
      return formatToon(unwrapToonEnvelope(payload))
    case "table":
      return emitAsTable(payload)
    case "csv":
      return emitAsCsv(payload)
    case "jsonl":
      return emitAsJsonl(payload)
    default:
      return formatJson(payload)
  }
}

function extractField(obj: Record<string, unknown>, field: string): unknown {
  // 1. Top-level key
  if (field in obj) return obj[field]
  // 2. data (dict)
  const data = obj.data
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (field in (data as Record<string, unknown>)) return (data as Record<string, unknown>)[field]
  }
  // 3. data[0] (list)
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
    if (field in data[0]) return data[0][field]
  }
  // 4. rows[0]
  const rows = obj.rows
  if (Array.isArray(rows) && rows.length > 0 && typeof rows[0] === "object" && rows[0] !== null) {
    if (field in rows[0]) return rows[0][field]
  }
  return undefined
}

function unwrapToonEnvelope(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload
  const obj = payload as Record<string, unknown>
  // For TOON format, unwrap the data from ok/data envelope for generic payloads
  if (obj.ok === true && obj.data !== undefined) {
    const result: Record<string, unknown> = { ok: true }
    if (obj.count !== undefined) result.count = obj.count
    if (obj.time_ms !== undefined) result.time_ms = obj.time_ms
    if (obj.ai_message !== undefined) result.ai_message = obj.ai_message
    // Merge data dict to top-level (like Python toons behavior)
    const data = obj.data
    if (data && typeof data === "object" && !Array.isArray(data)) {
      Object.assign(result, data)
    } else {
      result.data = data
    }
    return result
  }
  return payload
}

function emitAsTable(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    const data = obj.data
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
      const columns = Object.keys(data[0] as Record<string, unknown>)
      return formatTable(columns, data as Record<string, unknown>[])
    }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const columns = Object.keys(data as Record<string, unknown>)
      return formatTable(columns, [data as Record<string, unknown>])
    }
  }
  return formatPretty(payload)
}

function emitAsCsv(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    const data = obj.data
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
      const columns = Object.keys(data[0] as Record<string, unknown>)
      return formatCsv(columns, data as Record<string, unknown>[])
    }
  }
  return formatPretty(payload)
}

function emitAsJsonl(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    const rows = obj.rows
    if (Array.isArray(rows)) {
      return formatJsonl(rows as Record<string, unknown>[])
    }
    const data = obj.data
    if (Array.isArray(data)) {
      return formatJsonl(data as Record<string, unknown>[])
    }
  }
  return formatJson(payload)
}
