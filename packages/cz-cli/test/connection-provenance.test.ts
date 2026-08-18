import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { applyClickZettaProfile } from "../src/bootstrap/profile-env"
import { resolveConnectionConfig } from "../src/connection/config"
import { ConnectionEnv } from "../src/connection/env"

// Two profiles that differ in every field a leak could carry across: `a` pins a
// non-default schema/vcluster and its own identity, `b` omits both and is the
// shape `auth login` writes (service/instance/workspace only).
const HOME = join(tmpdir(), `cz-provenance-${process.pid}-${Date.now()}`)
const OWNED = ["CZ_PROFILE", "CZ_ENV_DERIVED", "CZ_PAT", "CZ_USERNAME", "CZ_PASSWORD", "CZ_SERVICE", "CZ_PROTOCOL", "CZ_INSTANCE", "CZ_WORKSPACE", "CZ_SCHEMA", "CZ_VCLUSTER", "CZ_ACCOUNTS_URL"]

beforeEach(() => {
  mkdirSync(join(HOME, ".clickzetta"), { recursive: true })
  writeFileSync(
    join(HOME, ".clickzetta", "profiles.toml"),
    [
      `default_profile = "b"`,
      ``,
      `[profiles.a]`,
      `service = "a.example.com"`,
      `instance = "inst-a"`,
      `workspace = "ws_a"`,
      `schema = "sales"`,
      `vcluster = "big_vc"`,
      `username = "user_a"`,
      `password = "pw_a"`,
      ``,
      `[profiles.b]`,
      `service = "b.example.com"`,
      `instance = "inst-b"`,
      `workspace = "ws_b"`,
      `username = "user_b"`,
      `password = "pw_b"`,
      ``,
    ].join("\n"),
    "utf-8",
  )
  process.env.CLICKZETTA_TEST_HOME = HOME
})

afterEach(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  OWNED.forEach((key) => delete process.env[key])
  rmSync(HOME, { recursive: true, force: true })
})

describe("credentials are selected as a group, by provenance", () => {
  // The reported failure: `cz-cli status --profile <b>` inside `cz-cli agent`
  // answered "Login failed: 没有这样的用户" while the same command in a clean
  // shell connected. The agent had expanded ITS profile into CZ_USERNAME/
  // CZ_PASSWORD, the child inherited them, and the env tier outranked the
  // profile — so b's instance was tried with a's username.
  test("a credential we injected loses to the profile's own", () => {
    applyClickZettaProfile("a")
    expect(process.env.CZ_USERNAME).toBe("user_a")

    const config = resolveConnectionConfig({ profile: "b" })
    expect(config.username).toBe("user_b")
    expect(config.password).toBe("pw_b")
    expect(config.instance).toBe("inst-b")
  })

  // The override layer is unchanged: a credential the USER exported still wins,
  // which is what `CZ_PAT=… cz-cli sql` relies on.
  test("a credential the user exported still outranks the profile", () => {
    process.env.CZ_USERNAME = "user_env"
    process.env.CZ_PASSWORD = "pw_env"

    const config = resolveConnectionConfig({ profile: "b" })
    expect(config.username).toBe("user_env")
    expect(config.password).toBe("pw_env")
  })

  // Half from one source and half from another authenticates as nobody.
  test("the winning tier supplies both halves", () => {
    applyClickZettaProfile("a")
    process.env.CZ_PASSWORD = "pw_env"
    delete process.env.CZ_ENV_DERIVED // pretend only the password is the user's

    const config = resolveConnectionConfig({ profile: "b" })
    expect([config.username, config.password]).not.toEqual(["user_b", "pw_env"])
  })
})

describe("non-auth fields do not survive a profile switch", () => {
  // A profile that omits schema/vcluster must land on the defaults, not inherit
  // the previous profile's — the env layer used to outrank the profile that had
  // just been selected.
  test("switching to a profile that omits schema/vcluster returns to the defaults", () => {
    applyClickZettaProfile("a")
    expect(resolveConnectionConfig({}).schema).toBe("sales")

    applyClickZettaProfile("b")
    const config = resolveConnectionConfig({})
    expect(config.schema).toBe("public")
    expect(config.vcluster).toBe("default")
    expect(config.instance).toBe("inst-b")
    expect(process.env.CZ_SCHEMA).toBeUndefined()
    expect(process.env.CZ_VCLUSTER).toBeUndefined()
  })

  test("a user-supplied CZ_SCHEMA survives and still outranks the profile", () => {
    process.env.CZ_SCHEMA = "user_schema"
    applyClickZettaProfile("a")

    expect(process.env.CZ_SCHEMA).toBe("user_schema")
    expect(resolveConnectionConfig({}).schema).toBe("user_schema")
  })
})

describe("childEnv", () => {
  test("carries the derived layer, its marker and the pinned profile", () => {
    applyClickZettaProfile("a")
    const env = ConnectionEnv.childEnv()

    expect(env.CZ_PROFILE).toBe("a")
    expect(env.CZ_INSTANCE).toBe("inst-a")
    expect(env.CZ_ENV_DERIVED?.split(",")).toContain("CZ_USERNAME")
  })

  // The user's own variables reach the child by ordinary inheritance; repeating
  // them here would relabel them as ours and demote them below the profile.
  test("does not relabel the user's variables as derived", () => {
    process.env.CZ_SCHEMA = "user_schema"
    applyClickZettaProfile("a")

    expect(ConnectionEnv.childEnv().CZ_ENV_DERIVED?.split(",") ?? []).not.toContain("CZ_SCHEMA")
  })
})
