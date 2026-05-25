import { describe, expect, test } from "bun:test"
import { formatCsv, formatJson, formatJsonl, formatPretty, formatTable, formatText } from "../src/output/formatter.js"

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
    expect(formatJsonl([[Number.NaN]])).toBe('["NaN"]')
  })
})

describe("flat output formatters preserve null vs empty string", () => {
  test("formatCsv distinguishes null from empty string", () => {
    expect(formatCsv(["a", "b"], [[null, ""]])).toBe('a,b\nNULL,""')
  })

  test("formatText distinguishes null from empty string", () => {
    expect(formatText(["a", "b"], [[null, ""]])).toBe('NULL\t""')
  })

  test("formatTable distinguishes null from empty string", () => {
    expect(formatTable(["a", "b"], [[null, ""]])).toContain('NULL | ""')
  })

  test("flat formats quote ambiguous strings", () => {
    expect(formatCsv(["a", "b", "c", "d"], [["NULL", "true", "123", "a"]])).toBe('a,b,c,d\n"""NULL""","""true""","""123""",a')
    expect(formatText(["a", "b", "c", "d"], [["NULL", "true", "123", "a"]])).toBe('"NULL"\t"true"\t"123"\ta')
    expect(formatTable(["a", "b", "c", "d"], [["NULL", "true", "123", "a"]])).toContain('"NULL" | "true" | "123" | a')
  })
})
