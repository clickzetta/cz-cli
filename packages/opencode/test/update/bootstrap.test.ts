import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  loadBootstrapConfig,
  maybeAutoUpdate,
  resolveUpdateAction,
  shouldSkipAutoUpdateCommand,
} from "../../src/update/bootstrap"

describe("update bootstrap", () => {
  const envSnapshot = { ...process.env }

  beforeEach(async () => {
    Object.assign(process.env, envSnapshot)
    if (envSnapshot.CLICKZETTA_TEST_MANAGED_CONFIG_DIR) {
      await fs.rm(envSnapshot.CLICKZETTA_TEST_MANAGED_CONFIG_DIR, { recursive: true, force: true }).catch(() => {})
    }
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) delete process.env[key]
    }
    Object.assign(process.env, envSnapshot)
  })

  test("loads autoupdate from ~/.clickzetta/czcli.jsonc", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
    await fs.mkdir(path.join(home, ".clickzetta"), { recursive: true })
    await fs.writeFile(
      path.join(home, ".clickzetta", "czcli.jsonc"),
      `{
        // keep startup checks on, but notify only
        "autoupdate": "notify"
      }`,
    )

    const config = await loadBootstrapConfig({ home, env: {} })
    expect(config.autoupdate).toBe("notify")
  })

  test("managed config overrides ~/.clickzetta config", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
    const managedDir = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-managed-"))
    await fs.mkdir(path.join(home, ".clickzetta"), { recursive: true })
    await fs.writeFile(path.join(home, ".clickzetta", "czcli.json"), JSON.stringify({ autoupdate: true }))
    await fs.writeFile(path.join(managedDir, "opencode.json"), JSON.stringify({ autoupdate: false }))

    const config = await loadBootstrapConfig({
      home,
      env: { CLICKZETTA_TEST_MANAGED_CONFIG_DIR: managedDir },
    })
    expect(config.autoupdate).toBe(false)
  })

  test("skips autoupdate for setup, update, help, version, and one-shot restart env", () => {
    expect(shouldSkipAutoUpdateCommand({ args: ["setup"] })).toBe(true)
    expect(shouldSkipAutoUpdateCommand({ args: ["update"] })).toBe(true)
    expect(shouldSkipAutoUpdateCommand({ args: ["--help"] })).toBe(true)
    expect(shouldSkipAutoUpdateCommand({ args: ["--version"] })).toBe(true)
    expect(
      shouldSkipAutoUpdateCommand({
        args: ["sql"],
        env: { CLICKZETTA_SKIP_UPDATE_ONCE: "1" },
      }),
    ).toBe(true)
    expect(
      shouldSkipAutoUpdateCommand({
        args: ["sql"],
        env: { CZ_SKIP_UPDATE: "true" },
      }),
    ).toBe(true)
  })

  test("returns notify when an update is available but the install method is unsupported", () => {
    const result = resolveUpdateAction({
      autoupdate: true,
      channel: "latest",
      currentVersion: "0.3.31",
      latestVersion: "0.3.32",
      lastCheckedAt: 0,
      now: 12 * 60 * 60 * 1000 + 1,
      intervalMs: 12 * 60 * 60 * 1000,
      method: "unknown",
    })

    expect(result.kind).toBe("notify")
  })

  test("returns upgrade when autoupdate is unset and the install method is managed", () => {
    const result = resolveUpdateAction({
      autoupdate: undefined,
      channel: "latest",
      currentVersion: "0.3.31",
      latestVersion: "0.3.32",
      lastCheckedAt: 0,
      now: 12 * 60 * 60 * 1000 + 1,
      intervalMs: 12 * 60 * 60 * 1000,
      method: "curl",
    })

    expect(result.kind).toBe("upgrade")
  })

  test("skips checks until the interval elapses", () => {
    const result = resolveUpdateAction({
      autoupdate: "notify",
      channel: "latest",
      currentVersion: "0.3.31",
      latestVersion: "0.3.32",
      lastCheckedAt: 1_000,
      now: 2_000,
      intervalMs: 5_000,
      method: "curl",
    })

    expect(result.kind).toBe("skip")
  })

  test("does not hit the network again before the update interval elapses", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
    const stateDir = path.join(home, ".local", "state", "clickzetta")
    await fs.mkdir(stateDir, { recursive: true })
    await fs.writeFile(
      path.join(stateDir, "update-check.json"),
      JSON.stringify({
        last_checked_at: 5_000,
        last_result: "up-to-date",
      }),
    )

    const fetchImpl = mock(async () =>
      new Response(JSON.stringify({ tag_name: "v9.9.9" }), {
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch

    await maybeAutoUpdate({
      args: ["sql"],
      env: {
        HOME: home,
        CLICKZETTA_AUTOUPDATE: "notify",
      },
      fetchImpl,
      now: 6_000,
      intervalMs: 5_000,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(0)
  })

  test("falls back to the default interval when CLICKZETTA_UPDATE_INTERVAL_MS is invalid", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
    const stateDir = path.join(home, ".local", "state", "clickzetta")
    await fs.mkdir(stateDir, { recursive: true })
    await fs.writeFile(
      path.join(stateDir, "update-check.json"),
      JSON.stringify({
        last_checked_at: 5_000,
        last_result: "up-to-date",
      }),
    )

    const fetchImpl = mock(async () =>
      new Response(JSON.stringify({ tag_name: "v9.9.9" }), {
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch

    await maybeAutoUpdate({
      args: ["sql"],
      env: {
        HOME: home,
        CLICKZETTA_AUTOUPDATE: "notify",
        CLICKZETTA_UPDATE_INTERVAL_MS: "NaN",
      },
      fetchImpl,
      now: 6_000,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(0)
  })
})
