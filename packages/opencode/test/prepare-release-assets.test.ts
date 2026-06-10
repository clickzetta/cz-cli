import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "../../..")

describe("prepare release assets", () => {
  test("install.sh clears builtin skills before installing bundled skills", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-install-skills-"))
    const home = path.join(tmp, "home")
    const binary = path.join(tmp, "cz-cli")
    fs.mkdirSync(path.join(tmp, "skills", "fresh-skill"), { recursive: true })
    fs.mkdirSync(path.join(home, ".clickzetta", "skills", ".builtin", "test-skills"), { recursive: true })
    fs.writeFileSync(binary, "#!/bin/sh\n")
    fs.writeFileSync(path.join(tmp, "skills", "fresh-skill", "SKILL.md"), "fresh")

    try {
      execFileSync("bash", [
        path.join(repoRoot, "scripts", "install.sh"),
        "--binary",
        binary,
        "--no-modify-path",
      ], {
        cwd: repoRoot,
        env: { ...process.env, HOME: home, SHELL: "/bin/sh" },
      })

      expect(fs.existsSync(path.join(home, ".clickzetta", "skills", ".builtin", "fresh-skill"))).toBe(true)
      expect(fs.existsSync(path.join(home, ".clickzetta", "skills", ".builtin", "test-skills"))).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("install.sh clears builtin skills when no bundled skills are present", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-install-empty-skills-"))
    const home = path.join(tmp, "home")
    const binary = path.join(tmp, "cz-cli")
    fs.mkdirSync(path.join(home, ".clickzetta", "skills", ".builtin", "test-skills"), { recursive: true })
    fs.writeFileSync(binary, "#!/bin/sh\n")

    try {
      execFileSync("bash", [
        path.join(repoRoot, "scripts", "install.sh"),
        "--binary",
        binary,
        "--no-modify-path",
      ], {
        cwd: repoRoot,
        env: { ...process.env, HOME: home, SHELL: "/bin/sh" },
      })

      expect(fs.existsSync(path.join(home, ".clickzetta", "skills", ".builtin"))).toBe(true)
      expect(fs.existsSync(path.join(home, ".clickzetta", "skills", ".builtin", "test-skills"))).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("npm postinstall clears builtin skills before installing bundled skills", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-postinstall-skills-"))
    const home = path.join(tmp, "home")
    const packageDir = path.join(tmp, "package")
    const installedRoot = path.join(tmp, "installed")
    fs.mkdirSync(path.join(packageDir, "bin"), { recursive: true })
    fs.mkdirSync(path.join(installedRoot, "skills", "fresh-skill"), { recursive: true })
    fs.mkdirSync(path.join(home, ".clickzetta", "skills", ".builtin", "test-skills"), { recursive: true })
    fs.copyFileSync(path.join(repoRoot, "packages", "npm", "cz-cli", "bin", "postinstall.js"), path.join(packageDir, "bin", "postinstall.js"))
    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ version: "0.0.0-test" }))
    fs.writeFileSync(path.join(installedRoot, "cz-cli"), "#!/bin/sh\n[ \"$1\" = \"--version\" ] && echo 0.0.0-test\n", { mode: 0o755 })
    fs.writeFileSync(path.join(installedRoot, "skills", "fresh-skill", "SKILL.md"), "fresh")
    fs.writeFileSync(path.join(packageDir, "bin", "platform.js"), [
      "\"use strict\";",
      "exports.DEFAULT_FALLBACK_ROOT = \"unused\";",
      "exports.getPlatformSpec = () => ({ npmPackage: \"fake\" });",
      `exports.ensureInstalledBinary = async () => ({ rootDir: ${JSON.stringify(installedRoot)}, binPath: ${JSON.stringify(path.join(installedRoot, "cz-cli"))} });`,
      "",
    ].join("\n"))

    try {
      execFileSync(process.execPath, [path.join(packageDir, "bin", "postinstall.js")], {
        cwd: packageDir,
        env: { ...process.env, HOME: home },
      })

      expect(fs.existsSync(path.join(home, ".clickzetta", "skills", ".builtin", "fresh-skill"))).toBe(true)
      expect(fs.existsSync(path.join(home, ".clickzetta", "skills", ".builtin", "test-skills"))).toBe(false)
      expect(fs.existsSync(path.join(home, ".local", "bin", "cz-agent"))).toBe(true)
      expect(fs.statSync(path.join(home, ".local", "bin", "cz-agent")).mode & 0o111).toBeGreaterThan(0)
      expect(fs.existsSync(path.join(home, ".cz-cli", "bin", "cz-agent"))).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("npm postinstall clears builtin skills when no bundled skills are present", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-postinstall-empty-skills-"))
    const home = path.join(tmp, "home")
    const packageDir = path.join(tmp, "package")
    const installedRoot = path.join(tmp, "installed")
    fs.mkdirSync(path.join(packageDir, "bin"), { recursive: true })
    fs.mkdirSync(installedRoot, { recursive: true })
    fs.mkdirSync(path.join(home, ".clickzetta", "skills", ".builtin", "test-skills"), { recursive: true })
    fs.copyFileSync(path.join(repoRoot, "packages", "npm", "cz-cli", "bin", "postinstall.js"), path.join(packageDir, "bin", "postinstall.js"))
    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ version: "0.0.0-test" }))
    fs.writeFileSync(path.join(installedRoot, "cz-cli"), "#!/bin/sh\n[ \"$1\" = \"--version\" ] && echo 0.0.0-test\n", { mode: 0o755 })
    fs.writeFileSync(path.join(packageDir, "bin", "platform.js"), [
      "\"use strict\";",
      "exports.DEFAULT_FALLBACK_ROOT = \"unused\";",
      "exports.getPlatformSpec = () => ({ npmPackage: \"fake\" });",
      `exports.ensureInstalledBinary = async () => ({ rootDir: ${JSON.stringify(installedRoot)}, binPath: ${JSON.stringify(path.join(installedRoot, "cz-cli"))} });`,
      "",
    ].join("\n"))

    try {
      execFileSync(process.execPath, [path.join(packageDir, "bin", "postinstall.js")], {
        cwd: packageDir,
        env: { ...process.env, HOME: home },
      })

      expect(fs.existsSync(path.join(home, ".clickzetta", "skills", ".builtin"))).toBe(true)
      expect(fs.existsSync(path.join(home, ".clickzetta", "skills", ".builtin", "test-skills"))).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("npm postinstall writes install.json with CZ_CHANNEL when provided", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-postinstall-channel-"))
    const home = path.join(tmp, "home")
    const packageDir = path.join(tmp, "package")
    const installedRoot = path.join(tmp, "installed")
    fs.mkdirSync(path.join(packageDir, "bin"), { recursive: true })
    fs.mkdirSync(installedRoot, { recursive: true })
    fs.copyFileSync(path.join(repoRoot, "packages", "npm", "cz-cli", "bin", "postinstall.js"), path.join(packageDir, "bin", "postinstall.js"))
    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ version: "0.0.0-test" }))
    fs.writeFileSync(path.join(installedRoot, "cz-cli"), "#!/bin/sh\n[ \"$1\" = \"--version\" ] && echo 0.0.0-test\n", { mode: 0o755 })
    fs.writeFileSync(path.join(packageDir, "bin", "platform.js"), [
      "\"use strict\";",
      "exports.DEFAULT_FALLBACK_ROOT = \"unused\";",
      "exports.getPlatformSpec = () => ({ npmPackage: \"fake\" });",
      `exports.ensureInstalledBinary = async () => ({ rootDir: ${JSON.stringify(installedRoot)}, binPath: ${JSON.stringify(path.join(installedRoot, "cz-cli"))} });`,
      "",
    ].join("\n"))

    try {
      execFileSync(process.execPath, [path.join(packageDir, "bin", "postinstall.js")], {
        cwd: packageDir,
        env: { ...process.env, HOME: home, CZ_CHANNEL: "nightly" },
      })

      expect(JSON.parse(fs.readFileSync(path.join(home, ".clickzetta", "install.json"), "utf-8")).channel).toBe("nightly")
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("setup.sh clears builtin skills before installing bundled skills", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-setup-skills-"))
    const installDir = path.join(tmp, "bin")
    const home = path.join(tmp, "home")
    const packageDir = path.join(tmp, "package")
    fs.mkdirSync(path.join(packageDir, "skills", "fresh-skill"), { recursive: true })
    fs.mkdirSync(path.join(home, ".clickzetta", "skills", ".builtin", "test-skills"), { recursive: true })
    fs.writeFileSync(path.join(packageDir, "cz-cli"), "#!/bin/sh\n")
    fs.writeFileSync(path.join(packageDir, "skills", "fresh-skill", "SKILL.md"), "fresh")
    fs.copyFileSync(path.join(repoRoot, "scripts", "setup.sh"), path.join(packageDir, "setup.sh"))

    try {
      execFileSync("sh", [path.join(packageDir, "setup.sh")], {
        cwd: packageDir,
        env: { ...process.env, HOME: home, INSTALL_DIR: installDir },
      })

      expect(fs.existsSync(path.join(home, ".clickzetta", "skills", ".builtin", "fresh-skill"))).toBe(true)
      expect(fs.existsSync(path.join(home, ".clickzetta", "skills", ".builtin", "test-skills"))).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("setup.sh writes install.json with the release channel (stable default, CZ_CHANNEL override)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-setup-meta-"))
    const packageDir = path.join(tmp, "package")
    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(path.join(packageDir, "cz-cli"), "#!/bin/sh\n")
    fs.copyFileSync(path.join(repoRoot, "scripts", "setup.sh"), path.join(packageDir, "setup.sh"))

    const run = (home: string, env: Record<string, string>) => {
      execFileSync("sh", [path.join(packageDir, "setup.sh")], {
        cwd: packageDir,
        env: { ...process.env, HOME: home, INSTALL_DIR: path.join(home, "bin"), ...env },
      })
      return JSON.parse(fs.readFileSync(path.join(home, ".clickzetta", "install.json"), "utf-8"))
    }

    try {
      const stable = run(path.join(tmp, "stable"), { CZ_VERSION: "0.5.16" })
      expect(stable.channel).toBe("stable")
      expect(stable.binary_version).toBe("0.5.16")
      expect(stable.installed_path).toBe(path.join(tmp, "stable", "bin", "cz-cli"))

      const nightly = run(path.join(tmp, "nightly"), { CZ_VERSION: "0.5.16", CZ_CHANNEL: "nightly" })
      expect(nightly.channel).toBe("nightly")
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("install.sh fetches version metadata from the requested release channel", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-install-channel-"))
    const home = path.join(tmp, "home")
    const fakeBin = path.join(tmp, "bin")
    const archiveRoot = path.join(tmp, "archive")
    const archive = path.join(tmp, "cz-cli.zip")
    fs.mkdirSync(fakeBin, { recursive: true })
    fs.mkdirSync(archiveRoot, { recursive: true })
    fs.writeFileSync(path.join(archiveRoot, "cz-cli"), "#!/bin/sh\n")
    execFileSync("zip", ["-rq", archive, "."], { cwd: archiveRoot })
    fs.writeFileSync(path.join(fakeBin, "curl"), [
      "#!/bin/sh",
      `printf '%s\n' "$@" >> ${JSON.stringify(path.join(tmp, "curl.log"))}`,
      `case "$*" in`,
      `  *api/nightly*) printf '{"version":"0.5.17-dev.20260609"}'; exit 0 ;;`,
      `  *api/stable*) printf '{"version":"0.5.16"}'; exit 0 ;;`,
      "esac",
      "out=''",
      "prev=''",
      "for arg in \"$@\"; do",
      "  if [ \"$prev\" = '-o' ]; then out=\"$arg\"; fi",
      "  prev=\"$arg\"",
      "done",
      `cp ${JSON.stringify(archive)} "$out"`,
      "exit 0",
      "",
    ].join("\n"), { mode: 0o755 })

    try {
      execFileSync("bash", [
        path.join(repoRoot, "scripts", "install.sh"),
        "--no-modify-path",
      ], {
        cwd: repoRoot,
        env: { ...process.env, HOME: home, SHELL: "/bin/sh", CZ_CHANNEL: "nightly", CZ_FORCE: "", PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
      })

      expect(fs.readFileSync(path.join(tmp, "curl.log"), "utf-8")).toContain("https://cz-cli.ai/api/nightly")
      expect(JSON.parse(fs.readFileSync(path.join(home, ".clickzetta", "install.json"), "utf-8")).binary_version).toBe("0.5.17-dev.20260609")
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  const externalAgentSkillDirs = [
    [".claude", "skills"],
    [".kiro", "skills"],
    [".cursor", "skills"],
    [".codex", "skills"],
    [".openclaw", "workspace", "skills"],
    [".singclaw", "workspace", "skills"],
  ]

  test("install.sh installs cz-cli skill into external agent dirs (delete-then-install)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-install-ext-skills-"))
    const home = path.join(tmp, "home")
    const binary = path.join(tmp, "cz-cli")
    fs.mkdirSync(path.join(tmp, "skills", "cz-cli"), { recursive: true })
    fs.writeFileSync(binary, "#!/bin/sh\n")
    fs.writeFileSync(path.join(tmp, "skills", "cz-cli", "SKILL.md"), "fresh-cz-cli")
    // Pre-existing stale skill must be replaced, not merged.
    fs.mkdirSync(path.join(home, ".claude", "skills", "cz-cli"), { recursive: true })
    fs.writeFileSync(path.join(home, ".claude", "skills", "cz-cli", "STALE.md"), "old")

    try {
      execFileSync("bash", [
        path.join(repoRoot, "scripts", "install.sh"),
        "--binary",
        binary,
        "--no-modify-path",
      ], {
        cwd: repoRoot,
        env: { ...process.env, HOME: home, SHELL: "/bin/sh" },
      })

      for (const seg of externalAgentSkillDirs) {
        const skillMd = path.join(home, ...seg, "cz-cli", "SKILL.md")
        expect(fs.existsSync(skillMd)).toBe(true)
        expect(fs.readFileSync(skillMd, "utf-8")).toBe("fresh-cz-cli")
      }
      expect(fs.existsSync(path.join(home, ".claude", "skills", "cz-cli", "STALE.md"))).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("install.sh skips external agent registration when no cz-cli skill is bundled", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-install-ext-none-"))
    const home = path.join(tmp, "home")
    const binary = path.join(tmp, "cz-cli")
    fs.mkdirSync(path.join(tmp, "skills", "other-skill"), { recursive: true })
    fs.writeFileSync(binary, "#!/bin/sh\n")
    fs.writeFileSync(path.join(tmp, "skills", "other-skill", "SKILL.md"), "other")

    try {
      execFileSync("bash", [
        path.join(repoRoot, "scripts", "install.sh"),
        "--binary",
        binary,
        "--no-modify-path",
      ], {
        cwd: repoRoot,
        env: { ...process.env, HOME: home, SHELL: "/bin/sh" },
      })

      expect(fs.existsSync(path.join(home, ".claude", "skills", "cz-cli"))).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("npm postinstall installs cz-cli skill into external agent dirs (delete-then-install)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-postinstall-ext-skills-"))
    const home = path.join(tmp, "home")
    const packageDir = path.join(tmp, "package")
    const installedRoot = path.join(tmp, "installed")
    fs.mkdirSync(path.join(packageDir, "bin"), { recursive: true })
    fs.mkdirSync(path.join(installedRoot, "skills", "cz-cli"), { recursive: true })
    fs.writeFileSync(path.join(installedRoot, "skills", "cz-cli", "SKILL.md"), "fresh-cz-cli")
    // Pre-existing stale skill in one agent dir must be replaced.
    fs.mkdirSync(path.join(home, ".kiro", "skills", "cz-cli"), { recursive: true })
    fs.writeFileSync(path.join(home, ".kiro", "skills", "cz-cli", "STALE.md"), "old")
    fs.copyFileSync(path.join(repoRoot, "packages", "npm", "cz-cli", "bin", "postinstall.js"), path.join(packageDir, "bin", "postinstall.js"))
    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ version: "0.0.0-test" }))
    fs.writeFileSync(path.join(installedRoot, "cz-cli"), "#!/bin/sh\n[ \"$1\" = \"--version\" ] && echo 0.0.0-test\n", { mode: 0o755 })
    fs.writeFileSync(path.join(packageDir, "bin", "platform.js"), [
      "\"use strict\";",
      "exports.DEFAULT_FALLBACK_ROOT = \"unused\";",
      "exports.getPlatformSpec = () => ({ npmPackage: \"fake\" });",
      `exports.ensureInstalledBinary = async () => ({ rootDir: ${JSON.stringify(installedRoot)}, binPath: ${JSON.stringify(path.join(installedRoot, "cz-cli"))} });`,
      "",
    ].join("\n"))

    try {
      execFileSync(process.execPath, [path.join(packageDir, "bin", "postinstall.js")], {
        cwd: packageDir,
        env: { ...process.env, HOME: home },
      })

      for (const seg of externalAgentSkillDirs) {
        const skillMd = path.join(home, ...seg, "cz-cli", "SKILL.md")
        expect(fs.existsSync(skillMd)).toBe(true)
        expect(fs.readFileSync(skillMd, "utf-8")).toBe("fresh-cz-cli")
      }
      expect(fs.existsSync(path.join(home, ".kiro", "skills", "cz-cli", "STALE.md"))).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("setup.sh installs cz-cli skill into external agent dirs (delete-then-install)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-setup-ext-skills-"))
    const installDir = path.join(tmp, "bin")
    const home = path.join(tmp, "home")
    const packageDir = path.join(tmp, "package")
    fs.mkdirSync(path.join(packageDir, "skills", "cz-cli"), { recursive: true })
    fs.writeFileSync(path.join(packageDir, "cz-cli"), "#!/bin/sh\n")
    fs.writeFileSync(path.join(packageDir, "skills", "cz-cli", "SKILL.md"), "fresh-cz-cli")
    fs.copyFileSync(path.join(repoRoot, "scripts", "setup.sh"), path.join(packageDir, "setup.sh"))
    // Pre-existing stale skill must be replaced.
    fs.mkdirSync(path.join(home, ".codex", "skills", "cz-cli"), { recursive: true })
    fs.writeFileSync(path.join(home, ".codex", "skills", "cz-cli", "STALE.md"), "old")

    try {
      execFileSync("sh", [path.join(packageDir, "setup.sh")], {
        cwd: packageDir,
        env: { ...process.env, HOME: home, INSTALL_DIR: installDir },
      })

      for (const seg of externalAgentSkillDirs) {
        const skillMd = path.join(home, ...seg, "cz-cli", "SKILL.md")
        expect(fs.existsSync(skillMd)).toBe(true)
        expect(fs.readFileSync(skillMd, "utf-8")).toBe("fresh-cz-cli")
      }
      expect(fs.existsSync(path.join(home, ".codex", "skills", "cz-cli", "STALE.md"))).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("extracts GitHub release archives into dist directories", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-release-assets-"))
    const assetsDir = path.join(tmp, "assets")
    const distDir = path.join(tmp, "dist")
    fs.mkdirSync(path.join(tmp, "darwin-bin"), { recursive: true })
    fs.mkdirSync(path.join(tmp, "linux-bin"), { recursive: true })
    fs.mkdirSync(path.join(tmp, "windows-bin"), { recursive: true })
    fs.writeFileSync(path.join(tmp, "darwin-bin", "cz-cli"), "darwin")
    fs.writeFileSync(path.join(tmp, "linux-bin", "cz-cli"), "linux")
    fs.writeFileSync(path.join(tmp, "windows-bin", "cz-cli.exe"), "windows")
    fs.mkdirSync(assetsDir)

    try {
      execFileSync("zip", ["-rq", path.join(assetsDir, "cz-cli-darwin-arm64.zip"), "."], {
        cwd: path.join(tmp, "darwin-bin"),
      })
      execFileSync("tar", ["-czf", path.join(assetsDir, "cz-cli-linux-x64.tar.gz"), "."], {
        cwd: path.join(tmp, "linux-bin"),
      })
      execFileSync("zip", ["-rq", path.join(assetsDir, "cz-cli-windows-x64.zip"), "."], {
        cwd: path.join(tmp, "windows-bin"),
      })
      fs.writeFileSync(path.join(assetsDir, "cz-cli-checksums.txt"), "ignored")

      execFileSync(
        process.execPath,
        ["run", path.join(repoRoot, "scripts", "prepare-release-assets.mjs"), assetsDir, distDir],
        { cwd: repoRoot },
      )

      expect(fs.readFileSync(path.join(distDir, "cz-cli-darwin-arm64", "bin", "cz-cli"), "utf8")).toBe("darwin")
      expect(fs.readFileSync(path.join(distDir, "cz-cli-linux-x64", "bin", "cz-cli"), "utf8")).toBe("linux")
      expect(fs.readFileSync(path.join(distDir, "cz-cli-windows-x64", "bin", "cz-cli.exe"), "utf8")).toBe("windows")
      expect(fs.existsSync(path.join(distDir, "cz-cli-checksums.txt"))).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("treats unzip warning exit code as non-fatal", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-release-assets-unzip-warning-"))
    const assetsDir = path.join(tmp, "assets")
    const distDir = path.join(tmp, "dist")
    const binDir = path.join(tmp, "fake-bin")
    fs.mkdirSync(assetsDir)
    fs.mkdirSync(binDir)
    fs.writeFileSync(path.join(assetsDir, "cz-cli-windows-x64.zip"), "fake")
    fs.writeFileSync(
      path.join(binDir, "unzip"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "dest=\"\"",
        "while [ \"$#\" -gt 0 ]; do",
        "  if [ \"$1\" = \"-d\" ]; then",
        "    dest=\"$2\"",
        "    shift 2",
        "    continue",
        "  fi",
        "  shift",
        "done",
        "mkdir -p \"$dest\"",
        "printf windows > \"$dest/cz-cli.exe\"",
        "exit 1",
        "",
      ].join("\n"),
      { mode: 0o755 },
    )

    try {
      execFileSync(
        process.execPath,
        ["run", path.join(repoRoot, "scripts", "prepare-release-assets.mjs"), assetsDir, distDir],
        {
          cwd: repoRoot,
          env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
        },
      )

      expect(fs.readFileSync(path.join(distDir, "cz-cli-windows-x64", "bin", "cz-cli.exe"), "utf8")).toBe("windows")
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
