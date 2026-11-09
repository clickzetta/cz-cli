import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  executeRelease,
  readNightlyReceipts,
  reconcileNightlyRelease,
  releaseNightly,
} from "../../../scripts/maintenance/release"
import type { NightlyInput, ReleaseRunner } from "../../../scripts/maintenance/release"
import { retainedVersionHistory, retentionCleanup } from "../../../scripts/cos-release.mjs"
const temporary: string[] = []
const sha = "a".repeat(40)
const version = "dev-v1.17.11.20261109170000"
const control = path.resolve(import.meta.dir, "../../..")
afterEach(() => temporary.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))
function input(): NightlyInput {
  const directory = mkdtempSync(path.join(os.tmpdir(), "maintenance-nightly-"))
  temporary.push(directory)
  return {
    directory,
    sha,
    version,
    execute: true,
    config: {
      repository: "clickzetta/cz-cli",
      baseRef: "origin/main",
      permissions: { push: true, release: false, releaseNightly: true, releaseStable: false },
    },
  }
}
function transport(
  options: {
    mainSha?: string
    ci?: boolean
    lineage?: string
    tagExists?: boolean
    releaseExists?: boolean
    publisherMismatch?: boolean
    pushUnknown?: boolean
    runConclusion?: string
    prerelease?: boolean
    localTagSha?: string
  } = {},
) {
  const calls: string[][] = []
  const state = { pushed: false }
  const draft = input()
  const run: ReleaseRunner = async (argv) => {
    calls.push(argv)
    const result = (value: unknown) => ({
      stdout: typeof value === "string" ? value : JSON.stringify(value),
      stderr: "",
      exitCode: 0,
    })
    if (argv[0] === "env") {
      if (argv.includes("push")) {
        state.pushed = true
        expect((await readNightlyReceipts(draft.directory))[0].status).toBe("sending")
        if (options.pushUnknown) throw new Error("response timed out after accepting the tag")
      }
      return result("")
    }
    if (argv[0] === "git") {
      if (argv.includes("get-url")) return result("https://github.com/clickzetta/cz-cli.git")
      if (argv.includes("rev-parse"))
        return options.localTagSha
          ? result(options.localTagSha)
          : { stdout: "", stderr: "tag does not exist", exitCode: 128 }
      if (argv.includes("show")) return result({ version: "1.17.11" })
      if (argv.includes("tag")) return result("")
    }
    if (argv[0] === process.execPath) return result({ result: options.lineage ?? "ok", channel: "nightly" })
    const endpoint = argv[4]
    if (endpoint?.endsWith("/git/ref/heads/main")) return result({ object: { sha: options.mainSha ?? sha } })
    if (endpoint?.includes("/contents/")) {
      const file = endpoint.split("/contents/")[1].split("?")[0]
      const content = options.publisherMismatch
        ? "unreviewed publisher"
        : await Bun.file(path.join(control, file)).text()
      return result({ encoding: "base64", content: Buffer.from(content).toString("base64") })
    }
    if (endpoint?.includes("/workflows/cz-test.yml/"))
      return result({
        workflow_runs:
          options.ci === false
            ? []
            : [{ head_sha: options.mainSha ?? sha, status: "completed", conclusion: "success" }],
      })
    if (endpoint?.includes("/git/matching-refs/"))
      return result(
        options.tagExists || state.pushed
          ? [{ ref: `refs/tags/${version}`, object: { sha: options.mainSha ?? sha, type: "commit" } }]
          : [],
      )
    if (endpoint?.includes("/releases?")) return result([[...(options.releaseExists ? [{ tag_name: version }] : [])]])
    if (endpoint?.includes("/workflows/release-cos.yml/"))
      return result({
        workflow_runs: [
          {
            id: 42,
            head_sha: sha,
            head_branch: version,
            event: "push",
            status: options.runConclusion ? "completed" : "in_progress",
            conclusion: options.runConclusion ?? null,
          },
        ],
      })
    if (endpoint?.includes("/releases/tags/"))
      return result({
        tag_name: version,
        prerelease: options.prerelease ?? true,
        draft: false,
        assets: [{ name: "cz-cli-linux-x64.tar.gz" }],
      })
    throw new Error(`Unexpected transport call: ${JSON.stringify(argv)}`)
  }
  return { calls, state, run, draft }
}
test("nightly preview has no tag, network or receipt side effects", async () => {
  const t = transport()
  expect((await releaseNightly({ ...t.draft, execute: false }, t.run)).status).toBe("preview")
  expect(t.calls).toEqual([])
  expect(existsSync(path.join(t.draft.directory, "outbox"))).toBe(false)
})
test("stable versions, ambiguous permissions and other branches are refused", async () => {
  const t = transport()
  for (const invalid of ["v1.2.3", "1.2.3", "1.2.3-nightly", "dev-v1.2.3", "dev-v1.2.3.20261109;echo"])
    await expect(releaseNightly({ ...t.draft, version: invalid }, t.run)).rejects.toThrow("Only dev-v")
  for (const permissions of [{ push: false }, { release: true }, { releaseNightly: false }, { releaseStable: true }])
    await expect(
      releaseNightly(
        { ...t.draft, config: { ...t.draft.config, permissions: { ...t.draft.config.permissions, ...permissions } } },
        t.run,
      ),
    ).rejects.toThrow("authorization")
  await expect(
    releaseNightly({ ...t.draft, config: { ...t.draft.config, baseRef: "origin/dev" } }, t.run),
  ).rejects.toThrow("restricted")
  expect(t.calls).toEqual([])
})
test("only reviewed current main with successful exact-SHA CI may publish", async () => {
  for (const options of [
    { mainSha: "b".repeat(40) },
    { ci: false },
    { publisherMismatch: true },
    { lineage: "skipped" },
    { lineage: "forced" },
  ]) {
    const t = transport(options)
    await expect(releaseNightly(t.draft, t.run)).rejects.toThrow()
    expect(t.calls.some((argv) => argv.includes("push"))).toBe(false)
    expect(await readNightlyReceipts(t.draft.directory)).toEqual([])
  }
})
test("existing tags and releases are never overwritten", async () => {
  for (const options of [{ tagExists: true }, { releaseExists: true }]) {
    const t = transport(options)
    await expect(releaseNightly(t.draft, t.run)).rejects.toThrow("already exists")
    expect(t.calls.some((argv) => argv.includes("push"))).toBe(false)
  }
})
test("one unproxied nightly-tag push records durable intent without a second workflow dispatch", async () => {
  const t = transport()
  expect((await releaseNightly(t.draft, t.run)).status).toBe("submitted")
  const pushes = t.calls.filter((argv) => argv.includes("push"))
  expect(pushes).toHaveLength(1)
  expect(pushes[0]).toContain("--no-follow-tags")
  expect(pushes[0]).toContain("NO_PROXY=*")
  expect(pushes[0]).toContain("no_proxy=*")
  expect(pushes[0]).toContain(`refs/tags/${version}:refs/tags/${version}`)
  expect(t.calls.find((argv) => argv[0] === "git" && argv.includes("tag"))).toContain("tag.gpgSign=false")
  expect(t.calls.some((argv) => argv.includes("workflow") || argv.includes("dispatches"))).toBe(false)
  const before = t.calls.length
  expect((await releaseNightly(t.draft, t.run)).status).toBe("submitted")
  expect(t.calls).toHaveLength(before)
  const folder = path.join(t.draft.directory, "outbox", "nightly")
  const file = readdirSync(folder).find((name) => name.endsWith(".json"))!
  expect(statSync(path.join(folder, file)).mode & 0o777).toBe(0o600)
  await expect(releaseNightly({ ...t.draft, version: version + "1" }, t.run)).rejects.toThrow("already assigned")
})

test("annotated local tags are rejected rather than pushed by peeled SHA", async () => {
  const t = transport({ localTagSha: "c".repeat(40) })
  await expect(releaseNightly(t.draft, t.run)).rejects.toThrow("another SHA")
  expect(t.calls.some((argv) => argv.includes("push"))).toBe(false)
})
test("nightly tag creation stays lightweight even when local tag signing is enabled", async () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), "maintenance-nightly-git-"))
  temporary.push(repository)
  const git = async (...args: string[]) => {
    const result = await executeRelease(["git", "-C", repository, ...args])
    expect(result.exitCode).toBe(0)
    return result.stdout.trim()
  }
  await git("init", "-q")
  await git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--allow-empty",
    "-qm",
    "seed",
  )
  await git("config", "tag.gpgSign", "true")
  const source = await git("rev-parse", "HEAD")
  const t = transport({ mainSha: source })
  const run: ReleaseRunner = (argv) =>
    argv[0] === "git" && (argv.includes("tag") || argv.includes("rev-parse"))
      ? executeRelease(argv.map((value) => (value === control ? repository : value)))
      : t.run(argv)
  expect((await releaseNightly({ ...t.draft, sha: source }, run)).status).toBe("submitted")
  expect(await git("cat-file", "-t", `refs/tags/${version}`)).toBe("commit")
  expect(await git("rev-parse", `refs/tags/${version}`)).toBe(source)
})

test("nightly push excludes reachable stable tags when push.followTags is enabled", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "maintenance-follow-tags-"))
  temporary.push(directory)
  const repository = path.join(directory, "working")
  const remote = path.join(directory, "remote.git")
  const unsafeRemote = path.join(directory, "unsafe.git")
  const execute = async (argv: string[]) => {
    const result = await executeRelease(argv)
    expect(result.exitCode).toBe(0)
    return result.stdout.trim()
  }
  const git = (...args: string[]) => execute(["git", "-C", repository, ...args])
  await execute(["git", "init", "--bare", "-q", remote])
  await execute(["git", "init", "--bare", "-q", unsafeRemote])
  await execute(["git", "init", "-q", repository])
  await git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--allow-empty",
    "-qm",
    "seed",
  )
  await git("remote", "add", "origin", remote)
  await git("remote", "add", "unsafe", unsafeRemote)
  await git("config", "push.followTags", "true")
  await git("config", "push.gpgSign", "false")
  await git(
    "-c",
    "tag.gpgSign=false",
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "tag",
    "-a",
    "v9.9.9",
    "-m",
    "reachable stable tag",
  )
  const source = await git("rev-parse", "HEAD")
  const t = transport({ mainSha: source })
  const run: ReleaseRunner = async (argv) => {
    if (argv[0] === "git" && (argv.includes("tag") || argv.includes("rev-parse")))
      return executeRelease(argv.map((value) => (value === control ? repository : value)))
    if (argv[0] === "env" && argv.includes("push")) {
      await t.run(argv)
      return executeRelease(argv.map((value) => (value === control ? repository : value)))
    }
    return t.run(argv)
  }
  expect((await releaseNightly({ ...t.draft, sha: source }, run)).status).toBe("submitted")
  const tags = await execute(["git", "--git-dir", remote, "for-each-ref", "--format=%(refname)", "refs/tags"])
  expect(tags.split("\n")).toEqual([`refs/tags/${version}`])
  // Reproduce the original behavior against a second local-only bare remote.
  await git("push", "unsafe", `refs/tags/${version}:refs/tags/${version}`)
  const unsafeTags = await execute([
    "git",
    "--git-dir",
    unsafeRemote,
    "for-each-ref",
    "--format=%(refname)",
    "refs/tags",
  ])
  expect(unsafeTags.split("\n").sort()).toEqual([`refs/tags/${version}`, "refs/tags/v9.9.9"].sort())
})

test("effective push URLs reject pushurl and pushInsteadOf redirection before publication", async () => {
  for (const mode of ["pushurl", "multiple", "rewrite"]) {
    const directory = mkdtempSync(path.join(os.tmpdir(), "maintenance-push-target-"))
    temporary.push(directory)
    const repository = path.join(directory, "working")
    const remote = path.join(directory, "redirect.git")
    const git = async (...args: string[]) => {
      const result = await executeRelease(["git", "-C", repository, ...args])
      expect(result.exitCode).toBe(0)
      return result.stdout.trim()
    }
    expect((await executeRelease(["git", "init", "--bare", "-q", remote])).exitCode).toBe(0)
    expect((await executeRelease(["git", "init", "-q", repository])).exitCode).toBe(0)
    await git("remote", "add", "origin", "https://github.com/clickzetta/cz-cli.git")
    if (mode === "pushurl") await git("config", "remote.origin.pushurl", remote)
    if (mode === "multiple") {
      await git("config", "--add", "remote.origin.pushurl", "https://github.com/clickzetta/cz-cli.git")
      await git("config", "--add", "remote.origin.pushurl", remote)
    }
    if (mode === "rewrite") await git("config", `url.${remote}/.pushInsteadOf`, "https://github.com/clickzetta/")
    expect(await git("remote", "get-url", "origin")).toBe("https://github.com/clickzetta/cz-cli.git")
    expect(await git("remote", "get-url", "--push", "--all", "origin")).not.toBe(
      "https://github.com/clickzetta/cz-cli.git",
    )
    const t = transport()
    const run: ReleaseRunner = (argv) =>
      argv[0] === "git" && argv.includes("get-url")
        ? executeRelease(argv.map((value) => (value === control ? repository : value)))
        : t.run(argv)
    await expect(releaseNightly(t.draft, run)).rejects.toThrow("exactly one authorized")
    expect(t.calls.some((argv) => argv.includes("push"))).toBe(false)
    expect(t.calls.some((argv) => argv[0] === "git" && argv.includes("tag"))).toBe(false)
    expect(await readNightlyReceipts(t.draft.directory)).toEqual([])
    expect(await executeRelease(["git", "--git-dir", remote, "for-each-ref", "--format=%(refname)"])).toMatchObject({
      stdout: "",
      exitCode: 0,
    })
  }
})

test("concurrent publication claims push at most once", async () => {
  const t = transport()
  const results = await Promise.allSettled([releaseNightly(t.draft, t.run), releaseNightly(t.draft, t.run)])
  expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1)
  expect(t.calls.filter((argv) => argv.includes("push"))).toHaveLength(1)
})
test("unknown push outcomes block retries until tag and workflow reconciliation", async () => {
  const t = transport({ pushUnknown: true })
  await expect(releaseNightly(t.draft, t.run)).rejects.toThrow("outcome is unknown")
  expect((await readNightlyReceipts(t.draft.directory))[0].status).toBe("unknown")
  const before = t.calls.length
  await expect(releaseNightly(t.draft, t.run)).rejects.toThrow("reconciliation")
  await expect(releaseNightly({ ...t.draft, sha: "b".repeat(40), version: version + "1" }, t.run)).rejects.toThrow(
    "unresolved",
  )
  expect(t.calls).toHaveLength(before)
  expect((await reconcileNightlyRelease(t.draft.directory, sha, t.run)).status).toBe("submitted")
  expect(t.calls.filter((argv) => argv.includes("push"))).toHaveLength(1)
})
test("finished runs are recorded without claiming artifact verification", async () => {
  for (const conclusion of ["success", "failure"]) {
    const t = transport({ runConclusion: conclusion })
    await releaseNightly(t.draft, t.run)
    const result = await reconcileNightlyRelease(t.draft.directory, sha, t.run)
    expect(result.status).toBe(conclusion === "success" ? "completed" : "failed")
    expect(result.workflowRunId).toBe(42)
    if (conclusion === "success") expect(result.needsArtifactVerification).toBe(true)
  }
})
test("a release marked stable cannot pass nightly completion", async () => {
  const t = transport({ runConclusion: "success", prerelease: false })
  await releaseNightly(t.draft, t.run)
  await expect(reconcileNightlyRelease(t.draft.directory, sha, t.run)).rejects.toThrow("verified prerelease")
  expect((await readNightlyReceipts(t.draft.directory))[0].status).toBe("submitted")
})
test("nightly retention cannot evict stable history or artifacts", async () => {
  const stable = [
    { version: "1.1.0", released_at: "old", channel_tags: ["stable"], extra: "preserve" },
    { version: "1.0.0", channel_tags: [] },
  ]
  const existing = {
    stable: "1.1.0",
    nightly: "dev-v1.1.0.old",
    versions: [stable[0], { version: "dev-v1.1.0.old", channel_tags: ["nightly"] }, stable[1]],
  }
  const history = retainedVersionHistory({ version, buildDate: "now", retain: 1 }, ["nightly"], existing)
  expect(history).toEqual([{ version, released_at: "now", channel_tags: ["nightly"] }, ...stable])
  expect(history.filter((entry: { version: string }) => !entry.version.startsWith("dev-v"))).toEqual(stable)
  expect(existing.stable).toBe("1.1.0")
  expect(existing.versions[0]).toBe(stable[0])
  await expect(retentionCleanup({ version, dryRun: false }, existing)).resolves.toBeUndefined()
})
test("nightly workflow pins tags, avoids latest and serializes channel writes", async () => {
  const workflow = await Bun.file(path.join(control, ".github/workflows/release-cos.yml")).text()
  expect(workflow).toContain('test "$TAG_SHA" = "$GITHUB_SHA"')
  expect(workflow).toContain("--prerelease --latest=false --verify-tag")
  expect(workflow).toContain("group: cz-cli-cos-publication")
  expect(workflow).toContain('&& [ "${{ steps.release.outputs.is_stable }}" = "true" ]')
})
