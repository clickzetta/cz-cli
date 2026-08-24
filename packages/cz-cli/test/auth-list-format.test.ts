import { expect, test, describe } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * `auth list` end to end, one run per output format.
 *
 * It used to answer `--format text` with the whole session array JSON-encoded into
 * the first cell of a single row. The payload is unchanged — `data.sessions` plus the
 * active-session context — and now declares `rowsKey: "sessions"`, so only the
 * row-oriented formats change. Reshaping the payload instead would have broken
 * `.data.sessions` and `--field sessions` for existing callers.
 */

function run(args: string[], home: string) {
  const result = spawnSync("bun", ["./src/main.ts", ...args], {
    cwd: import.meta.dir + "/..",
    encoding: "utf-8",
    env: { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { stdout: (result.stdout ?? "").trim(), exitCode: result.status ?? 1 }
}

function homeWith(toml: string): string {
  const home = mkdtempSync(join(tmpdir(), "cz-auth-list-"))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  writeFileSync(join(home, ".clickzetta", "profiles.toml"), toml)
  return home
}

const TWO_SESSIONS = `default_profile = "uat_0"

[oauth.uat]
expire_time_ms = 3600000
obtained_at = 1000000000000

[oauth.saas]
expire_time_ms = 3600000
obtained_at = 1000000000000

[profiles.uat_0]
oauth = "uat"

[profiles.saas_0]
oauth = "saas"

[profiles.saas_1]
oauth = "saas"
`

describe("auth list respects every output format", () => {
  const home = homeWith(TWO_SESSIONS)

  test("text prints one tab-separated row per session", () => {
    const { stdout, exitCode } = run(["auth", "list", "--format", "text"], home)
    expect(exitCode).toBe(0)
    const lines = stdout.split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[0].startsWith("uat\ttrue\t")).toBe(true)
    expect(lines[1].startsWith("saas\tfalse\t")).toBe(true)
    // The regression: the session list arriving as one JSON cell.
    expect(stdout).not.toContain('[{"session"')
  })

  test("table prints a header and one row per session", () => {
    const { stdout } = run(["auth", "list", "--format", "table"], home)
    const lines = stdout.split("\n")
    expect(lines[0].split("|").map((c) => c.trim())).toEqual([
      "session", "active", "profiles", "profile_count", "expires_in_ms", "expired",
    ])
    expect(lines).toHaveLength(4) // header + separator + 2 sessions
  })

  test("csv prints a header and one row per session", () => {
    const { stdout } = run(["auth", "list", "--format", "csv"], home)
    const lines = stdout.split("\n")
    expect(lines[0]).toBe("session,active,profiles,profile_count,expires_in_ms,expired")
    expect(lines).toHaveLength(3)
  })

  test("jsonl prints one object per session", () => {
    const { stdout } = run(["auth", "list", "--format", "jsonl"], home)
    const lines = stdout.split("\n").map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(lines.map((l) => l.session)).toEqual(["uat", "saas"])
    expect(lines[1].profile_count).toBe(2)
  })

  test("json keeps the shape it has always had", () => {
    const { stdout } = run(["auth", "list", "--format", "json"], home)
    const payload = JSON.parse(stdout) as Record<string, any>
    expect(payload.data.sessions).toHaveLength(2)
    expect(payload.data.active_session).toBe("uat")
    expect(payload.data.active_profile).toBe("uat_0")
    expect(payload.data.sessions[0]).toMatchObject({ session: "uat", active: true, profile_count: 1, expired: true })
    expect(payload.data.sessions[1].profiles).toEqual(["saas_0", "saas_1"])
  })

  test("--field sessions still resolves, as it did before rowsKey", () => {
    const { stdout } = run(["auth", "list", "--field", "sessions"], home)
    expect(stdout.startsWith("[")).toBe(true)
    expect(stdout).toContain('"session":"uat"')
  })

  test("--field reaches the active-session context", () => {
    expect(run(["auth", "list", "--field", "active_session"], home).stdout).toBe("uat")
  })
})

describe("auth list with nothing to list", () => {
  const home = homeWith("[profiles.local]\ninstance = \"x\"\n")

  test("row formats print nothing rather than an envelope", () => {
    for (const format of ["text", "csv", "table", "jsonl"]) {
      expect(run(["auth", "list", "--format", format], home).stdout).toBe("")
    }
  })

  test("json prints an empty list", () => {
    const payload = JSON.parse(run(["auth", "list", "--format", "json"], home).stdout) as Record<string, any>
    expect(payload.data.sessions).toEqual([])
  })
})
