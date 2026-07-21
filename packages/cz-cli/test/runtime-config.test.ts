import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { injectClickzettaAgentConfig, parseAgentTimeoutMs } from "../src/bootstrap/runtime-config.js"
import { writeLlmConfig } from "../src/llm/native-config.js"

const HOME = join(tmpdir(), `cz-runtime-config-${process.pid}-${Date.now()}`)
const ORIGINAL = {
  home: process.env.CLICKZETTA_TEST_HOME,
  config: process.env.OPENCODE_CONFIG_CONTENT,
}

beforeEach(() => {
  mkdirSync(join(HOME, ".clickzetta"), { recursive: true })
  process.env.CLICKZETTA_TEST_HOME = HOME
  delete process.env.OPENCODE_CONFIG_CONTENT
})

afterEach(() => {
  if (ORIGINAL.home === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = ORIGINAL.home
  if (ORIGINAL.config === undefined) delete process.env.OPENCODE_CONFIG_CONTENT
  else process.env.OPENCODE_CONFIG_CONTENT = ORIGINAL.config
  rmSync(HOME, { recursive: true, force: true })
})

describe("injectClickzettaAgentConfig", () => {
  test("rewrites clickzetta llm providers to local runtime assets and appends the cz plugin", () => {
    writeLlmConfig({
      provider: {
        clickzetta: {
          npm: "@clickzetta/ai-gateway",
          options: { apiKey: "key-1", baseURL: "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1" },
        },
      },
    })

    injectClickzettaAgentConfig()

    const injected = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}") as {
      provider?: Record<string, { npm?: string }>
      plugin?: unknown[]
    }
    const clickzettaPlugin = injected.plugin?.find(
      (entry): entry is string =>
        typeof entry === "string" &&
        (entry.includes("clickzetta-opencode-plugin") || entry.includes("/opencode-plugin/server.")),
    )
    expect(injected.provider?.clickzetta?.npm).toMatch(/^file:\/\//)
    expect(injected.provider?.clickzetta?.npm).toContain("clickzetta-ai-gateway")
    expect(Array.isArray(injected.plugin)).toBe(true)
    expect(clickzettaPlugin).toBeDefined()
    expect(clickzettaPlugin).toMatch(/^file:\/\//)
  })

  test("carries llm.json's active default model into config so sessions don't pick a stale provider", () => {
    // Two providers + an active default_llm expressed as llm.json's top-level
    // `model`. Without propagating it, a no-model session lets opencode pick a
    // provider on its own (often the wrong/stale one) → "Invalid API key".
    writeLlmConfig({
      model: "claude-code/claude-sonnet-5",
      provider: {
        stale: { npm: "@clickzetta/ai-gateway", options: { apiKey: "old", baseURL: "https://uat/gateway/v1" } },
        "claude-code": { npm: "@clickzetta/ai-gateway", options: { apiKey: "good", baseURL: "https://cn/gateway/v1" } },
      },
    })

    injectClickzettaAgentConfig()

    const injected = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}") as { model?: string }
    expect(injected.model).toBe("claude-code/claude-sonnet-5")
  })

  test("a user/upstream-set model in existing config wins over llm.json's default", () => {
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: "user/override-model" })
    writeLlmConfig({
      model: "claude-code/claude-sonnet-5",
      provider: {
        "claude-code": { npm: "@clickzetta/ai-gateway", options: { apiKey: "good", baseURL: "https://cn/gateway/v1" } },
      },
    })

    injectClickzettaAgentConfig()

    const injected = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}") as { model?: string }
    expect(injected.model).toBe("user/override-model")
  })

  test("preserves existing injected config and rewrites inline openai-compatible ClickZetta entries too", () => {
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      mcp: { builtin: { type: "local", command: ["echo", "ok"] } },
      plugin: ["file:///tmp/existing-plugin.js"],
      provider: {
        relay: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1", apiKey: "key-2" },
        },
      },
    })

    injectClickzettaAgentConfig()

    const injected = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}") as {
      mcp?: Record<string, unknown>
      plugin?: unknown[]
      provider?: Record<string, { npm?: string }>
    }
    expect(injected.mcp?.builtin).toBeDefined()
    expect(injected.plugin).toContain("file:///tmp/existing-plugin.js")
    expect(
      injected.plugin?.filter(
        (entry) =>
          typeof entry === "string" &&
          (entry.includes("clickzetta-opencode-plugin") || entry.includes("/opencode-plugin/server.")),
      ).length,
    ).toBe(1)
    expect(injected.provider?.relay?.npm).toMatch(/^file:\/\//)
    expect(injected.provider?.relay?.npm).toContain("clickzetta-ai-gateway")
  })

  test("agent --timeout injects options.headerTimeout on rewritten providers, preserving existing options", () => {
    writeLlmConfig({
      provider: {
        clickzetta: {
          npm: "@clickzetta/ai-gateway",
          options: { apiKey: "key-1", baseURL: "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1" },
        },
      },
    })

    injectClickzettaAgentConfig(150_000)

    const injected = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}") as {
      provider?: Record<string, { options?: Record<string, unknown> }>
    }
    const opts = injected.provider?.clickzetta?.options
    expect(opts?.headerTimeout).toBe(150_000)
    expect(opts?.apiKey).toBe("key-1")
    expect(opts?.baseURL).toContain("clickzetta.com")
  })

  test("agent --timeout does NOT override a provider that already pins timeout/headerTimeout", () => {
    writeLlmConfig({
      provider: {
        clickzetta: {
          npm: "@clickzetta/ai-gateway",
          options: { baseURL: "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1", headerTimeout: 5_000 },
        },
      },
    })

    injectClickzettaAgentConfig(150_000)

    const injected = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}") as {
      provider?: Record<string, { options?: Record<string, unknown> }>
    }
    expect(injected.provider?.clickzetta?.options?.headerTimeout).toBe(5_000)
  })

  test("no --timeout (undefined) leaves provider options without headerTimeout", () => {
    writeLlmConfig({
      provider: {
        clickzetta: {
          npm: "@clickzetta/ai-gateway",
          options: { baseURL: "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1" },
        },
      },
    })

    injectClickzettaAgentConfig(undefined)

    const injected = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}") as {
      provider?: Record<string, { options?: Record<string, unknown> }>
    }
    expect(injected.provider?.clickzetta?.options?.headerTimeout).toBeUndefined()
  })
})

describe("parseAgentTimeoutMs", () => {
  test("parses --timeout <seconds> and --timeout=<seconds> to milliseconds", () => {
    expect(parseAgentTimeoutMs(["agent", "run", "hi", "--timeout", "150"])).toBe(150_000)
    expect(parseAgentTimeoutMs(["agent", "run", "hi", "--timeout=90"])).toBe(90_000)
    expect(parseAgentTimeoutMs(["--timeout", "150.5"])).toBe(150_500)
  })

  test("returns undefined when absent or after the -- passthrough boundary", () => {
    expect(parseAgentTimeoutMs(["agent", "run", "hi"])).toBeUndefined()
    expect(parseAgentTimeoutMs(["agent", "run", "hi", "--", "--timeout", "150"])).toBeUndefined()
  })

  test("returns null for a present-but-invalid value", () => {
    expect(parseAgentTimeoutMs(["--timeout", "abc"])).toBeNull()
    expect(parseAgentTimeoutMs(["--timeout", "-5"])).toBeNull()
    expect(parseAgentTimeoutMs(["--timeout", "0"])).toBeNull()
  })
})
