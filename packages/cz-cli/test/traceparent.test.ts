import { describe, expect, mock, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const spawnCalls: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> = []

const actualChildProcess = await import("node:child_process")

mock.module("node:child_process", () => ({
  ...actualChildProcess,
  spawn(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) {
    spawnCalls.push({ cmd, args, env: opts.env })
    return {
      once(event: string, cb: (...args: any[]) => void) {
        if (event === "exit") queueMicrotask(() => cb(0, null))
        return this
      },
    }
  },
}))

const { runCli } = await import("../src/run-cli.ts")

describe("agent runtime traceparent handoff", () => {
  test("delegating to agent runtime passes CLICKZETTA_TRACEPARENT to child env", async () => {
    spawnCalls.length = 0
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
    } catch {}

    ;(process.exit as any) = previousExit

    const call = spawnCalls.at(-1)
    expect(call).toBeDefined()
    expect(call?.env?.CLICKZETTA_AGENT_RUNTIME).toBe("1")
    expect(call?.env?.CLICKZETTA_TRACEPARENT).toMatch(/^00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-[0-9a-f]{16}-01$/)
    expect(call?.env?.CLICKZETTA_TRACEPARENT).not.toContain("-bbbbbbbbbbbbbbbb-")
    expect(exits).toContain(0)
  })

  test("bare agent delegates to the runtime TUI entrypoint", async () => {
    spawnCalls.length = 0
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
    } catch {}

    ;(process.exit as any) = previousExit

    const call = spawnCalls.at(-1)
    expect(call).toBeDefined()
    expect(call?.args.at(-1)).toBe("run")
    expect(call?.args).not.toContain("agent")
  })
})
