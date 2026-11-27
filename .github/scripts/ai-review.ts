import { chmodSync, mkdirSync } from "node:fs"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { load } from "js-yaml"
import { executeReview } from "./review-executor"

export type DiffLineMap = {
  right: Map<string, Set<number>>
  left: Map<string, Set<number>>
}

export function validateReview(
  value: unknown,
  sha: string,
  changed: Map<string, Set<number>> | DiffLineMap,
) {
  const legacyRightOnly = changed instanceof Map
  const maps: DiffLineMap = legacyRightOnly ? { right: changed, left: new Map() } : changed
  if (!value || typeof value !== "object") throw new Error("Review is not an object")
  const review = value as Record<string, unknown>
  if (
    review.reviewedSha !== sha ||
    typeof review.summary !== "string" ||
    !review.summary.trim() ||
    review.summary.length > 16000 ||
    !Array.isArray(review.findings) ||
    review.findings.length > 50
  )
    throw new Error("Review head, summary or finding count is invalid")
  const findings = review.findings.map((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Invalid finding")
    const finding = input as Record<string, unknown>
    const requestedSide = finding.side === undefined && legacyRightOnly ? "RIGHT" : finding.side
    if (requestedSide !== "RIGHT" && requestedSide !== "LEFT") {
      throw new Error("Finding side must be RIGHT or LEFT")
    }
    const pathValue = typeof finding.path === "string" ? finding.path : ""
    const lineValue = typeof finding.line === "number" ? finding.line : -1
    const onRight = Boolean(maps.right.get(pathValue)?.has(lineValue))
    const onLeft = Boolean(maps.left.get(pathValue)?.has(lineValue))
    const resolvedSide =
      requestedSide === "LEFT"
        ? onLeft
          ? "LEFT"
          : undefined
        : onRight
          ? "RIGHT"
          : undefined
    if (
      !pathValue ||
      !Number.isInteger(lineValue) ||
      !resolvedSide ||
      typeof finding.severity !== "string" ||
      !["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(finding.severity) ||
      typeof finding.confidence !== "string" ||
      !["high", "medium", "low"].includes(finding.confidence) ||
      typeof finding.body !== "string" ||
      !finding.body.trim() ||
      finding.body.length > 12000
    )
      throw new Error("Finding must identify a changed or deleted diff line, severity, confidence and explanation")
    return {
      path: pathValue,
      line: lineValue,
      side: resolvedSide,
      body: `[${finding.severity}; ${finding.confidence} confidence] ${finding.body}`,
    }
  })
  return { summary: review.summary, findings }
}

export function diffLineLocations(diff: string): DiffLineMap {
  const right = new Map<string, Set<number>>()
  const left = new Map<string, Set<number>>()
  const state = { oldFile: "", newFile: "", oldLine: 0, newLine: 0, hunk: false }
  diff.split("\n").forEach((line) => {
    if (line.startsWith("diff --git ")) {
      state.hunk = false
      state.oldFile = ""
      state.newFile = ""
      return
    }
    if (!state.hunk && line.startsWith("--- ")) {
      const file = decodeGitPath(line.slice(4).split("\t", 1)[0])
      if (!file.startsWith("a/")) return
      state.oldFile = file.slice(2)
      return
    }
    if (!state.hunk && line.startsWith("+++ ")) {
      const file = decodeGitPath(line.slice(4).split("\t", 1)[0])
      if (!file.startsWith("b/")) return
      state.newFile = file.slice(2)
      return
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      state.oldLine = Number(hunk[1])
      state.newLine = Number(hunk[2])
      state.hunk = true
      return
    }
    if (!state.hunk) return
    // GitHub PR diff entries key renamed/modified files by destination path (b/), falling back to a/ only for deleted files.
    const targetFile = state.newFile || state.oldFile
    if (line.startsWith("+")) {
      if (state.newFile) {
        const set = right.get(state.newFile) ?? new Set<number>()
        set.add(state.newLine)
        right.set(state.newFile, set)
      }
      state.newLine += 1
      return
    }
    if (line.startsWith("-")) {
      if (targetFile) {
        const set = left.get(targetFile) ?? new Set<number>()
        set.add(state.oldLine)
        left.set(targetFile, set)
      }
      state.oldLine += 1
      return
    }
    if (line.startsWith(" ")) {
      state.oldLine += 1
      state.newLine += 1
    }
  })
  return { right, left }
}

export function changedLines(diff: string) {
  return diffLineLocations(diff).right
}

export type MdxSourceMap = {
  left: Map<string, string>
  right: Map<string, string>
}

type DiffDocEntry = {
  targetFile: string
  oldFile: string
  newFile: string
  beforeHunkLines: string[]
  afterHunkLines: string[]
  deletedHunkIndices: number[]
  addedHunkIndices: number[]
}

const starlightPage = /^packages\/web\/src\/content\/docs\/.*\.(?:md|mdx)$/i

function parseDiffEntries(diff: string) {
  const touched = new Set<string>()
  const docEntries = new Map<string, DiffDocEntry>()
  const locations = diffLineLocations(diff)
  locations.right.forEach((_, file) => touched.add(file))
  locations.left.forEach((_, file) => touched.add(file))

  const state = { inHunk: false, oldFile: "", newFile: "", headerPath: "" }
  const ensureDocEntry = () => {
    const targetFile = state.newFile || state.oldFile || state.headerPath
    if (!/\.mdx$/i.test(targetFile) && !starlightPage.test(targetFile) && !starlightPage.test(state.oldFile)) {
      return undefined
    }
    const existing = docEntries.get(targetFile)
    if (existing) {
      if (state.oldFile) existing.oldFile = state.oldFile
      if (state.newFile) existing.newFile = state.newFile
      return existing
    }
    const created: DiffDocEntry = {
      targetFile,
      oldFile: state.oldFile,
      newFile: state.newFile,
      beforeHunkLines: [],
      afterHunkLines: [],
      deletedHunkIndices: [],
      addedHunkIndices: [],
    }
    docEntries.set(targetFile, created)
    return created
  }

  diff.split("\n").forEach((line) => {
    if (line.startsWith("diff --git ")) {
      ensureDocEntry()
      state.inHunk = false
      state.oldFile = ""
      state.newFile = ""
      state.headerPath = parseDiffGitHeaderPath(line.slice("diff --git ".length)) ?? ""
      if (state.headerPath) touched.add(state.headerPath)
      return
    }
    if (!state.inHunk && line.startsWith("--- ")) {
      const file = decodeGitPath(line.slice(4).split("\t", 1)[0])
      if (file.startsWith("a/")) state.oldFile = file.slice(2)
      return
    }
    if (!state.inHunk && line.startsWith("+++ ")) {
      const file = decodeGitPath(line.slice(4).split("\t", 1)[0])
      if (file.startsWith("b/")) state.newFile = file.slice(2)
      ensureDocEntry()
      return
    }
    if (line.startsWith("@@ ")) {
      state.inHunk = true
      ensureDocEntry()
      return
    }
    if (state.inHunk) {
      const entry = ensureDocEntry()
      if (!entry) return
      if (line.startsWith("-")) {
        entry.beforeHunkLines.push(line.slice(1))
        entry.deletedHunkIndices.push(entry.beforeHunkLines.length)
        return
      }
      if (line.startsWith("+")) {
        entry.afterHunkLines.push(line.slice(1))
        entry.addedHunkIndices.push(entry.afterHunkLines.length)
        return
      }
      if (line.startsWith(" ")) {
        const text = line.slice(1)
        entry.beforeHunkLines.push(text)
        entry.afterHunkLines.push(text)
      }
      return
    }
    if (line.startsWith("rename from ") || line.startsWith("copy from ")) {
      const prefix = line.startsWith("rename from ") ? "rename from " : "copy from "
      const decoded = decodeGitPath(line.slice(prefix.length))
      state.oldFile = decoded
      touched.add(decoded)
      return
    }
    if (line.startsWith("rename to ") || line.startsWith("copy to ")) {
      const prefix = line.startsWith("rename to ") ? "rename to " : "copy to "
      const decoded = decodeGitPath(line.slice(prefix.length))
      state.newFile = decoded
      touched.add(decoded)
      ensureDocEntry()
    }
  })
  ensureDocEntry()
  return { touched, docEntries, locations }
}

// Starlight applies the same page metadata schema to Markdown and MDX.
export async function loadDiffMdxSources(
  diff: string,
  baseSha: string,
  headSha: string,
  cwd = process.cwd(),
): Promise<MdxSourceMap> {
  const { docEntries } = parseDiffEntries(diff)
  const left = new Map<string, string>()
  const right = new Map<string, string>()
  if (docEntries.size === 0) return { left, right }

  const mergeBaseOut = await gitOptional(["merge-base", baseSha, headSha], cwd)
  const leftRev = mergeBaseOut?.trim() || baseSha

  for (const entry of docEntries.values()) {
    const oldPath = entry.oldFile || entry.targetFile
    const newPath = entry.newFile || entry.targetFile
    if (oldPath) {
      const oldText = await gitOptional(["cat-file", "-p", `${leftRev}:${oldPath}`], cwd)
      if (oldText !== undefined) left.set(entry.targetFile, oldText)
    }
    if (newPath) {
      const newText = await gitOptional(["cat-file", "-p", `${headSha}:${newPath}`], cwd)
      if (newText !== undefined) right.set(entry.targetFile, newText)
    }
  }
  return { left, right }
}

export function hasReviewablePaths(diff: string, docSources?: MdxSourceMap): boolean {
  const { touched, docEntries, locations } = parseDiffEntries(diff)
  const rootReviewableDocs = /^(?:AGENTS|CLAUDE|SECURITY|LICENSE)\.(?:md|mdx)$/i
  const docStaticImage = /\.(?:png|jpe?g|gif|webp|avif|ico)$/i
  return [...touched].some((file) => {
    if (file === ".github/codex-review-prompt.md" || file === ".github/claude-review-context.md") return true
    const entry = docEntries.get(file)
    if (entry && docSources) {
      const leftDoc = docSources.left.get(file)
      const rightDoc = docSources.right.get(file)
      const leftHead = leftDoc !== undefined && starlightPage.test(entry.oldFile || file) ? starlightHead(leftDoc) : []
      const rightHead =
        rightDoc !== undefined && starlightPage.test(entry.newFile || file) ? starlightHead(rightDoc) : []
      if (!isDeepStrictEqual(leftHead, rightHead)) return true
    }
    if (/\.mdx$/i.test(file) && isReviewableMdxFile(file, entry, locations, docSources)) return true
    if (/^docs\/.*\.(?:md|mdx|txt)$/i.test(file) || (/^docs\//.test(file) && docStaticImage.test(file))) return false
    if (
      /^packages\/docs\/.*\.(?:md|mdx|txt)$/i.test(file) ||
      (/^packages\/docs\//.test(file) && docStaticImage.test(file))
    ) {
      return false
    }
    if (
      starlightPage.test(file) ||
      /^packages\/web\/src\/content\/docs\/.*\.txt$/i.test(file) ||
      (/^packages\/web\/src\/content\/docs\//.test(file) && docStaticImage.test(file))
    ) {
      return false
    }
    if (!file.includes("/") && /\.(?:md|mdx)$/i.test(file) && !rootReviewableDocs.test(file)) return false
    if (/^(?:packages|sdks|infra)\/(?:[^/\0]+\/)*(?:README|CHANGELOG|CONTRIBUTING)\.(?:md|mdx)$/i.test(file)) {
      return false
    }
    return true
  })
}

function starlightHead(doc: string): unknown {
  // Match the opening frontmatter block recognized by Astro's Markdown parser.
  const match = /(?:^\uFEFF?|^\s*\n)(---|\+\+\+)([\s\S]*?\n)(?:---|\+\+\+)/.exec(doc)
  if (!match) return []
  const frontmatter = match[2]!
  try {
    const data: unknown = match[1] === "+++" ? Bun.TOML.parse(frontmatter) : load(frontmatter)
    return data && typeof data === "object" && "head" in data ? data.head : []
  } catch {
    // Keep changes reviewable when the frontmatter cannot be parsed.
    return { unparsed: frontmatter }
  }
}

function isReviewableMdxFile(
  file: string,
  entry: DiffDocEntry | undefined,
  locations: DiffLineMap,
  docSources?: MdxSourceMap,
): boolean {
  const targetKey = entry?.targetFile ?? file
  const hasFullLeft = Boolean(docSources?.left.has(targetKey))
  const hasFullRight = Boolean(docSources?.right.has(targetKey))
  if (hasFullLeft || hasFullRight) {
    const leftDoc = docSources?.left.get(targetKey) ?? ""
    const rightDoc = docSources?.right.get(targetKey) ?? ""
    const leftExec = mdxExecutableLines(leftDoc)
    const rightExec = mdxExecutableLines(rightDoc)
    const deletedLines = locations.left.get(targetKey) ?? new Set<number>()
    const addedLines = locations.right.get(targetKey) ?? new Set<number>()
    for (const lineNo of deletedLines) {
      if (leftExec.has(lineNo)) return true
    }
    for (const lineNo of addedLines) {
      if (rightExec.has(lineNo)) return true
    }
    if (mdxExecutableSignature(leftDoc, leftExec) !== mdxExecutableSignature(rightDoc, rightExec)) {
      return true
    }
    // Moving an MDX file that contains executable imports/components can break relative resolution.
    if (entry && entry.oldFile && entry.newFile && entry.oldFile !== entry.newFile) {
      if (leftExec.size > 0 || rightExec.size > 0) return true
    }
    return false
  }
  if (!entry) return false
  const beforeHunkDoc = entry.beforeHunkLines.join("\n")
  const afterHunkDoc = entry.afterHunkLines.join("\n")
  const fallbackLeftExec = mdxExecutableLines(beforeHunkDoc)
  const fallbackRightExec = mdxExecutableLines(afterHunkDoc)
  return (
    entry.deletedHunkIndices.some((idx) => fallbackLeftExec.has(idx)) ||
    entry.addedHunkIndices.some((idx) => fallbackRightExec.has(idx)) ||
    mdxExecutableSignature(beforeHunkDoc, fallbackLeftExec) !== mdxExecutableSignature(afterHunkDoc, fallbackRightExec)
  )
}

export function mdxExecutableLines(doc: string): Set<number> {
  const executable = new Set<number>()
  if (!doc) return executable
  const lines = doc.replace(/\r\n/g, "\n").split("\n")
  const state = {
    startIdx: 0,
    fenceChar: "",
    fenceLen: 0,
    inHtmlComment: false,
    rawTag: "",
    inJsxTag: false,
    jsxTagName: "",
    jsxClosingTag: false,
    jsxQuote: "",
    jsxBraceDepth: 0,
    braceDepth: 0,
    exprQuote: "",
    inBlockComment: false,
    esmMode: "" as "" | "import" | "export",
    esmBracketDepth: 0,
  }

  if (lines[0]?.trim() === "---") {
    const fmEnd = lines.findIndex((ln, idx) => idx > 0 && /^(?:---|\.\.\.)\s*$/.test(ln))
    if (fmEnd > 0) state.startIdx = fmEnd + 1
  }

  for (let idx = state.startIdx; idx < lines.length; idx += 1) {
    const line = lines[idx]!
    const lineNo = idx + 1

    if (state.fenceChar) {
      const closePattern =
        state.fenceChar === "`"
          ? new RegExp(`^ {0,3}\`{${state.fenceLen},}\\s*$`)
          : new RegExp(`^ {0,3}~{${state.fenceLen},}\\s*$`)
      if (closePattern.test(line)) {
        state.fenceChar = ""
        state.fenceLen = 0
      }
      continue
    }

    if (
      !state.inJsxTag &&
      state.braceDepth === 0 &&
      !state.inHtmlComment &&
      !state.rawTag &&
      !state.esmMode
    ) {
      const openFence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (openFence && !(openFence[1]![0] === "`" && openFence[2]!.includes("`"))) {
        state.fenceChar = openFence[1]![0]!
        state.fenceLen = openFence[1]!.length
        continue
      }
    }

    if (state.esmMode) {
      if (!line.trim()) {
        state.esmMode = ""
        state.esmBracketDepth = 0
        continue
      }
      executable.add(lineNo)
      state.esmBracketDepth = updateBracketBalance(line, state.esmBracketDepth)
      if (state.esmMode === "import") {
        if (state.esmBracketDepth <= 0 && /["']\s*;?\s*$/.test(line)) {
          state.esmMode = ""
          state.esmBracketDepth = 0
        }
        continue
      }
      if (state.esmBracketDepth <= 0 && !/(?:,|from|=)\s*$/.test(line.trim())) {
        state.esmMode = ""
        state.esmBracketDepth = 0
      }
      continue
    }

    if (!state.inJsxTag && state.braceDepth === 0 && !state.inHtmlComment && !state.rawTag) {
      if (isMdxEsmImportStart(line)) {
        executable.add(lineNo)
        const depth = updateBracketBalance(line, 0)
        if (depth > 0 || !/["']\s*;?\s*$/.test(line)) {
          state.esmMode = "import"
          state.esmBracketDepth = depth
        }
        continue
      }
      if (
        /^\s*export\s+(?:default\b|const\b|let\b|var\b|function\b|async\s+function\b|class\b|type\b|interface\b|enum\b|\{|\*)/.test(
          line,
        )
      ) {
        executable.add(lineNo)
        const depth = updateBracketBalance(line, 0)
        if (depth > 0 || /(?:,|from|=)\s*$/.test(line.trim())) {
          state.esmMode = "export"
          state.esmBracketDepth = depth
        }
        continue
      }
    }

    if (state.inJsxTag || state.braceDepth > 0 || state.rawTag) {
      executable.add(lineNo)
    }

    const cursor = { i: 0 }
    while (cursor.i < line.length) {
      if (state.inHtmlComment) {
        const endComment = line.indexOf("-->", cursor.i)
        if (endComment === -1) break
        state.inHtmlComment = false
        cursor.i = endComment + 3
        continue
      }

      if (state.rawTag) {
        executable.add(lineNo)
        const closeMatch = line.slice(cursor.i).match(new RegExp(`^</${state.rawTag}\\s*>`, "i"))
        if (closeMatch) {
          state.rawTag = ""
          cursor.i += closeMatch[0].length
          continue
        }
        const nextLt = line.indexOf("<", cursor.i + 1)
        if (nextLt === -1) break
        cursor.i = nextLt
        continue
      }

      if (state.inJsxTag) {
        executable.add(lineNo)
        const ch = line[cursor.i]!
        if (state.jsxQuote) {
          if (ch === "\\") {
            cursor.i += 2
            continue
          }
          if (ch === state.jsxQuote) state.jsxQuote = ""
          cursor.i += 1
          continue
        }
        if (state.jsxBraceDepth > 0) {
          cursor.i = stepJsExpressionChar(line, cursor.i, state, "jsx")
          continue
        }
        if (ch === '"' || ch === "'") {
          state.jsxQuote = ch
          cursor.i += 1
          continue
        }
        if (ch === "{") {
          state.jsxBraceDepth = 1
          cursor.i += 1
          continue
        }
        if (ch === ">") {
          const selfClosing = cursor.i > 0 && line[cursor.i - 1] === "/"
          if (!selfClosing && !state.jsxClosingTag && (state.jsxTagName === "script" || state.jsxTagName === "style")) {
            state.rawTag = state.jsxTagName
          }
          state.inJsxTag = false
          state.jsxTagName = ""
          state.jsxClosingTag = false
          cursor.i += 1
          continue
        }
        cursor.i += 1
        continue
      }

      if (state.braceDepth > 0) {
        executable.add(lineNo)
        cursor.i = stepJsExpressionChar(line, cursor.i, state, "root")
        continue
      }

      const ch = line[cursor.i]!
      if (ch === "\\") {
        cursor.i += 2
        continue
      }
      if (ch === "`") {
        const tickMatch = line.slice(cursor.i).match(/^`+/)!
        const ticks = tickMatch[0]
        const closingIdx = line.indexOf(ticks, cursor.i + ticks.length)
        if (closingIdx !== -1) {
          cursor.i = closingIdx + ticks.length
          continue
        }
        cursor.i += ticks.length
        continue
      }
      if (line.startsWith("<!--", cursor.i)) {
        state.inHtmlComment = true
        cursor.i += 4
        continue
      }
      if (ch === "{") {
        executable.add(lineNo)
        state.braceDepth = 1
        cursor.i += 1
        continue
      }
      if (ch === "<") {
        const rest = line.slice(cursor.i)
        const autolink = rest.match(/^<(?:https?:\/\/|mailto:)[^>\s]+>/i)
        if (autolink) {
          cursor.i += autolink[0].length
          continue
        }
        const tagStart = rest.match(/^<(\/?)([A-Za-z][\w.:-]*)?(?=[\s/>]|$)/)
        if (tagStart && (tagStart[2] || rest.startsWith("<>") || rest.startsWith("</>"))) {
          executable.add(lineNo)
          state.inJsxTag = true
          state.jsxClosingTag = tagStart[1] === "/"
          state.jsxTagName = (tagStart[2] ?? "").toLowerCase()
          cursor.i += tagStart[0].length
          continue
        }
      }
      cursor.i += 1
    }
  }

  return executable
}

function mdxExecutableSignature(doc: string, execLines: Set<number>): string {
  if (execLines.size === 0 || !doc) return ""
  const lines = doc.replace(/\r\n/g, "\n").split("\n")
  return [...execLines]
    .sort((a, b) => a - b)
    .map((lineNo) => lines[lineNo - 1] ?? "")
    .join("\n")
}

function isMdxEsmImportStart(line: string): boolean {
  if (/^\s*import\s*(?:["'{]|\*\s*as\b)/.test(line)) return true
  if (/^\s*import\s+type(?:\s*\{|\s*\*\s*as\b|\s+[A-Za-z_$][\w$]*(?:\s+from\b|\s*$)|\s*$)/.test(line)) return true
  if (/^\s*import\s+[A-Za-z_$][\w$]*\s*,/.test(line)) return true
  return /^\s*import\s+[A-Za-z_$][\w$]*\s+from(?:\s*["']|\s*$)/.test(line)
}

function stepJsExpressionChar(
  line: string,
  index: number,
  state: {
    jsxBraceDepth: number
    braceDepth: number
    exprQuote: string
    inBlockComment: boolean
  },
  mode: "jsx" | "root",
): number {
  if (state.inBlockComment) {
    const closeIdx = line.indexOf("*/", index)
    if (closeIdx === -1) return line.length
    state.inBlockComment = false
    return closeIdx + 2
  }
  const ch = line[index]!
  if (state.exprQuote) {
    if (ch === "\\") return index + 2
    if (ch === state.exprQuote) state.exprQuote = ""
    return index + 1
  }
  if (ch === "/" && line[index + 1] === "/") return line.length
  if (ch === "/" && line[index + 1] === "*") {
    state.inBlockComment = true
    return index + 2
  }
  if (ch === "'" || ch === '"' || ch === "`") {
    state.exprQuote = ch
    return index + 1
  }
  if (ch === "{") {
    if (mode === "jsx") state.jsxBraceDepth += 1
    if (mode === "root") state.braceDepth += 1
    return index + 1
  }
  if (ch === "}") {
    if (mode === "jsx") state.jsxBraceDepth -= 1
    if (mode === "root") state.braceDepth -= 1
    return index + 1
  }
  return index + 1
}

function updateBracketBalance(line: string, initial: number): number {
  const s = { depth: initial, quote: "", i: 0 }
  while (s.i < line.length) {
    const ch = line[s.i]!
    if (s.quote) {
      if (ch === "\\") {
        s.i += 2
        continue
      }
      if (ch === s.quote) s.quote = ""
      s.i += 1
      continue
    }
    if (ch === "/" && line[s.i + 1] === "/") break
    if (ch === "'" || ch === '"' || ch === "`") {
      s.quote = ch
      s.i += 1
      continue
    }
    if (ch === "{" || ch === "(" || ch === "[") s.depth += 1
    if (ch === "}" || ch === ")" || ch === "]") s.depth -= 1
    s.i += 1
  }
  return s.depth
}

async function gitOptional(args: string[], cwd: string): Promise<string | undefined> {
  const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return code === 0 ? stdout : undefined
}

function parseDiffGitHeaderPath(rest: string): string | undefined {
  // With --no-renames --src-prefix=a/ --dst-prefix=b/, both sides name the same path:
  // either unquoted `a/<p> b/<p>` or quoted `"a/<escaped>" "b/<escaped>"`.
  if (rest.startsWith('"')) {
    const closing = findClosingQuote(rest, 0)
    if (closing <= 1) return undefined
    const decoded = decodeGitPath(rest.slice(0, closing + 1))
    return decoded.startsWith("a/") ? decoded.slice(2) : undefined
  }
  const midpoint = Math.floor((rest.length - 1) / 2)
  if (rest[midpoint] === " ") {
    const left = rest.slice(0, midpoint)
    const right = rest.slice(midpoint + 1)
    if (left.startsWith("a/") && right === `b/${left.slice(2)}`) return left.slice(2)
  }
  return undefined
}

function findClosingQuote(text: string, start: number): number {
  const state = { index: start + 1, escaped: false }
  while (state.index < text.length) {
    const ch = text[state.index]
    if (state.escaped) {
      state.escaped = false
      state.index += 1
      continue
    }
    if (ch === "\\") {
      state.escaped = true
      state.index += 1
      continue
    }
    if (ch === '"') return state.index
    state.index += 1
  }
  return -1
}

function decodeGitPath(value: string) {
  if (!value.startsWith('"')) return value
  if (!value.endsWith('"')) throw new Error("Invalid Git pathname")
  const escapes: Record<string, string> = {
    a: "\x07",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
    '"': '"',
    "\\": "\\",
  }
  const encoder = new TextEncoder()
  // Git C-quotes UTF-8 bytes with octal escapes, which JSON.parse cannot decode.
  const bytes = (value.slice(1, -1).match(/\\(?:[0-7]{1,3}|.)|[^\\]+/g) ?? []).flatMap((token) => {
    if (!token.startsWith("\\")) return [...encoder.encode(token)]
    if (/^\\[0-7]{1,3}$/.test(token)) return [Number.parseInt(token.slice(1), 8)]
    const character = escapes[token.slice(1)]
    if (character === undefined) throw new Error("Invalid Git pathname escape")
    return [...encoder.encode(character)]
  })
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes))
}

export async function runReview() {
  process.umask(0o077)
  const repository = required("GITHUB_REPOSITORY")
  const number = required("REVIEW_PR_NUMBER")
  const head = required("REVIEW_HEAD_SHA")
  const base = required("REVIEW_BASE_SHA")
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    !/^[1-9]\d*$/.test(number) ||
    !/^[a-f0-9]{40}$/.test(head) ||
    !/^[a-f0-9]{40}$/.test(base)
  )
    throw new Error("Invalid immutable review identity")
  const root = process.cwd()
  await command(["git", "fetch", "--no-tags", "origin", head, base])
  const diff = await command([
    "git",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--unified=0",
    `${base}...${head}`,
  ])
  const docSources = await loadDiffMdxSources(diff, base, head, root)
  if (process.env.CODEX_REVIEW_DRY_RUN !== "true" && !hasReviewablePaths(diff, docSources)) {
    return { skipped: "docs-only", head }
  }
  const directory = path.join(required("RUNNER_TEMP"), "cz-ai-review")
  const home = path.join(directory, "codex")
  const source = path.join(directory, "source")
  mkdirSync(home, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  chmodSync(home, 0o700)
  const key = required("CODEX_REVIEW_API_KEY")
  const url = required("CODEX_REVIEW_BASE_URL")
  const model = required("CODEX_REVIEW_MODEL")
  await Bun.write(path.join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: key }))
  await Bun.write(
    path.join(home, "config.toml"),
    [
      'model_provider = "review"',
      `model = ${JSON.stringify(model)}`,
      'model_reasoning_effort = "high"',
      "project_doc_max_bytes = 0",
      'web_search = "disabled"',
      `[projects.${JSON.stringify(source)}]`,
      'trust_level = "untrusted"',
      "[features]",
      "memories = false",
      "multi_agent = false",
      "shell_snapshot = false",
      "use_legacy_landlock = false",
      "[permissions.review.filesystem]",
      '":root" = "deny"',
      '":minimal" = "read"',
      `${JSON.stringify(root)} = "read"`,
      `${JSON.stringify(source)} = "read"`,
      `${JSON.stringify(home)} = "deny"`,
      '"/proc" = "deny"',
      "[permissions.review.network]",
      "enabled = false",
      "[model_providers.review]",
      'name = "Review"',
      `base_url = ${JSON.stringify(url)}`,
      'wire_api = "responses"',
      "requires_openai_auth = true",
      "supports_websockets = false",
    ].join("\n"),
  )
  chmodSync(path.join(home, "auth.json"), 0o600)
  chmodSync(path.join(home, "config.toml"), 0o600)
  await command(["git", "-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", source, head])
  const schema = path.join(directory, "schema.json")
  await Bun.write(
    schema,
    JSON.stringify({
      type: "object",
      additionalProperties: false,
      required: ["reviewedSha", "summary", "findings"],
      properties: {
        reviewedSha: { type: "string" },
        summary: { type: "string" },
        findings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "line", "side", "severity", "confidence", "body"],
            properties: {
              path: { type: "string" },
              line: { type: "integer" },
              side: { type: "string", enum: ["RIGHT", "LEFT"] },
              severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              body: { type: "string" },
            },
          },
        },
      },
    }),
  )
  const prompt = [
    `Review ${repository} PR #${number} at immutable head ${head}, against base ${base}.`,
    `Reviewed source: ${source}. Trusted review instructions and context are from ${root}, the base revision.`,
    (await Bun.file(path.join(root, ".github/codex-review-prompt.md")).text()).replaceAll("TRUSTED_ROOT", root),
    "Trusted base context:",
    await Bun.file(path.join(root, ".github/claude-review-context.md")).text(),
    `Read ${path.join(root, "packages/cz-cli/UPSTREAM-PATCHES.md")} for the trusted patch ledger.`,
    `Inspect the diff using git diff --find-renames ${base}...${head} and read full surrounding files; do not execute source. For renamed files with edits, use the destination (b/) path for both RIGHT and LEFT inline findings; pure renames have no inline diff hunks, so cover them in summary.`,
  ].join("\n")
  const response = await executeReview({
    binary: required("CODEX_BINARY"),
    home,
    source,
    directory: path.join(directory, "run"),
    model,
    schema,
    prompt,
  })
  if (!response) throw new Error("Codex review failed; no review was posted")
  const review = validateReview(JSON.parse(response), head, diffLineLocations(diff))
  // Never publish a credential even if untrusted source persuaded the model to repeat it.
  const secrets = [key, url, process.env.GH_TOKEN, process.env.GITHUB_TOKEN].filter((value): value is string => !!value)
  const publication = [review.summary, ...review.findings.flatMap((finding) => [finding.path, finding.body])]
  if (secrets.some((secret) => publication.some((value) => value.includes(secret))))
    throw new Error("Review contains private configuration; refusing to publish")
  if (process.env.CODEX_REVIEW_DRY_RUN === "true") return { dryRun: true, head, findings: review.findings.length }
  const current = JSON.parse(await command(["gh", "api", `repos/${repository}/pulls/${number}`]))
  if (current.head.sha !== head || current.base.sha !== base || current.state !== "open")
    throw new Error("PR head/base/state changed; refusing a stale review")
  const marker = `<!-- codex-review:${base}:${head} -->`
  const prior = JSON.parse(
    await command(["gh", "api", "--paginate", "--slurp", `repos/${repository}/pulls/${number}/reviews`]),
  )
  if (
    prior
      .flat()
      .some(
        (entry: { body?: string; user?: { login?: string } }) =>
          entry.user?.login === "github-actions[bot]" && entry.body?.includes(marker),
      )
  )
    return { duplicate: true, head }
  const file = path.join(directory, "review.json")
  await Bun.write(
    file,
    JSON.stringify({
      commit_id: head,
      event: "COMMENT",
      body: `${marker}\n${review.summary}`,
      comments: review.findings,
    }),
  )
  // A timeout may have delivered the review. Do not automatically retry this write.
  await command(["gh", "api", "--method", "POST", `repos/${repository}/pulls/${number}/reviews`, "--input", file])
  return { head, findings: review.findings.length }
}

function required(name: string) {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`Missing ${name}`)
  return value
}

async function command(args: string[]) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  const [stdout, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`${args[0]} ${args[1]} failed; no automatic write retry`)
  return stdout
}

if (import.meta.main)
  runReview().then(
    (result) => console.log(JSON.stringify(result)),
    () => {
      console.error("AI review failed; private transcripts are not printed to public Actions logs")
      process.exitCode = 1
    },
  )
