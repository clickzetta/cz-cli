import { describe, expect, test } from "bun:test"
import {
  parseSqlInput,
  canInlineSql,
  buildSqlInlineCommand,
  buildSqlFileCommand,
  buildSqlCommandPrefix,
} from "../../../src/component/prompt/sql-command"

describe("parseSqlInput", () => {
  test("returns null for non-/sql input", () => {
    expect(parseSqlInput("hello")).toBeNull()
    expect(parseSqlInput("/sqlfoo")).toBeNull()
    expect(parseSqlInput("/other SELECT 1")).toBeNull()
  })

  test("returns an empty sql body for a bare /sql", () => {
    expect(parseSqlInput("/sql")).toEqual({ flags: [], sql: "" })
    expect(parseSqlInput("/sql   ")).toEqual({ flags: [], sql: "" })
  })

  test("extracts and trims the query", () => {
    expect(parseSqlInput("/sql SELECT 1")).toEqual({ flags: [], sql: "SELECT 1" })
    expect(parseSqlInput("/sql   SELECT 1  ")).toEqual({ flags: [], sql: "SELECT 1" })
  })

  test("supports a newline after /sql for multi-line queries", () => {
    expect(parseSqlInput("/sql\nSELECT *\nFROM t")).toEqual({ flags: [], sql: "SELECT *\nFROM t" })
  })

  test("strips leading boolean flags", () => {
    expect(parseSqlInput("/sql --write INSERT INTO t VALUES(1)")).toEqual({
      flags: ["--write"],
      sql: "INSERT INTO t VALUES(1)",
    })
  })

  test("a value-flag consumes its argument so the value never leaks into the SQL", () => {
    expect(parseSqlInput("/sql --limit 0 SELECT * FROM big")).toEqual({
      flags: ["--limit", "0"],
      sql: "SELECT * FROM big",
    })
    // `--flag=value` form carries its own value, so the next token is SQL.
    expect(parseSqlInput("/sql --limit=0 SELECT 1")).toEqual({ flags: ["--limit=0"], sql: "SELECT 1" })
    // A profile name must not become the first SQL token.
    expect(parseSqlInput("/sql --profile prod SELECT 1")).toEqual({
      flags: ["--profile", "prod"],
      sql: "SELECT 1",
    })
  })

  test("flag parsing stops at the first non-flag token", () => {
    // A `--write` appearing INSIDE the SQL body is SQL, not a flag.
    expect(parseSqlInput("/sql SELECT 1 --write")).toEqual({ flags: [], sql: "SELECT 1 --write" })
  })

  test("a leading SQL line comment or negative number is SQL, not a flag", () => {
    // This is why the flag gate requires a letter after `--`.
    expect(parseSqlInput("/sql -- just a comment\nSELECT 1")).toEqual({
      flags: [],
      sql: "-- just a comment\nSELECT 1",
    })
    expect(parseSqlInput("/sql -1")).toEqual({ flags: [], sql: "-1" })
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
    // These are exactly the characters the `eval "<cmd>"` layer in
    // core/src/shell.ts would act on, corrupting the query.
    expect(canInlineSql("select $1")).toBe(false)
    expect(canInlineSql("select `col` from t")).toBe(false)
    expect(canInlineSql("select 'a'")).toBe(false)
    expect(canInlineSql("select 1\nfrom t")).toBe(false)
    expect(canInlineSql("select 1\tfrom t")).toBe(false)
  })

  test("Windows always uses the shell-neutral temp-file path", () => {
    expect(canInlineSql("select 1", "win32")).toBe(false)
  })
})

describe("buildSqlInlineCommand", () => {
  test("single-quotes the SQL", () => {
    expect(buildSqlInlineCommand("select 1")).toBe("cz-cli sql --format table 'select 1'")
  })

  test("renders leading flags between `sql` and the body", () => {
    expect(buildSqlInlineCommand("INSERT INTO t VALUES(1)", "cz-cli", ["--write"])).toBe(
      "cz-cli sql --format table --write 'INSERT INTO t VALUES(1)'",
    )
  })

  test("quotes flag values carrying shell metacharacters", () => {
    const cmd = buildSqlInlineCommand("select 1", "cz-cli", ["--profile", "a b$c"])
    expect(cmd).toBe("cz-cli sql --format table --profile 'a b$c' 'select 1'")
  })

  test("injects table only when no explicit format was supplied", () => {
    expect(buildSqlInlineCommand("select 1", "cz-cli", ["--format", "csv"])).toBe(
      "cz-cli sql --format csv 'select 1'",
    )
    expect(buildSqlInlineCommand("select 1")).toContain("--format table")
  })
})

describe("buildSqlFileCommand", () => {
  test("double-quotes a posix path", () => {
    expect(buildSqlFileCommand("/tmp/cz-cli-sql-1.sql")).toBe('cz-cli sql --format table --file "/tmp/cz-cli-sql-1.sql"')
  })

  test("normalizes windows backslashes to forward slashes", () => {
    expect(buildSqlFileCommand("C:\\Users\\John Doe\\Temp\\q.sql")).toBe(
      'cz-cli sql --format table --file "C:/Users/John Doe/Temp/q.sql"',
    )
  })

  test("renders leading flags before --file", () => {
    expect(buildSqlFileCommand("/tmp/q.sql", "cz-cli", ["--write"])).toBe(
      'cz-cli sql --format table --write --file "/tmp/q.sql"',
    )
  })

  test("uses Windows-compatible quoting for file paths and flag values", () => {
    expect(buildSqlFileCommand("C:\\Users\\John Doe\\Temp\\q.sql", "cz-cli", ["--profile", "a b"], "win32")).toBe(
      'cz-cli sql --format table --profile "a b" --file "C:/Users/John Doe/Temp/q.sql"',
    )
  })
})

describe("buildSqlCommandPrefix", () => {
  test("installed binary invokes itself", () => {
    expect(buildSqlCommandPrefix({ execPath: "/usr/local/bin/cz-cli", argv: ["cz-cli"] })).toBe(
      '"/usr/local/bin/cz-cli"',
    )
  })

  test("installed binary ignores the TUI argv tail", () => {
    expect(buildSqlCommandPrefix({ execPath: "/opt/cz/cz-cli", argv: ["/opt/cz/cz-cli", "tui"] })).toBe(
      '"/opt/cz/cz-cli"',
    )
  })

  // Running from source (`bun run src/main.ts`) there is no `cz-cli` on PATH,
  // so the prefix has to re-enter through bun with the same entrypoint.
  test("dev from source: re-invokes bun with the resolved entrypoint", () => {
    expect(
      buildSqlCommandPrefix({ execPath: "/usr/bin/bun", argv: ["/usr/bin/bun", "/repo/src/main.ts"] }),
    ).toBe('"/usr/bin/bun" run --conditions=browser "/repo/src/main.ts"')
  })

  test("dev with a relative entrypoint resolves against cwd", () => {
    expect(
      buildSqlCommandPrefix({ execPath: "/usr/bin/bun", argv: ["/usr/bin/bun", "src/main.ts"], cwd: "/repo" }),
    ).toBe('"/usr/bin/bun" run --conditions=browser "/repo/src/main.ts"')
  })

  test("preserves Windows executable paths", () => {
    expect(
      buildSqlCommandPrefix({
        execPath: "C:\\Program Files\\ClickZetta\\cz-cli.exe",
        argv: ["C:\\Program Files\\ClickZetta\\cz-cli.exe", "tui"],
        platform: "win32",
      }),
    ).toBe('& "C:\\Program Files\\ClickZetta\\cz-cli.exe"')
  })

  test("uses cmd invocation syntax when cmd is configured", () => {
    expect(
      buildSqlCommandPrefix({
        execPath: "C:\\Program Files\\ClickZetta\\cz-cli.exe",
        argv: ["C:\\Program Files\\ClickZetta\\cz-cli.exe", "tui"],
        platform: "win32",
        shell: "C:\\Windows\\System32\\cmd.exe",
      }),
    ).toBe('"C:\\Program Files\\ClickZetta\\cz-cli.exe"')
  })
})
