import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { spawnSync } from "child_process"
import { tmpdir } from "os"
import { join } from "path"

function run(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "opencode-profile-gating-"))
  return runWithHome(args, home)
}

function runWithHome(args: string[], home: string) {
  const result = spawnSync("bun", ["./src/index.ts", ...args], {
    cwd: import.meta.dir + "/../../",
    encoding: "utf-8",
    env: { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  })
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  }
}

test("update forwards to cz-cli without requiring a clickzetta profile", () => {
  const result = run(["update"])
  expect(result.stderr).not.toContain("No ClickZetta profile configured")
  expect(result.stdout).not.toContain("No ClickZetta profile configured")
  expect(result.stderr).toContain("Cannot update development build.")
})

test("profile commands forward without requiring a clickzetta profile", () => {
  const result = run(["profile", "list"])
  expect(result.stderr).not.toContain("No ClickZetta profile configured")
  expect(result.stdout).toContain("\"data\":[]")
})

test("status still requires a clickzetta profile", () => {
  const result = run(["status"])
  expect(result.stdout).toContain("No ClickZetta profile configured")
})

test("llm alias routes to the agent llm command family", () => {
  const result = run(["llm", "test"])
  expect(result.stderr).not.toContain("No ClickZetta profile configured")
  expect(result.stdout).toContain("\"code\":\"NO_ACTIVE_LLM\"")
})

test("bare agent accepts -p as a clickzetta profile override", () => {
  const result = run(["agent", "-p", "xhs"])
  expect(result.exitCode).toBe(1)
  expect(result.stdout).not.toContain("Unknown argument: p")
  expect(result.stdout).not.toContain("\"code\":\"USAGE_ERROR\"")
  expect(result.stdout).toContain("\"code\":\"NO_ACTIVE_LLM\"")
})

test("agent runtime does not block when clickzetta default_llm is missing source_profile", () => {
  const home = mkdtempSync(join(tmpdir(), "opencode-profile-warning-"))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  writeFileSync(
    join(home, ".clickzetta", "profiles.toml"),
    [
      'default_profile = "default"',
      'default_llm = "clickzetta"',
      "",
      "[profiles.default]",
      'pat = "pat-token"',
      'instance = "inst"',
      'workspace = "ws"',
      'service = "mock-service.example"',
      'protocol = "https"',
      "",
      "[llm.clickzetta]",
      'provider = "clickzetta"',
      'api_key = "ck-old"',
      'base_url = "https://mock-clickzetta.example"',
      "",
    ].join("\n"),
  )

  const result = runWithHome(["agent"], home)
  expect(result.stdout).not.toContain("\"code\":\"NO_ACTIVE_LLM\"")
})
