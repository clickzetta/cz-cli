import { describe, it, expect } from "bun:test"
import { escape, quote } from "../src/sql/literal.js"

describe("escape (converter.py:218-227)", () => {
  it("escapes backslash", () => expect(escape("a\\b")).toBe("a\\\\b"))
  it("escapes newline", () => expect(escape("a\nb")).toBe("a\\nb"))
  it("escapes carriage return", () => expect(escape("a\rb")).toBe("a\\rb"))
  it("escapes single quote", () => expect(escape("it's")).toBe("it\\'s"))
  it("returns non-string unchanged", () => expect(escape(42)).toBe(42))
  it("returns empty string unchanged", () => expect(escape("")).toBe(""))
})

describe("quote (converter.py:229-268)", () => {
  it("null → NULL", () => expect(quote(null)).toBe("NULL"))
  it("undefined → NULL", () => expect(quote(undefined)).toBe("NULL"))
  it("true → true", () => expect(quote(true)).toBe("true"))
  it("false → false", () => expect(quote(false)).toBe("false"))
  it("number → string repr", () => expect(quote(42)).toBe("42"))
  it("float → string repr", () => expect(quote(3.14)).toBe("3.14"))
  it("bigint → string", () => expect(quote(9007199254740993n)).toBe("9007199254740993"))
  it("bytes → X'hex'", () => {
    const b = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])
    expect(quote(b)).toBe("X'48656C6C6F'")
  })
  it("plain string → single-quoted", () => expect(quote("hello")).toBe("'hello'"))
  it("string with quote → escaped", () => expect(quote("it's")).toBe("'it\\'s'"))
  it("INTERVAL pass-through", () => expect(quote("INTERVAL '1' DAY")).toBe("INTERVAL '1' DAY"))
  it("TIMESTAMP pass-through", () => expect(quote("TIMESTAMP '2024-01-01'")).toBe("TIMESTAMP '2024-01-01'"))
  it("Date → TIMESTAMP", () => {
    const d = new Date("2024-01-02T12:34:56.000Z")
    expect(quote(d)).toBe("TIMESTAMP '2024-01-02 12:34:56.000+00:00'")
  })
  it("empty array → ARRAY()", () => expect(quote([])).toBe("ARRAY()"))
  it("array → ARRAY(...)", () => expect(quote([1, "a"])).toBe("ARRAY(1,'a')"))
  it("empty Map → MAP()", () => expect(quote(new Map())).toBe("MAP()"))
  it("Map → MAP(...)", () => {
    const m = new Map([["k", "v"]])
    expect(quote(m)).toBe("MAP('k','v')")
  })
  it("empty object → MAP()", () => expect(quote({})).toBe("MAP()"))
  it("plain object → MAP(...)", () => expect(quote({ a: 1 })).toBe("MAP('a',1)"))
})
