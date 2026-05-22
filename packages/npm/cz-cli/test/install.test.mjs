import test from "node:test"
import assert from "node:assert/strict"
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

test("getPlatformSpec maps supported npm package names", async () => {
  const { getPlatformSpec } = await loadModule()

  assert.equal(
    getPlatformSpec({ platform: "win32", arch: "x64" }).packageName,
    "@clickzetta/cz-cli-win32-x64",
  )
  assert.equal(
    getPlatformSpec({ platform: "linux", arch: "x64" }).packageName,
    "@clickzetta/cz-cli-linux-x64",
  )
})

test("getPlatformSpec rejects unsupported package combinations", async () => {
  const { getPlatformSpec } = await loadModule()
  assert.equal(getPlatformSpec({ platform: "win32", arch: "arm64" }), null)
  assert.equal(getPlatformSpec({ platform: "freebsd", arch: "x64" }), null)
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
