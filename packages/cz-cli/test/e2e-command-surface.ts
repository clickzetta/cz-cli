/**
 * Command-surface smoke tests.
 * Verifies every major help-exposed command family reaches the expected handler
 * and returns a stable result shape instead of usage/internal errors.
 * Run: bun test/e2e-command-surface.ts
 */
import { spawnSync } from "child_process"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const BINARY = process.env.CZ_CLI_BIN ?? process.execPath
const BINARY_ENTRY = process.env.CZ_CLI_ENTRY ? [process.env.CZ_CLI_ENTRY] : ["./src/main.ts"]
const PASS = "\x1b[32m✓\x1b[0m"
const FAIL = "\x1b[31m✗\x1b[0m"

interface Result { stdout: string; stderr: string; exitCode: number }

function run(args: string[], env?: Record<string, string>): Result {
  const r = spawnSync(BINARY, [...BINARY_ENTRY, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
    timeout: 40_000,
  })
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    exitCode: r.status ?? 1,
  }
}

function parseJson(output: string): Record<string, unknown> | null {
  try { return JSON.parse(output.trim().split("\n")[0]) } catch { return null }
}

function withFakeHome() {
  const home = join(tmpdir(), `cz-surface-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

function withProfileButNoAnalysisEndpoint() {
  const { home, cleanup } = withFakeHome()
  writeFileSync(
    join(home, ".clickzetta", "profiles.toml"),
    [
      'default_profile = "default"',
      "",
      "[profiles.default]",
      'pat = "test-pat"',
      'service = "cn-shanghai-alicloud.api.clickzetta.com"',
      'instance = "test-instance"',
      'workspace = "test-workspace"',
      'schema = "public"',
      'vcluster = "default"',
      "",
    ].join("\n"),
  )
  return { home, cleanup }
}

interface TestCase {
  name: string
  run: () => { pass: boolean; detail?: string }
}

function expectCode(output: string, expected: string) {
  const parsed = parseJson(output)
  return (parsed?.error as any)?.code === expected
}

const noProfileCases = [
  ["sql", "SELECT 1"],
  ["schema", "list"],
  ["schema", "describe", "demo"],
  ["table", "list"],
  ["table", "describe", "demo"],
  ["workspace", "list"],
  ["workspace", "current"],
  ["workspace", "use", "demo"],
  ["status"],
  ["task", "list"],
  ["task", "content", "demo"],
  ["task", "execute", "demo"],
  ["task", "flow", "dag", "demo"],
  ["runs", "list"],
  ["runs", "detail", "1"],
  ["runs", "wait", "1"],
  ["attempts", "list"],
  ["attempts", "log", "1"],
  ["job", "status", "1"],
  ["job", "result", "1"],
  ["job", "profile", "1"],
  ["datasource", "list"],
  ["datasource", "catalogs", "ds"],
  ["analytics-agent", "datasource", "list"],
  ["analytics-agent", "knowledge", "list"],
  ["analytics-agent", "knowledge", "get", "1"],
  ["analytics-agent", "knowledge", "create", "--alias", "demo", "--content", "demo"],
  ["analytics-agent", "knowledge", "update", "1", "--content", "demo"],
  ["analytics-agent", "knowledge", "delete", "1"],
  ["analytics-agent", "knowledge", "space", "list"],
  ["analytics-agent", "knowledge", "folder", "list", "1"],
  ["analytics-agent", "knowledge", "folder", "create", "1", "--name", "demo"],
  ["analytics-agent", "knowledge", "folder", "by-path", "1", "--path", "demo"],
  ["analytics-agent", "knowledge", "folder", "search", "1", "--keyword", "demo"],
  ["analytics-agent", "knowledge", "folder", "sort", "1", "--node-id", "1"],
  ["analytics-agent", "knowledge", "folder", "delete", "1", "1"],
  ["analytics-agent", "knowledge", "folder", "rename", "1", "1", "--name", "demo"],
  ["analytics-agent", "knowledge", "folder", "move", "1", "1", "--parent-id", "0"],
  ["analytics-agent", "knowledge", "folder", "copy", "1", "1", "--parent-id", "0"],
  ["analytics-agent", "knowledge", "file", "list", "1"],
  ["analytics-agent", "knowledge", "file", "by-path", "1", "--path", "demo"],
  ["analytics-agent", "knowledge", "file", "search", "1", "--keyword", "demo"],
  ["analytics-agent", "knowledge", "file", "get", "1", "1"],
  ["analytics-agent", "knowledge", "file", "delete", "1", "1"],
  ["analytics-agent", "knowledge", "file", "rename", "1", "1", "--name", "demo.txt"],
  ["analytics-agent", "knowledge", "file", "move", "1", "1", "--parent-id", "0"],
  ["analytics-agent", "knowledge", "file", "copy", "1", "1", "--parent-id", "0"],
  ["analytics-agent", "metric", "list", "--domain-id", "1"],
  ["analytics-agent", "metric", "detail", "1"],
  ["analytics-agent", "metric", "validate", "--domain-id", "1", "--datasource-id", "1", "--table-name", "t1", "--name", "m1", "--expression", "count(1)"],
  ["analytics-agent", "metric", "enable", "1"],
  ["analytics-agent", "metric", "disable", "1"],
  ["analytics-agent", "answer-builder", "list"],
  ["analytics-agent", "answer-builder", "enable", "1"],
  ["analytics-agent", "answer-builder", "disable", "1"],
  ["analytics-agent", "domain", "joins", "discover", "--domain-id", "1"],
  ["analytics-agent", "domain", "joins", "result", "--task-id", "t1"],
  ["analytics-agent", "domain", "joins", "apply", "--domain-id", "1", "--join", "1:t.a=2:t2.b@n:1"],
  ["analytics-agent", "domain", "prompt", "get", "1"],
  ["analytics-agent", "domain", "prompt", "set", "1", "--prompt", "demo"],
  ["analytics-agent", "domain", "prompt", "clear", "1"],
  ["analytics-agent", "service", "enabled"],
  ["analytics-agent", "table", "semantics", "list", "1"],
  ["analytics-agent", "table", "semantics", "get", "1", "1"],
  ["analytics-agent", "table", "semantics", "set", "1", "1", "--description", "demo"],
  ["analytics-agent", "table", "semantics", "prop", "1", "1", "--property", "hidden", "--value", "true"],
  ["analytics-agent", "column", "virtual", "list", "1"],
  ["analytics-agent", "column", "virtual", "compile", "--dataset-id", "1", "--name", "v1", "--type", "string", "--expression", "col_a"],
  ["analytics-agent", "column", "virtual", "set", "--dataset-id", "1", "--name", "v1", "--type", "string", "--expression", "col_a"],
  ["analytics-agent", "column", "virtual", "delete", "--dataset-id", "1", "--attr-id", "1"],
  ["analytics-agent", "session", "create", "--domain-id", "1"],
  ["analytics-agent", "session", "run", "--session-id", "1"],
  ["analytics-agent", "session", "result", "1"],
  ["analytics-agent", "session", "stop", "1", "1"],
] as const

const tests: TestCase[] = [
  {
    name: "DATA_COMMANDS: profile-gated command families return NO_PROFILE instead of usage/internal errors",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        for (const args of noProfileCases) {
          const result = run([...args], { HOME: home, CLICKZETTA_TEST_HOME: home })
          const combined = result.stdout + result.stderr
          if (result.exitCode !== 1) {
            return { pass: false, detail: `${args.join(" ")} exit=${result.exitCode}` }
          }
          if (!expectCode(result.stdout, "NO_PROFILE")) {
            return { pass: false, detail: `${args.join(" ")} unexpected output=${combined.slice(0, 160)}` }
          }
          if (combined.includes("USAGE_ERROR") || combined.includes("INTERNAL_ERROR") || combined.includes("undefined is not an object")) {
            return { pass: false, detail: `${args.join(" ")} leaked internal/usage error` }
          }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "ANALYTICS_AGENT: configured profile without analysis_agent_endpoint returns a dedicated config error",
    run() {
      const { home, cleanup } = withProfileButNoAnalysisEndpoint()
      try {
        const result = run(["analytics-agent", "service", "enabled"], { HOME: home, CLICKZETTA_TEST_HOME: home })
        const combined = result.stdout + result.stderr
        if (result.exitCode !== 1) {
          return { pass: false, detail: `exit=${result.exitCode}` }
        }
        if (!expectCode(result.stdout, "NO_ANALYSIS_AGENT_ENDPOINT")) {
          return { pass: false, detail: `unexpected output=${combined.slice(0, 200)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "AGENT_ENTRY: bare agent and agent run return NO_ACTIVE_LLM without a configured llm",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        for (const args of [["agent"], ["agent", "run", "hello"]] as const) {
          const result = run([...args], { HOME: home, CLICKZETTA_TEST_HOME: home })
          const combined = result.stdout + result.stderr
          if (result.exitCode !== 1) {
            return { pass: false, detail: `${args.join(" ")} exit=${result.exitCode}` }
          }
          if (!expectCode(result.stdout, "NO_ACTIVE_LLM")) {
            return { pass: false, detail: `${args.join(" ")} unexpected output=${combined.slice(0, 160)}` }
          }
          if (combined.includes("USAGE_ERROR") || combined.includes("undefined/chat/completions")) {
            return { pass: false, detail: `${args.join(" ")} hit the wrong runtime path` }
          }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "AGENT_LLM: llm management commands work locally without an active llm",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const show = run(["agent", "llm", "show"], { HOME: home, CLICKZETTA_TEST_HOME: home })
        const add = run(["agent", "llm", "add", "relay", "--provider", "openai-compatible", "--base-url", "https://gateway.example/v1", "--api-key", "sk-test", "--use"], { HOME: home, CLICKZETTA_TEST_HOME: home })
        const list = run(["agent", "llm", "list"], { HOME: home, CLICKZETTA_TEST_HOME: home })
        if (show.exitCode !== 0 || add.exitCode !== 0 || list.exitCode !== 0) {
          return { pass: false, detail: `show=${show.exitCode} add=${add.exitCode} list=${list.exitCode}` }
        }
        if (show.stdout.includes("\"code\":\"NO_ACTIVE_LLM\"") || add.stdout.includes("\"code\":\"NO_ACTIVE_LLM\"") || list.stdout.includes("\"code\":\"NO_ACTIVE_LLM\"")) {
          return { pass: false, detail: "llm management was blocked by NO_ACTIVE_LLM" }
        }
        if (!list.stdout.includes("relay")) {
          return { pass: false, detail: `unexpected list output=${list.stdout.slice(0, 160)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "SERVE_HELP: top-level serve exposes opencode server help without profile or LLM gating",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const result = run(["serve", "--help"], { HOME: home, CLICKZETTA_TEST_HOME: home })
        const combined = result.stdout + result.stderr
        if (result.exitCode !== 0) return { pass: false, detail: `exit=${result.exitCode} output=${combined.slice(0, 160)}` }
        if (!combined.includes("starts a headless cz-cli agent server")) {
          return { pass: false, detail: `missing serve description: ${combined.slice(0, 200)}` }
        }
        if (combined.includes("NO_PROFILE") || combined.includes("NO_ACTIVE_LLM")) {
          return { pass: false, detail: `serve help was gated: ${combined.slice(0, 160)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "PRETTY_NO_PROFILE: profile-gated commands honor --format pretty",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const result = run(["sql", "SELECT 1", "--format", "pretty"], { HOME: home, CLICKZETTA_TEST_HOME: home })
        if (result.exitCode !== 1) return { pass: false, detail: `exit=${result.exitCode}` }
        const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>
        if ((parsed.error as { code?: string } | undefined)?.code !== "NO_PROFILE") {
          return { pass: false, detail: `unexpected output=${result.stdout.slice(0, 160)}` }
        }
        if (!result.stdout.includes('\n  "error": {\n')) {
          return { pass: false, detail: `not pretty=${result.stdout.slice(0, 160)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "PRETTY_USAGE_ERROR: parser failures honor --format pretty",
    run() {
      const result = run(["nope", "--format", "pretty"])
      if (result.exitCode !== 2) return { pass: false, detail: `exit=${result.exitCode}` }
      const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>
      if ((parsed.error as { code?: string } | undefined)?.code !== "USAGE_ERROR") {
        return { pass: false, detail: `unexpected output=${result.stdout.slice(0, 160)}` }
      }
      if (!result.stdout.includes('\n  "error": {\n')) {
        return { pass: false, detail: `not pretty=${result.stdout.slice(0, 160)}` }
      }
      return { pass: true }
    },
  },
  {
    name: "LOCAL_COMMANDS: ungated local commands keep working without a profile",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const profileList = run(["profile", "list"], { HOME: home, CLICKZETTA_TEST_HOME: home })
        const profileStatus = run(["profile", "status"], { HOME: home, CLICKZETTA_TEST_HOME: home })
        const setup = run(["setup"], { HOME: home, CLICKZETTA_TEST_HOME: home })
        const update = run(["update"], { HOME: home, CLICKZETTA_TEST_HOME: home })
        if (profileList.exitCode !== 0 || !profileList.stdout.includes("\"data\":[]")) {
          return { pass: false, detail: `profile list unexpected=${profileList.stdout.slice(0, 120)}` }
        }
        if (profileStatus.exitCode !== 0 || !profileStatus.stdout.includes("\"connected\":false")) {
          return { pass: false, detail: `profile status unexpected=${profileStatus.stdout.slice(0, 120)}` }
        }
        if (setup.exitCode !== 1 || !expectCode(setup.stdout, "SETUP_INPUT_REQUIRED")) {
          return { pass: false, detail: `setup unexpected=${setup.stdout.slice(0, 160)}` }
        }
        if (update.exitCode !== 1 || !update.stderr.includes("Cannot update development build")) {
          return { pass: false, detail: `update unexpected stderr=${update.stderr.slice(0, 120)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
]

async function main() {
  console.log(`\nRunning ${tests.length} command-surface smoke tests (binary: ${BINARY})...\n`)
  let pass = 0
  let fail = 0

  for (const test of tests) {
    const result = test.run()
    if (result.pass) {
      pass++
      console.log(`  ${PASS} ${test.name}`)
      continue
    }
    fail++
    console.log(`  ${FAIL} ${test.name}\n    → ${result.detail}`)
  }

  console.log(`\n${pass} passed, ${fail} failed (${tests.length} total)\n`)
  process.exitCode = fail > 0 ? 1 : 0
}

main()
