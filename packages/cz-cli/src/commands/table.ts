import type { Argv } from "yargs"
import { readFileSync } from "node:fs"
import { JobStatus } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, successRows, error } from "../output/index.js"
import { maskRows } from "../output/masking.js"
import { logOperation } from "../logger.js"
import { getExecContext, execSql, isQueryResult, validateIdentifier } from "./exec.js"

const DEFAULT_LIMIT = 100
const DEFAULT_PREVIEW_LIMIT = 10

function parseDescribeResult(result: import("@clickzetta/sdk").QueryResult) {
  const columns: Record<string, unknown>[] = []
  const metadata: Record<string, unknown> = {}
  let inMetadata = false

  for (const row of result.rows) {
    const colName = row["col_name"] ?? row["COL_NAME"] ?? row[Object.keys(row)[0]]
    if (!inMetadata) {
      if (
        colName === "# Detailed Table Information" ||
        colName === "" ||
        colName === null ||
        colName === undefined
      ) {
        inMetadata = true
        continue
      }
      columns.push(row)
    } else {
      if (colName && String(colName).trim()) {
        const vals = Object.values(row)
        metadata[String(colName).trim()] = vals[1] ?? vals[0]
      }
    }
  }
  return { columns, metadata }
}

export function registerTableCommand(cli: Argv<GlobalArgs>): void {
  cli.command("table", "Manage tables", (yargs) =>
    yargs
      .command(
        "list",
        "List tables",
        (y) =>
          y
            .option("in", { type: "string", describe: "Schema name" })
            .option("like", { type: "string", describe: "Filter pattern" })
            .option("limit", { type: "number", default: DEFAULT_LIMIT, describe: "Max rows" }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const limit = argv.limit ?? DEFAULT_LIMIT
            let sql = "SHOW TABLES"
            if (argv.in) sql += ` IN ${validateIdentifier(argv.in, "schema name")}`
            if (argv.like) sql += ` LIKE '${argv.like.replace(/'/g, "''")}'`
            sql += ` LIMIT ${limit + 1}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table list", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format })
            }
            let aiMessage: string | undefined
            let rows = r.rows
            if (rows.length > limit) {
              rows = rows.slice(0, limit)
              aiMessage = `Results truncated to ${limit} rows (more available). Use --limit to increase.`
            }
            const columns = r.columns.map((c) => c.name)
            logOperation("table list", { sql, ok: true, rows: rows.length, timeMs: Date.now() - t0 })
            successRows(columns, rows, { format, timeMs: Date.now() - t0, aiMessage })
          } catch (err) {
            error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format: argv.output })
          }
        },
      )
      .command(
        "describe <name>",
        "Describe a table",
        (y) => y.positional("name", { type: "string", demandOption: true, describe: "Table name" }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const sql = `DESC TABLE ${validateIdentifier(argv.name as string, "table name")}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table describe", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format })
            }
            const { columns, metadata } = parseDescribeResult(r)
            logOperation("table describe", { sql, ok: true, rows: columns.length, timeMs: Date.now() - t0 })
            success({ table: argv.name, columns, metadata }, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "preview <name>",
        "Preview table data",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true, describe: "Table name" })
            .option("limit", { type: "number", default: DEFAULT_PREVIEW_LIMIT, describe: "Number of rows" }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const limit = argv.limit ?? DEFAULT_PREVIEW_LIMIT
            const sql = `SELECT * FROM ${validateIdentifier(argv.name as string, "table name")} LIMIT ${limit}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table preview", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format })
            }
            const columns = r.columns.map((c) => c.name)
            const rows = maskRows(columns, r.rows)
            logOperation("table preview", { sql, ok: true, rows: rows.length, timeMs: Date.now() - t0 })
            successRows(columns, rows, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "stats <name>",
        "Get table row count",
        (y) => y.positional("name", { type: "string", demandOption: true, describe: "Table name" }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const sql = `SELECT COUNT(*) as row_count FROM ${validateIdentifier(argv.name as string, "table name")}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table stats", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format })
            }
            const rowCount = r.rows[0]?.row_count ?? r.rows[0]?.[Object.keys(r.rows[0])[0]] ?? 0
            logOperation("table stats", { sql, ok: true, timeMs: Date.now() - t0 })
            success({ table: argv.name, row_count: rowCount }, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "history",
        "Show table history",
        (y) =>
          y
            .option("in", { type: "string", describe: "Schema name" })
            .option("like", { type: "string", describe: "Filter pattern" })
            .option("limit", { type: "number", default: DEFAULT_LIMIT, describe: "Max rows" }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const limit = argv.limit ?? DEFAULT_LIMIT
            let sql = "SHOW TABLES HISTORY"
            if (argv.in) sql += ` IN ${validateIdentifier(argv.in, "schema name")}`
            if (argv.like) sql += ` LIKE '${argv.like.replace(/'/g, "''")}'`
            sql += ` LIMIT ${limit + 1}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table history", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format })
            }
            let aiMessage: string | undefined
            let rows = r.rows
            if (rows.length > limit) {
              rows = rows.slice(0, limit)
              aiMessage = `Results truncated to ${limit} rows.`
            }
            const columns = r.columns.map((c) => c.name)
            logOperation("table history", { sql, ok: true, rows: rows.length, timeMs: Date.now() - t0 })
            successRows(columns, rows, { format, timeMs: Date.now() - t0, aiMessage })
          } catch (err) {
            error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format: argv.output })
          }
        },
      )
      .command(
        "create <ddl>",
        "Create a table from DDL",
        (y) =>
          y
            .positional("ddl", { type: "string", demandOption: true, describe: "DDL statement or table name" })
            .option("from-file", { type: "string", describe: "Read DDL from file" }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const sql = argv["from-file"] ? readFileSync(argv["from-file"], "utf-8") : (argv.ddl as string)
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table create", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format })
            }
            logOperation("table create", { sql, ok: true, timeMs: Date.now() - t0 })
            success({ created: true, job_id: r.jobId }, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "drop <name>",
        "Drop a table",
        (y) => y.positional("name", { type: "string", demandOption: true, describe: "Table name" }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const sql = `DROP TABLE ${validateIdentifier(argv.name as string, "table name")}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table drop", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format })
            }
            logOperation("table drop", { sql, ok: true, timeMs: Date.now() - t0 })
            success({ dropped: true, table: argv.name, job_id: r.jobId }, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .demandCommand(1, ""),
  )
}
