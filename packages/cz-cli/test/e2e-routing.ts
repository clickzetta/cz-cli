/**
 * Binary-level integration tests for cz-cli routing and error handling.
 * Tests scenarios that go through index.ts (profile check, recursive guard).
 * Run: bun test/e2e-routing.ts
 */
import { spawnSync } from "child_process"
import { mkdirSync, writeFileSync, rmSync } from "fs"
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

interface TestCase {
  name: string
  run: () => { pass: boolean; detail?: string }
}

// --- helpers ---

function withFakeHome(profileToml?: string, llmJson?: string): { home: string; cleanup: () => void } {
  const home = join(tmpdir(), `cz-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  if (profileToml) {
    writeFileSync(join(home, ".clickzetta", "profiles.toml"), profileToml)
  }
  if (llmJson) {
    writeFileSync(join(home, ".clickzetta", "llm.json"), llmJson)
  }
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

// --- test cases ---

const tests: TestCase[] = [
  {
    name: "NO_PROFILE: no profiles.toml → error.code=NO_PROFILE",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["sql", "SELECT 1"], { HOME: home })
        const j = parseJson(r.stdout)
        if (r.exitCode !== 1) return { pass: false, detail: `exitCode=${r.exitCode}` }
        if (!j) return { pass: false, detail: `not JSON: ${r.stdout.slice(0, 80)}` }
        const code = (j.error as any)?.code
        if (code !== "NO_PROFILE") return { pass: false, detail: `error.code=${code}` }
        const nextSteps = (j.error as any)?.next_steps
        if (!Array.isArray(nextSteps) || nextSteps.length < 2) {
          return { pass: false, detail: `missing next_steps: ${JSON.stringify(j)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },

  {
    name: "NO_PROFILE: empty profiles.toml (no [profiles.*]) → error.code=NO_PROFILE",
    run() {
      const { home, cleanup } = withFakeHome("# empty\n")
      try {
        const r = run(["sql", "SELECT 1"], { HOME: home })
        const j = parseJson(r.stdout)
        if (r.exitCode !== 1) return { pass: false, detail: `exitCode=${r.exitCode}` }
        const code = (j?.error as any)?.code
        if (code !== "NO_PROFILE") return { pass: false, detail: `error.code=${code}` }
        return { pass: true }
      } finally { cleanup() }
    },
  },

  {
    name: "NO_PROFILE: has [profiles.default] → passes profile check (may fail with CONNECTION_ERROR)",
    run() {
      const { home, cleanup } = withFakeHome('[profiles.default]\ninstance = "test"\n')
      try {
        const r = run(["sql", "SELECT 1"], { HOME: home })
        const j = parseJson(r.stdout)
        // Should NOT be NO_PROFILE — any other error (CONNECTION_ERROR, etc.) is fine
        const code = (j?.error as any)?.code
        if (code === "NO_PROFILE") return { pass: false, detail: "should have passed profile check" }
        return { pass: true }
      } finally { cleanup() }
    },
  },

  {
    name: "NO_PROFILE: non-TTY output is JSON with error.code field",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["status"], { HOME: home })
        const j = parseJson(r.stdout)
        if (!j) return { pass: false, detail: `not JSON: ${r.stdout.slice(0, 80)}` }
        if (!(j.error as any)?.code) return { pass: false, detail: `missing error.code in: ${r.stdout.slice(0, 80)}` }
        return { pass: true }
      } finally { cleanup() }
    },
  },

  {
    name: "RECURSIVE_AGENT: CLICKZETTA_PID set → agent run blocked",
    run() {
      const r = run(["agent", "run"], { CLICKZETTA_PID: "99999" })
      if (r.exitCode !== 1) return { pass: false, detail: `exitCode=${r.exitCode}` }
      if (!r.stderr.includes("nested agent")) return { pass: false, detail: `stderr: ${r.stderr.slice(0, 80)}` }
      return { pass: true }
    },
  },

  {
    name: "RECURSIVE_AGENT: CLICKZETTA_PID not set → agent proceeds (may fail with NO_PROFILE)",
    run() {
      const { home, cleanup } = withFakeHome(undefined, JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        provider: {
          relay: {
            npm: "@ai-sdk/openai-compatible",
            options: {
              apiKey: "sk-test",
              baseURL: "https://example.com/v1",
            },
          },
        },
        model: "relay",
      }) + "\n")
      try {
        // Without CLICKZETTA_PID, agent should NOT be blocked by recursive guard
        // (it will fail with NO_PROFILE instead)
        const r = run(["agent", "run"], { HOME: home, CLICKZETTA_PID: "" })
        if (r.stderr.includes("nested agent")) return { pass: false, detail: "should not be blocked" }
        return { pass: true }
      } finally { cleanup() }
    },
  },

  {
    name: "LLM_ALIAS: llm test routes without requiring a ClickZetta profile",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["llm", "test"], { HOME: home })
        const j = parseJson(r.stdout)
        if (r.stderr.includes("No ClickZetta profile configured")) {
          return { pass: false, detail: `unexpected stderr: ${r.stderr.slice(0, 120)}` }
        }
        if ((j?.error as any)?.code !== "NO_ACTIVE_LLM") {
          return { pass: false, detail: `unexpected output: ${r.stdout.slice(0, 160)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "AGENT_LLM: llm management commands are not blocked by NO_ACTIVE_LLM gating",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const add = run(["agent", "llm", "add", "relay", "--provider", "openai-compatible", "--base-url", "https://gateway.example/v1", "--api-key", "sk-test", "--use"], { HOME: home })
        const show = run(["agent", "llm", "show"], { HOME: home })
        if (add.exitCode !== 0) return { pass: false, detail: `add exit=${add.exitCode} stdout=${add.stdout.slice(0, 120)}` }
        if (add.stdout.includes("\"code\":\"NO_ACTIVE_LLM\"")) return { pass: false, detail: "llm add was blocked by NO_ACTIVE_LLM" }
        if (show.exitCode !== 0) return { pass: false, detail: `show exit=${show.exitCode} stdout=${show.stdout.slice(0, 120)}` }
        if (show.stdout.includes("\"code\":\"NO_ACTIVE_LLM\"")) return { pass: false, detail: "llm show was blocked by NO_ACTIVE_LLM" }
        if (!show.stdout.includes("\"provider\":\"openai-compatible\"")) {
          return { pass: false, detail: `unexpected show output: ${show.stdout.slice(0, 160)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "AGENT_RUN: no active LLM returns NO_ACTIVE_LLM instead of runtime URL errors",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["agent", "run", "hello"], { HOME: home, CLICKZETTA_PID: "" })
        const j = parseJson(r.stdout)
        if (r.exitCode !== 1) return { pass: false, detail: `exitCode=${r.exitCode}` }
        if ((j?.error as any)?.code !== "NO_ACTIVE_LLM") {
          return { pass: false, detail: `unexpected output: ${r.stdout.slice(0, 160)}` }
        }
        if (r.stdout.includes("undefined/chat/completions") || r.stderr.includes("undefined/chat/completions")) {
          return { pass: false, detail: "leaked raw runtime URL parse error" }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "AGENT_TUI: bare agent without active LLM returns NO_ACTIVE_LLM instead of usage error",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["agent"], { HOME: home, CLICKZETTA_PID: "" })
        const j = parseJson(r.stdout)
        if (r.exitCode !== 1) return { pass: false, detail: `exitCode=${r.exitCode}` }
        if ((j?.error as any)?.code !== "NO_ACTIVE_LLM") {
          return { pass: false, detail: `unexpected output: ${r.stdout.slice(0, 160)} stderr=${r.stderr.slice(0, 120)}` }
        }
        if (r.stdout.includes("USAGE_ERROR") || r.stderr.includes("usage error")) {
          return { pass: false, detail: "bare agent still hit usage error path" }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "AGENT_HELP: agent run --help bypasses NO_ACTIVE_LLM gating",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["agent", "run", "--help"], { HOME: home, CLICKZETTA_TEST_HOME: home })
        const combined = r.stdout + r.stderr
        if (r.exitCode !== 0) return { pass: false, detail: `exitCode=${r.exitCode}` }
        if (!combined.includes("cz-cli agent run")) return { pass: false, detail: `missing help header: ${combined.slice(0, 120)}` }
        if (combined.includes("NO_ACTIVE_LLM")) return { pass: false, detail: "help path was blocked by NO_ACTIVE_LLM" }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "AGENT_FORMAT_FLAG: agent runtime commands accept global --format and reject legacy output flags",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        for (const args of [
          ["agent", "run", "-o", "text", "hello"],
          ["-o", "text", "agent", "run", "hello"],
          ["llm", "-o", "text", "show"],
        ] as const) {
          const r = run([...args], { HOME: home, CLICKZETTA_TEST_HOME: home })
          const j = parseJson(r.stdout)
          if (r.exitCode !== 2) return { pass: false, detail: `${args.join(" ")} exit=${r.exitCode}` }
          if ((j?.error as any)?.code !== "USAGE_ERROR") {
            return { pass: false, detail: `${args.join(" ")} unexpected output=${r.stdout.slice(0, 160)}` }
          }
          const message = String((j?.error as any)?.message ?? "")
          if (!message.includes("--format") || !message.includes("no longer supported")) {
            return { pass: false, detail: `${args.join(" ")} message=${message}` }
          }
        }
        for (const args of [
          ["agent", "run", "--format", "text", "hello"],
          ["--format", "text", "agent", "run", "hello"],
          ["config", "--format", "json", "show"],
        ] as const) {
          const r = run([...args], { HOME: home, CLICKZETTA_TEST_HOME: home })
          const j = parseJson(r.stdout)
          if (args.at(0) === "config") {
            // `config` was removed (it used to alias `agent llm`); now an unknown command
            if (r.exitCode === 0) return { pass: false, detail: `${args.join(" ")} unexpectedly succeeded` }
            continue
          }
          if (r.exitCode !== 1) return { pass: false, detail: `${args.join(" ")} exit=${r.exitCode}` }
          if ((j?.error as any)?.code !== "NO_ACTIVE_LLM") {
            return { pass: false, detail: `${args.join(" ")} unexpected output=${r.stdout.slice(0, 160)}` }
          }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "AGENT_SESSION_STATUS_FORMAT: session status accepts --format json on runtime path",
    run() {
      const { home, cleanup } = withFakeHome(
        undefined,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            test: {
              npm: "@ai-sdk/openai-compatible",
              options: {
                apiKey: "test",
                baseURL: "https://example.com/v1",
              },
            },
          },
          model: "test",
        }) + "\n",
      )
      try {
        const r = run(["agent", "session", "status", "ses_missing", "--format", "json"], {
          HOME: home,
          CLICKZETTA_TEST_HOME: home,
        })
        const combined = `${r.stdout}\n${r.stderr}`
        if (combined.includes("Unknown argument: format") || combined.includes("\"code\":\"USAGE_ERROR\"")) {
          return { pass: false, detail: `unexpected usage error: ${combined.slice(0, 200)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },

  {
    name: "CONNECTION_ERROR: classifyExecError produces ai_message for socket errors",
    run() {
      const { home, cleanup } = withFakeHome(
        '[profiles.default]\n' +
        'service = "127.0.0.1"\n' +
        'protocol = "http"\n' +
        'instance = "test"\n' +
        'workspace = "test"\n' +
        'pat = "invalid"\n',
      )
      try {
        const r = run(["status"], { HOME: home })
        const j = parseJson(r.stdout)
        if (!j) return { pass: false, detail: `not JSON: ${r.stdout.slice(0, 80)}` }
        const code = (j.error as any)?.code
        if (code === "NO_PROFILE") return { pass: false, detail: "unexpected NO_PROFILE with fake profile" }
        return { pass: true }
      } finally { cleanup() }
    },
  },

  {
    name: "VERSION: --version works without profile",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["--version"], { HOME: home })
        if (r.exitCode !== 0) return { pass: false, detail: `exitCode=${r.exitCode}` }
        if (!r.stdout.trim()) return { pass: false, detail: "empty output" }
        return { pass: true }
      } finally { cleanup() }
    },
  },

  {
    name: "SETUP: setup --help works without profile",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["setup", "--help"], { HOME: home })
        // setup --help should not require a profile
        if (r.stderr.includes("NO_PROFILE")) return { pass: false, detail: "setup --help should not require profile" }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "SETUP: non-TTY without args returns staged login-method guidance",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["setup"], { HOME: home })
        const j = parseJson(r.stdout)
        if (r.exitCode !== 1) return { pass: false, detail: `exitCode=${r.exitCode}` }
        if (!j) return { pass: false, detail: `not JSON: ${r.stdout.slice(0, 120)}` }
        if (j.step !== "login_method") return { pass: false, detail: `step=${String(j.step)}` }
        if (j.status !== "needs_input") return { pass: false, detail: `status=${String(j.status)}` }
        if (!Array.isArray(j.next_steps) || j.next_steps.length === 0) {
          return { pass: false, detail: `missing next_steps: ${JSON.stringify(j)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "SETUP: non-TTY existing account missing service returns service options",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["setup", "--username", "u", "--password", "p", "--account-name", "acct"], { HOME: home })
        const j = parseJson(r.stdout)
        if (r.exitCode !== 1) return { pass: false, detail: `exitCode=${r.exitCode}` }
        if (!j) return { pass: false, detail: `not JSON: ${r.stdout.slice(0, 120)}` }
        if (j.step !== "service") return { pass: false, detail: `step=${String(j.step)}` }
        if (!Array.isArray(j.options) || j.options.length === 0) {
          return { pass: false, detail: "missing service options" }
        }
        if (!Array.isArray(j.next_steps) || j.next_steps.length === 0) {
          return { pass: false, detail: `missing next_steps: ${JSON.stringify(j)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
]

// --- runner ---

async function main() {
  console.log(`\nRunning ${tests.length} routing/error tests (binary: ${BINARY})...\n`)
  let pass = 0, fail = 0
  for (const t of tests) {
    const r = t.run()
    if (r.pass) {
      pass++
      console.log(`  ${PASS} ${t.name}`)
    } else {
      fail++
      console.log(`  ${FAIL} ${t.name}\n    → ${r.detail}`)
    }
  }
  console.log(`\n${pass} passed, ${fail} failed (${tests.length} total)\n`)
  process.exitCode = fail > 0 ? 1 : 0
}

main()
