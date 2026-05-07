import { describe, expect, test } from "bun:test"
import { coerceValue, hexToBytes } from "../src/sql/poll.js"

describe("coerceValue — new type branches", () => {
  test("DATE passes through as trimmed ISO string", () => {
    expect(coerceValue("2024-01-02", "DATE")).toBe("2024-01-02")
    expect(coerceValue("  2024-01-02 ", "DATE")).toBe("2024-01-02")
  })

  test("TIMESTAMP_LTZ converts space separator to T and keeps tz", () => {
    expect(
      coerceValue("2024-01-02 12:34:56.123456+08:00", "TIMESTAMP_LTZ"),
    ).toBe("2024-01-02T12:34:56.123456+08:00")
    // "TIMESTAMP" is treated as an alias of LTZ
    expect(
      coerceValue("2024-01-02 12:34:56+00:00", "TIMESTAMP"),
    ).toBe("2024-01-02T12:34:56+00:00")
    // no tz suffix is preserved as-is
    expect(
      coerceValue("2024-01-02 12:34:56", "TIMESTAMP_LTZ"),
    ).toBe("2024-01-02T12:34:56")
  })

  test("TIMESTAMP_NTZ converts space to T with no tz appended", () => {
    expect(
      coerceValue("2024-01-02 12:34:56.789", "TIMESTAMP_NTZ"),
    ).toBe("2024-01-02T12:34:56.789")
    // Must NOT append Z or a timezone offset.
    const v = coerceValue("2024-01-02 12:34:56", "TIMESTAMP_NTZ") as string
    expect(v.endsWith("Z")).toBe(false)
    expect(v.includes("+")).toBe(false)
  })

  test("BINARY / VARBINARY decode hex to Uint8Array", () => {
    const bytes = coerceValue("48656C6C6F", "BINARY") as Uint8Array
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(bytes)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f])
    expect(new TextDecoder().decode(bytes)).toBe("Hello")

    const vb = coerceValue("deadBEEF", "VARBINARY") as Uint8Array
    expect(Array.from(vb)).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  test("hexToBytes returns empty on odd/invalid input", () => {
    expect(Array.from(hexToBytes(""))).toEqual([])
    expect(Array.from(hexToBytes("abc"))).toEqual([])
    expect(Array.from(hexToBytes("zz"))).toEqual([])
  })

  test("JSON parses when valid, falls back to raw on invalid", () => {
    expect(coerceValue('{"a":1}', "JSON")).toEqual({ a: 1 })
    expect(coerceValue("[1,2,3]", "JSON")).toEqual([1, 2, 3])
    expect(coerceValue("not json", "JSON")).toBe("not json")
  })

  test("CHAR / VARCHAR / STRING pass through unchanged", () => {
    expect(coerceValue("hi", "CHAR")).toBe("hi")
    expect(coerceValue("hi", "CHAR(10)")).toBe("hi")
    expect(coerceValue("hi", "VARCHAR")).toBe("hi")
    expect(coerceValue("hi", "VARCHAR(32)")).toBe("hi")
    expect(coerceValue("hi", "STRING")).toBe("hi")
  })

  test("null literals and JS null return null", () => {
    expect(coerceValue(null, "VARCHAR")).toBe(null)
    expect(coerceValue("null", "VARCHAR")).toBe(null)
    expect(coerceValue("NULL", "DATE")).toBe(null)
  })

  test("pass-through types return the raw value", () => {
    expect(coerceValue("+1-02", "INTERVAL_YEAR_MONTH")).toBe("+1-02")
    expect(coerceValue("1 02:03:04", "INTERVAL_DAY_TIME")).toBe("1 02:03:04")
    expect(coerceValue("[1.0,2.0,3.0]", "VECTOR")).toBe("[1.0,2.0,3.0]")
    expect(coerceValue("something", "BITMAP")).toBe("something")
  })

  test("existing numeric / boolean branches still work", () => {
    expect(coerceValue("42", "INT32")).toBe(42)
    expect(coerceValue("1.5", "DOUBLE")).toBe(1.5)
    expect(coerceValue("true", "BOOLEAN")).toBe(true)
    expect(coerceValue("false", "BOOLEAN")).toBe(false)
    // DECIMAL keeps string precision
    expect(coerceValue("123.456", "DECIMAL(10,3)")).toBe("123.456")
  })
})
