import { randomUUID } from "node:crypto"
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { readRuntime } from "./state"

// Memory itself is the Markdown under docs/maintenance/memory. This file is only the queue between
// Feedback (records evidenced events) and Reflection (resolves them after updating the docs).
// One JSON file per event in memory/events, one per decision in memory/resolutions; never overwritten.

export type MemoryEvent = {
  id: string
  taskId: string
  kind: "lesson" | "correction" | "usage"
  summary: string
  evidence: string[]
  memoryRefs: string[]
}

export type MemoryResolution = {
  disposition: "integrated" | "duplicate" | "no-change"
  reason: string
  evidence: string[]
  memoryRefs: string[]
  commit?: string
}

export async function recordMemory(directory: string, input: unknown) {
  const event = requireEvent(input)
  if (!(await readRuntime(directory)).tasks.some((task) => task.id === event.taskId))
    throw new Error("Register the task before recording its memory evidence")
  const file = path.join(directory, "memory", "events", `${event.id}.json`)
  return { ...(await publish(file, event)), file }
}

export async function pendingMemory(directory: string) {
  const names = list(path.join(directory, "memory", "events"))
  const resolved = list(path.join(directory, "memory", "resolutions"))
  // A malformed or orphan resolution must fail loudly instead of hiding an unprocessed event.
  for (const name of resolved) {
    if (!names.includes(name)) throw new Error(`Memory resolution has no event: ${name}`)
    requireResolution((await read(path.join(directory, "memory", "resolutions", name))).data)
  }
  const pending = []
  for (const name of names) {
    const file = path.join(directory, "memory", "events", name)
    const stored = await read(file)
    const event = requireEvent(stored.data)
    if (`${event.id}.json` !== name) throw new Error(`Memory event filename does not match its ID: ${name}`)
    if (resolved.includes(name)) continue
    pending.push({
      id: event.id,
      taskId: event.taskId,
      kind: event.kind,
      summary: event.summary,
      memoryRefs: event.memoryRefs,
      recordedAt: stored.recordedAt,
      file,
    })
  }
  return { pendingCount: pending.length, pending }
}

export async function resolveMemory(directory: string, id: string, input: unknown) {
  requireId(id)
  const resolution = requireResolution(input)
  if (requireEvent((await read(path.join(directory, "memory", "events", `${id}.json`))).data).id !== id)
    throw new Error("Memory event filename does not match its ID")
  const file = path.join(directory, "memory", "resolutions", `${id}.json`)
  // Memory is live once its commit is on main: every loop syncs the control checkout to origin/main.
  if (resolution.disposition === "integrated" && !existsSync(file)) await requireOnMain(directory, resolution.commit!)
  return { id, ...(await publish(file, resolution)), file }
}

function list(directory: string) {
  return existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".json")).sort() : []
}

async function read(file: string) {
  const value: unknown = await Bun.file(file).json()
  if (!record(value) || value.version !== 1 || !Number.isFinite(Date.parse(String(value.recordedAt))))
    throw new Error(`Invalid memory record: ${file}`)
  return { recordedAt: String(value.recordedAt), data: value.data }
}

// Write to a temp file, then link it into place: atomic, and never replaces another writer's record.
// An identical existing record is an idempotent retry; a different one is a conflict.
async function publish<T extends object>(file: string, data: T) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = path.join(path.dirname(file), `.memory-${randomUUID()}.tmp`)
  const handle = openSync(temporary, "wx", 0o600)
  try {
    writeFileSync(handle, `${JSON.stringify({ version: 1, recordedAt: new Date().toISOString(), data }, null, 2)}\n`)
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
  try {
    linkSync(temporary, file)
  } catch (error) {
    if (!record(error) || error.code !== "EEXIST") throw error
  } finally {
    rmSync(temporary)
  }
  const stored = await read(file)
  if (JSON.stringify(stored.data) !== JSON.stringify(data))
    throw new Error(`Conflicting memory record: ${file}; preserve the old record and use a new evidence ID`)
  return { ...data, recordedAt: stored.recordedAt }
}

async function requireOnMain(directory: string, commit: string) {
  const child = Bun.spawn(
    ["git", "--git-dir", path.dirname(directory), "merge-base", "--is-ancestor", commit, "refs/remotes/origin/main"],
    { stdout: "pipe", stderr: "pipe" },
  )
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (exitCode === 1) throw new Error("Integrated memory commit is not on origin/main; merge it and run sync first")
  if (exitCode !== 0) throw new Error(`Cannot verify the memory commit against origin/main: ${stderr.trim()}`)
}

function requireEvent(input: unknown): MemoryEvent {
  if (
    !only(input, ["id", "taskId", "kind", "summary", "evidence", "memoryRefs"]) ||
    !text(input.id) ||
    !text(input.taskId) ||
    !["lesson", "correction", "usage"].includes(String(typeof input.kind === "string" && input.kind)) ||
    !text(input.summary) ||
    !strings(input.evidence) ||
    !input.evidence.length ||
    !strings(input.memoryRefs)
  )
    throw new Error(
      "Memory event requires id, registered taskId, kind (lesson/correction/usage), summary, evidence and memoryRefs",
    )
  requireId(input.id)
  const event = input as MemoryEvent
  return {
    id: event.id,
    taskId: event.taskId,
    kind: event.kind,
    summary: event.summary,
    evidence: event.evidence,
    memoryRefs: event.memoryRefs,
  }
}

function requireResolution(input: unknown): MemoryResolution {
  if (
    !only(input, ["disposition", "reason", "evidence", "memoryRefs", "commit"]) ||
    !["integrated", "duplicate", "no-change"].includes(String(typeof input.disposition === "string" && input.disposition)) ||
    !text(input.reason) ||
    !strings(input.evidence) ||
    !input.evidence.length ||
    (input.memoryRefs !== undefined && !strings(input.memoryRefs)) ||
    (input.commit !== undefined && !/^[a-f0-9]{40}$/.test(String(input.commit))) ||
    (input.disposition === "integrated" &&
      (input.commit === undefined || !strings(input.memoryRefs) || !input.memoryRefs.length))
  )
    throw new Error(
      "Memory resolution requires disposition, reason and evidence; integrated also requires commit and memoryRefs",
    )
  const resolution = input as MemoryResolution
  return {
    disposition: resolution.disposition,
    reason: resolution.reason,
    evidence: resolution.evidence,
    memoryRefs: resolution.memoryRefs ?? [],
    ...(resolution.commit ? { commit: resolution.commit } : {}),
  }
}

function requireId(id: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id))
    throw new Error("Memory ID must be 1–128 letters, digits, underscores or hyphens")
}

function only(input: unknown, keys: string[]): input is Record<string, unknown> {
  return record(input) && Object.keys(input).every((key) => keys.includes(key))
}

function text(input: unknown): input is string {
  return typeof input === "string" && Boolean(input.trim())
}

function strings(input: unknown): input is string[] {
  return Array.isArray(input) && input.every(text)
}

function record(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
}
