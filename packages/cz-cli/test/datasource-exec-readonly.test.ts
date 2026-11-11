import { describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onFetch } from "./support/cz-fixtures.js"
import { isReadOnlySql } from "../src/commands/datasource.ts"

const { execute } = await import("../src/execute.ts")

describe("isReadOnlySql", () => {
  test("accepts one read-only statement", () => {
    for (const sql of [
      "select 1",
      "  SELECT * FROM t;",
      "show tables",
      "desc t",
      "DESCRIBE t",
      "explain select 1",
      "-- note\nselect 1",
      "/* note */ select 1",
      "SELECT ';'",
      "select 'a;b' as x, \"c;d\" from t;",
      "explain select * from analyze_log",
    ]) {
      expect(isReadOnlySql(sql)).toBe(true)
    }
  })

  test("rejects writes, DDL and multiple statements", () => {
    for (const sql of [
      "insert into t values (1)",
      "update t set a = 1",
      "delete from t",
      "create table t (a int)",
      "drop table t",
      "select 1; drop table t",
      "selectx from t",
      "",
      "EXPLAIN ANALYZE DELETE FROM t",
      "explain analyse update t set a = 1",
      "explain (analyze, buffers) delete from t",
      "select ';'; drop table t",
    ]) {
      expect(isReadOnlySql(sql)).toBe(false)
    }
  })
})

describe("datasource exec", () => {
  test("rejects EXPLAIN ANALYZE before sending any request", async () => {
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
      "[profiles.test]\npat = 'pat'\nworkspace = 'quick_start'\ninstance = 'tmwmzxzs'\n",
    )
    const calls: string[] = []
    onFetch({ match: () => true, respond: (url) => { calls.push(url); return { code: 0, data: {} } } })
    const result = await execute(`datasource exec pg_src --sql "EXPLAIN ANALYZE DELETE FROM t"`)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("INVALID_ARGUMENTS")
    expect(calls).toEqual([])
  })
})
