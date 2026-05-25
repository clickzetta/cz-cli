import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import { JobStatus } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getExecContext, execSql, isQueryResult, validateIdentifier, classifyExecError, rowsToRecords } from "./exec.js"
import { getShowTableName } from "./table.js"

const DEFAULT_LIMIT = 100

export function registerSchemaCommand(cli: Argv<GlobalArgs>): void {
  cli.command("schema", "Manage schemas", (yargs) => {
    yargs
      .command(
        "list",
        "List schemas",
        (y) =>
          y
            .option("like", { type: "string", describe: "Filter pattern" })
            .option("limit", { type: "number", default: DEFAULT_LIMIT, describe: "Max rows" }),
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            let sql = "SHOW SCHEMAS"
            if (argv.like) sql += ` LIKE '${argv.like.replace(/'/g, "''")}'`
            const limit = argv.limit ?? DEFAULT_LIMIT
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected result"
              logOperation("schema list", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format }); return
            }
            let aiMessage: string | undefined
            let rows = r.rows
            if (rows.length > limit) {
              rows = rows.slice(0, limit)
              aiMessage = `Results limited to ${limit} of ${r.rows.length} schemas. Use --limit to adjust or --like to filter.`
            }
            const normalized = rows.map((row) => ({
              name: row[0] ?? "",
              type: row[1] ?? "",
            }))
            logOperation("schema list", { sql, ok: true, rows: normalized.length, timeMs: Date.now() - t0 })
            success(normalized, { format, timeMs: Date.now() - t0, aiMessage })
          } catch (err) {
            const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
            error(_ec, _em, { format , ...(_ea && { aiMessage: _ea }) }); return
          }
        },
      )
      .command(
        "describe <name>",
        "Describe a schema",
        (y) => y.positional("name", { type: "string", demandOption: true, describe: "Schema name" }),
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const name = validateIdentifier(argv.name as string, "schema name")
            const t0 = Date.now()
            const infoSql = `SHOW SCHEMAS EXTENDED WHERE schema_name='${name.replace(/'/g, "''")}'`
            const tablesSql = `SHOW TABLES IN ${name}`
            const [infoR, tablesR] = await Promise.all([execSql(ctx, infoSql), execSql(ctx, tablesSql)])
            const infoRows = isQueryResult(infoR) && infoR.status === JobStatus.SUCCEEDED ? infoR.rows : []
            if (infoRows.length === 0) {
              logOperation("schema describe", { sql: infoSql, ok: false, timeMs: Date.now() - t0 })
              error("SCHEMA_NOT_FOUND", `Schema '${name}' not found`, { format }); return
            }
            const schemaType = infoRows.length > 0 ? (infoRows[0][1] ?? "") : ""
            const tableResult = isQueryResult(tablesR) && tablesR.status === JobStatus.SUCCEEDED ? tablesR : undefined
            const tableRows = tableResult?.rows ?? []
            const tableRecords = tableResult ? rowsToRecords(tableResult) : []
            const tables = tableRows.map((row, index) => getShowTableName(row, tableRecords[index] ?? {}))
            logOperation("schema describe", { sql: infoSql, ok: true, timeMs: Date.now() - t0 })
            success({ name, type: schemaType, table_count: tables.length, tables }, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
            error(_ec, _em, { format , ...(_ea && { aiMessage: _ea }) }); return
          }
        },
      )
      .command(
        "create <name>",
        "Create a schema",
        (y) => y.positional("name", { type: "string", demandOption: true, describe: "Schema name" }),
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const name = validateIdentifier(argv.name as string, "schema name")
            const sql = `CREATE SCHEMA ${name}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected async result"
              logOperation("schema create", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format }); return
            }
            logOperation("schema create", { sql, ok: true, timeMs: Date.now() - t0 })
            success({ message: `Schema '${argv.name}' created successfully` }, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
            error(_ec, _em, { format , ...(_ea && { aiMessage: _ea }) }); return
          }
        },
      )
      .command(
        "drop <name>",
        "Drop a schema",
        (y) => y.positional("name", { type: "string", demandOption: true, describe: "Schema name" }),
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const name = validateIdentifier(argv.name as string, "schema name")
            const sql = `DROP SCHEMA ${name}`
            const t0 = Date.now()
            const r = await execSql(ctx, sql)
            if (!isQueryResult(r) || r.status === JobStatus.FAILED) {
              const msg = isQueryResult(r) ? (r.errorMessage ?? "Query failed") : "Unexpected async result"
              logOperation("schema drop", { sql, ok: false, timeMs: Date.now() - t0 })
              error(isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR", msg, { format }); return
            }
            logOperation("schema drop", { sql, ok: true, timeMs: Date.now() - t0 })
            success({ message: `Schema '${argv.name}' dropped successfully` }, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            const { code: _ec, message: _em, aiMessage: _ea } = classifyExecError(err)
            error(_ec, _em, { format , ...(_ea && { aiMessage: _ea }) }); return
          }
        },
      )
    return commandGroup(yargs, "schema")
  })
}
