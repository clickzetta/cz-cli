import { beforeEach, expect, test } from "bun:test"
import { join } from "node:path"
import { onFetch, requireTestHome, sqlSuccess, stubStudioContext } from "./support/cz-fixtures.js"
import { findTopLevelLimit } from "../src/sql/limit-probe.js"

const { execute } = await import("../src/execute.ts")
const queries: string[] = []
beforeEach(async () => {
  queries.length = 0
  stubStudioContext()
  await Bun.file(join(requireTestHome(), ".clickzetta", "profiles.toml")).write(
    'default_profile = "test"\n[profiles.test]\npat = "pat"\nworkspace = "ws0"\ninstance = "inst"\n',
  )
  onFetch({
    match: (url) => url.includes("/lh/submitJob"),
    respond: (_url, _method, body) => {
      queries.push((body as { jobDesc: { sqlJob: { query: string[] } } }).jobDesc.sqlJob.query[0])
      return sqlSuccess(["v"], [[1]])
    },
  })
})

const submitted = async (sql: string) => {
  const result = await execute("sql", [sql, "--sync"])
  expect(result.exitCode).toBe(0)
  return queries.at(-1)?.replace(/\n;$/, "")
}

test("subquery LIMIT is preserved and outer probe is appended", async () => {
  expect(await submitted("SELECT COUNT(*) FROM (SELECT id FROM t LIMIT 1) q")).toBe(
    "SELECT COUNT(*) FROM (SELECT id FROM t LIMIT 1) q LIMIT 101",
  )
})

test("CTE LIMIT is preserved and outer probe is appended", async () => {
  expect(await submitted("WITH a AS (SELECT id FROM t LIMIT 5) SELECT * FROM a")).toBe(
    "WITH a AS (SELECT id FROM t LIMIT 5) SELECT * FROM a LIMIT 101",
  )
})

test("string literal containing limit does not count as a limit", async () => {
  expect(await submitted("SELECT 'limit 3' AS s FROM t")).toBe("SELECT 'limit 3' AS s FROM t LIMIT 101")
})

test("top-level LIMIT is probed with N+1 and subquery limit untouched", async () => {
  expect(await submitted("SELECT * FROM (SELECT id FROM t LIMIT 7) q LIMIT 10")).toBe(
    "SELECT * FROM (SELECT id FROM t LIMIT 7) q LIMIT 11",
  )
  expect(await submitted("SELECT * FROM t ORDER BY id LIMIT 10")).toBe("SELECT * FROM t ORDER BY id LIMIT 11")
})

test("findTopLevelLimit ignores comments, nesting and quoted text", () => {
  expect(findTopLevelLimit("SELECT 1 -- LIMIT 3")).toBeUndefined()
  expect(findTopLevelLimit("SELECT 1 /* LIMIT 3 */")).toBeUndefined()
  expect(findTopLevelLimit("SELECT \"limit 3\", 'it''s limit 4' FROM t")).toBeUndefined()
  expect(findTopLevelLimit("(SELECT 1 LIMIT 2) UNION ALL (SELECT 2 LIMIT 3)")).toBeUndefined()
  expect(findTopLevelLimit("SELECT 1 FROM t LIMIT 5 OFFSET 2")?.value).toBe(5)
  expect(findTopLevelLimit("SELECT 1 UNION ALL SELECT 2 LIMIT 4")?.value).toBe(4)
})
