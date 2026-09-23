import { describe, expect, test } from "bun:test"
import { execute, splitArgs } from "../src/execute.ts"

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

describe("commandGroup error output honors invocation args (same-process)", () => {
  // Regression guard for the bug where commandGroup's fail handler read
  // process.argv (the host process — TUI/MCP — on the same-process execute()
  // path) instead of this invocation's args. --format/--field must resolve from
  // the invocation. The test runner's process.argv carries none of these flags,
  // so a pass proves the args came from the invocation, not the global argv.
  test("--field extracts a single field from a subcommand usage error", async () => {
    const { exitCode, output } = await execute("schema badsubcmd --format json --field error.code")
    expect(exitCode).toBe(2)
    const first = output.trim().split("\n")[0]!
    expect(first).toContain("USAGE_ERROR")
    // A --field extraction yields only the field value; the full envelope
    // (did_you_mean / ai_message) would appear only if --field were ignored.
    expect(first).not.toContain("did_you_mean")
    expect(first).not.toContain("ai_message")
  })
})

describe("SQL shell-splitting recovery", () => {
  test("suggests file and stdin input for fragmented quote-heavy SQL", async () => {
    const result = await execute("sql", [
      "SELECT",
      "CASE",
      "WHEN",
      "component_name",
      "LIKE",
      "'%api%'",
      "THEN",
      "'matched'",
      "ELSE",
      "'other'",
      "END",
      "UNION",
      "ALL",
      "SELECT",
      "1",
      "--format",
      "json",
    ])
    expect(result.exitCode).toBe(2)
    const payload = JSON.parse(result.output)
    expect(payload.error.message).toContain("The SQL appears to have been split by the shell")
    expect(payload.error.message).toContain("cz-cli sql -f /tmp/query.sql")
    expect(payload.error.message).toContain("cz-cli sql --stdin < /tmp/query.sql")
    expect(payload.ai_message).toContain("quote-heavy SQL statement")
    // "Rewrite", never "reconstruct": the fragments are not a faithful copy of the
    // statement, so an agent told not to reconstruct them has nothing left to do.
    expect(payload.ai_message).not.toContain("Do not reconstruct")
  })

  // The shape the product itself generates: tui's buildSqlInlineCommand emits
  // `cz-cli sql <flags> '<SQL>'`, and renderFlags always injects --format. Reading
  // "the first token that does not start with -" made the detector see the flag's
  // VALUE, so the hint fired for `--format=json` and stayed silent for the
  // space-separated spelling of the same command.
  test("fires when a valued flag precedes the SQL", async () => {
    const split = ["SELECT", "CASE", "WHEN", "c", "LIKE", "'%a%'", "THEN", "1", "ELSE", "2", "END", "FROM", "t"]
    for (const args of [["--format", "json", ...split], ["--format=json", ...split], ["--limit", "10", ...split]]) {
      const payload = JSON.parse((await execute("sql", args)).output)
      expect(payload.error.message).toContain("split by the shell")
    }
  })

  // forward.ts passes argv through verbatim, empty tokens included; "" fails
  // startsWith("-") just like a real positional does.
  test("fires despite an empty argv token", async () => {
    const result = await execute("sql", ["", "SELECT", "CASE", "WHEN", "x", "END", "FROM", "t", "--format", "json"])
    expect(JSON.parse(result.output).error.message).toContain("split by the shell")
  })

  // `sql` as a global's VALUE is not the `sql` command: a status call has no SQL to
  // split, so SQL advice there is pure noise.
  test("stays silent when 'sql' is only an option value", async () => {
    const result = await execute("status", ["--schema", "sql", "SELECT", "ON", "ALL", "--format", "json"])
    expect(result.exitCode).toBe(2)
    const payload = JSON.parse(result.output)
    expect(payload.error.message).not.toContain("split by the shell")
    expect(payload.ai_message).not.toContain("quote-heavy")
  })

  // A flag typo and split SQL routinely arrive together; suppressing the split
  // advice until the typo is fixed costs a guaranteed second round trip.
  test("reports a flag suggestion and the split advice together", async () => {
    const result = await execute("sql", [
      "SELECT", "CASE", "WHEN", "a", "THEN", "1", "ELSE", "2", "END", "FROM", "t", "-formt", "x", "--format", "json",
    ])
    expect(result.exitCode).toBe(2)
    const payload = JSON.parse(result.output)
    expect(payload.error.message).toContain("Did you mean '--format'?")
    expect(payload.error.message).toContain("split by the shell")
    expect(payload.ai_message).toContain("Did you mean '--format'?")
    expect(payload.ai_message).toContain("quote-heavy SQL statement")
    expect(payload.error.did_you_mean).toBe("--format")
  })

  // The message named `bogus` while the suggestion came from `--schema`'s value.
  test("does not suggest a command from a global option's value", async () => {
    const result = await execute("--schema tabel bogus --format json")
    expect(result.exitCode).toBe(2)
    const payload = JSON.parse(result.output)
    expect(payload.error.message).not.toContain("Did you mean")
    expect(payload.error.did_you_mean).toBeUndefined()
  })

  test("keeps the generic usage error for unrelated extra arguments", async () => {
    const result = await execute("sql", ["SELECT 1", "junk", "noise", "--format", "json"])
    expect(result.exitCode).toBe(2)
    const payload = JSON.parse(result.output)
    expect(payload.error.message).toBe("Unknown arguments: junk, noise")
    expect(payload.ai_message).toBe("Run the command with --help to see available options and usage.")
  })
})
