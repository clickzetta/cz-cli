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
  const intrusiveMatch = ledgerText.match(
    /(?:^|\n)## INTRUSIVE patches[^\n]*(?:\n(?!## |# )([\s\S]*?))?(?=\n## |\n# |$)/,
  )
  if (!intrusiveMatch) {
    errors.push("packages/cz-cli/UPSTREAM-PATCHES.md: missing required '## INTRUSIVE patches' section")
  }
  const intrusiveSection = intrusiveMatch ? `\n${intrusiveMatch[1] ?? ""}` : ""
  const entryBlocks = intrusiveSection.split(/\n### \d+\.\s+/).slice(1)

  const tuiPkgPath = path.join(repoRoot, "packages/tui/package.json")
  const parsedTuiPkg = existsSync(tuiPkgPath) ? parseJsonObject(readFileSync(tuiPkgPath, "utf8")) : undefined
  const tuiPkgVersion = typeof parsedTuiPkg?.version === "string" ? parsedTuiPkg.version : undefined
  const ledgerBaseline = ledgerText.match(/baselined at v(\d+\.\d+\.\d+)/)?.[1]
  const baselineNeedsSpinner = needsSpinnerBackport(tuiPkgVersion) || needsSpinnerBackport(ledgerBaseline)
  if (baselineNeedsSpinner && !intrusiveSection.includes("registerOpencodeSpinner")) {
    errors.push(
      "packages/cz-cli/UPSTREAM-PATCHES.md: missing required registerOpencodeSpinner INTRUSIVE entry while upstream baseline is < 1.18.9",
    )
  }
  const checkSpinnerBackport = baselineNeedsSpinner || intrusiveSection.includes("registerOpencodeSpinner")

  const newCzOwnedFiles = new Set(
    [...intrusiveSection.matchAll(NEW_OWNED_PATTERN)].map((match) => match[1]!),
  )

  const documentedBannerFiles = new Set<string>()
  const requiredIntrusiveFiles = new Set<string>()
  const manifestExpectedCounts = new Map<string, number>()

  const explicitManifestMatch = ledgerText.match(
    /## Bannered upstream files \(CI-enforced\)([\s\S]*?)(?=\n## |\n# |$)/,
  )
  if (!explicitManifestMatch) {
    errors.push(
      "packages/cz-cli/UPSTREAM-PATCHES.md: missing required '## Bannered upstream files (CI-enforced)' section",
    )
  }
  if (explicitManifestMatch) {
    const manifestRows = [
      ...(explicitManifestMatch[1] ?? "").matchAll(
        /`(packages\/(?:core|opencode|tui|schema)\/[^`\s]+\.(?:ts|tsx|js|mjs))`(?:\s*\((\d+)\s+banners?\))?/g,
      ),
    ]
    if (manifestRows.length === 0) {
      errors.push(
        "packages/cz-cli/UPSTREAM-PATCHES.md: '## Bannered upstream files (CI-enforced)' section lists no upstream files",
      )
    }
    manifestRows.forEach((match) => {
      const relPath = match[1]!
      const rawCount = match[2]
      const expectedCount = rawCount ? Number(rawCount) : 0
      if (!Number.isSafeInteger(expectedCount) || expectedCount <= 0) {
        errors.push(
          `${relPath}: '## Bannered upstream files (CI-enforced)' entry must declare an explicit '(N banner)' or '(N banners)' count`,
        )
        return
      }
      manifestExpectedCounts.set(relPath, expectedCount)
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

  const actualBannerCounts = new Map<string, number>()

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
        relFile !== "packages/tui/src/component/register-spinner.ts" &&
        (pkgRel === "packages/tui" || pkgRel === "packages/opencode") &&
        /\bimport\b[^;\n]*["']opentui-spinner\/solid["']/.test(stripJsComments(content, false))
      ) {
        errors.push(`${relFile}: direct import from "opentui-spinner/solid" regressed (UPSTREAM-PATCHES #12)`)
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
        actualBannerCounts.set(relFile, state.bannerCount)
        if (!manifestExpectedCounts.has(relFile)) {
          errors.push(
            `${relFile}: contains cz-cli change banner(s) but is missing from '## Bannered upstream files (CI-enforced)' in UPSTREAM-PATCHES.md`,
          )
        }
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
  manifestExpectedCounts.forEach((expectedCount, relPath) => {
    const actualCount = actualBannerCounts.get(relPath) ?? 0
    if (actualCount !== expectedCount) {
      errors.push(
        `${relPath}: expected ${expectedCount} cz-cli change banner block(s) per UPSTREAM-PATCHES.md manifest, found ${actualCount}`,
      )
    }
  })

  // Entry 12 (<spinner> registration) mechanical checks while active in ledger.
  if (checkSpinnerBackport) {
    const tuiPkgPath = path.join(repoRoot, "packages/tui/package.json")
    if (!existsSync(tuiPkgPath)) {
      errors.push("packages/tui/package.json: missing package manifest (UPSTREAM-PATCHES #12)")
    }
    if (existsSync(tuiPkgPath)) {
      const parsedPkg = parseJsonObject(readFileSync(tuiPkgPath, "utf8"))
      const exportsMap = parsedPkg && typeof parsedPkg.exports === "object" && parsedPkg.exports !== null
        ? (parsedPkg.exports as Record<string, unknown>)
        : undefined
      if (exportsMap?.["./component/register-spinner"] !== "./src/component/register-spinner.ts") {
        errors.push(
          "packages/tui/package.json: exports['./component/register-spinner'] must equal './src/component/register-spinner.ts' (UPSTREAM-PATCHES #12)",
        )
      }
    }
    const defPath = path.join(repoRoot, "packages/tui/src/component/register-spinner.ts")
    if (!existsSync(defPath)) {
      errors.push("packages/tui/src/component/register-spinner.ts: missing spinner registration module (UPSTREAM-PATCHES #12)")
    }
    if (existsSync(defPath)) {
      const defRaw = readFileSync(defPath, "utf8")
      const defUncommented = stripJsComments(defRaw, false)
      const defCodeOnly = stripJsComments(defRaw, true)
      if (
        !/\bimport\s*\{[^}]*\bregisterSpinner\b[^}]*\}\s*from\s*["']opentui-spinner\/solid["']/.test(defUncommented) ||
        !/\bexport\s+function\s+registerOpencodeSpinner\s*\(/.test(defCodeOnly) ||
        !/\bregisterSpinner\s*\(\s*\)/.test(defCodeOnly)
      ) {
        errors.push(
          "packages/tui/src/component/register-spinner.ts: missing active registerOpencodeSpinner() -> registerSpinner() implementation (UPSTREAM-PATCHES #12)",
        )
      }
    }
    SPINNER_CALL_SITES.forEach((relSite) => {
      const absSite = path.join(repoRoot, relSite)
      if (!existsSync(absSite)) {
        errors.push(`${relSite}: missing expected registerOpencodeSpinner call site`)
        return
      }
      const siteRaw = readFileSync(absSite, "utf8")
      const uncommented = stripJsComments(siteRaw, false)
      const codeOnly = stripJsComments(siteRaw, true)
      const hasValidImport =
        /\bimport\s*\{[^}]*\bregisterOpencodeSpinner\b[^}]*\}\s*from\s*["'](?:\.\.?\/(?:component\/)?register-spinner|@opencode-ai\/tui\/component\/register-spinner)["']/.test(
          uncommented,
        )
      // Require an unconditional top-level module-initialization call (not buried inside an unused helper/closure)
      const hasActiveCall = hasTopLevelUnconditionalCall(codeOnly, "registerOpencodeSpinner")
      if (!hasValidImport || !hasActiveCall) {
        errors.push(
          `${relSite}: missing active import or top-level registerOpencodeSpinner() startup call (UPSTREAM-PATCHES #12)`,
        )
      }
    })
  }

  return {
    ok: errors.length === 0,
    bannerFiles: bannerFiles.sort(),
    errors,
  }
}

function needsSpinnerBackport(version: string | undefined): boolean {
  if (!version) return false
  const parts = version.split(".").map((n) => Number(n))
  if (parts.length < 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) return false
  const [major, minor, patch] = [parts[0]!, parts[1]!, parts[2]!]
  const geMin = major > 1 || (major === 1 && (minor > 17 || (minor === 17 && patch >= 11)))
  const ltFixed = major < 1 || (major === 1 && (minor < 18 || (minor === 18 && patch < 9)))
  return geMin && ltFixed
}

function hasTopLevelUnconditionalCall(codeOnly: string, fnName: string): boolean {
  const callLinePattern = new RegExp(`^\\s*${fnName}\\s*\\(\\s*\\)\\s*;?\\s*$`)
  const state = { depth: 0, prevControlContinuation: false, found: false }
  codeOnly.split("\n").forEach((line) => {
    const trimmed = line.trim()
    if (state.depth === 0 && !state.prevControlContinuation && callLinePattern.test(line)) {
      state.found = true
    }
    for (const ch of line) {
      if (ch === "{" || ch === "(" || ch === "[") state.depth += 1
      else if (ch === "}" || ch === ")" || ch === "]") state.depth = Math.max(0, state.depth - 1)
    }
    if (trimmed.length > 0) {
      state.prevControlContinuation =
        (/(?:^|\b)(?:if|else|while|for|do|return|function)\b/.test(trimmed) && !trimmed.endsWith(";")) ||
        /(?:=>|[=?&|:+\-*/%,(])$/.test(trimmed)
    }
  })
  return state.found
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function stripJsComments(source: string, blankStringContents: boolean): string {
  const out: string[] = []
  const cursor = { i: 0 }
  while (cursor.i < source.length) {
    const ch = source[cursor.i]!
    const next = source[cursor.i + 1]
    if (ch === "/" && next === "/") {
      cursor.i += 2
      while (cursor.i < source.length && source[cursor.i] !== "\n") cursor.i += 1
      continue
    }
    if (ch === "/" && next === "*") {
      cursor.i += 2
      while (cursor.i < source.length && !(source[cursor.i] === "*" && source[cursor.i + 1] === "/")) {
        if (source[cursor.i] === "\n") out.push("\n")
        cursor.i += 1
      }
      cursor.i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch
      out.push(quote)
      cursor.i += 1
      while (cursor.i < source.length && source[cursor.i] !== quote) {
        if (source[cursor.i] === "\\") {
          if (!blankStringContents) out.push(source[cursor.i]!, source[cursor.i + 1] ?? "")
          cursor.i += 2
          continue
        }
        if (source[cursor.i] === "\n") out.push("\n")
        else if (!blankStringContents) out.push(source[cursor.i]!)
        cursor.i += 1
      }
      if (cursor.i < source.length) {
        out.push(quote)
        cursor.i += 1
      }
      continue
    }
    out.push(ch)
    cursor.i += 1
  }
  return out.join("")
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
