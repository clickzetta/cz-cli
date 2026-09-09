import { beforeEach, expect, test } from "bun:test"
import { join } from "node:path"
import { z } from "zod/v4"
import { onFetch, requireTestHome, sqlSuccess, stubStudioContext } from "./support/cz-fixtures.js"

const { execute } = await import("../src/execute.ts")
const submitted: string[] = []
let rows = [[1]]
let columns = ["v"]
const submittedHints: Record<string, string>[] = []

beforeEach(async () => {
  submitted.length = 0
  submittedHints.length = 0
  rows = [[1]]
  columns = ["v"]
  await Bun.file(join(requireTestHome(), ".clickzetta", "profiles.toml")).write(
    "[profiles.test]\npat = 'pat'\nworkspace = 'ws0'\ninstance = 'inst'\n",
  )
  await Bun.file(join(requireTestHome(), ".clickzetta", "czcli.json")).write('{"sql_split":true}')
  stubStudioContext()
  onFetch({
    match: (url) => url.includes("/lh/submitJob"),
    respond: (_url, _method, body) => {
      submitted.push(
        z.object({ jobDesc: z.object({ sqlJob: z.object({ query: z.array(z.string()).min(1) }) }) }).parse(body).jobDesc
          .sqlJob.query[0],
      )
      submittedHints.push(z.object({ jobDesc: z.object({ sqlJob: z.object({ sqlConfig: z.object({ hint: z.record(z.string(), z.string()) }) }) }) }).parse(body).jobDesc.sqlJob.sqlConfig.hint)
      return sqlSuccess(columns, rows)
    },
  })
})

for (const flags of [[], ["--batch"], ["--async"]]) {
  for (const sql of [
    "/* note */ DELETE FROM t WHERE id=1",
    "SELECT 1; DROP TABLE t",
    "INSERT INTO t VALUES (1); SELECT 1",
    "USE SCHEMA public; SELECT 1; UNDROP TABLE t",
    "MERGE INTO t USING s ON t.id=s.id WHEN MATCHED THEN DELETE",
  ]) {
    test(`rejects entire input before submission: ${sql} ${flags.join(" ")}`, async () => {
      const result = await execute("sql", [sql, ...flags])
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.output).error.code).toBe("WRITE_NOT_ALLOWED")
      expect(submitted).toEqual([])
    })
  }
}

for (const sql of [
  "CALL proc()",
  "SELECT 1; BEGIN SELECT 2; END",
  "SELECT 'unfinished",
  "SELECT 1; /* unfinished",
  "SET cz.sql.string.literal.escape.mode=quote; SELECT 1",
]) {
  test(`unknown input fails closed: ${sql}`, async () => {
    const result = await execute("sql", [sql])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.output).error.code).toBe("SQL_READONLY_UNKNOWN")
    expect(submitted).toEqual([])
  })
}

test("checks substituted SQL before executing any statements", async () => {
  const result = await execute("sql", ["SELECT ${value}", "--variable", "value=1; DROP TABLE t"])
  expect(JSON.parse(result.output).error.code).toBe("WRITE_NOT_ALLOWED")
  expect(submitted).toEqual([])
})

test("checks SQL read from files", async () => {
  const file = join(requireTestHome(), "input.sql")
  await Bun.file(file).write("SELECT 1; DROP TABLE t")
  const result = await execute("sql", ["--file", file])
  expect(JSON.parse(result.output).error.code).toBe("WRITE_NOT_ALLOWED")
  expect(submitted).toEqual([])
})

for (const sql of ["SELECT 1; DROP TABLE t", "BEGIN SELECT 1; END"]) {
  test(`disabling splitting cannot bypass the check: ${sql}`, async () => {
    await Bun.file(join(requireTestHome(), ".clickzetta", "czcli.json")).write('{"sql_split":false}')
    const result = await execute("sql", [sql])
    expect(result.exitCode).toBe(1)
    expect(submitted).toEqual([])
  })
}

for (const flags of [[], ["--batch"], ["--async"]]) {
  test(`explicit writes use the same preflight: ${flags.join(" ")}`, async () => {
    const result = await execute("sql", ["INSERT INTO t VALUES(1); DELETE FROM t WHERE id=1", "--write", ...flags])
    expect(result.exitCode).toBe(0)
    expect(submitted).toHaveLength(2)
  })
}

test("unknown compound SQL requires explicit write authorization and stays verbatim", async () => {
  await Bun.file(join(requireTestHome(), ".clickzetta", "czcli.json")).write('{"sql_split":false}')
  const result = await execute("sql", ["BEGIN SELECT 1; END", "--write"])
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual(["BEGIN SELECT 1; END\n;"])
})

for (const sql of [
  "SELECT 1; DELETE FROM t",
  "UPDATE t SET a='WHERE id=1'",
  "/* note */ DELETE FROM t -- WHERE id=1",
]) {
  test(`WHERE in strings/comments cannot bypass the existing guard: ${sql}`, async () => {
    const result = await execute("sql", [sql, "--write", "--batch"])
    expect(JSON.parse(result.output).error.code).toBe("DANGEROUS_WRITE")
    expect(submitted).toEqual([])
  })
}

test("reviewed session directives continue to work with leading comments", async () => {
  const result = await execute("sql", ["/* a /* b */ c */ SET cz.sql.timezone=UTC; SELECT 1", "--limit", "0"])
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual(["SELECT 1\n;"])
})

test("unreviewed query settings require explicit authorization", async () => {
  const result = await execute("sql", ["SELECT 1", "--set", "cz.sql.translation.mode=mysql"])
  expect(JSON.parse(result.output).error.code).toBe("SQL_READONLY_UNKNOWN")
  expect(submitted).toEqual([])
})

test("recognized queries preserve literals and nested comments when submitted", async () => {
  const sql = "SELECT 'DELETE; DROP', `update` /* outer /* inner */ ; outer */ FROM t"
  const result = await execute("sql", [sql, "--limit", "0"])
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual([`${sql}\n;`])
})

test("limit probing never rewrites literal contents", async () => {
  const result = await execute("sql", ["SELECT 'LIMIT 5' FROM t LIMIT 10"])
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual(["SELECT 'LIMIT 5' FROM t LIMIT 11\n;"])
})

test("CTE writes do not receive a query LIMIT probe", async () => {
  const sql = "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x"
  const result = await execute("sql", [sql, "--write"])
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual([`${sql}\n;`])
})

for (const sql of ["SELECT 1; DROP TABLE t", "CALL proc()", "SET cz.sql.timezone=UTC; SELECT 1"]) {
  test(`dry-run rejects unsupported input even with --write: ${sql}`, async () => {
    const result = await execute("sql", [sql, "--dry-run", "--write"])
    expect(JSON.parse(result.output).error.code).toBe("SQL_NOT_READONLY")
    expect(submitted).toEqual([])
  })
}

test("dry-run explains each recognized query", async () => {
  const result = await execute("sql", ["SELECT 1; SELECT 2", "--dry-run"])
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual(["EXPLAIN SELECT 1\n;", "EXPLAIN SELECT 2\n;"])
})

test("dry-run cannot execute trailing queries with splitting disabled", async () => {
  await Bun.file(join(requireTestHome(), ".clickzetta", "czcli.json")).write('{"sql_split":false}')
  const result = await execute("sql", ["SELECT 1; SELECT 2", "--dry-run"])
  expect(JSON.parse(result.output).error.code).toBe("SQL_NOT_READONLY")
  expect(submitted).toEqual([])
})

test("session directives accept inline comments without changing quoted values", async () => {
  const result = await execute("sql", ["SET/**/query_tag = 'a/*literal*/\nb'; SELECT 1", "--limit", "0"])
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual(["SELECT 1\n;"])
})

test("leading comments remain in submitted multi-statement SQL", async () => {
  const result = await execute("sql", ["/* first */ SELECT 1; /* second */ SELECT 2", "--limit", "0"])
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual(["/* first */ SELECT 1\n;", "/* second */ SELECT 2\n;"])
})

test("a trailing line comment cannot swallow the LIMIT probe", async () => {
  const result = await execute("sql", ["SELECT 1 -- note"])
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual(["SELECT 1 -- note\nLIMIT 101\n;"])
})

test("unreviewed execution settings disable default-mode SQL rewriting", async () => {
  const result = await execute("sql", ["SELECT 1", "--set", "cz.sql.translation.mode=mysql", "--write"])
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual(["SELECT 1\n;"])
})

test("error location identifies the modification that determines the batch verdict", async () => {
  const result = await execute("sql", ["BOGUS 1; DROP TABLE t"])
  expect(JSON.parse(result.output)).toMatchObject({
    error: { code: "WRITE_NOT_ALLOWED" },
    statement_index: 1,
    reason: "Modification keyword: DROP",
  })
  expect(submitted).toEqual([])
})

test("write rejection provides a structured user-approval workflow", async () => {
  const result = await execute("sql", ["DROP TABLE t"])
  expect(result.exitCode).toBe(1)
  const payload = JSON.parse(result.output)
  expect(payload).toMatchObject({
    status: "action_required",
    query_kind: "write",
    error: { code: "WRITE_NOT_ALLOWED" },
    issues: [{ code: "WRITE_NOT_ALLOWED" }],
  })
  expect(payload.issues[0].remediation).toContain("Ask the user to approve")
  expect(payload.issues[0].remediation).toContain("Wait for explicit approval")
  expect(payload.issues[0].remediation).toContain("same command with --write")
  expect(payload.ai_message).toBe(payload.issues[0].remediation)
  expect(payload.next_steps).toHaveLength(3)
  expect(submitted).toEqual([])
})

for (const args of [["CALL proc()"], ["SELECT 1", "--set", "cz.sql.translation.mode=mysql"]]) {
  test(`unknown SQL/settings require approval without claiming destructiveness: ${args.join(" ")}`, async () => {
    const result = await execute("sql", args)
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.output)).toMatchObject({
      status: "action_required",
      query_kind: "unknown",
      error: { code: "SQL_READONLY_UNKNOWN" },
      issues: [{ code: "SQL_READONLY_UNKNOWN", remediation: expect.stringContaining("Ask the user to approve") }],
    })
    expect(submitted).toEqual([])
  })
}

for (const format of ["text", "table", "csv", "jsonl"]) {
  test(`approval instructions survive ${format} error rendering`, async () => {
    const result = await execute("sql", ["DROP TABLE t", "--format", format])
    expect(result.exitCode).toBe(1)
    expect(result.output).toStartWith("ERROR WRITE_NOT_ALLOWED:")
    expect(result.output).toContain("Ask the user to approve")
    expect(result.output).toContain("Wait for explicit approval")
    expect(submitted).toEqual([])
  })
}

test("non-overridable SQL errors do not offer approval as a bypass", async () => {
  const result = await execute("sql", ["DELETE FROM t", "--write"])
  expect(JSON.parse(result.output)).toMatchObject({ error: { code: "DANGEROUS_WRITE" } })
  expect(JSON.parse(result.output).status).toBeUndefined()
  expect(submitted).toEqual([])
})

for (const sql of ["SHOW CREATE TABLE t", "SHOW DYNAMIC TABLE REFRESH HISTORY LIMIT 10"]) {
  test(`documented introspection returns rows without approval: ${sql}`, async () => {
    const result = await execute("sql", [sql, "--limit", "0"])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.output)).toMatchObject({ columns: ["v"], rows: [[1]] })
  })
}

test("approved writes preserve returned result rows", async () => {
  const result = await execute("sql", ["INSERT INTO t VALUES (1)", "--write"])
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.output)).toMatchObject({ columns: ["v"], rows: [[1]] })
})

test("unreviewed settings preserve the result limit without rewriting SQL", async () => {
  rows = Array.from({ length: 101 }, (_, index) => [index])
  const result = await execute("sql", ["SELECT * FROM t", "--set", "cz.sql.translation.mode=mysql", "--write"])
  expect(JSON.parse(result.output).error.code).toBe("LIMIT_REQUIRED")
  expect(submitted).toEqual(["SELECT * FROM t\n;"])
  expect(submittedHints[0]["cz.sql.result.row.partial.limit"]).toBe("101")
})

for (const sql of ["SELECT 1; SELECT * FROM t", "SELECT 1; SHOW TABLES"]) {
  test(`verbatim readonly scripts keep the final result limit: ${sql}`, async () => {
    await Bun.file(join(requireTestHome(), ".clickzetta", "czcli.json")).write('{"sql_split":false}')
    rows = Array.from({ length: 101 }, (_, index) => [index])
    const result = await execute("sql", [sql])
    const payload = JSON.parse(result.output)
    if (sql.endsWith("SHOW TABLES")) {
      expect(result.exitCode).toBe(0)
      expect(payload.rows).toHaveLength(100)
    } else {
      expect(payload.error.code).toBe("LIMIT_REQUIRED")
    }
    expect(submitted).toEqual([`${sql}\n;`])
  })
}

test("empty readonly results retain the query output shape", async () => {
  columns = []
  rows = []
  const result = await execute("sql", ["SELECT 1", "--limit", "0"])
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.output)).toMatchObject({ columns: [], rows: [], count: 0 })
})

test("unknown settings preserve SHOW truncation", async () => {
  rows = Array.from({ length: 101 }, (_, index) => [index])
  const result = await execute("sql", ["SHOW TABLES", "--set", "cz.sql.translation.mode=mysql", "--write"])
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.output).rows).toHaveLength(100)
  expect(submitted).toEqual(["SHOW TABLES\n;"])
})

test("SET values containing equals preserve the reviewed hint key", async () => {
  const result = await execute("sql", ["SET query_tag='a=b'; SELECT 1", "--limit", "0"])
  expect(result.exitCode).toBe(0)
  expect(submittedHints[0].query_tag).toBe("'a=b'")
  expect(Object.keys(submittedHints[0])).not.toContain("query_tag='a")
})

test("approved unclassified SELECT keeps its result bound without rewriting", async () => {
  rows = Array.from({ length: 101 }, (_, index) => [index])
  const sql = "SELECT /*+ unknown_hint */ * FROM t"
  const result = await execute("sql", [sql, "--write"])
  expect(JSON.parse(result.output).error.code).toBe("LIMIT_REQUIRED")
  expect(submitted).toEqual([`${sql}\n;`])
  expect(submittedHints[0]["cz.sql.result.row.partial.limit"]).toBe("101")
})
