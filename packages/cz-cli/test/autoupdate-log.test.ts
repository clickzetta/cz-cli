import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { maybeAutoUpdate } from "../src/bootstrap/update"
import { createUpdateLogger, updateLogPath } from "../src/bootstrap/update-log"

let home = ""
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-update-log-"))
  await Bun.write(path.join(home, ".clickzetta/czcli.json"), JSON.stringify({ autoupdate: "notify" }))
})
afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true })
})

function environment() {
  return { CLICKZETTA_TEST_HOME: home, XDG_STATE_HOME: path.join(home, "state") }
}

async function entries() {
  return (await Bun.file(updateLogPath(environment())).text()).trim().split("\n")
    .map((line): Record<string, unknown> => JSON.parse(line))
}

test("a failed check and the later interval skip retain separate histories", async () => {
  await maybeAutoUpdate({
    args: ["sql", "select private_data", "--password", "private-password"],
    env: environment(),
    version: "2.0.3",
    now: 2_000_000_000_000,
    fetchImpl: Object.assign(async () => { throw new Error("getaddrinfo ENOTFOUND cz-cli.ai") }, { preconnect: fetch.preconnect }),
  })
  await maybeAutoUpdate({ args: ["sql"], env: environment(), version: "2.0.3", now: 2_000_000_060_000 })
  const logs = await entries()
  expect(logs.find((entry) => entry.event === "check-failed")?.error).toContain("ENOTFOUND")
  expect(logs.find((entry) => entry.event === "check-started")).toMatchObject({ channel: "stable", timeout_ms: 5000, url: "https://cz-cli.ai/api/stable" })
  expect(logs.at(-1)).toMatchObject({ event: "skipped", reason: "interval", last_result: "check-failed", retry_after_ms: 43_140_000 })
  expect(new Set(logs.map((entry) => entry.run_id)).size).toBe(2)
  expect(logs.every((entry) => typeof entry.timestamp === "string" && entry.current_version === "2.0.3")).toBe(true)
  expect(JSON.stringify(logs)).not.toContain("private_data")
  expect(JSON.stringify(logs)).not.toContain("private-password")
})

test("a notify decision records the actual preference and its source", async () => {
  await maybeAutoUpdate({
    args: ["sql"], env: environment(), version: "2.0.3",
    fetchImpl: Object.assign(async () => Response.json({ version: "2.0.4" }), { preconnect: fetch.preconnect }),
  })
  const logs = await entries()
  expect(logs.find((entry) => entry.event === "config")).toMatchObject({ autoupdate: "notify", source: path.join(home, ".clickzetta/czcli.json") })
  expect(logs.at(-1)).toMatchObject({ event: "decision", action: "notify", reason: "notify-only", latest_version: "2.0.4" })
})

test("an environment skip is logged before config or network access", async () => {
  await Bun.write(path.join(home, ".clickzetta/czcli.json"), "{ invalid")
  await maybeAutoUpdate({ args: ["sql"], version: "2.0.3", env: { ...environment(), CZ_SKIP_UPDATE: "1" } })
  expect(await entries()).toHaveLength(1)
  expect((await entries())[0]).toMatchObject({ event: "skipped", reason: "CZ_SKIP_UPDATE" })
})

test("config errors are recorded before propagating", async () => {
  await Bun.write(path.join(home, ".clickzetta/czcli.json"), "{ invalid")
  await expect(maybeAutoUpdate({ args: ["sql"], version: "2.0.3", env: environment() })).rejects.toThrow("Invalid config")
  expect((await entries()).at(-1)?.event).toBe("config-failed")
})

test("an unusable log path never breaks the command", async () => {
  await fs.mkdir(updateLogPath(environment()), { recursive: true })
  await maybeAutoUpdate({ args: ["--version"], version: "2.0.3", env: environment() })
})

test("rotates at one MiB and redacts bounded error messages", async () => {
  const file = updateLogPath(environment())
  await Bun.write(file, "x".repeat(1024 * 1024))
  await createUpdateLogger("2.0.3", environment())("upgrade-failed", {
    error: "https://user:private-pass@example.com/?token=private-token Bearer private-bearer " + "z".repeat(5000),
  })
  expect((await fs.stat(`${file}.1`)).size).toBe(1024 * 1024)
  const logs = await entries()
  expect(logs).toHaveLength(1)
  expect(String(logs[0].error).length).toBeLessThanOrEqual(4096)
  expect(logs[0].error).not.toContain("private-")
  expect(logs[0].error).toContain("[redacted]")
})
