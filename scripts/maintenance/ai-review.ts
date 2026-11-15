import { chmodSync, mkdirSync } from "node:fs"
import path from "node:path"
import { executeCodex } from "./codex-executor"

export function validateReview(value: unknown, sha: string, changed: Map<string, Set<number>>) {
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
    if (
      typeof finding.path !== "string" ||
      typeof finding.line !== "number" ||
      !changed.get(finding.path)?.has(finding.line) ||
      typeof finding.severity !== "string" ||
      !["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(finding.severity) ||
      typeof finding.confidence !== "string" ||
      !["high", "medium", "low"].includes(finding.confidence) ||
      typeof finding.body !== "string" ||
      !finding.body.trim() ||
      finding.body.length > 12000
    )
      throw new Error("Finding must identify a changed line, severity, confidence and explanation")
    return {
      path: finding.path,
      line: finding.line,
      side: "RIGHT",
      body: `[${finding.severity}; ${finding.confidence} confidence] ${finding.body}`,
    }
  })
  return { summary: review.summary, findings }
}

export function changedLines(diff: string) {
  const changed = new Map<string, Set<number>>()
  const state = { file: "", line: 0, hunk: false }
  diff.split("\n").forEach((line) => {
    if (line.startsWith("diff --git ")) {
      state.hunk = false
      state.file = ""
      return
    }
    if (!state.hunk && line.startsWith("+++ ")) {
      const file = decodeGitPath(line.slice(4).split("\t", 1)[0])
      if (!file.startsWith("b/")) return
      state.file = file.slice(2)
      changed.set(state.file, new Set())
      return
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      state.line = Number(hunk[1])
      state.hunk = true
      return
    }
    if (state.hunk && line.startsWith("+")) changed.get(state.file)?.add(state.line++)
    if (state.hunk && line.startsWith(" ")) state.line++
  })
  return changed
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
  const directory = path.join(required("RUNNER_TEMP"), "cz-ai-review")
  const home = path.join(directory, "codex")
  const source = path.join(directory, "source")
  mkdirSync(home, { recursive: true, mode: 0o700 })
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
      "[features]",
      "memories = false",
      "multi_agent = false",
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
  await command(["git", "fetch", "--no-tags", "origin", head, base])
  await command(["git", "-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", source, head])
  const diff = await command([
    "git",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--unified=0",
    `${base}...${head}`,
  ])
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
            required: ["path", "line", "severity", "confidence", "body"],
            properties: {
              path: { type: "string" },
              line: { type: "integer" },
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
    "Inspect the diff using git and read full surrounding files; do not execute source.",
  ].join("\n")
  const result = await executeCodex({
    root: source,
    directory,
    id: head,
    role: "worker",
    schema,
    settings: { binary: required("CODEX_BINARY"), home, model, sandbox: "read-only", timeoutSeconds: 900 },
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    prompt,
    signal: new AbortController().signal,
    onThread: () => {},
  })
  if (!result.success) throw new Error("Codex review failed; no review was posted")
  const response = await Bun.file(path.join(directory, "control/runs", head, "response.txt")).text()
  // Never publish a credential even if untrusted source persuaded the model to repeat it.
  const secrets = [key, url, process.env.GH_TOKEN, process.env.GITHUB_TOKEN].filter((value): value is string => !!value)
  if (secrets.some((secret) => response.includes(secret)))
    throw new Error("Review contains private configuration; refusing to publish")
  const review = validateReview(JSON.parse(response), head, changedLines(diff))
  if (process.env.CODEX_REVIEW_DRY_RUN === "true") return { dryRun: true, head, findings: review.findings.length }
  const current = JSON.parse(await command(["gh", "api", `repos/${repository}/pulls/${number}`]))
  if (current.head.sha !== head || current.state !== "open")
    throw new Error("PR head/state changed; refusing a stale review")
  const marker = `<!-- codex-review:${head} -->`
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
