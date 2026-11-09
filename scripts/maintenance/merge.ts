import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

export type MergeInput = {
  directory: string
  config: {
    repository: string
    permissions: { merge: boolean }
    mergePolicy?: { informationalWorkflows?: string[] }
  }
  task: {
    id: string
    item: { source: string; id: string }
    status: string
    phase: string
    headSha?: string
    reviewedSha?: string | null
    pullRequestNumber?: number
  }
  pullRequestNumber: number
  merge?: boolean
}

export type MergeReceipt = {
  taskId: string
  repository: string
  pullRequestNumber: number
  headSha: string
  informationalWorkflows?: string[]
  status: "merging" | "merged" | "unknown"
  attemptedAt: string
  mergeCommitSha?: string
  mergedAt?: string
  error?: string
}

export type MergeRunner = (argv: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>

export async function mergePullRequest(input: MergeInput, run: MergeRunner = executeMerge) {
  const target = requireTarget(input)
  if (input.merge && input.config.permissions.merge !== true) throw new Error("PR merge is not authorized")
  const folder = path.join(input.directory, "outbox", "merges")
  const file = path.join(folder, `${targetKey(target.repository, target.pullRequestNumber)}.json`)
  if (!input.merge) {
    if (await Bun.file(file).exists()) {
      const receipt = requireReceipt(await Bun.file(file).json())
      requireMatchingTarget(receipt, target)
      return { ...receipt, file }
    }
    const pull = await readPullRequest(target, run)
    requireMergeablePull(pull, target.informationalWorkflows)
    return { status: "preview" as const, ...target }
  }
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  const lock = `${file}.lock`
  closeSync(openSync(lock, "wx", 0o600))
  try {
    if (await Bun.file(file).exists()) {
      const previous = requireReceipt(await Bun.file(file).json())
      requireMatchingTarget(previous, target)
      if (previous.status === "merged") return { ...previous, file }
      // An unknown write is only reconciled by reading the PR; never replay it.
      const observed = await readPullRequest(target, run)
      const merged = requireMergedPull(observed)
      const completed: MergeReceipt = { ...previous, ...merged, status: "merged" }
      save(file, completed)
      return { ...completed, file }
    }
    const pull = await readPullRequest(target, run)
    requireMergeablePull(pull, target.informationalWorkflows)
    const receipt: MergeReceipt = { ...target, status: "merging", attemptedAt: new Date().toISOString() }
    save(file, receipt)
    try {
      await request(
        [
          "gh",
          "pr",
          "merge",
          String(target.pullRequestNumber),
          "--repo",
          target.repository,
          "--admin",
          "--squash",
          "--match-head-commit",
          target.headSha,
        ],
        run,
      )
      const observed = await readPullRequest(target, run)
      const merged = requireMergedPull(observed)
      const completed: MergeReceipt = { ...receipt, ...merged, status: "merged" }
      save(file, completed)
      return { ...completed, file }
    } catch (error) {
      save(file, { ...receipt, status: "unknown", error: error instanceof Error ? error.message : String(error) })
      throw new Error(`Merge outcome is unknown; reconcile before another attempt: ${file}`)
    }
  } finally {
    rmSync(lock)
  }
}

export async function readMergeReceipts(directory: string) {
  const folder = path.join(directory, "outbox", "merges")
  if (!existsSync(folder)) return []
  return Promise.all(
    readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => ({
        ...requireReceipt(await Bun.file(path.join(folder, name)).json()),
        file: path.join(folder, name),
      })),
  )
}

function requireTarget(input: MergeInput) {
  if (input.config.mergePolicy !== undefined && !record(input.config.mergePolicy))
    throw new Error("Invalid merge policy")
  const informationalWorkflows = requireInformationalWorkflows(input.config.mergePolicy?.informationalWorkflows)
  if (input.task.status !== "completed" || input.task.phase !== "review")
    throw new Error("The task must have completed its independent review before merging")
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.task.id) || !/^[\w.-]+\/[\w.-]+$/.test(input.config.repository))
    throw new Error("Invalid merge task or repository")
  if (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber < 1)
    throw new Error("Invalid pull request number")
  if (
    !input.task.headSha ||
    !/^[a-f0-9]{40}$/.test(input.task.headSha) ||
    input.task.reviewedSha !== input.task.headSha
  )
    throw new Error("The final head must have a matching independent reviewedSha")
  if (input.task.item.source === "github-pr") {
    if (input.task.item.id !== String(input.pullRequestNumber))
      throw new Error("Pull request does not match the task source")
  } else if (input.task.pullRequestNumber !== input.pullRequestNumber)
    throw new Error("Save the task's pullRequestNumber before merging a new PR")
  return {
    taskId: input.task.id,
    repository: input.config.repository.toLowerCase(),
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.task.headSha,
    informationalWorkflows,
  }
}

function requireMatchingTarget(receipt: MergeReceipt, target: ReturnType<typeof requireTarget>) {
  if (
    receipt.repository !== target.repository ||
    receipt.pullRequestNumber !== target.pullRequestNumber ||
    receipt.headSha !== target.headSha
  )
    throw new Error("Existing merge receipt has a different target or head; reconcile it first")
}

async function readPullRequest(target: ReturnType<typeof requireTarget>, run: MergeRunner) {
  const value: unknown = JSON.parse(
    await request(
      [
        "gh",
        "pr",
        "view",
        String(target.pullRequestNumber),
        "--repo",
        target.repository,
        "--json",
        "url,number,state,isDraft,baseRefName,headRefOid,statusCheckRollup,mergeCommit,mergedAt",
      ],
      run,
    ),
  )
  if (
    !record(value) ||
    value.url !== `https://github.com/${target.repository}/pull/${target.pullRequestNumber}` ||
    value.number !== target.pullRequestNumber ||
    value.baseRefName !== "main" ||
    value.headRefOid !== target.headSha
  )
    throw new Error("Remote PR repository, number, base or head does not match the reviewed task")
  return value
}

function requireMergeablePull(pull: Record<string, unknown>, informationalWorkflows: string[]) {
  if (pull.state !== "OPEN" || pull.isDraft !== false) throw new Error("Only an open, non-draft PR can be merged")
  if (!Array.isArray(pull.statusCheckRollup) || pull.statusCheckRollup.length === 0)
    throw new Error("Final-head CI checks are missing")
  const checks = pull.statusCheckRollup.filter(
    (check) =>
      !record(check) || check.__typename !== "CheckRun" || !informationalWorkflows.includes(String(check.workflowName)),
  )
  if (
    !checks.every(
      (check) =>
        record(check) &&
        ((check.__typename === "CheckRun" &&
          check.status === "COMPLETED" &&
          ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(String(check.conclusion))) ||
          (check.__typename === "StatusContext" && check.state === "SUCCESS")),
    )
  )
    throw new Error("A final-head check is failed, pending or unrecognized; merging is blocked")
  if (
    !checks.some(
      (check) =>
        record(check) &&
        check.__typename === "CheckRun" &&
        check.workflowName === "cz-test" &&
        check.name === "test" &&
        check.status === "COMPLETED" &&
        check.conclusion === "SUCCESS",
    )
  )
    throw new Error("The final head needs a successful cz-test/test check")
}

function requireMergedPull(pull: Record<string, unknown>) {
  if (
    pull.state !== "MERGED" ||
    !record(pull.mergeCommit) ||
    typeof pull.mergeCommit.oid !== "string" ||
    !/^[a-f0-9]{40}$/.test(pull.mergeCommit.oid) ||
    typeof pull.mergedAt !== "string" ||
    !Number.isFinite(Date.parse(pull.mergedAt))
  )
    throw new Error("PR is not confirmed merged with an actual merge commit; keep the receipt for reconciliation")
  return { mergeCommitSha: pull.mergeCommit.oid, mergedAt: pull.mergedAt }
}

function requireReceipt(value: unknown): MergeReceipt {
  const informationalWorkflows = requireInformationalWorkflows(record(value) ? value.informationalWorkflows : undefined)
  if (
    !record(value) ||
    typeof value.taskId !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(value.taskId) ||
    typeof value.repository !== "string" ||
    !/^[\w.-]+\/[\w.-]+$/.test(value.repository) ||
    !Number.isSafeInteger(value.pullRequestNumber) ||
    Number(value.pullRequestNumber) < 1 ||
    typeof value.headSha !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.headSha) ||
    !["merging", "merged", "unknown"].includes(String(value.status)) ||
    typeof value.attemptedAt !== "string" ||
    (value.status === "merged" &&
      (typeof value.mergeCommitSha !== "string" ||
        !/^[a-f0-9]{40}$/.test(value.mergeCommitSha) ||
        typeof value.mergedAt !== "string"))
  )
    throw new Error("Invalid merge receipt; reconcile it before continuing")
  return { ...value, informationalWorkflows } as MergeReceipt
}

function requireInformationalWorkflows(value: unknown) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((name) => name !== "Claude Code Review"))
    throw new Error("Only Claude Code Review may be configured as an informational workflow")
  return [...value] as string[]
}

async function request(argv: string[], run: MergeRunner) {
  const result = await run(argv)
  if (result.exitCode !== 0) throw new Error(`gh exited ${result.exitCode}: ${result.stderr.slice(0, 600)}`)
  return result.stdout
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function targetKey(repository: string, number: number) {
  return createHash("sha256").update(`${repository}:${number}`).digest("hex")
}

function save(file: string, value: MergeReceipt) {
  const temporary = `${file}.${randomUUID()}.tmp`
  const descriptor = openSync(temporary, "wx", 0o600)
  try {
    writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n")
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporary, file)
  const directory = openSync(path.dirname(file), "r")
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
}

export async function executeMerge(argv: string[], timeoutMs = 30_000) {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", timeout: timeoutMs })
  const result = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { stdout: result[0], stderr: result[1], exitCode: result[2] }
}
