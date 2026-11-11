// The control checkout tracks main: rules and memory are live as soon as they are merged.
export async function syncControl(cwd = process.cwd()) {
  const root = await git(cwd, "rev-parse", "--show-toplevel")
  const branch = await git(root, "symbolic-ref", "--quiet", "--short", "HEAD").catch(() => "")
  if (branch !== "main") throw new Error(`The control checkout must be on main, not ${branch || "a detached HEAD"}`)
  if (await git(root, "status", "--porcelain"))
    throw new Error("The control checkout has local changes; it is read-only, so reconcile them before syncing")
  const before = await git(root, "rev-parse", "HEAD")
  await git(root, "fetch", "--quiet", "origin", "main")
  // --ff-only refuses to rewrite local commits; a refusal means someone edited the control checkout.
  await git(root, "merge", "--quiet", "--ff-only", "refs/remotes/origin/main")
  const after = await git(root, "rev-parse", "HEAD")
  return { root, before, after, updated: before !== after }
}

async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim()}`)
  return stdout.trim()
}
