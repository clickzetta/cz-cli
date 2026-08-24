import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const previousHome = process.env.HOME
const previousTestHome = process.env.CLICKZETTA_TEST_HOME
const previousProfile = process.env.CZ_PROFILE
const previousPat = process.env.CZ_PAT
const previousUsername = process.env.CZ_USERNAME
const previousPassword = process.env.CZ_PASSWORD
const previousService = process.env.CZ_SERVICE
const previousInstance = process.env.CZ_INSTANCE
const previousWorkspace = process.env.CZ_WORKSPACE
const previousSchema = process.env.CZ_SCHEMA
const previousVcluster = process.env.CZ_VCLUSTER

const home = mkdtempSync(join(tmpdir(), "cz-cli-connection-config-"))
mkdirSync(join(home, ".clickzetta"), { recursive: true })
writeFileSync(
  join(home, ".clickzetta", "profiles.toml"),
  [
    'default_profile = "test"',
    "",
    "[profiles.test]",
    'pat = "test-pat"',
    'service = "cn-shanghai-alicloud.api.clickzetta.com"',
    'instance = "test-instance"',
    'workspace = "qa_test_prj01"',
    'schema = "tianzhu"',
    'vcluster = "DEFAULT"',
    "",
    "[profiles.czcli]",
    'username = "czcli"',
    'password = "secret"',
    'service = "cn-shanghai-alicloud.api.clickzetta.com"',
    'instance = "clickzetta"',
    'workspace = "czcli"',
    'schema = "public"',
    'vcluster = "default"',
    "",
  ].join("\n"),
)

afterAll(async () => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = previousTestHome
  if (previousProfile === undefined) delete process.env.CZ_PROFILE
  else process.env.CZ_PROFILE = previousProfile
  if (previousPat === undefined) delete process.env.CZ_PAT
  else process.env.CZ_PAT = previousPat
  if (previousUsername === undefined) delete process.env.CZ_USERNAME
  else process.env.CZ_USERNAME = previousUsername
  if (previousPassword === undefined) delete process.env.CZ_PASSWORD
  else process.env.CZ_PASSWORD = previousPassword
  if (previousService === undefined) delete process.env.CZ_SERVICE
  else process.env.CZ_SERVICE = previousService
  if (previousInstance === undefined) delete process.env.CZ_INSTANCE
  else process.env.CZ_INSTANCE = previousInstance
  if (previousWorkspace === undefined) delete process.env.CZ_WORKSPACE
  else process.env.CZ_WORKSPACE = previousWorkspace
  if (previousSchema === undefined) delete process.env.CZ_SCHEMA
  else process.env.CZ_SCHEMA = previousSchema
  if (previousVcluster === undefined) delete process.env.CZ_VCLUSTER
  else process.env.CZ_VCLUSTER = previousVcluster
  await Bun.$`rm -rf ${home}`
})

test("resolveConnectionConfig honors CZ_PROFILE before falling back to default profile auth", async () => {
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
  process.env.CZ_PROFILE = "czcli"
  // A stale CZ_ENV_DERIVED from another file (or this file's own env vars,
  // which are never applied through ConnectionEnv.apply here) would make
  // ConnectionEnv.read() classify CZ_USERNAME/CZ_PASSWORD below as "inherited"
  // rather than "user", changing the priority tier they resolve into.
  delete process.env.CZ_ENV_DERIVED
  delete process.env.CZ_PAT
  process.env.CZ_USERNAME = "czcli"
  process.env.CZ_PASSWORD = "secret"
  process.env.CZ_SERVICE = "cn-shanghai-alicloud.api.clickzetta.com"
  process.env.CZ_INSTANCE = "clickzetta"
  process.env.CZ_WORKSPACE = "czcli"
  process.env.CZ_SCHEMA = "public"
  process.env.CZ_VCLUSTER = "default"

  const { resolveConnectionConfig } = await import(`../src/connection/config.ts?${Date.now()}`)
  const config = resolveConnectionConfig({})

  expect(config.pat).toBe("")
  expect(config.username).toBe("czcli")
  expect(config.password).toBe("secret")
  expect(config.instance).toBe("clickzetta")
  expect(config.workspace).toBe("czcli")
})

/**
 * A profile the caller NAMED but that is not in profiles.toml. This used to read as
 * undefined and let every field fall through to env/defaults, so the user got
 * "Authentication required. Run cz-cli auth login" for what was a misspelled name.
 * The CLI reports this at its boundary (run-cli.ts); these cover the library path
 * that programmatic callers — execute(), the MCP server — go through.
 */
test("resolveConnectionConfig rejects an explicitly named profile that does not exist", async () => {
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
  delete process.env.CZ_PROFILE
  delete process.env.CZ_ENV_DERIVED

  const { resolveConnectionConfig } = await import(`../src/connection/config.ts?${Date.now()}`)
  try {
    resolveConnectionConfig({ profile: "ghost" })
    throw new Error("expected PROFILE_NOT_FOUND")
  } catch (err) {
    expect((err as { code?: string }).code).toBe("PROFILE_NOT_FOUND")
    expect((err as Error).message).toContain("ghost")
  }
})

/**
 * A stale CZ_PROFILE is deliberately NOT rejected here. run-cli.ts checks it for the
 * commands that connect, while this function is also reached by callers that merely
 * read a config — the TUI quota sidebar, gateway-prompt, agent-mcp, studio-context —
 * where an inherited value that no longer resolves should degrade, not throw.
 */
test("resolveConnectionConfig tolerates a stale CZ_PROFILE (the CLI reports that)", async () => {
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
  process.env.CZ_PROFILE = "ghost"
  delete process.env.CZ_ENV_DERIVED
  for (const name of ["CZ_PAT", "CZ_USERNAME", "CZ_PASSWORD", "CZ_SERVICE", "CZ_INSTANCE", "CZ_WORKSPACE", "CZ_SCHEMA", "CZ_VCLUSTER"]) {
    delete process.env[name]
  }

  const { resolveConnectionConfig } = await import(`../src/connection/config.ts?${Date.now()}`)
  expect(() => resolveConnectionConfig({})).not.toThrow()
  delete process.env.CZ_PROFILE
})

test("resolveConnectionConfig still accepts an invocation that names no profile", async () => {
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
  delete process.env.CZ_PROFILE
  delete process.env.CZ_ENV_DERIVED
  // The first test in this file exports a full CZ_* set; those sit ABOVE the profile
  // in the priority order, so they have to go before asserting on profile values.
  for (const name of ["CZ_PAT", "CZ_USERNAME", "CZ_PASSWORD", "CZ_SERVICE", "CZ_INSTANCE", "CZ_WORKSPACE", "CZ_SCHEMA", "CZ_VCLUSTER"]) {
    delete process.env[name]
  }

  const { resolveConnectionConfig } = await import(`../src/connection/config.ts?${Date.now()}`)
  expect(resolveConnectionConfig({}).instance).toBe("test-instance")
})

/**
 * An empty value is not a value: `--workspace` with nothing after it arrives here as
 * "" and used to overwrite the profile, after which the command complained that the
 * workspace was missing — about the flag the user had just passed.
 */
test("resolveConnectionConfig treats an empty override as absent, keeping the profile's value", async () => {
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
  delete process.env.CZ_PROFILE
  delete process.env.CZ_ENV_DERIVED
  for (const name of ["CZ_PAT", "CZ_USERNAME", "CZ_PASSWORD", "CZ_SERVICE", "CZ_INSTANCE", "CZ_WORKSPACE", "CZ_SCHEMA", "CZ_VCLUSTER"]) {
    delete process.env[name]
  }

  const { resolveConnectionConfig } = await import(`../src/connection/config.ts?${Date.now()}`)
  const config = resolveConnectionConfig({ workspace: "", instance: "  ", schema: "" })
  expect(config.workspace).toBe("qa_test_prj01")
  expect(config.instance).toBe("test-instance")
  expect(config.schema).toBe("tianzhu")
})

test("resolveConnectionConfig still applies a non-empty override", async () => {
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
  delete process.env.CZ_PROFILE
  delete process.env.CZ_ENV_DERIVED
  for (const name of ["CZ_INSTANCE", "CZ_WORKSPACE", "CZ_SCHEMA"]) delete process.env[name]

  const { resolveConnectionConfig } = await import(`../src/connection/config.ts?${Date.now()}`)
  expect(resolveConnectionConfig({ workspace: "other_ws" }).workspace).toBe("other_ws")
})
