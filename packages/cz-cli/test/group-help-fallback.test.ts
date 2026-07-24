/**
 * Locks the "bare command group renders help, not an error" behavior
 * (openspec/specs/cli-command-routing/spec.md — "分组命令缺子命令时返回帮助而非报错").
 *
 * A group command (one that only carries subcommands, e.g. `cz-cli ai-gateway`)
 * invoked WITHOUT a subcommand must print that group's help and exit 0, on a
 * machine with no configured profile/LLM — never USAGE_ERROR or NO_PROFILE.
 * Unknown subcommands and missing leaf positionals still error (exit 2).
 *
 * Runs the TypeScript source entry (never a stale compiled binary) under a
 * throwaway HOME so profile-gated groups can't leak a developer profile.
 * Run: bun test test/group-help-fallback.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execute } from "../src/execute.ts"

const RUNTIME = process.execPath // bun
const ENTRY = ["./src/main.ts"]

let fakeHome: string

beforeAll(() => {
  fakeHome = join(tmpdir(), `cz-grouphelp-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(fakeHome, ".clickzetta"), { recursive: true })
})

afterAll(() => {
  if (fakeHome) rmSync(fakeHome, { recursive: true, force: true })
})

interface Result { stdout: string; stderr: string; exitCode: number }

function run(args: string[]): Result {
  const r = spawnSync(RUNTIME, [...ENTRY, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOME: fakeHome, CLICKZETTA_TEST_HOME: fakeHome },
    timeout: 40_000,
  })
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 }
}

// Command groups that funnel through commandGroup() and are reachable on the
// plain cz-cli path (no agent-runtime delegation). Not exhaustive of the deep
// analytics-agent tree, but covers top-level, one- and two-level nesting, and
// both raw-demandCommand conversions (task cdc/flow). Each, invoked bare, must
// print its own help header and exit 0.
const BARE_GROUPS: string[][] = [
  ["ai-gateway"],
  ["ai-gateway", "key"],
  ["ai-gateway", "model"],
  ["task"],
  ["task", "cdc"],
  ["task", "flow"],
  ["task", "integration"],
  ["schema"],
  ["workspace"],
  ["workspace-param"],
  ["profile"],
  ["job"],
  ["runs"],
  ["attempts"],
  ["datasource"],
  ["analytics-agent"],
  ["analytics-agent", "domain"],
  ["analytics-agent", "datasource"],
  ["analytics-agent", "knowledge"],
  ["analytics-agent", "table"],
  ["analytics-agent", "column"],
  ["analytics-agent", "metric"],
  ["analytics-agent", "service"],
  ["analytics-agent", "session"],
  ["analytics-agent", "answer-builder"],
  ["table"],
]

describe("bare command group renders help (exit 0), not USAGE_ERROR", () => {
  for (const args of BARE_GROUPS) {
    const label = args.join(" ")
    test(`cz-cli ${label} prints its OWN help header + Commands and exits 0`, () => {
      const r = run(args)
      expect(r.exitCode).toBe(0)
      // The FIRST line must be exactly this group's header — not a prefix. A
      // loose startsWith() would also accept a mistakenly-rendered child header
      // ("cz-cli task cdc" starts with "cz-cli task"); requiring the exact line
      // proves the group rendered its OWN help.
      const firstLine = r.stdout.split("\n").find((l) => l.trim().length > 0)?.trim()
      expect(firstLine).toBe(`cz-cli ${label}`)
      // A group help always lists its subcommands under a Commands: section.
      expect(r.stdout).toContain("Commands:")
      expect(r.stdout).not.toContain("USAGE_ERROR")
      expect(r.stdout).not.toContain("NO_PROFILE")
    })
  }

  test("cz-cli ai-gateway help actually lists its subcommands (key, model)", () => {
    // Spec scenario "顶层分组命令缺子命令返回帮助" requires the subcommands to appear.
    const r = run(["ai-gateway"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("key")
    expect(r.stdout).toContain("model")
  })

  test("cz-cli analytics-agent metric help explains simple vs complex metric", () => {
    const r = run(["analytics-agent", "metric"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("simple_metric")
    expect(r.stdout).toContain("answer-builder")
    expect(r.stdout).toContain("targetCounts")
  })

  test("cz-cli analytics-agent answer-builder help explains complex vs simple metric", () => {
    const r = run(["analytics-agent", "answer-builder"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("complex_metric")
    expect(r.stdout).toContain("simple_metric")
    expect(r.stdout).toContain("targetCounts")
  })

  test("cz-cli analytics-agent table help lists the columns alias", () => {
    const r = run(["analytics-agent", "table"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("columns")
    expect(r.stdout).toContain("semantics")
  })

  test("cz-cli analytics-agent metric create --help shows usage examples", () => {
    const r = run(["analytics-agent", "metric", "create", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("Examples:")
    expect(r.stdout).toContain("catalog.schema.table")
    expect(r.stdout).toContain("virtual column")
  })

  test("cz-cli analytics-agent answer-builder create --help shows a usage example", () => {
    const r = run(["analytics-agent", "answer-builder", "create", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("Examples:")
    expect(r.stdout).toContain("validate")
  })

  test("cz-cli analytics-agent answer-builder create --help documents the DSL syntax", () => {
    const r = run(["analytics-agent", "answer-builder", "create", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("chartParams")
    expect(r.stdout).toContain("outputColumns")
    // metricName is required + domain-unique — the key learning
    expect(r.stdout).toContain("metricName")
    expect(r.stdout).toContain("UNIQUE within the domain")
    // placeholder rule
    expect(r.stdout).toContain("matching chartParams entry")
  })

  test("cz-cli analytics-agent answer-builder validate --help documents the DSL syntax", () => {
    const r = run(["analytics-agent", "answer-builder", "validate", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("chartParams")
    expect(r.stdout).toContain("metricName")
  })
})

describe("nested bare group shows its OWN help, not the parent's", () => {
  test("cz-cli ai-gateway key lists key subcommands", () => {
    const r = run(["ai-gateway", "key"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trimStart().startsWith("cz-cli ai-gateway key")).toBe(true)
    // A key-specific subcommand must appear (proves it isn't the parent help).
    expect(r.stdout).toContain("set-quota")
  })
})

describe("profile-gated bare group does not require a profile", () => {
  // `task` is in PROFILE_REQUIRED_COMMANDS; a bare invocation must still show
  // help rather than being masked by NO_PROFILE.
  test("cz-cli task shows help without NO_PROFILE", () => {
    const r = run(["task"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trimStart().startsWith("cz-cli task")).toBe(true)
    expect(r.stdout).not.toContain("NO_PROFILE")
  })
})

describe("genuine errors still surface (not masked by help fallback)", () => {
  test("unknown subcommand -> USAGE_ERROR exit 2", () => {
    const r = run(["ai-gateway", "bogus"])
    expect(r.exitCode).toBe(2)
    expect(r.stdout).toContain("USAGE_ERROR")
  })

  test("unknown nested subcommand -> USAGE_ERROR exit 2", () => {
    const r = run(["task", "flow", "bogus"])
    expect(r.exitCode).toBe(2)
    expect(r.stdout).toContain("USAGE_ERROR")
  })

  test("leaf command missing required positional -> USAGE_ERROR exit 2", () => {
    const r = run(["ai-gateway", "key", "get"])
    expect(r.exitCode).toBe(2)
    expect(r.stdout).toContain("USAGE_ERROR")
  })
})

describe("programmatic execute() boundary renders bare-group help", () => {
  // The in-process execute() path (used by the TUI / MCP server) has its own
  // sentinel catch, distinct from the spawned-binary run-cli path: the fail
  // handler's showHelp() writes into a hijacked stdout captured in `output`.
  test("execute('ai-gateway') returns help text and exit 0", async () => {
    const { exitCode, output } = await execute("ai-gateway")
    expect(exitCode).toBe(0)
    expect(output).toContain("cz-cli ai-gateway")
    expect(output).toContain("Commands:")
    expect(output).not.toContain("USAGE_ERROR")
  })

  test("execute('ai-gateway bogus') still returns USAGE_ERROR exit 2", async () => {
    const { exitCode, output } = await execute("ai-gateway bogus")
    expect(exitCode).toBe(2)
    expect(output).toContain("USAGE_ERROR")
  })
})

describe("agent runtime boundary renders bare-group help", () => {
  // `agent llm` is delegated to the opencode agent runtime (a separate parse
  // boundary that also catches the sentinel). A bare invocation must render
  // help and exit 0 without requiring a configured LLM/profile.
  test("cz-cli agent llm (bare) shows help and exits 0", () => {
    const r = run(["agent", "llm"])
    expect(r.exitCode).toBe(0)
    const firstLine = r.stdout.split("\n").find((l) => l.trim().length > 0)?.trim()
    expect(firstLine).toBe("cz-cli agent llm")
    expect(r.stdout).not.toContain("USAGE_ERROR")
  })

  test("cz-cli agent llm bogus (unknown) still errors", () => {
    const r = run(["agent", "llm", "bogus"])
    expect(r.exitCode).not.toBe(0)
    expect(r.stdout).toContain("USAGE_ERROR")
  })
})
