import { describe, expect, test } from "bun:test"
import { getShowTableName } from "../src/commands/table.ts"

describe("getShowTableName", () => {
  test("prefers table_name over the first SHOW TABLES column", () => {
    expect(getShowTableName(["public", "orders"], { schema_name: "public", table_name: "orders" })).toBe("orders")
  })

  test("falls back to a generic name column", () => {
    expect(getShowTableName(["events"], { name: "events" })).toBe("events")
  })

  test("falls back to row positions when column names are unavailable", () => {
    expect(getShowTableName(["public", "payments"], {})).toBe("payments")
    expect(getShowTableName(["single_column_name"], {})).toBe("single_column_name")
  })
})
