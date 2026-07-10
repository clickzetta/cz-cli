import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { discoverAgentMcp, injectAgentMcp } from "../src/agent-mcp"

const ENV_KEYS = [
  "HOME",
  "CLICKZETTA_TEST_HOME",
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

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function setTestHome(home: string) {
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
}

function writeProfiles(home: string, body: string) {
  write(join(home, ".clickzetta", "profiles.toml"), body)
}

function writeBuiltinManifest(home: string, body = JSON.stringify({ kind: "clickzetta_remote", enabled: true, timeout: 120000 })) {
  write(join(home, ".clickzetta", "mcp", ".builtin", "clickzetta-lakehouse", "mcp.json"), body)
}

afterEach(() => {
  restoreEnv()
})

describe("agent MCP discovery", () => {
  test("resolves the bundled ClickZetta manifest into a remote MCP config", async () => {
    const home = mkdtempSync(join(tmpdir(), "cz-cli-agent-mcp-home-"))
    const cwd = mkdtempSync(join(tmpdir(), "cz-cli-agent-mcp-cwd-"))
    setTestHome(home)
    writeProfiles(
      home,
      [
        'default_profile = "dev"',
        "",
        "[profiles.dev]",
        'pat = "pat-123"',
        'service = "uat-api.clickzetta.com"',
        'instance = "inst"',
        'workspace = "ws"',
        'schema = "public"',
        'vcluster = "default"',
        "",
      ].join("\n"),
    )
    writeBuiltinManifest(home)

    const mcp = await discoverAgentMcp({}, cwd)
    expect(mcp["clickzetta-lakehouse"]).toEqual({
      type: "remote",
      url: "https://uat-mcp-api.clickzetta.com/mcp",
      enabled: true,
      timeout: 120000,
      headers: {
        "X-Lakehouse-Token": "Bearer pat-123",
        "x-Lakehouse-Service": "uat-api.clickzetta.com",
        "x-Lakehouse-Instance": "inst",
        "x-Lakehouse-Workspace": "ws",
        "x-Lakehouse-Schema": "public",
        "x-Lakehouse-VCluster": "default",
      },
    })
  })

  test("falls back to the default service when the profile omits service", async () => {
    const home = mkdtempSync(join(tmpdir(), "cz-cli-agent-mcp-default-"))
    setTestHome(home)
    writeProfiles(
      home,
      [
        'default_profile = "dev"',
        "",
        "[profiles.dev]",
        'pat = "pat-123"',
        "",
      ].join("\n"),
    )
    writeBuiltinManifest(home)

    const mcp = await discoverAgentMcp()
    expect(mcp["clickzetta-lakehouse"]).toMatchObject({
      type: "remote",
      url: "https://dev-mcp-api.clickzetta.com/mcp",
    })
  })

  test("project manifests can disable the bundled ClickZetta MCP", async () => {
    const home = mkdtempSync(join(tmpdir(), "cz-cli-agent-mcp-disable-home-"))
    const cwd = mkdtempSync(join(tmpdir(), "cz-cli-agent-mcp-disable-cwd-"))
    setTestHome(home)
    writeProfiles(
      home,
      [
        'default_profile = "dev"',
        "",
        "[profiles.dev]",
        'pat = "pat-123"',
        'service = "uat-api.clickzetta.com"',
        "",
      ].join("\n"),
    )
    writeBuiltinManifest(home)
    write(join(cwd, ".clickzetta", "mcp", "clickzetta-lakehouse", "mcp.json"), JSON.stringify({ enabled: false }))

    const mcp = await discoverAgentMcp({}, cwd)
    expect(mcp["clickzetta-lakehouse"]).toMatchObject({
      type: "remote",
      url: "https://uat-mcp-api.clickzetta.com/mcp",
      enabled: false,
    })
  })

  test("caller-provided OPENCODE_CONFIG_CONTENT overrides auto-discovered fields", async () => {
    const home = mkdtempSync(join(tmpdir(), "cz-cli-agent-mcp-existing-home-"))
    setTestHome(home)
    writeProfiles(
      home,
      [
        'default_profile = "dev"',
        "",
        "[profiles.dev]",
        'pat = "pat-123"',
        'service = "uat-api.clickzetta.com"',
        "",
      ].join("\n"),
    )
    writeBuiltinManifest(home)
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      mcp: {
        "clickzetta-lakehouse": { enabled: false },
        custom: { type: "remote", url: "https://custom.example.com/mcp" },
      },
    })

    await injectAgentMcp()

    const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}") as {
      mcp?: Record<string, unknown>
    }
    expect(config.mcp?.["clickzetta-lakehouse"]).toEqual({
      type: "remote",
      url: "https://uat-mcp-api.clickzetta.com/mcp",
      enabled: false,
      timeout: 120000,
      headers: {
        "X-Lakehouse-Token": "Bearer pat-123",
        "x-Lakehouse-Service": "uat-api.clickzetta.com",
        "x-Lakehouse-Schema": "public",
        "x-Lakehouse-VCluster": "default",
      },
    })
    expect(config.mcp?.custom).toEqual({ type: "remote", url: "https://custom.example.com/mcp" })
  })

  test("skips enabled ClickZetta manifests when no credential is configured", async () => {
    const home = mkdtempSync(join(tmpdir(), "cz-cli-agent-mcp-no-auth-"))
    setTestHome(home)
    writeBuiltinManifest(home)

    const mcp = await discoverAgentMcp()
    expect(mcp).toEqual({})
  })
})
