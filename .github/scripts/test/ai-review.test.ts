import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { changedLines, diffLineLocations, hasReviewablePaths, validateReview } from "../ai-review"

const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -2,2 +2,3 @@
-old
+new
+added
 context
@@ -20,0 +22 @@
+last
`

test("AI review comments must target the exact reviewed head and changed lines", () => {
  const changed = changedLines(diff)
  expect([...changed.get("a.ts")!]).toEqual([2, 3, 22])
  const review = {
    reviewedSha: "abc",
    summary: "Reviewed the diff",
    findings: [{ path: "a.ts", line: 3, severity: "HIGH", confidence: "high", body: "A concrete issue" }],
  }
  expect(validateReview(review, "abc", changed).findings[0]).toMatchObject({ line: 3, side: "RIGHT" })
  expect(() => validateReview(review, "other-head", changed)).toThrow()
  expect(() => validateReview({ ...review, findings: [{ ...review.findings[0], line: 4 }] }, "abc", changed)).toThrow()
  expect(() =>
    validateReview({ ...review, findings: [{ ...review.findings[0], path: "../private" }] }, "abc", changed),
  ).toThrow()
  expect(() =>
    validateReview({ ...review, findings: [{ ...review.findings[0], confidence: "certain" }] }, "abc", changed),
  ).toThrow()
})

test("an explicitly empty review is valid without manufacturing findings", () => {
  expect(
    validateReview(
      { reviewedSha: "head", summary: "No supported findings; tests not run", findings: [] },
      "head",
      new Map(),
    ).findings,
  ).toEqual([])
})

test("AI review runner withholds GitHub credentials, validates output and deduplicates delivery", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ai-review-integration-"))
  const upstream = path.join(directory, "upstream")
  const root = path.join(directory, "control")
  const run = async (args: string[], cwd = directory) => {
    const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" })
    const [stdout, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(error + ` exit=${code}`).toContain("exit=0")
    return stdout.trim()
  }
  try {
    await run(["git", "init", "--initial-branch=main", upstream])
    for (const file of [
      ".github/codex-review-prompt.md",
      ".github/claude-review-context.md",
      "packages/cz-cli/UPSTREAM-PATCHES.md",
      "a.ts",
    ])
      await Bun.write(path.join(upstream, file), "trusted base\n")
    await run(["git", "add", "."], upstream)
    await run(["git", "-c", "user.name=Fixture", "-c", "user.email=f@example.test", "commit", "-m", "base"], upstream)
    const base = await run(["git", "rev-parse", "HEAD"], upstream)
    await run(["git", "clone", "--quiet", upstream, root])
    await Bun.write(path.join(upstream, "a.ts"), 'throw new Error("PR code must never execute")\n')
    await run(["git", "add", "."], upstream)
    await run(["git", "-c", "user.name=Fixture", "-c", "user.email=f@example.test", "commit", "-m", "head"], upstream)
    const head = await run(["git", "rev-parse", "HEAD"], upstream)
    const posted = path.join(directory, "posted.json")
    for (const [name, body] of Object.entries({
      gh: `const args=process.argv.slice(2); const file=${JSON.stringify(posted)};
if(args.includes('POST')) { await Bun.write(file,await Bun.file(args.at(-1)).text()); console.log('{}'); }
else if(args.at(-1).endsWith('/reviews')) console.log(JSON.stringify([await Bun.file(file).exists()?[{body:JSON.parse(await Bun.file(file).text()).body,user:{login:'github-actions[bot]'}}]:[]]));
else console.log(JSON.stringify({head:{sha:${JSON.stringify(head)}},base:{sha:process.env.RUNNER_TEMP.endsWith('/stale-base')?'0'.repeat(40):${JSON.stringify(base)}},state:'open'}));`,
      "codex-fixture": `if(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.CODEX_REVIEW_API_KEY) process.exit(20);
const args=process.argv.slice(2); await Bun.stdin.text();
if(args.includes('--sandbox') || !args.includes('--strict-config') || !args.includes('--ignore-rules') || !args.includes('default_permissions="review"')) process.exit(21);
const summary=process.env.CODEX_HOME.includes('/escaped/')?'private-fixture-key':'Reviewed source; no tests executed';
const response=JSON.stringify({reviewedSha:${JSON.stringify(head)},summary,findings:[{path:'a.ts',line:1,side:'RIGHT',severity:'HIGH',confidence:'high',body:'Concrete fixture finding'}]});
await Bun.write(args[args.indexOf('--output-last-message')+1],response.replaceAll('-',String.fromCharCode(92)+'u002d'));
console.log(JSON.stringify({type:'turn.completed'}));`,
    })) {
      const file = path.join(directory, name)
      await Bun.write(file, `#!${process.execPath}\n${body}`)
      chmodSync(file, 0o700)
    }
    const execute = async (dry: boolean, suffix: string, expectedCode = 0) => {
      const child = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "../ai-review.ts")], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GH_TOKEN: "github-token-not-for-model",
          GITHUB_REPOSITORY: "example/repo",
          REVIEW_PR_NUMBER: "1",
          REVIEW_HEAD_SHA: head,
          REVIEW_BASE_SHA: base,
          RUNNER_TEMP: path.join(directory, suffix),
          CODEX_BINARY: path.join(directory, "codex-fixture"),
          CODEX_REVIEW_API_KEY: "private-fixture-key",
          CODEX_REVIEW_BASE_URL: "https://fixture.invalid/v1",
          CODEX_REVIEW_MODEL: "fixture",
          CODEX_REVIEW_DRY_RUN: String(dry),
        },
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(code).toBe(expectedCode)
      if (code !== 0) {
        expect(stdout + stderr).not.toContain("private-fixture-key")
        return { rejected: true }
      }
      return JSON.parse(stdout)
    }
    expect((await execute(false, "escaped", 1)).rejected).toBe(true)
    expect(await Bun.file(posted).exists()).toBe(false)
    expect((await execute(false, "stale-base", 1)).rejected).toBe(true)
    expect(await Bun.file(posted).exists()).toBe(false)
    expect((await execute(true, "dry")).dryRun).toBe(true)
    expect(await Bun.file(posted).exists()).toBe(false)
    expect((await execute(false, "real")).findings).toBe(1)
    const receipt = await Bun.file(posted).text()
    expect(JSON.parse(receipt)).toMatchObject({ commit_id: head, comments: [{ path: "a.ts", line: 1, side: "RIGHT" }] })
    expect((await execute(false, "retry")).duplicate).toBe(true)
    expect(await Bun.file(posted).text()).toBe(receipt)

    // Docs-only PR skips cleanly BEFORE requiring CODEX_REVIEW_API_KEY / provider settings
    await Bun.write(path.join(upstream, "README.md"), "# Docs only\n")
    await run(["git", "add", "README.md"], upstream)
    await run(["git", "-c", "user.name=Fixture", "-c", "user.email=f@example.test", "commit", "-m", "readme"], upstream)
    const docsHead = await run(["git", "rev-parse", "HEAD"], upstream)
    const docsChild = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "../ai-review.ts")], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "example/repo",
        REVIEW_PR_NUMBER: "2",
        REVIEW_HEAD_SHA: docsHead,
        REVIEW_BASE_SHA: head,
        CODEX_REVIEW_API_KEY: "",
        CODEX_REVIEW_BASE_URL: "",
        CODEX_REVIEW_MODEL: "",
        CODEX_BINARY: "",
      },
    })
    const [docsOut, docsErr, docsCode] = await Promise.all([
      new Response(docsChild.stdout).text(),
      new Response(docsChild.stderr).text(),
      docsChild.exited,
    ])
    expect(docsErr + ` exit=${docsCode}`).toContain("exit=0")
    expect(JSON.parse(docsOut)).toEqual({ skipped: "docs-only", head: docsHead })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 30000)

test("addition lines beginning with plus signs are source, not diff headers", () => {
  const changed = changedLines("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1,2 @@\n+++i\n+doWork()\n")
  expect([...changed.get("a.ts")!]).toEqual([1, 2])
  expect(
    validateReview(
      {
        reviewedSha: "head",
        summary: "Checked increment",
        findings: [
          { path: "a.ts", line: 2, severity: "MEDIUM", confidence: "high", body: "Finding on second added line" },
        ],
      },
      "head",
      changed,
    ).findings[0].line,
  ).toBe(2)
})

test("Git-generated Unicode, whitespace and escaped paths retain valid finding locations", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "review-git-paths-"))
  const run = async (args: string[]) => {
    const child = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
    const [out, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(error + ` exit=${code}`).toContain("exit=0")
    return out
  }
  try {
    await run(["init", "-q"])
    const files = ["查询.sql", "tab\tname.ts", 'quote"name.ts', "back\\slash.ts", "space name.ts"]
    await Promise.all(files.map((file) => Bun.write(path.join(directory, file), "++i\ndoWork()\n")))
    await run(["add", "."])
    const diff = await run([
      "-c",
      "core.quotePath=true",
      "diff",
      "--cached",
      "--no-color",
      "--no-ext-diff",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--unified=0",
    ])
    const changed = changedLines(diff)
    files.forEach((file) => {
      expect([...changed.get(file)!]).toEqual([1, 2])
      expect(
        validateReview(
          {
            reviewedSha: "head",
            summary: "Reviewed actual Git output",
            findings: [
              {
                path: file,
                line: 2,
                severity: "HIGH",
                confidence: "high",
                body: "A concrete finding on the second line",
              },
            ],
          },
          "head",
          changed,
        ).findings[0].path,
      ).toBe(file)
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("pure-deletion hunks and deleted files validate cleanly on LEFT side and hasReviewablePaths detects docs-only diffs", () => {
  const deletionDiff = [
    "diff --git a/src/guard.ts b/src/guard.ts",
    "--- a/src/guard.ts",
    "+++ b/src/guard.ts",
    "@@ -14,2 +13,0 @@",
    "-if (!authorized) throw new Error('denied')",
    "-auditAccess(user)",
    "diff --git a/src/removed.ts b/src/removed.ts",
    "deleted file mode 100644",
    "--- a/src/removed.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-export const legacy = true",
    "-validateLegacy()",
  ].join("\n")

  const locations = diffLineLocations(deletionDiff)
  expect([...(locations.right.get("src/guard.ts") ?? [])]).toEqual([])
  expect([...(locations.left.get("src/guard.ts") ?? [])]).toEqual([14, 15])
  expect([...(locations.left.get("src/removed.ts") ?? [])]).toEqual([1, 2])

  const validated = validateReview(
    {
      reviewedSha: "sha-del",
      summary: "Checked deleted auth guard",
      findings: [
        {
          path: "src/guard.ts",
          line: 14,
          side: "LEFT",
          severity: "CRITICAL",
          confidence: "high",
          body: "Deleting the authorization guard allows unauthenticated execution",
        },
        {
          path: "src/removed.ts",
          line: 2,
          side: "LEFT",
          severity: "MEDIUM",
          confidence: "medium",
          body: "Deleted exported symbol in removed module",
        },
      ],
    },
    "sha-del",
    locations,
  )
  expect(validated.findings).toMatchObject([
    { path: "src/guard.ts", line: 14, side: "LEFT" },
    { path: "src/removed.ts", line: 2, side: "LEFT" },
  ])
  expect(() =>
    validateReview(
      {
        reviewedSha: "sha-del",
        summary: "Wrong side",
        findings: [{ path: "src/guard.ts", line: 14, side: "RIGHT", severity: "HIGH", confidence: "high", body: "bad" }],
      },
      "sha-del",
      locations,
    ),
  ).toThrow()
  expect(() =>
    validateReview(
      {
        reviewedSha: "sha-del",
        summary: "Missing explicit side on DiffLineMap",
        findings: [{ path: "src/removed.ts", line: 2, severity: "MEDIUM", confidence: "medium", body: "missing side" }],
      },
      "sha-del",
      locations,
    ),
  ).toThrow("Finding side must be RIGHT or LEFT")

  const sharedLineLocations = diffLineLocations(
    "diff --git a/src/shared.ts b/src/shared.ts\n--- a/src/shared.ts\n+++ b/src/shared.ts\n@@ -2,1 +2,1 @@\n-oldCall()\n+newCall()\n",
  )
  expect([...(sharedLineLocations.left.get("src/shared.ts") ?? [])]).toEqual([2])
  expect([...(sharedLineLocations.right.get("src/shared.ts") ?? [])]).toEqual([2])
  expect(() =>
    validateReview(
      {
        reviewedSha: "sha-shared",
        summary: "Ambiguous omitted side must fail",
        findings: [{ path: "src/shared.ts", line: 2, severity: "HIGH", confidence: "high", body: "ambiguous side" }],
      },
      "sha-shared",
      sharedLineLocations,
    ),
  ).toThrow("Finding side must be RIGHT or LEFT")
  expect(
    validateReview(
      {
        reviewedSha: "sha-shared",
        summary: "Explicit sides resolve unambiguously",
        findings: [
          { path: "src/shared.ts", line: 2, side: "LEFT", severity: "MEDIUM", confidence: "high", body: "deleted call" },
          { path: "src/shared.ts", line: 2, side: "RIGHT", severity: "HIGH", confidence: "high", body: "added call" },
        ],
      },
      "sha-shared",
      sharedLineLocations,
    ).findings,
  ).toMatchObject([
    { path: "src/shared.ts", line: 2, side: "LEFT" },
    { path: "src/shared.ts", line: 2, side: "RIGHT" },
  ])

  const docsOnlyDiff = "diff --git a/docs/guide.md b/docs/guide.md\n--- a/docs/guide.md\n+++ b/docs/guide.md\n@@ -1 +1 @@\n-old\n+new\n"
  expect(hasReviewablePaths(docsOnlyDiff)).toBe(false)
  expect(hasReviewablePaths(deletionDiff)).toBe(true)
  const promptDiff =
    "diff --git a/.github/codex-review-prompt.md b/.github/codex-review-prompt.md\n--- a/.github/codex-review-prompt.md\n+++ b/.github/codex-review-prompt.md\n@@ -1 +1 @@\n-old\n+new\n"
  expect(hasReviewablePaths(promptDiff)).toBe(true)
  const runtimePromptAssetDiff =
    "diff --git a/packages/opencode/src/session/prompt/anthropic.txt b/packages/opencode/src/session/prompt/anthropic.txt\n--- a/packages/opencode/src/session/prompt/anthropic.txt\n+++ b/packages/opencode/src/session/prompt/anthropic.txt\n@@ -1 +1 @@\n-old\n+new\n"
  expect(hasReviewablePaths(runtimePromptAssetDiff)).toBe(true)
  const modeOnlyDiff =
    "diff --git a/docs/guide.md b/docs/guide.md\n--- a/docs/guide.md\n+++ b/docs/guide.md\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/scripts/run.sh b/scripts/run.sh\nold mode 100644\nnew mode 100755\n"
  expect(hasReviewablePaths(modeOnlyDiff)).toBe(true)
})

test("root Markdown with spaces skips review while AGENTS.md and CLAUDE.md trigger and run review", async () => {
  const spacedRootDoc =
    'diff --git "a/Release Notes.md" "b/Release Notes.md"\n--- "a/Release Notes.md"\n+++ "b/Release Notes.md"\n@@ -1 +1 @@\n-old\n+new\n'
  const packageDocsMdx =
    "diff --git a/packages/docs/quickstart.mdx b/packages/docs/quickstart.mdx\n--- a/packages/docs/quickstart.mdx\n+++ b/packages/docs/quickstart.mdx\n@@ -1 +1 @@\n-old\n+new\n"
  const packageReadme =
    "diff --git a/packages/cz-cli/README.md b/packages/cz-cli/README.md\n--- a/packages/cz-cli/README.md\n+++ b/packages/cz-cli/README.md\n@@ -1 +1 @@\n-old\n+new\n"
  expect(hasReviewablePaths(spacedRootDoc)).toBe(false)
  expect(hasReviewablePaths(packageDocsMdx)).toBe(false)
  expect(hasReviewablePaths(packageReadme)).toBe(false)
  expect(hasReviewablePaths(spacedRootDoc + packageDocsMdx + packageReadme)).toBe(false)

  const agentsDiff = "diff --git a/AGENTS.md b/AGENTS.md\n--- a/AGENTS.md\n+++ b/AGENTS.md\n@@ -1 +1 @@\n-old\n+new\n"
  const claudeDiff = "diff --git a/CLAUDE.md b/CLAUDE.md\n--- a/CLAUDE.md\n+++ b/CLAUDE.md\n@@ -1 +1 @@\n-old\n+new\n"
  const contextDiff =
    "diff --git a/.github/claude-review-context.md b/.github/claude-review-context.md\n--- a/.github/claude-review-context.md\n+++ b/.github/claude-review-context.md\n@@ -1 +1 @@\n-old\n+new\n"
  const maintWorkflowDiff =
    "diff --git a/docs/maintenance/workflow.md b/docs/maintenance/workflow.md\n--- a/docs/maintenance/workflow.md\n+++ b/docs/maintenance/workflow.md\n@@ -1 +1 @@\n-old\n+new\n"
  const maintPromptDiff =
    "diff --git a/docs/maintenance/prompts/worker.md b/docs/maintenance/prompts/worker.md\n--- a/docs/maintenance/prompts/worker.md\n+++ b/docs/maintenance/prompts/worker.md\n@@ -1 +1 @@\n-old\n+new\n"
  const upstreamLedgerDiff =
    "diff --git a/packages/cz-cli/UPSTREAM-PATCHES.md b/packages/cz-cli/UPSTREAM-PATCHES.md\n--- a/packages/cz-cli/UPSTREAM-PATCHES.md\n+++ b/packages/cz-cli/UPSTREAM-PATCHES.md\n@@ -1 +1 @@\n-old\n+new\n"
  const opencodeToolDiff =
    "diff --git a/.opencode/tool/github-triage.ts b/.opencode/tool/github-triage.ts\n--- a/.opencode/tool/github-triage.ts\n+++ b/.opencode/tool/github-triage.ts\n@@ -1 +1 @@\n-old\n+new\n"
  expect(hasReviewablePaths(agentsDiff)).toBe(true)
  expect(hasReviewablePaths(claudeDiff)).toBe(true)
  expect(hasReviewablePaths(contextDiff)).toBe(true)
  expect(hasReviewablePaths(maintWorkflowDiff)).toBe(true)
  expect(hasReviewablePaths(maintPromptDiff)).toBe(true)
  expect(hasReviewablePaths(upstreamLedgerDiff)).toBe(true)
  expect(hasReviewablePaths(opencodeToolDiff)).toBe(true)
  expect(hasReviewablePaths(spacedRootDoc + opencodeToolDiff)).toBe(true)

  const workflow = await Bun.file(new URL("../../workflows/claude-review.yml", import.meta.url)).text()
  expect(workflow).not.toContain("\n    paths:")
  expect(workflow).not.toContain("\n    paths-ignore:")
  expect(workflow.indexOf("hasReviewablePaths")).toBeGreaterThan(0)
  expect(workflow.indexOf("hasReviewablePaths")).toBeLessThan(workflow.indexOf("Install pinned Codex CLI"))
  expect(workflow).toContain("if: steps.identity.outputs.skip_docs_only != 'true'")
})

test("rename detection matches GitHub PR diff paths for pure and edited renames", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "review-git-renames-"))
  const run = async (args: string[]) => {
    const child = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
    const [out, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(error + ` exit=${code}`).toContain("exit=0")
    return out
  }
  try {
    await run(["init", "-q"])
    await Bun.write(path.join(directory, "src/pure-old.ts"), "export const a = 1\nexport const b = 2\n")
    await Bun.write(
      path.join(directory, "src/edit old.ts"),
      [
        "export const line1 = 1",
        "export const line2 = 2",
        "export const line3 = 3",
        "export const line4 = 4",
        "export const line5 = 5",
        "",
      ].join("\n"),
    )
    await Bun.write(path.join(directory, "docs/old.md"), "# Doc\n")
    await run(["add", "."])
    await run(["-c", "user.name=Fixture", "-c", "user.email=f@example.test", "commit", "-m", "base"])

    // 1. Pure docs-only rename
    await run(["mv", "docs/old.md", "docs/new.md"])
    const docsRenameDiff = await run([
      "diff",
      "--cached",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--unified=0",
    ])
    expect(hasReviewablePaths(docsRenameDiff)).toBe(false)

    // 2. Pure code rename + edited code rename
    await run(["mv", "src/pure-old.ts", "src/pure-new.ts"])
    await run(["mv", "src/edit old.ts", "src/edit new.ts"])
    await Bun.write(
      path.join(directory, "src/edit new.ts"),
      [
        "export const line1 = 1",
        "export const line2 = 200",
        "export const line3 = 3",
        "export const line4 = 4",
        "export const line5 = 5",
        "",
      ].join("\n"),
    )
    await run(["add", "."])
    const renameDiff = await run([
      "diff",
      "--cached",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--unified=0",
    ])

    expect(hasReviewablePaths(renameDiff)).toBe(true)
    const locations = diffLineLocations(renameDiff)
    // Pure rename has zero inline hunks on either side
    expect(locations.right.has("src/pure-new.ts")).toBe(false)
    expect(locations.left.has("src/pure-old.ts")).toBe(false)
    expect(locations.left.has("src/pure-new.ts")).toBe(false)

    // Edited rename exposes BOTH RIGHT and LEFT on destination path ("src/edit new.ts")
    expect([...(locations.right.get("src/edit new.ts") ?? [])]).toEqual([2])
    expect([...(locations.left.get("src/edit new.ts") ?? [])]).toEqual([2])
    expect(locations.left.has("src/edit old.ts")).toBe(false)

    const validated = validateReview(
      {
        reviewedSha: "sha-ren",
        summary: "Reviewed pure and edited renames",
        findings: [
          {
            path: "src/edit new.ts",
            line: 2,
            side: "LEFT",
            severity: "MEDIUM",
            confidence: "high",
            body: "Deleted original value",
          },
          {
            path: "src/edit new.ts",
            line: 2,
            side: "RIGHT",
            severity: "HIGH",
            confidence: "high",
            body: "Updated value changes range",
          },
        ],
      },
      "sha-ren",
      locations,
    )
    expect(validated.findings).toHaveLength(2)
    expect(() =>
      validateReview(
        {
          reviewedSha: "sha-ren",
          summary: "Old path rejected",
          findings: [
            { path: "src/edit old.ts", line: 2, side: "LEFT", severity: "LOW", confidence: "low", body: "stale path" },
          ],
        },
        "sha-ren",
        locations,
      ),
    ).toThrow()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
