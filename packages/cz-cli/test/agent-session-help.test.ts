import { describe, expect, test } from "bun:test"
import { spawnSync } from "child_process"

function run(args: string[]) {
  const result = spawnSync("bun", ["./src/main.ts", ...args], {
    cwd: import.meta.dir + "/..",
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  }
}

describe("agent session status help", () => {
  test("--wait help explains the soft timeout behavior", () => {
    const result = run(["agent", "session", "status", "--help"])
    const help = result.stdout.replace(/\s+/g, " ")
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe("")
    expect(help).toContain("returns timeout after long periods with no new progress")
    expect(help).toContain("Block, stream progress as NDJSON")
    expect(help).toContain("exit on idle or timeout")
  })

  test("--format json is explicitly advertised", () => {
    const result = run(["agent", "session", "status", "--help"])
    const help = result.stdout.replace(/\s+/g, " ")
    expect(result.exitCode).toBe(0)
    expect(help).toContain("--format")
    expect(help).toContain("json")
  })
})
