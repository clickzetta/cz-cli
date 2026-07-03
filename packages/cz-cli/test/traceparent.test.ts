import { describe, expect, mock, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const mainCalls: Array<{ args: string[]; agentRuntime: boolean; traceparent?: string }> = []

mock.module("../../clickzetta-entry/src/main.ts", () => ({
  main: async (args: string[], agentRuntime = false) => {
    mainCalls.push({
      args,
      agentRuntime,
      traceparent: process.env.CLICKZETTA_TRACEPARENT,
    })
    return 0
  },
}))

const { runCli } = await import("../src/run-cli.ts")

describe("agent runtime traceparent handoff", () => {
  test("delegating to agent runtime passes a child CLICKZETTA_TRACEPARENT in-process", async () => {
    mainCalls.length = 0
    process.env.CLICKZETTA_TRACEPARENT = "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"
    const home = mkdtempSync(join(tmpdir(), "cz-cli-traceparent-"))
    const clickzettaDir = join(home, ".clickzetta")
    mkdirSync(clickzettaDir, { recursive: true })
    writeFileSync(
      join(clickzettaDir, "profiles.toml"),
      ['default_llm = "relay"', "", "[llm.relay]", 'provider = "openai-compatible"', 'base_url = "https://gateway.example/v1"', 'api_key = "sk-test"', ""].join("\n"),
    )
    process.env.HOME = home
    process.env.CLICKZETTA_TEST_HOME = home

    const previousExit = process.exit
    const exits: number[] = []
    ;(process.exit as any) = (code?: number) => {
      exits.push(code ?? 0)
      throw new Error("process.exit called")
    }

    try {
      await expect(runCli(["agent", "run", "hello"])).rejects.toThrow()
    } finally {
      ;(process.exit as any) = previousExit
    }

    const call = mainCalls.at(-1)
    expect(call).toBeDefined()
    expect(call?.agentRuntime).toBe(true)
    expect(call?.args).toEqual(["agent", "run", "hello"])
    expect(call?.traceparent).toMatch(/^00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-[0-9a-f]{16}-01$/)
    expect(call?.traceparent).not.toContain("-bbbbbbbbbbbbbbbb-")
    expect(exits).toContain(0)
  })

  test("bare agent delegates to the runtime TUI entrypoint in-process", async () => {
    mainCalls.length = 0
    const home = mkdtempSync(join(tmpdir(), "cz-cli-agent-tui-"))
    const clickzettaDir = join(home, ".clickzetta")
    mkdirSync(clickzettaDir, { recursive: true })
    writeFileSync(
      join(clickzettaDir, "profiles.toml"),
      ['default_llm = "relay"', "", "[llm.relay]", 'provider = "openai-compatible"', 'base_url = "https://gateway.example/v1"', 'api_key = "sk-test"', ""].join("\n"),
    )
    process.env.HOME = home
    process.env.CLICKZETTA_TEST_HOME = home

    const previousExit = process.exit
    ;(process.exit as any) = () => {
      throw new Error("process.exit called")
    }

    try {
      await expect(runCli(["agent"])).rejects.toThrow()
    } finally {
      ;(process.exit as any) = previousExit
    }

    const call = mainCalls.at(-1)
    expect(call).toBeDefined()
    expect(call?.agentRuntime).toBe(true)
    expect(call?.args).toEqual(["agent"])
  })
})
