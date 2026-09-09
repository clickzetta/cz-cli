import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { maybeAutoUpdate } from "../src/bootstrap/update"

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true })
})

async function sandbox(state: Record<string, unknown>) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-autoupdate-"))
  dirs.push(home)
  const stateFile = path.join(home, ".local", "state", "clickzetta", "update-check.json")
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2))
  // install.json pins the channel so resolveReleaseChannel does not read the real home.
  const installFile = path.join(home, ".clickzetta", "install.json")
  await fs.mkdir(path.dirname(installFile), { recursive: true })
  await fs.writeFile(installFile, JSON.stringify({ version: 1, channel: "stable" }))
  return { home, stateFile }
}

const env = (home: string) => ({
  CLICKZETTA_TEST_HOME: home,
  XDG_STATE_HOME: path.join(home, ".local", "state"),
  XDG_CONFIG_HOME: path.join(home, ".config"),
  CLICKZETTA_TEST_MANAGED_CONFIG_DIR: path.join(home, "managed"),
}) as unknown as NodeJS.ProcessEnv

describe("a failed update check keeps its own evidence", () => {
  test("check-failed and its error survive instead of being overwritten by the stale prior result", async () => {
    const { home, stateFile } = await sandbox({ last_result: "up-to-date", autoupdate: true })
    await maybeAutoUpdate({
      args: ["sql"],
      env: env(home),
      version: "2.0.3",
      now: 2_000_000_000_000,
      fetchImpl: (() => Promise.reject(new Error("getaddrinfo ENOTFOUND cz-cli.ai"))) as unknown as typeof fetch,
    })
    const written = JSON.parse(await fs.readFile(stateFile, "utf-8"))
    // Previously the follow-up write reset this to the pre-failure "up-to-date"
    // and dropped `error`, so a machine that could never reach cz-cli.ai looked healthy.
    expect(written.last_result).toBe("check-failed")
    expect(written.error).toContain("ENOTFOUND")
    expect(written.autoupdate).toBe(true)
  })
})
