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

export type NightlyInput = {
  directory: string
  config: {
    repository: string
    baseRef: string
    permissions: { push: boolean; release: boolean; releaseNightly?: boolean; releaseStable?: boolean }
  }
  version: string
  sha: string
  execute?: boolean
}
export type ReleaseRunner = (argv: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>
export type NightlyReceipt = {
  version: string
  sha: string
  repository: "clickzetta/cz-cli"
  status: "sending" | "submitted" | "unknown" | "completed" | "failed"
  attemptedAt: string
  workflowRunId?: number
  needsArtifactVerification?: boolean
  error?: string
}

const repository = "clickzetta/cz-cli"
const workflow = "release-cos.yml"
const authorizedOrigins = [
  "https://github.com/clickzetta/cz-cli.git",
  "https://github.com/clickzetta/cz-cli",
  "git@github.com:clickzetta/cz-cli.git",
]
const control = path.resolve(import.meta.dir, "../..")
const nightlyVersion = /^dev-v\d+\.\d+\.\d+\.[0-9A-Za-z.-]+$/

export async function releaseNightly(input: NightlyInput, run: ReleaseRunner = executeRelease) {
  requireInput(input)
  if (!input.execute)
    return {
      status: "preview" as const,
      repository,
      version: input.version,
      sha: input.sha,
      channel: "nightly" as const,
    }
  return withLock(input.directory, async () => {
    const receipts = await readNightlyReceipts(input.directory)
    const previous = receipts.find((entry) => entry.sha === input.sha || entry.version === input.version)
    if (previous) {
      if (previous.sha !== input.sha || previous.version !== input.version)
        throw new Error("Nightly version or source was already assigned; do not allocate another version for a retry")
      if (previous.status === "submitted" || previous.status === "completed") return previous
      throw new Error(`Nightly attempt requires reconciliation (${previous.status})`)
    }
    for (const receipt of receipts.filter((entry) => entry.status === "submitted"))
      await inspect(input.directory, receipt, run)
    if (
      (await readNightlyReceipts(input.directory)).some((entry) =>
        ["sending", "unknown", "submitted"].includes(entry.status),
      )
    )
      throw new Error("An earlier nightly attempt is unresolved; reconcile it before another publication")
    const remote = await command(["git", "-C", control, "remote", "get-url", "origin"], run)
    if (!authorizedOrigins.includes(remote))
      throw new Error("Nightly source repository does not match the authorized origin")
    await command(unproxied(["git", "-C", control, "fetch", "origin", "main", "--tags"]), run)
    const main = await api(`/repos/${repository}/git/ref/heads/main`, run)
    if (!record(main) || !record(main.object) || main.object.sha !== input.sha)
      throw new Error("Nightly source must equal the current merged main SHA")
    for (const file of [".github/workflows/release-cos.yml", "scripts/cos-release.mjs"]) {
      const content = await api(`/repos/${repository}/contents/${file}?ref=${input.sha}`, run)
      if (
        !record(content) ||
        content.encoding !== "base64" ||
        typeof content.content !== "string" ||
        hash(Buffer.from(content.content, "base64").toString("utf8")) !==
          hash(await Bun.file(path.join(control, file)).text())
      )
        throw new Error("Merged release workflow and publisher must match the control checkout")
    }
    const runs = await api(
      `/repos/${repository}/actions/workflows/cz-test.yml/runs?head_sha=${input.sha}&status=success&per_page=100`,
      run,
    )
    if (
      !record(runs) ||
      !Array.isArray(runs.workflow_runs) ||
      !runs.workflow_runs.some(
        (entry) =>
          record(entry) &&
          entry.head_sha === input.sha &&
          entry.status === "completed" &&
          entry.conclusion === "success",
      )
    )
      throw new Error("Nightly source has no successful cz-test run for this exact SHA")
    const tags = await api(`/repos/${repository}/git/matching-refs/tags/${input.version}`, run)
    if (!Array.isArray(tags) || tags.some((entry) => record(entry) && entry.ref === `refs/tags/${input.version}`))
      throw new Error("Nightly tag already exists; do not overwrite or replay it")
    const releases = await api(`/repos/${repository}/releases?per_page=100`, run, true)
    if (!Array.isArray(releases) || releases.flat().some((entry) => record(entry) && entry.tag_name === input.version))
      throw new Error("Nightly release already exists; do not overwrite it")
    const sourcePackage = JSON.parse(
      await command(["git", "-C", control, "show", `${input.sha}:packages/opencode/package.json`], run),
    ) as unknown
    if (!record(sourcePackage) || typeof sourcePackage.version !== "string")
      throw new Error("Cannot identify the release source baseline")
    const lineage: unknown = JSON.parse(
      await command(
        [
          process.execPath,
          path.join(control, "scripts/check-release-lineage.mjs"),
          "--version",
          input.version,
          "--channel",
          "nightly",
          "--baseline",
          sourcePackage.version,
          "--json",
        ],
        run,
      ),
    )
    if (!record(lineage) || lineage.result !== "ok" || lineage.channel !== "nightly")
      throw new Error("Nightly lineage must be verified; skipped and forced results are not accepted")
    const pushTargets = (await command(["git", "-C", control, "remote", "get-url", "--push", "--all", "origin"], run))
      .split(/\r?\n/)
      .filter(Boolean)
    if (pushTargets.length !== 1 || !authorizedOrigins.includes(pushTargets[0]))
      throw new Error("Nightly push must resolve to exactly one authorized GitHub repository")
    const local = await run(["git", "-C", control, "rev-parse", "--verify", `refs/tags/${input.version}`])
    if (local.exitCode === 0 && local.stdout.trim() !== input.sha)
      throw new Error("Local nightly tag points to another SHA")
    if (local.exitCode !== 0)
      await command(["git", "-C", control, "-c", "tag.gpgSign=false", "tag", "--", input.version, input.sha], run)
    const receipt: NightlyReceipt = {
      repository,
      version: input.version,
      sha: input.sha,
      status: "sending",
      attemptedAt: new Date().toISOString(),
    }
    save(input.directory, receipt)
    try {
      await command(
        unproxied([
          "git",
          "-C",
          control,
          "-c",
          "core.sshCommand=ssh -o ProxyCommand=none -o ProxyJump=none",
          "push",
          "--no-follow-tags",
          "origin",
          `refs/tags/${input.version}:refs/tags/${input.version}`,
        ]),
        run,
      )
      receipt.status = "submitted"
      save(input.directory, receipt)
      return receipt
    } catch (error) {
      receipt.status = "unknown"
      receipt.error = error instanceof Error ? error.message : String(error)
      save(input.directory, receipt)
      throw new Error("Nightly push outcome is unknown; reconcile the tag, workflow and receipt before any retry")
    }
  })
}

export async function reconcileNightlyRelease(directory: string, sha: string, run: ReleaseRunner = executeRelease) {
  return withLock(directory, async () => {
    const receipt = (await readNightlyReceipts(directory)).find((entry) => entry.sha === sha)
    if (!receipt) throw new Error("Unknown nightly receipt")
    return inspect(directory, receipt, run)
  })
}

export async function readNightlyReceipts(directory: string) {
  const folder = path.join(directory, "outbox", "nightly")
  if (!existsSync(folder)) return []
  return Promise.all(
    readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const value: unknown = await Bun.file(path.join(folder, name)).json()
        if (
          !record(value) ||
          value.repository !== repository ||
          typeof value.version !== "string" ||
          !nightlyVersion.test(value.version) ||
          typeof value.sha !== "string" ||
          !/^[a-f0-9]{40}$/.test(value.sha) ||
          !["sending", "submitted", "unknown", "completed", "failed"].includes(String(value.status)) ||
          typeof value.attemptedAt !== "string"
        )
          throw new Error("Invalid nightly receipt; reconcile before continuing")
        return value as NightlyReceipt
      }),
  )
}

async function inspect(directory: string, receipt: NightlyReceipt, run: ReleaseRunner) {
  if (receipt.status === "completed" || receipt.status === "failed") return receipt
  const tags = await api(`/repos/${repository}/git/matching-refs/tags/${receipt.version}`, run)
  const tag = Array.isArray(tags)
    ? tags.find((entry) => record(entry) && entry.ref === `refs/tags/${receipt.version}`)
    : undefined
  if (!record(tag) || !record(tag.object) || tag.object.sha !== receipt.sha || tag.object.type !== "commit")
    throw new Error("Nightly tag is absent or does not match; retain the unresolved receipt without resending")
  const runs = await api(
    `/repos/${repository}/actions/workflows/${workflow}/runs?head_sha=${receipt.sha}&event=push&per_page=100`,
    run,
  )
  const attempt =
    record(runs) && Array.isArray(runs.workflow_runs)
      ? runs.workflow_runs.find(
          (entry) =>
            record(entry) &&
            entry.head_sha === receipt.sha &&
            entry.head_branch === receipt.version &&
            entry.event === "push",
        )
      : undefined
  if (!record(attempt) || typeof attempt.id !== "number") return receipt
  receipt.workflowRunId = attempt.id
  if (attempt.status !== "completed") {
    receipt.status = "submitted"
    save(directory, receipt)
    return receipt
  }
  if (attempt.conclusion !== "success") {
    receipt.status = "failed"
    receipt.error = `Release workflow concluded ${String(attempt.conclusion)}`
    save(directory, receipt)
    return receipt
  }
  const release = await api(`/repos/${repository}/releases/tags/${receipt.version}`, run)
  if (
    !record(release) ||
    release.tag_name !== receipt.version ||
    release.prerelease !== true ||
    release.draft !== false ||
    !Array.isArray(release.assets) ||
    !release.assets.some(
      (entry) => record(entry) && typeof entry.name === "string" && /\.(zip|tar\.gz)$/.test(entry.name),
    )
  )
    throw new Error("Completed nightly workflow has no verified prerelease assets")
  receipt.status = "completed"
  receipt.needsArtifactVerification = true
  delete receipt.error
  save(directory, receipt)
  return receipt
}

function requireInput(input: NightlyInput) {
  if (input.config.repository !== repository || input.config.baseRef !== "origin/main")
    throw new Error("Nightly publishing is restricted to clickzetta/cz-cli main")
  if (
    input.config.permissions.push !== true ||
    input.config.permissions.release !== false ||
    input.config.permissions.releaseNightly !== true ||
    input.config.permissions.releaseStable !== false
  )
    throw new Error(
      "Nightly-only release authorization must be explicit; generic and stable release must remain disabled",
    )
  if (!nightlyVersion.test(input.version) || !/^[a-f0-9]{40}$/.test(input.sha))
    throw new Error("Only dev-vX.Y.Z.SUFFIX nightly tags and exact commit SHAs are accepted")
}
function unproxied(argv: string[]) {
  return [
    "env",
    "-u",
    "HTTP_PROXY",
    "-u",
    "HTTPS_PROXY",
    "-u",
    "ALL_PROXY",
    "-u",
    "http_proxy",
    "-u",
    "https_proxy",
    "-u",
    "all_proxy",
    "NO_PROXY=*",
    "no_proxy=*",
    ...argv,
  ]
}
async function api(endpoint: string, run: ReleaseRunner, paginate = false) {
  return JSON.parse(
    await command(
      ["gh", "api", "--hostname", "github.com", endpoint, ...(paginate ? ["--paginate", "--slurp"] : [])],
      run,
    ),
  ) as unknown
}
async function command(argv: string[], run: ReleaseRunner) {
  const result = await run(argv)
  if (result.exitCode !== 0)
    throw new Error(`Release command failed (${result.exitCode}): ${result.stderr.slice(0, 400)}`)
  return result.stdout.trim()
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
async function withLock<T>(directory: string, operation: () => Promise<T>) {
  const folder = path.join(directory, "outbox", "nightly")
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  const lock = path.join(folder, "publication.lock")
  closeSync(openSync(lock, "wx", 0o600))
  try {
    return await operation()
  } finally {
    rmSync(lock)
  }
}
function save(directory: string, receipt: NightlyReceipt) {
  const file = path.join(directory, "outbox", "nightly", `${hash(receipt.sha)}.json`)
  const temporary = `${file}.${randomUUID()}.tmp`
  const descriptor = openSync(temporary, "wx", 0o600)
  try {
    writeFileSync(descriptor, JSON.stringify(receipt, null, 2) + "\n")
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporary, file)
  const folder = openSync(path.dirname(file), "r")
  try {
    fsyncSync(folder)
  } finally {
    closeSync(folder)
  }
}
export async function executeRelease(argv: string[]) {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", timeout: 60_000 })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
