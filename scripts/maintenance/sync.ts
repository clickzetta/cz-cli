import path from "node:path"

// The control checkout tracks main: rules and memory are live as soon as they are merged.
export async function syncControl(cwd = process.cwd(), role?: string) {
  if (role !== undefined && !/^[a-z]+$/.test(role)) throw new Error("Use: sync [ROLE], with ROLE in lowercase letters")
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
  return { root, before, after, updated: before !== after, changedRules: await changedRules(root, before, after, role) }
}

// Long-lived sessions act on the rules they remember; naming what moved is their cue to reread it.
// Roles share this checkout, so whoever syncs first would consume the difference: each role keeps its own cursor.
async function changedRules(root: string, before: string, after: string, role?: string) {
  const cursor = role
    ? path.join(
        await git(root, "rev-parse", "--path-format=absolute", "--git-common-dir"),
        "cz-maintenance",
        "control",
        `rules-seen-${role}`,
      )
    : undefined
  const seen = cursor && (await Bun.file(cursor).exists()) ? (await Bun.file(cursor).text()).trim() : before
  // An unreadable cursor falls back to this sync's own movement instead of blocking every later round.
  const base = await git(root, "merge-base", "--is-ancestor", seen, after).then(
    () => seen,
    () => before,
  )
  if (cursor) await Bun.write(cursor, `${after}\n`)
  if (base === after) return []
  // Deleted files are left out: there is nothing to reread.
  return (await git(root, "diff", "--name-only", "--diff-filter=d", base, after, "--", "AGENTS.md", "docs/maintenance"))
    .split("\n")
    .filter(Boolean)
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
