import { formatJson, formatPretty, formatTable, formatTableNoHeader, formatCsv, formatCsvNoHeader, formatJsonl, formatToon } from "./formatter.js"

export const EXIT_OK = 0
export const EXIT_BIZ_ERROR = 1
export const EXIT_USAGE_ERROR = 2

export interface OutputOptions {
  format?: string
  aiMessage?: string
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
): never {
  const payload: Record<string, unknown> = { ok: true, data }
  if (opts?.timeMs !== undefined) payload.time_ms = opts.timeMs
  if (Array.isArray(data)) payload.count = data.length
  if (opts?.aiMessage) payload.ai_message = opts.aiMessage

  const output = emit(payload, opts?.format)
  process.stdout.write(output + "\n")
  process.exit(EXIT_OK)
}

export function successRows(
  columns: string[],
  rows: Record<string, unknown>[],
  opts?: OutputOptions & { affected?: number; timeMs?: number; noHeader?: boolean },
): never {
  const payload: Record<string, unknown> = {
    ok: true,
    columns,
    rows,
    count: rows.length,
  }
  if (opts?.affected !== undefined) payload.affected = opts.affected
  if (opts?.timeMs !== undefined) payload.time_ms = opts.timeMs
  if (opts?.aiMessage) payload.ai_message = opts.aiMessage

  const format = opts?.format ?? "table"
  const noHeader = opts?.noHeader ?? false
  let output: string

  if (format === "table") {
    output = noHeader ? formatTableNoHeader(columns, rows) : formatTable(columns, rows)
  } else if (format === "csv") {
    output = noHeader ? formatCsvNoHeader(columns, rows) : formatCsv(columns, rows)
  } else if (format === "jsonl") {
    output = formatJsonl(rows)
  } else {
    output = emit(payload, format)
  }

  process.stdout.write(output + "\n")
  process.exit(EXIT_OK)
}

export function error(
  code: string,
  message: string,
  opts?: OutputOptions & { exitCode?: number },
): never {
  const payload = {
    ok: false,
    error: { code, message },
  }

  const output = emit(payload, opts?.format)
  process.stdout.write(output + "\n")
  process.exit(opts?.exitCode ?? EXIT_BIZ_ERROR)
}

function emit(payload: unknown, format?: string): string {
  switch (format) {
    case "json":
      return formatJson(payload)
    case "pretty":
      return formatPretty(payload)
    case "toon":
      return formatToon(payload)
    case "table":
      return emitAsTable(payload)
    case "csv":
      return emitAsCsv(payload)
    case "jsonl":
      return emitAsJsonl(payload)
    default:
      return formatPretty(payload)
  }
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
