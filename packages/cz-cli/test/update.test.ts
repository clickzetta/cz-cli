import { describe, expect, test } from "bun:test"
import { shouldApplyUpdate } from "../src/commands/update"

describe("shouldApplyUpdate", () => {
  test("refuses to downgrade when the fetched version is older", () => {
    expect(shouldApplyUpdate("0.3.92", "0.3.88", false)).toBe(false)
  })

  test("accepts a newer version", () => {
    expect(shouldApplyUpdate("0.3.88", "0.3.92", false)).toBe(true)
  })

  test("allows downgrade when forced", () => {
    expect(shouldApplyUpdate("0.3.92", "0.3.88", true)).toBe(true)
  })
})
