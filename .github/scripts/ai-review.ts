import { chmodSync, mkdirSync } from "node:fs"
import path from "node:path"
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
  const maps: DiffLineMap =
    changed instanceof Map ? { right: changed, left: new Map() } : changed
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
    const requestedSide = finding.side === undefined ? undefined : finding.side
    if (requestedSide !== undefined && requestedSide !== "RIGHT" && requestedSide !== "LEFT") {
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
        : requestedSide === "RIGHT"
          ? onRight
            ? "RIGHT"
            : undefined
          : onRight
            ? "RIGHT"
            : onLeft
              ? "LEFT"
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

export function hasReviewablePaths(diff: string): boolean {
  const touched = new Set<string>()
  const locations = diffLineLocations(diff)
  locations.right.forEach((_, file) => touched.add(file))
  locations.left.forEach((_, file) => touched.add(file))
  const headerState = { inHunk: false }
  diff.split("\n").forEach((line) => {
    if (line.startsWith("diff --git ")) {
      headerState.inHunk = false
      const headerPath = parseDiffGitHeaderPath(line.slice("diff --git ".length))
      if (headerPath) touched.add(headerPath)
      return
    }
    if (line.startsWith("@@ ")) {
      headerState.inHunk = true
      return
    }
    if (headerState.inHunk) return
    for (const prefix of ["rename from ", "rename to ", "copy from ", "copy to "]) {
      if (line.startsWith(prefix)) {
        touched.add(decodeGitPath(line.slice(prefix.length)))
        return
      }
    }
  })
  return [...touched].some((file) => {
    if (file === ".github/codex-review-prompt.md" || file === ".github/claude-review-context.md") return true
    if (file.startsWith("docs/maintenance/")) return true
    if (/^docs\/.*\.(?:md|mdx|txt)$/.test(file)) return false
    if (/^packages\/docs\/.*\.(?:md|mdx|txt)$/.test(file)) return false
    if (!file.includes("/") && /\.(?:md|mdx)$/.test(file) && file !== "AGENTS.md" && file !== "CLAUDE.md") return false
    if (/^(?:packages|sdks|infra)\/(?:[^/\0]+\/)*(?:README|CHANGELOG|CONTRIBUTING)\.(?:md|mdx)$/i.test(file)) {
      return false
    }
    return true
  })
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
  if (process.env.CODEX_REVIEW_DRY_RUN !== "true" && !hasReviewablePaths(diff)) {
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
