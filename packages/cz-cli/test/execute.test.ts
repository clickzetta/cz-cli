import { describe, expect, test } from "bun:test"
import { splitArgs } from "../src/execute.ts"

describe("splitArgs", () => {
  test("unescapes embedded double quotes inside quoted args", () => {
    expect(splitArgs('sql "select \\"abc\\";" --sync')).toEqual([
      "sql",
      'select "abc";',
      "--sync",
    ])
  })

  test("preserves escaped backslashes inside quoted args", () => {
    expect(splitArgs('sql "select \\\\\\\\tmp as path" --sync')).toEqual([
      "sql",
      "select \\\\tmp as path",
      "--sync",
    ])
  })
})
