import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { acknowledgeRules, syncControl } from "../../../scripts/maintenance/sync"

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn(
    ["git", "-C", cwd, "-c", "core.hooksPath=/dev/null", "-c", "user.name=Sync", "-c", "user.email=s@example.test", ...args],
    { stdout: "pipe", stderr: "pipe" },
  )
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
  expect(exitCode).toBe(0)
  return stdout.trim()
}

// An upstream repo standing in for GitHub, plus a control clone of it.
async function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "maintenance-sync-"))
  directories.push(root)
  const upstream = path.join(root, "upstream")
  const control = path.join(root, "control")
  await git(root, "init", "--initial-branch=main", upstream)
  await git(upstream, "commit", "--allow-empty", "-m", "first")
  await git(root, "clone", "--quiet", upstream, control)
  return { upstream, control }
}

test("sync fast-forwards the control checkout to origin/main", async () => {
  const repo = await setup()
  expect((await syncControl(repo.control)).updated).toBe(false)
  writeFileSync(path.join(repo.upstream, "note.md"), "merged memory\n")
  await git(repo.upstream, "add", "note.md")
  await git(repo.upstream, "commit", "-m", "docs: merged memory")
  const result = await syncControl(repo.control)
  expect(result.updated).toBe(true)
  expect(result.after).toBe(await git(repo.upstream, "rev-parse", "HEAD"))
  expect(await Bun.file(path.join(repo.control, "note.md")).text()).toBe("merged memory\n")
})

test("sync names the rule files that changed so a running session rereads them", async () => {
  const repo = await setup()
  expect((await syncControl(repo.control)).changedRules).toEqual([])
  mkdirSync(path.join(repo.upstream, "docs/maintenance/prompts"), { recursive: true })
  mkdirSync(path.join(repo.upstream, "packages"), { recursive: true })
  writeFileSync(path.join(repo.upstream, "docs/maintenance/prompts/worker.md"), "rule\n")
  writeFileSync(path.join(repo.upstream, "AGENTS.md"), "rule\n")
  writeFileSync(path.join(repo.upstream, "packages/code.ts"), "code\n")
  await git(repo.upstream, "add", ".")
  await git(repo.upstream, "commit", "-m", "docs: change rules and code")
  expect((await syncControl(repo.control)).changedRules).toEqual(["AGENTS.md", "docs/maintenance/prompts/worker.md"])
  expect((await syncControl(repo.control)).changedRules).toEqual([])
})

async function commitRule(upstream: string, file: string, content: string) {
  mkdirSync(path.join(upstream, path.dirname(file)), { recursive: true })
  writeFileSync(path.join(upstream, file), content)
  await git(upstream, "add", ".")
  await git(upstream, "commit", "-m", `docs: change ${file}`)
}

test("a role keeps being told about a rule change until it confirms the read", async () => {
  const repo = await setup()
  expect((await syncControl(repo.control, "worker")).changedRules).toEqual([])
  await commitRule(repo.upstream, "docs/maintenance/workflow.md", "one\n")
  const first = await syncControl(repo.control, "worker")
  expect(first.changedRules).toEqual(["docs/maintenance/workflow.md"])
  // The round died before reading: the next sync moves nothing, yet must say it again.
  const again = await syncControl(repo.control, "worker")
  expect(again.updated).toBe(false)
  expect(again.changedRules).toEqual(["docs/maintenance/workflow.md"])
  await acknowledgeRules(repo.control, "worker", again.after)
  expect((await syncControl(repo.control, "worker")).changedRules).toEqual([])
  expect(await git(repo.control, "status", "--porcelain")).toBe("")
})

test("each role sees every rule change, even when another role synced first", async () => {
  const repo = await setup()
  const start = await syncControl(repo.control, "curator")
  await syncControl(repo.control, "worker")
  await commitRule(repo.upstream, "docs/maintenance/retired.md", "old\n")
  await commitRule(repo.upstream, "docs/maintenance/workflow.md", "one\n")
  const worker = await syncControl(repo.control, "worker")
  expect(worker.changedRules).toEqual(["docs/maintenance/retired.md", "docs/maintenance/workflow.md"])
  await acknowledgeRules(repo.control, "worker", worker.after)

  await git(repo.upstream, "rm", "--quiet", "docs/maintenance/retired.md")
  await git(repo.upstream, "commit", "-m", "docs: retire a note")
  // The worker had read the note; its deletion leaves nothing to reread.
  expect((await syncControl(repo.control, "worker")).changedRules).toEqual([])
  // The checkout no longer moves for the curator, and a deleted file is not something to reread.
  const curator = await syncControl(repo.control, "curator")
  expect(curator.before).not.toBe(start.after)
  expect(curator.updated).toBe(false)
  expect(curator.changedRules).toEqual(["docs/maintenance/workflow.md"])
  await acknowledgeRules(repo.control, "curator", curator.after)
  expect((await syncControl(repo.control, "curator")).changedRules).toEqual([])
})

test("sync rejects unknown roles and reports a damaged cursor", async () => {
  const repo = await setup()
  await expect(syncControl(repo.control, "../escape")).rejects.toThrow("worker|curator")
  await expect(syncControl(repo.control, "wroker")).rejects.toThrow("worker|curator")
  const head = (await syncControl(repo.control, "worker")).after
  await expect(acknowledgeRules(repo.control, "worker", "HEAD")).rejects.toThrow("FULL_SHA")
  await expect(acknowledgeRules(repo.control, "worker", "0".repeat(40))).rejects.toThrow("not on origin/main")
  await acknowledgeRules(repo.control, "worker", head)
  await git(repo.control, "switch", "--quiet", "-c", "task")
  await git(repo.control, "commit", "--allow-empty", "-m", "task work")
  await expect(acknowledgeRules(repo.control, "worker", await git(repo.control, "rev-parse", "HEAD"))).rejects.toThrow(
    "not on origin/main",
  )
  await git(repo.control, "switch", "--quiet", "main")
  // Fetched but not synced: the checkout has not shown these rules to anyone yet.
  await git(repo.upstream, "commit", "--allow-empty", "-m", "ahead")
  await git(repo.control, "fetch", "--quiet", "origin", "main")
  await expect(
    acknowledgeRules(repo.control, "worker", await git(repo.control, "rev-parse", "refs/remotes/origin/main")),
  ).rejects.toThrow("run sync first")

  const cursor = path.join(repo.control, ".git/cz-maintenance/control/rules-seen-worker")
  for (const damaged of ["not-a-commit\n", "--all\n", `${"0".repeat(40)}\n`, "\n"]) {
    writeFileSync(cursor, damaged)
    await commitRule(repo.upstream, "docs/maintenance/workflow.md", damaged)
    const result = await syncControl(repo.control, "worker")
    expect(result.cursorReset).toBe(true)
    expect(result.changedRules).toEqual(["docs/maintenance/workflow.md"])
    // Unconfirmed, the reset is reported again even though nothing moves.
    expect((await syncControl(repo.control, "worker")).cursorReset).toBe(true)
    await acknowledgeRules(repo.control, "worker", result.after)
    expect((await syncControl(repo.control, "worker")).cursorReset).toBe(false)
  }
})

test("sync refuses another branch, local edits, and diverged local commits", async () => {
  const repo = await setup()
  await git(repo.control, "switch", "--quiet", "-c", "pinned")
  await expect(syncControl(repo.control)).rejects.toThrow("must be on main")
  await git(repo.control, "switch", "--quiet", "main")

  writeFileSync(path.join(repo.control, "edit.md"), "local\n")
  await expect(syncControl(repo.control)).rejects.toThrow("local changes")
  rmSync(path.join(repo.control, "edit.md"))

  await git(repo.control, "switch", "--quiet", "--detach")
  await expect(syncControl(repo.control)).rejects.toThrow("detached HEAD")
  await git(repo.control, "switch", "--quiet", "main")

  // Ahead only: a fast-forward is a no-op, yet the local commit must not run.
  await git(repo.control, "commit", "--allow-empty", "-m", "local commit")
  await expect(syncControl(repo.control)).rejects.toThrow("commits not on origin/main")

  await git(repo.upstream, "commit", "--allow-empty", "-m", "upstream commit")
  await expect(syncControl(repo.control)).rejects.toThrow("git merge failed")
})

test("sync fails when origin is unreachable", async () => {
  const repo = await setup()
  await git(repo.control, "remote", "set-url", "origin", path.join(repo.upstream, "missing"))
  await expect(syncControl(repo.control)).rejects.toThrow("git fetch failed")
})
