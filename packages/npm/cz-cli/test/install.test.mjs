import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const loadModule = async () =>
  import(`../bin/platform.js?cacheBust=${Date.now()}-${Math.random().toString(16).slice(2)}`)

test("ensureInstalledBinary returns packaged binary without fallback download", async () => {
  const { ensureInstalledBinary } = await loadModule()
  let installedFromRegistry = false
  const result = await ensureInstalledBinary({
    spec: {
      platform: "darwin",
      arch: "arm64",
      packageName: "@clickzetta/cz-cli-darwin-arm64",
      binaryName: "cz-cli",
    },
    resolvePackageDir: () => "/tmp/pkg",
    existsSync: (candidate) => candidate === "/tmp/pkg/bin/cz-cli",
    installFromNpmRegistry: async () => {
      installedFromRegistry = true
    },
  })

  assert.equal(result.source, "package")
  assert.equal(result.binPath, path.join("/tmp/pkg", "bin", "cz-cli"))
  assert.equal(installedFromRegistry, false)
})

test("ensureInstalledBinary installs fallback binary from npm registry when package is missing", async () => {
  const { ensureInstalledBinary } = await loadModule()
  const fallbackRoot = "/tmp/fallback-root"
  let createdFallback = false

  const result = await ensureInstalledBinary({
    fallbackRoot,
    spec: {
      platform: "darwin",
      arch: "arm64",
      packageName: "@clickzetta/cz-cli-darwin-arm64",
      binaryName: "cz-cli",
    },
    resolvePackageDir: () => null,
    existsSync: (candidate) =>
      candidate === path.join(fallbackRoot, "darwin-arm64", "cz-cli") && createdFallback,
    installFromNpmRegistry: async ({ destinationDir, packageName }) => {
      assert.equal(destinationDir, path.join(fallbackRoot, "darwin-arm64"))
      assert.equal(packageName, "@clickzetta/cz-cli-darwin-arm64")
      createdFallback = true
    },
  })

  assert.equal(result.source, "fallback")
  assert.equal(result.binPath, path.join(fallbackRoot, "darwin-arm64", "cz-cli"))
})

test("ensureInstalledBinary throws when packaged and registry fallback installs fail", async () => {
  const { ensureInstalledBinary } = await loadModule()

  await assert.rejects(
    ensureInstalledBinary({
      fallbackRoot: "/tmp/fallback-root",
      spec: {
        platform: "darwin",
        arch: "arm64",
        packageName: "@clickzetta/cz-cli-darwin-arm64",
        binaryName: "cz-cli",
      },
      resolvePackageDir: () => null,
      installFromNpmRegistry: async () => {},
    }),
    /Unable to install cz-cli binary/,
  )
})

test("ensureInstalledBinary reports optional dependency and registry fallback failures together", async () => {
  const { ensureInstalledBinary } = await loadModule()

  await assert.rejects(
    ensureInstalledBinary({
      fallbackRoot: "/tmp/fallback-root",
      spec: {
        platform: "win32",
        arch: "x64",
        packageName: "@clickzetta/definitely-missing-win32-x64",
        binaryName: "cz-cli.exe",
      },
      installFromNpmRegistry: async () => {
        throw new Error("npm registry self-heal failed for @clickzetta/definitely-missing-win32-x64@1.2.3: 404 Not Found")
      },
      version: "1.2.3",
    }),
    /Optional dependency @clickzetta\/definitely-missing-win32-x64 is not installed[\s\S]*404 Not Found/,
  )
})

test("getPlatformSpec maps supported npm package names", async () => {
  const { getPlatformSpec } = await loadModule()

  assert.equal(
    getPlatformSpec({ platform: "win32", arch: "x64" }).packageName,
    "@clickzetta/cz-cli-win32-x64",
  )
  assert.equal(
    getPlatformSpec({ platform: "darwin", arch: "arm64" }).packageName,
    "@clickzetta/cz-cli-darwin-arm64",
  )
})

test("getPlatformSpec rejects unsupported package combinations", async () => {
  const { getPlatformSpec } = await loadModule()
  assert.equal(getPlatformSpec({ platform: "win32", arch: "arm64" }), null)
  assert.equal(getPlatformSpec({ platform: "linux", arch: "x64" }), null)
  assert.equal(getPlatformSpec({ platform: "freebsd", arch: "x64" }), null)
})

test("package.json optionalDependencies only list published platform packages", () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  assert.deepEqual(
    Object.keys(packageJson.optionalDependencies).sort(),
    [
      "@clickzetta/cz-cli-darwin-arm64",
      "@clickzetta/cz-cli-darwin-x64",
      "@clickzetta/cz-cli-win32-x64",
    ],
  )
})

test("getNpmInvocation uses node + npm_execpath when available", async () => {
  const { getNpmInvocation } = await loadModule()
  const result = getNpmInvocation({ npm_execpath: "/tmp/npm-cli.js" })

  assert.equal(result.command, process.execPath)
  assert.deepEqual(result.args, ["/tmp/npm-cli.js"])
})

test("getNpmInvocation uses npm.cmd on Windows without npm_execpath", async () => {
  const { getNpmInvocation } = await loadModule()
  const platform = Object.getOwnPropertyDescriptor(process, "platform")

  Object.defineProperty(process, "platform", {
    configurable: true,
    value: "win32",
  })

  try {
    const result = getNpmInvocation({})
    assert.equal(result.command, "npm.cmd")
    assert.deepEqual(result.args, [])
  } finally {
    Object.defineProperty(process, "platform", platform)
  }
})

test("ensureInstalledBinary with force=true skips npm pack when package version matches", async () => {
  const { ensureInstalledBinary } = await loadModule()
  const fs = await import("node:fs")
  const os = await import("node:os")
  let installedFromRegistry = false

  const tmpDir = fs.default.mkdtempSync(path.join(os.default.tmpdir(), "cz-test-"))
  fs.default.mkdirSync(path.join(tmpDir, "bin"), { recursive: true })
  fs.default.writeFileSync(path.join(tmpDir, "bin", "cz-cli"), "")
  fs.default.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ version: "0.3.58" }))

  try {
    const result = await ensureInstalledBinary({
      spec: {
        platform: "darwin",
        arch: "arm64",
        packageName: "@clickzetta/cz-cli-darwin-arm64",
        binaryName: "cz-cli",
      },
      version: "0.3.58",
      force: true,
      resolvePackageDir: () => tmpDir,
      installFromNpmRegistry: async () => {
        installedFromRegistry = true
      },
    })

    assert.equal(result.source, "package")
    assert.equal(installedFromRegistry, false)
  } finally {
    fs.default.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test("ensureInstalledBinary with force=true falls back to npm pack when version mismatches", async () => {
  const { ensureInstalledBinary } = await loadModule()
  const fs = await import("node:fs")
  const os = await import("node:os")
  let installedFromRegistry = false
  const fallbackRoot = fs.default.mkdtempSync(path.join(os.default.tmpdir(), "cz-test-fb-"))

  const tmpDir = fs.default.mkdtempSync(path.join(os.default.tmpdir(), "cz-test-old-"))
  fs.default.mkdirSync(path.join(tmpDir, "bin"), { recursive: true })
  fs.default.writeFileSync(path.join(tmpDir, "bin", "cz-cli"), "")
  fs.default.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ version: "0.3.57" }))

  try {
    const result = await ensureInstalledBinary({
      fallbackRoot,
      spec: {
        platform: "darwin",
        arch: "arm64",
        packageName: "@clickzetta/cz-cli-darwin-arm64",
        binaryName: "cz-cli",
      },
      version: "0.3.58",
      force: true,
      resolvePackageDir: () => tmpDir,
      installFromNpmRegistry: async ({ destinationDir }) => {
        fs.default.mkdirSync(destinationDir, { recursive: true })
        fs.default.writeFileSync(path.join(destinationDir, "cz-cli"), "")
        installedFromRegistry = true
      },
    })

    assert.equal(installedFromRegistry, true)
    assert.equal(result.source, "fallback")
  } finally {
    fs.default.rmSync(tmpDir, { recursive: true, force: true })
    fs.default.rmSync(fallbackRoot, { recursive: true, force: true })
  }
})
