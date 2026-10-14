import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createCli } from "../src/cli"
import { resolveConnectionConfig } from "../src/connection/config"
import { ConnectionEnv } from "../src/connection/env"
import { applyClickZettaProfile } from "../src/bootstrap/profile-env"
import { splitConnectionEnv } from "../src/run-cli"

const jdbc = "jdbc:clickzetta://clickzetta.perf-api.clickzetta.com/default?schema=idc_ssb100g&vcluster=idc_ap_128&httppoolsize=150&use_http=true"
const target = {
  service: "perf-api.clickzetta.com",
  protocol: "http",
  instance: "clickzetta",
  workspace: "default",
  schema: "idc_ssb100g",
  vcluster: "idc_ap_128",
}
const saved = { ...process.env }
let home: string

beforeEach(async () => {
  Object.keys(process.env).filter((key) => key.startsWith("CZ_")).forEach((key) => delete process.env[key])
  ConnectionEnv.clearApplyUserTrackingForTest()
  home = mkdtempSync(join(tmpdir(), "cz-jdbc-connection-"))
  process.env.CLICKZETTA_TEST_HOME = home
  mkdirSync(join(home, ".clickzetta"))
  await Bun.write(join(home, ".clickzetta/profiles.toml"), `
default_profile = "local"
[profiles.local]
service = "default.example.invalid"
protocol = "https"
instance = "clickzetta"
instance_id = 123
workspace = "quick_start"
schema = "public"
vcluster = "default"
username = "profile-user"
password = "profile-password"
`)
})

afterEach(() => {
  Object.keys(process.env).filter((key) => key.startsWith("CZ_") || key === "CLICKZETTA_TEST_HOME").forEach((key) => delete process.env[key])
  Object.entries(saved).filter(([key]) => key.startsWith("CZ_") || key === "CLICKZETTA_TEST_HOME").forEach(([key, value]) => { process.env[key] = value })
  ConnectionEnv.clearApplyUserTrackingForTest()
  rmSync(home, { recursive: true, force: true })
})

test("native yargs arguments preserve JDBC overrides against the default profile", async () => {
  await createCli(["status", "--jdbc", jdbc, "--username", "jdbc-user", "--password", "raw+#% password"])
    .command("status", "inspect connection", () => {}, (argv) => {
      expect(resolveConnectionConfig(argv)).toMatchObject({ ...target, username: "jdbc-user", password: "raw+#% password" })
    }).parseAsync()
})

test("legacy programmatic jdbcUrl and native jdbc resolve identically", () => {
  expect(resolveConnectionConfig({ jdbc })).toEqual(resolveConnectionConfig({ jdbcUrl: jdbc }))
})

test("explicit fields override JDBC, which overrides user environment and profile", () => {
  ConnectionEnv.applyUser({ service: "env.invalid", schema: "env-schema", protocol: "https" })
  expect(resolveConnectionConfig({ jdbc, schema: "explicit", protocol: "https", workspace: "" }))
    .toMatchObject({ ...target, schema: "explicit", protocol: "https" })
})

test("changing the service invalidates a same-named instance id from the profile", () => {
  expect(resolveConnectionConfig({ jdbcUrl: jdbc }).instanceId).toBeUndefined()
  expect(resolveConnectionConfig({ service: "other.invalid" }).instanceId).toBeUndefined()
  expect(resolveConnectionConfig({ schema: "another" }).instanceId).toBe(123)
})

test("JDBC fields retain explicit provenance across agent profile expansion", () => {
  const args = { jdbcUrl: jdbc, username: "jdbc-user", password: "jdbc-password" }
  const layers = splitConnectionEnv(args, resolveConnectionConfig(args))
  expect(layers.userFields).toMatchObject(target)
  ConnectionEnv.applyUser(layers.userFields)
  ConnectionEnv.applyInherited(layers.derivedFields)
  applyClickZettaProfile("local")
  expect(resolveConnectionConfig()).toMatchObject({ ...target, username: "jdbc-user", password: "jdbc-password" })
})

test("an empty explicit field does not demote its JDBC value to inherited provenance", () => {
  const args = { jdbcUrl: jdbc, schema: "  " }
  const layers = splitConnectionEnv(args, resolveConnectionConfig(args))
  expect(layers.userFields.schema).toBe("idc_ssb100g")
  expect(layers.derivedFields.schema).toBeUndefined()
})

test("invalid JDBC fails without echoing credentials or falling back to a profile", () => {
  expect(() => resolveConnectionConfig({ jdbcUrl: "secret-not-a-url" })).toThrow("Invalid --jdbc")
  try {
    resolveConnectionConfig({ jdbcUrl: "secret-not-a-url" })
  } catch (error) {
    expect(String(error)).not.toContain("secret-not-a-url")
  }
})

test("conflicting native and legacy JDBC arguments fail explicitly", () => {
  expect(() => resolveConnectionConfig({ jdbc, jdbcUrl: jdbc + "&schema=other" })).toThrow("Conflicting")
})

test("JDBC credentials and flag overrides suppress profile OAuth and cookie credentials", async () => {
  await Bun.write(join(home, ".clickzetta/profiles.toml"), `
default_profile = "local"
[profiles.local]
service = "default.example.invalid"
instance = "clickzetta"
workspace = "quick_start"
oauth = "session"
[profiles.local.header]
Cookie = "X-ClickZetta-Token=profile-token"
X-Trace = "keep"
`)
  const args = { jdbcUrl: jdbc + "&username=jdbc-user&password=encoded%2B%23%25", username: "flag-user" }
  const embedded = resolveConnectionConfig({ jdbc: args.jdbcUrl })
  expect(embedded.username).toBe("jdbc-user")
  expect(embedded.password).toBe("encoded+#%")
  expect(embedded.tokenStore).toBeUndefined()
  expect(embedded.customHeaders?.Cookie).toBeUndefined()
  const config = resolveConnectionConfig(args)
  expect(config.username).toBe("flag-user")
  expect(config.password).toBe("encoded+#%")
  expect(config.tokenStore).toBeUndefined()
  expect(config.customHeaders?.Cookie).toBeUndefined()
  expect(config.customHeaders?.["X-Trace"]).toBe("keep")

  const layers = splitConnectionEnv(args, config)
  expect(layers.userFields.username).toBe("flag-user")
  expect(layers.userFields.password).toBe("encoded+#%")
  ConnectionEnv.applyUser(layers.userFields)
  ConnectionEnv.applyInherited(layers.derivedFields)
  const inherited = resolveConnectionConfig()
  expect(inherited.username).toBe("flag-user")
  expect(inherited.tokenStore).toBeUndefined()
  expect(inherited.customHeaders?.Cookie).toBeUndefined()
})
