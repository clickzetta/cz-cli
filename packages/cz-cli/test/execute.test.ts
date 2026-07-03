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

