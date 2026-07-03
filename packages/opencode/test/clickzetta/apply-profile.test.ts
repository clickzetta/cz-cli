import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { applyClickZettaProfile } from "../../src/cli/cmd/clickzetta-profile"

const HOME = join(tmpdir(), `cz-profile-test-${process.pid}-${Date.now()}`)
const CZ_ENV = [
  "CZ_PROFILE",
  "CZ_PAT",
  "CZ_USERNAME",
  "CZ_PASSWORD",
  "CZ_SERVICE",
  "CZ_PROTOCOL",
  "CZ_INSTANCE",
  "CZ_WORKSPACE",
  "CZ_SCHEMA",
  "CZ_VCLUSTER",
]

beforeEach(() => {
  mkdirSync(join(HOME, ".clickzetta"), { recursive: true })
  writeFileSync(
    join(HOME, ".clickzetta", "profiles.toml"),
    [
      `[profiles.prod]`,
      `pat = "pat-123"`,
      `service = "clickzetta"`,
      `instance = "inst-1"`,
      `workspace = "ws-1"`,
      ``,
    ].join("\n"),
    "utf-8",
  )
  process.env.CLICKZETTA_TEST_HOME = HOME
})

afterEach(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  for (const k of CZ_ENV) delete process.env[k]
  rmSync(HOME, { recursive: true, force: true })
})

describe("applyClickZettaProfile", () => {
  test("exports CZ_* env from the named profile", () => {
    applyClickZettaProfile("prod")
    expect(process.env.CZ_PROFILE).toBe("prod")
    expect(process.env.CZ_PAT).toBe("pat-123")
    expect(process.env.CZ_SERVICE).toBe("clickzetta")
    expect(process.env.CZ_INSTANCE).toBe("inst-1")
    expect(process.env.CZ_WORKSPACE).toBe("ws-1")
  })

  test("no profile arg → no-op (no CZ_PROFILE set)", () => {
    applyClickZettaProfile(undefined)
    expect(process.env.CZ_PROFILE).toBeUndefined()
  })

  test("unknown profile → sets CZ_PROFILE but no connection env", () => {
    applyClickZettaProfile("does-not-exist")
    expect(process.env.CZ_PROFILE).toBe("does-not-exist")
    expect(process.env.CZ_PAT).toBeUndefined()
  })
})
