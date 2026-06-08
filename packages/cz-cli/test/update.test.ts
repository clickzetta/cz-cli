import { describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { isCzCliInstallBinary, isPackageManagerBinary, resolveUpdateInstallMethod, shouldApplyUpdate } from "../src/commands/update"

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

  test("keeps recognized exec path when selecting update path", () => {
    expect(resolveUpdateInstallMethod(path.join(os.homedir(), ".local", "bin", "cz-cli"), ["/opt/homebrew/bin/cz-cli"], {
      isSymlink: (p) => p === "/opt/homebrew/bin/cz-cli",
      readlink: () => "../lib/node_modules/@clickzetta/cz-cli/bin/run.js",
    })).toBe("curl")
  })

  test("detects install script binaries from .local/bin", () => {
    expect(isCzCliInstallBinary("/Users/liangmo/.local/bin/cz-cli")).toBe(true)
  })
})
