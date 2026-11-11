import { rename } from "node:fs/promises"
import path from "node:path"

const roles = ["worker", "curator"]

// The control checkout tracks main: rules and memory are live as soon as they are merged.
export async function syncControl(cwd = process.cwd(), role?: string) {
  if (role !== undefined && !roles.includes(role)) throw new Error("Use: sync [worker|curator]")
  const root = await git(cwd, "rev-parse", "--show-toplevel")
  const branch = await git(root, "symbolic-ref", "--quiet", "--short", "HEAD").catch(() => "")
  if (branch !== "main") throw new Error(`The control checkout must be on main, not ${branch || "a detached HEAD"}`)
  if (await git(root, "status", "--porcelain"))
    throw new Error("The control checkout has local changes; it is read-only, so reconcile them before syncing")
  const before = await git(root, "rev-parse", "HEAD")
  await git(root, "fetch", "--quiet", "origin", "main")
  await git(root, "merge", "--quiet", "--ff-only", "refs/remotes/origin/main")
  const after = await git(root, "rev-parse", "HEAD")
  // A fast-forward is a no-op when the checkout is ahead, so compare directly: local commits must not run.
  if (after !== (await git(root, "rev-parse", "refs/remotes/origin/main")))
    throw new Error("The control checkout has commits not on origin/main; it is read-only, so reconcile them")
  return { root, before, after, updated: before !== after, ...(await pendingRules(root, before, after, role)) }
}

// A role confirms it has reread the rules up to a commit; until then every sync lists them again.
export async function acknowledgeRules(cwd: string, role: string, sha: string) {
  if (!roles.includes(role) || !/^[0-9a-f]{40}$/.test(sha)) throw new Error("Use: rules-read worker|curator FULL_SHA")
  // Cursors are shared by every worktree of this repository, so judge the commit from the control checkout:
  // a task branch's commit, or one fetched but not yet synced, would move the cursor past unread rules.
  const control = path.dirname(await git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"))
  await Promise.all(
    ["HEAD", "refs/remotes/origin/main"].map((ref) => git(control, "merge-base", "--is-ancestor", sha, ref)),
  ).catch(() => {
    throw new Error("That commit is not on origin/main as the control checkout has it; run sync first and pass its `after` value")
  })
  await writeCursor(await cursorFile(control, role), sha)
  return { role, rulesReadThrough: sha }
}

// Long-lived sessions act on the rules they remember; naming what moved is their cue to reread it.
// Roles share this checkout, so whoever syncs first would consume the difference: each role keeps its own cursor,
// and only acknowledgeRules advances it, so a round that dies after syncing is told again.
async function pendingRules(root: string, before: string, after: string, role?: string) {
  if (!role) return { changedRules: await changedRules(root, before, after), cursorReset: false }
  const file = await cursorFile(root, role)
  const exists = await Bun.file(file).exists()
  const stored = exists ? (await Bun.file(file).text()).trim() : ""
  const valid =
    /^[0-9a-f]{40}$/.test(stored) &&
    (await git(root, "merge-base", "--is-ancestor", stored, after).then(
      () => true,
      () => false,
    ))
  if (!exists) await writeCursor(file, before)
  // A damaged cursor hides how much was missed, so the caller is told to reread everything. It stays damaged
  // until rules-read replaces it, so a round that dies first is told again.
  return { changedRules: await changedRules(root, valid ? stored : before, after), cursorReset: exists && !valid }
}

async function changedRules(root: string, from: string, to: string) {
  if (from === to) return []
  // Deleted files are left out: there is nothing to reread.
  return (await git(root, "diff", "--name-only", "--diff-filter=d", from, to, "--", "AGENTS.md", "docs/maintenance"))
    .split("\n")
    .filter(Boolean)
}

async function cursorFile(root: string, role: string) {
  return path.join(
    await git(root, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    "cz-maintenance",
    "control",
    `rules-seen-${role}`,
  )
}

async function writeCursor(file: string, sha: string) {
  await Bun.write(`${file}.${process.pid}.tmp`, `${sha}\n`)
  await rename(`${file}.${process.pid}.tmp`, file)
}

async function git(cwd: string, ...args: string[]) {
  // Fetches go direct, like the release guard: the server's proxy variables must not apply to git.
  const child = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe", env: unproxied() })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim()}`)
  return stdout.trim()
}

function unproxied() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(http|https|all)_proxy$/i.test(key)),
  )
  return { ...env, NO_PROXY: "*", no_proxy: "*" }
}
