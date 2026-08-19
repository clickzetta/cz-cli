import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { applyClickZettaProfile } from "../src/bootstrap/profile-env"
import { resolveConnectionConfig } from "../src/connection/config"
import { ConnectionEnv, clearApplyUserTrackingForTest } from "../src/connection/env"
import { splitConnectionEnv } from "../src/run-cli"

// Two profiles that differ in every field a leak could carry across: `a` pins a
// non-default schema/vcluster and its own identity, `b` omits both and is the
// shape `auth login` writes (service/instance/workspace only).
const HOME = join(tmpdir(), `cz-provenance-${process.pid}-${Date.now()}`)
const OWNED = ["CZ_PROFILE", "CZ_ENV_DERIVED", "CZ_PAT", "CZ_USERNAME", "CZ_PASSWORD", "CZ_SERVICE", "CZ_PROTOCOL", "CZ_INSTANCE", "CZ_WORKSPACE", "CZ_SCHEMA", "CZ_VCLUSTER", "CZ_ACCOUNTS_URL"]

beforeEach(() => {
  clearApplyUserTrackingForTest()
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

describe("ConnectionEnv.applyUser", () => {
  // A value written here IS the user's own layer — same as a hand-set
  // `CZ_SCHEMA=x` — so it outranks a later profile apply() exactly like
  // "non-auth fields do not survive a profile switch"'s user-supplied-env test
  // above does. What must NOT happen (covered separately below) is a
  // PROFILE-sourced value getting written here and then mistaken for this.
  test("a value written here outranks a later profile apply(), like a hand-set env var", () => {
    ConnectionEnv.applyUser({ schema: "flag_schema" })
    expect(process.env.CZ_SCHEMA).toBe("flag_schema")

    applyClickZettaProfile("a")
    expect(process.env.CZ_SCHEMA).toBe("flag_schema")
    expect(resolveConnectionConfig({}).schema).toBe("flag_schema")
  })

  test("un-marks a name that was previously derived", () => {
    applyClickZettaProfile("a")
    expect(process.env.CZ_ENV_DERIVED?.split(",")).toContain("CZ_SCHEMA")

    ConnectionEnv.applyUser({ schema: "flag_schema" })
    expect(process.env.CZ_ENV_DERIVED?.split(",") ?? []).not.toContain("CZ_SCHEMA")
    expect(ConnectionEnv.read().user.schema).toBe("flag_schema")
  })

  test("writing a pat clears any username/password this layer holds, and vice versa", () => {
    ConnectionEnv.applyUser({ username: "alice", password: "secret" })
    expect(process.env.CZ_USERNAME).toBe("alice")

    ConnectionEnv.applyUser({ pat: "the-pat" })
    expect(process.env.CZ_PAT).toBe("the-pat")
    expect(process.env.CZ_USERNAME).toBeUndefined()
    expect(process.env.CZ_PASSWORD).toBeUndefined()

    ConnectionEnv.applyUser({ username: "bob", password: "hunter2" })
    expect(process.env.CZ_PAT).toBeUndefined()
    expect(process.env.CZ_USERNAME).toBe("bob")
  })
})

describe("run-cli's applyAgentConnectionEnv (via runCli's connection flags)", () => {
  // Regression for the credential-provenance bug: `--profile a` alone (no
  // credential flag) must expand ENTIRELY as derived, so a later per-profile
  // apply() for a DIFFERENT profile can still replace it. Exercised through
  // resolveConnectionConfig + the same ConnectionEnv calls run-cli.ts makes,
  // since applyAgentConnectionEnv itself is not exported.
  test("a --profile-only resolution is NOT written through applyUser", () => {
    // Exercises run-cli.ts's actual exported split, not a hand-rolled copy of
    // it — the specific regression this guards against (writing `resolved`
    // wholesale through applyUser) would not be caught by re-implementing the
    // split by hand.
    const overrides = { profile: "a" }
    const resolved = resolveConnectionConfig(overrides)
    expect(resolved.schema).toBe("sales") // profile a's own field, not a flag

    const { userFields, derivedFields } = splitConnectionEnv(overrides, resolved)
    expect(userFields.schema).toBeUndefined() // no --schema flag on this invocation
    expect(derivedFields.schema).toBe("sales")

    ConnectionEnv.applyUser(userFields)
    expect(process.env.CZ_SCHEMA).toBeUndefined() // nothing written as user's

    ConnectionEnv.apply(derivedFields, overrides.profile)
    expect(process.env.CZ_SCHEMA).toBe("sales")
    expect(process.env.CZ_ENV_DERIVED?.split(",")).toContain("CZ_SCHEMA")

    // A later switch to profile b (mcp.ts's per-call applyClickZettaProfile)
    // must actually take effect, not be blocked by a stale user-owned marker.
    applyClickZettaProfile("b")
    expect(resolveConnectionConfig({}).schema).toBe("public")
  })
})

describe("run-cli's splitConnectionEnv", () => {
  test("a flag value is split into userFields, unaffected by what the profile also carries", () => {
    const overrides = { profile: "a", schema: "flag_schema" }
    const resolved = resolveConnectionConfig(overrides) // flag wins inside resolveConnectionConfig too
    expect(resolved.schema).toBe("flag_schema")

    const { userFields, derivedFields } = splitConnectionEnv(overrides, resolved)
    expect(userFields.schema).toBe("flag_schema")
    expect(derivedFields.schema).toBeUndefined()
  })

  test("credentialIsFlag reads overrides, not resolved: a lone --username filled out by the profile's password stays derived", () => {
    const overrides = { profile: "a", username: "alice" } // no --password flag
    const resolved = { username: "alice", password: "profile-secret" }

    const { userFields, derivedFields } = splitConnectionEnv(overrides, resolved)
    expect(userFields.username).toBeUndefined()
    expect(userFields.password).toBeUndefined()
    expect(derivedFields.username).toBe("alice")
    expect(derivedFields.password).toBe("profile-secret")
  })

  // Regression: overrides naming a flag credential is not proof that credential
  // WON. pickCredential's tier order is flag pat > env pat > profile pat > flag
  // username/password, so `--username u --password p` against a profile that
  // also stores a pat resolves to the PROFILE's pat — resolved.pat, not the flag
  // pair. Checking presence on `overrides` alone (an earlier version of this
  // split did exactly that) would promote the profile's pat into userFields,
  // mislabelling it as the user's and making it permanently un-clearable by a
  // later per-profile apply() for a DIFFERENT profile — the same failure this
  // whole refactor exists to fix, just reached through a different field.
  test("a flag username/password pair that LOSES to a profile pat does not promote the profile's pat to userFields", () => {
    const overrides = { profile: "a", username: "alice", password: "secret" }
    const resolved = { pat: "profile-a-pat", username: "", password: "" } // profile pat won

    const { userFields, derivedFields } = splitConnectionEnv(overrides, resolved)
    expect(userFields.pat).toBeUndefined()
    expect(userFields.username).toBeUndefined()
    expect(userFields.password).toBeUndefined()
    expect(derivedFields.pat).toBe("profile-a-pat")
  })


  test("a flag pat and a flag username+password pair both count as fully the user's", () => {
    const patOverrides = { pat: "the-pat" }
    const { userFields: patUser } = splitConnectionEnv(patOverrides, { pat: "the-pat" })
    expect(patUser.pat).toBe("the-pat")

    const pairOverrides = { username: "alice", password: "secret" }
    const { userFields: pairUser } = splitConnectionEnv(pairOverrides, { username: "alice", password: "secret" })
    expect(pairUser.username).toBe("alice")
    expect(pairUser.password).toBe("secret")
  })

  test("non-auth keys not present on overrides always land in derivedFields, never userFields", () => {
    const overrides = { profile: "a", instance: "flag-inst" } // only instance is a flag
    const resolved = { instance: "flag-inst", service: "profile-service", workspace: "profile-ws" }

    const { userFields, derivedFields } = splitConnectionEnv(overrides, resolved)
    expect(userFields.instance).toBe("flag-inst")
    expect(userFields.service).toBeUndefined()
    expect(userFields.workspace).toBeUndefined()
    expect(derivedFields.instance).toBeUndefined()
    expect(derivedFields.service).toBe("profile-service")
    expect(derivedFields.workspace).toBe("profile-ws")
  })
})
