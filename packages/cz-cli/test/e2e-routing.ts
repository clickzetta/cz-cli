/**
 * Binary-level integration tests for cz-cli routing and error handling.
 * Tests scenarios that go through index.ts (profile check, recursive guard).
 * Run: bun test/e2e-routing.ts
 */
import { spawnSync } from "child_process"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

// Two invocation modes, and the entry script belongs to only one of them:
//   default          — `bun ./src/main.ts <args>`, running from source
//   CZ_CLI_BIN set   — `<binary> <args>`, running a COMPILED binary, which has
//                      main.ts baked in and takes no entry argument
//
// cz_change: BINARY_ENTRY used to default to ["./src/main.ts"] whenever
// CZ_CLI_ENTRY was unset, including when CZ_CLI_BIN pointed at a compiled
// binary. `test:ci` does exactly that (`CZ_CLI_BIN=./dist/cz-cli bun run
// test:all`), so every command ran as `cz-cli ./src/main.ts sql "SELECT 1"` —
// the path became a bogus first argument and the CLI answered USAGE_ERROR with
// exit 2. 15 of 21 routing tests failed for that reason alone, which reads as a
// broken CLI when the CLI is fine and the harness is wrong. Worse, it means
// `test:ci` has never actually exercised a compiled binary.
//
// The entry is now tied to the interpreter path, so both modes work without the
// caller having to remember to clear CZ_CLI_ENTRY. An explicit CZ_CLI_ENTRY still
// wins, for running a different entry under bun.
const BINARY = process.env.CZ_CLI_BIN ?? process.execPath
const BINARY_ENTRY = process.env.CZ_CLI_ENTRY
  ? [process.env.CZ_CLI_ENTRY]
  : process.env.CZ_CLI_BIN
    ? []
    : ["./src/main.ts"]

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
    name: "AGENT_LLM: zero entries are unavailable, not automatic",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const show = run(["agent", "llm", "show"], { HOME: home })
        const json = parseJson(show.stdout)
        const active = (json?.data as Record<string, unknown> | undefined)?.active as Record<string, unknown> | undefined
        if (show.exitCode !== 0) return { pass: false, detail: `show exit=${show.exitCode}` }
        if (active?.kind !== "none") return { pass: false, detail: `unexpected active state: ${show.stdout.slice(0, 200)}` }
        if (show.stdout.includes("OpenCode selects at runtime")) {
          return { pass: false, detail: `empty config claimed automatic selection: ${show.stdout.slice(0, 220)}` }
        }
        const reset = run(["agent", "llm", "reset"], { HOME: home })
        if (reset.exitCode !== 0 || reset.stdout.includes("OpenCode") || !reset.stdout.includes("no usable LLM entry")) {
          return { pass: false, detail: `reset misreported empty config: ${reset.stdout.slice(0, 220)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
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
        if ((j?.error as any)?.code !== "NO_LLM_CONFIGURED") {
          return { pass: false, detail: `unexpected output: ${r.stdout.slice(0, 160)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "AGENT_LLM: a provider works without a default model set",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const add = run(["agent", "llm", "add", "relay", "--provider", "openai-compatible", "--base-url", "https://gateway.example/v1", "--api-key", "sk-test"], { HOME: home })
        const show = run(["agent", "llm", "show"], { HOME: home })
        if (add.exitCode !== 0) return { pass: false, detail: `add exit=${add.exitCode} stdout=${add.stdout.slice(0, 120)}` }
        if (add.stdout.includes("\"code\":\"NO_LLM_CONFIGURED\"")) return { pass: false, detail: "llm add was blocked by NO_LLM_CONFIGURED" }
        if (show.exitCode !== 0) return { pass: false, detail: `show exit=${show.exitCode} stdout=${show.stdout.slice(0, 120)}` }
        if (show.stdout.includes("\"code\":\"NO_LLM_CONFIGURED\"")) return { pass: false, detail: "llm show was blocked by NO_LLM_CONFIGURED" }
        if (!show.stdout.includes("\"provider\":\"openai-compatible\"")) {
          return { pass: false, detail: `unexpected show output: ${show.stdout.slice(0, 160)}` }
        }
        if (!show.stdout.includes('"kind":"auto"') || !show.stdout.includes("OpenCode selects at runtime")) {
          return { pass: false, detail: `missing automatic selection state: ${show.stdout.slice(0, 240)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "AGENT_LLM: add --use explains the explicit model-selection workflow",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const add = run(["agent", "llm", "add", "relay", "--provider", "openai-compatible", "--base-url", "https://gateway.example/v1", "--api-key", "sk-test", "--use"], { HOME: home })
        const list = run(["agent", "llm", "list"], { HOME: home })
        const json = parseJson(add.stdout)
        if (add.exitCode !== 1) return { pass: false, detail: `add exit=${add.exitCode}` }
        if ((json?.error as Record<string, unknown> | undefined)?.code !== "USE_OPTION_REMOVED") {
          return { pass: false, detail: `unexpected output: ${add.stdout.slice(0, 200)}` }
        }
        if (!add.stdout.includes("agent llm test relay") || !add.stdout.includes("agent llm models relay") || !add.stdout.includes("agent llm use relay/<MODEL_ID>")) {
          return { pass: false, detail: `missing next steps: ${add.stdout.slice(0, 240)}` }
        }
        const error = json?.error as Record<string, unknown> | undefined
        if (JSON.stringify(error?.next_steps) !== JSON.stringify(["cz-cli agent llm models relay", "cz-cli agent llm use relay/<MODEL_ID>"])) {
          return { pass: false, detail: `required next steps are not models → use: ${add.stdout.slice(0, 260)}` }
        }
        if (JSON.stringify(error?.optional_checks) !== JSON.stringify(["cz-cli agent llm test relay"])) {
          return { pass: false, detail: `test should be optional: ${add.stdout.slice(0, 260)}` }
        }
        if (list.stdout.includes("relay")) return { pass: false, detail: "rejected add still wrote the LLM entry" }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "AGENT_LLM: configured provider discovery failure points to HTTP diagnostics",
    run() {
      const { home, cleanup } = withFakeHome(undefined, JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        provider: {
          bad: {
            name: "bad",
            npm: "@ai-sdk/openai-compatible",
            options: { apiKey: "bad-key", baseURL: "https://gateway.invalid/v1" },
          },
        },
      }))
      try {
        const models = run(["agent", "llm", "models", "bad"], { HOME: home })
        const json = parseJson(models.stdout)
        const error = json?.error as Record<string, unknown> | undefined
        if (models.exitCode !== 1) return { pass: false, detail: `models exit=${models.exitCode}` }
        if (error?.code !== "MODEL_DISCOVERY_FAILED") {
          return { pass: false, detail: `unexpected output: ${models.stdout.slice(0, 240)}` }
        }
        if (!models.stdout.includes("cz-cli agent llm test bad")) {
          return { pass: false, detail: `missing HTTP diagnostic step: ${models.stdout.slice(0, 240)}` }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    name: "AGENT_RUN: no LLM API configuration returns NO_LLM_CONFIGURED",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["agent", "run", "hello"], { HOME: home, CLICKZETTA_PID: "" })
        const j = parseJson(r.stdout)
        if (r.exitCode !== 1) return { pass: false, detail: `exitCode=${r.exitCode}` }
        if ((j?.error as any)?.code !== "NO_LLM_CONFIGURED") {
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
    name: "AGENT_TUI: bare agent without LLM API configuration returns NO_LLM_CONFIGURED",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["agent"], { HOME: home, CLICKZETTA_PID: "" })
        const j = parseJson(r.stdout)
        if (r.exitCode !== 1) return { pass: false, detail: `exitCode=${r.exitCode}` }
        if ((j?.error as any)?.code !== "NO_LLM_CONFIGURED") {
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
    name: "AGENT_HELP: agent run --help bypasses NO_LLM_CONFIGURED gating",
    run() {
      const { home, cleanup } = withFakeHome()
      try {
        const r = run(["agent", "run", "--help"], { HOME: home, CLICKZETTA_TEST_HOME: home })
        const combined = r.stdout + r.stderr
        if (r.exitCode !== 0) return { pass: false, detail: `exitCode=${r.exitCode}` }
        if (!combined.includes("cz-cli agent run")) return { pass: false, detail: `missing help header: ${combined.slice(0, 120)}` }
        if (combined.includes("NO_LLM_CONFIGURED")) return { pass: false, detail: "help path was blocked by NO_LLM_CONFIGURED" }
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
          if ((j?.error as any)?.code !== "NO_LLM_CONFIGURED") {
            return { pass: false, detail: `${args.join(" ")} unexpected output=${r.stdout.slice(0, 160)}` }
          }
        }
        return { pass: true }
      } finally { cleanup() }
    },
  },
  {
    // The unit side (test/agent-global-flags.test.ts) proves the arg rewrite keeps
    // dispatch keys intact; this proves each REAL parser actually accepts the flag.
    // Both halves are needed: --format survived normalization for `agent llm` yet
    // was still rejected downstream, because that subtree runs its own yargs under
    // commandGroup()'s strictOptions() and never declared the option. AGENT_FORMAT_FLAG
    // below only ever exercised `agent run`, which is why the siblings drifted.
    name: "AGENT_GLOBAL_OUTPUT_FLAGS: --format is accepted on every agent subcommand, not just run",
    run() {
      const { home, cleanup } = withFakeHome(
        undefined,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            test: { npm: "@ai-sdk/openai-compatible", options: { apiKey: "k", baseURL: "https://example.invalid/v1" } },
          },
        }),
      )
      try {
        for (const args of [
          ["agent", "llm", "show"],
          ["agent", "llm", "list"],
          ["agent", "stats"],
          ["llm", "show"],
        ]) {
          const withFlag = run([...args, "--format", "json"], { HOME: home, CLICKZETTA_TEST_HOME: home })
          const code = (parseJson(withFlag.stdout)?.error as Record<string, unknown> | undefined)?.code
          if (code === "USAGE_ERROR") {
            return { pass: false, detail: `${args.join(" ")} --format json rejected: ${withFlag.stdout.slice(0, 160)}` }
          }
          // --format must not change WHICH command ran: same exit code as without it.
          const bare = run([...args], { HOME: home, CLICKZETTA_TEST_HOME: home })
          if (withFlag.exitCode !== bare.exitCode) {
            return {
              pass: false,
              detail: `${args.join(" ")} exit changed with --format: ${bare.exitCode} -> ${withFlag.exitCode}`,
            }
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
