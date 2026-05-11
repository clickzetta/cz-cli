import type { Argv } from "yargs"
import { readFileSync, openSync, readSync, closeSync } from "node:fs"
import { splitSql, JobStatus, request, requestRaw, type ClientOptions, type JobID, type QueryResult } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, successRows, error } from "../output/index.js"
import { maskRows } from "../output/masking.js"
import { logOperation } from "../logger.js"
import { getExecContext, execSql, execSqlWithRetry, isQueryResult, validateIdentifier, classifyExecError, type ExecContext } from "./exec.js"

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
  "truncate": boolean
  file?: string
  execute?: string
  stdin: boolean
  sync: boolean
  timeout: number
  variable?: string[]
  set?: string[]
  "job-profile"?: string
  "header": boolean
  N?: boolean
  "limit": boolean
  batch: boolean
}

function truncateLargeFields(rows: Record<string, unknown>[], maxLen: number): Record<string, unknown>[] {
  for (const row of rows) {
    for (const [key, val] of Object.entries(row)) {
      if (typeof val === "string" && val.length > maxLen) {
        const suffix = `...(truncated, ${val.length} chars)`
        row[key] = val.slice(0, maxLen - suffix.length) + suffix
      } else if (val instanceof Buffer || val instanceof Uint8Array) {
        const s = Buffer.from(val).toString("utf-8")
        if (s.length > maxLen) {
          const suffix = `...(truncated, ${s.length} chars)`
          row[key] = s.slice(0, maxLen - suffix.length) + suffix
        } else {
          row[key] = s
        }
      }
    }
  }
  return rows
}

function applyVariables(sql: string, vars: Record<string, string>): string {
  const missing: string[] = []
  const result = sql.replace(/%\((\w+)\)s/g, (match, key) => {
    if (key in vars) return vars[key]
    missing.push(key)
    return match
  })
  if (missing.length > 0) {
    error("MISSING_VARIABLE", `Undefined variable(s): ${missing.join(", ")}. Provide them via --variable KEY=VALUE.`, { exitCode: 2 }); return ""
  }
  return result
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
  if (argv.file) return readFileSync(argv.file, "utf-8")
  if (argv.execute) return argv.execute
  if (argv.statement) return argv.statement
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
  error("MISSING_SQL", "No SQL provided. Use positional arg, -e, -f, or pipe via stdin.", {
    exitCode: 2,
    aiMessage: 'Provide SQL as a positional argument: cz-cli sql "SELECT ..."',
  })
  return "" // unreachable after error
}

async function fetchSchemaHint(ctx: ExecContext, sql: string, errMsg: string): Promise<Record<string, unknown> | undefined> {
  try {
    if (TABLE_NOT_FOUND_RE.test(errMsg)) {
      const r = await execSql(ctx, "SHOW TABLES")
      if (isQueryResult(r) && r.status === JobStatus.SUCCEEDED && r.rows.length > 0) {
        const tables = r.rows.map((row) => Object.values(row)[0])
        return { tables }
      }
    }
    if (COLUMN_NOT_FOUND_RE.test(errMsg)) {
      const m = TABLE_FROM_SQL_RE.exec(sql)
      if (m) {
        const table = validateIdentifier(m[1], "table name")
        const r = await execSql(ctx, `DESC TABLE ${table}`)
        if (isQueryResult(r) && r.status === JobStatus.SUCCEEDED && r.rows.length > 0) {
          const cols = r.rows.map((row) => Object.values(row)[0])
          return { table, columns: cols }
        }
      }
    }
  } catch {
    // schema hint is best-effort
  }
  return undefined
}

async function fetchWithSchema(ctx: ExecContext, sql: string): Promise<Record<string, unknown> | undefined> {
  const tables = extractTableNames(sql)
  if (tables.length === 0) return undefined
  const table = tables[0]
  try {
    validateIdentifier(table, "table name")
    const r = await execSql(ctx, `DESC TABLE ${table}`)
    if (isQueryResult(r) && r.status === JobStatus.SUCCEEDED && r.rows.length > 0) {
      const cols = r.rows.map((row) => {
        const vals = Object.values(row)
        return { name: vals[0] ?? "", type: vals[1] ?? "", comment: vals[2] ?? "" }
      })
      return { table, columns: cols }
    }
  } catch {
    // skip tables we can't describe
  }
  return undefined
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
  const fieldMax = !argv.truncate ? Infinity : DEFAULT_FIELD_MAX
  const rowLimit = !argv.limit ? Infinity : DEFAULT_ROW_LIMIT
  const t0 = Date.now()

  if (isWrite && !argv.write) {
    error("WRITE_NOT_ALLOWED", "Write operation detected. Pass --write to confirm.", {
      format,
      aiMessage: "Add --write flag to execute write operations: cz-cli sql \"<SQL>\" --write",
    }); return
  }
  if (isWrite && DANGEROUS_WRITE_RE.test(sql) && !WHERE_RE.test(sql)) {
    error("DANGEROUS_WRITE", "DELETE/UPDATE without WHERE clause. Add a WHERE clause or use a more specific statement.", {
      format,
      aiMessage: "Always include a WHERE clause in DELETE/UPDATE to avoid unintended data loss.",
    }); return
  }

  if (!argv.sync) {
    const asyncHints = { ...hints }
    if (argv.timeout) asyncHints["sdk.job.timeout"] = String(argv.timeout)
    const r = await execSqlWithRetry(ctx, sql, { hints: asyncHints, asynchronous: true })
    logOperation("sql", { sql, ok: true, timeMs: Date.now() - t0 })
    if (isQueryResult(r)) {
      await emitResult(r, sql, argv, ctx, t0)
    } else {
      const jobId = (r as { jobId?: string }).jobId ?? ""
      success({ job_id: jobId, status: "RUNNING" }, {
        format,
        aiMessage: `Job submitted. Check status: cz-cli job status ${jobId} | Fetch results: cz-cli job result ${jobId}`,
      }); return
    }
    return
  }

  // Sync mode: SELECT without user LIMIT → inject LIMIT to guard
  if (isSelect && !hasLimit && !isShow && rowLimit !== Infinity) {
    // Set server-side row limit as safety guard
    const serverHints = { ...hints, "cz.sql.result.row.partial.limit": String(rowLimit) }
    const probeLimit = rowLimit + 1
    const probeSql = sql.replace(/\s*;?\s*$/, ` LIMIT ${probeLimit}`)
    let r = await execSqlWithRetry(ctx, probeSql, { hints: serverHints, timeoutMs: argv.timeout * 1000 })
    // Retry without LIMIT if injection caused syntax error
    if (isQueryResult(r) && r.status === JobStatus.FAILED && /syntax/i.test(r.errorMessage ?? "") && /LIMIT/i.test(r.errorMessage ?? "")) {
      r = await execSqlWithRetry(ctx, sql, { hints: serverHints, timeoutMs: argv.timeout * 1000 })
      if (!isQueryResult(r)) { error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format }); return }
      if (r.status === JobStatus.FAILED) {
        await handleFailure(r, sql, ctx, format, t0)
        return
      }
      await emitResult(r, sql, argv, ctx, t0)
      return
    }
    if (!isQueryResult(r)) { error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format }); return }
    if (r.status === JobStatus.FAILED) {
      const hint = await fetchSchemaHint(ctx, sql, r.errorMessage ?? "")
      logOperation("sql", { sql, ok: false, errorCode: r.errorCode, timeMs: Date.now() - t0 })
      error(r.errorCode ?? "SQL_ERROR", r.errorMessage ?? "Query failed", { format, extra: hint ? { schema: hint } : undefined })
      return
    }
    if (r.rowCount > rowLimit) {
      const tables = extractTableNames(sql)
      let schemaExtra: Record<string, unknown> | undefined
      if (tables.length > 0) {
        try {
          validateIdentifier(tables[0], "table name")
          const descR = await execSql(ctx, `DESC TABLE ${tables[0]}`)
          if (isQueryResult(descR) && descR.status === JobStatus.SUCCEEDED && descR.rows.length > 0) {
            const cols = descR.rows.map((row) => ({ name: Object.values(row)[0], type: Object.values(row)[1] ?? "" }))
            schemaExtra = { table: tables[0], columns: cols }
          }
        } catch { /* best-effort */ }
      }
      logOperation("sql", { sql, ok: false, errorCode: "LIMIT_REQUIRED", timeMs: Date.now() - t0 })
      error("LIMIT_REQUIRED", `Query returned more than ${rowLimit} rows. Add a LIMIT clause or pass --no-limit.`, {
        format,
        extra: schemaExtra ? { schema: schemaExtra } : undefined,
        aiMessage: `Too many rows. Add LIMIT to your query, e.g.: cz-cli sql "SELECT ... LIMIT 10" --sync, or use --no-limit to fetch all.`,
      }); return
    }
    await emitResult(r, sql, argv, ctx, t0)
    return
  }

  // Sync mode: SELECT with user LIMIT N → probe with N+1 to detect truncation
  if (isSelect && hasLimit && !isShow && !!argv.limit) {
    const limitMatch = sql.match(/\bLIMIT\s+(\d+)/i)
    if (limitMatch) {
      const userLimit = parseInt(limitMatch[1], 10)
      const probeSql = sql.replace(/\bLIMIT\s+\d+/i, `LIMIT ${userLimit + 1}`)
      const r = await execSqlWithRetry(ctx, probeSql, { hints, timeoutMs: argv.timeout * 1000 })
      if (!isQueryResult(r)) { error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format }); return }
      if (r.status === JobStatus.FAILED) {
        await handleFailure(r, sql, ctx, format, t0)
        return
      }
      let aiMessage: string | undefined
      let rows = r.rows
      if (rows.length > userLimit) {
        rows = rows.slice(0, userLimit)
        aiMessage = `Results truncated to ${userLimit} rows (more available).`
      }
      await emitResult({ ...r, rows }, sql, argv, ctx, t0, aiMessage)
      return
    }
  }

  // General case: SHOW, write, or other
  const r = await execSqlWithRetry(ctx, sql, { hints, timeoutMs: argv.timeout * 1000 })
  if (!isQueryResult(r)) { error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format }); return }
  if (r.status === JobStatus.FAILED) {
    await handleFailure(r, sql, ctx, format, t0)
    return
  }

  if (isShow && !!argv.limit && r.rowCount > rowLimit) {
    logOperation("sql", { sql, ok: false, errorCode: "LIMIT_REQUIRED", timeMs: Date.now() - t0 })
    error("LIMIT_REQUIRED", `SHOW returned more than ${rowLimit} rows. Pass --no-limit to see all.`, {
      format,
      aiMessage: `Add --no-limit to retrieve all rows: cz-cli sql "${sql.trim()}" --no-limit`,
    }); return
  }

  await emitResult(r, sql, argv, ctx, t0)
}

async function handleFailure(r: QueryResult, sql: string, ctx: ExecContext, format: string, t0: number): Promise<void> {
  const hint = await fetchSchemaHint(ctx, sql, r.errorMessage ?? "")
  logOperation("sql", { sql, ok: false, errorCode: r.errorCode, timeMs: Date.now() - t0 })
  const aiMessage = hint
    ? `SQL failed. Available schema info attached in the 'schema' field — check table/column names and retry.`
    : undefined
  error(r.errorCode ?? "SQL_ERROR", r.errorMessage ?? "Query failed", {
    format,
    extra: hint ? { schema: hint } : undefined,
    ...(aiMessage && { aiMessage }),
  })
}

async function emitResult(
  r: QueryResult,
  sql: string,
  argv: SqlArgs,
  ctx: ExecContext,
  t0: number,
  aiMessage?: string,
): Promise<void> {
  const format = argv.output
  const fieldMax = !argv.truncate ? Infinity : DEFAULT_FIELD_MAX
  const isWrite = WRITE_RE.test(sql)

  let extra: Record<string, unknown> | undefined

  if (argv["with-schema"]) {
    const schema = await fetchWithSchema(ctx, sql)
    if (schema) extra = { schema }
  }

  if (isWrite) {
    logOperation("sql", { sql, ok: true, affected: r.affectedRows, timeMs: Date.now() - t0 })
    const writeExtra = { ...extra, ...(r.jobId ? { job_id: r.jobId } : {}) }
    success({ affected: r.affectedRows }, { format, timeMs: Date.now() - t0, aiMessage, extra: Object.keys(writeExtra).length > 0 ? writeExtra : undefined })
  }

  const columns = r.columns.map((c) => c.name)
  let rows = r.rows
  if (fieldMax !== Infinity) rows = truncateLargeFields(rows, fieldMax)
  rows = maskRows(columns, rows)
  logOperation("sql", { sql, ok: true, rows: rows.length, timeMs: Date.now() - t0 })
  successRows(columns, rows, { format, timeMs: Date.now() - t0, aiMessage, noHeader: !argv.header || argv.N, extra: extra ? { ...extra, ...(r.jobId ? { job_id: r.jobId } : {}) } : (r.jobId ? { job_id: r.jobId } : undefined) })
}

async function handler(argv: SqlArgs): Promise<void> {
  let format = argv.output

  if (argv.batch) {
    format = "text"
  }

  if (argv["job-profile"]) {
    const ctx = await getExecContext(argv)
    const jobId: JobID = {
      id: argv["job-profile"],
      workspace: ctx.config.workspace,
      instanceId: ctx.token.instanceId,
    }
    const body = {
      get_summary_request: {
        account: { user_id: 0 },
        job_id: { id: jobId.id, workspace: jobId.workspace, instance_id: jobId.instanceId },
        offset: 0,
        user_agent: "",
      },
      user_agent: "",
    }
    try {
      const resp = await request<Record<string, unknown>>(ctx.clientOpts, "/lh/getJob", body)
      logOperation("sql job-profile", { ok: true })
      success(resp.data, { format })
    } catch (err) {
      logOperation("sql job-profile", { ok: false, errorCode: "JOB_PROFILE_ERROR" })
      error("JOB_PROFILE_ERROR", err instanceof Error ? err.message : String(err), { format })
    }
    return
  }

  let sql = resolveSql(argv)
  if (argv.variable && argv.variable.length > 0) {
    sql = applyVariables(sql, parseKvPairs(argv.variable))
  }
  const hints = argv.set ? parseKvPairs(argv.set) : undefined
  let currentJobId: string | undefined

  const sigintHandler = () => {
    const payload: Record<string, unknown> = { error: { code: "ABORTED", message: "Execution interrupted by user." } }
    if (currentJobId) payload.job_id = currentJobId
    process.stdout.write(JSON.stringify(payload) + "\n")
    process.exit(130)
  }
  process.on("SIGINT", sigintHandler)

  try {
    const ctx = await getExecContext(argv)
    const statements = splitSql(sql).map((s) => s.trim()).filter(Boolean)
    if (statements.length === 0) {
      error("USAGE_ERROR", "No SQL statements found.", { format, exitCode: 2 }); return
    }
    // Multi-statement: execute all, return all results in batch mode or last result otherwise
    if (statements.length > 1) {
      const accumulatedHints = { ...hints }
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i]
        // Extract SET statements as hints for subsequent statements
        const setMatch = stmt.match(/^\s*SET\s+(\S+)\s*=\s*(.+)/i)
        if (setMatch) {
          accumulatedHints[setMatch[1]] = setMatch[2].replace(/;$/, "").trim()
          continue
        }
        if (argv.batch) {
          // Batch mode: output every statement's result
          await executeSingle(ctx, stmt, argv, accumulatedHints)
        } else if (i < statements.length - 1) {
          // Non-batch: silently execute intermediate statements
          const r = await execSqlWithRetry(ctx, stmt, { hints: accumulatedHints, timeoutMs: argv.timeout * 1000 })
          if (isQueryResult(r) && r.status === JobStatus.FAILED) {
            logOperation("sql", { sql: stmt, ok: false, errorCode: r.errorCode })
            error(r.errorCode ?? "SQL_ERROR", r.errorMessage ?? "Query failed", { format })
            return
          }
        } else {
          await executeSingle(ctx, stmt, argv, accumulatedHints)
        }
      }
    } else {
      await executeSingle(ctx, statements[0], argv, hints ?? {})
    }
  } catch (err) {
    const { code, message, aiMessage } = classifyExecError(err)
    logOperation("sql", { sql, ok: false, errorCode: code })
    error(code, message, { format, debug: argv.debug, ...(aiMessage && { aiMessage }) })
  } finally {
    process.removeListener("SIGINT", sigintHandler)
  }
}

export function registerSqlCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "sql",
    "Execute SQL against ClickZetta",
    (yargs) =>
      yargs
        .command(
          "status <job-id>",
          "Check async job status",
          (y) => y.positional("job-id", { type: "string", demandOption: true }),
          async (argv) => {
            const format = (argv as unknown as SqlArgs).output
            try {
              const ctx = await getExecContext(argv as unknown as SqlArgs)
              const jobId: JobID = {
                id: argv["job-id"] as string,
                workspace: ctx.config.workspace,
                instanceId: ctx.token.instanceId,
              }
              const body = {
                get_result_request: {
                  account: { user_id: 0 },
                  job_id: { id: jobId.id, workspace: jobId.workspace, instance_id: jobId.instanceId },
                  offset: 0,
                  user_agent: "",
                },
                user_agent: "",
              }
              const resp = await requestRaw<Record<string, unknown>>(ctx.clientOpts, "/lh/getJob", body)
              const status = resp.status as Record<string, unknown> | undefined
              logOperation("sql status", { ok: true })
              success({
                job_id: argv["job-id"],
                state: status?.state ?? "UNKNOWN",
                error_code: status?.errorCode || undefined,
                error_message: status?.errorMessage || undefined,
              }, { format })
            } catch (err) {
              error("JOB_STATUS_ERROR", err instanceof Error ? err.message : String(err), { format })
            }
          },
        )
        .command(
          "$0 [statement]",
          "Execute SQL statement",
          (y) =>
            y
              .positional("statement", { type: "string", describe: "SQL statement to execute" })
              .option("write", { type: "boolean", default: false, describe: "Allow write operations (INSERT/UPDATE/DELETE/CREATE/DROP). Required as a safety guard." })
              .option("with-schema", { type: "boolean", default: false, describe: "Attach table schema (columns) to the response for context" })
              .option("truncate", { type: "boolean", default: true, describe: "Truncate field values longer than 3000 chars. Use --no-truncate to disable." })
              .option("file", { alias: "f", type: "string", describe: "Read SQL from a file path" })
              .option("execute", { alias: "e", type: "string", describe: "SQL string (alternative to positional argument)" })
              .option("stdin", { type: "boolean", default: false, describe: "Read SQL from stdin" })
              .option("sync", { type: "boolean", default: false, describe: "Wait for query result before returning. Without --sync, returns a job_id immediately (async). Use --sync for SELECT queries when you need the data." })
              .option("timeout", { type: "number", default: 300, describe: "Job timeout in seconds (default: 300)" })
              .option("variable", { type: "array", string: true, describe: "Variable substitution: --variable KEY=VALUE. Use %(KEY)s in SQL." })
              .option("set", { type: "array", string: true, describe: "Query hint: --set KEY=VALUE (e.g. --set cz.sql.timezone=UTC)" })
              .option("job-profile", { type: "string", describe: "Fetch execution profile for a completed job ID (separate from running SQL)" })
              .option("header", { type: "boolean", default: true, describe: "Include column names in output. Use --no-header or -N to suppress." })
              .option("N", { type: "boolean", hidden: true })
              .option("limit", { type: "boolean", default: true, describe: "Auto-truncate results to 100 rows. Use --no-limit to fetch all rows." })
              .option("batch", { alias: "B", type: "boolean", default: false, describe: "Batch mode: execute multiple semicolon-separated statements sequentially" })
              .epilogue([
                "Examples:",
                "  cz-cli sql \"SELECT * FROM orders LIMIT 10\" --sync",
                "  cz-cli sql \"INSERT INTO t VALUES(1)\" --write --sync",
                "  cz-cli sql \"SELECT %(col)s FROM t\" --variable col=id --sync",
                "  cz-cli sql -f query.sql --sync --no-limit",
                "",
                "SQL input priority: positional > -e/--execute > -f/--file > --stdin",
                "Default mode is async (returns job_id). Use --sync to wait for results.",
              ].join("\n")),
          (argv) => handler(argv as unknown as SqlArgs),
        ),
  )
}
