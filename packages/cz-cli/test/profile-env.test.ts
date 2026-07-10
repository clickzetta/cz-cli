import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { applyClickZettaProfile } from "../src/bootstrap/profile-env"

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
      `default_profile = "prod"`,
      ``,
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
  CZ_ENV.forEach((key) => delete process.env[key])
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

  test("no profile arg → resolves default_profile", () => {
    applyClickZettaProfile(undefined)
    expect(process.env.CZ_PROFILE).toBe("prod")
    expect(process.env.CZ_PAT).toBe("pat-123")
  })

  test("unknown profile → sets CZ_PROFILE but no connection env", () => {
    applyClickZettaProfile("does-not-exist")
    expect(process.env.CZ_PROFILE).toBe("does-not-exist")
    expect(process.env.CZ_PAT).toBeUndefined()
  })
})
