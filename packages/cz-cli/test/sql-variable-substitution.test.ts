import { beforeEach, expect, test } from "bun:test"
import { onFetch, stubStudioContext, sqlSuccess, sqlFailure } from "./support/cz-fixtures.js"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Network-boundary test: real sql command + variable substitution run; only /lh/submitJob is
// stubbed, echoing whether the SUBSTITUTED SQL reached the backend as expected.
// The submitted SQL is captured so the substitution result is what's asserted.

const { execute } = await import("../src/execute.ts")

function firstLineJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0]!)
}

let submittedSql = ""

beforeEach(() => {
  submittedSql = ""
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'ws0'\ninstance = 'inst'\n",
  )
  stubStudioContext()
  onFetch({
    match: (url) => url.includes("/lh/submitJob"),
    respond: (_url, _m, body) => {
      submittedSql = ((body as { jobDesc?: { sqlJob?: { query?: string[] } } })?.jobDesc?.sqlJob?.query?.[0] ?? "").trim()
      // The command should have substituted ${x} → 99 before submit.
      if (submittedSql.includes("SELECT 99 as v")) return sqlSuccess(["v"], [[99]])
      return sqlFailure("EXEC_ERROR", `unsubstituted SQL reached backend: ${submittedSql}`)
    },
  })
})

test("sql substitutes ${var} from --variable", async () => {
  const result = await execute('sql "SELECT ${x} as v" --variable x=99 --sync')
  const json = firstLineJson(result.output)
  expect(result.exitCode).toBe(0)
  expect(json.error).toBeUndefined()
  expect(json.columns).toEqual(["v"])
  expect(json.rows?.[0]?.[0]).toBe(99)
})

for (const key of ["env.var", "env.var.more", "env.var.more.deep"]) {
  test(`sql substitutes dotted variable key ${key}`, async () => {
    const result = await execute(`sql "SELECT \${${key}} as v" --variable ${key}=99 --sync`)
    const json = firstLineJson(result.output)
    expect(result.exitCode).toBe(0)
    expect(json.error).toBeUndefined()
    expect(json.columns).toEqual(["v"])
    expect(json.rows?.[0]?.[0]).toBe(99)
  })
}

test("sql no longer substitutes legacy %(var)s syntax", async () => {
  const result = await execute('sql "SELECT %(x)s as v" --variable x=99 --sync')
  const json = firstLineJson(result.output)
  expect(result.exitCode).toBe(1)
  expect(json.error?.code).toBeDefined()
})
