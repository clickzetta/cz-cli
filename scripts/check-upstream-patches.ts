#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const TSX_TRANSPILER = new Bun.Transpiler({
  loader: "tsx",
  jsxOptimizationInline: false,
  tsconfig: JSON.stringify({
    compilerOptions: { jsx: "react", jsxFactory: "__jsx", jsxFragmentFactory: "__Frag" },
  }),
})

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
  if (!isRegularFile(ledgerPath)) {
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
  const parsedTuiPkg = isRegularFile(tuiPkgPath) ? parseJsonObject(readFileSync(tuiPkgPath, "utf8")) : undefined
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
      if (!isRegularFile(path.join(repoRoot, relPath))) {
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
    const allVerifyRepoPaths = extractVerifyRepoPaths(verifyMatches)

    allVerifyRepoPaths.forEach((relPath) => {
      if (!isRegularFile(path.join(repoRoot, relPath))) {
        errors.push(`${relPath}: listed under Verify in UPSTREAM-PATCHES.md INTRUSIVE section but file is missing`)
      }
    })

    headerPaths.forEach((relPath) => {
      const full = path.join(repoRoot, relPath)
      if (!isRegularFile(full)) {
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
        hasDirectImportFrom(content, "opentui-spinner/solid")
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
    if (!isRegularFile(tuiPkgPath)) {
      errors.push("packages/tui/package.json: missing package manifest (UPSTREAM-PATCHES #12)")
    }
    if (isRegularFile(tuiPkgPath)) {
      const exportsMap = parsedTuiPkg && typeof parsedTuiPkg.exports === "object" && parsedTuiPkg.exports !== null
        ? (parsedTuiPkg.exports as Record<string, unknown>)
        : undefined
      if (exportsMap?.["./component/register-spinner"] !== "./src/component/register-spinner.ts") {
        errors.push(
          "packages/tui/package.json: exports['./component/register-spinner'] must equal './src/component/register-spinner.ts' (UPSTREAM-PATCHES #12)",
        )
      }
    }
    const defPath = path.join(repoRoot, "packages/tui/src/component/register-spinner.ts")
    if (!isRegularFile(defPath)) {
      errors.push("packages/tui/src/component/register-spinner.ts: missing spinner registration module (UPSTREAM-PATCHES #12)")
    }
    if (isRegularFile(defPath)) {
      const defRaw = readFileSync(defPath, "utf8")
      if (!hasValidSpinnerWrapperAst(defRaw)) {
        errors.push(
          "packages/tui/src/component/register-spinner.ts: missing active registerOpencodeSpinner() -> registerSpinner() implementation (UPSTREAM-PATCHES #12)",
        )
      }
    }
    SPINNER_CALL_SITES.forEach((relSite) => {
      const absSite = path.join(repoRoot, relSite)
      if (!isRegularFile(absSite)) {
        errors.push(`${relSite}: missing expected registerOpencodeSpinner call site`)
        return
      }
      const siteRaw = readFileSync(absSite, "utf8")
      if (!hasValidSpinnerCallSiteAst(siteRaw)) {
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

function isRegularFile(absPath: string): boolean {
  return statSync(absPath, { throwIfNoEntry: false })?.isFile() === true
}

function hasDirectImportFrom(source: string, specifier: string): boolean {
  try {
    return TSX_TRANSPILER.scanImports(source).some(
      (imp) => imp.kind === "import-statement" && imp.path === specifier,
    )
  } catch {
    return source.includes(specifier)
  }
}

function hasValidSpinnerWrapperAst(source: string): boolean {
  try {
    const imports = TSX_TRANSPILER.scanImports(source)
    if (!imports.some((imp) => imp.kind === "import-statement" && imp.path === "opentui-spinner/solid")) {
      return false
    }
    const canonical = blankTemplateLiterals(TSX_TRANSPILER.transformSync(source))
    return (
      /\bimport\s*\{\s*registerSpinner\s*\}\s*from\s*["']opentui-spinner\/solid["']/.test(canonical) &&
      (/^export function registerOpencodeSpinner\(\) \{\n  registerSpinner\(\);\n\}$/m.test(canonical) ||
        /^export function registerOpencodeSpinner\(\) \{\n  if \(!getComponentCatalogue\(\)\.spinner\)\n    registerSpinner\(\);\n\}$/m.test(
          canonical,
        ))
    )
  } catch {
    return false
  }
}

function hasValidSpinnerCallSiteAst(source: string): boolean {
  const allowedSpecifiers = new Set([
    "./register-spinner",
    "./component/register-spinner",
    "../register-spinner",
    "@opencode-ai/tui/component/register-spinner",
  ])
  try {
    const imports = TSX_TRANSPILER.scanImports(source)
    if (!imports.some((imp) => imp.kind === "import-statement" && allowedSpecifiers.has(imp.path))) {
      return false
    }
    const canonical = blankTemplateLiterals(TSX_TRANSPILER.transformSync(source))
    const hasNamedImport =
      /\bimport\s*\{[^}]*\bregisterOpencodeSpinner\b(?!\s+as\b)[^}]*\}\s*from\s*["'](?:\.\.?\/(?:component\/)?register-spinner|@opencode-ai\/tui\/component\/register-spinner)["']/.test(
        canonical,
      )
    if (!hasNamedImport) return false
    // In Bun.Transpiler's pretty-printed AST output, ONLY top-level module statements sit at column 0;
    // every subordinate statement inside if/else/for/for-await/while/do/switch/try/function/labels is indented.
    const lines = canonical.split("\n")
    for (const line of lines) {
      if (/^(?:throw\b|process\.exit\s*\()/.test(line)) return false
      if (line === "registerOpencodeSpinner();") return true
    }
    return false
  } catch {
    return false
  }
}

function blankTemplateLiterals(canonicalJs: string): string {
  const out: string[] = []
  const state = { i: 0, prevSig: "\n" }
  while (state.i < canonicalJs.length) {
    const ch = canonicalJs[state.i]!
    // Skip regex literals so a backtick inside /`/ cannot desynchronize template scanning
    if (ch === "/" && canonicalJs[state.i + 1] !== "/" && canonicalJs[state.i + 1] !== "*") {
      if (/[=(:,;!&|?+\-*%~^<>{\[\n]/.test(state.prevSig)) {
        out.push(ch)
        state.i += 1
        const inClass = { active: false }
        while (state.i < canonicalJs.length) {
          const rc = canonicalJs[state.i]!
          out.push(rc)
          state.i += 1
          if (rc === "\\") {
            if (state.i < canonicalJs.length) {
              out.push(canonicalJs[state.i]!)
              state.i += 1
            }
            continue
          }
          if (rc === "[") inClass.active = true
          else if (rc === "]") inClass.active = false
          else if (rc === "/" && !inClass.active) break
        }
        state.prevSig = "/"
        continue
      }
    }
    if (ch === "'" || ch === '"') {
      const quote = ch
      out.push(quote)
      state.i += 1
      while (state.i < canonicalJs.length && canonicalJs[state.i] !== quote) {
        if (canonicalJs[state.i] === "\\") {
          out.push(canonicalJs[state.i]!, canonicalJs[state.i + 1] ?? "")
          state.i += 2
          continue
        }
        out.push(canonicalJs[state.i]!)
        state.i += 1
      }
      if (state.i < canonicalJs.length) {
        out.push(quote)
        state.i += 1
      }
      state.prevSig = quote
      continue
    }
    if (ch === "`") {
      out.push("`")
      state.i += 1
      while (state.i < canonicalJs.length && canonicalJs[state.i] !== "`") {
        if (canonicalJs[state.i] === "\\") {
          state.i += 2
          continue
        }
        state.i += 1
      }
      if (state.i < canonicalJs.length) {
        out.push("`")
        state.i += 1
      }
      state.prevSig = "`"
      continue
    }
    out.push(ch)
    if (ch !== " " && ch !== "\t") state.prevSig = ch
    state.i += 1
  }
  return out.join("")
}

function extractVerifyRepoPaths(verifyText: string): string[] {
  const found = new Set<string>()
  const valueFlags = new Set(["--timeout", "--preload", "-r", "-t", "--test-name-pattern", "--seed", "--max-concurrency"])
  const state = { lastDir: "" }
  const collectCommandTestFiles = (argTail: string, prefix: string) => {
    const tokens = argTail.trim().split(/\s+/)
    const cursor = { index: 0 }
    while (cursor.index < tokens.length) {
      const token = tokens[cursor.index]!
      cursor.index += 1
      if (valueFlags.has(token)) {
        cursor.index += 1
        continue
      }
      if (token.startsWith("-")) continue
      const clean = token.replace(/^['"]|['"]$/g, "").replace(/^\.\//, "")
      const joined = prefix ? `${prefix}/${clean}` : clean
      if (/^(?:packages\/[\w-]+\/|scripts\/|\.github\/scripts\/)[^\s`]+$/.test(joined) && SOURCE_SUFFIX.test(joined)) {
        found.add(joined)
        state.lastDir = path.posix.dirname(joined)
      }
    }
  }
  for (const match of verifyText.matchAll(/`([^`]+)`/g)) {
    const span = (match[1] ?? "").trim()
    const cdRun = span.match(/^cd\s+(packages\/[\w-]+)\s*&&\s*bun\s+test\b([\s\S]+)$/)
    if (cdRun) {
      collectCommandTestFiles(cdRun[2]!, cdRun[1]!)
      continue
    }
    const rootRun = span.match(/^bun\s+test\b([\s\S]+)$/)
    if (rootRun) {
      collectCommandTestFiles(rootRun[1]!, "")
      continue
    }
    if (/^(?:packages\/[\w-]+\/|scripts\/|\.github\/scripts\/)[^\s`]+\.(?:ts|tsx|js|mjs)$/.test(span)) {
      found.add(span)
      state.lastDir = path.posix.dirname(span)
      continue
    }
    if (state.lastDir && /^[\w.-]+\.test\.(?:ts|tsx|js|mjs)$/.test(span)) {
      found.add(`${state.lastDir}/${span}`)
    }
  }
  return [...found]
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
