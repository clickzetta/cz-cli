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
})
