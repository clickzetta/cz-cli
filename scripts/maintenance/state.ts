import { createHash, randomUUID } from "node:crypto"
import { closeSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

export type Config = {
  repository: string
  baseRef: string
  lark: { chatId?: string; identity: "user" | "bot"; sendIdentity?: "user" | "bot"; [key: string]: unknown }
  permissions: {
    push: boolean
    createPullRequest: boolean
    postGithub: boolean
    postLark: boolean
    merge: boolean
    release: boolean
    releaseNightly?: boolean
    releaseStable?: false
  }
  mergePolicy?: { informationalWorkflows?: string[] }
  [key: string]: unknown
}

export type Item = {
  source: "github" | "github-pr" | "lark" | "audit"
  id: string
  title: string
  body: string
  url: string
  updatedAt: string
}

export type Task = {
  id: string
  item: Item
  status: "pending" | "running" | "review" | "completed" | "ignored" | "needs_attention"
  phase: "implement" | "review"
  attempts: number
  updatedAt: string
  worktree?: string
  baseSha?: string
  headSha?: string
  reviewedSha: string | null
  result?: Record<string, unknown>
  [key: string]: unknown
}

type NativeState = { version: 1; sources: Record<string, string>; tasks: Task[] }

export async function loadRuntime(cwd = process.cwd()) {
  const child = Bun.spawn(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`Cannot locate the shared Git directory: ${stderr.trim()}`)
  const directory = path.join(stdout.trim(), "cz-maintenance")
  return { directory, ...(await readRuntime(directory)) }
}

export async function readRuntime(directory: string) {
  const config = requireConfig(await Bun.file(path.join(directory, "config.json")).json())
  const legacy: unknown = (await Bun.file(path.join(directory, "state.json")).exists())
    ? await Bun.file(path.join(directory, "state.json")).json()
    : { tasks: [] }
  if (!record(legacy) || !Array.isArray(legacy.tasks)) throw new Error("Invalid legacy maintenance state")
  const native = await readNative(directory)
  const tasks = [
    ...new Map([...legacy.tasks.map(requireTask), ...native.tasks].map((task) => [task.id, task])).values(),
  ]
  return { config, tasks }
}

export async function initializeRuntime(directory: string) {
  return withStateLock(directory, async () => {
    const runtime = await readRuntime(directory)
    const native = await readNative(directory)
    const sources = indexSources(runtime.tasks, runtime.config.repository, native.sources)
    ;["claims", "outbox", "tasks"].forEach((name) =>
      mkdirSync(path.join(directory, name), { recursive: true, mode: 0o700 }),
    )
    saveNative(directory, { ...native, sources })
    return runtime
  })
}

export function findTask(tasks: Task[], idOrSource: string, repository: string) {
  return tasks.find(
    (task) =>
      task.id === idOrSource ||
      sourceKey(task.item, repository) === idOrSource ||
      sourceAlias(task.item, repository) === idOrSource,
  )
}

export function sourceKey(item: Item, repository: string) {
  if (item.source === "github" || item.source === "github-pr") {
    if (!/^[1-9]\d*$/.test(item.id)) throw new Error("GitHub source must have a positive issue or PR number")
    return `github:${repository.toLowerCase()}:${item.id}`
  }
  if (item.source === "lark") {
    if (!/^lark:oc_[\w-]+:om_[\w-]+$/.test(item.id)) throw new Error("Lark source must identify its chat and message")
    return item.id
  }
  return `audit:${item.id}`
}

export async function registerTask(directory: string, input: unknown) {
  const item = requireItem(input)
  return withStateLock(directory, async () => {
    const runtime = await readRuntime(directory)
    const native = await readNative(directory)
    const sources = indexSources(runtime.tasks, runtime.config.repository, native.sources)
    const key = sourceKey(item, runtime.config.repository)
    const existing = sources[key]
    if (existing) return runtime.tasks.find((task) => task.id === existing)!
    const task: Task = {
      id: `task-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`,
      item,
      status: "pending",
      phase: "implement",
      attempts: 0,
      updatedAt: new Date().toISOString(),
      reviewedSha: null,
    }
    if (runtime.tasks.some((entry) => entry.id === task.id))
      throw new Error("Task ID collision; reconcile before registering")
    saveNative(directory, { version: 1, sources: { ...sources, [key]: task.id }, tasks: [...native.tasks, task] })
    return task
  })
}

export async function saveTask(directory: string, input: unknown) {
  const task = requireTask(input)
  return withStateLock(directory, async () => {
    const runtime = await readRuntime(directory)
    const native = await readNative(directory)
    const sources = indexSources(runtime.tasks, runtime.config.repository, native.sources)
    const previous = runtime.tasks.find((entry) => entry.id === task.id)
    if (
      !previous ||
      sourceKey(previous.item, runtime.config.repository) !== sourceKey(task.item, runtime.config.repository)
    )
      throw new Error("Register the task source before saving its progress")
    if (previous.headSha !== task.headSha && task.reviewedSha !== null)
      throw new Error("Changed source head requires a new independent review")
    if (task.reviewedSha !== null && task.reviewedSha !== task.headSha)
      throw new Error("Reviewed SHA must match the task head")
    saveNative(directory, {
      version: 1,
      sources,
      tasks: [...native.tasks.filter((entry) => entry.id !== task.id), task],
    })
    return task
  })
}

async function readNative(directory: string): Promise<NativeState> {
  const file = Bun.file(path.join(directory, "native-state.json"))
  if (!(await file.exists())) return { version: 1, sources: {}, tasks: [] }
  const value: unknown = await file.json()
  if (
    !record(value) ||
    value.version !== 1 ||
    !record(value.sources) ||
    !Object.entries(value.sources).every(([key, id]) => Boolean(key) && typeof id === "string") ||
    !Array.isArray(value.tasks)
  )
    throw new Error("Invalid native maintenance state")
  return { version: 1, sources: value.sources as Record<string, string>, tasks: value.tasks.map(requireTask) }
}

function indexSources(tasks: Task[], repository: string, previous: Record<string, string>) {
  const sources = { ...previous }
  Object.entries(sources).forEach(([key, id]) => {
    if (!tasks.some((task) => task.id === id && sourceKey(task.item, repository) === key))
      throw new Error(`Source index points to a missing or different task: ${key}`)
  })
  tasks.forEach((task) => {
    const key = sourceKey(task.item, repository)
    // Legacy task IDs included updatedAt. Keep every record, but choose one
    // existing owner for a source so observing a new version cannot enqueue it.
    sources[key] ??= task.id
  })
  return sources
}

function sourceAlias(item: Item, repository: string) {
  if (item.source === "github" || item.source === "github-pr")
    return `github-${repository.toLowerCase().replace("/", "-")}-${item.id}`
  if (item.source === "lark") return `feishu-${item.id.split(":").at(-1)}`
  return sourceKey(item, repository)
}

async function withStateLock<T>(directory: string, operation: () => Promise<T>) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const lock = path.join(directory, "native-state.lock")
  closeSync(openSync(lock, "wx", 0o600))
  try {
    return await operation()
  } finally {
    rmSync(lock)
  }
}

function saveNative(directory: string, value: NativeState) {
  const temporary = path.join(directory, `.native-state-${randomUUID()}.json`)
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 })
  renameSync(temporary, path.join(directory, "native-state.json"))
}

function requireConfig(value: unknown): Config {
  const permissions = record(value) ? value.permissions : undefined
  const mergePolicy = record(value) ? value.mergePolicy : undefined
  if (
    !record(value) ||
    typeof value.repository !== "string" ||
    !/^[\w.-]+\/[\w.-]+$/.test(value.repository) ||
    typeof value.baseRef !== "string" ||
    !value.baseRef ||
    !record(value.lark) ||
    !["user", "bot"].includes(String(value.lark.identity)) ||
    (value.lark.sendIdentity !== undefined && !["user", "bot"].includes(String(value.lark.sendIdentity))) ||
    (value.lark.chatId !== undefined &&
      (typeof value.lark.chatId !== "string" || !/^oc_[\w-]+$/.test(value.lark.chatId))) ||
    !record(permissions) ||
    permissions.release !== false ||
    (permissions.releaseNightly !== undefined && typeof permissions.releaseNightly !== "boolean") ||
    (permissions.releaseStable !== undefined && permissions.releaseStable !== false) ||
    (mergePolicy !== undefined &&
      (!record(mergePolicy) ||
        !Array.isArray(mergePolicy.informationalWorkflows) ||
        mergePolicy.informationalWorkflows.some((name) => name !== "Claude Code Review"))) ||
    !["push", "createPullRequest", "postGithub", "postLark", "merge", "release"].every(
      (key) => typeof permissions[key] === "boolean",
    )
  )
    throw new Error("Invalid maintenance configuration; permissions must be explicit")
  return value as Config
}

function requireItem(value: unknown): Item {
  if (
    !record(value) ||
    !["github", "github-pr", "lark", "audit"].includes(String(value.source)) ||
    !["id", "title", "body", "url", "updatedAt"].every((key) => typeof value[key] === "string") ||
    !value.id
  )
    throw new Error("Invalid maintenance source")
  return value as Item
}

function requireTask(value: unknown): Task {
  if (!record(value) || typeof value.id !== "string" || !/^[\w-]{1,100}$/.test(value.id))
    throw new Error("Invalid maintenance task ID")
  const status = ["pending", "running", "review", "completed", "ignored", "needs_attention"].find(
    (entry) => entry === value.status,
  ) as Task["status"] | undefined
  if (
    !status ||
    !["implement", "review"].includes(String(value.phase)) ||
    typeof value.attempts !== "number" ||
    !Number.isInteger(value.attempts) ||
    value.attempts < 0 ||
    typeof value.updatedAt !== "string" ||
    ["baseSha", "headSha", "reviewedSha"].some(
      (key) =>
        value[key] !== undefined &&
        value[key] !== null &&
        (typeof value[key] !== "string" || !/^[a-f0-9]{40}$/.test(value[key])),
    ) ||
    (value.worktree !== undefined && typeof value.worktree !== "string") ||
    (value.result !== undefined && !record(value.result))
  )
    throw new Error(`Invalid maintenance task: ${value.id}`)
  return {
    ...value,
    id: value.id,
    item: requireItem(value.item),
    status,
    phase: value.phase as Task["phase"],
    attempts: value.attempts,
    updatedAt: value.updatedAt,
    reviewedSha: typeof value.reviewedSha === "string" ? value.reviewedSha : null,
  } as Task
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
