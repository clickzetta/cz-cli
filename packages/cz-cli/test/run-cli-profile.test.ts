import { describe, expect, test } from "bun:test"
import { classifyCliArgs } from "../src/run-cli"

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
