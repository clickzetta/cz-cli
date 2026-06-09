export type JobProfileRow = {
  key: string
  value: string
}

type BuildJobProfileRowsInput = {
  jobId: string
  workspaceName: string
  instanceId: string | number
  currentUserName?: string
  jobProfile: unknown
}

const fieldKeys = [
  "status",
  "duration",
  "duration_timeline",
  "start_time",
  "end_time",
  "cluster",
  "owner",
  "input_records",
  "output_records",
  "cache_read",
  "incremental_processing",
  "small_file_merge",
  "cru_cost",
  "task_instance",
  "materialized_view_acceleration",
  "query_tag",
  "sql_hints",
  "job_content",
] as const

const durationStageLabels = {
  setup: "Initialization",
  resuming_cluster: "Cluster Starting",
  queued: "Waiting Execution",
  running: "Running",
  compaction: "Output File Merge",
  finish: "Completed",
} as const

const durationStageOrder = [
  "setup",
  "resuming_cluster",
  "queued",
  "running",
  "compaction",
  "finish",
] as const

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function dataRoot(value: unknown): Record<string, unknown> {
  const root = record(value)
  const data = record(root.data)
  return Object.keys(data).length > 0 ? data : root
}

function pick(source: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key]
  }
  return null
}

function list(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown>[] {
  const value = pick(source, keys)
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : []
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "object") return null
  return String(value)
}

function pageTime(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  if (raw === "0") return null
  if (!/^\d{13}$/.test(raw)) return raw
  const date = new Date(Number(raw))
  if (Number.isNaN(date.getTime())) return raw
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false,
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ""
  return `${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")}:${part("second")}.${part("fractionalSecond")}`
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "")
}

function durationText(value: unknown): string {
  const numeric = typeof value === "number" ? value : numberValue(value)
  if (numeric === null) return ""
  if (numeric >= 1000 * 60 * 60) return `${trimDecimal(numeric / (1000 * 60 * 60))}h`
  if (numeric >= 1000 * 60) return `${trimDecimal(numeric / (1000 * 60))}min`
  if (numeric >= 1000) return `${trimDecimal(numeric / 1000)}s`
  return `${numeric}ms`
}

function numberValue(value: unknown): number | null {
  const raw = text(value)
  if (!raw) return null
  const numeric = Number(raw)
  return Number.isFinite(numeric) ? numeric : null
}

function isValidTimestamp(value: unknown): boolean {
  const raw = text(value)
  return ![null, "", "0"].includes(raw)
}

function bytes(value: unknown): string {
  const raw = text(value)
  return raw ? `${raw} Byte` : ""
}

function rowByte(row: unknown, byte: unknown): string {
  const rowText = text(row)
  const byteText = text(byte)
  if (!rowText && !byteText) return ""
  return `${rowText ?? "0"} rows / ${byteText ?? "0"} Byte`
}

function normalizeRecordCount(value: unknown): string {
  const raw = text(value)
  if (!raw) return ""
  const normalized = raw
    .replace(/行/g, " rows")
    .replace(/\s*rows\s*\/\s*/g, " rows / ")
  return normalized
}

function queryText(profile: Record<string, unknown>): string {
  const sqlJob = record(record(profile.jobDesc).sqlJob)
  const query = sqlJob.query
  if (Array.isArray(query)) return query.map(text).filter((line): line is string => !!line).join("\n")
  return text(pick(profile, ["sql", "query", "queryText", "statement"])) ?? ""
}

function normalizeIoRows(profile: Record<string, unknown>) {
  return list(profile, ["ioRecords", "io_records", "tables", "tableRecords"]).map((item) => ({
    table_name: text(pick(item, ["tableName", "table_name", "name"])) ?? "",
    type: text(pick(item, ["type", "recordType", "ioType"])) ?? "",
    record_count: normalizeRecordCount(pick(item, ["recordCount", "records", "inputOutputRecord"])),
    cache_read: text(pick(item, ["cacheRead", "cacheBytes", "cache_read"])) ?? "",
  }))
}

function ioRecordRows(profile: Record<string, unknown>): JobProfileRow[] {
  return normalizeIoRows(profile).flatMap((item, index) => {
    const prefix = `io_record_${index + 1}`
    return [
      { key: `${prefix}_table_name`, value: item.table_name },
      { key: `${prefix}_type`, value: item.type },
      { key: `${prefix}_record_count`, value: item.record_count },
      { key: `${prefix}_cache_read`, value: item.cache_read },
    ]
  })
}

function isEndedState(state: string) {
  return ["SUCCEED", "SUCCEEDED", "FAILED", "CANCELLED", "succeed", "failed", "cancelled"].includes(state)
}

function isSucceededState(state: string) {
  return ["SUCCEED", "SUCCEEDED", "succeed", "success"].includes(state)
}

function isFailedOrCancelledState(state: string) {
  return ["FAILED", "CANCELLED", "failed", "cancelled"].includes(state)
}

function durationStageKey(value: unknown): keyof typeof durationStageLabels | null {
  if (typeof value === "number" && durationStageOrder[value]) return durationStageOrder[value]
  const raw = text(value)?.toLowerCase()
  if (!raw) return null
  if (/^\d+$/.test(raw)) {
    const index = Number(raw)
    return durationStageOrder[index] ?? null
  }
  const normalized = raw.replace(/[\s-]+/g, "_")
  if (normalized in durationStageLabels) return normalized as keyof typeof durationStageLabels
  return null
}

function pageDurationTotalMs(profile: Record<string, unknown>): number | null {
  const status = record(profile.jobStatus)
  const submitTime = text(status.submitTime)
  const startTime = text(status.startTime)
  const runningTime = numberValue(status.runningTime)
  if (!submitTime || !startTime || [submitTime, startTime].includes("0")) return runningTime
  const state = text(status.state) ?? ""
  const endTime = text(status.endTime)
  if (isFailedOrCancelledState(state) && (!endTime || endTime === "0")) return runningTime
  const submitMs = numberValue(status.submitTime)
  const endMs = numberValue(status.endTime)
  const currentMs = numberValue(profile.currentMs)
  const endTimeT = endMs && endMs !== 0 ? endMs : currentMs
  if (submitMs === null || endTimeT === null) return runningTime
  return endTimeT - submitMs
}

function durationTimelineFromStageDuration(stageDuration: Record<string, unknown>[], totalMs: number) {
  const stages = stageDuration
    .flatMap((item) => {
      const key = durationStageKey(item.n)
      const ms = numberValue(item.ms)
      if (!key || ms === null) return []
      return [{ key, label: durationStageLabels[key], duration: durationText(ms) }]
    })
  if (stages.length === 0) return ""
  return JSON.stringify({ total: durationText(totalMs), stages })
}

function durationTimelineFromProfiling(profile: Record<string, unknown>): string {
  const totalMs = pageDurationTotalMs(profile)
  if (totalMs === null) return ""
  const status = record(profile.jobStatus)
  const profiling = list(record(status.jobProfiling), ["profiling"])
  if (profiling.length === 0) return ""
  const profilingMap = Object.fromEntries(
    profiling
      .map((item) => {
        const event = numberValue(item.e)
        const timestamp = numberValue(
          event === 100
            ? isValidTimestamp(status.submitTime) ? status.submitTime : item.t
            : event === 150
              ? isValidTimestamp(status.endTime) ? status.endTime : isValidTimestamp(profile.currentMs) ? profile.currentMs : item.t
              : item.t,
        )
        return event === null || timestamp === null ? null : [event, timestamp]
      })
      .filter((item): item is [number, number] => item !== null),
  )
  const state = text(status.state) ?? ""
  const endMs = numberValue(status.endTime)
  const currentMs = numberValue(profile.currentMs)
  const curTime = endMs && endMs !== 0 ? endMs : currentMs
  if (curTime === null) return ""
  const has111TimePoint = !!profilingMap[111]
  const has132TimePoint = !!profilingMap[132]
  const getStepRunningStartCode = () => {
    if (!isEndedState(state)) return 120
    if (profilingMap[120]) return 120
    if (profilingMap[112]) return 112
    return 110
  }
  const list2 = [
    {
      startCode: 100,
      endCode: 108,
      codes: [100, 101, 102, 105, 106, 108],
      key: "setup",
      label: durationStageLabels.setup,
    },
    {
      startCode: 110,
      endCode: has111TimePoint ? 111 : 112,
      codes: [110, has111TimePoint ? 111 : 112],
      key: "resuming_cluster",
      label: durationStageLabels.resuming_cluster,
    },
    {
      startCode: has111TimePoint ? 111 : 112,
      endCode: 120,
      codes: [has111TimePoint ? 111 : 112, 120],
      key: "queued",
      label: durationStageLabels.queued,
    },
    ...(has132TimePoint
      ? [
          {
            startCode: getStepRunningStartCode(),
            endCode: 132,
            codes: [getStepRunningStartCode(), 132],
            key: "running",
            label: durationStageLabels.running,
          },
          {
            startCode: 132,
            endCode: 140,
            codes: [132, 135, 140],
            key: "compaction",
            label: durationStageLabels.compaction,
          },
        ]
      : [
          {
            startCode: getStepRunningStartCode(),
            endCode: 140,
            codes: [getStepRunningStartCode(), 130, 135, 140],
            key: "running",
            label: durationStageLabels.running,
          },
        ]),
    {
      startCode: 140,
      endCode: 150,
      codes: [140, 150],
      key: "finish",
      label: durationStageLabels.finish,
    },
  ]
    .map((item) => ({ ...item, codes: item.codes.filter((code) => !!profilingMap[code]) }))
    .filter((item) => {
      if (isSucceededState(state)) return !!item.codes.length && !!profilingMap[item.startCode] && !!profilingMap[item.endCode]
      return !!item.codes.length && !!profilingMap[item.startCode]
    })

  const stages = list2.flatMap((item, index) => {
    const curStartTime = profilingMap[item.startCode]
    if (!curStartTime) return []
    const nextItem = list2[index + 1]
    const curEndTime = profilingMap[150]
      ? nextItem ? profilingMap[nextItem.codes[0]!] : profilingMap[150]
      : nextItem ? profilingMap[nextItem.codes[0]!] : curTime
    if (curEndTime === undefined) return []
    return [{ key: item.key, label: item.label, duration: durationText(curEndTime - curStartTime) }]
  })
  if (stages.length === 0) return ""
  return JSON.stringify({
    total: durationText(totalMs),
    stages,
  })
}

function durationTimeline(profile: Record<string, unknown>): string {
  const stageDuration = list(record(record(profile.jobStatus).jobProfiling), ["stageDuration"])
  const totalMs = pageDurationTotalMs(profile)
  if (totalMs === null) return ""
  return durationTimelineFromStageDuration(stageDuration, totalMs) || durationTimelineFromProfiling(profile)
}

function cruCost(profile: Record<string, unknown>): string {
  const measurements = record(record(profile.jobSummary).meter).measurements
  const measurement = Array.isArray(measurements)
    ? measurements
      .map(record)
      .find((item) => text(item.key) === "cpu_wall_time" && text(item.unit) === "cru")
    : undefined
  const value = text(measurement?.value)
  if (!value) return ""
  return Number(value) < 0.01 ? "< 0.01 CRU*h" : `${value} CRU*h`
}

function incrementalProcessing(profile: Record<string, unknown>): string {
  const incremental = record(record(profile.jobMetaLite).incrementalProperty)
  const value = pick(incremental, ["incrementalProcessing", "incremental", "isIncrementalPlan"])
  if (typeof value === "boolean") return value ? "Yes" : "No"
  const raw = text(value)
  if (!raw) return isEndedState(text(record(profile.jobStatus).state) ?? "") ? "No" : ""
  if (raw === "0" || raw === "false") return "No"
  return "Yes"
}

function smallFileMerge(profile: Record<string, unknown>): string {
  const incremental = record(record(profile.jobMetaLite).incrementalProperty)
  const value = text(pick(incremental, ["smallFileMerge", "small_file_merge", "smallFileMergeType"]))
  if (value) return value
  const stageDuration = list(record(record(profile.jobStatus).jobProfiling), ["stageDuration"])
  if (stageDuration.length > 0) {
    const hasCompaction = stageDuration.some((item) => durationStageKey(item.n) === "compaction")
    const hasFinish = stageDuration.some((item) => durationStageKey(item.n) === "finish")
    if (hasCompaction && !hasFinish) return "Running"
    if (hasCompaction && hasFinish) return "Completed"
    return "No Merge"
  }
  const profiling = list(record(record(profile.jobStatus).jobProfiling), ["profiling"])
  const events = profiling.map((item) => numberValue(item.e)).filter((item): item is number => item !== null)
  if (events.includes(132) && !events.includes(140)) return "Running"
  if (events.includes(132) && events.includes(140)) return "Completed"
  return "No Merge"
}

function sqlHints(profile: Record<string, unknown>): string {
  const hints = record(record(record(profile.jobDesc).sqlJob).sqlConfig).hint
  if (!hints || typeof hints !== "object" || Array.isArray(hints)) return ""
  const entries = Object.entries(hints as Record<string, unknown>).filter((entry) => entry[1] !== undefined)
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : ""
}

function parsedJson(value: unknown): Record<string, unknown> {
  const raw = text(value)
  if (!raw) return {}
  try {
    return record(JSON.parse(raw))
  } catch {
    return {}
  }
}

function owner(profile: Record<string, unknown>, currentUserName?: string): string {
  const account = record(record(profile.jobDesc).account)
  return text(pick(account, ["userName", "name", "ownerName"])) ?? currentUserName ?? text(account.userId) ?? ""
}

function taskInstance(profile: Record<string, unknown>): string {
  const scheduled = parsedJson(profile.externalScheduledInfo)
  return text(pick(scheduled, ["scheduleInstanceId"])) ?? text(pick(profile, ["taskInstance", "taskInstanceId"])) ?? ""
}

function materializedViewAcceleration(profile: Record<string, unknown>): string {
  const meta = record(profile.jobMetaLite)
  const inline = text(pick(profile, ["materializedViewAcceleration", "mvAcceleration"]))
  if (inline) return inline
  if (!meta.isMvUsed) return ""
  if (!meta.isAutomvUsed) return "USERMV"
  return "AUTOMV"
}

function valueMap(input: BuildJobProfileRowsInput) {
  const profile = dataRoot(input.jobProfile)
  const stats = record(record(record(profile.jobSummary).stats).inputOutputStats)
  return {
    status: text(pick(record(profile.jobStatus), ["state", "status", "jobStatus"])) ?? "",
    duration: durationText(pageDurationTotalMs(profile)),
    duration_timeline: durationTimeline(profile),
    start_time: pageTime(pick(record(profile.jobStatus), ["submitTime", "submit_time", "startTime", "start_time", "beginTime"])) ?? "",
    end_time: pageTime(pick(record(profile.jobStatus), ["endTime", "end_time", "finishTime"])) ?? "",
    cluster: text(pick(record(profile.jobDesc), ["virtualCluster", "vcName", "cluster", "clusterName"])) ?? "",
    owner: owner(profile, input.currentUserName),
    input_records: rowByte(stats.inputRowCount, stats.inputBytes),
    output_records: rowByte(stats.outputRowCount, stats.outputBytes),
    cache_read: bytes(stats.inputCacheBytes),
    incremental_processing: incrementalProcessing(profile),
    small_file_merge: smallFileMerge(profile),
    cru_cost: cruCost(profile),
    task_instance: taskInstance(profile),
    materialized_view_acceleration: materializedViewAcceleration(profile),
    query_tag: text(pick(record(profile.jobDesc), ["queryTag", "query_tag"])) ?? "",
    sql_hints: sqlHints(profile),
    job_content: queryText(profile),
  } satisfies Record<(typeof fieldKeys)[number], string>
}

export function buildJobProfileRows(input: BuildJobProfileRowsInput): JobProfileRow[] {
  const values = valueMap(input)
  return [
    { key: "job_id", value: input.jobId },
    { key: "workspace_name", value: input.workspaceName },
    { key: "instance_id", value: String(input.instanceId) },
    ...fieldKeys.flatMap((key) => {
      if (key === "cache_read") return [...ioRecordRows(dataRoot(input.jobProfile)), { key, value: values[key] }]
      return [{ key, value: values[key] }]
    }),
  ]
}
