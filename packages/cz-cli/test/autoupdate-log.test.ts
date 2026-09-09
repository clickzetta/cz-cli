import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { maybeAutoUpdate, resolveReleaseSelection } from "../src/bootstrap/update"
import { isPendingChannelSwitch } from "../src/bootstrap/release-version"
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

test.each([undefined, "{ invalid", "{}", '{"channel":"unknown"}'])("missing or invalid installation metadata does not authorize a channel switch: %s", async (metadata) => {
  if (metadata !== undefined) await Bun.write(path.join(home, ".clickzetta/install.json"), metadata)
  const selection = await resolveReleaseSelection({ env: environment() })
  expect(selection).toEqual({ channel: "stable", explicit: false, source: "default" })
  expect(isPendingChannelSwitch("dev-v2.1.0.20260901105751", selection)).toBe(false)
})

test("a stored or environmental channel selection is explicit", async () => {
  await Bun.write(path.join(home, ".clickzetta/install.json"), JSON.stringify({ channel: "nightly" }))
  expect(await resolveReleaseSelection({ env: environment() })).toEqual({ channel: "nightly", explicit: true, source: "install.json" })
  expect(await resolveReleaseSelection({ env: { ...environment(), CZ_CHANNEL: "stable" } })).toEqual({ channel: "stable", explicit: true, source: "CZ_CHANNEL" })
})

test("a nightly without metadata checks its own channel without authorizing a cross-channel move", async () => {
  const version = "dev-v2.0.4.20260901105751"
  expect(await resolveReleaseSelection({ env: environment(), version })).toEqual({ channel: "nightly", explicit: false, source: "binary-version" })
  const urls: string[] = []
  await maybeAutoUpdate({
    args: ["sql"], env: environment(), version,
    fetchImpl: Object.assign(async (url: string | URL | Request) => {
      urls.push(String(url))
      return Response.json({ version: "dev-v2.0.4.20260902105751" })
    }, { preconnect: fetch.preconnect }),
  })
  expect(urls).toEqual(["https://cz-cli.ai/api/nightly"])
  expect((await entries()).at(-1)).toMatchObject({ action: "notify", channel: "nightly" })
})

test("automatic checking does not label an explicit crossed installation up to date", async () => {
  await Bun.write(path.join(home, ".clickzetta/install.json"), JSON.stringify({ channel: "nightly" }))
  await maybeAutoUpdate({
    args: ["sql"], env: environment(), version: "2.0.4",
    fetchImpl: Object.assign(async () => Response.json({ version: "dev-v2.0.4.20260901105751" }), { preconnect: fetch.preconnect }),
  })
  expect((await Bun.file(path.join(home, "state/clickzetta/update-check.json")).json()).last_result).toBe("update-available")
  expect((await entries()).at(-1)).toMatchObject({ event: "decision", action: "notify", channel: "nightly" })
})

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

test("config errors are recorded without blocking the command or checking for updates", async () => {
  await Bun.write(path.join(home, ".clickzetta/czcli.json"), "{ invalid")
  const calls: string[] = []
  await maybeAutoUpdate({
    args: ["sql"], version: "2.0.3", env: environment(),
    fetchImpl: Object.assign(async (url: string | URL | Request) => {
      calls.push(String(url))
      return Response.json({ version: "2.0.4" })
    }, { preconnect: fetch.preconnect }),
  })
  expect((await entries()).at(-1)?.event).toBe("config-failed")
  expect(calls).toEqual([])
  expect(await Bun.file(path.join(home, ".clickzetta/czcli.json")).text()).toBe("{ invalid")
})

test("a config path that is a directory does not block the command", async () => {
  const file = path.join(home, ".clickzetta/czcli.json")
  await fs.unlink(file)
  await fs.mkdir(file)
  await maybeAutoUpdate({ args: ["sql"], version: "2.0.3", env: environment() })
  expect((await entries()).at(-1)?.event).toBe("config-failed")
})

test("healthy interval skips do not append logs unless diagnostics are requested", async () => {
  await Bun.write(path.join(home, "state/clickzetta/update-check.json"), JSON.stringify({ last_checked_at: 2_000_000_000_000, last_result: "up-to-date" }))
  await maybeAutoUpdate({ args: ["sql"], version: "2.0.3", env: environment(), now: 2_000_000_060_000 })
  expect(await Bun.file(updateLogPath(environment())).exists()).toBe(false)
  await maybeAutoUpdate({ args: ["sql"], version: "2.0.3", env: { ...environment(), CLICKZETTA_UPDATE_DEBUG: "1" }, now: 2_000_000_060_000 })
  expect(await entries()).toHaveLength(1)
  expect((await entries())[0]).toMatchObject({ event: "skipped", reason: "interval" })
})

test("successful recovery clears the previous error from update state", async () => {
  const state = path.join(home, "state/clickzetta/update-check.json")
  await Bun.write(state, JSON.stringify({ last_checked_at: 1, last_result: "check-failed", error: "old timeout" }))
  await maybeAutoUpdate({
    args: ["sql"], version: "2.0.3", env: environment(), now: 2_000_000_000_000,
    fetchImpl: Object.assign(async () => Response.json({ version: "2.0.3" }), { preconnect: fetch.preconnect }),
  })
  expect(await Bun.file(state).json()).toEqual({ last_checked_at: 2_000_000_000_000, last_result: "up-to-date", latest_version: "2.0.3" })
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

test("redacts shell and JSON credentials in all string fields", async () => {
  await createUpdateLogger("2.0.3", environment())("upgrade-failed", {
    error: '--password private-one --token "private two" CZ_PAT=private-three export CZ_PAT private-four --api-key=private-five',
    details: '{"password":"private-six","access_token":"private-seven"} --pat private-eight',
  })
  const logs = await entries()
  expect(JSON.stringify(logs)).not.toContain("private")
  expect(logs[0].error).toContain("--password [redacted]")
  expect(logs[0].details).toContain("--pat [redacted]")
})
