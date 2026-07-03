import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const runtime = process.execPath
const entry = ["./src/main.ts"]

function withHome() {
  const home = join(tmpdir(), `cz-autoupdate-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  return {
    home,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  }
}

function run(args: string[], home: string) {
  const result = spawnSync(runtime, [...entry, ...args], {
    cwd: import.meta.dir.replace(/\/test$/, ""),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home },
    timeout: 30_000,
  })
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  }
}

describe("autoupdate command", () => {
  test("sets and shows autoupdate", () => {
    const { home, cleanup } = withHome()
    try {
      const set = run(["autoupdate", "false", "--format", "json"], home)
      expect(set.status).toBe(0)

      const file = join(home, ".local", "state", "clickzetta", "update-check.json")
      expect(existsSync(file)).toBe(true)
      expect(JSON.parse(readFileSync(file, "utf-8")).autoupdate).toBe(false)

      const get = run(["autoupdate", "--format", "json"], home)
      expect(get.status).toBe(0)
      expect(JSON.parse(get.stdout).data).toMatchObject({
        value: false,
        defaulted: false,
      })
    } finally {
      cleanup()
    }
  })

  test("defaults autoupdate to true when unset", () => {
    const { home, cleanup } = withHome()
    try {
      const get = run(["autoupdate", "--format", "json"], home)
      expect(get.status).toBe(0)
      expect(JSON.parse(get.stdout).data).toMatchObject({
        value: true,
        defaulted: true,
      })
    } finally {
      cleanup()
    }
  })
})
