const RUN_ID_KEYS = [
  "run_id", "task_run_id", "task_instance_id",
  "taskInstanceId", "id", "backfill_task_id", "complementTaskId",
] as const

const TASK_ID_KEYS = [
  "task_id", "schedule_task_id", "scheduleTaskId",
] as const

const TASK_NAME_KEYS = [
  "task_name", "taskName", "cycle_task_name", "cycleTaskName",
] as const

type Dict = Record<string, unknown>

function asInt(value: unknown): number | undefined {
  if (value == null || typeof value === "boolean") return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  // Reject float strings like "3.7" (Python's int("3.7") raises ValueError)
  if (typeof value === "string" && String(n) !== value.trim()) return undefined
  return Math.trunc(n)
}

function first(source: Dict, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = source[k]
    if (v != null) return v
  }
  return undefined
}

function pickInt(sources: Dict[], keys: readonly string[]): number | undefined {
  for (const src of sources) {
    const v = asInt(first(src, keys))
    if (v !== undefined) return v
  }
  return undefined
}

function pickStr(sources: Dict[], keys: readonly string[]): string | undefined {
  for (const src of sources) {
    const v = first(src, keys)
    if (v != null) {
      const s = String(v).trim()
      if (s) return s
    }
  }
  return undefined
}

export function normalizeRunIdentity(
  payload: Dict,
  ...extraSources: (Dict | null | undefined)[]
): Dict {
  const normalized = { ...payload }
  const sources = [payload, ...extraSources.filter((s): s is Dict => s != null && typeof s === "object")]

  let runId = pickInt(sources, RUN_ID_KEYS)
  if (runId === undefined) {
    // Check if any extra source has a direct fallback_run_id or run_id value
    for (const src of sources) {
      if (src.fallback_run_id != null) {
        runId = asInt(src.fallback_run_id)
        break
      }
    }
  }
  if (runId !== undefined) normalized.run_id = runId

  const taskId = pickInt(sources, TASK_ID_KEYS)
  if (taskId !== undefined) normalized.task_id = taskId

  const taskName = pickStr(sources, TASK_NAME_KEYS)
  if (taskName !== undefined) normalized.task_name = taskName

  return normalized
}

export function normalizeRunIdentityList(items: Dict[]): Dict[] {
  return items.map((item) => normalizeRunIdentity(item))
}

export function normalizeTaskIdentity(
  payload: Dict,
  ...extraSources: (Dict | null | undefined)[]
): Dict {
  const normalized = { ...payload }
  const sources = [payload, ...extraSources.filter((s): s is Dict => s != null && typeof s === "object")]

  let taskId = pickInt(sources, TASK_ID_KEYS)
  if (taskId === undefined) {
    for (const src of sources) {
      if (src.fallback_task_id != null) {
        taskId = asInt(src.fallback_task_id)
        break
      }
    }
  }
  if (taskId !== undefined) normalized.task_id = taskId

  const taskName = pickStr(sources, TASK_NAME_KEYS)
  if (taskName !== undefined) normalized.task_name = taskName

  return normalized
}
