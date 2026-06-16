import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import { readFileSync } from "node:fs"
import { JobStatus, request } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, successRows, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getExecContext, execSql, isQueryResult, validateIdentifier, classifyExecError, rowsToRecords } from "./exec.js"

const DEFAULT_LIMIT = 100
const DEFAULT_PREVIEW_LIMIT = 10

function parseDescribeResult(result: import("@clickzetta/sdk").QueryResult) {
  const columns: Record<string, unknown>[] = []
  const metadata: Record<string, unknown> = {}
  let inMetadata = false

  const records = rowsToRecords(result)
  for (const row of records) {
    const colName = row["col_name"] ?? row["COL_NAME"] ?? Object.values(row)[0]
    if (!inMetadata) {
      if (
        String(colName ?? "").toLowerCase() === "# detailed table information" ||
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

function readRecordValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key] ?? record[key.toLowerCase()] ?? record[key.toUpperCase()]
    if (value !== undefined && value !== null && value !== "") return value
  }
}

export function getShowTableName(row: unknown[], record: Record<string, unknown>) {
  return readRecordValue(record, "table_name", "name") ?? row[1] ?? row[0] ?? ""
}

export function registerTableCommand(cli: Argv<GlobalArgs>): void {
  cli.command("table", "Manage tables", (yargs) => {
    yargs
      .command(
        "list",
        "List tables",
        (y) =>
          y
            .option("in", { type: "string", describe: "Filter by schema name (e.g. --in public)" })
            .option("schema", { type: "string", describe: "Filter by schema name (alias of --in)", hidden: true })
            .option("filter-schema", { type: "string", describe: "Filter by schema name (alias of --in)", hidden: true })
            .option("like", { type: "string", describe: "Filter pattern" })
            .option("limit", { type: "number", default: DEFAULT_LIMIT, describe: "Max rows" }),
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const limit = argv.limit ?? DEFAULT_LIMIT
            let sql = "SHOW TABLES"
            const schemaFilter = argv.in ?? argv["schema"] ?? argv["filter-schema"]
            if (schemaFilter) sql += ` IN ${validateIdentifier(schemaFilter, "schema name")}`
            if (argv.like) sql += ` LIKE '${argv.like.replace(/'/g, "''")}'`
            sql += ` LIMIT ${limit + 1}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table list", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format }); return
            }
            let aiMessage: string | undefined
            let rows = r.rows
            if (rows.length > limit) {
              rows = rows.slice(0, limit)
              aiMessage = `Results truncated to ${limit} rows (more available). Use --limit to increase.`
            }
            const records = rowsToRecords({ ...r, rows })
            const normalized = rows.map((row, index) => ({ name: getShowTableName(row, records[index] ?? {}) }))
            logOperation("table list", { sql, ok: true, rows: normalized.length, timeMs: Date.now() - t0 })
            success(normalized, { format, timeMs: Date.now() - t0, aiMessage })
          } catch (err) {
            const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
            error(_ec, _em, { format: argv.format , ...(_ea && { aiMessage: _ea }) })
          }
        },
      )
      .command(
        "describe <name>",
        "Describe a table",
        (y) => y.positional("name", { type: "string", demandOption: true, describe: "Table name" }),
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const sql = `DESC TABLE ${validateIdentifier(argv.name as string, "table name")}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table describe", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format }); return
            }
            const { columns: rawCols, metadata } = parseDescribeResult(r)
            const columns = rawCols.map((row) => ({
              name: row["col_name"] ?? row["column_name"] ?? row[Object.keys(row)[0]] ?? "",
              type: row["data_type"] ?? row[Object.keys(row)[1]] ?? "",
              comment: row["comment"] ?? "",
            }))
            logOperation("table describe", { sql, ok: true, rows: columns.length, timeMs: Date.now() - t0 })
            const result: Record<string, unknown> = { table: argv.name, columns }
            if (Object.keys(metadata).length > 0) result.metadata = metadata
            success(result, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
            error(_ec, _em, { format , ...(_ea && { aiMessage: _ea }) })
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
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const limit = argv.limit ?? DEFAULT_PREVIEW_LIMIT
            const sql = `SELECT * FROM ${validateIdentifier(argv.name as string, "table name")} LIMIT ${limit}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table preview", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format }); return
            }
            if (!r.columns || r.columns.length === 0) {
              logOperation("table preview", { sql, ok: true, rows: 0, timeMs: Date.now() - t0 })
              success({ message: "No data" }, { format, timeMs: Date.now() - t0 })
              return
            }
            const columns = r.columns.map((c) => c.name)
            logOperation("table preview", { sql, ok: true, rows: r.rows.length, timeMs: Date.now() - t0 })
            successRows(columns, r.rows, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
            error(_ec, _em, { format , ...(_ea && { aiMessage: _ea }) })
          }
        },
      )
      .command(
        "stats <name>",
        "Get table row count and job summary",
        (y) => y.positional("name", { type: "string", demandOption: true, describe: "Table name" }),
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const sql = `SELECT COUNT(*) as row_count FROM ${validateIdentifier(argv.name as string, "table name")}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table stats", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format }); return
            }
            const rowCount = r.rows[0]?.[0] ?? 0

            // Fetch job summary via /lh/getJob (matches Python's conn.get_job_summary)
            let jobSummary: Record<string, unknown> | undefined
            if (r.jobId) {
              try {
                const body = {
                  get_summary_request: {
                    account: { user_id: 0 },
                    job_id: { id: r.jobId, workspace: ctx.config.workspace, instance_id: ctx.token.instanceId },
                    offset: 0,
                    user_agent: "",
                  },
                  user_agent: "",
                }
                const resp = await request<Record<string, unknown>>(ctx.clientOpts, "/lh/getJob", body)
                jobSummary = resp.data as Record<string, unknown>
              } catch {
                // job summary is best-effort; don't fail the command
              }
            }

            logOperation("table stats", { sql, ok: true, timeMs: Date.now() - t0 })
            const result: Record<string, unknown> = { table: argv.name, row_count: rowCount }
            if (jobSummary) result.job_summary = jobSummary
            success(result, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
            error(_ec, _em, { format , ...(_ea && { aiMessage: _ea }) })
          }
        },
      )
      .command(
        "history [name]",
        "Show table history",
        (y) =>
          y
            .positional("name", { type: "string", describe: "Table name (optional, filters to single table)" })
            .option("in", { type: "string", describe: "Filter by schema name (e.g. --in public)" })
            .option("schema", { type: "string", describe: "Filter by schema name (alias of --in)", hidden: true })
            .option("filter-schema", { type: "string", describe: "Filter by schema name (alias of --in)", hidden: true })
            .option("like", { type: "string", describe: "Filter pattern" })
            .option("limit", { type: "number", default: DEFAULT_LIMIT, describe: "Max rows" }),
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const limit = argv.limit ?? DEFAULT_LIMIT
            let sql = "SHOW TABLES HISTORY"
            const schemaFilter = argv.in ?? argv["schema"] ?? argv["filter-schema"]
            if (schemaFilter) sql += ` IN ${validateIdentifier(schemaFilter, "schema name")}`
            if (argv.name) sql += ` LIKE '${String(argv.name).replace(/'/g, "''")}'`
            else if (argv.like) sql += ` LIKE '${argv.like.replace(/'/g, "''")}'`
            sql += ` LIMIT ${limit + 1}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table history", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format }); return
            }
            const records = rowsToRecords(r)
            let aiMessage: string | undefined
            let recordSlice = records
            if (records.length > limit) {
              recordSlice = records.slice(0, limit)
              aiMessage = `Results limited to ${limit} records (more available). Use --limit to adjust or --like/--in to filter.`
            }
            const normalized = recordSlice.map((row) => ({
              schema: row["schema_name"] ?? "",
              table: row["table_name"] ?? "",
              create_time: row["create_time"] ?? "",
              creator: row["creator"] ?? "",
              rows: row["rows"] ?? 0,
              bytes: row["bytes"] ?? 0,
              delete_time: row["delete_time"] ?? "",
            }))
            logOperation("table history", { sql, ok: true, rows: normalized.length, timeMs: Date.now() - t0 })
            success(normalized, { format, timeMs: Date.now() - t0, aiMessage })
          } catch (err) {
            const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
            error(_ec, _em, { format: argv.format , ...(_ea && { aiMessage: _ea }) })
          }
        },
      )
      .command(
        "create [ddl]",
        "Create a table from DDL statement",
        (y) =>
          y
            .positional("ddl", { type: "string", describe: "CREATE TABLE DDL statement (positional takes priority over --from-file)" })
            .option("from-file", { type: "string", describe: "Read DDL from a file path (used when positional DDL is not provided)" })
            .option("write", { type: "boolean", hidden: true }),
        async (argv) => {
          const format = argv.format
          try {
            if (!argv.ddl && !argv["from-file"]) {
              error("MISSING_DDL", "Provide DDL as positional argument or use --from-file.", { format, exitCode: 2 })
              return
            }
            const ctx = await getExecContext(argv)
            const sql = argv["from-file"] ? readFileSync(argv["from-file"], "utf-8").trim() : (argv.ddl as string)
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table create", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format }); return
            }
            logOperation("table create", { sql, ok: true, timeMs: Date.now() - t0 })
            success({ message: "Table created successfully" }, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
            error(_ec, _em, { format , ...(_ea && { aiMessage: _ea }) })
          }
        },
      )
      .command(
        "drop <name>",
        "Drop a table",
        (y) => y.positional("name", { type: "string", demandOption: true, describe: "Table name" }),
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const sql = `DROP TABLE ${validateIdentifier(argv.name as string, "table name")}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("table drop", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format }); return
            }
            logOperation("table drop", { sql, ok: true, timeMs: Date.now() - t0 })
            success({ message: `Table '${argv.name}' dropped successfully` }, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
            error(_ec, _em, { format , ...(_ea && { aiMessage: _ea }) })
          }
        },
      )
    return commandGroup(yargs, "table")
  })
}
