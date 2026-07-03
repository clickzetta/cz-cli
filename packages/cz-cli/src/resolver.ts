import {
  listTasks, listRuns, getRunDetail, getFlowDag, listFolders,
  type StudioConfig,
} from "@clickzetta/sdk"
import { error, handledError } from "./output/index.js"

function fail(code: string, message: string, format: string): never {
  handledError(code, message, { format })
}

const DEFAULT_RUN_TYPES = [1, 3, 4]

const TIMESTAMP_KEYS = [
  "execute_start_time", "executeStartTime",
  "trigger_time", "triggerTime",
  "plan_trigger_time", "planTriggerTime",
  "created_time", "createdTime",
  "task_run_id", "taskInstanceId", "task_instance_id",
]

function pickTimestamp(item: Record<string, unknown>): number {
  for (const k of TIMESTAMP_KEYS) {
    const v = item[k]
    if (v != null) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return 0
}

function pickRunId(item: Record<string, unknown>): number {
  for (const k of ["task_run_id", "taskInstanceId", "task_instance_id", "id"]) {
    const v = item[k]
    if (v != null) {
      const n = Number(v)
      if (Number.isFinite(n)) return Math.trunc(n)
    }
  }
  return 0
}

export async function resolveTaskId(
  sc: StudioConfig,
  nameOrId: string,
  format: string,
): Promise<number> {
  const raw = nameOrId.trim()
  if (!raw) fail("USAGE_ERROR", "Task name or ID is required.", format)
  if (/^\d+$/.test(raw)) return parseInt(raw, 10)

  const resp = await listTasks(sc, {
    projectId: sc.projectId,
    fileName: raw,
    page: 1,
    pageSize: 100,
  })

  const data = resp.data as Record<string, unknown> | undefined
  const tasks = (Array.isArray(data) ? data : (data?.list ?? data?.data ?? [])) as Record<string, unknown>[]
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return fail("TASK_NOT_FOUND", `No task found matching '${raw}'.`, format)
  }

  const exact = tasks.filter((t) => t.task_name === raw || t.taskName === raw || t.fileName === raw || t.dataFileName === raw)
  if (exact.length === 1) return Number(exact[0].task_id ?? exact[0].id ?? exact[0].fileId)
  if (exact.length > 1) {
    const candidates = exact.slice(0, 10).map((t) => `${t.task_id ?? t.id}: ${t.task_name ?? t.taskName}`).join(", ")
    return fail("TASK_AMBIGUOUS", `Multiple tasks match '${raw}': ${candidates}`, format)
  }
  if (tasks.length === 1) return Number(tasks[0].task_id ?? tasks[0].id ?? tasks[0].fileId)

  const candidates = tasks.slice(0, 10).map((t) => `${t.task_id ?? t.id}: ${t.task_name ?? t.taskName}`).join(", ")
  return fail("TASK_AMBIGUOUS", `Multiple tasks match '${raw}': ${candidates}`, format)
}

async function resolveTaskIdsForRunLookup(
  sc: StudioConfig,
  taskName: string,
  format: string,
): Promise<number[]> {
  const resp = await listTasks(sc, {
    projectId: sc.projectId,
    fileName: taskName,
    page: 1,
    pageSize: 100,
  })

  const data = resp.data as Record<string, unknown> | undefined
  const tasks = (Array.isArray(data) ? data : (data?.list ?? data?.data ?? [])) as Record<string, unknown>[]
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return fail("TASK_NOT_FOUND", `No task found matching '${taskName}'.`, format)
  }

  const exact = tasks.filter((t) => t.task_name === taskName || t.taskName === taskName || t.fileName === taskName || t.dataFileName === taskName)
  if (exact.length > 0) return exact.map((t) => Number(t.task_id ?? t.id ?? t.fileId))
  if (tasks.length === 1) return [Number(tasks[0].task_id ?? tasks[0].id ?? tasks[0].fileId)]

  const candidates = tasks.slice(0, 10).map((t) => `${t.task_id ?? t.id}: ${t.task_name ?? t.taskName}`).join(", ")
  return fail("TASK_AMBIGUOUS", `Multiple tasks match '${taskName}': ${candidates}`, format)
}

export async function resolveLatestRunId(
  sc: StudioConfig,
  format: string,
  opts?: {
    taskId?: number
    runTypes?: number[]
    days?: number
    failIfEmpty?: boolean
    emptyMessage?: string
  },
): Promise<number | undefined> {
  const runTypes = opts?.runTypes ?? DEFAULT_RUN_TYPES
  const days = opts?.days ?? 365
  const failIfEmpty = opts?.failIfEmpty ?? true

  const now = Date.now()
  const leftMs = now - days * 86400_000
  const rightMs = now

  const candidates: Record<string, unknown>[] = []
  for (const runType of runTypes) {
    try {
      const resp = await listRuns(sc, {
        projectId: sc.projectId,
        pageIndex: 1,
        pageSize: 1,
        cycleTaskType: String(runType),
        queryStartPlanTime: String(leftMs),
        queryEndPlanTime: String(rightMs),
        ...(opts?.taskId !== undefined && { scheduleTaskId: opts.taskId }),
      })
      const data = resp.data as Record<string, unknown> | undefined
      const items = (Array.isArray(data) ? data : (data?.taskRunList ?? data?.task_run_list ?? data?.data ?? data?.tasks ?? [])) as Record<string, unknown>[]
      if (Array.isArray(items) && items.length > 0) candidates.push(items[0])
    } catch {
      // skip failed run type queries
    }
  }

  if (candidates.length === 0) {
    if (failIfEmpty) error("RUN_NOT_FOUND", opts?.emptyMessage ?? "No run instances found.", { format })
    return undefined
  }

  candidates.sort((a, b) => pickTimestamp(b) - pickTimestamp(a))
  return pickRunId(candidates[0])
}

export async function resolveRunIdOrTaskName(
  sc: StudioConfig,
  runIdOrTaskName: string,
  format: string,
): Promise<number> {
  const raw = runIdOrTaskName.trim()
  if (!raw) fail("USAGE_ERROR", "Run ID or task name is required.", format)
  if (/^\d+$/.test(raw)) return parseInt(raw, 10)

  const taskIds = await resolveTaskIdsForRunLookup(sc, raw, format)

  if (taskIds.length === 1) {
    const runId = await resolveLatestRunId(sc, format, { taskId: taskIds[0] })
    if (runId === undefined) fail("RUN_NOT_FOUND", `No run instances found for task '${raw}'.`, format)
    return runId
  }

  const results: { ts: number; runId: number }[] = []
  for (const taskId of taskIds) {
    const runId = await resolveLatestRunId(sc, format, { taskId, failIfEmpty: false })
    if (runId === undefined) continue
    try {
      const detail = await getRunDetail(sc, runId)
      const d = detail.data as Record<string, unknown> | undefined
      const ts = d ? pickTimestamp(d) : 0
      results.push({ ts, runId })
    } catch {
      results.push({ ts: 0, runId })
    }
  }

  if (results.length === 0) fail("RUN_NOT_FOUND", `No run instances found for task '${raw}'.`, format)
  results.sort((a, b) => b.ts - a.ts)
  return results[0].runId
}

export async function resolveFolderIdByName(
  sc: StudioConfig,
  name: string,
  format: string,
): Promise<number> {
  const segments = name.split("/").map((segment) => segment.trim()).filter(Boolean)
  if (segments.length === 0) return fail("FOLDER_NOT_FOUND", `Folder '${name}' not found.`, format)

  let parentFolderId = 0
  for (const segment of segments) {
    const folderId = await findFolderIdByName(sc, segment, parentFolderId)
    if (folderId == null) return fail("FOLDER_NOT_FOUND", `Folder '${name}' not found.`, format)
    parentFolderId = folderId
  }
  return parentFolderId
}

async function findFolderIdByName(
  sc: StudioConfig,
  name: string,
  parentFolderId: number,
): Promise<number | undefined> {
  let page = 1
  const pageSize = 50
  while (true) {
    const resp = await listFolders(sc, {
      projectId: sc.projectId,
      parentFolderId,
      page,
      pageSize,
    })
    const data = resp.data as Record<string, unknown> | undefined
    const items = (Array.isArray(data) ? data : (data?.list ?? [])) as Record<string, unknown>[]
    if (Array.isArray(items)) {
      const match = items.find((f) => f.dataFolderName === name || f.folderName === name || f.name === name)
      if (match) return Number(match.id ?? match.dataFolderId ?? match.folderId)
    }
    const totalPages = Number(data?.totalPages ?? 1)
    if (page >= totalPages) break
    page++
  }
  return undefined
}

export async function resolveNodeId(
  sc: StudioConfig,
  taskId: number,
  nodeName: string,
  format: string,
): Promise<number> {
  const resp = await getFlowDag(sc, taskId)
  const data = resp.data as Record<string, unknown> | unknown[] | undefined

  let nodes: Record<string, unknown>[] = []
  if (Array.isArray(data)) {
    nodes = data as Record<string, unknown>[]
  } else if (data && typeof data === "object") {
    const inner = (data as Record<string, unknown>).nodes ?? (data as Record<string, unknown>).data
    if (Array.isArray(inner)) nodes = inner as Record<string, unknown>[]
    else if (inner && typeof inner === "object") {
      const deeper = (inner as Record<string, unknown>).nodes
      if (Array.isArray(deeper)) nodes = deeper as Record<string, unknown>[]
    }
  }

  const matches = nodes.filter((n) => String(n.fileName) === nodeName)
  if (matches.length === 0) {
    const names = nodes.map((n) => `${String(n.fileName ?? "?")} (id=${n.id})`).join(", ")
    return fail("NODE_NOT_FOUND", `Node '${nodeName}' not found in flow ${taskId}. Available nodes: ${names || "(none)"}`, format)
  }
  if (matches.length > 1) {
    const ids = matches.map((n) => n.id).join(", ")
    process.stderr.write(`⚠️  Multiple nodes named '${nodeName}' found (ids: ${ids}) in flow ${taskId}. Using the first match (id=${matches[0].id}). Use --node-id <number> to disambiguate.\n`)
  }
  return Number(matches[0].id)
}
