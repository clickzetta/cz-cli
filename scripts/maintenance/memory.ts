import { randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { readRuntime } from "./state"

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
  /** Legacy name from pinned-policy deployments; kept so historical resolutions stay readable. */
  policySha?: string
}

export async function recordMemory(directory: string, input: unknown) {
  const event = requireEvent(input)
  if (!(await readRuntime(directory)).tasks.some((task) => task.id === event.taskId))
    throw new Error("Register the task before recording its memory evidence")
  const file = path.join(directory, "memory", "events", `${event.id}.json`)
  const stored = await publish(file, event, requireEvent)
  return { ...stored.data, recordedAt: stored.recordedAt, file }
}

export async function pendingMemory(directory: string) {
  const events = path.join(directory, "memory", "events")
  const resolutions = path.join(directory, "memory", "resolutions")
  const resolutionNames = existsSync(resolutions)
    ? readdirSync(resolutions).filter((name) => name.endsWith(".json"))
    : []
  const names = existsSync(events)
    ? readdirSync(events)
        .filter((name) => name.endsWith(".json"))
        .sort()
    : []
  const resolved = new Set<string>()
  for (const name of resolutionNames) {
    requireId(name.slice(0, -5))
    if (!names.includes(name)) throw new Error(`Memory resolution has no event: ${name}`)
    await read(path.join(resolutions, name), requireResolution)
    resolved.add(name)
  }
  const pending = []
  for (const name of names) {
    const file = path.join(events, name)
    const event = await read(file, requireEvent)
    if (`${event.data.id}.json` !== name) throw new Error(`Memory event filename does not match its ID: ${name}`)
    if (resolved.has(name)) continue
    pending.push({
      id: event.data.id,
      taskId: event.data.taskId,
      kind: event.data.kind,
      summary: event.data.summary,
      memoryRefs: event.data.memoryRefs,
      recordedAt: event.recordedAt,
      file,
    })
  }
  return { pendingCount: pending.length, pending }
}

export async function resolveMemory(directory: string, id: string, input: unknown) {
  requireId(id)
  const resolution = requireResolution(input)
  if (resolution.policySha !== undefined)
    throw new Error("New resolutions record the merged main commit as `commit`; policySha is read-only history")
  const event = await read(path.join(directory, "memory", "events", `${id}.json`), requireEvent)
  if (event.data.id !== id) throw new Error("Memory event filename does not match its ID")
  const file = path.join(directory, "memory", "resolutions", `${id}.json`)
  if (existsSync(file)) {
    const stored = await read(file, requireResolution)
    if (JSON.stringify(stored.data) !== JSON.stringify(resolution))
      throw new Error("Conflicting memory record; preserve the old resolution and record new evidence separately")
    return { id, ...stored.data, recordedAt: stored.recordedAt, file }
  }
  if (resolution.disposition === "integrated") {
    // Memory is live once its commit is on main: every loop syncs the control checkout to origin/main.
    const child = Bun.spawn(
      [
        "git",
        "--git-dir",
        path.dirname(directory),
        "merge-base",
        "--is-ancestor",
        resolution.commit!,
        "refs/remotes/origin/main",
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
    if (exitCode === 1) throw new Error("Integrated memory commit is not on origin/main; merge it and run sync first")
    if (exitCode !== 0) throw new Error(`Cannot verify the memory commit against origin/main: ${stderr.trim()}`)
  }
  const stored = await publish(file, resolution, requireResolution)
  return { id, ...stored.data, recordedAt: stored.recordedAt, file }
}

async function read<T>(file: string, parse: (input: unknown) => T) {
  const value: unknown = await Bun.file(file).json()
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(value.recordedAt))
  )
    throw new Error(`Invalid memory record: ${file}`)
  return { version: 1, recordedAt: value.recordedAt, data: parse(value.data) }
}

async function publish<T>(file: string, data: T, parse: (input: unknown) => T) {
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
    // Publishing the complete file with link is atomic and cannot replace another writer's record.
    linkSync(temporary, file)
  } catch (error) {
    if (!record(error) || error.code !== "EEXIST") throw error
  } finally {
    rmSync(temporary)
  }
  const stored = await read(file, parse)
  if (JSON.stringify(stored.data) !== JSON.stringify(data))
    throw new Error(`Conflicting memory record: ${file}; preserve the old record and use a new evidence ID`)
  return stored
}

function requireEvent(input: unknown): MemoryEvent {
  if (
    !record(input) ||
    !Object.keys(input).every((key) => ["id", "taskId", "kind", "summary", "evidence", "memoryRefs"].includes(key)) ||
    typeof input.id !== "string" ||
    typeof input.taskId !== "string" ||
    !input.taskId.trim() ||
    typeof input.kind !== "string" ||
    !["lesson", "correction", "usage"].includes(input.kind) ||
    typeof input.summary !== "string" ||
    !input.summary.trim() ||
    !strings(input.evidence) ||
    !input.evidence.length ||
    !strings(input.memoryRefs)
  )
    throw new Error(
      "Memory event requires id, registered taskId, kind (lesson/correction/usage), summary, evidence and memoryRefs",
    )
  requireId(input.id)
  return {
    id: input.id,
    taskId: input.taskId,
    kind: input.kind as MemoryEvent["kind"],
    summary: input.summary,
    evidence: input.evidence,
    memoryRefs: input.memoryRefs,
  }
}

function requireResolution(input: unknown): MemoryResolution {
  if (
    !record(input) ||
    !Object.keys(input).every((key) =>
      ["disposition", "reason", "evidence", "memoryRefs", "commit", "policySha"].includes(key),
    ) ||
    typeof input.disposition !== "string" ||
    !["integrated", "duplicate", "no-change"].includes(input.disposition) ||
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    !strings(input.evidence) ||
    !input.evidence.length ||
    (input.memoryRefs !== undefined && !strings(input.memoryRefs)) ||
    [input.commit, input.policySha].some(
      (sha) => sha !== undefined && (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha)),
    ) ||
    (input.commit !== undefined && input.policySha !== undefined) ||
    (input.disposition === "integrated" &&
      ((input.commit ?? input.policySha) === undefined || !strings(input.memoryRefs) || !input.memoryRefs.length))
  )
    throw new Error(
      "Memory resolution requires disposition, reason and evidence; integrated also requires commit and memoryRefs",
    )
  return {
    disposition: input.disposition as MemoryResolution["disposition"],
    reason: input.reason,
    evidence: input.evidence,
    memoryRefs: strings(input.memoryRefs) ? input.memoryRefs : [],
    ...(typeof input.commit === "string" ? { commit: input.commit } : {}),
    ...(typeof input.policySha === "string" ? { policySha: input.policySha } : {}),
  }
}

function requireId(id: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id))
    throw new Error("Memory ID must be 1–128 letters, digits, underscores or hyphens")
}

function strings(input: unknown): input is string[] {
  return Array.isArray(input) && input.every((value) => typeof value === "string" && Boolean(value.trim()))
}

function record(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
}
