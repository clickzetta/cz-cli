#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const UPSTREAM_PACKAGES = ["packages/core", "packages/opencode", "packages/tui", "packages/schema"] as const
const START_BANNER = "//======================== cz-cli change ========================"
const END_BANNER = "//====================== end cz-cli change ======================"
const IGNORED_DIRS = new Set(["node_modules", "dist", "generated", "generated-effect", ".turbo", ".git"])

const SPINNER_CALL_SITES = [
  "packages/tui/src/app.tsx",
  "packages/tui/src/component/spinner.tsx",
  "packages/tui/src/component/prompt/index.tsx",
  "packages/opencode/src/cli/cmd/run/footer.subagent.tsx",
  "packages/opencode/src/cli/cmd/run/footer.view.tsx",
] as const

export type PatchAuditResult = {
  ok: boolean
  bannerFiles: string[]
  errors: string[]
}

export function auditUpstreamPatches(repoRoot: string): PatchAuditResult {
  const errors: string[] = []
  const ledgerPath = path.join(repoRoot, "packages/cz-cli/UPSTREAM-PATCHES.md")
  if (!existsSync(ledgerPath)) {
    return {
      ok: false,
      bannerFiles: [],
      errors: ["Missing packages/cz-cli/UPSTREAM-PATCHES.md"],
    }
  }
  const ledgerText = readFileSync(ledgerPath, "utf8")
  const intrusiveSection = ledgerText.split("## HOOK-based customizations")[0] ?? ledgerText
  const newCzOwnedFiles = new Set(
    [...intrusiveSection.matchAll(/`(packages\/(?:core|opencode|tui|schema)\/[^`\s]+\.(?:ts|tsx))`\s*\(new\b/g)].map(
      (match) => match[1]!,
    ),
  )
  const bannerFiles: string[] = []

  UPSTREAM_PACKAGES.forEach((pkgRel) => {
    const pkgDir = path.join(repoRoot, pkgRel)
    if (!existsSync(pkgDir)) return
    walkSourceFiles(pkgDir).forEach((absFile) => {
      const relFile = path.relative(repoRoot, absFile).split(path.sep).join("/")
      const content = readFileSync(absFile, "utf8")
      const lines = content.split("\n")
      const state = { openLine: 0, bannerCount: 0 }

      lines.forEach((line, index) => {
        const trimmed = line.trim()
        const lineNo = index + 1
        if (trimmed === START_BANNER) {
          if (state.openLine !== 0) {
            errors.push(`${relFile}:${lineNo}: nested cz-cli change banner (previous opened at line ${state.openLine})`)
            return
          }
          state.openLine = lineNo
          state.bannerCount += 1
          return
        }
        if (trimmed === END_BANNER) {
          if (state.openLine === 0) {
            errors.push(`${relFile}:${lineNo}: unmatched end cz-cli change banner`)
            return
          }
          state.openLine = 0
          return
        }
        if (trimmed.includes("cz-cli change")) {
          errors.push(
            `${relFile}:${lineNo}: malformed cz-cli change banner; use exact "${START_BANNER}" / "${END_BANNER}"`,
          )
        }
        if (
          state.openLine === 0 &&
          relFile.includes("/src/") &&
          !newCzOwnedFiles.has(relFile) &&
          /\bcz_change:/.test(line)
        ) {
          errors.push(
            `${relFile}:${lineNo}: bare cz_change: comment outside a cz-cli change banner in upstream package`,
          )
        }
      })

      if (state.openLine !== 0) {
        errors.push(`${relFile}:${state.openLine}: unclosed cz-cli change banner`)
      }
      if (state.bannerCount > 0) {
        bannerFiles.push(relFile)
        if (!ledgerText.includes(`\`${relFile}\``)) {
          errors.push(`${relFile}: contains cz-cli change banner(s) but is not documented in UPSTREAM-PATCHES.md`)
        }
      }
    })
  })

  // Verify every intrusive upstream source/test file listed before "## HOOK-based customizations" still exists and has banners
  // (excluding entry 12 spinner backport, which explicitly documents its no-banner invariant).
  const entryBlocks = intrusiveSection.split(/\n### \d+\.\s+/).slice(1)
  const bannerSet = new Set(bannerFiles)

  entryBlocks.forEach((block) => {
    const noBannerIntentional = block.includes("No `cz-cli change` banner, deliberately")
    const bulletLines = block
      .split("\n")
      .filter((line) => /^\s*-\s+\*\*(?:Files?|cz files):\*\*/.test(line) || /^\s{2,}`packages\//.test(line))
    const pathsInBullets = block
      .slice(0, block.indexOf("\n- **What/why:**") > 0 ? block.indexOf("\n- **What/why:**") : block.length)
      .match(/`packages\/(?:core|opencode|tui|schema)\/[^`\s]+\.(?:ts|tsx)`/g) ?? []
    void bulletLines

    pathsInBullets.map((token) => token.slice(1, -1)).forEach((relPath) => {
      const full = path.join(repoRoot, relPath)
      if (!existsSync(full)) {
        errors.push(`${relPath}: listed in UPSTREAM-PATCHES.md INTRUSIVE section but file is missing`)
        return
      }
      if (noBannerIntentional) return
      // Newly added cz-owned files (like sql-command.ts) or modified upstream files: check modified upstream files carry banners.
      const isNewCzOwnedFile = block.includes(`\`${relPath}\` (new`)
      if (!isNewCzOwnedFile && !bannerSet.has(relPath)) {
        errors.push(`${relPath}: listed as INTRUSIVE in UPSTREAM-PATCHES.md but has no cz-cli change banner`)
      }
    })
  })

  // Entry 12 (<spinner> registration) mechanical checks while active in ledger.
  if (intrusiveSection.includes("registerOpencodeSpinner")) {
    const tuiPkgPath = path.join(repoRoot, "packages/tui/package.json")
    if (existsSync(tuiPkgPath)) {
      const tuiPkg = readFileSync(tuiPkgPath, "utf8")
      if (!tuiPkg.includes("./component/register-spinner")) {
        errors.push("packages/tui/package.json: missing ./component/register-spinner export (UPSTREAM-PATCHES #12)")
      }
    }
    const defPath = path.join(repoRoot, "packages/tui/src/component/register-spinner.ts")
    if (!existsSync(defPath)) {
      errors.push("packages/tui/src/component/register-spinner.ts: missing spinner registration module (UPSTREAM-PATCHES #12)")
    }
    SPINNER_CALL_SITES.forEach((relSite) => {
      const absSite = path.join(repoRoot, relSite)
      if (!existsSync(absSite)) {
        errors.push(`${relSite}: missing expected registerOpencodeSpinner call site`)
        return
      }
      const siteText = readFileSync(absSite, "utf8")
      if (!siteText.includes("registerOpencodeSpinner(")) {
        errors.push(`${relSite}: missing registerOpencodeSpinner() call (UPSTREAM-PATCHES #12)`)
      }
      if (siteText.includes('import "opentui-spinner/solid"')) {
        errors.push(`${relSite}: bare import "opentui-spinner/solid" regressed (UPSTREAM-PATCHES #12)`)
      }
    })
  }

  return {
    ok: errors.length === 0,
    bannerFiles: bannerFiles.sort(),
    errors,
  }
}

function walkSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED_DIRS.has(entry.name)) return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walkSourceFiles(full)
    if (!entry.isFile() || !/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) return []
    return [full]
  })
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..")
  const result = auditUpstreamPatches(root)
  if (!result.ok) {
    console.error("Upstream patch ledger audit failed:")
    result.errors.forEach((err) => console.error(`  - ${err}`))
    process.exitCode = 1
  } else {
    console.log(
      JSON.stringify({
        ok: true,
        verifiedBannerFiles: result.bannerFiles.length,
      }),
    )
  }
}
