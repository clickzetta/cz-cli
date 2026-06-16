import { spawnSync } from "child_process"

const BINARY = process.env.CZ_CLI_BIN ?? process.execPath
const BINARY_ENTRY = process.env.CZ_CLI_ENTRY ? [process.env.CZ_CLI_ENTRY] : ["./src/main.ts"]
const PASS = "\x1b[32m✓\x1b[0m"
const FAIL = "\x1b[31m✗\x1b[0m"

interface Result { stdout: string; stderr: string; exitCode: number }

function run(args: string[]): Result {
  const r = spawnSync(BINARY, [...BINARY_ENTRY, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  })
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 }
}

export interface HelpCase {
  args: string[]
  expectHeader: string
  expectOptions?: string[]
  expectCommands?: string[]
  forbid?: string[]
  issues?: string
}

function check(c: HelpCase): { pass: boolean; detail?: string } {
  const r = run([...c.args])
  const combined = r.stdout + r.stderr

  if (combined.includes("e=undefined is not an object")) {
    return { pass: false, detail: "TUI e.zod error in output" }
  }

  const firstLine = combined.split("\n").find(l => l.trim()) ?? ""
  if (!firstLine.includes(c.expectHeader)) {
    return { pass: false, detail: `header: expected "${c.expectHeader}", got "${firstLine.trim()}"` }
  }

  for (const cmd of c.expectCommands ?? []) {
    if (!combined.includes(cmd)) {
      return { pass: false, detail: `missing subcommand "${cmd}" in help output` }
    }
  }

  for (const opt of c.expectOptions ?? []) {
    if (!combined.includes(opt)) {
      return { pass: false, detail: `missing option/arg "${opt}" in help output` }
    }
  }

  for (const forbidden of c.forbid ?? []) {
    if (combined.includes(forbidden)) {
      return { pass: false, detail: `forbidden text "${forbidden}" in help output` }
    }
  }

  return { pass: true }
}

export function runHelpCases(cases: HelpCase[]): void {
  console.log(`\nRunning ${cases.length} --help tests (binary: ${BINARY})...\n`)
  let pass = 0, fail = 0
  const issues: string[] = []

  for (const c of cases) {
    const label = `cz-cli ${c.args.join(" ")}`.trim()
    const r = check(c)
    if (r.pass) {
      pass++
      console.log(`  ${PASS} ${label}`)
    } else {
      fail++
      console.log(`  ${FAIL} ${label}\n    → ${r.detail}`)
      if (c.issues) issues.push(`  ⚠ ${label}: ${c.issues}`)
    }
  }

  if (issues.length > 0) {
    console.log("\nKnown issues:")
    issues.forEach(i => console.log(i))
  }

  console.log(`\n${pass} passed, ${fail} failed (${cases.length} total)\n`)
  process.exitCode = fail > 0 ? 1 : 0
}
