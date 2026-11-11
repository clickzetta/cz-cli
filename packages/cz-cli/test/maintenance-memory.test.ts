import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pendingMemory, recordMemory, resolveMemory } from "../../../scripts/maintenance/memory"

const directories: string[] = []
const memoryModule = path.resolve(import.meta.dir, "../../../scripts/maintenance/memory.ts")
const maintenance = path.resolve(import.meta.dir, "../../../scripts/maintenance.ts")

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

function fixture(directory?: string) {
  const root = directory ?? mkdtempSync(path.join(tmpdir(), "maintenance-memory-"))
  if (!directory) directories.push(root)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const config = {
    repository: "owner/repo",
    baseRef: "origin/main",
    lark: { identity: "user" },
    permissions: {
      push: false,
      createPullRequest: false,
      postGithub: false,
      postLark: false,
      merge: false,
      release: false,
    },
  }
  const state = {
    tasks: [
      {
        id: "task-existing",
        item: {
          source: "github",
          id: "148",
          title: "Installation failed",
          body: "Original problem",
          url: "",
          updatedAt: "old",
        },
        status: "completed",
        phase: "review",
        attempts: 1,
        updatedAt: "old",
        headSha: "a".repeat(40),
        reviewedSha: "a".repeat(40),
      },
    ],
    since: { github: "cursor" },
  }
  writeFileSync(path.join(root, "config.json"), JSON.stringify(config))
  writeFileSync(path.join(root, "state.json"), JSON.stringify(state))
  return { directory: root }
}

function event(id = "task-existing-install-url") {
  return {
    id,
    taskId: "task-existing",
    kind: "lesson",
    summary: "Check the actual download endpoint and script parameters before trusting examples.",
    evidence: ["tasks/task-existing/installer-result.txt"],
    memoryRefs: ["docs/maintenance/understanding.md#installation"],
  }
}

function resolution() {
  return {
    disposition: "integrated",
    reason: "The verified lesson is now in the installation guidance.",
    evidence: ["control/reviews/installation-memory.md"],
    commit: "b".repeat(40),
    memoryRefs: ["docs/maintenance/understanding.md#installation"],
  }
}

async function run(argv: string[], cwd?: string) {
  const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

// Fake the runtime's repository: `directory` lives at <repo>/.git/cz-maintenance, and
// refs/remotes/origin/main points at a fresh commit, as after `sync`.
async function mainCommit(directory: string) {
  const repo = path.dirname(path.dirname(directory))
  if (!existsSync(path.join(repo, ".git", "HEAD"))) expect((await run(["git", "init", repo])).exitCode).toBe(0)
  const commit = async (message: string) => {
    expect(
      (
        await run([
          "git",
          "-C",
          repo,
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "user.name=Memory test",
          "-c",
          "user.email=memory@example.test",
          "commit",
          "--allow-empty",
          "-m",
          message,
        ])
      ).exitCode,
    ).toBe(0)
    return (await run(["git", "-C", repo, "rev-parse", "HEAD"])).stdout.trim()
  }
  const sha = await commit("docs: merged memory")
  expect((await run(["git", "-C", repo, "update-ref", "refs/remotes/origin/main", sha])).exitCode).toBe(0)
  return { repo, sha, unmerged: await commit("docs: not merged") }
}

function repoFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "maintenance-memory-repo-"))
  directories.push(root)
  return fixture(path.join(root, ".git", "cz-maintenance"))
}

describe("maintenance memory evidence", () => {
  test("empty reads create no state; recording is private, idempotent and leaves task state untouched", async () => {
    const data = fixture()
    const state = readFileSync(path.join(data.directory, "state.json"), "utf8")
    const config = readFileSync(path.join(data.directory, "config.json"), "utf8")
    expect(await pendingMemory(data.directory)).toEqual({ pendingCount: 0, pending: [] })
    expect(existsSync(path.join(data.directory, "memory"))).toBe(false)

    const first = await recordMemory(data.directory, event())
    const second = await recordMemory(data.directory, { ...event(), evidence: [...event().evidence] })
    expect(second).toEqual(first)
    expect(statSync(first.file).mode & 0o777).toBe(0o600)
    expect(statSync(path.dirname(first.file)).mode & 0o777).toBe(0o700)
    expect(statSync(path.join(data.directory, "memory")).mode & 0o777).toBe(0o700)
    expect(await pendingMemory(data.directory)).toMatchObject({
      pendingCount: 1,
      pending: [{ id: event().id, file: first.file }],
    })
    expect((await pendingMemory(data.directory)).pending[0]).not.toHaveProperty("evidence")
    expect(readFileSync(path.join(data.directory, "state.json"), "utf8")).toBe(state)
    expect(readFileSync(path.join(data.directory, "config.json"), "utf8")).toBe(config)
    expect(existsSync(path.join(data.directory, "native-state.json"))).toBe(false)
  })

  test("requires registered task and valid, evidenced input before writing", async () => {
    const data = fixture()
    await expect(recordMemory(data.directory, { ...event(), taskId: "task-unknown" })).rejects.toThrow(
      "Register the task",
    )
    for (const input of [
      { ...event(), id: "../outside" },
      { ...event(), evidence: [] },
      { ...event(), evidence: [" "] },
      { ...event(), memoryRefs: [null] },
      { ...event(), summary: " " },
      { ...event(), kind: "decision" },
      { ...event(), recordedAt: "fabricated" },
    ])
      await expect(recordMemory(data.directory, input)).rejects.toThrow()
    expect(existsSync(path.join(data.directory, "memory"))).toBe(false)
    await recordMemory(data.directory, { ...event(), kind: "usage", memoryRefs: [] })
    expect((await pendingMemory(data.directory)).pendingCount).toBe(1)
  })

  test("conflicting evidence cannot replace an existing event; a correction gets its own ID", async () => {
    const data = fixture()
    const first = await recordMemory(data.directory, event())
    const original = readFileSync(first.file, "utf8")
    await expect(recordMemory(data.directory, { ...event(), summary: "Changed claim" })).rejects.toThrow(
      "Conflicting memory record",
    )
    expect(readFileSync(first.file, "utf8")).toBe(original)
    await recordMemory(data.directory, {
      ...event("task-existing-install-url-v2"),
      kind: "correction",
      summary: "New evidence changes the scope.",
    })
    expect((await pendingMemory(data.directory)).pendingCount).toBe(2)
  })

  test("enum values cannot coerce arrays or objects into valid kinds or bypass integration checks", async () => {
    const data = fixture()
    for (const kind of [["lesson"], { toString: () => "lesson" }, 1, null]) {
      await expect(recordMemory(data.directory, { ...event(), kind })).rejects.toThrow("Memory event requires")
      expect(existsSync(path.join(data.directory, "memory", "events", `${event().id}.json`))).toBe(false)
    }
    await recordMemory(data.directory, event())
    for (const disposition of [["integrated"], { toString: () => "integrated" }, 1, null]) {
      await expect(
        resolveMemory(data.directory, event().id, {
          disposition,
          reason: "Attempt to resolve without activated policy or memory references",
          evidence: ["tasks/task-existing/result.txt"],
        }),
      ).rejects.toThrow("Memory resolution requires")
      expect(existsSync(path.join(data.directory, "memory", "resolutions", `${event().id}.json`))).toBe(false)
      expect((await pendingMemory(data.directory)).pendingCount).toBe(1)
    }
  })

  test("integration requires provenance, preserves the event, and resolving twice is idempotent", async () => {
    const data = repoFixture()
    const main = await mainCommit(data.directory)
    const integrated = { ...resolution(), commit: main.sha }
    const saved = await recordMemory(data.directory, event())
    const original = readFileSync(saved.file, "utf8")
    for (const input of [
      { ...resolution(), commit: undefined },
      { ...resolution(), commit: "short-sha" },
      { ...resolution(), policySha: main.sha },
      { ...resolution(), memoryRefs: [] },
      { ...resolution(), evidence: [] },
      { ...resolution(), disposition: "deferred" },
    ])
      await expect(resolveMemory(data.directory, event().id, input)).rejects.toThrow()
    expect((await pendingMemory(data.directory)).pendingCount).toBe(1)
    const first = await resolveMemory(data.directory, event().id, integrated)
    expect(await resolveMemory(data.directory, event().id, integrated)).toEqual(first)
    expect(statSync(first.file).mode & 0o777).toBe(0o600)
    expect(readFileSync(saved.file, "utf8")).toBe(original)
    expect(await pendingMemory(data.directory)).toEqual({ pendingCount: 0, pending: [] })
    await expect(
      resolveMemory(data.directory, event().id, { ...integrated, reason: "Different decision" }),
    ).rejects.toThrow("Conflicting memory record")
  })

  test("integration requires the commit on origin/main", async () => {
    const data = repoFixture()
    await recordMemory(data.directory, event())
    const main = await mainCommit(data.directory)
    await expect(resolveMemory(data.directory, event().id, { ...resolution(), commit: main.unmerged })).rejects.toThrow(
      "not on origin/main",
    )
    await expect(resolveMemory(data.directory, event().id, resolution())).rejects.toThrow("Cannot verify")
    expect((await pendingMemory(data.directory)).pendingCount).toBe(1)
    const first = await resolveMemory(data.directory, event().id, { ...resolution(), commit: main.sha })
    expect(await resolveMemory(data.directory, event().id, { ...resolution(), commit: main.sha })).toEqual(first)
    expect(await pendingMemory(data.directory)).toEqual({ pendingCount: 0, pending: [] })
  })

  test("no-change and duplicate decisions require evidence but no invented document commit", async () => {
    const data = fixture()
    for (const disposition of ["no-change", "duplicate"]) {
      const input = event(`task-existing-${disposition}`)
      await recordMemory(data.directory, input)
      await resolveMemory(data.directory, input.id, {
        disposition,
        reason: "Already covered by the recorded source.",
        evidence: ["tasks/task-existing/existing-lesson.md"],
      })
    }
    expect((await pendingMemory(data.directory)).pendingCount).toBe(0)
    await expect(resolveMemory(data.directory, "missing-event", resolution())).rejects.toThrow()
    await expect(resolveMemory(data.directory, "../outside", resolution())).rejects.toThrow("Memory ID")
  })

  test("corrupt or mismatched events are not silently dropped, even after resolution", async () => {
    const data = fixture()
    const saved = await recordMemory(data.directory, event())
    const original = readFileSync(saved.file, "utf8")
    writeFileSync(saved.file, "{")
    await expect(pendingMemory(data.directory)).rejects.toThrow()
    await expect(recordMemory(data.directory, event())).rejects.toThrow()
    writeFileSync(saved.file, original)
    await resolveMemory(data.directory, event().id, { ...resolution(), disposition: "no-change" })
    writeFileSync(saved.file, JSON.stringify({ ...JSON.parse(original), data: { ...event(), id: "different-id" } }))
    await expect(pendingMemory(data.directory)).rejects.toThrow("filename does not match")
    writeFileSync(saved.file, JSON.stringify({ ...JSON.parse(original), recordedAt: "invalid" }))
    await expect(pendingMemory(data.directory)).rejects.toThrow("Invalid memory record")
  })

  test("malformed and orphan resolutions cannot hide unprocessed evidence", async () => {
    const data = fixture()
    await recordMemory(data.directory, event())
    const resolved = await resolveMemory(data.directory, event().id, { ...resolution(), disposition: "no-change" })
    const original = readFileSync(resolved.file, "utf8")
    writeFileSync(resolved.file, JSON.stringify({ ...JSON.parse(original), data: { disposition: "integrated" } }))
    await expect(pendingMemory(data.directory)).rejects.toThrow("Memory resolution requires")
    writeFileSync(resolved.file, original)
    writeFileSync(path.join(path.dirname(resolved.file), "orphan.json"), original)
    await expect(pendingMemory(data.directory)).rejects.toThrow("has no event")
  })

  test("independent concurrent processes cannot truncate or overwrite an event", async () => {
    const data = fixture()
    const script = `import { recordMemory } from ${JSON.stringify(memoryModule)}; await recordMemory(Bun.argv[1], JSON.parse(Bun.argv[2]));`
    const identical = await Promise.all(
      Array.from({ length: 4 }, () => run([process.execPath, "-e", script, data.directory, JSON.stringify(event())])),
    )
    expect(identical.map((result) => result.exitCode)).toEqual([0, 0, 0, 0])
    const distinct = await Promise.all(
      ["first claim", "second claim"].map((summary) =>
        run([process.execPath, "-e", script, data.directory, JSON.stringify({ ...event("racing-event"), summary })]),
      ),
    )
    expect(distinct.map((result) => result.exitCode).sort()).toEqual([0, 1])
    expect(distinct.find((result) => result.exitCode !== 0)?.stderr).toContain("Conflicting memory record")
    const queue = await pendingMemory(data.directory)
    expect(queue.pendingCount).toBe(2)
    expect(["first claim", "second claim"]).toContain(queue.pending.find((item) => item.id === "racing-event")?.summary)
  })

  test("CLI records, lists and resolves evidence in the repository runtime", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "maintenance-memory-cli-"))
    directories.push(root)
    expect((await run(["git", "init", root])).exitCode).toBe(0)
    const data = fixture(path.join(root, ".git", "cz-maintenance"))
    const main = await mainCommit(data.directory)
    const input = path.join(root, "event.json")
    const decision = path.join(root, "resolution.json")
    writeFileSync(input, JSON.stringify(event()))
    writeFileSync(decision, JSON.stringify({ ...resolution(), commit: main.sha }))
    const recorded = await run([process.execPath, maintenance, "memory", "record", input], root)
    expect(recorded.exitCode).toBe(0)
    expect(JSON.parse(recorded.stdout).file).toBe(
      realpathSync(path.join(data.directory, "memory", "events", `${event().id}.json`)),
    )
    const pending = await run([process.execPath, maintenance, "memory", "pending"], root)
    expect(pending.exitCode).toBe(0)
    expect(JSON.parse(pending.stdout).pendingCount).toBe(1)
    expect((await run([process.execPath, maintenance, "memory", "resolve", event().id, decision], root)).exitCode).toBe(
      0,
    )
    expect((await pendingMemory(data.directory)).pendingCount).toBe(0)
    expect((await run([process.execPath, maintenance, "memory", "pending", "extra"], root)).exitCode).toBe(1)
  })
})
