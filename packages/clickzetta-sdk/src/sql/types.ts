export interface JobID {
  id: string
  workspace: string
  instanceId: number
}

export enum JobStatus {
  SUBMITTED = "SUBMITTED",
  RUNNING = "RUNNING",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
  UNKNOWN = "UNKNOWN",
}

export interface ColumnSchema {
  name: string
  type: string
  nullable?: boolean
}

export interface QueryResult {
  jobId: string
  status: JobStatus
  columns: ColumnSchema[]
  rows: unknown[][]
  rowCount: number
  timeZone?: string
  errorCode?: string
  errorMessage?: string
}

/**
 * client.py:1347-1352 _format_job_id format:
 *   YYYYMMDDHHMMSSffffff + 5-digit random
 * Example: 20240102123456789012 + 98765 → "2024010212345678901298765"
 *
 * The gateway relies on this ID format for routing / log correlation, so we
 * mirror it exactly instead of using an unrelated ID scheme.
 */
function formatJobIdCore(): string {
  const now = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, "0")
  const ts =
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds()) +
    pad(now.getMilliseconds(), 3) + "000" // microseconds padded with zeros (ms * 1000)
  const rand = Math.floor(10000 + Math.random() * 90000) // 5-digit [10000,99999]
  return `${ts}${rand}`
}

export function newJobId(workspace: string, instanceId: number): JobID {
  return { id: formatJobIdCore(), workspace, instanceId }
}

// ---------------------------------------------------------------------------
// DB-API 2.0 type objects (types.py:34-48)
// ---------------------------------------------------------------------------

/**
 * types.py:34-39 _DBAPITypeObject — a type tag that compares equal to any
 * of its member type-category strings. Mirrors Python's __eq__ override.
 */
export class DBAPITypeObject {
  readonly values: ReadonlySet<string>
  constructor(...values: string[]) {
    this.values = new Set(values)
  }
  /** Returns true when typeCategory is one of this object's values. */
  equals(typeCategory: string): boolean {
    return this.values.has(typeCategory.toUpperCase())
  }
}

/** types.py:42 STRING */
export const STRING = new DBAPITypeObject("STRING", "CHAR", "VARCHAR")
/** types.py:43 BINARY */
export const BINARY = new DBAPITypeObject("BINARY", "ARRAY", "STRUCT", "MAP", "VECTOR", "JSON")
/** types.py:44-46 NUMBER */
export const NUMBER = new DBAPITypeObject("INT8", "INT32", "INT64", "FLOAT32", "FLOAT64", "DECIMAL", "BOOL")
/** types.py:47 DATETIME */
export const DATETIME = new DBAPITypeObject("TIMESTAMP", "DATE")
/** types.py:48 ROWID */
export const ROWID = "ROWID"

/**
 * types.py:13-24 Binary — construct a DB-API binary value from various inputs.
 * In TS we return a Uint8Array.
 */
export function Binary(data: string | ArrayBufferLike | Iterable<number>): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data)
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data as Iterable<number>)
}

/**
 * types.py:6-10 Date/Time/Timestamp constructors (DB-API 2.0 spec).
 */
export function DateFromTicks(ticks: number): Date { return new Date(ticks * 1000) }
export function TimestampFromTicks(ticks: number): Date { return new Date(ticks * 1000) }
export function TimeFromTicks(ticks: number): string {
  const d = new Date(ticks * 1000)
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`
}

// ---------------------------------------------------------------------------
// Additional enums from enums.py
// ---------------------------------------------------------------------------

/** enums.py:92-96 JobRequestMode */
export const JobRequestMode = {
  UNKNOWN: "UNKNOWN",
  HYBRID: "HYBRID",
  ASYNC: "ASYNC",
  SYNC: "SYNC",
} as const

/** enums.py:76-79 JobType */
export const JobType = {
  SQL_JOB: "SQL_JOB",
  COMPACTION_JOB: "COMPACTION_JOB",
} as const

/** enums.py:56-59 QueryPriority */
export const QueryPriority = {
  INTERACTIVE: "INTERACTIVE",
  BATCH: "BATCH",
} as const

/** enums.py:62-74 QueryApiMethod */
export const QueryApiMethod = {
  SELECT: "SELECT",
  SHOW: "SHOW",
  DROP: "DROP",
  ALTER: "ALTER",
  CREATE: "CREATE",
  TRUNCATE: "TRUNCATE",
} as const

/** enums.py:20-27 Compression */
export const Compression = {
  GZIP: "GZIP",
  DEFLATE: "DEFLATE",
  SNAPPY: "SNAPPY",
  NONE: "NONE",
} as const

/** enums.py:6 DEFAULT_NS */
export const DEFAULT_NS = ["default", "lh"] as const

// ---------------------------------------------------------------------------
// DB-API 2.0 ColumnDescription (_dbapi.py:12-118)
// ---------------------------------------------------------------------------

/**
 * _dbapi.py:12-118 ColumnDescription — PEP 249 cursor.description element.
 * Extends ColumnSchema with the full set of DB-API 2.0 metadata fields.
 */
export interface ColumnDescription {
  /** Column name */
  name: string
  /** Type category string (e.g. "INT32", "STRING") */
  type_code: string
  display_size: number | null
  internal_size: number | null
  precision: number | null
  scale: number | null
  null_ok: boolean
}

/**
 * _dbapi.py:119-142 Field — named tuple for schema field metadata.
 */
export interface Field {
  name: string
  field_type: string
  mode: string
  description: string | null
  precision: number | null
  scale: number | null
}

/**
 * _dbapi.py:144-148 proto_to_field — convert a proto dict to a Field.
 */
export function protoToField(data: Record<string, unknown>): Field {
  return {
    name: String(data["name"] ?? ""),
    field_type: String(data["type"] ?? data["field_type"] ?? ""),
    mode: String(data["mode"] ?? "NULLABLE"),
    description: data["description"] != null ? String(data["description"]) : null,
    precision: data["precision"] != null ? Number(data["precision"]) : null,
    scale: data["scale"] != null ? Number(data["scale"]) : null,
  }
}

/**
 * _dbapi.py:150-158 create_field — create a Field from name + type category.
 */
export function createField(name: string, typeCategory: string): Field {
  return {
    name,
    field_type: typeCategory,
    mode: "NULLABLE",
    description: null,
    precision: null,
    scale: null,
  }
}

/** enums.py:381-383 ErrorStatus */
export const ErrorStatus = {
  Unauthorized: "UNAUTHORIZED",
} as const

/** enums.py:385-395 SourceFormat */
export const SourceFormat = {
  CSV: "CSV",
  NEWLINE_DELIMITED_JSON: "NEWLINE_DELIMITED_JSON",
  AVRO: "AVRO",
  PARQUET: "PARQUET",
  ORC: "ORC",
} as const

/** enums.py:397-400 KeyResultStatementKind */
export const KeyResultStatementKind = {
  KEY_RESULT_STATEMENT_KIND_UNSPECIFIED: "KEY_RESULT_STATEMENT_KIND_UNSPECIFIED",
  LAST: "LAST",
  FIRST_SELECT: "FIRST_SELECT",
} as const
