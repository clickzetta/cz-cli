import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ConfigOtel } from "../src/config/otel.js"
import { applyDefaultOtelEnv } from "../src/otel-defaults.js"

let home = ""
let previous: Record<string, string | undefined> = {}

beforeEach(async () => {
  previous = Object.fromEntries(
    [
      "CLICKZETTA_TEST_HOME",
      "XDG_CONFIG_HOME",
      "OPENCODE_OTEL_RECORD_CONTENT",
      "OPENCODE_OTLP_ENDPOINT",
      "OPENCODE_OTLP_HEADERS",
      "OPENCODE_OTLP_PROTOCOL",
      "OPENCODE_SERVICE_NAME",
    ].map((key) => [key, process.env[key]]),
  )
  home = await mkdtemp(path.join(os.tmpdir(), "cz-otel-config-"))
  process.env.CLICKZETTA_TEST_HOME = home
  process.env.XDG_CONFIG_HOME = path.join(home, "xdg")
  delete process.env.OPENCODE_OTEL_RECORD_CONTENT
  await mkdir(path.join(home, ".clickzetta"))
})

afterEach(async () => {
  Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
  await rm(home, { recursive: true, force: true })
})

test.each([
  [undefined, "1"],
  ["[profiles.default]\nuser_id = 42\n", "1"],
  ["telemetry = false\n", "0"],
  ["telemetry = true\n", "1"],
  ["[profiles.default]\ntelemetry = false\n", "1"],
  ['"telemetry" = false\n', "0"],
])("legacy preference %j resolves to %s", async (profiles, expected) => {
  if (profiles !== undefined) await Bun.write(path.join(home, ".clickzetta/profiles.toml"), profiles)
  await applyDefaultOtelEnv()
  expect(process.env.OPENCODE_OTEL_RECORD_CONTENT).toBe(expected)
})

test.each([true, false])("new preference %s overrides legacy", async (enabled) => {
  await Bun.write(path.join(home, ".clickzetta/profiles.toml"), `telemetry = ${!enabled}\n`)
  await ConfigOtel.setRecordContent(enabled)
  await applyDefaultOtelEnv()
  expect(process.env.OPENCODE_OTEL_RECORD_CONTENT).toBe(enabled ? "1" : "0")
})

test.each(["0", "1"])("explicit environment %s overrides persisted preferences", async (value) => {
  await ConfigOtel.setRecordContent(value === "0")
  process.env.OPENCODE_OTEL_RECORD_CONTENT = value
  await applyDefaultOtelEnv()
  expect(process.env.OPENCODE_OTEL_RECORD_CONTENT).toBe(value)
})

test("XDG overrides canonical config using the existing config rules", async () => {
  await ConfigOtel.setRecordContent(true)
  await mkdir(path.join(home, "xdg/clickzetta"), { recursive: true })
  await Bun.write(path.join(home, "xdg/clickzetta/config.json"), '{"otel_record_content": false}')
  await applyDefaultOtelEnv()
  expect(process.env.OPENCODE_OTEL_RECORD_CONTENT).toBe("0")
})

test("setup preference writes preserve other settings and leave profiles untouched", async () => {
  const file = path.join(home, ".clickzetta/czcli.json")
  const profiles = path.join(home, ".clickzetta/profiles.toml")
  await Bun.write(file, '{ // existing settings\n "autoupdate": false, "sql_split": false, }')
  await Bun.write(profiles, "telemetry = true\n[profiles.default]\nuser_id = 42\n")
  const before = await Bun.file(profiles).text()
  await ConfigOtel.setRecordContent(false)
  expect(await Bun.file(file).json()).toEqual({ autoupdate: false, sql_split: false, otel_record_content: false })
  expect(await Bun.file(profiles).text()).toBe(before)
  expect(await ConfigOtel.recordContent()).toBe(false)
})

test("invalid config is not overwritten by setup", async () => {
  const file = path.join(home, ".clickzetta/czcli.json")
  await Bun.write(file, '{"autoupdate":')
  await expect(ConfigOtel.setRecordContent(false)).rejects.toThrow("Invalid config")
  expect(await Bun.file(file).text()).toBe('{"autoupdate":')
})

test("injected defaults do not mask an unconfigured setup preference", async () => {
  await applyDefaultOtelEnv()
  expect(process.env.OPENCODE_OTEL_RECORD_CONTENT).toBe("1")
  expect(await ConfigOtel.recordContent()).toBeUndefined()
})
