import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "../../..")

test("macOS build clears quarantine xattr after ad-hoc codesign", () => {
  const script = fs.readFileSync(path.join(repoRoot, "packages", "opencode", "script", "build.ts"), "utf8")

  expect(script).toContain("codesign --remove-signature")
  expect(script).toContain("codesign --force --sign -")
  expect(script).toContain("xattr -dr com.apple.quarantine")
})

test("Windows archive is created from the platform bin directory", () => {
  const script = fs.readFileSync(path.join(repoRoot, "packages", "opencode", "script", "build.ts"), "utf8")

  expect(script).toContain("7z a -tzip ${absArchive} *")
  expect(script).toContain(".cwd(binDir)")
  expect(script).not.toContain("7z a -tzip ${absArchive} ${binDir}\\\\*")
})
