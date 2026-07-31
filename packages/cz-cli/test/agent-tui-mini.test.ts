import { describe, expect, test } from "bun:test"
import { findMiniFlag, MINI_UNSUPPORTED_MESSAGE, TuiThreadCommand } from "../src/agent-cmd/tui"

describe("findMiniFlag", () => {
  test("detects bare --mini", () => {
    expect(findMiniFlag(["--mini"])).toBe("--mini")
  })

  test("detects --mini=true", () => {
    expect(findMiniFlag(["--mini=true"])).toBe("--mini")
  })

  test("detects the flags whose upstream handler requires --mini", () => {
    expect(findMiniFlag(["--no-replay"])).toBe("--no-replay")
    expect(findMiniFlag(["--replay-limit", "5"])).toBe("--replay-limit")
    expect(findMiniFlag(["--demo"])).toBe("--demo")
  })

  test("ignores unrelated args", () => {
    expect(findMiniFlag([])).toBeUndefined()
    expect(findMiniFlag(["-s", "ses_1", "--model", "a/b"])).toBeUndefined()
  })

  test("does not false-positive on a session id containing the word", () => {
    expect(findMiniFlag(["-s", "ses_mini_x"])).toBeUndefined()
  })
})

describe("TuiThreadCommand --mini rejection", () => {
  test("keeps upstream's command and describe", () => {
    expect(TuiThreadCommand.command).toBe("$0 [project]")
    expect(typeof TuiThreadCommand.describe).toBe("string")
  })

  test("rejects --mini with a clear message and a nonzero exit code", async () => {
    const argv = process.argv
    const exitCode = process.exitCode
    let stderr = ""
    const write = process.stderr.write
    process.stderr.write = ((chunk: unknown) => {
      stderr += String(chunk)
      return true
    }) as typeof process.stderr.write
    process.argv = ["bun", "cz-cli", "--mini"]
    try {
      await TuiThreadCommand.handler!({ mini: true } as never)
      expect(stderr).toContain(MINI_UNSUPPORTED_MESSAGE)
      expect(process.exitCode).toBe(1)
    } finally {
      process.stderr.write = write
      process.argv = argv
      process.exitCode = exitCode
    }
  })

  test("hides the mini family from --help", async () => {
    // Run the real builder against a real yargs instance and read the rendered help,
    // which is what actually matters to the user.
    const yargsFactory = (await import("yargs")).default
    const y = yargsFactory([]).scriptName("cz-cli agent")
    const built = (TuiThreadCommand.builder as (x: unknown) => unknown)(y) as {
      getHelp: () => Promise<string>
    }
    const help = await built.getHelp()
    expect(help).not.toContain("--mini")
    expect(help).not.toContain("--replay-limit")
    expect(help).not.toContain("--demo")
    // Sanity: a flag we did NOT hide is still advertised.
    expect(help).toContain("--session")
  })
})
