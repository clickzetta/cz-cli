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

  test("returns empty flags and sql for a bare /sql", () => {
    expect(parseSqlInput("/sql")).toEqual({ flags: [], sql: "" })
    expect(parseSqlInput("/sql   ")).toEqual({ flags: [], sql: "" })
  })

  test("extracts and trims the query with no flags", () => {
    expect(parseSqlInput("/sql SELECT 1")).toEqual({ flags: [], sql: "SELECT 1" })
    expect(parseSqlInput("/sql   SELECT 1  ")).toEqual({ flags: [], sql: "SELECT 1" })
  })

  test("supports a newline after /sql for multi-line queries", () => {
    expect(parseSqlInput("/sql\nSELECT *\nFROM t")).toEqual({ flags: [], sql: "SELECT *\nFROM t" })
  })

  test("parses leading boolean flags", () => {
    expect(parseSqlInput("/sql --write INSERT INTO t VALUES(1)")).toEqual({
      flags: ["--write"],
      sql: "INSERT INTO t VALUES(1)",
    })
  })

  test("parses value-flags in space and equals form", () => {
    expect(parseSqlInput("/sql --limit 0 SELECT 1")).toEqual({ flags: ["--limit", "0"], sql: "SELECT 1" })
    expect(parseSqlInput("/sql --limit=0 SELECT 1")).toEqual({ flags: ["--limit=0"], sql: "SELECT 1" })
  })

  test("parses multiple flags including a value-flag", () => {
    expect(parseSqlInput("/sql --write --limit 5 DELETE FROM t WHERE id = 1")).toEqual({
      flags: ["--write", "--limit", "5"],
      sql: "DELETE FROM t WHERE id = 1",
    })
  })

  test("treats a global value-flag's argument as a value, not SQL", () => {
    expect(parseSqlInput("/sql --profile prod SELECT 1")).toEqual({
      flags: ["--profile", "prod"],
      sql: "SELECT 1",
    })
  })

  test("stops flag parsing at the first SQL keyword (no over-capture)", () => {
    // A bareword that is not a flag ends parsing; flags inside the SQL body
    // (e.g. a string literal) are left untouched.
    expect(parseSqlInput("/sql SELECT '--write' AS x")).toEqual({
      flags: [],
      sql: "SELECT '--write' AS x",
    })
    expect(parseSqlInput("/sql UPDATE t SET note = '--limit 5' WHERE id = 1")).toEqual({
      flags: [],
      sql: "UPDATE t SET note = '--limit 5' WHERE id = 1",
    })
  })

  test("treats a leading SQL line comment as SQL, not a flag", () => {
    expect(parseSqlInput("/sql -- a comment\nSELECT 1")).toEqual({
      flags: [],
      sql: "-- a comment\nSELECT 1",
    })
  })

  test("preserves the original SQL body formatting after flags", () => {
    expect(parseSqlInput("/sql --write\nUPDATE t\nSET x = 1")).toEqual({
      flags: ["--write"],
      sql: "UPDATE t\nSET x = 1",
    })
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

  test("injects passthrough flags after the default format", () => {
    expect(buildSqlInlineCommand("insert into t values(1)", "cz-cli", ["--write"])).toBe(
      "cz-cli sql --format table --write 'insert into t values(1)'",
    )
    expect(buildSqlInlineCommand("select 1", "cz-cli", ["--limit", "0"])).toBe(
      "cz-cli sql --format table --limit 0 'select 1'",
    )
  })

  test("does not inject default format when user passes their own --format", () => {
    expect(buildSqlInlineCommand("select 1", "cz-cli", ["--format", "json"])).toBe(
      "cz-cli sql --format json 'select 1'",
    )
    expect(buildSqlInlineCommand("select 1", "cz-cli", ["--format=csv"])).toBe(
      "cz-cli sql --format=csv 'select 1'",
    )
  })

  test("shell-quotes flag values containing special characters", () => {
    expect(buildSqlInlineCommand("select 1", "cz-cli", ["--variable", "x=$HOME"])).toBe(
      "cz-cli sql --format table --variable 'x=$HOME' 'select 1'",
    )
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

  test("injects passthrough flags and honors user --format", () => {
    expect(buildSqlFileCommand("/tmp/q.sql", "cz-cli", ["--write"])).toBe(
      'cz-cli sql --format table --write --file "/tmp/q.sql"',
    )
    expect(buildSqlFileCommand("/tmp/q.sql", "cz-cli", ["--format", "jsonl"])).toBe(
      'cz-cli sql --format jsonl --file "/tmp/q.sql"',
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
