import { describe, it, expect } from "bun:test"
import { SQLWriteDetector } from "../src/sql-write-detector.js"

const d = new SQLWriteDetector()

describe("SQLWriteDetector", () => {
  it("detects INSERT", () => {
    const r = d.analyzeQuery("INSERT INTO t VALUES (1)")
    expect(r.contains_write).toBe(true)
    expect(r.operation_type).toBe("INSERT")
  })

  it("detects CREATE OR REPLACE", () => {
    const r = d.analyzeQuery("CREATE OR REPLACE TABLE t AS SELECT 1")
    expect(r.write_operations.has("CREATE")).toBe(true)
    expect(r.write_operations.has("REPLACE")).toBe(true)
    expect(r.operation_type).toBe("CREATE")
  })

  it("does not flag SHOW CREATE TABLE as write", () => {
    const r = d.analyzeQuery("SHOW CREATE TABLE t")
    expect(r.contains_write).toBe(false)
    expect(r.operation_type).toBe("UNKNOWN")
  })

  it("ignores TRUNCATE as a function call", () => {
    const r = d.analyzeQuery("SELECT TRUNCATE(1.234, 2) FROM t")
    expect(r.contains_write).toBe(false)
  })

  it("flags TRUNCATE TABLE as DDL", () => {
    const r = d.analyzeQuery("TRUNCATE TABLE t")
    expect(r.operation_type).toBe("TRUNCATE")
  })

  it("detects writes inside a CTE", () => {
    const r = d.analyzeQuery(
      "WITH w AS (DELETE FROM t RETURNING *) SELECT * FROM w",
    )
    expect(r.has_cte_write).toBe(true)
    expect(r.contains_write).toBe(true)
  })

  it("ignores comments", () => {
    const r = d.analyzeQuery("-- INSERT INTO t\nSELECT 1")
    expect(r.contains_write).toBe(false)
  })

  it("ignores string literals containing keywords", () => {
    const r = d.analyzeQuery("SELECT 'DROP TABLE t' AS s")
    expect(r.contains_write).toBe(false)
  })

  it("handles multi-statement input", () => {
    const r = d.analyzeQuery("SELECT 1; UPDATE t SET x = 1")
    expect(r.contains_write).toBe(true)
    expect(r.write_operations.has("UPDATE")).toBe(true)
  })

  it("returns UNKNOWN for read-only SELECT", () => {
    const r = d.analyzeQuery("SELECT 1")
    expect(r.operation_type).toBe("UNKNOWN")
  })
})
