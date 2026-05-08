/**
 * Binary-level integration tests for cz-cli routing and error handling.
 * Tests scenarios that go through index.ts (profile check, recursive guard).
 * Run: bun test/e2e-routing.ts
 */
import { spawnSync } from "child_process"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const BINARY = process.env.CZ_CLI_BIN ?? "cz-cli"

const PASS = "\x1b[32m✓\x1b[0m"
const FAIL = "\x1b[31m✗\x1b[0m"

interface Result { stdout: string; stderr: string; exitCode: number }

function run(args: string[], env?: Record<string, string>): Result {
  const r = spawnSync(BINARY, args, {
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

function withFakeHome(profileToml?: string): { home: string; cleanup: () => void } {
  const home = join(tmpdir(), `cz-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  if (profileToml) {
    writeFileSync(join(home, ".clickzetta", "profiles.toml"), profileToml)
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
      const { home, cleanup } = withFakeHome()
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
    name: "CONNECTION_ERROR: classifyExecError produces ai_message for socket errors",
    run() {
      // This is covered by the unit test (classify-error.test.ts).
      // Here we verify the binary-level: status command returns JSON (not NO_PROFILE)
      // even when the server is unreachable.
      const r = run(["status"])
      const j = parseJson(r.stdout)
      if (!j) return { pass: false, detail: `not JSON: ${r.stdout.slice(0, 80)}` }
      const code = (j.error as any)?.code
      if (code === "NO_PROFILE") return { pass: false, detail: "unexpected NO_PROFILE with real profile" }
      return { pass: true }
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
