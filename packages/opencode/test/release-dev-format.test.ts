import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "../../..")

describe("dev release version format", () => {
  test("make tag-dev uses dev-v prefixed tags", () => {
    const output = execFileSync("make", ["-n", "tag-dev", "VERSION=1.0.7", "DEV_SUFFIX=20260616200210"], {
      cwd: repoRoot,
      encoding: "utf8",
    })

    expect(output).toContain("git tag dev-v1.0.7.20260616200210")
    expect(output).toContain("git push origin dev-v1.0.7.20260616200210")
    expect(output).not.toContain("v1.0.7-dev.20260616200210")
  })

  test("release workflow accepts dev-v tags and rejects old dev tags", () => {
    const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "release-cos.yml"), "utf8")

    expect(workflow).toContain("dev-v[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9A-Za-z.-]+")
    expect(workflow).not.toContain("[0-9]+\\.[0-9]+\\.[0-9]+-dev")
  })

  test("build release uploads dev-v archives to the matching tag", () => {
    const buildScript = fs.readFileSync(path.join(repoRoot, "packages", "opencode", "script", "build.ts"), "utf8")

    expect(buildScript).toContain('Script.version.startsWith("dev-v") ? Script.version : `v${Script.version}`')
    expect(buildScript).not.toContain("gh release upload v${Script.version}")
  })

  test("cos release accepts dev-v versions for nightly channel", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-dev-release-"))
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
          "dev-v1.0.7.20260616200210",
          "--dist",
          distDir,
          "--git-sha",
          "abc123",
          "--build-date",
          "2026-06-16T12:02:10Z",
          "--dry-run",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      )

      expect(output).toContain("archive=cz-cli-dev-v1.0.7.20260616200210-darwin-arm64.zip")
      expect(output).toContain("target=cz-cli-releases/dev-v1.0.7.20260616200210/darwin-arm64/cz-cli-dev-v1.0.7.20260616200210-darwin-arm64.zip")
      expect(output).toContain("META-INF/channels/nightly/manifest.json")
      expect(output).toContain('"nightly": "dev-v1.0.7.20260616200210"')
      expect(output).not.toContain("META-INF/channels/nightly/version")
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("nightly install script embeds the dev-v version", async () => {
    const Release = await import("../../../scripts/cos-release.mjs")
    const sh = Release.renderBootstrapSh({
      version: "dev-v1.0.7.20260616200210",
      channel: "nightly",
      platforms: {
        "darwin-arm64": {
          archive: "cz-cli-dev-v1.0.7.20260616200210-darwin-arm64.zip",
          format: "zip",
          binary: "cz-cli",
          checksum: "a".repeat(64),
          size: 123,
          objectKey: "cz-cli-releases/dev-v1.0.7.20260616200210/darwin-arm64/cz-cli-dev-v1.0.7.20260616200210-darwin-arm64.zip",
          url: "https://example.com/darwin-arm64.zip?sign=abc",
          expiresAt: "2031-01-01T00:00:00.000Z",
        },
      },
    })

    expect(sh).toContain('VERSION="dev-v1.0.7.20260616200210"')
    expect(sh).toContain('CHANNEL="nightly"')
    expect(sh).not.toContain("version_gt")
    expect(sh).toContain('CZ_VERSION="$VERSION"')
    expect(sh).toContain('CZ_CHANNEL="$CHANNEL"')
  })

  test("release version comparison orders dev-v timestamps within the same base version", async () => {
    const Release = await import("../../../scripts/cos-release.mjs")
    const Promote = await import("../../../scripts/cos-promote.mjs")

    expect(Release.compareReleaseVersions("dev-v1.0.7.20260616200210", "dev-v1.0.7.20260616190000")).toBeGreaterThan(0)
    expect(Release.compareReleaseVersions("dev-v1.0.7.20260616190000", "dev-v1.0.7.20260616200210")).toBeLessThan(0)
    expect(Promote.compareReleaseVersions("dev-v1.0.7.20260616200210", "dev-v1.0.7.20260616190000")).toBeGreaterThan(0)
  })
})
