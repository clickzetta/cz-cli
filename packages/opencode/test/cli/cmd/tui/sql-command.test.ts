import { describe, expect, test } from "bun:test"
import {
  parseSqlInput,
  canInlineSql,
  buildSqlInlineCommand,
  buildSqlFileCommand,
  buildSqlCommandPrefix,
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
  test("single-quotes the SQL and forces table output", () => {
    expect(buildSqlInlineCommand("select 1")).toBe("cz-cli sql --format table 'select 1'")
  })

  test("uses an explicit command prefix", () => {
    expect(buildSqlInlineCommand("select 1", "/tmp/cz-cli-dev")).toBe("/tmp/cz-cli-dev sql --format table 'select 1'")
  })
})

describe("buildSqlFileCommand", () => {
  test("double-quotes a posix path", () => {
    expect(buildSqlFileCommand("/tmp/cz-cli-sql-1.sql")).toBe('cz-cli sql --format table --file "/tmp/cz-cli-sql-1.sql"')
  })

  test("uses an explicit command prefix", () => {
    expect(buildSqlFileCommand("/tmp/cz-cli-sql-1.sql", "/tmp/cz-cli-dev")).toBe('/tmp/cz-cli-dev sql --format table --file "/tmp/cz-cli-sql-1.sql"')
  })

  test("normalizes windows backslashes to forward slashes", () => {
    expect(buildSqlFileCommand("C:\\Users\\John Doe\\Temp\\q.sql")).toBe(
      'cz-cli sql --format table --file "C:/Users/John Doe/Temp/q.sql"',
    )
  })
})

describe("buildSqlCommandPrefix", () => {
  test("uses the current Bun TypeScript entry in dev mode", () => {
    expect(buildSqlCommandPrefix({
      execPath: "/Users/yunqi/.bun/bin/bun",
      argv: ["/Users/yunqi/.bun/bin/bun", "/repo/packages/opencode/src/index.ts", "tui"],
    })).toBe('"/Users/yunqi/.bun/bin/bun" run --conditions=browser "/repo/packages/opencode/src/index.ts"')
  })

  test("uses the current binary path in binary mode", () => {
    expect(buildSqlCommandPrefix({
      execPath: "/Users/yunqi/.local/bin/cz-cli",
      argv: ["/Users/yunqi/.local/bin/cz-cli", "/$bunfs/root/cz-cli", "tui"],
    })).toBe('"/Users/yunqi/.local/bin/cz-cli"')
  })
})
