import { beforeEach, expect, test } from "bun:test"
import { join } from "node:path"
import { onFetch, requireTestHome, sqlFailure, sqlSuccess, stubStudioContext } from "./support/cz-fixtures.js"

const { execute } = await import("../src/execute.ts")

beforeEach(async () => {
  stubStudioContext()
  await Bun.write(join(requireTestHome(), ".clickzetta", "profiles.toml"), [
    'default_profile = "test"',
    "[profiles.test]",
    'pat = "pat"',
    'service = "uat-api.clickzetta.com"',
    'instance = "inst"',
    'workspace = "ws0"',
  ].join("\n"))
})

// Exercise the real command and SDK with only the HTTP boundary substituted.
for (const input of ["execute", "file"] as const) {
  for (const failure of ["none", "job", "http"] as const) {
    test(`batch ${input}: ${failure} failure preserves results and exit status`, async () => {
      const submitted: string[] = []
      onFetch({
        match: (url) => url.includes("/lh/submitJob"),
        respond: (_url, _method, body) => {
          const query = (body as { jobDesc: { sqlJob: { query: string[] } } }).jobDesc.sqlJob.query[0]
          submitted.push(query)
          if (query.includes("SELECT 2") && failure === "job") {
            return sqlFailure("CZLH-42000", "Statement failed")
          }
          if (query.includes("SELECT 2") && failure === "http") {
            return new Response("Submission rejected", { status: 400 })
          }
          return sqlSuccess(["value"], [[1]])
        },
      })

      const sql = "SELECT 1; SELECT 2; SELECT 3;"
      const file = join(requireTestHome(), "batch.sql")
      if (input === "file") await Bun.write(file, sql)
      const result = await execute("sql --batch --sync", input === "file" ? ["-f", file] : ["-e", sql])
      const rows = result.output.trim().split("\n").map((line) => JSON.parse(line))

      expect(submitted).toHaveLength(3)
      expect(rows.map((row) => row.index)).toEqual([0, 1, 2])
      expect(rows[0].rows).toEqual([[1]])
      expect(rows[2].rows).toEqual([[1]])
      expect(result.exitCode).toBe(failure === "none" ? 0 : 1)
      if (failure === "none") {
        expect(rows.every((row) => !row.error)).toBe(true)
        return
      }
      expect(rows[1].error.code).toBe(failure === "job" ? "CZLH-42000" : "HTTP_400")
    })
  }
}
