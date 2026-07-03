import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { assertUpdatedBinaryVersion, describeUpdateError, manualInstallCommandForPlatform, isCzCliInstallBinary, isPackageManagerBinary, resolveUpdateInstallMethod, shouldApplyUpdate } from "../src/commands/update"

describe("shouldApplyUpdate", () => {
  test("refuses to downgrade when the fetched version is older", () => {
    expect(shouldApplyUpdate("0.3.92", "0.3.88", false)).toBe(false)
  })

  test("accepts a newer version", () => {
    expect(shouldApplyUpdate("0.3.88", "0.3.92", false)).toBe(true)
  })

  test("allows downgrade when forced", () => {
    expect(shouldApplyUpdate("0.3.92", "0.3.88", true)).toBe(true)
  })

  test("allows downgrade when an explicit target is requested", () => {
    const targetRequested = true
    expect(shouldApplyUpdate("1.0.20", "1.0.18", targetRequested)).toBe(true)
  })

  test("detects npm global shim paths even when npm prefix points elsewhere", () => {
    expect(isPackageManagerBinary("/Users/liangmo/.npm-global/bin/cz-cli", { npmPrefix: "/opt/homebrew" })).toBe(true)
  })

  test("uses first PATH binary to select npm update path for npm global installs", () => {
    expect(resolveUpdateInstallMethod("/tmp/fallback/cz-cli", ["/Users/liangmo/.npm-global/bin/cz-cli"], { npmPrefix: "/opt/homebrew" })).toBe("npm")
  })

  test("uses which symlink target to select npm update path", () => {
    expect(resolveUpdateInstallMethod("/tmp/fallback/cz-cli", ["/opt/homebrew/bin/cz-cli"], {
      isSymlink: (p) => p === "/opt/homebrew/bin/cz-cli",
      readlink: () => "../lib/node_modules/@clickzetta/cz-cli/bin/run.js",
    })).toBe("npm")
  })

  test("prioritizes which path over exec path when selecting update method", () => {
    expect(resolveUpdateInstallMethod(path.join(os.homedir(), ".local", "bin", "cz-cli"), ["/opt/homebrew/bin/cz-cli"], {
      isSymlink: (p) => p === "/opt/homebrew/bin/cz-cli",
      readlink: () => "../lib/node_modules/@clickzetta/cz-cli/bin/run.js",
    })).toBe("npm")
  })

  test("detects install script binaries from .local/bin", () => {
    expect(isCzCliInstallBinary("/Users/liangmo/.local/bin/cz-cli")).toBe(true)
  })

  test("rejects successful install scripts that leave the wrong binary version", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cz-cli-update-version-"))
    try {
      const binary = path.join(dir, "cz-cli")
      writeFileSync(binary, "#!/bin/sh\necho 1.0.20\n")
      chmodSync(binary, 0o755)

      expect(() => assertUpdatedBinaryVersion(binary, "1.0.18")).toThrow("Installed cz-cli version mismatch")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("formats aborted network errors with url and timeout context", () => {
    expect(describeUpdateError(new DOMException("The operation was aborted.", "AbortError"), {
      timeoutMs: 5000,
      url: "https://cz-cli.ai/api/stable",
    })).toBe("request timed out after 5000ms; url=https://cz-cli.ai/api/stable; error=AbortError: The operation was aborted.")
  })

  test("uses PowerShell manual install command on Windows", () => {
    expect(manualInstallCommandForPlatform("win32")).toContain("install.ps1")
    expect(manualInstallCommandForPlatform("win32")).not.toContain("bash")
  })

  test("uses shell manual install command on Unix platforms", () => {
    expect(manualInstallCommandForPlatform("darwin")).toBe("curl -fsSL https://cz-cli.ai/install.sh | bash")
    expect(manualInstallCommandForPlatform("linux")).toBe("curl -fsSL https://cz-cli.ai/install.sh | bash")
  })
})
