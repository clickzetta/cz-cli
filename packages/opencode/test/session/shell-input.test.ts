import { describe, expect, test } from "bun:test"
import { ShellInput } from "../../src/session/prompt"

describe("SessionPrompt.ShellInput", () => {
  test("accepts a display command separate from the executed command", () => {
    expect(ShellInput.parse({
      sessionID: "ses_test",
      agent: "build",
      command: "\"/usr/bin/bun\" run --conditions=browser \"/repo/packages/opencode/src/index.ts\" sql --format table 'select 1'",
      displayCommand: "/sql select 1",
    }).displayCommand).toBe("/sql select 1")
  })
})
