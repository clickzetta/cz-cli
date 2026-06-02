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

describe("formatTable with empty rows", () => {
  test("renders header and separator when rows is empty", () => {
    const out = formatTable(["id", "name"], [])
    expect(out).toBe("id | name\n---+-----")
  })

  test("falls back to pretty JSON when columns is also empty", () => {
    const out = formatTable([], [])
    expect(out).toBe('{\n  "columns": [],\n  "rows": []\n}')
  })
})

describe("formatCsv cell encoding roundtrip", () => {
  test("string that looks like a number is not JSON-wrapped", () => {
    // value "1" (string) must round-trip as "1", not as '"1"' (length 3)
    expect(formatCsv(["a"], [["1"]])).toBe("a\n1")
  })

  test("string that looks like a boolean is not JSON-wrapped", () => {
    expect(formatCsv(["a"], [["true"]])).toBe("a\ntrue")
  })

  test("string that looks like null is not JSON-wrapped", () => {
    expect(formatCsv(["a"], [["null"]])).toBe("a\nnull")
  })

  test("string containing a quote is CSV-escaped correctly", () => {
    // value: "a" (3 chars with quotes) → CSV: """a"""
    expect(formatCsv(["a"], [['"a"']])).toBe('a\n"""a"""')
  })
})

describe("flat output formatters preserve null vs empty string", () => {
  test("formatCsv distinguishes null from empty string", () => {
    expect(formatCsv(["a", "b"], [[null, ""]])).toBe('a,b\nNULL,""')
  })

  test("formatCsv distinguishes null from literal NULL string", () => {
    expect(formatCsv(["a", "b"], [[null, "NULL"]])).toBe('a,b\nNULL,"NULL"')
  })

  test("formatText distinguishes null from empty string", () => {
    expect(formatText(["a", "b"], [[null, ""]])).toBe('NULL\t""')
  })

  test("formatTable distinguishes null from empty string", () => {
    expect(formatTable(["a", "b"], [[null, ""]])).toContain('NULL | ""')
  })

  test("flat formats quote ambiguous strings", () => {
    expect(formatCsv(["a", "b", "c", "d"], [["NULL", "true", "123", "a"]])).toBe('a,b,c,d\n"NULL",true,123,a')
    expect(formatText(["a", "b", "c", "d"], [["NULL", "true", "123", "a"]])).toBe('"NULL"\t"true"\t"123"\ta')
    expect(formatTable(["a", "b", "c", "d"], [["NULL", "true", "123", "a"]])).toContain('"NULL" | "true" | "123" | a')
  })
})

describe("formatTable column widths", () => {
  test("aligns CJK wide characters using terminal display width", () => {
    const out = formatTable(["中文列", "b", "c"], [["foo", "x", "y"]])
    const lines = out.split("\n")
    // "中文列" occupies 6 cells, so col 1 width = 6. Other cols stay at width 1.
    expect(lines[0]).toBe("中文列 | b | c")
    // Separator joins "-".repeat(width) with "-+-", which yields N+1 dashes around each +.
    expect(lines[1]).toBe("-------+---+--")
    expect(lines[2]).toBe("foo    | x | y")
  })

  test("emoji counted as 2 cells wide", () => {
    const out = formatTable(["x"], [["😀"]])
    const lines = out.split("\n")
    expect(lines[0]).toBe("x ")
    expect(lines[1]).toBe("--")
    expect(lines[2]).toBe("😀")
  })
})
