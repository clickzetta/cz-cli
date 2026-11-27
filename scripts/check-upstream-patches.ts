#!/usr/bin/env bun
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs"
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
const LEDGER_PATH_PATTERN = /`(?:\.\/)?(packages\/(?:core|opencode|tui|schema)\/[^`\s]+\.(?:ts|tsx|js|mjs))`/g
const NEW_OWNED_PATTERN = /`(?:\.\/)?(packages\/(?:core|opencode|tui|schema)\/[^`\s]+\.(?:ts|tsx|js|mjs))`\s*\(new\b/g
const IGNORED_DIRS = new Set(["node_modules", "dist", "generated", "generated-effect", ".turbo", ".git"])

const SPINNER_CALL_SITES = [
  ["packages/tui/src/app.tsx", "./component/register-spinner"],
  ["packages/tui/src/component/spinner.tsx", "./register-spinner"],
  ["packages/tui/src/component/prompt/index.tsx", "../register-spinner"],
  ["packages/opencode/src/cli/cmd/run/footer.subagent.tsx", "@opencode-ai/tui/component/register-spinner"],
  ["packages/opencode/src/cli/cmd/run/footer.view.tsx", "@opencode-ai/tui/component/register-spinner"],
] as const

export type PatchAuditResult = {
  ok: boolean
  bannerFiles: string[]
  errors: string[]
}

export function auditUpstreamPatches(repoRoot: string): PatchAuditResult {
  const errors: string[] = []
  const ledgerPath = path.join(repoRoot, "packages/cz-cli/UPSTREAM-PATCHES.md")
  if (!isRegularRepoFile(repoRoot, "packages/cz-cli/UPSTREAM-PATCHES.md")) {
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
  const hasRegularTuiPkg = isRegularRepoFile(repoRoot, "packages/tui/package.json")
  const parsedTuiPkg = hasRegularTuiPkg ? parseJsonObject(readFileSync(tuiPkgPath, "utf8")) : undefined
  const tuiPkgVersion = typeof parsedTuiPkg?.version === "string" ? parsedTuiPkg.version : undefined
  const ledgerBaseline = ledgerText.match(/baselined at v(\d+\.\d+\.\d+)/)?.[1]
  const baselineNeedsSpinner = needsSpinnerBackport(tuiPkgVersion) || needsSpinnerBackport(ledgerBaseline)
  const hasDedicatedSpinnerEntry = entryBlocks.some((block) => isDedicatedSpinnerBackportEntry(block))
  if (baselineNeedsSpinner && !hasDedicatedSpinnerEntry) {
    errors.push(
      "packages/cz-cli/UPSTREAM-PATCHES.md: missing required dedicated registerOpencodeSpinner INTRUSIVE entry while upstream baseline is < 1.18.9",
    )
  }
  const checkSpinnerBackport =
    baselineNeedsSpinner || hasDedicatedSpinnerEntry || intrusiveSection.includes("registerOpencodeSpinner")

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
      if (!isRegularRepoFile(repoRoot, relPath)) {
        errors.push(`${relPath}: listed in Bannered upstream files manifest in UPSTREAM-PATCHES.md but regular file is missing`)
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
    const verifyTargets = extractVerifyRepoPaths(verifyMatches)

    verifyTargets.tests.forEach((relPath) => {
      if (!/\.test\.(?:ts|tsx|js|mjs)$/.test(relPath) || !isRegularRepoFile(repoRoot, relPath)) {
        errors.push(
          `${relPath}: listed under Verify in UPSTREAM-PATCHES.md INTRUSIVE section but regular non-symlink test file is missing`,
        )
      }
    })
    verifyTargets.scripts.forEach((relPath) => {
      if (!SOURCE_SUFFIX.test(relPath) || !isRegularRepoFile(repoRoot, relPath)) {
        errors.push(
          `${relPath}: listed under Verify command in UPSTREAM-PATCHES.md INTRUSIVE section but regular non-symlink script is missing`,
        )
      }
    })
    verifyTargets.refs.forEach((relPath) => {
      if (!isRegularRepoFile(repoRoot, relPath)) {
        errors.push(
          `${relPath}: linked under Verify in UPSTREAM-PATCHES.md INTRUSIVE section but regular non-symlink file is missing`,
        )
      }
    })

    headerPaths.forEach((relPath) => {
      if (!isRegularRepoFile(repoRoot, relPath)) {
        errors.push(`${relPath}: listed in UPSTREAM-PATCHES.md INTRUSIVE section but regular file is missing`)
        return
      }
      if (noBannerIntentional) return
      documentedBannerFiles.add(relPath)
      const isNewOwnedWithoutBanner = block.includes(`\`${relPath}\` (new`)
      if (!isNewOwnedWithoutBanner) requiredIntrusiveFiles.add(relPath)
    })

    if (!noBannerIntentional) {
      ;[...verifyTargets.tests, ...verifyTargets.scripts].forEach((relPath) => {
        if (UPSTREAM_PACKAGES.some((pkg) => relPath.startsWith(`${pkg}/`))) {
          documentedBannerFiles.add(relPath)
        }
      })
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
    if (!hasRegularTuiPkg) {
      errors.push("packages/tui/package.json: missing package manifest (UPSTREAM-PATCHES #12)")
    }
    if (hasRegularTuiPkg) {
      const exportsMap = parsedTuiPkg && typeof parsedTuiPkg.exports === "object" && parsedTuiPkg.exports !== null
        ? (parsedTuiPkg.exports as Record<string, unknown>)
        : undefined
      if (exportsMap?.["./component/register-spinner"] !== "./src/component/register-spinner.ts") {
        errors.push(
          "packages/tui/package.json: exports['./component/register-spinner'] must equal './src/component/register-spinner.ts' (UPSTREAM-PATCHES #12)",
        )
      }
    }
    const defRel = "packages/tui/src/component/register-spinner.ts"
    const defPath = path.join(repoRoot, defRel)
    if (!isRegularRepoFile(repoRoot, defRel)) {
      errors.push("packages/tui/src/component/register-spinner.ts: missing spinner registration module (UPSTREAM-PATCHES #12)")
    }
    if (isRegularRepoFile(repoRoot, defRel)) {
      const defRaw = readFileSync(defPath, "utf8")
      if (!hasValidSpinnerWrapperAst(defRaw)) {
        errors.push(
          "packages/tui/src/component/register-spinner.ts: missing active registerOpencodeSpinner() -> registerSpinner() implementation (UPSTREAM-PATCHES #12)",
        )
      }
    }
    SPINNER_CALL_SITES.forEach(([relSite, expectedSpecifier]) => {
      const absSite = path.join(repoRoot, relSite)
      if (!isRegularRepoFile(repoRoot, relSite)) {
        errors.push(`${relSite}: missing expected registerOpencodeSpinner call site`)
        return
      }
      const siteRaw = readFileSync(absSite, "utf8")
      if (!hasValidSpinnerCallSiteAst(siteRaw, expectedSpecifier)) {
        errors.push(
          `${relSite}: missing active import from "${expectedSpecifier}" or top-level registerOpencodeSpinner() startup call (UPSTREAM-PATCHES #12)`,
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

function isDedicatedSpinnerBackportEntry(block: string): boolean {
  const headingLine = block.split("\n", 1)[0] ?? ""
  if (!/\bspinner\b/i.test(headingLine) || !block.includes("registerOpencodeSpinner")) {
    return false
  }
  const headerBoundary = block.search(/\n-\s+\*\*(?!Files?:|cz files:|Marker:|Upstream value:)/)
  const entryHeader = headerBoundary > 0 ? block.slice(0, headerBoundary) : block
  const headerFiles = new Set(extractUpstreamPaths(entryHeader))
  return (
    /`(?:\.\/)?packages\/tui\/package\.json`/.test(entryHeader) &&
    headerFiles.has("packages/tui/src/component/register-spinner.ts") &&
    SPINNER_CALL_SITES.every(([relSite]) => headerFiles.has(relSite))
  )
}

function isRegularRepoFile(repoRoot: string, relPath: string): boolean {
  if (!relPath || relPath.startsWith("/") || relPath.includes("\0") || relPath.includes("\\")) return false
  const segments = relPath.split("/")
  if (segments.some((seg) => !seg || seg === "." || seg === "..")) return false
  const absPath = path.join(repoRoot, ...segments)
  const info = lstatSync(absPath, { throwIfNoEntry: false })
  if (!info || !info.isFile() || info.isSymbolicLink()) return false
  try {
    return realpathSync(absPath) === path.join(realpathSync(repoRoot), ...segments)
  } catch {
    return false
  }
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

function hasNamedImportBinding(canonical: string, expectedSpecifier: string, bindingName: string): boolean {
  return [
    ...canonical.matchAll(/(?:^|\n)import\s*(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g),
  ].some(
    (match) =>
      match[2] === expectedSpecifier &&
      (match[1] ?? "").split(",").some((part) => part.trim() === bindingName),
  )
}

function hasValidSpinnerWrapperAst(source: string): boolean {
  try {
    const imports = TSX_TRANSPILER.scanImports(source)
    if (!imports.some((imp) => imp.kind === "import-statement" && imp.path === "opentui-spinner/solid")) {
      return false
    }
    const canonical = blankTemplateLiterals(TSX_TRANSPILER.transformSync(source))
    if (!hasNamedImportBinding(canonical, "opentui-spinner/solid", "registerSpinner")) {
      return false
    }
    if (/^export function registerOpencodeSpinner\(\) \{\n  registerSpinner\(\);\n\}$/m.test(canonical)) {
      return true
    }
    return (
      imports.some((imp) => imp.kind === "import-statement" && imp.path === "@opentui/solid/components") &&
      hasNamedImportBinding(canonical, "@opentui/solid/components", "getComponentCatalogue") &&
      /^export function registerOpencodeSpinner\(\) \{\n  if \(!getComponentCatalogue\(\)\.spinner\)\n    registerSpinner\(\);\n\}$/m.test(
        canonical,
      )
    )
  } catch {
    return false
  }
}

function hasValidSpinnerCallSiteAst(source: string, expectedSpecifier: string): boolean {
  try {
    const imports = TSX_TRANSPILER.scanImports(source)
    if (!imports.some((imp) => imp.kind === "import-statement" && imp.path === expectedSpecifier)) {
      return false
    }
    const canonical = blankTemplateLiterals(TSX_TRANSPILER.transformSync(source))
    if (!hasNamedImportBinding(canonical, expectedSpecifier, "registerOpencodeSpinner")) return false
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
  // Stack tracks nested `${ ... }` brace depth for each active template literal
  const templateBraceStack: number[] = []
  const state = { i: 0, prevSig: "\n" }

  const consumeTemplateSpan = () => {
    while (state.i < canonicalJs.length) {
      const tc = canonicalJs[state.i]!
      if (tc === "\\") {
        state.i += 2
        continue
      }
      if (tc === "`") {
        out.push("`")
        state.i += 1
        state.prevSig = "`"
        return
      }
      if (tc === "$" && canonicalJs[state.i + 1] === "{") {
        // Blank `${...}` expression too? No: code inside `${registerOpencodeSpinner()}` AT TOP LEVEL IS executed!
        //Wait: inside `const s = `${registerOpencodeSpinner()}`;`, Bun.Transpiler prints it on the `const s = ...` line (NOT `^registerOpencodeSpinner();$`), unless a multiline function/block inside `${...}` is indented anyway! Still, tracking brace depth keeps outer template scanning synchronized across inner backticks!
        out.push("${")
        state.i += 2
        state.prevSig = "{"
        templateBraceStack.push(1)
        return
      }
      state.i += 1
    }
  }

  while (state.i < canonicalJs.length) {
    const ch = canonicalJs[state.i]!
    // Strip preserved JS comments (such as `/*! ... */` legal blocks) so commented text never satisfies AST checks
    if (ch === "/" && canonicalJs[state.i + 1] === "/") {
      state.i += 2
      while (state.i < canonicalJs.length && canonicalJs[state.i] !== "\n") {
        state.i += 1
      }
      continue
    }
    if (ch === "/" && canonicalJs[state.i + 1] === "*") {
      state.i += 2
      while (
        state.i < canonicalJs.length &&
        !(canonicalJs[state.i] === "*" && canonicalJs[state.i + 1] === "/")
      ) {
        state.i += 1
      }
      if (state.i < canonicalJs.length) state.i += 2
      continue
    }
    // Skip regex literals so `/` or `` ` `` inside `/.../` cannot desynchronize scanning
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
      consumeTemplateSpan()
      continue
    }
    if (templateBraceStack.length > 0) {
      if (ch === "{") {
        templateBraceStack[templateBraceStack.length - 1]! += 1
      } else if (ch === "}") {
        const nextDepth = templateBraceStack[templateBraceStack.length - 1]! - 1
        if (nextDepth === 0) {
          templateBraceStack.pop()
          out.push("}")
          state.i += 1
          consumeTemplateSpan()
          continue
        }
        templateBraceStack[templateBraceStack.length - 1] = nextDepth
      }
    }
    out.push(ch)
    if (ch !== " " && ch !== "\t") state.prevSig = ch
    state.i += 1
  }
  return out.join("")
}

function shellSplitArgs(raw: string): string[] {
  const args: string[] = []
  const state = { current: "", quote: "", hasToken: false, i: 0 }
  while (state.i < raw.length) {
    const ch = raw[state.i]!
    if (state.quote) {
      if (ch === "\\" && state.quote === '"' && state.i + 1 < raw.length) {
        state.current += raw[state.i + 1]!
        state.i += 2
        continue
      }
      if (ch === state.quote) {
        state.quote = ""
        state.i += 1
        continue
      }
      state.current += ch
      state.i += 1
      continue
    }
    if (ch === "'" || ch === '"') {
      state.quote = ch
      state.hasToken = true
      state.i += 1
      continue
    }
    if (/\s/.test(ch)) {
      if (state.hasToken) {
        args.push(state.current)
        state.current = ""
        state.hasToken = false
      }
      state.i += 1
      continue
    }
    if (ch === "\\" && state.i + 1 < raw.length) {
      state.current += raw[state.i + 1]!
      state.hasToken = true
      state.i += 2
      continue
    }
    state.current += ch
    state.hasToken = true
    state.i += 1
  }
  if (state.hasToken) args.push(state.current)
  return args
}

function shellSplitClauses(raw: string): string[] {
  const unwrapped = raw.trim()
  const clauses: string[] = []
  const state = { current: "", quote: "", i: 0 }
  while (state.i < unwrapped.length) {
    const ch = unwrapped[state.i]!
    if (state.quote) {
      if (ch === "\\" && state.quote === '"' && state.i + 1 < unwrapped.length) {
        state.current += unwrapped.slice(state.i, state.i + 2)
        state.i += 2
        continue
      }
      if (ch === state.quote) state.quote = ""
      state.current += ch
      state.i += 1
      continue
    }
    if (ch === "'" || ch === '"') {
      state.quote = ch
      state.current += ch
      state.i += 1
      continue
    }
    if (ch === "\\" && state.i + 1 < unwrapped.length) {
      state.current += unwrapped.slice(state.i, state.i + 2)
      state.i += 2
      continue
    }
    if (ch === "(" || ch === ")") {
      const clause = state.current.trim()
      if (clause) clauses.push(clause)
      clauses.push(ch)
      state.current = ""
      state.i += 1
      continue
    }
    if (ch === ";" || ch === "|" || (ch === "&" && unwrapped[state.i + 1] === "&")) {
      const clause = state.current.trim()
      if (clause) clauses.push(clause)
      state.current = ""
      if (ch === "&" || (ch === "|" && unwrapped[state.i + 1] === "|")) {
        state.i += 2
        continue
      }
      state.i += 1
      continue
    }
    state.current += ch
    state.i += 1
  }
  const tail = state.current.trim()
  if (tail) clauses.push(tail)
  return clauses
}

function resolveRelativeRepoDir(baseCwd: string, rawTarget: string): string {
  if (baseCwd.startsWith("__invalid__:")) {
    return `${baseCwd}/${rawTarget}`
  }
  if (
    !rawTarget ||
    rawTarget === "~" ||
    rawTarget.startsWith("~/") ||
    rawTarget.startsWith("/") ||
    rawTarget.includes("\0") ||
    rawTarget.includes("\\") ||
    rawTarget.includes("`")
  ) {
    return `__invalid__:${rawTarget}`
  }
  const joined = baseCwd ? `${baseCwd}/${rawTarget}` : rawTarget
  const normalized = path.posix.normalize(joined).replace(/\/+$/, "")
  if (normalized === "." || normalized === "") return ""
  if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    return `__invalid__:${joined}`
  }
  return normalized
}

function normalizeRepoSourcePath(raw: string): string | undefined {
  if (!raw || raw.startsWith("/") || raw.includes("\0") || raw.includes("\\") || raw.includes("`")) {
    return undefined
  }
  const normalized = path.posix.normalize(raw)
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    return undefined
  }
  if (
    /^(?:packages\/[\w-]+\/|scripts\/|\.github\/scripts\/)[^`\0]+$/.test(normalized) &&
    SOURCE_SUFFIX.test(normalized)
  ) {
    return normalized
  }
  return undefined
}

function findMarkdownBracketEnd(text: string, start: number): number {
  const cursor = { i: start }
  while (cursor.i < text.length) {
    const ch = text[cursor.i]!
    if (ch === "\n" && text[cursor.i + 1] === "\n") return -1
    if (ch === "\\") {
      cursor.i += 2
      continue
    }
    if (ch === "`") {
      cursor.i += 1
      while (cursor.i < text.length && text[cursor.i] !== "`") cursor.i += 1
      cursor.i += 1
      continue
    }
    if (ch === "[") return -1
    if (ch === "]") return cursor.i
    cursor.i += 1
  }
  return -1
}

function resolveMarkdownVerifyTarget(rawSpec: string): string | undefined {
  const trimmed = rawSpec.trim()
  if (!trimmed) return undefined
  const withoutTitle =
    trimmed.startsWith("<") && trimmed.includes(">")
      ? trimmed.slice(1, trimmed.indexOf(">")).trim()
      : trimmed.split(/\s+["']/)[0]!.trim()
  if (
    !withoutTitle ||
    withoutTitle.startsWith("#") ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(withoutTitle) ||
    withoutTitle.startsWith("//")
  ) {
    return undefined
  }
  const cleanPath = withoutTitle.split(/[?#]/, 1)[0]!.trim()
  if (!cleanPath) return undefined
  if (cleanPath.startsWith("/")) {
    return path.posix.normalize(cleanPath.slice(1))
  }
  if (/^(?:\.\/)?(?:packages\/|scripts\/|\.github\/)/.test(cleanPath)) {
    return path.posix.normalize(cleanPath)
  }
  return path.posix.normalize(`packages/cz-cli/${cleanPath}`)
}

function extractMarkdownLinkTargets(verifyText: string): string[] {
  const targets: string[] = []
  const cursor = { i: 0 }
  while (cursor.i < verifyText.length) {
    const ch = verifyText[cursor.i]!
    if (ch === "`") {
      cursor.i += 1
      while (cursor.i < verifyText.length && verifyText[cursor.i] !== "`") cursor.i += 1
      cursor.i += 1
      continue
    }
    if (ch === "[") {
      const labelEnd = findMarkdownBracketEnd(verifyText, cursor.i + 1)
      if (labelEnd !== -1 && verifyText[labelEnd + 1] === "(") {
        const targetEnd = verifyText.indexOf(")", labelEnd + 2)
        if (targetEnd !== -1) {
          const resolved = resolveMarkdownVerifyTarget(verifyText.slice(labelEnd + 2, targetEnd))
          if (resolved !== undefined) targets.push(resolved)
          cursor.i = targetEnd + 1
          continue
        }
      }
    }
    cursor.i += 1
  }
  for (const defMatch of verifyText.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) {
    const resolved = resolveMarkdownVerifyTarget(defMatch[1] ?? "")
    if (resolved !== undefined) targets.push(resolved)
  }
  return targets
}

function extractVerifyRepoPaths(verifyText: string): { tests: string[]; scripts: string[]; refs: string[] } {
  const foundTests = new Set<string>()
  const foundScripts = new Set<string>()
  const foundRefs = new Set<string>()
  const valueFlags = new Set([
    "--timeout",
    "--preload",
    "-r",
    "-t",
    "--test-name-pattern",
    "--seed",
    "--max-concurrency",
    "--rerun-each",
    "--reporter",
    "--reporter-outfile",
    "--coverage-reporter",
    "--coverage-dir",
    "--root",
    "--env-file",
  ])
  const state = { lastDir: "" }

  extractMarkdownLinkTargets(verifyText).forEach((target) => {
    if (/\.(?:test|spec)\.[^/]+$/i.test(target)) {
      foundTests.add(target)
      const repoPath = normalizeRepoSourcePath(target)
      if (repoPath) state.lastDir = path.posix.dirname(repoPath)
      return
    }
    foundRefs.add(target)
  })

  for (const match of verifyText.matchAll(/`([^`]+)`/g)) {
    const span = (match[1] ?? "").trim()
    const clauses = shellSplitClauses(span)
    const cwdStack: string[] = [""]
    const cmdState = { handledCommand: false }

    for (const clause of clauses) {
      if (clause === "(") {
        cwdStack.push(cwdStack[cwdStack.length - 1]!)
        continue
      }
      if (clause === ")") {
        if (cwdStack.length > 1) cwdStack.pop()
        continue
      }
      const currentCwd = cwdStack[cwdStack.length - 1]!
      const tokens = [...shellSplitArgs(clause)]
      while (tokens[0] && /^[A-Za-z_]\w*=/.test(tokens[0])) {
        tokens.shift()
      }
      const cdTarget =
        tokens[0] === "cd"
          ? tokens[1] === "--" && tokens.length === 3
            ? tokens[2]
            : tokens.length === 2
              ? tokens[1]
              : undefined
          : undefined
      if (cdTarget !== undefined) {
        cwdStack[cwdStack.length - 1] = resolveRelativeRepoDir(currentCwd, cdTarget)
        cmdState.handledCommand = true
        continue
      }
      if (tokens[0] === "bun") {
        const cursor = { index: 1, effectiveCwd: currentCwd, sawRun: false, isTestSubcommand: false, afterDoubleDash: false }
        while (cursor.index < tokens.length) {
          const token = tokens[cursor.index]!
          cursor.index += 1
          if (!cursor.isTestSubcommand) {
            if (token === "test") {
              cursor.isTestSubcommand = true
              continue
            }
            if (token === "run" && !cursor.sawRun) {
              cursor.sawRun = true
              continue
            }
            if ((token === "--cwd" || token === "-C") && tokens[cursor.index] !== undefined) {
              cursor.effectiveCwd = resolveRelativeRepoDir(cursor.effectiveCwd, tokens[cursor.index]!)
              cursor.index += 1
              continue
            }
            if (token.startsWith("--cwd=")) {
              cursor.effectiveCwd = resolveRelativeRepoDir(cursor.effectiveCwd, token.slice("--cwd=".length))
              continue
            }
            if (token === "-e" || token === "--eval" || token === "-p" || token === "--print") {
              break
            }
            if (token === "--silent" || token === "--if-present" || token === "--bun" || token === "-b") {
              continue
            }
            if (!token.startsWith("-") && SOURCE_SUFFIX.test(token)) {
              if (cursor.effectiveCwd.startsWith("__invalid__:")) {
                foundScripts.add(`${cursor.effectiveCwd.slice("__invalid__:".length)}/${token}`)
              } else if (cursor.effectiveCwd) {
                foundScripts.add(path.posix.normalize(`${cursor.effectiveCwd}/${token}`))
              } else if (/^(?:\.\/)?(?:packages\/|scripts\/|\.github\/)/.test(token)) {
                foundScripts.add(path.posix.normalize(token))
              } else {
                foundScripts.add(path.posix.normalize(`packages/cz-cli/${token}`))
              }
              cmdState.handledCommand = true
            }
            break
          }
          if (!cursor.afterDoubleDash) {
            if (token === "--") {
              cursor.afterDoubleDash = true
              continue
            }
            if ((token === "--cwd" || token === "-C") && tokens[cursor.index] !== undefined) {
              cursor.effectiveCwd = resolveRelativeRepoDir(cursor.effectiveCwd, tokens[cursor.index]!)
              cursor.index += 1
              continue
            }
            if (token.startsWith("--cwd=")) {
              cursor.effectiveCwd = resolveRelativeRepoDir(cursor.effectiveCwd, token.slice("--cwd=".length))
              continue
            }
            if (valueFlags.has(token)) {
              cursor.index += 1
              continue
            }
            if (token.startsWith("-")) continue
          }
          if (cursor.effectiveCwd.startsWith("__invalid__:")) {
            foundTests.add(`${cursor.effectiveCwd.slice("__invalid__:".length)}/${token}`)
            continue
          }
          const joined = cursor.effectiveCwd ? `${cursor.effectiveCwd}/${token}` : token
          const normalizedTarget = path.posix.normalize(joined)
          const repoPath = normalizeRepoSourcePath(normalizedTarget)
          if (repoPath) {
            foundTests.add(repoPath)
            state.lastDir = path.posix.dirname(repoPath)
            continue
          }
          foundTests.add(normalizedTarget)
        }
        if (cursor.isTestSubcommand) cmdState.handledCommand = true
      }
    }

    if (cmdState.handledCommand) continue

    if (!/[;&|\s]/.test(span)) {
      const directRepoPath = normalizeRepoSourcePath(span)
      if (directRepoPath) {
        foundTests.add(directRepoPath)
        state.lastDir = path.posix.dirname(directRepoPath)
        continue
      }
      if (/\.test\.(?:ts|tsx|js|mjs)$/.test(span)) {
        if (state.lastDir && !span.includes("/")) {
          foundTests.add(`${state.lastDir}/${span}`)
          continue
        }
        const resolvedRel = span.startsWith("/")
          ? path.posix.normalize(span.slice(1))
          : path.posix.normalize(`packages/cz-cli/${span}`)
        foundTests.add(resolvedRel)
        const repoPath = normalizeRepoSourcePath(resolvedRel)
        if (repoPath) state.lastDir = path.posix.dirname(repoPath)
      }
    }
  }
  return { tests: [...foundTests], scripts: [...foundScripts], refs: [...foundRefs] }
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
  return [...section.matchAll(LEDGER_PATH_PATTERN)].map((match) => path.posix.normalize(match[1]!))
}

function walkSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) return []
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
