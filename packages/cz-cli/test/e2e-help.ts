/**
 * --help output tests for all cz-cli commands and subcommands.
 * Verifies: no error output, correct command name in header, key options present.
 * Run: bun test/e2e-help.ts
 */
import { spawnSync } from "child_process"

const BINARY = process.env.CZ_CLI_BIN ?? "cz-cli"
const PASS = "\x1b[32m✓\x1b[0m"
const FAIL = "\x1b[31m✗\x1b[0m"

interface Result { stdout: string; stderr: string; exitCode: number }

function run(args: string[]): Result {
  const r = spawnSync(BINARY, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  })
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 }
}

interface HelpCase {
  args: string[]
  expectHeader: string       // first line should contain this
  expectOptions?: string[]   // key option strings that must appear
  expectCommands?: string[]  // subcommand names that must appear
  issues?: string            // known issues to note
}

const cases: HelpCase[] = [
  // Top-level
  {
    args: ["--help"],
    expectHeader: "cz-cli",
    expectCommands: ["sql", "schema", "table", "workspace", "status", "profile", "task", "runs", "attempts", "agent", "job", "setup"],
  },
  {
    args: [],
    expectHeader: "cz-cli",
    expectCommands: ["sql", "schema", "table", "workspace", "status", "profile"],
  },

  // sql
  {
    args: ["sql", "--help"],
    expectHeader: "cz-cli sql",
    expectCommands: ["status"],
    expectOptions: ["--sync", "--write", "--limit", "--batch"],
  },
  {
    args: ["sql", "status", "--help"],
    expectHeader: "cz-cli sql status",
    expectOptions: ["job-id"],
  },

  // schema
  {
    args: ["schema", "--help"],
    expectHeader: "cz-cli schema",
    expectCommands: ["list", "describe", "create", "drop"],
  },
  {
    args: ["schema", "list", "--help"],
    expectHeader: "cz-cli schema list",
    expectOptions: ["--like", "--limit"],
  },
  {
    args: ["schema", "describe", "--help"],
    expectHeader: "cz-cli schema describe",
    expectOptions: ["name"],
  },

  // table
  {
    args: ["table", "--help"],
    expectHeader: "cz-cli table",
    expectCommands: ["list", "describe", "preview", "stats", "history", "create", "drop"],
  },
  {
    args: ["table", "list", "--help"],
    expectHeader: "cz-cli table list",
    expectOptions: ["--in", "--like", "--limit"],
  },
  {
    args: ["table", "describe", "--help"],
    expectHeader: "cz-cli table describe",
    expectOptions: ["name"],
  },
  {
    args: ["table", "preview", "--help"],
    expectHeader: "cz-cli table preview",
    expectOptions: ["name", "--limit"],
  },
  {
    args: ["table", "create", "--help"],
    expectHeader: "cz-cli table create",
    expectOptions: ["--from-file"],
  },
  {
    args: ["table", "drop", "--help"],
    expectHeader: "cz-cli table drop",
    expectOptions: ["name"],
  },

  // workspace
  {
    args: ["workspace", "--help"],
    expectHeader: "cz-cli workspace",
    expectCommands: ["list", "current", "use"],
  },
  {
    args: ["workspace", "list", "--help"],
    expectHeader: "cz-cli workspace list",
  },
  {
    args: ["workspace", "current", "--help"],
    expectHeader: "cz-cli workspace current",
  },
  {
    args: ["workspace", "use", "--help"],
    expectHeader: "cz-cli workspace use",
    expectOptions: ["name", "--schema", "--persist"],
  },

  // status
  {
    args: ["status", "--help"],
    expectHeader: "cz-cli status",
    expectOptions: ["--profile"],
  },

  // profile
  {
    args: ["profile", "--help"],
    expectHeader: "cz-cli profile",
    expectCommands: ["list", "detail", "create", "update", "delete", "use"],
  },
  {
    args: ["profile", "list", "--help"],
    expectHeader: "cz-cli profile list",
    expectOptions: ["--show-secret"],
  },
  {
    args: ["profile", "detail", "--help"],
    expectHeader: "cz-cli profile detail",
    expectOptions: ["name"],
  },
  {
    args: ["profile", "create", "--help"],
    expectHeader: "cz-cli profile create",
    expectOptions: ["name", "--pat", "--instance", "--workspace"],
  },
  {
    args: ["profile", "update", "--help"],
    expectHeader: "cz-cli profile update",
    expectOptions: ["name", "key", "value", "pat"],
  },
  {
    args: ["profile", "delete", "--help"],
    expectHeader: "cz-cli profile delete",
    expectOptions: ["name"],
  },
  {
    args: ["profile", "use", "--help"],
    expectHeader: "cz-cli profile use",
    expectOptions: ["name"],
  },

  // job
  {
    args: ["job", "--help"],
    expectHeader: "cz-cli job",
    expectCommands: ["status", "result"],
  },
  {
    args: ["job", "status", "--help"],
    expectHeader: "cz-cli job status",
    expectOptions: ["job-id"],
  },
  {
    args: ["job", "result", "--help"],
    expectHeader: "cz-cli job result",
    expectOptions: ["job-id", "--limit", "--timeout"],
  },

  // runs
  {
    args: ["runs", "--help"],
    expectHeader: "cz-cli runs",
    expectCommands: ["list", "detail", "wait", "logs", "deps", "stop", "refill", "rerun", "stats"],
  },
  {
    args: ["runs", "list", "--help"],
    expectHeader: "cz-cli runs list",
    expectOptions: ["--task", "--status", "--run-type", "--from", "--to"],
  },
  {
    args: ["runs", "wait", "--help"],
    expectHeader: "cz-cli runs wait",
    expectOptions: ["--attempts", "--interval", "--allow-timeout"],
  },
  {
    args: ["runs", "deps", "--help"],
    expectHeader: "cz-cli runs deps",
    expectOptions: ["task", "--parent-level", "--child-level"],
  },
  {
    args: ["runs", "refill", "--help"],
    expectHeader: "cz-cli runs refill",
    expectOptions: ["task", "--from", "--to", "--yes"],
  },

  // attempts
  {
    args: ["attempts", "--help"],
    expectHeader: "cz-cli attempts",
    expectCommands: ["list", "log"],
  },
  {
    args: ["attempts", "list", "--help"],
    expectHeader: "cz-cli attempts list",
    expectOptions: ["--run-id", "--task-id", "--page"],
  },
  {
    args: ["attempts", "log", "--help"],
    expectHeader: "cz-cli attempts log",
    expectOptions: ["--run-id", "--task-id", "--attempt-id"],
  },

  // task
  {
    args: ["task", "--help"],
    expectHeader: "cz-cli task",
    expectCommands: ["list", "create", "content", "save-content", "save-config", "online", "offline", "execute", "delete"],
  },
  {
    args: ["task", "list", "--help"],
    expectHeader: "cz-cli task list",
    expectOptions: ["--like", "--type"],
  },
  {
    args: ["task", "create", "--help"],
    expectHeader: "cz-cli task create",
    expectOptions: ["name", "--type"],
  },
  {
    args: ["task", "execute", "--help"],
    expectHeader: "cz-cli task execute",
    expectOptions: ["task", "--vc", "--content"],
  },

  // agent (top-level description only — agent subcommands go through opencode)
  {
    args: ["agent", "--help"],
    expectHeader: "cz-cli agent",
    expectOptions: ["status", "ask"],
  },

  // setup
  {
    args: ["setup", "--help"],
    expectHeader: "cz-cli setup",
    expectOptions: ["--credential"],
  },
]

function check(c: HelpCase): { pass: boolean; detail?: string } {
  const r = run([...c.args])
  const combined = r.stdout + r.stderr
  const label = c.args.join(" ") || "(no args)"

  // Must not show TUI error
  if (combined.includes("e=undefined is not an object")) {
    return { pass: false, detail: "TUI e.zod error in output" }
  }

  // Header check: first non-empty line should contain expectHeader
  const firstLine = combined.split("\n").find(l => l.trim()) ?? ""
  if (!firstLine.includes(c.expectHeader)) {
    return { pass: false, detail: `header: expected "${c.expectHeader}", got "${firstLine.trim()}"` }
  }

  // Commands check
  for (const cmd of c.expectCommands ?? []) {
    if (!combined.includes(cmd)) {
      return { pass: false, detail: `missing subcommand "${cmd}" in help output` }
    }
  }

  // Options check
  for (const opt of c.expectOptions ?? []) {
    if (!combined.includes(opt)) {
      return { pass: false, detail: `missing option/arg "${opt}" in help output` }
    }
  }

  return { pass: true }
}

async function main() {
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

main()
