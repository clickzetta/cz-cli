import { describe, expect, test } from "bun:test"
import { editDistance, suggestClosest } from "../src/suggest"

const COMMANDS = [
  "sql", "schema", "table", "workspace", "status", "profile", "task",
  "runs", "attempts", "job", "agent", "serve", "setup", "update",
  "datasource", "ai-gateway", "analytics-agent",
]

describe("editDistance", () => {
  test("identical strings are distance 0", () => {
    expect(editDistance("schema", "schema")).toBe(0)
  })

  test("single substitution is distance 1", () => {
    expect(editDistance("scgema", "schema")).toBe(1)
  })

  test("single deletion (missing char) is distance 1", () => {
    expect(editDistance("scema", "schema")).toBe(1)
  })

  test("adjacent transposition is distance 1", () => {
    expect(editDistance("tabel", "table")).toBe(1)
  })

  test("empty input distance equals other length", () => {
    expect(editDistance("", "table")).toBe(5)
  })
})

describe("suggestClosest", () => {
  test("suggests schema for scema", () => {
    expect(suggestClosest("scema", COMMANDS)).toBe("schema")
  })

  test("suggests table for tabel (transposition)", () => {
    expect(suggestClosest("tabel", COMMANDS)).toBe("table")
  })

  test("suggests agent for agnet (transposition)", () => {
    expect(suggestClosest("agnet", COMMANDS)).toBe("agent")
  })

  test("suggests status for staus", () => {
    expect(suggestClosest("staus", COMMANDS)).toBe("status")
  })

  test("is case-insensitive but returns canonical casing", () => {
    expect(suggestClosest("Schema", COMMANDS)).toBe("schema")
  })

  test("returns undefined for unrelated short token (no false positive)", () => {
    // "sql" vs "job" is edit distance 3; must not be suggested for a 3-char input
    expect(suggestClosest("xyz", COMMANDS)).toBeUndefined()
  })

  test("does not cross-suggest between distinct short commands", () => {
    // exact match wins, never a near short word
    expect(suggestClosest("sql", COMMANDS)).toBe("sql")
    expect(suggestClosest("job", COMMANDS)).toBe("job")
  })

  test("returns undefined for empty input", () => {
    expect(suggestClosest("", COMMANDS)).toBeUndefined()
  })

  test("suggests flags with -- prefix candidates", () => {
    expect(suggestClosest("--formatt", ["--format", "--field", "--profile"])).toBe("--format")
  })

  test("no suggestion when nothing is close enough", () => {
    expect(suggestClosest("completelyunrelated", COMMANDS)).toBeUndefined()
  })
})
