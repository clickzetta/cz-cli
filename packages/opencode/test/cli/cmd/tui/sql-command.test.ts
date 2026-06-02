import { describe, expect, test } from "bun:test"
import {
  parseSqlInput,
  canInlineSql,
  buildSqlInlineCommand,
  buildSqlFileCommand,
} from "../../../../src/cli/cmd/tui/component/prompt/sql-command"

describe("parseSqlInput", () => {
  test("returns null for non-/sql input", () => {
    expect(parseSqlInput("hello")).toBeNull()
    expect(parseSqlInput("/sqlfoo")).toBeNull()
    expect(parseSqlInput("/other SELECT 1")).toBeNull()
  })

  test("returns empty string for a bare /sql", () => {
    expect(parseSqlInput("/sql")).toBe("")
    expect(parseSqlInput("/sql   ")).toBe("")
  })

  test("extracts and trims the query", () => {
    expect(parseSqlInput("/sql SELECT 1")).toBe("SELECT 1")
    expect(parseSqlInput("/sql   SELECT 1  ")).toBe("SELECT 1")
  })

  test("supports a newline after /sql for multi-line queries", () => {
    expect(parseSqlInput("/sql\nSELECT *\nFROM t")).toBe("SELECT *\nFROM t")
  })
})

describe("canInlineSql", () => {
  test("simple queries and shell-inert specials can be inlined", () => {
    expect(canInlineSql("select 1")).toBe(true)
    expect(canInlineSql("select * from t where x = 1")).toBe(true)
    // ", \, ;, |, &, (), <>, {}, [], %, ! survive single-quoting through eval
    expect(canInlineSql('select "c" \\ * ; | & (a) <b> {c} [d] 100% != ok')).toBe(true)
  })

  test("$, backtick, single quote and control chars cannot be inlined", () => {
    expect(canInlineSql("select $1")).toBe(false)
    expect(canInlineSql("select `col` from t")).toBe(false)
    expect(canInlineSql("select 'a'")).toBe(false)
    expect(canInlineSql("select 1\nfrom t")).toBe(false)
    expect(canInlineSql("select 1\tfrom t")).toBe(false)
  })
})

describe("buildSqlInlineCommand", () => {
  test("single-quotes the SQL", () => {
    expect(buildSqlInlineCommand("select 1")).toBe("cz-cli sql 'select 1'")
  })
})

describe("buildSqlFileCommand", () => {
  test("double-quotes a posix path", () => {
    expect(buildSqlFileCommand("/tmp/cz-cli-sql-1.sql")).toBe('cz-cli sql --file "/tmp/cz-cli-sql-1.sql"')
  })

  test("normalizes windows backslashes to forward slashes", () => {
    expect(buildSqlFileCommand("C:\\Users\\John Doe\\Temp\\q.sql")).toBe(
      'cz-cli sql --file "C:/Users/John Doe/Temp/q.sql"',
    )
  })
})
