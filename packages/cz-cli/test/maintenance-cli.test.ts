import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const directories: string[] = []
const script = path.resolve(import.meta.dir, "../../../scripts/maintenance.ts")

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

async function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "maintenance-cli-"))
  directories.push(directory)
  const git = Bun.spawn(["git", "init", "-q", directory], { stdout: "pipe", stderr: "pipe" })
  expect(await git.exited).toBe(0)
  mkdirSync(path.join(directory, ".git", "cz-maintenance"), { mode: 0o700 })
  await Bun.write(
    path.join(directory, ".git", "cz-maintenance", "config.json"),
    JSON.stringify({
      repository: "owner/repo",
      baseRef: "origin/main",
      lark: { identity: "user", sendIdentity: "bot", chatId: "oc_test" },
      permissions: {
        push: false,
        createPullRequest: false,
        postGithub: false,
        postLark: true,
        merge: false,
        release: false,
      },
    }),
  )
  await Bun.write(
    path.join(directory, ".git", "cz-maintenance", "state.json"),
    JSON.stringify({
      tasks: [
        {
          id: "task-000000000001",
          item: {
            source: "github-pr",
            id: "132",
            title: "existing",
            body: "",
            url: "https://example.invalid/132",
            updatedAt: "2026-11-09T00:00:00Z",
          },
          status: "needs_attention",
          phase: "implement",
          attempts: 1,
          updatedAt: "2026-11-09T00:00:00Z",
        },
      ],
    }),
  )
  return directory
}

async function execute(directory: string, args: string[]) {
  const child = Bun.spawn([process.execPath, script, ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

test("CLI initializes the shared runtime and resolves existing source IDs", async () => {
  const directory = await fixture()
  expect((await execute(directory, ["init"])).exitCode).toBe(0)
  const status = await execute(directory, ["status"])
  expect(status.exitCode).toBe(0)
  expect(JSON.parse(status.stdout).counts.needs_attention).toBe(1)
  expect(JSON.parse(status.stdout).receipts).toEqual([])
  const task = await execute(directory, ["task", "github:owner/repo:132"])
  expect(task.exitCode).toBe(0)
  expect(JSON.parse(task.stdout).id).toBe("task-000000000001")
  expect(JSON.parse(task.stdout).reviewedSha).toBeNull()
})

test("CLI rejects malformed delivery options before a write can occur", async () => {
  const directory = await fixture()
  const result = await execute(directory, ["reply", "task-000000000001", "阻碍", "--send", "--send"])
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain("repeated reply option")
  expect(await Bun.file(path.join(directory, ".git", "cz-maintenance", "outbox")).exists()).toBe(false)
})
