import type { Argv } from "yargs"
import { readFileSync, openSync, readSync, closeSync } from "node:fs"
import { splitSql, JobStatus, type QueryResult } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, successRows, error } from "../output/index.js"
import { maskRows } from "../output/masking.js"
import { logOperation } from "../logger.js"
import { getExecContext, execSql, isQueryResult, validateIdentifier, type ExecContext } from "./exec.js"

const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|RENAME|FORK)\b/i
const SELECT_RE = /^\s*(SELECT\b|WITH\b[\s\S]*?\bSELECT\b|SHOW\b)/i
const LIMIT_RE = /\bLIMIT\s+\d+/i
const SHOW_RE = /^\s*SHOW\b/i
const TABLE_NOT_FOUND_RE = /Table.*?not found/i
const COLUMN_NOT_FOUND_RE = /(Unknown column|Column.*?not found)/i
const TABLE_FROM_SQL_RE = /\b(?:FROM|INTO|UPDATE|TABLE)\s+(?:[\w.]+\.)?(\w+)/i
const DANGEROUS_WRITE_RE = /^\s*(DELETE|UPDATE)\b/i
const WHERE_RE = /\bWHERE\b/i

const DEFAULT_FIELD_MAX = 3000
const DEFAULT_ROW_LIMIT = 100

interface SqlArgs extends GlobalArgs {
  statement?: string
  write: boolean
  "with-schema": boolean
  "no-truncate": boolean
  file?: string
  execute?: string
  stdin: boolean
  sync: boolean
  timeout: number
  variable?: string[]
  set?: string[]
  "job-profile"?: string
  "no-header": boolean
  "no-limit": boolean
  batch: boolean
}

function truncateLargeFields(rows: Record<string, unknown>[], maxLen: number): Record<string, unknown>[] {
  for (const row of rows) {
    for (const [key, val] of Object.entries(row)) {
      if (typeof val === "string" && val.length > maxLen) {
        row[key] = val.slice(0, maxLen) + `...(truncated, ${val.length} chars)`
      }
    }
  }
  return rows
}

function applyVariables(sql: string, vars: Record<string, string>): string {
  return sql.replace(/%\((\w+)\)s/g, (match, key) => {
    if (key in vars) return vars[key]
    return match
  })
}

function parseKvPairs(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=")
    if (eqIdx > 0) {
      result[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim()
    }
  }
  return result
}

function extractTableNames(sql: string): string[] {
  const tables: string[] = []
  const re = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([\w.`"]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    const name = m[1].replace(/[`"]/g, "")
    if (!tables.includes(name)) tables.push(name)
  }
  return tables
}

function resolveSql(argv: SqlArgs): string {
  if (argv.execute) return argv.execute
  if (argv.file) return readFileSync(argv.file, "utf-8")
  if (argv.stdin || !process.stdin.isTTY) {
    const chunks: Buffer[] = []
    const fd = openSync("/dev/stdin", "r")
    const buf = Buffer.alloc(4096)
    let n: number
    while ((n = readSync(fd, buf)) > 0) {
      chunks.push(buf.subarray(0, n))
    }
    closeSync(fd)
    return Buffer.concat(chunks).toString("utf-8")
  }
  if (argv.statement) return argv.statement
  error("USAGE_ERROR", "No SQL provided. Use positional arg, -e, -f, or pipe via stdin.", { exitCode: 2 })
}

async function fetchSchemaHint(ctx: ExecContext, sql: string, errMsg: string): Promise<string | undefined> {
  try {
    if (TABLE_NOT_FOUND_RE.test(errMsg)) {
      const r = await execSql(ctx, "SHOW TABLES")
      if (isQueryResult(r) && r.status === JobStatus.SUCCEEDED && r.rows.length > 0) {
        const names = r.rows.map((row) => Object.values(row)[0]).join(", ")
        return `Available tables: ${names}`
      }
    }
    if (COLUMN_NOT_FOUND_RE.test(errMsg)) {
      const m = TABLE_FROM_SQL_RE.exec(sql)
      if (m) {
        const table = validateIdentifier(m[1], "table name")
        const r = await execSql(ctx, `DESC TABLE ${table}`)
        if (isQueryResult(r) && r.status === JobStatus.SUCCEEDED && r.rows.length > 0) {
          const cols = r.rows.map((row) => Object.values(row)[0]).join(", ")
          return `Columns in ${table}: ${cols}`
        }
      }
    }
  } catch {
    // schema hint is best-effort
  }
  return undefined
}

async function fetchWithSchema(ctx: ExecContext, sql: string): Promise<string | undefined> {
  const tables = extractTableNames(sql)
  if (tables.length === 0) return undefined
  const parts: string[] = []
  for (const table of tables) {
    try {
      validateIdentifier(table, "table name")
      const r = await execSql(ctx, `DESC TABLE ${table}`)
      if (isQueryResult(r) && r.status === JobStatus.SUCCEEDED && r.rows.length > 0) {
        const cols = r.rows.map((row) => {
          const vals = Object.values(row)
          return `${vals[0]} ${vals[1] ?? ""}`
        }).join(", ")
        parts.push(`${table}(${cols})`)
      }
    } catch {
      // skip tables we can't describe
    }
  }
  return parts.length > 0 ? `Schema: ${parts.join("; ")}` : undefined
}

async function executeSingle(
  ctx: ExecContext,
  sql: string,
  argv: SqlArgs,
  hints: Record<string, string>,
): Promise<void> {
  const isWrite = WRITE_RE.test(sql)
  const isSelect = SELECT_RE.test(sql)
  const isShow = SHOW_RE.test(sql)
  const hasLimit = LIMIT_RE.test(sql)
  const format = argv.output
  const fieldMax = argv["no-truncate"] ? Infinity : DEFAULT_FIELD_MAX
  const rowLimit = argv["no-limit"] ? Infinity : DEFAULT_ROW_LIMIT
  const t0 = Date.now()

  if (isWrite && !argv.write) {
    error("WRITE_PROTECTION", "Write operation detected. Pass --write to confirm.", { format })
  }
  if (isWrite && DANGEROUS_WRITE_RE.test(sql) && !WHERE_RE.test(sql)) {
    error("DANGEROUS_WRITE", "DELETE/UPDATE without WHERE clause. Add a WHERE clause or use a more specific statement.", { format })
  }

  if (!argv.sync) {
    const r = await execSql(ctx, sql, { hints, asynchronous: true })
    logOperation("sql", { sql, ok: true, timeMs: Date.now() - t0 })
    if (isQueryResult(r)) {
      emitResult(r, sql, argv, ctx, t0)
    } else {
      success(r, {
        format,
        aiMessage: "Job submitted asynchronously. Use `cz-tool status` or poll the job_id to check results.",
      })
    }
    return
  }

  // Sync mode: SELECT without user LIMIT → inject LIMIT to guard
  if (isSelect && !hasLimit && !isShow && rowLimit !== Infinity) {
    const probeLimit = rowLimit + 1
    const probeSql = sql.replace(/\s*;?\s*$/, ` LIMIT ${probeLimit}`)
    const r = await execSql(ctx, probeSql, { hints, timeoutMs: argv.timeout })
    if (!isQueryResult(r)) error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format })
    if (r.status === JobStatus.FAILED) {
      const hint = await fetchSchemaHint(ctx, sql, r.errorMessage ?? "")
      const msg = hint ? `${r.errorMessage}\n${hint}` : (r.errorMessage ?? "Query failed")
      logOperation("sql", { sql, ok: false, errorCode: r.errorCode, timeMs: Date.now() - t0 })
      error(r.errorCode ?? "SQL_ERROR", msg, { format })
    }
    if (r.rowCount > rowLimit) {
      logOperation("sql", { sql, ok: false, errorCode: "LIMIT_REQUIRED", timeMs: Date.now() - t0 })
      error("LIMIT_REQUIRED", `Query returned more than ${rowLimit} rows. Add a LIMIT clause or pass --no-limit.`, { format })
    }
    emitResult(r, sql, argv, ctx, t0)
    return
  }

  // Sync mode: SELECT with user LIMIT N → probe with N+1 to detect truncation
  if (isSelect && hasLimit && !isShow && !argv["no-limit"]) {
    const limitMatch = sql.match(/\bLIMIT\s+(\d+)/i)
    if (limitMatch) {
      const userLimit = parseInt(limitMatch[1], 10)
      const probeSql = sql.replace(/\bLIMIT\s+\d+/i, `LIMIT ${userLimit + 1}`)
      const r = await execSql(ctx, probeSql, { hints, timeoutMs: argv.timeout })
      if (!isQueryResult(r)) error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format })
      if (r.status === JobStatus.FAILED) {
        await handleFailure(r, sql, ctx, format, t0)
      }
      let aiMessage: string | undefined
      let rows = r.rows
      if (rows.length > userLimit) {
        rows = rows.slice(0, userLimit)
        aiMessage = `Results truncated to ${userLimit} rows (more available).`
      }
      emitResult({ ...r, rows }, sql, argv, ctx, t0, aiMessage)
      return
    }
  }

  // General case: SHOW, write, or other
  const r = await execSql(ctx, sql, { hints, timeoutMs: argv.timeout })
  if (!isQueryResult(r)) error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format })
  if (r.status === JobStatus.FAILED) {
    await handleFailure(r, sql, ctx, format, t0)
  }

  if (isShow && !argv["no-limit"] && r.rowCount > rowLimit) {
    logOperation("sql", { sql, ok: false, errorCode: "LIMIT_REQUIRED", timeMs: Date.now() - t0 })
    error("LIMIT_REQUIRED", `SHOW returned more than ${rowLimit} rows. Pass --no-limit to see all.`, { format })
  }

  emitResult(r, sql, argv, ctx, t0)
}

async function handleFailure(r: QueryResult, sql: string, ctx: ExecContext, format: string, t0: number): Promise<never> {
  const hint = await fetchSchemaHint(ctx, sql, r.errorMessage ?? "")
  const msg = hint ? `${r.errorMessage}\n${hint}` : (r.errorMessage ?? "Query failed")
  logOperation("sql", { sql, ok: false, errorCode: r.errorCode, timeMs: Date.now() - t0 })
  error(r.errorCode ?? "SQL_ERROR", msg, { format })
}

function emitResult(
  r: QueryResult,
  sql: string,
  argv: SqlArgs,
  ctx: ExecContext,
  t0: number,
  aiMessage?: string,
): never {
  const format = argv.output
  const fieldMax = argv["no-truncate"] ? Infinity : DEFAULT_FIELD_MAX
  const isWrite = WRITE_RE.test(sql)

  if (isWrite) {
    logOperation("sql", { sql, ok: true, affected: r.affectedRows, timeMs: Date.now() - t0 })
    success({ affected_rows: r.affectedRows, job_id: r.jobId }, { format, timeMs: Date.now() - t0, aiMessage })
  }

  const columns = r.columns.map((c) => c.name)
  let rows = maskRows(columns, r.rows)
  if (fieldMax !== Infinity) rows = truncateLargeFields(rows, fieldMax)
  logOperation("sql", { sql, ok: true, rows: rows.length, timeMs: Date.now() - t0 })
  successRows(columns, rows, { format, timeMs: Date.now() - t0, aiMessage, noHeader: argv["no-header"] })
}

async function handler(argv: SqlArgs): Promise<void> {
  const format = argv.output

  if (argv["job-profile"]) {
    error("NOT_IMPLEMENTED", "Job profile is not yet supported in the TypeScript CLI.", { format })
  }

  let sql = resolveSql(argv)
  if (argv.variable && argv.variable.length > 0) {
    sql = applyVariables(sql, parseKvPairs(argv.variable))
  }
  const hints = argv.set ? parseKvPairs(argv.set) : undefined

  try {
    const ctx = await getExecContext(argv)
    const statements = splitSql(sql).map((s) => s.trim()).filter(Boolean)
    if (statements.length === 0) {
      error("USAGE_ERROR", "No SQL statements found.", { format, exitCode: 2 })
    }
    // Multi-statement: execute all, return last result
    if (statements.length > 1) {
      for (let i = 0; i < statements.length - 1; i++) {
        const r = await execSql(ctx, statements[i], { hints, timeoutMs: argv.timeout })
        if (isQueryResult(r) && r.status === JobStatus.FAILED) {
          logOperation("sql", { sql: statements[i], ok: false, errorCode: r.errorCode })
          error(r.errorCode ?? "SQL_ERROR", r.errorMessage ?? "Query failed", { format })
        }
      }
    }
    await executeSingle(ctx, statements[statements.length - 1], argv, hints ?? {})
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logOperation("sql", { sql, ok: false, errorCode: "EXEC_ERROR" })
    error("EXEC_ERROR", msg, { format })
  }
}

export function registerSqlCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "sql [statement]",
    "Execute SQL against ClickZetta",
    (yargs) =>
      yargs
        .positional("statement", { type: "string", describe: "SQL statement" })
        .option("write", { type: "boolean", default: false, describe: "Allow write operations" })
        .option("with-schema", { type: "boolean", default: false, describe: "Include table schema in response" })
        .option("no-truncate", { type: "boolean", default: false, describe: "Disable field truncation" })
        .option("file", { alias: "f", type: "string", describe: "Read SQL from file" })
        .option("execute", { alias: "e", type: "string", describe: "SQL string to execute" })
        .option("stdin", { type: "boolean", default: false, describe: "Read SQL from stdin" })
        .option("sync", { type: "boolean", default: false, describe: "Execute synchronously (wait for result)" })
        .option("timeout", { type: "number", default: 300_000, describe: "Job timeout in ms" })
        .option("variable", { type: "array", string: true, describe: "Variable substitution KEY=VALUE" })
        .option("set", { type: "array", string: true, describe: "Hint KEY=VALUE" })
        .option("job-profile", { type: "string", describe: "Get job profile for a job ID" })
        .option("no-header", { alias: "N", type: "boolean", default: false, describe: "Omit column headers" })
        .option("no-limit", { type: "boolean", default: false, describe: "Disable automatic LIMIT guard" })
        .option("batch", { alias: "B", type: "boolean", default: false, describe: "Batch mode" }),
    (argv) => handler(argv as SqlArgs),
  )
}
