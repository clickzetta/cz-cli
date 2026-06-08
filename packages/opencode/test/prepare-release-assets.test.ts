import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "../../..")

describe("prepare release assets", () => {
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
