import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { syncControl } from "../../../scripts/maintenance/sync"

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

test("sync refuses another branch, local edits, and diverged local commits", async () => {
  const repo = await setup()
  await git(repo.control, "switch", "--quiet", "-c", "pinned")
  await expect(syncControl(repo.control)).rejects.toThrow("must be on main")
  await git(repo.control, "switch", "--quiet", "main")

  writeFileSync(path.join(repo.control, "edit.md"), "local\n")
  await expect(syncControl(repo.control)).rejects.toThrow("local changes")
  rmSync(path.join(repo.control, "edit.md"))

  await git(repo.control, "commit", "--allow-empty", "-m", "local commit")
  await git(repo.upstream, "commit", "--allow-empty", "-m", "upstream commit")
  await expect(syncControl(repo.control)).rejects.toThrow("git merge failed")
})
