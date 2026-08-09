import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// 真实 CLI 入口:profile list 的默认格式行为只能通过真实二进制/源码入口验证，
// 因为编程接口 execute() 会主动注入 --format，无法反映 format_explicit 的真实判定。
const BINARY = process.env.CZ_CLI_BIN ?? process.execPath
const BINARY_ENTRY = process.env.CZ_CLI_BIN ? [] : [process.env.CZ_CLI_ENTRY ?? "./src/main.ts"]

function runProfileList(args: string[]) {
  const home = mkdtempSync(path.join(tmpdir(), "cz-cli-profile-list-fmt-"))
  mkdirSync(path.join(home, ".clickzetta"), { recursive: true })
  writeFileSync(
    path.join(home, ".clickzetta", "profiles.toml"),
    [
      'default_profile = "dev"',
      "",
      "[profiles.dev]",
      'username = "u"',
      'password = "p"',
      'service = "svc.example.com"',
      'instance = "inst"',
      'workspace = "ws"',
      "",
    ].join("\n"),
  )
  const r = spawnSync(BINARY, [...BINARY_ENTRY, "profile", "list", ...args], {
    encoding: "utf-8",
    env: { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home, CZ_NO_UPDATE: "1" },
    timeout: 40_000,
  })
  return { stdout: r.stdout ?? "", exitCode: r.status ?? 1 }
}

describe("profile list default format", () => {
  test("defaults to table when --format is not given", () => {
    const { exitCode, stdout } = runProfileList([])
    expect(exitCode).toBe(0)
    // table 输出是多行、含表头分隔符，而非单行/缩进 JSON
    expect(stdout).toContain("is_default")
    expect(stdout).toContain("---")
    expect(stdout.trim().startsWith("{")).toBe(false)
  })

  test("honors explicit --format json (single-line JSON)", () => {
    const { exitCode, stdout } = runProfileList(["--format", "json"])
    expect(exitCode).toBe(0)
    const line = stdout.trim().split("\n")[0]
    expect(line.startsWith("{")).toBe(true)
    expect(JSON.parse(line).data[0].name).toBe("dev")
  })
})
