import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "../../..")

describe("cos release logging", () => {
  test("dry-run prints artifact details before upload", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-cos-release-"))
    const distDir = path.join(tmp, "dist")
    const binDir = path.join(distDir, "cz-cli-darwin-arm64", "bin")
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, "cz-cli"), "test-binary")

    try {
      const output = execFileSync(
        process.execPath,
        [
          "run",
          path.join(repoRoot, "scripts", "cos-release.mjs"),
          "--version",
          "1.2.3",
          "--dist",
          distDir,
          "--git-sha",
          "abc123",
          "--build-date",
          "2026-05-28T10:00:00Z",
          "--dry-run",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      )

      expect(output).toContain("Prepared archives:")
      expect(output).toContain("platform=darwin-arm64")
      expect(output).toContain("archive=cz-cli-1.2.3-darwin-arm64.zip")
      expect(output).toContain("target=cz-cli-releases/1.2.3/darwin-arm64/cz-cli-1.2.3-darwin-arm64.zip")
      expect(output).toContain("sha256=")
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("stable channel assets and versions index are written under META-INF", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-cos-release-meta-"))
    const distDir = path.join(tmp, "dist")
    const binDir = path.join(distDir, "cz-cli-darwin-arm64", "bin")
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, "cz-cli"), "test-binary")

    try {
      const output = execFileSync(
        process.execPath,
        [
          "run",
          path.join(repoRoot, "scripts", "cos-release.mjs"),
          "--version",
          "1.2.3",
          "--dist",
          distDir,
          "--git-sha",
          "abc123",
          "--build-date",
          "2026-05-28T10:00:00Z",
          "--promote-stable",
          "--dry-run",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      )

      expect(output).toContain("META-INF/stable/bootstrap.sh")
      expect(output).toContain("META-INF/stable/manifest.json")
      expect(output).toContain("write channel cz-cli-releases/META-INF/stable -> 1.2.3")
      expect(output).toContain("META-INF/versions.json")
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("upload progress reporter logs start, progress milestones, and completion", async () => {
    const Upload = await import("../../../scripts/cos-upload.mjs")
    const lines: string[] = []
    const reporter = Upload.createUploadProgressReporter({
      archiveName: "cz-cli-1.2.3-darwin-arm64.zip",
      filePath: "/tmp/cz-cli-1.2.3-darwin-arm64.zip",
      key: "cz-cli-releases/1.2.3/darwin-arm64/cz-cli-1.2.3-darwin-arm64.zip",
      size: 50 * 1024 * 1024,
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      log: (line: string) => lines.push(line),
      now: (() => {
        let tick = 0
        return () => {
          tick += 5000
          return tick
        }
      })(),
    })

    reporter.start()
    reporter.taskReady("task-123")
    reporter.progress({ loaded: 5 * 1024 * 1024, total: 50 * 1024 * 1024, speed: 2 * 1024 * 1024, percent: 0.1 })
    reporter.progress({ loaded: 6 * 1024 * 1024, total: 50 * 1024 * 1024, speed: 2 * 1024 * 1024, percent: 0.12 })
    reporter.progress({ loaded: 15 * 1024 * 1024, total: 50 * 1024 * 1024, speed: 3 * 1024 * 1024, percent: 0.3 })
    reporter.complete()

    expect(lines[0]).toContain("upload start")
    expect(lines[0]).toContain("cz-cli-1.2.3-darwin-arm64.zip")
    expect(lines[0]).toContain("sha256=0123456789ab")
    expect(lines.some((line) => line.includes("task ready") && line.includes("task-123"))).toBe(true)
    expect(lines.some((line) => line.includes("progress") && line.includes("10%"))).toBe(true)
    expect(lines.some((line) => line.includes("progress") && line.includes("30%"))).toBe(true)
    expect(lines.some((line) => line.includes("upload complete"))).toBe(true)
    expect(lines.filter((line) => line.includes("progress")).length).toBe(2)
  })

  test("uploadAllArchives streams per-platform logs before uploads finish", async () => {
    const Release = await import("../../../scripts/cos-release.mjs")
    const lines: string[] = []
    let firstUploadResolved = false

    const platforms = await Release.uploadAllArchives(
      {
        dryRun: false,
        client: {},
        Bucket: "bucket",
        Region: "region",
      },
      [
        {
          platform: "darwin-arm64",
          archiveName: "cz-cli-1.2.3-darwin-arm64.zip",
          archivePath: "/tmp/cz-cli-1.2.3-darwin-arm64.zip",
          targetKey: "cz-cli-releases/1.2.3/darwin-arm64/cz-cli-1.2.3-darwin-arm64.zip",
          format: "zip",
          size: 10,
          sha256: "a".repeat(64),
        },
        {
          platform: "darwin-x64",
          archiveName: "cz-cli-1.2.3-darwin-x64.zip",
          archivePath: "/tmp/cz-cli-1.2.3-darwin-x64.zip",
          targetKey: "cz-cli-releases/1.2.3/darwin-x64/cz-cli-1.2.3-darwin-x64.zip",
          format: "zip",
          size: 20,
          sha256: "b".repeat(64),
        },
      ],
      {
        uploadFn: async ({ key, log }: { key: string; log: (line: string) => void }) => {
          log(`  → upload start: ${key}`)
          if (key.includes("darwin-arm64")) {
            await new Promise((resolve) => setTimeout(resolve, 20))
            firstUploadResolved = true
          } else {
            expect(lines.some((line) => line.includes("darwin-arm64"))).toBe(true)
            expect(firstUploadResolved).toBe(false)
          }
          return {
            key,
            url: `https://example.com/${key}`,
            size: key.includes("darwin-arm64") ? 10 : 20,
            sha256: key.includes("darwin-arm64") ? "a".repeat(64) : "b".repeat(64),
          }
        },
        log: (line: string) => lines.push(line),
        now: () => new Date("2026-05-28T11:15:15.402Z"),
      },
    )

    expect(lines.some((line) => line.includes("uploading darwin-arm64"))).toBe(true)
    expect(lines.some((line) => line.includes("uploading darwin-x64"))).toBe(true)
    expect(lines.some((line) => line.includes("upload start: cz-cli-releases/1.2.3/darwin-arm64"))).toBe(true)
    expect(Object.keys(platforms).sort()).toEqual(["darwin-arm64", "darwin-x64"])
  })

  test("bootstrap renderers embed the current release metadata and signed archive urls", async () => {
    const Release = await import("../../../scripts/cos-release.mjs")
    const sh = Release.renderBootstrapSh({
      version: "1.2.3",
      channel: "stable",
      platforms: {
        "darwin-arm64": {
          archive: "cz-cli-1.2.3-darwin-arm64.zip",
          format: "zip",
          binary: "cz-cli",
          checksum: "a".repeat(64),
          size: 123,
          objectKey: "cz-cli-releases/1.2.3/darwin-arm64/cz-cli-1.2.3-darwin-arm64.zip",
          url: "https://example.com/darwin-arm64.zip?sign=abc",
          expiresAt: "2031-01-01T00:00:00.000Z",
        },
      },
    })
    const ps1 = Release.renderBootstrapPs1({
      version: "1.2.3",
      channel: "stable",
      platforms: {
        "win32-x64": {
          archive: "cz-cli-1.2.3-win32-x64.zip",
          format: "zip",
          binary: "cz-cli.exe",
          checksum: "b".repeat(64),
          size: 456,
          objectKey: "cz-cli-releases/1.2.3/win32-x64/cz-cli-1.2.3-win32-x64.zip",
          url: "https://example.com/win32-x64.zip?sign=def",
          expiresAt: "2031-01-01T00:00:00.000Z",
        },
      },
    })

    expect(sh).toContain('VERSION="1.2.3"')
    expect(sh).toContain('CHANNEL="stable"')
    expect(sh).toContain('"darwin-arm64")')
    expect(sh).toContain("https://example.com/darwin-arm64.zip?sign=abc")
    expect(sh).toContain('cz-cli --version')
    expect(sh).toContain('A newer version is already installed')
    expect(ps1).toContain("$Version = '1.2.3'")
    expect(ps1).toContain("$Channel = 'stable'")
    expect(ps1).toContain("'win32-x64' {")
    expect(ps1).toContain("https://example.com/win32-x64.zip?sign=def")
    expect(ps1).toContain("Get-Command cz-cli")
    expect(ps1).toContain("A newer version is already installed")
    expect(ps1).toContain('Join-Path $InstallDir "cz-agent.cmd"')
    expect(ps1).toContain("@echo off")
    expect(ps1).toContain(`'"%~dp0cz-cli.exe" agent %*'`)
  })

  test("release installer script supports direct installation options", () => {
    const script = fs.readFileSync(path.join(repoRoot, "scripts", "install.sh"), "utf8")

    expect(script).toContain("Usage: install.sh [options]")
    expect(script).toContain("--binary <path>")
    expect(script).toContain("https://cz-cli.ai/api/stable")
  })
})
