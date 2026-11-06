import { describe, expect, test } from "bun:test"
import { isReadOnlySql } from "../src/commands/datasource.ts"

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
    ]) {
      expect(isReadOnlySql(sql)).toBe(false)
    }
  })
})
