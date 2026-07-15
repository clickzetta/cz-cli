import { beforeEach, describe, expect, test } from "bun:test"
import { onFetch, stubStudioContext, sqlSuccess, sqlFailure } from "./support/cz-fixtures.js"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Network-boundary test: no mock.module of ../src/commands/exec. Real exec/session preprocessing
// runs (USE/SCHEMA/VCLUSTER validation), and only /lh/submitJob is stubbed,
// dispatching per submitted SQL. execCalls captures the SQL actually sent so the
// assertions on preprocessing order are preserved. HOME/profile isolated by preload.

const execCalls: string[] = []

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

beforeEach(() => {
  execCalls.length = 0
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'ws0'\ninstance = 'inst'\n",
  )
  stubStudioContext()
  // /lh/submitJob dispatches on the submitted SQL (sqlJob.query[0]).
  onFetch({
    match: (url) => url.includes("/lh/submitJob"),
    respond: (_url, _method, body) => {
      const sql = ((body as { jobDesc?: { sqlJob?: { query?: string[] } } })?.jobDesc?.sqlJob?.query?.[0] ?? "").trim().replace(/\n?;?\s*$/, "").trim()
      execCalls.push(sql)
      if (sql === "DESC SCHEMA missing_schema") return sqlFailure("CZLH-SCHEMA", "Schema 'missing_schema' does not exist.")
      if (sql === "DESC SCHEMA analytics") return sqlSuccess([], [])
      if (sql === "SHOW VCLUSTERS") return sqlSuccess(["vcluster_name"], [["default"], ["analytics"]])
      if (sql === "SELECT 1" || sql === "SELECT 1 LIMIT 101") return sqlSuccess(["v"], [[1]])
      return sqlFailure("EXEC_ERROR", `unexpected SQL: ${sql}`)
    },
  })
})

describe("sql USE validation", () => {
  test("USE SCHEMA fails when the schema does not exist", async () => {
    const result = await execute('sql "USE SCHEMA missing_schema" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json).toEqual({
      error: {
        code: "CZLH-SCHEMA",
        message: "Schema 'missing_schema' does not exist.",
      },
    })
    expect(execCalls).toEqual(["DESC SCHEMA missing_schema"])
  })

  test("USE VCLUSTER fails before later statements run when the vcluster does not exist", async () => {
    const result = await execute('sql "USE VCLUSTER missing_vc; SELECT 1" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json).toEqual({
      error: {
        code: "VCLUSTER_NOT_FOUND",
        message: "Vcluster 'missing_vc' does not exist.",
      },
    })
    expect(execCalls).toEqual(["SHOW VCLUSTERS"])
  })

  test("USE SCHEMA validates then allows later statements to run", async () => {
    const result = await execute('sql "USE SCHEMA analytics; SELECT 1" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect(json).toEqual({
      columns: ["v"],
      rows: [[1]],
      count: 1,
      time_ms: expect.any(Number),
      job_id: expect.any(String),
    })
    expect(execCalls).toEqual(["DESC SCHEMA analytics", "SELECT 1 LIMIT 101"])
  })
})
