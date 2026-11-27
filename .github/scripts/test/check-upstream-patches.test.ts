import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { auditUpstreamPatches } from "../../../scripts/check-upstream-patches"

const tempDirs: string[] = []
afterEach(() => {
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

test("real repository passes upstream patch banner and ledger audit", () => {
  const repoRoot = path.resolve(import.meta.dir, "../../..")
  const result = auditUpstreamPatches(repoRoot)
  expect(result.errors).toEqual([])
  expect(result.ok).toBe(true)
  expect(result.bannerFiles.length).toBeGreaterThanOrEqual(12)
})

test("auditUpstreamPatches catches unclosed banners, unrecorded edits, and bare cz_change comments", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cz-patch-audit-"))
  tempDirs.push(root)
  mkdirSync(path.join(root, "packages/cz-cli"), { recursive: true })
  mkdirSync(path.join(root, "packages/core/src"), { recursive: true })
  mkdirSync(path.join(root, "packages/opencode/src"), { recursive: true })

  writeFileSync(
    path.join(root, "packages/cz-cli/UPSTREAM-PATCHES.md"),
    [
      "# Ledger",
      "## INTRUSIVE patches",
      "### 1. Core global",
      "- **File:** `packages/core/src/global.ts`",
      "- **What/why:** isolate dirs.",
      "## HOOK-based customizations",
    ].join("\n"),
  )

  // Missing banner on documented intrusive file + bare cz_change comment
  writeFileSync(path.join(root, "packages/core/src/global.ts"), "// cz_change: forgot banner\nexport const app = 'clickzetta'\n")
  // Unclosed & undocumented banner in another upstream file
  writeFileSync(
    path.join(root, "packages/opencode/src/undocumented.ts"),
    "//======================== cz-cli change ========================\nexport const x = 1\n",
  )

  const result = auditUpstreamPatches(root)
  expect(result.ok).toBe(false)
  expect(result.errors.some((e) => e.includes("bare cz_change: comment"))).toBe(true)
  expect(result.errors.some((e) => e.includes("unclosed cz-cli change banner"))).toBe(true)
  expect(result.errors.some((e) => e.includes("not declared in a banner-bearing INTRUSIVE entry"))).toBe(true)
  expect(result.errors.some((e) => e.includes("has no cz-cli change banner"))).toBe(true)
})

test("auditUpstreamPatches rejects banners placed in HOOK-only upstream files", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cz-patch-hook-only-"))
  tempDirs.push(root)
  mkdirSync(path.join(root, "packages/cz-cli"), { recursive: true })
  mkdirSync(path.join(root, "packages/opencode/src/cli"), { recursive: true })

  writeFileSync(
    path.join(root, "packages/cz-cli/UPSTREAM-PATCHES.md"),
    [
      "# Ledger",
      "## INTRUSIVE patches",
      "## HOOK-based customizations",
      "### 1. Hook check",
      "- Upstream hook to re-verify: `packages/opencode/src/cli/upgrade.ts`",
    ].join("\n"),
  )
  writeFileSync(
    path.join(root, "packages/opencode/src/cli/upgrade.ts"),
    [
      "//======================== cz-cli change ========================",
      "export const sneaky = true",
      "//====================== end cz-cli change ======================",
    ].join("\n"),
  )

  const result = auditUpstreamPatches(root)
  expect(result.ok).toBe(false)
  expect(result.errors.some((e) => e.includes("not declared in a banner-bearing INTRUSIVE entry"))).toBe(true)
})

test("auditUpstreamPatches catches missing banners on explicit Bannered upstream files manifest entries including Verify tests", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cz-patch-manifest-"))
  tempDirs.push(root)
  mkdirSync(path.join(root, "packages/cz-cli"), { recursive: true })
  mkdirSync(path.join(root, "packages/core/test"), { recursive: true })

  writeFileSync(
    path.join(root, "packages/cz-cli/UPSTREAM-PATCHES.md"),
    [
      "# Ledger",
      "## Bannered upstream files (CI-enforced)",
      "- `packages/core/test/model-selection.test.ts`",
      "## INTRUSIVE patches",
      "### 1. Model selection",
      "- **Verify:** `packages/core/test/model-selection.test.ts`",
      "## HOOK-based customizations",
    ].join("\n"),
  )
  // File exists without any cz-cli change banner
  writeFileSync(path.join(root, "packages/core/test/model-selection.test.ts"), "export const ok = true\n")

  const result = auditUpstreamPatches(root)
  expect(result.ok).toBe(false)
  expect(result.errors.some((e) => e.includes("packages/core/test/model-selection.test.ts") && e.includes("has no cz-cli change banner"))).toBe(true)
})

test("auditUpstreamPatches fails when an INTRUSIVE ledger entry is removed while manifest row and source banners remain", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cz-patch-missing-entry-"))
  tempDirs.push(root)
  mkdirSync(path.join(root, "packages/cz-cli"), { recursive: true })
  mkdirSync(path.join(root, "packages/core/src"), { recursive: true })

  writeFileSync(
    path.join(root, "packages/cz-cli/UPSTREAM-PATCHES.md"),
    [
      "# Ledger",
      "## Bannered upstream files (CI-enforced)",
      "- `packages/core/src/session.ts`",
      "## INTRUSIVE patches",
      "## HOOK-based customizations",
    ].join("\n"),
  )
  writeFileSync(
    path.join(root, "packages/core/src/session.ts"),
    [
      "//======================== cz-cli change ========================",
      "export const patched = true",
      "//====================== end cz-cli change ======================",
    ].join("\n"),
  )

  const result = auditUpstreamPatches(root)
  expect(result.ok).toBe(false)
  expect(
    result.errors.some(
      (e) => e.includes("packages/core/src/session.ts") && e.includes("not declared in a banner-bearing INTRUSIVE entry"),
    ),
  ).toBe(true)
})
