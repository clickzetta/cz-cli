import { describe, expect, test } from "bun:test"
import { classifyCliArgs } from "../src/run-cli"

// Upstream opencode binds `-p` to `--password` (basic auth for a headless server)
// on run/attach/providers — a concept cz-cli does not expose. Left alone, the cz
// global `-p, --profile` collided with it on the agent runtime path: the value was
// parsed as a server password, --profile stayed unset, and the runtime middleware
// reset CZ_* back to default_profile, silently targeting the WRONG lakehouse.
// classifyCliArgs canonicalizes `-p` to `--profile` before any parser runs.
// A re-baseline that reintroduces the collision must fail here.
describe("-p short flag canonicalization (upstream --password collision)", () => {
  const cases: Array<[string, string[], string[]]> = [
    ["agent run", ["agent", "run", "hi", "-p", "staging"], ["agent", "run", "hi", "--profile", "staging"]],
    ["bare agent", ["agent", "-p", "staging"], ["agent", "--profile", "staging"]],
    ["agent subcommand", ["agent", "session", "list", "-p", "x"], ["agent", "session", "list", "--profile", "x"]],
    ["top-level run", ["run", "hi", "-p", "staging"], ["run", "hi", "--profile", "staging"]],
    ["-p= form", ["run", "hi", "-p=staging"], ["run", "hi", "--profile=staging"]],
    ["native command", ["sql", "SELECT 1", "-p", "staging"], ["sql", "SELECT 1", "--profile", "staging"]],
  ]

  for (const [name, input, expected] of cases) {
    test(`rewrites -p to --profile: ${name}`, () => {
      expect(classifyCliArgs(input).runtimeArgs).toEqual(expected)
    })
  }

  // -v is --version (boolean) in BOTH parser trees now. It used to be --vcluster
  // at the top level and --version under `agent`, so `agent -v myvc session list`
  // printed the version and silently dropped the command. The scanner must treat
  // -v as value-less, or it swallows the following token as a vcluster name.
  test("-v takes no value and is not read as --vcluster", () => {
    const result = classifyCliArgs(["agent", "-v", "session", "list"])
    expect(result.command).toBe("agent")
    expect(result.subcommand).toBe("session")
  })

  test("leaves args after -- untouched", () => {
    const result = classifyCliArgs(["agent", "run", "hi", "--", "-p", "raw"])
    expect(result.runtimeArgs).toEqual(["agent", "run", "hi", "--", "-p", "raw"])
  })

  test("-p selects the profile without being consumed as a subcommand", () => {
    const result = classifyCliArgs(["agent", "-p", "staging", "session", "list"])
    expect(result.command).toBe("agent")
    expect(result.subcommand).toBe("session")
    expect(result.shouldDelegateToAgentRuntime).toBe(true)
  })
})

describe("classifyCliArgs profile-aware agent routing", () => {
  test("keeps bare agent entry on the TUI path when --profile is provided", () => {
    const result = classifyCliArgs(["agent", "--profile", "staging"])
    expect(result.shouldDelegateToAgentRuntime).toBe(true)
    expect(result.runtimeArgs).toEqual(["agent", "--profile", "staging"])
  })

  test("keeps agent subcommands intact when --profile appears before them", () => {
    const result = classifyCliArgs(["agent", "--profile", "staging", "session", "list"])
    expect(result.shouldDelegateToAgentRuntime).toBe(true)
    expect(result.runtimeArgs).toEqual(["agent", "--profile", "staging", "session", "list"])
  })

  test("detects runtime delegation when global flags appear before agent", () => {
    const result = classifyCliArgs(["--format", "text", "agent", "run", "hello"])
    expect(result.shouldDelegateToAgentRuntime).toBe(true)
    expect(result.command).toBe("agent")
    expect(result.subcommand).toBe("run")
    expect(result.runtimeArgs).toEqual(["agent", "--format", "text", "run", "hello"])
  })
})
