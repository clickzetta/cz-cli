import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ConfigAutoupdate } from "../src/config/autoupdate"
import { maybeAutoUpdate } from "../src/bootstrap/update"

let home = ""
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-autoupdate-config-"))
})
afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true })
})

function environment() {
  return {
    CLICKZETTA_TEST_HOME: home,
    CLICKZETTA_TEST_MANAGED_CONFIG_DIR: path.join(home, "managed"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_STATE_HOME: path.join(home, "state"),
  }
}

async function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  const child = Bun.spawn([process.execPath, "-e", `
    import { createCli } from "./src/cli"
    import { registerAutoupdateCommand } from "./src/commands/autoupdate"
    const cli = createCli(process.argv.slice(1))
    registerAutoupdateCommand(cli)
    await cli.parseAsync()
  `, "autoupdate", ...args, "--format", "json"], {
    cwd: path.resolve(import.meta.dir, ".."),
    env: { PATH: process.env.PATH, HOME: home, ...environment(), ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(child.stdout).text()
  const stderr = await new Response(child.stderr).text()
  expect(await child.exited).toBe(0)
  expect(stderr).toBe("")
  return JSON.parse(stdout).data
}

test("the command replaces the canonical preference despite conflicting legacy files", async () => {
  await Bun.write(path.join(home, ".clickzetta/czcli.json"), JSON.stringify({ autoupdate: false, sql_split: false }))
  await Bun.write(path.join(home, ".config/clickzetta/config.json"), JSON.stringify({ autoupdate: false }))
  await Bun.write(path.join(home, "managed/opencode.json"), JSON.stringify({ autoupdate: false }))
  await Bun.write(path.join(home, "state/clickzetta/update-check.json"), JSON.stringify({ autoupdate: false }))

  expect((await run(["true"])).value).toBe(true)
  expect((await run([])).value).toBe(true)
  expect((await ConfigAutoupdate.read({ env: environment() })).value).toBe(true)
  expect(await Bun.file(path.join(home, ".clickzetta/czcli.json")).json()).toEqual({ autoupdate: true, sql_split: false })
})

test.each([false, "notify"] as const)("migrates legacy %s once and keeps update state separate", async (autoupdate) => {
  const state = path.join(home, "state/clickzetta/update-check.json")
  await Bun.write(state, JSON.stringify({ autoupdate, last_result: "check-failed", error: "offline" }))
  expect((await ConfigAutoupdate.read({ env: environment() })).value).toBe(autoupdate)
  expect(await Bun.file(path.join(home, ".clickzetta/czcli.json")).json()).toEqual({ autoupdate, autoupdate_migrated: true })
  expect((await Bun.file(state).json()).error).toBe("offline")

  await Bun.write(state, JSON.stringify({ autoupdate: true }))
  await Bun.write(path.join(home, ".config/clickzetta/config.json"), JSON.stringify({ autoupdate: true }))
  expect((await ConfigAutoupdate.read({ env: environment() })).value).toBe(autoupdate)
})

test("imports the former legacy precedence without overwriting other canonical settings", async () => {
  await Bun.write(path.join(home, ".clickzetta/czcli.json"), JSON.stringify({ sql_split: false }))
  await Bun.write(path.join(home, "state/clickzetta/update-check.json"), JSON.stringify({ autoupdate: true }))
  await Bun.write(path.join(home, ".clickzetta/czcli.jsonc"), JSON.stringify({ autoupdate: false }))
  await Bun.write(path.join(home, "managed/opencode.jsonc"), JSON.stringify({ autoupdate: "notify" }))
  expect((await ConfigAutoupdate.read({ env: environment() })).value).toBe("notify")
  expect(await Bun.file(path.join(home, ".clickzetta/czcli.json")).json()).toEqual({ sql_split: false, autoupdate: "notify", autoupdate_migrated: true })
  await Bun.write(path.join(home, "managed/opencode.jsonc"), JSON.stringify({ autoupdate: false }))
  expect((await ConfigAutoupdate.read({ env: environment() })).value).toBe("notify")
})

test.each([
  ["CLICKZETTA_AUTOUPDATE", "false", false],
  ["CLICKZETTA_AUTOUPDATE", "notify", "notify"],
] as const)("the command and bootstrap report override %s=%s", async (key, value, expected) => {
  const config = await run(["true"], { [key]: value })
  expect(config.value).toBe(expected)
  expect(config.configured).toBe(true)
  expect(config.source).toBe(key)
  expect((await ConfigAutoupdate.read({ env: { ...environment(), [key]: value } })).value).toBe(expected)
  expect((await ConfigAutoupdate.read({ env: environment() })).value).toBe(true)
})

test.each(["CLICKZETTA_DISABLE_AUTOUPDATE", "CLICKZETTA_SKIP_UPDATE_ONCE", "CZ_SKIP_UPDATE"])("%s suppresses only this invocation, not the saved preference", async (key) => {
  const config = await run(["true"], { [key]: "1" })
  expect(config.value).toBe(true)
  expect(config.configured).toBe(true)
  expect(config.source).toBe(path.join(home, ".clickzetta/czcli.json"))
  expect(config.suppressed_by).toBe(key)
  expect((await ConfigAutoupdate.read({ env: { ...environment(), [key]: "1" } })).value).toBe(true)
})

test("shows the default and supports off/on/notify through the command", async () => {
  expect(await run([])).toMatchObject({ value: true, configured: null, source: "default", defaulted: true })
  expect((await run(["off"])).value).toBe(false)
  expect((await run(["on"])).value).toBe(true)
  expect((await run(["notify"])).value).toBe("notify")
})

test("viewing or setting autoupdate never runs a network check", async () => {
  const calls: string[] = []
  for (const args of [["autoupdate"], ["autoupdate", "false"]]) {
    await maybeAutoUpdate({
      args,
      version: "2.0.3",
      env: environment(),
      fetchImpl: Object.assign(async (url: string | URL | Request) => {
        calls.push(String(url))
        return Response.json({ version: "2.0.4" })
      }, { preconnect: fetch.preconnect }),
    })
  }
  expect(calls).toEqual([])
  expect(await Bun.file(path.join(home, "state/clickzetta/update-check.json")).exists()).toBe(false)
})

test("refuses to overwrite a malformed canonical config", async () => {
  const file = path.join(home, ".clickzetta/czcli.json")
  await Bun.write(file, "{ malformed config")
  await expect(ConfigAutoupdate.write(true, { env: environment() })).rejects.toThrow("Invalid config")
  expect(await Bun.file(file).text()).toBe("{ malformed config")
})

test("an unreadable legacy path does not prevent migration from another source", async () => {
  await fs.mkdir(path.join(home, ".clickzetta/czcli.jsonc"), { recursive: true })
  await Bun.write(path.join(home, "state/clickzetta/update-check.json"), JSON.stringify({ autoupdate: false }))
  expect((await ConfigAutoupdate.read({ env: environment() })).value).toBe(false)
})

test("an empty migration is completed once without losing default semantics", async () => {
  expect((await ConfigAutoupdate.read({ env: environment() })).defaulted).toBe(true)
  await Bun.write(path.join(home, "state/clickzetta/update-check.json"), JSON.stringify({ autoupdate: false }))
  expect(await ConfigAutoupdate.read({ env: environment() })).toMatchObject({ value: true, defaulted: true, configured: null })
})

test("migration write failure retains the successfully read legacy preference", async () => {
  const file = path.join(home, ".clickzetta/czcli.json")
  await Bun.write(file, "{}")
  await fs.chmod(file, 0o400)
  await Bun.write(path.join(home, "state/clickzetta/update-check.json"), JSON.stringify({ autoupdate: false }))
  expect((await ConfigAutoupdate.read({ env: environment() })).value).toBe(false)
  expect(await Bun.file(file).text()).toBe("{}")
})
