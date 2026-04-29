import type { Argv } from "yargs"
import { JobStatus } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, successRows, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getExecContext, execSql, isQueryResult, validateIdentifier, type ExecContext } from "./exec.js"

const DEFAULT_LIMIT = 100

async function execAndReturn(
  ctx: ExecContext,
  sql: string,
  format: string,
  command: string,
): Promise<never> {
  const t0 = Date.now()
  const r = await execSql(ctx, sql)
  if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
    const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected async result"
    logOperation(command, { sql, ok: false, errorCode: isQueryResult(r) ? r.errorCode : undefined, timeMs: Date.now() - t0 })
    error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format })
  }
  const columns = r.columns.map((c) => c.name)
  logOperation(command, { sql, ok: true, rows: r.rows.length, timeMs: Date.now() - t0 })
  successRows(columns, r.rows, { format, timeMs: Date.now() - t0 })
}

export function registerSchemaCommand(cli: Argv<GlobalArgs>): void {
  cli.command("schema", "Manage schemas", (yargs) =>
    yargs
      .command(
        "list",
        "List schemas",
        (y) =>
          y
            .option("like", { type: "string", describe: "Filter pattern" })
            .option("limit", { type: "number", default: DEFAULT_LIMIT, describe: "Max rows" }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            let sql = "SHOW SCHEMAS"
            if (argv.like) sql += ` LIKE '${argv.like.replace(/'/g, "''")}'`
            const limit = argv.limit ?? DEFAULT_LIMIT
            sql += ` LIMIT ${limit + 1}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("schema list", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format })
            }
            let aiMessage: string | undefined
            let rows = r.rows
            if (rows.length > limit) {
              rows = rows.slice(0, limit)
              aiMessage = `Results truncated to ${limit} rows (more available). Use --limit to increase.`
            }
            const columns = r.columns.map((c) => c.name)
            logOperation("schema list", { sql, ok: true, rows: rows.length, timeMs: Date.now() - t0 })
            successRows(columns, rows, { format, timeMs: Date.now() - t0, aiMessage })
          } catch (err) {
            error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "describe <name>",
        "Describe a schema",
        (y) => y.positional("name", { type: "string", demandOption: true, describe: "Schema name" }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const name = validateIdentifier(argv.name as string, "schema name")
            const t0 = Date.now()
            const infoSql = `SHOW SCHEMAS EXTENDED WHERE schema_name='${name.replace(/'/g, "''")}'`
            const infoR = await execSql(ctx, infoSql)
            const tablesSql = `SHOW TABLES IN ${name}`
            const tablesR = await execSql(ctx, tablesSql)
            const info = isQueryResult(infoR) && infoR.status === JobStatus.SUCCEEDED ? infoR.rows : []
            const tables = isQueryResult(tablesR) && tablesR.status === JobStatus.SUCCEEDED ? tablesR.rows : []
            logOperation("schema describe", { sql: infoSql, ok: true, timeMs: Date.now() - t0 })
            success({ schema: name, info, tables }, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "create <name>",
        "Create a schema",
        (y) => y.positional("name", { type: "string", demandOption: true, describe: "Schema name" }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const sql = `CREATE SCHEMA ${validateIdentifier(argv.name as string, "schema name")}`
            await execAndReturn(ctx, sql, format, "schema create")
          } catch (err) {
            error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "drop <name>",
        "Drop a schema",
        (y) => y.positional("name", { type: "string", demandOption: true, describe: "Schema name" }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const sql = `DROP SCHEMA ${validateIdentifier(argv.name as string, "schema name")}`
            await execAndReturn(ctx, sql, format, "schema drop")
          } catch (err) {
            error("EXEC_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .demandCommand(1, ""),
  )
}
