import { describe, expect, test } from "bun:test"
import { splitSql } from "../src/sql/split.js"

describe("splitSql", () => {
  test("drops trailing single-line comment after a terminated statement", () => {
    expect(splitSql("select 'abc', 1 + 1; --comment")).toEqual(["select 'abc', 1 + 1", " --comment"])
  })

  test("drops comment-only input", () => {
    expect(splitSql("--comment only")).toEqual(["--comment only"])
    expect(splitSql("/* comment only */")).toEqual(["/* comment only */"])
  })

  test("keeps fragments that still contain SQL after a leading comment", () => {
    expect(splitSql("select 1; --comment\nselect 2")).toEqual(["select 1", " --comment\nselect 2"])
  })

  test("preserves double-quoted SQL text", () => {
    expect(splitSql('select "abc";')).toEqual(['select "abc"'])
  })

  test("single statement without semicolon", () => {
    expect(splitSql("select 1")).toHaveLength(1)
  })

  test("single statement with semicolon", () => {
    expect(splitSql("select 1;")).toHaveLength(1)
  })

  test("two statements without trailing semicolon", () => {
    expect(splitSql("select 1;select 2")).toHaveLength(2)
  })

  test("two statements with trailing semicolon", () => {
    expect(splitSql("select 1;select 2;")).toHaveLength(2)
  })

  test("multiline single statement", () => {
    expect(splitSql("select 1\n\n\nfrom table;")).toHaveLength(1)
  })

  test("lone semicolon produces empty", () => {
    expect(splitSql(";")).toHaveLength(0)
  })

  test("double semicolons produce empty", () => {
    expect(splitSql(";;")).toHaveLength(0)
  })

  test("semicolons with space between", () => {
    expect(splitSql("; ;")).toHaveLength(1)
  })

  test("semicolons with newline between", () => {
    expect(splitSql(";\n;")).toHaveLength(1)
  })

  test("empty string", () => {
    expect(splitSql("")).toHaveLength(0)
  })

  test("single newline", () => {
    expect(splitSql("\n")).toHaveLength(1)
  })

  test("single-line comment with semicolons inside", () => {
    expect(splitSql("select *\n-- -- ;\nfrom world\n")).toHaveLength(1)
  })

  test("unclosed backtick identifier", () => {
    expect(splitSql("select `aaaa")).toHaveLength(1)
  })

  test("single-quoted string with semicolons and newlines", () => {
    expect(splitSql("select 'aaa;\nbbb'\n")).toHaveLength(1)
  })

  test("double-quoted string with escaped quote and semicolons", () => {
    expect(splitSql('select "--\\"/*;\n*/"')).toHaveLength(1)
  })

  test("mixed comments and SQL", () => {
    expect(splitSql("-- line 1\nselect\n/* comment -- -- ;\n****/*\nfrom foo")).toHaveLength(1)
  })

  test("multiple statements with block comments", () => {
    expect(splitSql("/*/--/*/;\nselect /* -- 1; */\n1;-- sql 2")).toHaveLength(3)
  })

  test("double-quoted string with escaped backslash before semicolon", () => {
    expect(splitSql('select "1\\\\";select2\n')).toHaveLength(2)
  })
})
