import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "../../..")

test("macOS build clears quarantine xattr after ad-hoc codesign", () => {
  const script = fs.readFileSync(path.join(repoRoot, "packages", "opencode", "script", "build.ts"), "utf8")

  expect(script).toContain("codesign --force --sign -")
  expect(script).toContain("xattr -dr com.apple.quarantine")
})
