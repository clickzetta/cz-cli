import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  ensureRestartBinaryAtPath,
  installMethodFromExecPath,
  latestVersionForMethod,
  loadBootstrapConfig,
  maybeAutoUpdate,
  performUpgrade,
  readInstallMetadata,
  resolveReleaseChannel,
  resolveUpdateAction,
  restartCurrentProcessResult,
  restartArgs,
  shouldSkipAutoUpdateCommand,
  writeInstallMetadata,
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

  test("loads autoupdate from update-check.json", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
    await fs.mkdir(path.join(home, ".local", "state", "clickzetta"), { recursive: true })
    await fs.writeFile(
      path.join(home, ".local", "state", "clickzetta", "update-check.json"),
      JSON.stringify({
        autoupdate: "notify",
        last_checked_at: 123,
      }),
    )

    const config = await loadBootstrapConfig({ home, env: {} })
    expect(config.autoupdate).toBe("notify")
  })

  test("CLICKZETTA_AUTOUPDATE overrides update-check.json", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
    await fs.mkdir(path.join(home, ".local", "state", "clickzetta"), { recursive: true })
    await fs.writeFile(
      path.join(home, ".local", "state", "clickzetta", "update-check.json"),
      JSON.stringify({ autoupdate: true }),
    )

    const config = await loadBootstrapConfig({
      home,
      env: { CLICKZETTA_AUTOUPDATE: "false" },
    })
    expect(config.autoupdate).toBe(false)
  })

  test("reads install metadata without requiring a legacy method field", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
    await fs.mkdir(path.join(home, ".clickzetta"), { recursive: true })
    await fs.writeFile(path.join(home, ".clickzetta", "install.json"), JSON.stringify({ channel: "nightly" }))

    expect(await readInstallMetadata({ home })).toMatchObject({ channel: "nightly" })
  })

  test("detects install method from the supplied exec path", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))

    expect(installMethodFromExecPath(path.join(home, ".local", "bin", "cz-cli"), home)).toBe("curl")
  })

  test("detects install method from a mixed-case self-managed path on macOS", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))

    expect(installMethodFromExecPath(path.join(home, ".Local", "bin", "cz-cli"), home, { ...process.env, HOME: home })).toBe("curl")
  })

  test("detects install method when realpath canonicalizes the home prefix", async () => {
    const realHome = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-real-home-"))
    const linkedHome = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-link-root-")), "home")
    await fs.symlink(realHome, linkedHome)
    await fs.mkdir(path.join(realHome, ".local", "bin"), { recursive: true })
    await fs.writeFile(path.join(realHome, ".local", "bin", "cz-cli"), "")

    expect(installMethodFromExecPath(path.join(linkedHome, ".local", "bin", "cz-cli"), linkedHome, { ...process.env, HOME: linkedHome })).toBe("curl")
  })

  test("detects npm install method from platform package binary path", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))

    expect(installMethodFromExecPath(path.join(home, ".npm-global", "lib", "node_modules", "@clickzetta", "cz-cli-darwin-arm64", "bin", "cz-cli"), home)).toBe("npm")
  })

  test("restores restart binary when install.sh moves the target to a different self-managed path", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
    const execPath = path.join(home, ".Local", "bin", "cz-cli")
    await fs.mkdir(path.join(home, ".local", "bin"), { recursive: true })
    await fs.writeFile(path.join(home, ".local", "bin", "cz-cli"), [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo 0.5.23; exit 0; fi",
      "exit 0",
      "",
    ].join("\n"), { mode: 0o755 })

    await ensureRestartBinaryAtPath("0.5.23", execPath, { HOME: home })

    expect((await fs.stat(execPath)).mode & 0o111).toBeGreaterThan(0)
    expect(Bun.spawnSync([execPath, "--version"]).stdout.toString().trim()).toBe("0.5.23")
  })

  test("fails when the restart binary is unavailable after upgrade", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
    const execPath = path.join(home, ".local", "bin", "cz-cli")

    await expect(ensureRestartBinaryAtPath("0.5.23", execPath, { HOME: home })).rejects.toThrow(
      "Updated cz-cli binary is not available",
    )
  })

  test("retries restart once when the first execution is killed", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-restart-"))
    const bin = path.join(tmp, "cz-cli")
    const marker = path.join(tmp, "first")
    await fs.writeFile(bin, [
      "#!/bin/sh",
      `if [ ! -f ${JSON.stringify(marker)} ]; then`,
      `  touch ${JSON.stringify(marker)}`,
      "  kill -KILL $$",
      "fi",
      "exit 0",
      "",
    ].join("\n"), { mode: 0o755 })

    expect(restartCurrentProcessResult(bin, [], {})).toBe(0)
  })

  test("does not mask a restarted command failure", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-restart-"))
    const bin = path.join(tmp, "cz-cli")
    await fs.writeFile(bin, "#!/bin/sh\nexit 7\n", { mode: 0o755 })

    expect(restartCurrentProcessResult(bin, [], {})).toBe(7)
  })

  test("does not write legacy install method metadata", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))

    await writeInstallMetadata({ method: "npm", channel: "nightly" }, { home })

    expect(JSON.parse(await fs.readFile(path.join(home, ".clickzetta", "install.json"), "utf-8")).method).toBeUndefined()
  })

  test("skips autoupdate for setup, update, autoupdate, help, version, and one-shot restart env", () => {
    expect(shouldSkipAutoUpdateCommand({ args: ["setup"] })).toBe(true)
    expect(shouldSkipAutoUpdateCommand({ args: ["update"] })).toBe(true)
    expect(shouldSkipAutoUpdateCommand({ args: ["autoupdate"] })).toBe(true)
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
      channel: "nightly",
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
      channel: "nightly",
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
  describe("release channel", () => {
    test("defaults to stable when nothing is configured", async () => {
      const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
      expect(await resolveReleaseChannel({ home, env: {} })).toBe("stable")
    })

    test("reads channel from install.json", async () => {
      const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
      await fs.mkdir(path.join(home, ".clickzetta"), { recursive: true })
      await fs.writeFile(path.join(home, ".clickzetta", "install.json"), JSON.stringify({ channel: "nightly" }))

      expect(await resolveReleaseChannel({ home, env: {} })).toBe("nightly")
    })

    test("CZ_CHANNEL overrides install.json", async () => {
      const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
      await fs.mkdir(path.join(home, ".clickzetta"), { recursive: true })
      await fs.writeFile(path.join(home, ".clickzetta", "install.json"), JSON.stringify({ channel: "nightly" }))

      expect(await resolveReleaseChannel({ home, env: { CZ_CHANNEL: "stable" } })).toBe("stable")
    })

    test("coerces legacy/unknown channel values to stable", async () => {
      const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-home-"))
      await fs.mkdir(path.join(home, ".clickzetta"), { recursive: true })
      await fs.writeFile(path.join(home, ".clickzetta", "install.json"), JSON.stringify({ channel: "latest" }))

      expect(await resolveReleaseChannel({ home, env: {} })).toBe("stable")
    })
  })

  describe("version source is the cz-cli.ai channel, not the install method", () => {
    test("npm method on stable still resolves via cz-cli.ai/api/stable", async () => {
      const urls: string[] = []
      const fetchImpl = mock(async (url: string) => {
        urls.push(url)
        return new Response(JSON.stringify({ version: "0.5.16" }), {
          headers: { "content-type": "application/json" },
        })
      }) as unknown as typeof fetch

      const version = await latestVersionForMethod("npm", fetchImpl, "stable")

      expect(version).toBe("0.5.16")
      expect(urls).toEqual(["https://cz-cli.ai/api/stable"])
    })

    test("npm method on nightly resolves via cz-cli.ai/api/nightly", async () => {
      const urls: string[] = []
      const fetchImpl = mock(async (url: string) => {
        urls.push(url)
        return new Response(JSON.stringify({ version: "dev-v0.5.17.20260609" }), {
          headers: { "content-type": "application/json" },
        })
      }) as unknown as typeof fetch

      const version = await latestVersionForMethod("npm", fetchImpl, "nightly")

      expect(version).toBe("dev-v0.5.17.20260609")
      expect(urls).toEqual(["https://cz-cli.ai/api/nightly"])
    })

    test("never queries the npm registry for version resolution", async () => {
      const urls: string[] = []
      const fetchImpl = mock(async (url: string) => {
        urls.push(url)
        return new Response(JSON.stringify({ version: "0.5.16" }), {
          headers: { "content-type": "application/json" },
        })
      }) as unknown as typeof fetch

      await latestVersionForMethod("bun", fetchImpl, "stable")

      expect(urls.some((u) => u.includes("registry.npmjs.org"))).toBe(false)
    })

    test("nightly dev-v target resolves to an upgrade action", () => {
      const result = resolveUpdateAction({
        autoupdate: true,
        channel: "nightly",
        currentVersion: "1.0.7",
        latestVersion: "dev-v1.0.8.20260616200210",
        now: Date.now(),
        intervalMs: 1,
        method: "curl",
      })

      expect(result).toEqual({ kind: "upgrade", reason: "managed-install" })
    })

    test("nightly dev-v install upgrades to a newer dev-v timestamp", () => {
      const result = resolveUpdateAction({
        autoupdate: true,
        channel: "nightly",
        currentVersion: "dev-v1.0.7.20260616190000",
        latestVersion: "dev-v1.0.7.20260616200210",
        now: Date.now(),
        intervalMs: 1,
        method: "curl",
      })

      expect(result).toEqual({ kind: "upgrade", reason: "managed-install" })
    })
  })

  describe("upgrade channel persistence", () => {
    test("package-manager upgrades receive the resolved release channel", async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-npm-"))
      const bin = path.join(tmp, "bin")
      await fs.mkdir(bin, { recursive: true })
      await fs.writeFile(path.join(bin, "npm"), [
        "#!/bin/sh",
        `printf '%s' "$CZ_CHANNEL" > ${JSON.stringify(path.join(tmp, "channel.txt"))}`,
        "exit 0",
        "",
      ].join("\n"), { mode: 0o755 })

      process.env.PATH = `${bin}${path.delimiter}${envSnapshot.PATH ?? ""}`

      try {
        await performUpgrade("npm", "dev-v0.5.17.20260609", fetch, "nightly")

        expect(await fs.readFile(path.join(tmp, "channel.txt"), "utf-8")).toBe("nightly")
      } finally {
        await fs.rm(tmp, { recursive: true, force: true })
      }
    })
  })

  describe("install script diagnostics", () => {
    test("includes script stderr in install script failure errors", async () => {
      const fetchImpl = mock(async () =>
        new Response(
          [
            "#!/bin/sh",
            'echo "download failed: access denied" >&2',
            "exit 23",
            "",
          ].join("\n"),
        ),
      ) as unknown as typeof fetch

      const upgrade = performUpgrade("curl", "0.5.19", fetchImpl, "stable")

      await expect(upgrade).rejects.toThrow("exit code 23")
      await expect(upgrade).rejects.toThrow("download failed: access denied")
    })

    test("uses the PowerShell install script on Windows", async () => {
      const platform = process.platform
      Object.defineProperty(process, "platform", { value: "win32" })
      const urls: string[] = []
      const fetchImpl = mock(async (url: string) => {
        urls.push(url)
        return new Response(
          [
            "Write-Error 'stop before executing PowerShell'",
            "exit 24",
            "",
          ].join("\n"),
        )
      }) as unknown as typeof fetch

      try {
        await expect(performUpgrade("curl", "0.5.19", fetchImpl, "stable")).rejects.toThrow("powershell")

        expect(urls).toEqual(["https://cz-cli.ai/install.ps1?version=0.5.19"])
      } finally {
        Object.defineProperty(process, "platform", { value: platform })
      }
    })
  })

  describe("channel does not gate auto-update", () => {
    test("resolveUpdateAction upgrades on the stable channel", () => {
      const result = resolveUpdateAction({
        autoupdate: true,
        channel: "stable",
        currentVersion: "0.5.15",
        latestVersion: "0.5.16",
        lastCheckedAt: 0,
        now: 12 * 60 * 60 * 1000 + 1,
        intervalMs: 12 * 60 * 60 * 1000,
        method: "curl",
      })

      expect(result.kind).toBe("upgrade")
    })

    test("shouldSkipAutoUpdateCommand does not skip a real install on any channel", () => {
      expect(shouldSkipAutoUpdateCommand({ args: ["sql"], env: {}, version: "0.5.16" })).toBe(false)
    })

  test("shouldSkipAutoUpdateCommand skips dev/local builds", () => {
    expect(shouldSkipAutoUpdateCommand({ args: ["sql"], env: {}, version: "local" })).toBe(true)
    expect(shouldSkipAutoUpdateCommand({ args: ["sql"], env: {}, version: "dev-v1.0.7.20260616190000" })).toBe(true)
  })
  })


  describe("restartArgs", () => {
    test("binary mode: strips virtual /$bunfs/ entry from argv", () => {
      // In a compiled bun binary: execPath is the real binary, argv[0] is "bun"
      const execPath = "/usr/local/bin/cz-cli"
      const argv = ["bun", "/$bunfs/root/cz-cli", "agent", "--profile", "default"]
      expect(restartArgs(execPath, argv)).toEqual(["agent", "--profile", "default"])
    })

    test("binary mode: works with no user args", () => {
      const execPath = "/home/user/.local/bin/cz-cli"
      const argv = ["bun", "/$bunfs/root/cz-cli"]
      expect(restartArgs(execPath, argv)).toEqual([])
    })

    test("dev mode: returns user args", () => {
      // In dev mode: execPath === argv[0] (both point to bun runtime)
      const execPath = "/opt/homebrew/bin/bun"
      const argv = ["/opt/homebrew/bin/bun", "/workspace/src/index.ts", "agent"]
      expect(restartArgs(execPath, argv)).toEqual(["agent"])
    })

    test("binary mode on Windows: works the same way", () => {
      // bun binary on Windows still uses /$bunfs/ prefix (forward slashes, virtual path)
      const execPath = "C:\\Users\\user\\AppData\\Local\\cz-cli.exe"
      const argv = ["bun", "/$bunfs/root/cz-cli.exe", "sql", "--query", "SELECT 1"]
      expect(restartArgs(execPath, argv)).toEqual(["sql", "--query", "SELECT 1"])
    })
  })
})
