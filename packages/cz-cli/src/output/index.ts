import { formatJson, formatPretty, formatTable, formatTableNoHeader, formatCsv, formatCsvNoHeader, formatJsonl, formatToon, formatText } from "./formatter.js"

const VALID_FORMATS = new Set(["json", "pretty", "table", "csv", "text", "jsonl", "toon"])

export function defaultFormat(): string {
  const env = process.env.CZ_FORMAT?.trim()
  if (env && VALID_FORMATS.has(env)) return env
  return "json"
}

export const EXIT_OK = 0
export const EXIT_BIZ_ERROR = 1
export const EXIT_USAGE_ERROR = 2

export class HandledCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Set by the CLI arg parser; success/error use it for --field extraction */
export const outputState = { field: undefined as string | undefined }

export interface OutputOptions {
  format?: string
  field?: string
  aiMessage?: string
  extra?: Record<string, unknown>
  debug?: boolean
}

const ROW_ONLY_FORMATS = new Set(["table", "csv", "text", "jsonl"])

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
  const payload: Record<string, unknown> = { data }
  if (opts?.timeMs !== undefined) payload.time_ms = opts.timeMs
  if (Array.isArray(data)) payload.count = data.length
  if (opts?.aiMessage) payload.ai_message = opts.aiMessage
  if (opts?.extra) Object.assign(payload, opts.extra)

  const field = opts?.field ?? outputState.field
  const output = renderOutput(payload, opts?.format, field)
  if (output !== "") process.stdout.write(output + "\n")
  writeAiMessageToStderr(opts?.format, field, opts?.aiMessage)
  ;(process as unknown as Record<string, unknown>).responseBytes = Buffer.byteLength(output, "utf-8")
  process.exitCode = EXIT_OK
}

export function successRows(
  columns: string[],
  rows: unknown[][],
  opts?: OutputOptions & { timeMs?: number; noHeader?: boolean },
): void {
  const payload: Record<string, unknown> = {
    columns,
    rows,
    count: rows.length,
    time_ms: opts?.timeMs ?? 0,
  }
  if (opts?.aiMessage) payload.ai_message = opts.aiMessage
  if (opts?.extra) Object.assign(payload, opts.extra)

  const format = opts?.format ?? defaultFormat()
  const field = opts?.field ?? outputState.field
  const noHeader = opts?.noHeader ?? false
  let output: string

  // --field extraction takes priority over format
  if (field) {
    output = renderOutput(payload, format, field)
    if (output !== "") process.stdout.write(output + "\n")
    writeAiMessageToStderr(format, field, opts?.aiMessage)
    process.exitCode = EXIT_OK
    return
  }

  if (format === "table") {
    output = noHeader ? formatTableNoHeader(columns, rows) : formatTable(columns, rows)
  } else if (format === "csv") {
    output = noHeader ? formatCsvNoHeader(columns, rows) : formatCsv(columns, rows)
  } else if (format === "text") {
    output = formatText(columns, rows)
  } else if (format === "jsonl") {
    output = formatJsonl(rowsToRecords(columns, rows))
  } else {
    output = renderOutput(payload, format)
  }

  process.stdout.write(output + "\n")
  writeAiMessageToStderr(format, field, opts?.aiMessage)
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
    error: errObj,
  }
  if (opts?.aiMessage) payload.ai_message = opts.aiMessage
  if (opts?.extra) Object.assign(payload, opts.extra)

  const output = renderErrorOutput(payload, opts?.format, opts?.field ?? outputState.field)
  process.stdout.write(output + "\n")
  process.exitCode = opts?.exitCode ?? EXIT_BIZ_ERROR
  ;(process as unknown as Record<string, unknown>).lastError = message
}

export function handledError(
  code: string,
  message: string,
  opts?: OutputOptions & { exitCode?: number },
): never {
  error(code, message, opts)
  throw new HandledCliError(code, message)
}

export function isHandledCliError(err: unknown): err is HandledCliError {
  return err instanceof HandledCliError
}

export function renderOutput(payload: unknown, format?: string, field?: string): string {
  // --field extraction: search top-level → data (dict) → data[0] (list) → rows[0]
  if (field && payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    const extracted = extractField(obj, field)
    if (extracted !== undefined) {
      return typeof extracted === "object" ? formatJson(extracted) : String(extracted)
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
    case "text":
      return emitAsText(payload)
    default:
      return formatJson(payload)
  }
}

function renderErrorOutput(payload: unknown, format?: string, field?: string): string {
  if (!field && ROW_ONLY_FORMATS.has(format ?? "json") && payload && typeof payload === "object") {
    const err = (payload as Record<string, unknown>).error
    if (err && typeof err === "object") {
      const code = (err as Record<string, unknown>).code
      const message = (err as Record<string, unknown>).message
      return `ERROR ${String(code ?? "ERROR")}: ${String(message ?? "Unknown error")}`
    }
  }
  return renderOutput(payload, format, field)
}

function extractField(obj: Record<string, unknown>, field: string): unknown {
  // Support dot notation and array index: "data[0].name", "data.row_count"
  const parts = field.replace(/\[(\d+)\]/g, ".$1").split(".")
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      const idx = parseInt(part, 10)
      if (isNaN(idx)) return undefined
      current = current[idx]
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  if (current !== undefined) return current

  // Fallback: simple key lookup in data/rows (backward compat)
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
  // 4. rows[0] (object)
  const rows = obj.rows
  if (Array.isArray(rows) && rows.length > 0 && typeof rows[0] === "object" && rows[0] !== null && !Array.isArray(rows[0])) {
    if (field in rows[0]) return rows[0][field]
  }
  // 5. SQL-style: columns + rows (positional arrays)
  const columns = obj.columns
  if (Array.isArray(columns) && Array.isArray(rows)) {
    const idx = columns.indexOf(field)
    if (idx !== -1) return rows.map((r) => Array.isArray(r) ? r[idx] : r).join("\n")
  }
  return undefined
}

function unwrapToonEnvelope(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload
  const obj = payload as Record<string, unknown>
  // For TOON format, unwrap the data from data envelope for generic payloads
  if (obj.data !== undefined && !obj.error) {
    const result: Record<string, unknown> = {}
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
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null && !Array.isArray(data[0])) {
      const columns = Object.keys(data[0] as Record<string, unknown>)
      const rows = (data as Record<string, unknown>[]).map((r) => columns.map((c) => r[c]))
      return formatTable(columns, rows)
    }
    if (Array.isArray(data) && data.length > 0) {
      const rows = data.map((v) => [v === null || v === undefined ? "" : String(v)])
      return formatTable(["value"], rows)
    }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const columns = Object.keys(data as Record<string, unknown>)
      const row = columns.map((c) => (data as Record<string, unknown>)[c])
      return formatTable(columns, [row])
    }
  }
  return formatPretty(payload)
}

function emitAsCsv(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    const data = obj.data
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null && !Array.isArray(data[0])) {
      const columns = Object.keys(data[0] as Record<string, unknown>)
      const rows = (data as Record<string, unknown>[]).map((r) => columns.map((c) => r[c]))
      return formatCsv(columns, rows)
    }
    if (Array.isArray(data) && data.length > 0) {
      const rows = data.map((v) => [v === null || v === undefined ? "" : String(v)])
      return formatCsv(["value"], rows)
    }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const columns = Object.keys(data as Record<string, unknown>)
      const row = columns.map((c) => (data as Record<string, unknown>)[c])
      return formatCsv(columns, [row])
    }
  }
  return formatPretty(payload)
}

function emitAsJsonl(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    const rows = obj.rows
    if (Array.isArray(rows)) {
      const columns = Array.isArray(obj.columns) ? obj.columns.filter((value): value is string => typeof value === "string") : []
      return formatJsonl(columns.length > 0 ? rowsToRecords(columns, rows as unknown[][]) : rows)
    }
    const data = obj.data
    if (Array.isArray(data)) {
      return formatJsonl(data)
    }
  }
  return formatJson(payload)
}

function emitAsText(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    const data = obj.data
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null && !Array.isArray(data[0])) {
      const columns = Object.keys(data[0] as Record<string, unknown>)
      const rows = (data as Record<string, unknown>[]).map((r) => columns.map((c) => r[c]))
      return formatText(columns, rows)
    }
    if (Array.isArray(data) && data.length > 0) {
      return data.map((v) => (v === null || v === undefined ? "" : String(v))).join("\n")
    }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const columns = Object.keys(data as Record<string, unknown>)
      const row = columns.map((c) => (data as Record<string, unknown>)[c])
      return formatText(columns, [row])
    }
  }
  return formatJson(payload)
}

function rowsToRecords(columns: string[], rows: unknown[][]): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]])),
  )
}

function writeAiMessageToStderr(format: string | undefined, field: string | undefined, aiMessage: string | undefined): void {
  if (!aiMessage) return
  if (!field && !ROW_ONLY_FORMATS.has(format ?? "json")) return
  process.stderr.write(aiMessage + "\n")
}

export function parseOutputArgs(args: string[]): { format?: string; field?: string } {
  let format: string | undefined
  let field: string | undefined
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (value === "--output" || value === "-o") {
      format = args[index + 1]
      index++
      continue
    }
    if (value === "--format") {
      format = args[index + 1]
      index++
      continue
    }
    if (value === "--field") {
      field = args[index + 1]
      index++
      continue
    }
    if (value?.startsWith("--output=")) format = value.slice("--output=".length)
    if (value?.startsWith("-o=")) format = value.slice(3)
    if (value?.startsWith("--format=")) format = value.slice("--format=".length)
    if (value?.startsWith("--field=")) field = value.slice("--field=".length)
  }
  return { format, field }
}
