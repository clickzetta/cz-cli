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
  /**
   * Name of the field inside `data` that holds the list, for payloads that wrap
   * a list next to some metadata (`{ tasks: [...] }`, `{ name, tables: [...] }`).
   * Row-oriented formats (table/csv/text/jsonl) render that field as the rows;
   * json/pretty/toon are untouched, so declaring it changes no JSON contract.
   */
  rowsKey?: string
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
  const output = renderOutput(payload, opts?.format, field, opts?.rowsKey)
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

export function renderOutput(payload: unknown, format?: string, field?: string, rowsKey?: string): string {
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
      return emitRowFormat(payload, "table", rowsKey)
    case "csv":
      return emitRowFormat(payload, "csv", rowsKey)
    case "jsonl":
      return emitRowFormat(payload, "jsonl", rowsKey)
    case "text":
      return emitRowFormat(payload, "text", rowsKey)
    default:
      return formatJson(payload)
  }
}

/**
 * Render an `{ error: … }` envelope. Row-oriented formats get a single
 * `ERROR <code>: <message>` line instead of JSON, so a `--format text` consumer
 * reads one shape for every failure. Exported because the yargs fail handlers
 * (cli.ts, command-group.ts) render usage errors themselves rather than through
 * error(); they must not diverge from it.
 */
export function renderErrorOutput(payload: unknown, format?: string, field?: string): string {
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

/**
 * Rows projected out of a result envelope for the row-oriented formats
 * (table/csv/text/jsonl). `items` carries the original array when the rows came
 * from one, so jsonl can emit those objects verbatim instead of rebuilding them.
 */
interface RowProjection {
  columns: string[]
  rows: unknown[][]
  items?: unknown[]
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Every key seen across the records, in first-appearance order. */
function unionColumns(records: Record<string, unknown>[]): string[] {
  const columns: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue
      seen.add(key)
      columns.push(key)
    }
  }
  return columns
}

/** One array → one table. Records become columns; scalars become a single column. */
function projectArray(items: unknown[], scalarColumn: string): RowProjection {
  if (items.length > 0 && items.every(isRecordValue)) {
    const records = items as Record<string, unknown>[]
    const columns = unionColumns(records)
    return { columns, rows: records.map((record) => columns.map((column) => record[column])), items }
  }
  return { columns: items.length > 0 ? [scalarColumn] : [], rows: items.map((value) => [value]), items }
}

/**
 * Keys a `columns` + `rows` envelope may carry and still BE that envelope. Anything
 * else alongside them means the payload is a record that merely contains a grid:
 * `sql --batch` writes `{ index, sql, columns, rows, count, time_ms, job_id? }` per
 * statement, and treating that as the table dropped `index`/`sql`/`time_ms` — the
 * only things telling a consumer which statement a grid belonged to — and rendered a
 * DDL statement (no columns) as a blank line.
 */
const TABULAR_ENVELOPE_KEYS = new Set(["columns", "rows", "count", "time_ms", "ai_message"])

function isTabularEnvelope(payload: Record<string, unknown>): boolean {
  if (!Array.isArray(payload.columns) || !Array.isArray(payload.rows)) return false
  return Object.keys(payload).every((key) => TABULAR_ENVELOPE_KEYS.has(key))
}

/**
 * The single row-shape decision for every row-oriented format. It lives here,
 * once, because the failure mode of having it four times over was that a fix
 * landed in one format and silently missed the others.
 *
 * Order matters, and every step is triggered by something the CALLER did — none of
 * it is inferred from payload shape:
 *   1. a bare `columns` + `rows` envelope — already a table (successRows).
 *   2. `data` IS the list — the normal list command.
 *   3. `data[rowsKey]` — the command declared which field holds the list.
 *   4. anything else — one object, one row.
 *
 * Step 3 is opt-in on purpose. An earlier revision also PROJECTED any object that
 * happened to hold exactly one array-of-records, which changed the rendering of
 * commands nobody had looked at: `datasource check` lost `ready`, the verdict it
 * exists to deliver, because a projected list's scalar siblings are dropped. A
 * command whose list should be rows now says so.
 *
 * Scalar siblings of a projected list (`active_profile`, `table_count`) are not
 * part of the table; json/pretty/toon still carry them, and `--field` reaches
 * them directly.
 */
function projectRows(payload: unknown, rowsKey?: string): RowProjection | undefined {
  if (!isRecordValue(payload)) return undefined

  if (isTabularEnvelope(payload)) {
    const columns = (payload.columns as unknown[]).filter((column): column is string => typeof column === "string")
    const rows = (payload.rows as unknown[]).map((row) => (Array.isArray(row) ? row : [row]))
    return { columns, rows }
  }

  const data = payload.data
  if (Array.isArray(data)) return projectArray(data, "value")
  if (!isRecordValue(data)) return undefined

  if (rowsKey) {
    const declared = data[rowsKey]
    if (Array.isArray(declared)) return projectArray(declared, rowsKey)
  }

  const columns = Object.keys(data)
  return { columns, rows: [columns.map((column) => data[column])] }
}

type RowFormat = "table" | "csv" | "text" | "jsonl"

/**
 * Payloads with nothing tabular in them (an `error` envelope reaching a row
 * format directly, say) keep each format's historical fallback: compact JSON for
 * the machine-facing text/jsonl, indented JSON for the human-facing table/csv.
 * `test/e2e-routing.ts` parses the text one as JSON, so this is a contract.
 */
const NON_TABULAR_FALLBACK: Record<RowFormat, (payload: unknown) => string> = {
  table: formatPretty,
  csv: formatPretty,
  text: formatJson,
  jsonl: formatJson,
}

function emitRowFormat(payload: unknown, format: RowFormat, rowsKey?: string): string {
  const projection = projectRows(payload, rowsKey)
  if (!projection) return NON_TABULAR_FALLBACK[format](payload)
  // An empty list is empty output, not a JSON envelope leaking into a row format.
  if (projection.columns.length === 0) return ""
  switch (format) {
    case "table":
      return formatTable(projection.columns, projection.rows)
    case "csv":
      return formatCsv(projection.columns, projection.rows)
    case "text":
      return formatText(projection.columns, projection.rows)
    case "jsonl":
      return formatJsonl(projection.items ?? rowsToRecords(projection.columns, projection.rows))
  }
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
