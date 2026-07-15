import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const mainCalls: Array<{ args: string[]; agentRuntime: boolean; traceparent?: string; configContent?: string }> = []

const __realRuntime = { ...(await import("../src/bootstrap/runtime.ts")) }

mock.module("../src/bootstrap/runtime.ts", () => ({
  main: async (args: string[], agentRuntime = false) => {
    mainCalls.push({
      args,
      agentRuntime,
      traceparent: process.env.CLICKZETTA_TRACEPARENT,
      configContent: process.env.OPENCODE_CONFIG_CONTENT,
    })
    return 0
  },
}))

const { runCli } = await import("../src/run-cli.ts")

const ENV_KEYS = [
  "HOME",
  "CLICKZETTA_TEST_HOME",
  "CLICKZETTA_TRACEPARENT",
  "OPENCODE_CONFIG_CONTENT",
  "CZ_PROFILE",
  "CZ_PAT",
  "CZ_USERNAME",
  "CZ_PASSWORD",
  "CZ_SERVICE",
  "CZ_PROTOCOL",
  "CZ_INSTANCE",
  "CZ_WORKSPACE",
  "CZ_SCHEMA",
  "CZ_VCLUSTER",
] as const
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

function writeRelayLlm(clickzettaDir: string) {
  writeFileSync(
    join(clickzettaDir, "llm.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      provider: {
        relay: {
          npm: "@ai-sdk/openai-compatible",
          options: {
            apiKey: "sk-test",
            baseURL: "https://gateway.example/v1",
          },
        },
      },
      model: "relay",
    }) + "\n",
  )
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

afterAll(() => {
  mock.module("../src/bootstrap/runtime.ts", () => __realRuntime)
})

describe("agent runtime traceparent handoff", () => {
  test("delegating to agent runtime passes a child CLICKZETTA_TRACEPARENT in-process", async () => {
    mainCalls.length = 0
    process.env.CLICKZETTA_TRACEPARENT = "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"
    const home = mkdtempSync(join(tmpdir(), "cz-cli-traceparent-"))
    const clickzettaDir = join(home, ".clickzetta")
    mkdirSync(clickzettaDir, { recursive: true })
    writeRelayLlm(clickzettaDir)
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
    writeRelayLlm(clickzettaDir)
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

  test("agent delegation injects ClickZetta MCP config before entering opencode", async () => {
    mainCalls.length = 0
    const home = mkdtempSync(join(tmpdir(), "cz-cli-agent-mcp-handoff-"))
    const clickzettaDir = join(home, ".clickzetta")
    mkdirSync(join(clickzettaDir, "mcp", ".builtin", "clickzetta-lakehouse"), { recursive: true })
    writeRelayLlm(clickzettaDir)
    writeFileSync(
      join(clickzettaDir, "profiles.toml"),
      [
        'default_profile = "dev"',
        "",
        "[profiles.dev]",
        'pat = "pat-123"',
        'service = "uat-api.clickzetta.com"',
        "",
      ].join("\n"),
    )
    writeFileSync(
      join(clickzettaDir, "mcp", ".builtin", "clickzetta-lakehouse", "mcp.json"),
      JSON.stringify({ kind: "clickzetta_remote", enabled: true, timeout: 120000 }),
    )
    process.env.HOME = home
    process.env.CLICKZETTA_TEST_HOME = home
    delete process.env.OPENCODE_CONFIG_CONTENT

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
    const config = JSON.parse(call?.configContent ?? "{}") as { mcp?: Record<string, { url?: string }> }
    expect(config.mcp?.["clickzetta-lakehouse"]?.url).toBe("https://uat-mcp-api.clickzetta.com/mcp")
  })

  test("agent delegation honors CLI connection overrides when injecting MCP config", async () => {
    mainCalls.length = 0
    const home = mkdtempSync(join(tmpdir(), "cz-cli-agent-mcp-cli-overrides-"))
    const clickzettaDir = join(home, ".clickzetta")
    mkdirSync(join(clickzettaDir, "mcp", ".builtin", "clickzetta-lakehouse"), { recursive: true })
    writeRelayLlm(clickzettaDir)
    writeFileSync(
      join(clickzettaDir, "profiles.toml"),
      "",
    )
    writeFileSync(
      join(clickzettaDir, "mcp", ".builtin", "clickzetta-lakehouse", "mcp.json"),
      JSON.stringify({ kind: "clickzetta_remote", enabled: true, timeout: 120000 }),
    )
    process.env.HOME = home
    process.env.CLICKZETTA_TEST_HOME = home
    delete process.env.OPENCODE_CONFIG_CONTENT

    const previousExit = process.exit
    ;(process.exit as any) = () => {
      throw new Error("process.exit called")
    }

    try {
      await expect(runCli(["agent", "--pat", "pat-123", "--service", "uat-api.clickzetta.com"])).rejects.toThrow()
    } finally {
      ;(process.exit as any) = previousExit
    }

    const call = mainCalls.at(-1)
    const config = JSON.parse(call?.configContent ?? "{}") as {
      mcp?: Record<string, { url?: string; headers?: Record<string, string> }>
    }
    expect(config.mcp?.["clickzetta-lakehouse"]?.url).toBe("https://uat-mcp-api.clickzetta.com/mcp")
    expect(config.mcp?.["clickzetta-lakehouse"]?.headers?.["X-Lakehouse-Token"]).toBe("Bearer pat-123")
  })
})
