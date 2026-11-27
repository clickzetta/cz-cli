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
    const allVerifyRepoPaths = extractVerifyRepoPaths(verifyMatches)

    allVerifyRepoPaths.forEach((relPath) => {
      if (!existsSync(path.join(repoRoot, relPath))) {
        errors.push(`${relPath}: listed under Verify in UPSTREAM-PATCHES.md INTRUSIVE section but file is missing`)
      }
    })

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
        !hasValidSpinnerWrapperBody(defCodeOnly)
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

function hasValidSpinnerWrapperBody(codeOnly: string): boolean {
  const header = codeOnly.match(/\bexport\s+function\s+registerOpencodeSpinner\s*\(\s*\)\s*\{/)
  if (!header || header.index === undefined) return false
  const bodyStart = header.index + header[0].length
  const cursor = { index: bodyStart, depth: 1 }
  while (cursor.index < codeOnly.length && cursor.depth > 0) {
    const ch = codeOnly[cursor.index]
    if (ch === "{") cursor.depth += 1
    else if (ch === "}") cursor.depth -= 1
    cursor.index += 1
  }
  if (cursor.depth !== 0) return false
  const body = codeOnly.slice(bodyStart, cursor.index - 1)
  if (/\b(?:function|return|while|for)\b|=>/.test(body)) return false
  const normalized = body.replace(/\s+/g, " ").trim().replace(/;\s*$/, "")
  return (
    normalized === "registerSpinner()" ||
    /^if\s*\(\s*!getComponentCatalogue\(\s*\)\.spinner\s*\)\s*(?:registerSpinner\(\s*\)|\{\s*registerSpinner\(\s*\)\s*;?\s*\})$/.test(
      normalized,
    )
  )
}

function hasTopLevelUnconditionalCall(codeOnly: string, fnName: string): boolean {
  const tokens = tokenizeJs(codeOnly)
  const cursor = { index: 0 }

  const peek = (offset = 0) => tokens[cursor.index + offset]
  const skipNewlines = () => {
    while (peek() === "\n") cursor.index += 1
  }
  const skipBalanced = (open: string, close: string): boolean => {
    if (peek() !== open) return false
    const state = { depth: 0 }
    while (cursor.index < tokens.length) {
      const tok = peek()!
      cursor.index += 1
      if (tok === open) state.depth += 1
      else if (tok === close) {
        state.depth -= 1
        if (state.depth === 0) return true
      }
    }
    return false
  }
  const isContinuationBeforeNewline = (tok: string | undefined) =>
    tok !== undefined &&
    (/^(?:=>|[=?&|:+\-*/%,.([])$/.test(tok) || /^(?:else|do|return|await|yield|typeof|void|delete|new)$/.test(tok))

  const skipSubordinateStatement = (): void => {
    skipNewlines()
    const head = peek()
    if (!head) return
    if (head === ";") {
      cursor.index += 1
      return
    }
    if (head === "{") {
      skipBalanced("{", "}")
      return
    }
    if (head === "if" || head === "while" || head === "for") {
      cursor.index += 1
      skipNewlines()
      if (!skipBalanced("(", ")")) return
      skipSubordinateStatement()
      if (head === "if") {
        const saved = cursor.index
        skipNewlines()
        if (peek() === "else") {
          cursor.index += 1
          skipSubordinateStatement()
        } else {
          cursor.index = saved
        }
      }
      return
    }
    if (head === "do") {
      cursor.index += 1
      skipSubordinateStatement()
      skipNewlines()
      if (peek() === "while") {
        cursor.index += 1
        skipNewlines()
        skipBalanced("(", ")")
      }
      return
    }
    const state = { depth: 0, prevNonNl: "" }
    while (cursor.index < tokens.length) {
      const tok = peek()!
      if (state.depth === 0) {
        if (tok === ";") {
          cursor.index += 1
          return
        }
        if (tok === "\n" && state.prevNonNl && !isContinuationBeforeNewline(state.prevNonNl)) {
          cursor.index += 1
          return
        }
      }
      if (tok === "(" || tok === "[" || tok === "{") state.depth += 1
      else if (tok === ")" || tok === "]" || tok === "}") state.depth = Math.max(0, state.depth - 1)
      if (tok !== "\n") state.prevNonNl = tok
      cursor.index += 1
    }
  }

  while (cursor.index < tokens.length) {
    while (peek() === "\n" || peek() === ";") cursor.index += 1
    const tok = peek()
    if (!tok) break
    if (
      tok === fnName &&
      peek(1) === "(" &&
      peek(2) === ")" &&
      (peek(3) === undefined || peek(3) === ";" || peek(3) === "\n")
    ) {
      return true
    }
    skipSubordinateStatement()
  }
  return false
}

function tokenizeJs(codeOnly: string): string[] {
  const tokens: string[] = []
  const pattern = /\n|=>|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|[{}()[\];,.?:+\-*/%&|=!<>~^]/g
  for (const match of codeOnly.matchAll(pattern)) {
    tokens.push(match[0]!)
  }
  return tokens
}

function extractVerifyRepoPaths(verifyText: string): string[] {
  const found = new Set<string>()
  const state = { lastDir: "" }
  for (const match of verifyText.matchAll(/`([^`]+)`/g)) {
    const span = (match[1] ?? "").trim()
    const cdRun = span.match(/^cd\s+(packages\/[\w-]+)\s*&&\s*bun\s+test\s+([^\s`]+\.(?:ts|tsx|js|mjs))$/)
    if (cdRun) {
      const joined = `${cdRun[1]}/${cdRun[2]!.replace(/^\.\//, "")}`
      found.add(joined)
      state.lastDir = path.posix.dirname(joined)
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
