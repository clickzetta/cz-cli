import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function homeWithProfiles(): string {
  const home = mkdtempSync(join(tmpdir(), "cz-auth-profile-"))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  writeFileSync(
    join(home, ".clickzetta", "profiles.toml"),
    [
      'default_profile = "first_0"',
      "",
      "[oauth.first]",
      "expire_time_ms = 3600000",
      "obtained_at = 1000000000000",
      "",
      "[oauth.second]",
      "expire_time_ms = 3600000",
      "obtained_at = 1000000000000",
      "",
      "[profiles.first_0]",
      'oauth = "first"',
      "",
      "[profiles.second_0]",
      'oauth = "second"',
      "",
    ].join("\n"),
  )
  return home
}

/** CZ_PROFILE selects which profile `auth list`/`status` report on, so an ambient
 *  one in the runner's environment would steer these assertions. */
function envFor(home: string, overrides: Record<string, string> = {}): Record<string, string> {
  const env = { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home, NO_COLOR: "1" } as Record<string, string>
  delete env.CZ_PROFILE
  return { ...env, ...overrides }
}

function run(args: string[], home: string, extraEnv: Record<string, string> = {}): { stdout: string; status: number | null } {
  const result = spawnSync("bun", ["./src/main.ts", ...args], {
    cwd: import.meta.dir + "/..",
    encoding: "utf-8",
    env: envFor(home, extraEnv),
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { stdout: (result.stdout ?? "").trim(), status: result.status }
}

describe("auth profile override reporting", () => {
  test("auth status uses the explicitly selected profile", () => {
    const home = homeWithProfiles()
    const result = run(["auth", "status", "--profile", "second_0", "--format", "json"], home)
    expect(result.status).toBe(0)
    const payload = JSON.parse(result.stdout) as { data: { active_profile: string; session: string } }
    expect(payload.data.active_profile).toBe("second_0")
    expect(payload.data.session).toBe("second")
  })

  test("CZ_PROFILE selects the reported profile when no --profile is passed", () => {
    const home = homeWithProfiles()
    const result = run(["auth", "status", "--format", "json"], home, { CZ_PROFILE: "second_0" })
    expect(result.status).toBe(0)
    const payload = JSON.parse(result.stdout) as { data: { active_profile: string; session: string } }
    // Without CZ_PROFILE this would report default_profile (first_0). The agent
    // runtime pins CZ_PROFILE for the whole process, so `auth status` has to
    // follow it rather than the file's default.
    expect(payload.data.active_profile).toBe("second_0")
    expect(payload.data.session).toBe("second")
  })

  test("a stale CZ_PROFILE naming a deleted profile is reported by name", () => {
    const home = homeWithProfiles()
    const result = run(["auth", "status", "--format", "json"], home, { CZ_PROFILE: "deleted_0" })
    expect(result.status).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      data: { logged_in: boolean; active_profile: string | null; profile_missing?: boolean }
    }
    // `auth` is exempt from the PROFILE_REQUIRED_COMMANDS gate, so an exported
    // name that no longer exists reaches here unvalidated. Saying "not logged in"
    // without naming it left a logged-in user with nothing to act on.
    expect(payload.data.logged_in).toBe(false)
    expect(payload.data.active_profile).toBe("deleted_0")
    expect(payload.data.profile_missing).toBe(true)
  })

  test("auth list marks the selected profile's session active", () => {
    const home = homeWithProfiles()
    const result = run(["auth", "list", "--profile", "second_0", "--format", "json"], home)
    expect(result.status).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      data: { active_profile: string; active_session: string; sessions: Array<{ session: string; active: boolean }> }
    }
    expect(payload.data.active_profile).toBe("second_0")
    expect(payload.data.active_session).toBe("second")
    expect(payload.data.sessions.find((session) => session.session === "second")?.active).toBe(true)
  })
})
