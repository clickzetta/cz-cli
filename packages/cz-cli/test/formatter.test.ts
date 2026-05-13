import { describe, expect, test } from "bun:test"
import { formatJson, formatJsonl, formatPretty } from "../src/output/formatter.js"

describe("JSON formatters preserve non-finite numbers", () => {
  test("formatJson renders NaN as a string token", () => {
    expect(formatJson({ value: Number.NaN })).toBe('{"value":"NaN"}')
  })

  test("formatPretty renders Infinity values as strings", () => {
    expect(formatPretty({ pos: Number.POSITIVE_INFINITY, neg: Number.NEGATIVE_INFINITY })).toBe(
      '{\n  "pos": "Infinity",\n  "neg": "-Infinity"\n}',
    )
  })

  test("formatJsonl preserves NaN rows", () => {
    expect(formatJsonl([{ value: Number.NaN }])).toBe('{"value":"NaN"}')
  })
})
