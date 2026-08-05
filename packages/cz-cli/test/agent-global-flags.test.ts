import { describe, expect, test } from "bun:test"
import { classifyCliArgs } from "../src/run-cli.js"

// Global output flags (--format/--field) have repeatedly worked on one agent
// subcommand and not its siblings. The cause was always the same shape, and it
// was never covered: e2e-routing's AGENT_FORMAT_FLAG case only exercised
// `agent run`, so `agent llm` / `stats` / `session` regressed unnoticed.
//
// Two invariants make the inconsistency impossible to reintroduce:
//
//  1. Arg rewriting must not displace a dispatch key. bootstrap/runtime.ts
//     dispatches on FIXED POSITIONS (`args[0] === "agent" && args[1] === "llm"`),
//     so re-inserting --format at args[1] silently broke that match — the flag
//     then reached a parser that never declared it and was rejected as unknown.
//     `agent run` only escaped because it has no deeper key to displace.
//  2. The rewrite must preserve the command path and every non-format token, so
//     a flag can never change WHICH command runs.
//
// These assert the pure arg-normalization layer. Acceptance by each real parser
// is covered end-to-end in e2e-routing.ts (AGENT_GLOBAL_OUTPUT_FLAGS).

/**
 * Assert the tokens bootstrap/runtime.ts actually dispatches on. It reads args[0]
 * and — only for `agent` — args[1]. For a top-level command (`llm show`,
 * `run hello`) args[1] is a leaf that its own parser reads positionally, so the
 * flag may legitimately sit before it; args[0] must still lead.
 */
function expectDispatchKeysIntact(out: string[], path: readonly string[]) {
  expect(out[0]).toBe(path[0])
  if (path[0] === "agent" && path.length > 1) expect(out[1]).toBe(path[1])
}

/** Command paths reached through the agent runtime, deepest dispatch key first. */
const AGENT_PATHS = [
  ["agent", "llm", "show"],
  ["agent", "llm", "list"],
  ["agent", "llm", "test", "my-entry"],
  ["agent", "llm", "use", "my-entry/some-model"],
  ["agent", "stats"],
  ["agent", "session", "list"],
  ["agent", "session", "status", "ses_1"],
  ["agent", "export", "ses_1"],
  ["agent", "run", "hello"],
  ["llm", "show"],
  ["run", "hello"],
] as const

function runtimeArgs(args: readonly string[]): string[] {
  return classifyCliArgs([...args]).runtimeArgs
}

describe("agent global output flags — arg normalization", () => {
  test("--format never displaces the subcommand dispatch key", () => {
    for (const path of AGENT_PATHS) {
      expectDispatchKeysIntact(runtimeArgs([...path, "--format", "json"]), path)
    }
  })

  test("--format is preserved exactly once, with its value adjacent", () => {
    for (const path of AGENT_PATHS) {
      const out = runtimeArgs([...path, "--format", "json"])
      const at = out.indexOf("--format")
      expect(at).toBeGreaterThanOrEqual(0)
      expect(out.lastIndexOf("--format")).toBe(at)
      expect(out[at + 1]).toBe("json")
    }
  })

  test("the command path and all non-format tokens survive in order", () => {
    for (const path of AGENT_PATHS) {
      const out = runtimeArgs([...path, "--format", "json"])
      expect(out.filter((token) => token !== "--format" && token !== "json")).toEqual([...path])
    }
  })

  test("--format=value inline form is preserved and does not displace dispatch", () => {
    for (const path of AGENT_PATHS) {
      const out = runtimeArgs([...path, "--format=json"])
      expectDispatchKeysIntact(out, path)
      expect(out).toContain("--format=json")
      expect(out.filter((token) => token !== "--format=json")).toEqual([...path])
    }
  })

  test("a leading --format still resolves the same command and subcommand", () => {
    for (const path of AGENT_PATHS) {
      const trailing = classifyCliArgs([...path, "--format", "json"])
      const leading = classifyCliArgs(["--format", "json", ...path])
      expect(leading.command).toBe(trailing.command)
      expect(leading.subcommand).toBe(trailing.subcommand)
      expect(leading.runtimeArgs).toEqual(trailing.runtimeArgs)
    }
  })

  test("delegation to the agent runtime is unchanged by --format", () => {
    for (const path of AGENT_PATHS) {
      const without = classifyCliArgs([...path])
      const with_ = classifyCliArgs([...path, "--format", "json"])
      expect(with_.shouldDelegateToAgentRuntime).toBe(without.shouldDelegateToAgentRuntime)
      expect(with_.command).toBe(without.command)
      expect(with_.subcommand).toBe(without.subcommand)
    }
  })

  test("no --format leaves args untouched", () => {
    for (const path of AGENT_PATHS) {
      expect(runtimeArgs(path)).toEqual([...path])
    }
  })
})

describe("agent global output flags — flags that must NOT be rewritten", () => {
  test("--profile keeps its position and value on every agent path", () => {
    for (const path of AGENT_PATHS) {
      const out = runtimeArgs([...path, "--profile", "staging"])
      expect(out).toEqual([...path, "--profile", "staging"])
      expect(classifyCliArgs([...path, "--profile", "staging"]).subcommand).toBe(
        classifyCliArgs([...path]).subcommand,
      )
    }
  })

  test("-p is canonicalized to --profile without disturbing dispatch", () => {
    for (const path of AGENT_PATHS) {
      const parsed = classifyCliArgs([...path, "-p", "staging"])
      expect(parsed.args).toContain("--profile")
      expect(parsed.command).toBe(path[0])
      expectDispatchKeysIntact(parsed.runtimeArgs, path)
    }
  })

  test("--format after `--` is left alone as a pass-through token", () => {
    const out = runtimeArgs(["agent", "run", "hello", "--", "--format", "json"])
    const sep = out.indexOf("--")
    expect(sep).toBeGreaterThanOrEqual(0)
    // Nothing before the separator may have gained a --format.
    expect(out.slice(0, sep)).not.toContain("--format")
    expect(out.slice(sep)).toEqual(["--", "--format", "json"])
  })
})

describe("agent subcommand resolution", () => {
  test("the subcommand is the first non-flag token after the command", () => {
    expect(classifyCliArgs(["agent", "llm", "show"]).subcommand).toBe("llm")
    expect(classifyCliArgs(["agent", "stats"]).subcommand).toBe("stats")
    expect(classifyCliArgs(["agent", "session", "list"]).subcommand).toBe("session")
  })

  test("flags before the subcommand do not hide it", () => {
    expect(classifyCliArgs(["agent", "--profile", "staging", "llm", "show"]).subcommand).toBe("llm")
    expect(classifyCliArgs(["--format", "json", "agent", "llm", "show"]).subcommand).toBe("llm")
  })

  test("a bare agent invocation has no subcommand and still delegates", () => {
    const parsed = classifyCliArgs(["agent"])
    expect(parsed.subcommand).toBeUndefined()
    expect(parsed.shouldDelegateToAgentRuntime).toBe(true)
  })

  test("--help on an agent subcommand is not delegated to the runtime", () => {
    expect(classifyCliArgs(["agent", "llm", "--help"]).shouldDelegateToAgentRuntime).toBe(false)
    expect(classifyCliArgs(["agent", "--help"]).shouldDelegateToAgentRuntime).toBe(false)
  })
})
