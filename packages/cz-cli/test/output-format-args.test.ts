import { describe, expect, test } from "bun:test"
import { parseOutputArgs } from "../src/output/index"

describe("parseOutputArgs", () => {
  test("reads --format for pre-yargs error paths", () => {
    expect(parseOutputArgs(["sql", "SELECT 1", "--format", "pretty"])).toEqual({ format: "pretty", field: undefined })
    expect(parseOutputArgs(["sql", "SELECT 1", "--format=toon", "--field", "data"])).toEqual({ format: "toon", field: "data" })
  })
})
