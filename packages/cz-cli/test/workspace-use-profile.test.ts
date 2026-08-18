import { describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { requireTestHome } from "./support/cz-fixtures.js"

// Regression test: `workspace use --persist` must select the profile through
// Profile.current() (CZ_PROFILE, falling back to profiles.toml's
// default_profile), the single semantic source for "which profile is active" —
// not a hand-rolled formula that can drift from it. The bug this guards against:
// the old fallback here was `getDefaultProfileName() ?? Object.keys(profiles)[0]`,
// which skipped CZ_PROFILE entirely, so a `-p other` invocation could persist
// workspace/schema into a DIFFERENT profile than the one actually selected.
const { execute } = await import("../src/execute.ts")

function writeTwoProfiles() {
  writeFileSync(
    join(requireTestHome(), ".clickzetta", "profiles.toml"),
    [
      'default_profile = "prod_0"',
      "",
      "[profiles.prod_0]",
      'pat = "pat-prod"',
      'service = "cn-shanghai-alicloud.api.clickzetta.com"',
      'instance = "inst-prod"',
      'workspace = "old_ws"',
      "",
      "[profiles.dev_0]",
      'pat = "pat-dev"',
      'service = "dev-api.clickzetta.com"',
      'instance = "inst-dev"',
      'workspace = "old_ws"',
      "",
    ].join("\n"),
  )
}

function readProfilesToml(): string {
  return readFileSync(join(requireTestHome(), ".clickzetta", "profiles.toml"), "utf-8")
}

describe("workspace use --persist profile selection", () => {
  test("honors CZ_PROFILE over default_profile", async () => {
    writeTwoProfiles()
    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "dev_0"
    try {
      const result = await execute("workspace use new_ws --persist --format json")
      expect(result.exitCode).toBe(0)
      const toml = readProfilesToml()
      expect(toml).toMatch(/\[profiles\.dev_0\][^[]*workspace = "new_ws"/)
      expect(toml).toMatch(/\[profiles\.prod_0\][^[]*workspace = "old_ws"/)
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  test("falls back to default_profile when CZ_PROFILE is unset", async () => {
    writeTwoProfiles()
    const previous = process.env.CZ_PROFILE
    delete process.env.CZ_PROFILE
    try {
      const result = await execute("workspace use new_ws --persist --format json")
      expect(result.exitCode).toBe(0)
      const toml = readProfilesToml()
      expect(toml).toMatch(/\[profiles\.prod_0\][^[]*workspace = "new_ws"/)
      expect(toml).toMatch(/\[profiles\.dev_0\][^[]*workspace = "old_ws"/)
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  // No default_profile and no CZ_PROFILE: Profile.current() returns undefined,
  // and this command must report PROFILE_NOT_FOUND rather than silently guessing
  // the first profile in the file and writing into it.
  test("reports PROFILE_NOT_FOUND rather than guessing when nothing is configured", async () => {
    writeFileSync(
      join(requireTestHome(), ".clickzetta", "profiles.toml"),
      ["[profiles.prod_0]", 'pat = "pat-prod"', 'workspace = "old_ws"'].join("\n"),
    )
    const previous = process.env.CZ_PROFILE
    delete process.env.CZ_PROFILE
    try {
      const result = await execute("workspace use new_ws --persist --format json")
      const parsed = JSON.parse(result.output.trim())
      expect(parsed.error?.code).toBe("PROFILE_NOT_FOUND")
      const toml = readProfilesToml()
      expect(toml).toMatch(/workspace = "old_ws"/)
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })
})
