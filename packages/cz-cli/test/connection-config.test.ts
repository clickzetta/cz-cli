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
