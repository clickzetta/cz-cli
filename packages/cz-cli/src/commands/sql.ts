import type { Argv } from "yargs"
import { readFileSync, openSync, readSync, closeSync } from "node:fs"
import { splitSql, stripLeadingComment, JobStatus, request, requestRaw, getCurrentUser, type ClientOptions, type JobID, type QueryResult } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, successRows, error, parseOutputArgs, renderOutput } from "../output/index.js"
import { maskRows } from "../output/masking.js"
import { logOperation } from "../logger.js"
import { getExecContext, execSql, execSqlWithRetry, isQueryResult, validateIdentifier, classifyExecError, type ExecContext } from "./exec.js"
import { formatBillingError } from "./billing-error.js"

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
  async: boolean
  timeout: number
  variable?: string[]
  set?: string[]
  "job-profile"?: string
  "header": boolean
  N?: boolean
  "limit": number
  batch: boolean
  "dry-run": boolean
}

interface TruncateResult {
  rows: unknown[][]
  truncated: { col: string; originalLength: number }[]
}

function truncateLargeFields(rows: unknown[][], columns: string[], maxLen: number, forTable: boolean): TruncateResult {
  const truncated: { col: string; originalLength: number }[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const val = row[i]
      const col = columns[i] ?? String(i)
      let str: string | undefined
      let originalLength: number | undefined
      if (typeof val === "string" && val.length > maxLen) {
        str = val
        originalLength = val.length
      } else if (val instanceof Buffer || val instanceof Uint8Array) {
        const s = Buffer.from(val).toString("utf-8")
        row[i] = s
        if (s.length > maxLen) {
          str = s
          originalLength = s.length
        }
      }
      if (str !== undefined && originalLength !== undefined) {
        if (forTable) {
          const suffix = `...(${originalLength} chars)`
          row[i] = str.slice(0, maxLen - suffix.length) + suffix
        } else {
          row[i] = str.slice(0, maxLen)
        }
        if (!seen.has(col)) {
          seen.add(col)
          truncated.push({ col, originalLength })
        }
      }
    }
  }
  return { rows, truncated }
}

function applyVariables(sql: string, vars: Record<string, string>): string {
  const missing: string[] = []
  const result = sql.replace(/\$\{([^}]+)\}/g, (match, key) => {
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

function extractSchema(raw: string): string {
  let schema = raw.split(".").pop() ?? raw
  if (schema.startsWith("`") && schema.endsWith("`")) schema = schema.slice(1, -1)
  return schema
}

type UseStatement = {
  kind: "schema" | "vcluster" | "workspace"
  normalized: string
  raw: string
  target: string
}

function trimStatementTarget(raw: string): string {
  return raw.replace(/;+$/, "").trim()
}

function parseUseStatement(sql: string): UseStatement | undefined {
  const normalized = sql.replace(/\s+/g, " ").trim()
  const lower = normalized.toLowerCase()
  if (!lower.startsWith("use ")) return undefined
  if (lower.startsWith("use vcluster ")) {
    const target = trimStatementTarget(normalized.slice("use vcluster ".length))
    return { kind: "vcluster", normalized, raw: target, target }
  }
  if (lower.startsWith("use workspace ")) {
    const target = trimStatementTarget(normalized.slice("use workspace ".length))
    return { kind: "workspace", normalized, raw: target, target }
  }
  const raw = trimStatementTarget(normalized.slice(lower.startsWith("use schema ") ? "use schema ".length : "use ".length))
  return { kind: "schema", normalized, raw, target: extractSchema(raw) }
}

function useTargetExists(rows: unknown[][], target: string): boolean {
  const normalizedTarget = target.trim().toLowerCase()
  return rows.some((row) => Object.values(row).some((value) => String(value ?? "").trim().toLowerCase() === normalizedTarget))
}

async function applyUseStatement(
  ctx: ExecContext,
  use: UseStatement,
  format: string,
  hints?: Record<string, string>,
  configStatements?: string[],
  timeoutMs?: number,
  profileName?: string,
): Promise<boolean> {
  if (use.kind === "workspace") {
    ctx.config.workspace = use.target
    return true
  }

  if (use.kind === "schema") {
    const result = await execSqlWithRetry(ctx, `DESC SCHEMA ${use.raw}`, { hints, configStatements, timeoutMs })
    if (!isQueryResult(result)) {
      error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format })
      return false
    }
    if (result.status === JobStatus.FAILED) {
      logOperation("sql", { sql: use.normalized, ok: false, errorCode: result.errorCode })
      error(result.errorCode ?? "SCHEMA_NOT_FOUND", await formatQueryError(result, ctx, profileName, `Schema '${use.target}' does not exist.`), { format })
      return false
    }
    ctx.config.schema = extractSchema(use.raw)
    return true
  }

  const result = await execSqlWithRetry(ctx, "SHOW VCLUSTERS", { hints, configStatements, timeoutMs })
  if (!isQueryResult(result)) {
    error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format })
    return false
  }
  if (result.status === JobStatus.FAILED) {
    logOperation("sql", { sql: use.normalized, ok: false, errorCode: result.errorCode })
    error(result.errorCode ?? "SQL_ERROR", await formatQueryError(result, ctx, profileName), { format })
    return false
  }
  if (!useTargetExists(result.rows, use.target)) {
    logOperation("sql", { sql: use.normalized, ok: false, errorCode: "VCLUSTER_NOT_FOUND" })
    error("VCLUSTER_NOT_FOUND", `Vcluster '${use.target}' does not exist.`, { format })
    return false
  }
  ctx.config.vcluster = use.target
  return true
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
        const nameIdx = r.columns.findIndex((c) => c.name?.toLowerCase() === "table_name")
        const tables = r.rows.map((row) => String(row[nameIdx !== -1 ? nameIdx : 1] ?? row[0] ?? ""))
        return { tables: tables.slice(0, 100) }
      }
    }
    if (COLUMN_NOT_FOUND_RE.test(errMsg)) {
      const m = TABLE_FROM_SQL_RE.exec(sql)
      if (m) {
        const table = validateIdentifier(m[1], "table name")
        const r = await execSql(ctx, `DESC TABLE ${table}`)
        if (isQueryResult(r) && r.status === JobStatus.SUCCEEDED && r.rows.length > 0) {
          const cols = r.rows.map((row) => row[0])
          return { table, columns: cols }
        }
      }
    }
  } catch {
    // schema hint is best-effort
  }
  return undefined
}


async function executeSingle(
  ctx: ExecContext,
  sql: string,
  argv: SqlArgs,
  hints: Record<string, string>,
  configStatements?: string[],
  onJobId?: (id: string) => void,
): Promise<void> {
  const format = argv.format

  // Intercept SET statements — these are client-side session directives, not executable SQL
  const setMatch = sql.match(/^\s*SET\s+(\S+)\s*=\s*(.+)/i)
  if (setMatch) {
    success({ set: `${setMatch[1]}=${setMatch[2].replace(/;$/, "").trim()}` }, { format, timeMs: 0 })
    return
  }

  // Intercept USE statements — client-side context switch
  const use = parseUseStatement(sql)
  if (use) {
    if (!await applyUseStatement(ctx, use, format, hints, configStatements, argv.timeout * 1000, argv.profile)) return
    success({ use: use.normalized }, { format, timeMs: 0 })
    return
  }

  const isWrite = WRITE_RE.test(sql)
  const isSelect = SELECT_RE.test(sql)
  const isShow = SHOW_RE.test(sql)
  const hasLimit = LIMIT_RE.test(sql)
  const fieldMax = !argv.truncate ? Infinity : DEFAULT_FIELD_MAX
  const rowLimit = argv.limit === 0 ? Infinity : argv.limit
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

  if (!argv.sync || argv.async) {
    const asyncHints = { ...hints }
    if (argv.timeout) asyncHints["sdk.job.timeout"] = String(argv.timeout)
    const r = await execSqlWithRetry(ctx, sql, { hints: asyncHints, asynchronous: true, configStatements, onJobId })
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

  // Sync mode: SELECT/SHOW without user LIMIT → inject LIMIT probe when supported
  if (isSelect && !hasLimit && rowLimit !== Infinity) {
    // SHOW supports LIMIT, but server-side partial row hints are only for SELECT-like queries.
    const probeHints = isShow ? hints : { ...hints, "cz.sql.result.row.partial.limit": String(rowLimit) }
    const probeLimit = rowLimit + 1
    const probeSql = sql.replace(/\s*;?\s*$/, ` LIMIT ${probeLimit}`)
    let r = await execSqlWithRetry(ctx, probeSql, { hints: probeHints, timeoutMs: argv.timeout * 1000, configStatements, onJobId })
    // Retry without LIMIT if injection caused syntax error
    if (isQueryResult(r) && r.status === JobStatus.FAILED && /syntax/i.test(r.errorMessage ?? "") && /LIMIT/i.test(r.errorMessage ?? "")) {
      r = await execSqlWithRetry(ctx, sql, { hints: probeHints, timeoutMs: argv.timeout * 1000, configStatements, onJobId })
      if (!isQueryResult(r)) { error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format }); return }
      if (r.status === JobStatus.FAILED) {
        await handleFailure(r, sql, ctx, format, t0, argv.profile)
        return
      }
      await emitResult(r, sql, argv, ctx, t0)
      return
    }
    if (!isQueryResult(r)) { error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format }); return }
    if (r.status === JobStatus.FAILED) {
      const hint = await fetchSchemaHint(ctx, sql, r.errorMessage ?? "")
      logOperation("sql", { sql, ok: false, errorCode: r.errorCode, timeMs: Date.now() - t0 })
      error(r.errorCode ?? "SQL_ERROR", await formatQueryError(r, ctx, argv.profile), { format, extra: hint ? { schema: hint } : undefined })
      return
    }
    if (r.rowCount > rowLimit) {
      if (isShow) {
        await emitResult(
          { ...r, rows: r.rows.slice(0, rowLimit) },
          sql,
          argv,
          ctx,
          t0,
          `SHOW results truncated to ${rowLimit} rows (more available). Use --no-limit to fetch all.`,
        )
        return
      }
      const schemaExtra = r.columns
      logOperation("sql", { sql, ok: false, errorCode: "LIMIT_REQUIRED", timeMs: Date.now() - t0 })
      error("LIMIT_REQUIRED", `Query returned more than ${rowLimit} rows. Add a LIMIT clause or pass --no-limit.`, {
        format,
        extra: { schema: schemaExtra },
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
      const r = await execSqlWithRetry(ctx, probeSql, { hints, timeoutMs: argv.timeout * 1000, configStatements, onJobId })
      if (!isQueryResult(r)) { error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format }); return }
      if (r.status === JobStatus.FAILED) {
        await handleFailure(r, sql, ctx, format, t0, argv.profile)
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
  const r = await execSqlWithRetry(ctx, sql, { hints, timeoutMs: argv.timeout * 1000, configStatements, onJobId })
  if (!isQueryResult(r)) { error("UNEXPECTED_RESULT", "Expected query result but got async marker.", { format }); return }
  if (r.status === JobStatus.FAILED) {
    await handleFailure(r, sql, ctx, format, t0, argv.profile)
    return
  }

  await emitResult(r, sql, argv, ctx, t0)
}

async function resolveAccountDisplayName(ctx: ExecContext) {
  try {
    return (await getCurrentUser(ctx.clientOpts.baseUrl, ctx.token.token)).accountDisplayName
  } catch {
    return undefined
  }
}

async function formatQueryError(r: QueryResult, ctx: ExecContext, profileName?: string, fallback = "Query failed") {
  return formatBillingError({
    code: r.errorCode,
    message: r.errorMessage ?? fallback,
    profileName,
    service: ctx.config.service,
    accountDisplayName: await resolveAccountDisplayName(ctx),
  })
}

async function formatClassifiedError(input: {
  code?: string
  message: string
  ctx?: ExecContext
  profileName?: string
}) {
  return formatBillingError({
    code: input.code,
    message: input.message,
    profileName: input.profileName,
    service: input.ctx?.config.service,
    accountDisplayName: input.ctx ? await resolveAccountDisplayName(input.ctx) : undefined,
  })
}

async function handleFailure(r: QueryResult, sql: string, ctx: ExecContext, format: string, t0: number, profileName?: string): Promise<void> {
  const hint = await fetchSchemaHint(ctx, sql, r.errorMessage ?? "")
  logOperation("sql", { sql, ok: false, errorCode: r.errorCode, timeMs: Date.now() - t0 })
  const aiMessage = hint
    ? `SQL failed. Available schema info attached in the 'schema' field — check table/column names and retry.`
    : undefined
  error(r.errorCode ?? "SQL_ERROR", await formatQueryError(r, ctx, profileName), {
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
  const format = argv.format
  const fieldMax = !argv.truncate ? Infinity : DEFAULT_FIELD_MAX
  const isWrite = WRITE_RE.test(sql)

  let extra: Record<string, unknown> | undefined

  if (argv["with-schema"]) {
    extra = { schema: r.columns }
  }

  if (isWrite) {
    logOperation("sql", { sql, ok: true, timeMs: Date.now() - t0 })
    const writeExtra = { ...extra, ...(r.jobId ? { job_id: r.jobId } : {}) }
    success({}, { format, timeMs: Date.now() - t0, aiMessage, extra: Object.keys(writeExtra).length > 0 ? writeExtra : undefined })
    return
  }

  const columns = r.columns.map((c) => c.name)
  let rows = r.rows
  if (fieldMax !== Infinity) {
    const forTable = format === "table"
    const tr = truncateLargeFields(rows, columns, fieldMax, forTable)
    rows = tr.rows
    if (tr.truncated.length > 0) {
      const detail = tr.truncated.map((t) => `'${t.col}' (${t.originalLength} chars)`).join(", ")
      const truncMsg = `Field(s) truncated to ${fieldMax} chars: ${detail}. To get full values, re-run with --no-truncate and redirect to a file, e.g.: cz-cli sql "<SQL>" --no-truncate > output.json`
      aiMessage = aiMessage ? `${aiMessage} | ${truncMsg}` : truncMsg
    }
  }
  rows = maskRows(columns, rows)
  logOperation("sql", { sql, ok: true, rows: rows.length, timeMs: Date.now() - t0 })
  successRows(columns, rows, { format, timeMs: Date.now() - t0, aiMessage, noHeader: !argv.header || argv.N, extra: extra ? { ...extra, ...(r.jobId ? { job_id: r.jobId } : {}) } : (r.jobId ? { job_id: r.jobId } : undefined) })
}

async function handler(argv: SqlArgs): Promise<void> {
  const format = argv.format

  if (argv["job-profile"]) {
    const ctx = await getExecContext(argv)
    const jobId: JobID = {
      id: argv["job-profile"],
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
    try {
      const resp = await requestRaw<Record<string, unknown>>(ctx.clientOpts, "/lh/getJob", body)
      logOperation("sql job-profile", { ok: true })
      success(resp, { format })
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
  let ctx: ExecContext | undefined

  const sigintHandler = () => {
    const payload: Record<string, unknown> = { error: { code: "ABORTED", message: "Execution interrupted by user." } }
    if (currentJobId) payload.job_id = currentJobId
    process.stdout.write(renderOutput(payload, format, parseOutputArgs(process.argv.slice(2)).field) + "\n")
    process.exit(130)
  }
  process.on("SIGINT", sigintHandler)

  try {
    const statements = splitSql(sql).map((s) => s.trim()).filter((s) => s && stripLeadingComment(s))
    if (statements.length === 0) {
      error("USAGE_ERROR", "No SQL statements found.", { format, exitCode: 2 }); return
    }
    if (argv["dry-run"]) {
      const dryRunCtx = await getExecContext(argv)
      ctx = dryRunCtx
      const results = await Promise.all(statements.map(async (stmt) => {
        try {
          const r = await execSql(dryRunCtx, `EXPLAIN ${stmt}`, { timeoutMs: argv.timeout * 1000 })
          if (isQueryResult(r)) {
            if (r.status === JobStatus.FAILED)
              return { sql: stmt, status: "error", job_id: r.jobId, error: await formatQueryError(r, dryRunCtx, argv.profile, "EXPLAIN failed") }
            return { sql: stmt, status: "ok", job_id: r.jobId }
          }
          return { sql: stmt, status: "ok", job_id: (r as { jobId?: string }).jobId }
        } catch (err) {
          const { code, message } = classifyExecError(err)
          return { sql: stmt, status: "error", error: await formatClassifiedError({ code, message, ctx: dryRunCtx, profileName: argv.profile }) }
        }
      }))
      success({ statements: results, count: statements.length }, { format })
      return
    }
    ctx = await getExecContext(argv)
    // Multi-statement: execute all, return all results in batch mode or last result otherwise
    if (statements.length > 1) {
      const accumulatedHints = { ...hints }
      const configStatements: string[] = []
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i]
        // Extract SET statements as hints for subsequent statements
        const setMatch = stmt.match(/^\s*SET\s+(\S+)\s*=\s*(.+)/i)
        if (setMatch) {
          accumulatedHints[setMatch[1]] = setMatch[2].replace(/;$/, "").trim()
          configStatements.push(stmt)
          continue
        }
        // Extract USE statements to update session context client-side
        const use = parseUseStatement(stmt)
        if (use) {
          if (!await applyUseStatement(ctx, use, format, accumulatedHints, configStatements, argv.timeout * 1000, argv.profile)) return
          configStatements.push(stmt)
          continue
        }
        if (argv.batch) {
          // Batch mode: emit per-statement result with index and sql.
          // Route through renderOutput so --format and --field are honored the
          // same way as the single-statement path (sql.ts ~522). Default json
          // stays compact (one line per statement = JSONL stream).
          const batchField = parseOutputArgs(process.argv.slice(2)).field
          const t0 = Date.now()
          try {
            const r = await execSqlWithRetry(ctx, stmt, { hints: accumulatedHints, timeoutMs: argv.timeout * 1000, configStatements })
            if (isQueryResult(r) && r.status === JobStatus.FAILED) {
              const line = { index: i, sql: stmt, error: { code: r.errorCode ?? "SQL_ERROR", message: await formatQueryError(r, ctx, argv.profile) }, time_ms: Date.now() - t0, ...(r.jobId ? { job_id: r.jobId } : {}) }
              process.stdout.write(renderOutput(line, format, batchField) + "\n")
              logOperation("sql", { sql: stmt, ok: false, errorCode: r.errorCode })
            } else if (isQueryResult(r)) {
              const columns = r.columns.map((c) => c.name)
              const rows = maskRows(columns, r.rows)
              const line = { index: i, sql: stmt, columns, rows, count: rows.length, time_ms: Date.now() - t0, ...(r.jobId ? { job_id: r.jobId } : {}) }
              process.stdout.write(renderOutput(line, format, batchField) + "\n")
              logOperation("sql", { sql: stmt, ok: true, rows: rows.length, timeMs: Date.now() - t0 })
            }
          } catch (err) {
            const { code, message } = classifyExecError(err)
            const line = { index: i, sql: stmt, error: { code, message: await formatClassifiedError({ code, message, ctx, profileName: argv.profile }) }, time_ms: Date.now() - t0 }
            process.stdout.write(renderOutput(line, format, batchField) + "\n")
            logOperation("sql", { sql: stmt, ok: false, errorCode: code })
          }
        } else if (i < statements.length - 1) {
          // Non-batch: silently execute intermediate statements
          const r = await execSqlWithRetry(ctx, stmt, { hints: accumulatedHints, timeoutMs: argv.timeout * 1000, configStatements })
          if (isQueryResult(r) && r.status === JobStatus.FAILED) {
            logOperation("sql", { sql: stmt, ok: false, errorCode: r.errorCode })
            error(r.errorCode ?? "SQL_ERROR", await formatQueryError(r, ctx, argv.profile), { format })
            return
          }
        } else {
          await executeSingle(ctx, stmt, argv, accumulatedHints, configStatements, (id) => { currentJobId = id })
        }
      }
    } else {
      await executeSingle(ctx, statements[0], argv, hints ?? {}, undefined, (id) => { currentJobId = id })
    }
  } catch (err) {
    const { code, message, aiMessage, jobId } = classifyExecError(err)
    logOperation("sql", { sql, ok: false, errorCode: code })
    error(code, await formatClassifiedError({ code, message, ctx, profileName: argv.profile }), { format, debug: argv.debug, ...(aiMessage && { aiMessage }), ...(jobId && { extra: { job_id: jobId } }) })
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
            const format = (argv as unknown as SqlArgs).format
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
              .option("sync", { type: "boolean", default: true, describe: "Wait for query result before returning (default). Use --no-sync or --async for large queries that may take a long time." })
              .option("async", { type: "boolean", default: false, describe: "Return job_id immediately without waiting for results. Use for large/long-running queries." })
              .option("timeout", { type: "number", default: 300, describe: "Job timeout in seconds (default: 300)" })
              .option("variable", { type: "string", array: true, nargs: 1, describe: "Variable substitution: --variable KEY=VALUE. Use ${KEY} in SQL." })
              .option("set", { type: "string", array: true, nargs: 1, describe: "Query hint: --set KEY=VALUE (e.g. --set cz.sql.timezone=UTC)" })
              .option("job-profile", { type: "string", describe: "Fetch execution profile for a completed job ID (separate from running SQL)" })
              .option("header", { type: "boolean", default: true, describe: "Include column names in output. Use --no-header or -N to suppress." })
              .option("N", { type: "boolean", hidden: true })
              .option("limit", { type: "number", default: 100, describe: "Max rows to return (0 for unlimited)" })
              .option("batch", { alias: "B", type: "boolean", default: false, describe: "Batch mode: execute multiple semicolon-separated statements sequentially" })
              .option("dry-run", { type: "boolean", default: false, describe: "Split SQL and EXPLAIN each statement without executing. Reports ok/error per statement." })
              .epilogue([
                "Examples:",
                "  cz-cli sql \"SELECT * FROM orders LIMIT 10\"",
                "  cz-cli sql \"INSERT INTO t VALUES(1)\" --write",
                "  cz-cli sql \"SELECT ${col} FROM t\" --variable col=id",
                "  cz-cli sql -f query.sql --no-limit",
                "  cz-cli sql \"SELECT * FROM huge_table\" --async",
                "",
                "SQL input priority: positional > -e/--execute > -f/--file > --stdin",
                "Default mode is sync (waits for results). Use --async for large/long-running queries.",
              ].join("\n")),
          (argv) => handler(argv as unknown as SqlArgs),
        ),
  )
}
