import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
      "- `packages/core/test/model-selection.test.ts` (1 banner)",
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
      "- `packages/core/src/session.ts` (1 banner)",
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

test("auditUpstreamPatches requires the CI-enforced banner manifest section and rejects undocumented bannered files", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cz-patch-missing-manifest-"))
  tempDirs.push(root)
  mkdirSync(path.join(root, "packages/cz-cli"), { recursive: true })
  mkdirSync(path.join(root, "packages/core/src"), { recursive: true })
  mkdirSync(path.join(root, "packages/core/test"), { recursive: true })

  // Renamed/removed manifest heading + stripped Verify test banner
  writeFileSync(
    path.join(root, "packages/cz-cli/UPSTREAM-PATCHES.md"),
    [
      "# Ledger",
      "## Renamed manifest heading",
      "- `packages/core/src/model-selection.ts`",
      "- `packages/core/test/model-selection.test.ts`",
      "## INTRUSIVE patches",
      "### 1. Model selection",
      "- **File:** `packages/core/src/model-selection.ts`",
      "- **What/why:** prefer ClickZetta model.",
      "- **Verify:** `packages/core/test/model-selection.test.ts`",
      "## HOOK-based customizations",
    ].join("\n"),
  )
  writeFileSync(
    path.join(root, "packages/core/src/model-selection.ts"),
    [
      "//======================== cz-cli change ========================",
      "export const model = 'cz'",
      "//====================== end cz-cli change ======================",
    ].join("\n"),
  )
  writeFileSync(path.join(root, "packages/core/test/model-selection.test.ts"), "export const testOk = true\n")

  const result = auditUpstreamPatches(root)
  expect(result.ok).toBe(false)
  expect(
    result.errors.some((e) => e.includes("missing required '## Bannered upstream files (CI-enforced)' section")),
  ).toBe(true)
})

test("auditUpstreamPatches catches partial banner removal in multi-banner files such as provider.ts", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cz-patch-multi-banner-"))
  tempDirs.push(root)
  mkdirSync(path.join(root, "packages/cz-cli"), { recursive: true })
  mkdirSync(path.join(root, "packages/opencode/src/provider"), { recursive: true })

  writeFileSync(
    path.join(root, "packages/cz-cli/UPSTREAM-PATCHES.md"),
    [
      "# Ledger",
      "## Bannered upstream files (CI-enforced)",
      "- `packages/opencode/src/provider/provider.ts` (2 banners)",
      "## INTRUSIVE patches",
      "### 7. Provider model discovery",
      "- **File:** `packages/opencode/src/provider/provider.ts`",
      "- **What/why:** two required blocks (helper + discovery call site).",
      "## HOOK-based customizations",
    ].join("\n"),
  )
  // Only 1 banner block remains after an accidental merge drop of the second block
  writeFileSync(
    path.join(root, "packages/opencode/src/provider/provider.ts"),
    [
      "//======================== cz-cli change ========================",
      "function helperStillHere() {}",
      "//====================== end cz-cli change ======================",
    ].join("\n"),
  )

  const result = auditUpstreamPatches(root)
  expect(result.ok).toBe(false)
  expect(
    result.errors.some(
      (e) =>
        e.includes("packages/opencode/src/provider/provider.ts") &&
        e.includes("expected 2 cz-cli change banner block(s)") &&
        e.includes("found 1"),
    ),
  ).toBe(true)
})

test("auditUpstreamPatches requires the INTRUSIVE patches heading and ignores entries moved under another heading", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cz-patch-missing-intrusive-heading-"))
  tempDirs.push(root)
  mkdirSync(path.join(root, "packages/cz-cli"), { recursive: true })
  mkdirSync(path.join(root, "packages/core/src"), { recursive: true })

  writeFileSync(
    path.join(root, "packages/cz-cli/UPSTREAM-PATCHES.md"),
    [
      "# Ledger",
      "## Bannered upstream files (CI-enforced)",
      "- `packages/core/src/global.ts` (1 banner)",
      "## Historical patches",
      "### 1. Core global",
      "- **File:** `packages/core/src/global.ts`",
      "- **What/why:** isolate dirs.",
      "## HOOK-based customizations",
    ].join("\n"),
  )
  writeFileSync(
    path.join(root, "packages/core/src/global.ts"),
    [
      "//======================== cz-cli change ========================",
      "export const app = 'clickzetta'",
      "//====================== end cz-cli change ======================",
    ].join("\n"),
  )

  const result = auditUpstreamPatches(root)
  expect(result.ok).toBe(false)
  expect(result.errors.some((e) => e.includes("missing required '## INTRUSIVE patches' section"))).toBe(true)
  expect(
    result.errors.some(
      (e) => e.includes("packages/core/src/global.ts") && e.includes("not declared in a banner-bearing INTRUSIVE entry"),
    ),
  ).toBe(true)
})

test("auditUpstreamPatches rejects commented-out registerOpencodeSpinner() calls and fake package.json description strings", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cz-patch-spinner-semantics-"))
  tempDirs.push(root)
  mkdirSync(path.join(root, "packages/cz-cli"), { recursive: true })
  mkdirSync(path.join(root, "packages/tui/src/component/prompt"), { recursive: true })
  mkdirSync(path.join(root, "packages/opencode/src/cli/cmd/run"), { recursive: true })

  writeFileSync(
    path.join(root, "packages/cz-cli/UPSTREAM-PATCHES.md"),
    [
      "# Ledger",
      "## Bannered upstream files (CI-enforced)",
      "- `packages/tui/src/app.tsx` (1 banner)",
      "## INTRUSIVE patches",
      "### 12. Spinner registration",
      "- **File:** `packages/tui/src/app.tsx`",
      "- **What/why:** call `registerOpencodeSpinner()` in every TUI entrypoint.",
      "## HOOK-based customizations",
    ].join("\n"),
  )

  // Put "./component/register-spinner" in description rather than exports
  writeFileSync(
    path.join(root, "packages/tui/package.json"),
    JSON.stringify({
      name: "@opencode-ai/tui",
      description: "mentions ./component/register-spinner only in prose",
      exports: { ".": "./src/index.tsx" },
    }),
  )
  writeFileSync(
    path.join(root, "packages/tui/src/component/register-spinner.ts"),
    [
      'import { registerSpinner } from "opentui-spinner/solid"',
      "export function registerOpencodeSpinner() {",
      "  registerSpinner()",
      "}",
    ].join("\n"),
  )
  // Comment out the call in app.tsx while keeping valid banners
  writeFileSync(
    path.join(root, "packages/tui/src/app.tsx"),
    [
      'import { registerOpencodeSpinner } from "./component/register-spinner"',
      "//======================== cz-cli change ========================",
      "// registerOpencodeSpinner()",
      "//====================== end cz-cli change ======================",
    ].join("\n"),
  )
  for (const [rel, spec] of [
    ["packages/tui/src/component/spinner.tsx", "./register-spinner"],
    ["packages/tui/src/component/prompt/index.tsx", "../register-spinner"],
    ["packages/opencode/src/cli/cmd/run/footer.subagent.tsx", "@opencode-ai/tui/component/register-spinner"],
    ["packages/opencode/src/cli/cmd/run/footer.view.tsx", "@opencode-ai/tui/component/register-spinner"],
  ] as const) {
    writeFileSync(
      path.join(root, rel),
      `import { registerOpencodeSpinner } from "${spec}"\nregisterOpencodeSpinner()\n`,
    )
  }

  const result = auditUpstreamPatches(root)
  expect(result.ok).toBe(false)
  expect(
    result.errors.some((e) => e.includes("packages/tui/package.json") && e.includes("exports['./component/register-spinner']")),
  ).toBe(true)
  expect(
    result.errors.some((e) => e.includes("packages/tui/src/app.tsx") && e.includes("top-level registerOpencodeSpinner() startup call")),
  ).toBe(true)
})

test("auditUpstreamPatches keeps spinner gate active on v1.17.11 baseline even if entry 12 is deleted and rejects calls hidden in unused helpers", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cz-patch-spinner-baseline-"))
  tempDirs.push(root)
  mkdirSync(path.join(root, "packages/cz-cli"), { recursive: true })
  mkdirSync(path.join(root, "packages/tui/src/component/prompt"), { recursive: true })
  mkdirSync(path.join(root, "packages/opencode/src/cli/cmd/run"), { recursive: true })

  // Ledger still records v1.17.11 baseline, but entry 12 was deleted
  writeFileSync(
    path.join(root, "packages/cz-cli/UPSTREAM-PATCHES.md"),
    [
      "# Ledger (currently baselined at v1.17.11)",
      "## Bannered upstream files (CI-enforced)",
      "- `packages/tui/src/app.tsx` (1 banner)",
      "## INTRUSIVE patches",
      "### 1. App patch",
      "- **File:** `packages/tui/src/app.tsx`",
      "- **What/why:** keep banner valid.",
      "## HOOK-based customizations",
    ].join("\n"),
  )
  writeFileSync(
    path.join(root, "packages/tui/package.json"),
    JSON.stringify({
      name: "@opencode-ai/tui",
      version: "1.17.11",
      exports: { "./component/register-spinner": "./src/component/register-spinner.ts" },
    }),
  )
  writeFileSync(
    path.join(root, "packages/tui/src/component/register-spinner.ts"),
    [
      'import { registerSpinner } from "opentui-spinner/solid"',
      "export function registerOpencodeSpinner() {",
      "  registerSpinner()",
      "}",
    ].join("\n"),
  )
  // Startup call moved inside an unused initializer function in app.tsx
  writeFileSync(
    path.join(root, "packages/tui/src/app.tsx"),
    [
      'import { registerOpencodeSpinner } from "./component/register-spinner"',
      "//======================== cz-cli change ========================",
      "function unusedInitializer() {",
      "  registerOpencodeSpinner()",
      "}",
      "//====================== end cz-cli change ======================",
    ].join("\n"),
  )
  // Bare import restored in spinner.tsx
  writeFileSync(path.join(root, "packages/tui/src/component/spinner.tsx"), 'import "opentui-spinner/solid"\n')
  for (const [rel, spec] of [
    ["packages/tui/src/component/prompt/index.tsx", "../register-spinner"],
    ["packages/opencode/src/cli/cmd/run/footer.subagent.tsx", "@opencode-ai/tui/component/register-spinner"],
    ["packages/opencode/src/cli/cmd/run/footer.view.tsx", "@opencode-ai/tui/component/register-spinner"],
  ] as const) {
    writeFileSync(
      path.join(root, rel),
      `import { registerOpencodeSpinner } from "${spec}"\nregisterOpencodeSpinner()\n`,
    )
  }

  const result = auditUpstreamPatches(root)
  expect(result.ok).toBe(false)
  expect(
    result.errors.some((e) => e.includes("missing required registerOpencodeSpinner INTRUSIVE entry while upstream baseline is < 1.18.9")),
  ).toBe(true)
  expect(
    result.errors.some((e) => e.includes("packages/tui/src/component/spinner.tsx") && e.includes('direct import from "opentui-spinner/solid" regressed')),
  ).toBe(true)
  expect(
    result.errors.some((e) => e.includes("packages/tui/src/app.tsx") && e.includes("top-level registerOpencodeSpinner() startup call")),
  ).toBe(true)
})

test("auditUpstreamPatches rejects a no-op registerOpencodeSpinner() wrapper, accepts startup calls after one-line conditionals, and verifies live registration", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cz-patch-noop-wrapper-"))
  tempDirs.push(root)
  mkdirSync(path.join(root, "packages/cz-cli"), { recursive: true })
  mkdirSync(path.join(root, "packages/tui/src/component/prompt"), { recursive: true })
  mkdirSync(path.join(root, "packages/opencode/src/cli/cmd/run"), { recursive: true })

  writeFileSync(
    path.join(root, "packages/cz-cli/UPSTREAM-PATCHES.md"),
    [
      "# Ledger (currently baselined at v1.17.11)",
      "## Bannered upstream files (CI-enforced)",
      "- `packages/tui/src/app.tsx` (1 banner)",
      "## INTRUSIVE patches",
      "### 12. Spinner registration",
      "- **File:** `packages/tui/src/app.tsx`",
      "- **What/why:** call `registerOpencodeSpinner()` in every TUI entrypoint.",
      "## HOOK-based customizations",
    ].join("\n"),
  )
  writeFileSync(
    path.join(root, "packages/tui/package.json"),
    JSON.stringify({
      name: "@opencode-ai/tui",
      version: "1.17.11",
      exports: { "./component/register-spinner": "./src/component/register-spinner.ts" },
    }),
  )
  // No-op wrapper: registerSpinner() is hidden inside an unused inner function
  writeFileSync(
    path.join(root, "packages/tui/src/component/register-spinner.ts"),
    [
      'import { getComponentCatalogue } from "@opentui/solid/components"',
      'import { registerSpinner } from "opentui-spinner/solid"',
      "export function registerOpencodeSpinner() {",
      "  function neverCalled() {",
      "    if (!getComponentCatalogue().spinner) registerSpinner()",
      "  }",
      "  void neverCalled",
      "}",
    ].join("\n"),
  )
  // Valid startup call immediately following a complete one-line conditional without semicolon
  writeFileSync(
    path.join(root, "packages/tui/src/app.tsx"),
    [
      'import { registerOpencodeSpinner } from "./component/register-spinner"',
      "//======================== cz-cli change ========================",
      "if (process.env.DEBUG) console.debug('boot')",
      "registerOpencodeSpinner()",
      "//====================== end cz-cli change ======================",
    ].join("\n"),
  )
  for (const [rel, spec] of [
    ["packages/tui/src/component/spinner.tsx", "./register-spinner"],
    ["packages/tui/src/component/prompt/index.tsx", "../register-spinner"],
    ["packages/opencode/src/cli/cmd/run/footer.subagent.tsx", "@opencode-ai/tui/component/register-spinner"],
    ["packages/opencode/src/cli/cmd/run/footer.view.tsx", "@opencode-ai/tui/component/register-spinner"],
  ] as const) {
    writeFileSync(
      path.join(root, rel),
      `import { registerOpencodeSpinner } from "${spec}"\nregisterOpencodeSpinner()\n`,
    )
  }

  const noopResult = auditUpstreamPatches(root)
  expect(noopResult.ok).toBe(false)
  expect(
    noopResult.errors.some((e) =>
      e.includes("packages/tui/src/component/register-spinner.ts: missing active registerOpencodeSpinner() -> registerSpinner()"),
    ),
  ).toBe(true)
  // Confirm app.tsx's startup call after the complete one-line `if (...) ...` passed!
  expect(noopResult.errors.some((e) => e.includes("packages/tui/src/app.tsx"))).toBe(false)

  // Restore active wrapper and confirm full audit passes
  writeFileSync(
    path.join(root, "packages/tui/src/component/register-spinner.ts"),
    [
      'import { getComponentCatalogue } from "@opentui/solid/components"',
      'import { registerSpinner } from "opentui-spinner/solid"',
      "export function registerOpencodeSpinner() {",
      "  if (!getComponentCatalogue().spinner) registerSpinner()",
      "}",
    ].join("\n"),
  )
  expect(auditUpstreamPatches(root).ok).toBe(true)

  // Multiline braceless `if (\n  false\n)\n  registerOpencodeSpinner()` must FAIL
  writeFileSync(
    path.join(root, "packages/tui/src/app.tsx"),
    [
      'import { registerOpencodeSpinner } from "./component/register-spinner"',
      "//======================== cz-cli change ========================",
      "if (",
      "  false",
      ")",
      "  registerOpencodeSpinner()",
      "//====================== end cz-cli change ======================",
    ].join("\n"),
  )
  const multilineIfResult = auditUpstreamPatches(root)
  expect(multilineIfResult.ok).toBe(false)
  expect(
    multilineIfResult.errors.some((e) =>
      e.includes("packages/tui/src/app.tsx") && e.includes("top-level registerOpencodeSpinner() startup call"),
    ),
  ).toBe(true)

  // Missing Verify test file (e.g. discovery test from entry 7) must FAIL
  writeFileSync(
    path.join(root, "packages/cz-cli/UPSTREAM-PATCHES.md"),
    [
      "# Ledger (currently baselined at v1.17.11)",
      "## Bannered upstream files (CI-enforced)",
      "- `packages/tui/src/app.tsx` (1 banner)",
      "## INTRUSIVE patches",
      "### 7. Provider discovery",
      "- **File:** `packages/tui/src/app.tsx`",
      "- **What/why:** discovery.",
      "- **Verify:** `packages/opencode/test/provider/clickzetta-discovery.test.ts` and `clickzetta-context-limit.test.ts`",
      "### 12. Spinner registration",
      "- **File:** `packages/tui/src/app.tsx`",
      "- **What/why:** call `registerOpencodeSpinner()` in every TUI entrypoint.",
      "## HOOK-based customizations",
    ].join("\n"),
  )
  writeFileSync(
    path.join(root, "packages/tui/src/app.tsx"),
    [
      'import { registerOpencodeSpinner } from "./component/register-spinner"',
      "//======================== cz-cli change ========================",
      "registerOpencodeSpinner()",
      "//====================== end cz-cli change ======================",
    ].join("\n"),
  )
  const missingVerifyResult = auditUpstreamPatches(root)
  expect(missingVerifyResult.ok).toBe(false)
  expect(
    missingVerifyResult.errors.some(
      (e) => e.includes("packages/opencode/test/provider/clickzetta-discovery.test.ts") && e.includes("listed under Verify"),
    ),
  ).toBe(true)
  expect(
    missingVerifyResult.errors.some(
      (e) => e.includes("packages/opencode/test/provider/clickzetta-context-limit.test.ts") && e.includes("listed under Verify"),
    ),
  ).toBe(true)

  const czTestWorkflow = await Bun.file(new URL("../../workflows/cz-test.yml", import.meta.url)).text()
  expect(czTestWorkflow).toContain('test -f "$pkg/$rel"')

  // Execute the real registerOpencodeSpinner() module after clearing spinner to prove wrapper restores missing registration
  const tuiDir = path.resolve(import.meta.dir, "../../../packages/tui")
  if (existsSync(path.join(tuiDir, "node_modules")) || existsSync(path.resolve(tuiDir, "../../node_modules"))) {
    const proc = Bun.spawn(
      [
        process.execPath,
        "-e",
        'import { getComponentCatalogue } from "@opentui/solid/components"; import { registerOpencodeSpinner } from "./src/component/register-spinner.ts"; delete (getComponentCatalogue() as Record<string, unknown>).spinner; if (getComponentCatalogue().spinner) process.exit(2); registerOpencodeSpinner(); if (!getComponentCatalogue().spinner) process.exit(1);',
      ],
      { cwd: tuiDir, stdout: "pipe", stderr: "pipe" },
    )
    expect(await proc.exited).toBe(0)
  }
})
