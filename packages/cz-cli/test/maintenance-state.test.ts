import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  findTask,
  initializeRuntime,
  loadRuntime,
  readRuntime,
  registerTask,
  saveTask,
  sourceKey,
} from "../../../scripts/maintenance/state"
import type { Item } from "../../../scripts/maintenance/state"

const directories: string[] = []

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "cz-native-state-"))
  directories.push(directory)
  const config = {
    repository: "clickzetta/cz-cli",
    baseRef: "origin/main",
    agent: "codex",
    lark: { chatId: "oc_test", identity: "user", sendIdentity: "bot" },
    permissions: {
      push: false,
      createPullRequest: false,
      postGithub: false,
      postLark: true,
      merge: false,
      release: false,
    },
  }
  const items = [
    ...[132, 131, 130, 126, 101, 70, 45, 43, 133].map((id) => ({
      source: "github-pr" as const,
      id: String(id),
      status: "needs_attention",
    })),
    ...["om_pending1", "om_pending2"].map((id) => ({
      source: "lark" as const,
      id: `lark:oc_test:${id}`,
      status: "needs_attention",
    })),
    ...["probe1", "probe2"].map((id) => ({ source: "audit" as const, id, status: "completed" })),
    ...[129, 117, 102, 125].map((id) => ({ source: "github" as const, id: String(id), status: "completed" })),
    ...[73, 32].map((id) => ({ source: "github-pr" as const, id: String(id), status: "ignored" })),
    ...["om_ignored1", "om_ignored2"].map((id) => ({
      source: "lark" as const,
      id: `lark:oc_test:${id}`,
      status: "ignored",
    })),
  ]
  const tasks = items.map((item, index) => ({
    id: `task-${String(index).padStart(12, "0")}`,
    item: {
      source: item.source,
      id: item.id,
      title: `Task ${index}`,
      body: "source context",
      url: "",
      updatedAt: "old",
    },
    status: item.status,
    phase: "implement",
    attempts: 1,
    updatedAt: "old",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    worktree: `/preserve/task-${index}`,
  }))
  const state = { tasks, since: { github: "github-cursor", lark: "lark-cursor" }, processed: { source: "seen" } }
  writeFileSync(path.join(directory, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  writeFileSync(path.join(directory, "state.json"), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  return { directory, config, tasks }
}

describe("native maintenance state", () => {
  test("adopts all legacy tasks, preserving permissions, cursors, IDs and worktrees", async () => {
    const data = fixture()
    const originalState = readFileSync(path.join(data.directory, "state.json"), "utf8")
    const originalConfig = readFileSync(path.join(data.directory, "config.json"), "utf8")
    const runtime = await initializeRuntime(data.directory)

    expect(runtime.tasks).toHaveLength(21)
    expect(runtime.tasks.filter((task) => task.status === "needs_attention")).toHaveLength(11)
    expect(runtime.tasks.filter((task) => task.status === "completed")).toHaveLength(6)
    expect(runtime.tasks.filter((task) => task.status === "ignored")).toHaveLength(4)
    expect(runtime.tasks.map((task) => task.id)).toEqual(data.tasks.map((task) => task.id))
    expect(runtime.tasks.map((task) => task.worktree)).toEqual(data.tasks.map((task) => task.worktree))
    expect(runtime.tasks.every((task) => task.reviewedSha === null)).toBe(true)
    expect(runtime.config.permissions).toEqual(data.config.permissions)
    expect(readFileSync(path.join(data.directory, "state.json"), "utf8")).toBe(originalState)
    expect(readFileSync(path.join(data.directory, "config.json"), "utf8")).toBe(originalConfig)
    expect(statSync(path.join(data.directory, "native-state.json")).mode & 0o777).toBe(0o600)
    expect(statSync(path.join(data.directory, "claims")).mode & 0o777).toBe(0o700)
    expect(statSync(path.join(data.directory, "outbox")).mode & 0o777).toBe(0o700)
    expect(await Bun.file(path.join(data.directory, "outbox", "receipt.json")).exists()).toBe(false)
  })

  test("stable source aliases locate old task IDs despite source updates", async () => {
    const data = fixture()
    const runtime = await initializeRuntime(data.directory)
    expect(findTask(runtime.tasks, "github-clickzetta-cz-cli-43", runtime.config.repository)?.id).toBe(data.tasks[7].id)
    expect(findTask(runtime.tasks, "github:clickzetta/cz-cli:43", runtime.config.repository)?.id).toBe(data.tasks[7].id)
    expect(findTask(runtime.tasks, "feishu-om_pending1", runtime.config.repository)?.id).toBe(data.tasks[9].id)

    const previous = runtime.tasks[7]
    const repeated = await registerTask(data.directory, {
      ...previous.item,
      updatedAt: "new",
      body: "updated comments",
    })
    expect(repeated.id).toBe(previous.id)
    expect((await readRuntime(data.directory)).tasks).toHaveLength(21)
    expect((await initializeRuntime(data.directory)).tasks.map((task) => task.id)).toEqual(
      runtime.tasks.map((task) => task.id),
    )
  })

  test("registers one stable task and refuses changed sources or stale review evidence", async () => {
    const data = fixture()
    const item: Item = { source: "github", id: "200", title: "New issue", body: "reproduce", url: "", updatedAt: "new" }
    const first = await registerTask(data.directory, item)
    const second = await registerTask(data.directory, { ...item, updatedAt: "later" })
    expect(second.id).toBe(first.id)
    expect((await readRuntime(data.directory)).tasks).toHaveLength(22)

    const implemented = await saveTask(data.directory, { ...first, headSha: "c".repeat(40), phase: "review" })
    expect(implemented.reviewedSha).toBeNull()
    const reviewed = await saveTask(data.directory, { ...implemented, reviewedSha: implemented.headSha! })
    expect((await readRuntime(data.directory)).tasks.find((task) => task.id === reviewed.id)?.reviewedSha).toBe(
      "c".repeat(40),
    )
    await expect(saveTask(data.directory, { ...reviewed, headSha: "d".repeat(40) })).rejects.toThrow(
      "new independent review",
    )
    await expect(saveTask(data.directory, { ...reviewed, reviewedSha: "e".repeat(40) })).rejects.toThrow(
      "match the task head",
    )
    await expect(saveTask(data.directory, { ...reviewed, item: { ...item, id: "201" } })).rejects.toThrow(
      "Register the task source",
    )
    const changed = await saveTask(data.directory, { ...reviewed, headSha: "d".repeat(40), reviewedSha: null })
    expect(changed.reviewedSha).toBeNull()
  })

  test("rejects incomplete authorization and inconsistent persisted source indexes", async () => {
    const data = fixture()
    writeFileSync(
      path.join(data.directory, "config.json"),
      JSON.stringify({ ...data.config, permissions: { postLark: true } }),
    )
    await expect(initializeRuntime(data.directory)).rejects.toThrow("permissions must be explicit")
    writeFileSync(path.join(data.directory, "config.json"), JSON.stringify(data.config))
    await initializeRuntime(data.directory)
    writeFileSync(
      path.join(data.directory, "native-state.json"),
      JSON.stringify({ version: 1, sources: { "github:clickzetta/cz-cli:132": "task-missing" }, tasks: [] }),
    )
    await expect(registerTask(data.directory, data.tasks[0].item)).rejects.toThrow("missing or different task")
    expect(sourceKey({ ...data.tasks[0].item, source: "github" }, data.config.repository)).toBe(
      "github:clickzetta/cz-cli:132",
    )
  })

  test("linked worktrees resolve the same runtime without touching it", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "cz-native-git-"))
    directories.push(directory)
    const git = async (args: string[]) => {
      const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" })
      const error = await new Response(child.stderr).text()
      if ((await child.exited) !== 0) throw new Error(error)
    }
    await git(["init", path.join(directory, "repo")])
    await git([
      "-C",
      path.join(directory, "repo"),
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Maintenance test",
      "-c",
      "user.email=maintenance@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "test: initial repository",
    ])
    await git(["-C", path.join(directory, "repo"), "worktree", "add", "--detach", path.join(directory, "linked")])
    const original = fixture()
    const runtimeDirectory = path.join(directory, "repo", ".git", "cz-maintenance")
    mkdirSync(runtimeDirectory, { mode: 0o700 })
    ;["config.json", "state.json"].forEach((name) =>
      writeFileSync(path.join(runtimeDirectory, name), readFileSync(path.join(original.directory, name)), {
        mode: 0o600,
      }),
    )
    const [main, linked] = await Promise.all([
      loadRuntime(path.join(directory, "repo")),
      loadRuntime(path.join(directory, "linked")),
    ])
    expect(main.directory).toBe(linked.directory)
    expect(main.tasks).toEqual(linked.tasks)
    expect(main.tasks).toHaveLength(21)
    expect(await Bun.file(path.join(runtimeDirectory, "native-state.json")).exists()).toBe(false)
  })
})
