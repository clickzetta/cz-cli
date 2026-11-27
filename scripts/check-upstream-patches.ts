#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const UPSTREAM_PACKAGES = ["packages/core", "packages/opencode", "packages/tui", "packages/schema"] as const
const START_BANNER = "//======================== cz-cli change ========================"
const END_BANNER = "//====================== end cz-cli change ======================"
const SOURCE_SUFFIX = /\.(?:ts|tsx|js|mjs)$/
const LEDGER_PATH_PATTERN = /`(packages\/(?:core|opencode|tui|schema)\/[^`\s]+\.(?:ts|tsx|js|mjs))`/g
const NEW_OWNED_PATTERN = /`(packages\/(?:core|opencode|tui|schema)\/[^`\s]+\.(?:ts|tsx|js|mjs))`\s*\(new\b/g
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
  const entryBlocks = intrusiveSection.split(/\n### \d+\.\s+/).slice(1)
  const checkSpinnerBackport = intrusiveSection.includes("registerOpencodeSpinner")

  const newCzOwnedFiles = new Set(
    [...intrusiveSection.matchAll(NEW_OWNED_PATTERN)].map((match) => match[1]!),
  )

  const documentedBannerFiles = new Set<string>()
  const requiredIntrusiveFiles = new Set<string>()

  const explicitManifestMatch = ledgerText.match(
    /## Bannered upstream files \(CI-enforced\)([\s\S]*?)(?=\n## |\n# |$)/,
  )
  if (explicitManifestMatch) {
    extractUpstreamPaths(explicitManifestMatch[1] ?? "").forEach((relPath) => {
      if (!existsSync(path.join(repoRoot, relPath))) {
        errors.push(`${relPath}: listed in Bannered upstream files manifest in UPSTREAM-PATCHES.md but file is missing`)
        return
      }
      requiredIntrusiveFiles.add(relPath)
    })
  }

  entryBlocks.forEach((block) => {
    const noBannerIntentional = block.includes("No `cz-cli change` banner, deliberately")
    const headerSlice = block.slice(0, block.indexOf("\n- **What/why:**") > 0 ? block.indexOf("\n- **What/why:**") : block.length)
    const verifyMatches = [...block.matchAll(/\n-\s+\*\*Verify:\*\*([\s\S]*?)(?=\n-\s+\*\*|\n---|\n###|$)/g)]
      .map((match) => match[1] ?? "")
      .join("\n")

    const headerPaths = extractUpstreamPaths(headerSlice)
    const verifyPaths = extractUpstreamPaths(verifyMatches)

    headerPaths.forEach((relPath) => {
      const full = path.join(repoRoot, relPath)
      if (!existsSync(full)) {
        errors.push(`${relPath}: listed in UPSTREAM-PATCHES.md INTRUSIVE section but file is missing`)
        return
      }
      if (noBannerIntentional) return
      documentedBannerFiles.add(relPath)
      const isNewOwnedWithoutBanner = block.includes(`\`${relPath}\` (new`)
      if (!isNewOwnedWithoutBanner) requiredIntrusiveFiles.add(relPath)
    })

    if (!noBannerIntentional) {
      verifyPaths.forEach((relPath) => documentedBannerFiles.add(relPath))
    }
  })

  const bannerFiles: string[] = []

  UPSTREAM_PACKAGES.forEach((pkgRel) => {
    const pkgDir = path.join(repoRoot, pkgRel)
    if (!existsSync(pkgDir)) return
    walkSourceFiles(pkgDir).forEach((absFile) => {
      const relFile = path.relative(repoRoot, absFile).split(path.sep).join("/")
      const content = readFileSync(absFile, "utf8")
      const lines = content.split("\n")
      const state = { openLine: 0, bannerCount: 0 }

      if (
        checkSpinnerBackport &&
        (pkgRel === "packages/tui" || pkgRel === "packages/opencode") &&
        /import\s+["']opentui-spinner\/solid["']/.test(content)
      ) {
        errors.push(`${relFile}: bare import "opentui-spinner/solid" regressed (UPSTREAM-PATCHES #12)`)
      }

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
        if (!documentedBannerFiles.has(relFile)) {
          errors.push(
            `${relFile}: contains cz-cli change banner(s) but is not declared in a banner-bearing INTRUSIVE entry in UPSTREAM-PATCHES.md`,
          )
        }
      }
    })
  })

  const bannerSet = new Set(bannerFiles)
  requiredIntrusiveFiles.forEach((relPath) => {
    if (!bannerSet.has(relPath)) {
      errors.push(`${relPath}: listed as INTRUSIVE in UPSTREAM-PATCHES.md but has no cz-cli change banner`)
    }
  })

  // Entry 12 (<spinner> registration) mechanical checks while active in ledger.
  if (checkSpinnerBackport) {
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
    })
  }

  return {
    ok: errors.length === 0,
    bannerFiles: bannerFiles.sort(),
    errors,
  }
}

function extractUpstreamPaths(section: string): string[] {
  return [...section.matchAll(LEDGER_PATH_PATTERN)].map((match) => match[1]!)
}

function walkSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED_DIRS.has(entry.name)) return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walkSourceFiles(full)
    if (!entry.isFile() || !SOURCE_SUFFIX.test(entry.name)) return []
    return [full]
  })
}

function runCli() {
  const root = path.resolve(import.meta.dir, "..")
  const result = auditUpstreamPatches(root)
  if (!result.ok) {
    console.error("Upstream patch ledger audit failed:")
    result.errors.forEach((err) => console.error(`  - ${err}`))
    process.exitCode = 1
    return
  }
  console.log(
    JSON.stringify({
      ok: true,
      verifiedBannerFiles: result.bannerFiles.length,
    }),
  )
}

if (import.meta.main) runCli()
