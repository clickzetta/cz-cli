import { describe, expect, test } from "bun:test"
import { splitSql } from "../src/sql/split.js"

describe("splitSql", () => {
  test("drops trailing single-line comment after a terminated statement", () => {
    expect(splitSql("select 'abc', 1 + 1; --comment")).toEqual(["select 'abc', 1 + 1"])
  })

  test("drops comment-only input", () => {
    expect(splitSql("--comment only")).toEqual([])
    expect(splitSql("/* comment only */")).toEqual([])
  })

  test("keeps fragments that still contain SQL after a leading comment", () => {
    expect(splitSql("select 1; --comment\nselect 2")).toEqual(["select 1", " --comment\nselect 2"])
  })

  test("preserves double-quoted SQL text", () => {
    expect(splitSql('select "abc";')).toEqual(['select "abc"'])
  })
})
