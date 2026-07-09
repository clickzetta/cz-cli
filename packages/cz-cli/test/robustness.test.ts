/**
 * Robustness regression tests — locks the 5 agent-friendliness behaviors added
 * to keep the CLI self-correcting for agents:
 *   #1 profile/LLM gate runs AFTER yargs syntax validation
 *   #2 commandGroup errors honor --format / --field
 *   #3 did-you-mean for mistyped commands / subcommands / flags
 *   #4 agent session list/status reset inherited global --format choices
 *   #5 update emits a structured result when machine-bound (non-TTY / --format)
 *
 * Invokes the real CLI via the same source entry as the e2e harness.
 * Run: bun test test/robustness.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// This suite locks SOURCE behavior, so it always runs the TypeScript entry via
// the current runtime — never a (possibly stale) compiled binary. That keeps it
// deterministic even when test:ci sets CZ_CLI_BIN for the e2e suites.
const RUNTIME = process.execPath // bun
const ENTRY = ["./src/main.ts"]

// A throwaway HOME with an empty ~/.clickzetta so profile-gated commands hit the
// NO_PROFILE path deterministically (no developer profile leaking in).
let fakeHome: string

beforeAll(() => {
  fakeHome = join(tmpdir(), `cz-robust-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(fakeHome, ".clickzetta"), { recursive: true })
})

afterAll(() => {
  if (fakeHome) rmSync(fakeHome, { recursive: true, force: true })
})

interface Result { stdout: string; stderr: string; exitCode: number }

function run(args: string[], env?: Record<string, string>): Result {
  const r = spawnSync(RUNTIME, [...ENTRY, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    // Force the throwaway HOME last so it wins over the developer's real HOME.
    env: { ...process.env, ...env, HOME: fakeHome, CLICKZETTA_TEST_HOME: fakeHome },
    timeout: 40_000,
  })
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 }
}

function errorOf(stdout: string): { code?: string; message?: string; did_you_mean?: string } {
  const first = stdout.trim().split("\n")[0] ?? ""
  try {
    const parsed = JSON.parse(first) as Record<string, any>
    return parsed.error ?? {}
  } catch {
    return {}
  }
}

// PLACEHOLDER_TESTS

describe("#1 profile gate runs after yargs syntax validation", () => {
  test("unknown flag on a profile-gated command surfaces USAGE_ERROR, not NO_PROFILE", () => {
    const r = run(["sql", "SELECT 1", "--unknownflag"])
    expect(errorOf(r.stdout).code).toBe("USAGE_ERROR")
    expect(r.exitCode).toBe(2)
  })

  test("unknown subcommand surfaces USAGE_ERROR, not NO_PROFILE", () => {
    // Note: a BARE group (`task flow`) now renders help, not an error — see the
    // "bare command group renders help" suite below. An UNKNOWN subcommand is
    // still a genuine syntax error and must surface USAGE_ERROR before the gate.
    const r = run(["task", "bogus"])
    expect(errorOf(r.stdout).code).toBe("USAGE_ERROR")
  })

  test("removed workspace current subcommand surfaces USAGE_ERROR", () => {
    const r = run(["workspace", "current"])
    expect(errorOf(r.stdout).code).toBe("USAGE_ERROR")
    expect(r.exitCode).toBe(2)
  })

  test("a syntactically valid profile-gated command still reports NO_PROFILE", () => {
    const r = run(["sql", "SELECT 1"])
    expect(errorOf(r.stdout).code).toBe("NO_PROFILE")
    expect(r.exitCode).toBe(1)
  })
})

describe("#3 did-you-mean suggestions", () => {
  test("mistyped top-level command suggests the closest command", () => {
    const e = errorOf(run(["scema"]).stdout)
    expect(e.code).toBe("USAGE_ERROR")
    expect(e.did_you_mean).toBe("schema")
  })

  test("transposed top-level command is caught (tabel -> table)", () => {
    expect(errorOf(run(["tabel"]).stdout).did_you_mean).toBe("table")
  })

  test("mistyped subcommand suggests the closest subcommand", () => {
    expect(errorOf(run(["table", "descibe"]).stdout).did_you_mean).toBe("describe")
  })

  test("mistyped flag on a leaf command suggests the closest flag", () => {
    expect(errorOf(run(["status", "--formatt", "json"]).stdout).did_you_mean).toBe("--format")
  })

  test("mistyped global flag suggests the closest global flag", () => {
    expect(errorOf(run(["sql", "SELECT 1", "--profil", "x"]).stdout).did_you_mean).toBe("--profile")
  })

  test("unrelated unknown token gets no suggestion (no false positive)", () => {
    const e = errorOf(run(["zzzzzz"]).stdout)
    expect(e.code).toBe("USAGE_ERROR")
    expect(e.did_you_mean).toBeUndefined()
  })
})

describe("#2 commandGroup errors honor --format / --field", () => {
  test("--format pretty produces multi-line JSON", () => {
    // Use an unknown subcommand (a genuine error) — a bare group now renders
    // help instead of a structured error.
    const r = run(["task", "bogus", "--format", "pretty"])
    expect(r.stdout.trimStart().startsWith("{\n")).toBe(true)
  })

  test("--field extracts a nested error field as a bare value", () => {
    const r = run(["table", "descibe", "--field", "error.did_you_mean"])
    expect(r.stdout.trim()).toBe("describe")
  })
})

describe("#4 agent session resets inherited global --format choices", () => {
  test("session list help offers only table|json (no leaked csv/toon)", () => {
    const out = run(["agent", "session", "list", "--help"]).stdout
    // Positive: the command's own choices are present...
    expect(out).toMatch(/table/)
    expect(out).toMatch(/json/)
    // ...and the inherited global formats are gone.
    expect(out).not.toMatch(/csv|toon|jsonl/)
  })

  test("session status help offers only json (no leaked csv/toon)", () => {
    const out = run(["agent", "session", "status", "x", "--help"]).stdout
    expect(out).not.toMatch(/csv|toon|jsonl/)
  })
})

describe("#5 update emits structured result when machine-bound", () => {
  test("non-TTY update prints a data envelope with reason + exit code", () => {
    // CI / pipes are non-TTY, so update writes JSON to stdout.
    const r = run(["update"])
    const parsed = JSON.parse(r.stdout.trim().split("\n")[0]) as Record<string, any>
    expect(parsed.data).toBeDefined()
    expect(typeof parsed.data.reason).toBe("string")
    expect(parsed.data.updated).toBe(false)
    // dev builds refuse and exit 1; that exit contract is preserved.
    expect(r.exitCode).toBe(1)
  })

  test("--field reason extracts the bare reason", () => {
    const r = run(["update", "--field", "reason"])
    expect(r.stdout.trim().length).toBeGreaterThan(0)
    expect(r.stdout).not.toContain("{")
  })
})

describe("#6 yargs messages are forced to English (no locale leak)", () => {
  // The throwaway env inherits the shell LANG; force a Chinese locale to prove
  // .locale("en") wins regardless of environment.
  test("missing-positional error stays English under zh_CN locale", () => {
    const r = run(["table", "describe"], { LANG: "zh_CN.UTF-8", LC_ALL: "zh_CN.UTF-8" })
    const msg = errorOf(r.stdout).message ?? ""
    expect(msg).toMatch(/[A-Za-z]/)
    // No CJK characters in the message.
    expect(msg).not.toMatch(/[一-鿿]/)
  })

  test("invalid choice value lists choices in English", () => {
    const r = run(["sql", "x", "--format", "csvv"], { LANG: "zh_CN.UTF-8" })
    const msg = errorOf(r.stdout).message ?? ""
    expect(msg).not.toMatch(/[一-鿿]/)
    expect(msg.toLowerCase()).toContain("format")
  })
})

describe("#R2 flag-vs-subcommand suggestion no longer misfires", () => {
  test("mistyped flag in a subcommand does NOT suggest a subcommand name", () => {
    // `schema list --limt` previously wrongly suggested 'list' (the subcommand).
    const e = errorOf(run(["schema", "list", "--limt", "5"]).stdout)
    expect(e.code).toBe("USAGE_ERROR")
    // Either no suggestion, or a flag suggestion (starts with --), never a bare subcommand.
    if (e.did_you_mean !== undefined) {
      expect(e.did_you_mean.startsWith("--")).toBe(true)
    }
  })

  test("mistyped global flag inside a subcommand suggests the flag", () => {
    const e = errorOf(run(["schema", "list", "--formt", "json"]).stdout)
    expect(e.did_you_mean).toBe("--format")
  })

  test("valid subcommand typo still suggests the subcommand", () => {
    expect(errorOf(run(["schema", "descibe"]).stdout).did_you_mean).toBe("describe")
  })
})

