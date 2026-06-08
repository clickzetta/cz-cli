export type JobProfileFile = {
  type: "job_plan" | "job_progress" | "job_profile"
  path: string
  exists: boolean
  bytes: number
  source?: string | null
}

type Column = {
  key: string
  label: string
}

type Field = Column & {
  value: unknown
  raw_value: unknown
  help: string | null
  breakdown?: Array<Column & { value: string; raw_value: string }>
}

type BuildJobProfilePayloadInput = {
  jobId: string
  workspaceName: string
  instanceId: string | number
  jobPlan?: unknown
  jobProgress?: unknown
  jobProfile: unknown
  files: JobProfileFile[]
}

const detailFields = [
  ["duration", "Duration", ["duration", "durationMs", "costTime", "elapsedTime"]],
  ["start_time", "Start Time", ["startTime", "start_time", "beginTime"]],
  ["end_time", "End Time", ["endTime", "end_time", "finishTime"]],
  ["cluster", "Cluster", ["vcName", "vcluster", "cluster", "clusterName"]],
  ["owner", "Owner", ["owner", "ownerName", "userName", "submitUser"]],
  ["input_records", "Input Records", ["inputRecord", "inputRecords", "input_record"]],
  ["output_records", "Output Records", ["outputRecord", "outputRecords", "output_record"]],
  ["cache_read", "Cache Read", ["cacheBytes", "cacheRead", "cache_read"]],
  ["incremental_processing", "Incremental Processing", ["incremental", "incrementalProcessing", "isIncremental"]],
  ["small_file_merge", "Small File Merge", ["smallFileMerge", "small_file_merge"]],
  ["cru_cost", "CRU Cost", ["cruCost", "cru", "resourceCost"]],
  ["task_instance", "Task Instance", ["taskInstance", "taskInstanceId", "instanceId"]],
  ["materialized_view_acceleration", "Materialized View Acceleration", ["materializedViewAcceleration", "mvAcceleration"]],
  ["query_tag", "queryTag", ["queryTag", "query_tag"]],
] as const

const stageColumns = [
  { key: "locate_dag", label: "Locate DAG" },
  { key: "stage_name", label: "Stage Name" },
  { key: "start_time", label: "Start Time" },
  { key: "timeline", label: "Timeline" },
  { key: "duration", label: "Duration" },
  { key: "task_count", label: "Task" },
  { key: "operator_count", label: "Operator" },
  { key: "status", label: "Status" },
  { key: "end_time", label: "End Time" },
  { key: "input_records", label: "Input Records" },
  { key: "output_records", label: "Output Records" },
] satisfies Column[]

const concurrencyColumns = [
  { key: "stage_name", label: "Stage Name" },
  { key: "start_time", label: "Start Time" },
  { key: "end_time", label: "End Time" },
  { key: "duration", label: "Duration" },
  { key: "points", label: "Concurrency" },
] satisfies Column[]

const operatorColumns = [
  { key: "locate_dag", label: "Locate DAG" },
  { key: "operator_name", label: "Operator Name" },
  { key: "stage_name", label: "Stage" },
  { key: "duration", label: "Duration" },
  { key: "more_fields", label: "More Fields" },
] satisfies Column[]

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function dataRoot(value: unknown): Record<string, unknown> {
  const root = record(value)
  const data = record(root.data)
  return Object.keys(data).length > 0 ? data : root
}

function mergeDefined(...sources: Record<string, unknown>[]): Record<string, unknown> {
  return Object.assign({}, ...sources.filter((source) => Object.keys(source).length > 0))
}

function compact(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter((entry) => entry[1] !== null && entry[1] !== undefined))
}

function pick(source: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key]
  }
  return null
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "boolean") return value ? "是" : "否"
  if (typeof value === "object") return null
  return String(value)
}

function list(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown>[] {
  const value = pick(source, keys)
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : []
}

function firstNonEmptyList(...items: Record<string, unknown>[][]): Record<string, unknown>[] {
  return items.find((item) => item.length > 0) ?? []
}

function entriesRecord(source: Record<string, unknown>, keys: readonly string[]): Array<{ key: string; value: Record<string, unknown> }> {
  const value = pick(source, keys)
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>)
      .map((entry) => ({ key: entry[0], value: record(entry[1]) }))
      .filter((entry) => Object.keys(entry.value).length > 0)
    : []
}

function stageProgress(profile: Record<string, unknown>) {
  return entriesRecord(record(profile.progress), ["stageProgress"])
}

function progressSummary(progress: Record<string, unknown>) {
  return new Map(stageProgress(progress).map((entry) => [entry.key, entry.value]))
}

function normalizeDuration(value: unknown): unknown {
  const sum = record(value).sum
  return sum ?? value
}

function durationMs(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  return raw.endsWith("ms") ? raw : `${raw}ms`
}

function profilingTime(profile: Record<string, unknown>, event: number): number | null {
  const item = list(record(record(profile.jobStatus).jobProfiling), ["profiling"])
    .find((entry) => Number(text(entry.e)) === event)
  const value = Number(text(item?.t))
  return Number.isFinite(value) ? value : null
}

function profilingDuration(profile: Record<string, unknown>, startEvent: number, endEvent: number): string | null {
  const start = profilingTime(profile, startEvent)
  const end = profilingTime(profile, endEvent)
  if (start === null || end === null || end < start) return null
  return `${end - start}ms`
}

function durationBreakdown(profile: Record<string, unknown>): Field["breakdown"] | undefined {
  const items = [
    ["initialization", "Initialization", profilingDuration(profile, 100, 110)],
    ["cluster_starting", "Cluster Starting", profilingDuration(profile, 110, 111)],
    ["waiting_execution", "Waiting Execution", profilingDuration(profile, 111, 120)],
    ["executing", "Executing", profilingDuration(profile, 120, 130)],
    ["finished", "Finished", profilingDuration(profile, 130, 160)],
  ] as const
  const breakdown = items
    .flatMap((item) => item[2] === null ? [] : [{ key: item[0], label: item[1], value: item[2], raw_value: item[2] }])
  return breakdown.length > 0 ? breakdown : undefined
}

function pageTime(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
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

function elapsedMs(start: unknown, end: unknown): string | null {
  const startNum = Number(text(start))
  const endNum = Number(text(end))
  if (!Number.isFinite(startNum) || !Number.isFinite(endNum) || endNum < startNum) return null
  return `${endNum - startNum}ms`
}

function bytes(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  return `${raw} Byte`
}

function rowByte(row: unknown, byte: unknown): string | null {
  const rowText = text(row)
  const byteText = text(byte)
  if (!rowText && !byteText) return null
  return `${rowText ?? "0"}行 / ${byteText ?? "0"} Byte`
}

function spacedRowByte(row: unknown, byte: unknown): string | null {
  const rowText = text(row)
  const byteText = text(byte)
  if (!rowText && !byteText) return null
  return `${rowText ?? "0"} 行 / ${byteText ?? "0"} Byte`
}

function durationNsToMs(value: unknown): string | null {
  const raw = text(normalizeDuration(value))
  if (!raw) return null
  if (raw.endsWith("ms")) return raw
  const ns = Number(raw)
  if (!Number.isFinite(ns)) return raw
  return `${Math.floor(ns / 1_000_000)}ms`
}

function operatorMoreFields(summary: Record<string, unknown>): unknown {
  const hasExpandableStats = summary.inputOutputStats !== undefined || summary.tableSinkSummary !== undefined
  const cleaned = compact({
    inputOutputStats: summary.inputOutputStats,
    rowCount: hasExpandableStats ? summary.rowCount : undefined,
    tableSinkSummary: summary.tableSinkSummary,
  })
  return Object.keys(cleaned).length > 0 ? cleaned : ""
}

function cruCost(profile: Record<string, unknown>): string | null {
  const measurement = list(record(record(profile.jobSummary).meter), ["measurements"])
    .find((item) => text(item.key) === "cpu_wall_time" && text(item.unit) === "cru")
  const value = text(measurement?.value)
  if (!value) return null
  return Number(value) < 0.01 ? "小于 0.01 CRU*时" : `${value} CRU*时`
}

function smallFileMerge(meta: Record<string, unknown>): string | null {
  const raw = text(pick(record(meta.incrementalProperty), ["smallFileMerge", "small_file_merge", "smallFileMergeType"]))
  if (raw) return raw
  return text(record(meta.incrementalProperty).isDtOrMv) === "DT" ? "无合并" : null
}

function incrementalProcessing(meta: Record<string, unknown>): string | null {
  const value = pick(record(meta.incrementalProperty), ["incrementalProcessing", "incremental", "isIncrementalPlan"])
  if (typeof value === "boolean") return value ? "是" : "否"
  const raw = text(value)
  if (!raw || raw === "0" || raw === "false") return raw ? "否" : null
  return "是"
}

function stageId(stage: Record<string, unknown>): string | null {
  return text(pick(stage, ["stageId", "stage_id", "id", "name", "stageName", "stage_name"]))
}

function stageName(stage: Record<string, unknown>) {
  return pick(stage, ["stageName", "stage_name", "name", "stageId", "stage_id", "id"])
}

function stageSummary(profile: Record<string, unknown>) {
  return entriesRecord(record(profile.jobSummary), ["stageSummary", "stage_summary"])
}

function operatorEntries(stage: Record<string, unknown>) {
  return entriesRecord(stage, ["operatorSummary", "operator_summary"])
}

function operatorCount(stage: Record<string, unknown>, summary: Record<string, unknown>) {
  const picked = pick(stage, ["operator", "operatorCount", "operator_count"])
  if (picked !== null) return picked
  const fromPlan = list(stage, ["operators", "operatorList"]).length
  if (fromPlan > 0) return fromPlan
  const fromSummary = operatorEntries(summary).length
  return fromSummary > 0 ? fromSummary : null
}

function basicInfo(profile: Record<string, unknown>): Field[] {
  return detailFields.map(([key, label, keys]) => {
    const value = pick(profile, keys)
    const display = text(value)
    return {
      key,
      label,
      value: display?.trim() ?? "",
      raw_value: value,
      help: null,
      ...(key === "duration" ? { breakdown: durationBreakdown(profile) } : {}),
    }
  })
}

function lines(sql: unknown): { line: number; text: string }[] {
  return (text(sql) ?? "")
    .split("\n")
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter((line) => line.text.trim() !== "")
}

function queryText(profile: Record<string, unknown>): unknown {
  const sqlJob = record(record(profile.jobDesc).sqlJob)
  const query = sqlJob.query
  if (Array.isArray(query)) return query.map(text).filter((line): line is string => !!line).join("\n")
  return pick(profile, ["sql", "query", "queryText", "statement"])
}

function normalizeIoRows(profile: Record<string, unknown>) {
  return list(profile, ["ioRecords", "io_records", "tables", "tableRecords"]).map((item) => ({
    table_name: pick(item, ["tableName", "table_name", "name"]),
    type: pick(item, ["type", "recordType", "ioType"]),
    record_count: pick(item, ["recordCount", "records", "inputOutputRecord"]),
    cache_read: pick(item, ["cacheRead", "cacheBytes", "cache_read"]),
  }))
}

function normalizeStageRows(profile: Record<string, unknown>) {
  const stages = list(profile, ["stages", "stageList", "stageInfos", "stageExecution"])
  const summaries = new Map(stageSummary(profile).map((entry) => [entry.key, entry.value]))
  const progresses = progressSummary(profile)
  return stages.map((item) => {
    const summary = summaries.get(stageId(item) ?? "") ?? {}
    const progress = progresses.get(stageId(item) ?? "") ?? {}
    const stats = record(summary.inputOutputStats)
    return {
      locate_dag: true,
      stage_name: stageName(item),
      start_time: pick(mergeDefined(item, summary), ["startTime", "start_time"]),
      timeline: pick(item, ["timeline", "timeLine"]),
      duration: pick(mergeDefined(item, summary), ["duration", "durationMs", "costTime", "wallTimeMs"])
        ?? elapsedMs(pick(summary, ["startTime", "start_time"]), pick(summary, ["endTime", "end_time"]))
        ?? elapsedMs(pick(progress, ["startTime", "start_time"]), pick(progress, ["finishTime", "endTime", "end_time"])),
      task_count: pick(mergeDefined(item, summary), ["task", "taskCount", "task_count", "total"]),
      operator_count: operatorCount(item, summary),
      status: pick(mergeDefined(item, summary, progress), ["status", "state"]),
      end_time: pick(mergeDefined(item, summary), ["endTime", "end_time"]),
      input_records: pick(mergeDefined(item, summary), ["inputRecord", "inputRecords", "input_record"]) ?? spacedRowByte(stats.inputRowCount, stats.inputBytes),
      output_records: pick(mergeDefined(item, summary), ["outputRecord", "outputRecords", "output_record"]) ?? spacedRowByte(stats.outputRowCount, stats.outputBytes),
    }
  })
}

function normalizeConcurrencyRows(profile: Record<string, unknown>) {
  return list(profile, ["stageConcurrency", "durationConcurrency", "concurrency"]).map((item) => ({
    stage_name: pick(item, ["stageName", "stage_name", "name"]),
    start_time: pick(item, ["startTime", "start_time"]),
    end_time: pick(item, ["endTime", "end_time"]),
    duration: pick(item, ["duration", "durationMs"]),
    points: pick(item, ["points", "data", "concurrency"]),
  }))
}

function normalizeStageDag(profile: Record<string, unknown>) {
  const dagNodes = list(profile, ["stageDag", "stageDAG", "stageNodes"])
  if (dagNodes.length > 0) {
    return dagNodes.map((item) => ({
      name: pick(item, ["name", "stageName", "stage_name", "id"]),
      status: pick(item, ["status", "state"]),
      duration: pick(item, ["duration", "durationMs"]),
      task_count: pick(item, ["task", "taskCount", "task_count"]),
      operator_count: pick(item, ["operator", "operatorCount", "operator_count"]),
    }))
  }
  const summaries = new Map(stageSummary(profile).map((entry) => [entry.key, entry.value]))
  return list(profile, ["stages", "stageList", "stageInfos", "stageExecution"]).map((item) => {
    const summary = summaries.get(stageId(item) ?? "") ?? {}
    return {
      name: stageName(item),
      status: pick(summary, ["status", "state"]),
      duration: pick(summary, ["duration", "durationMs", "costTime", "wallTimeMs"]),
      task_count: pick(item, ["task", "taskCount", "task_count"]),
      operator_count: operatorCount(item, summary),
    }
  })
}

function normalizeOperatorRows(profile: Record<string, unknown>) {
  const explicit = list(profile, ["operators", "operatorList", "operatorInfos", "operatorExecution", "operatorSummaries"])
  if (explicit.length > 0) return explicit.map((item) => ({
    locate_dag: true,
    operator_name: pick(item, ["operatorName", "operator_name", "name"]),
    stage_name: pick(item, ["stageName", "stage_name", "stage"]),
    duration: pick(item, ["duration", "durationMs", "costTime"]),
    more_fields: pick(item, ["moreFields", "more_fields", "extraFields", "extra"]),
  }))
  const summaries = new Map(stageSummary(profile).map((entry) => [entry.key, entry.value]))
  return list(profile, ["stages", "stageList", "stageInfos", "stageExecution"]).flatMap((stage) => {
    const summary = summaries.get(stageId(stage) ?? "") ?? {}
    const stageOperators = list(stage, ["operators", "operatorList"])
    const names = stageOperators.length > 0
      ? stageOperators.map((operator) => text(pick(operator, ["operatorName", "operator_name", "operatorId", "operator_id", "name", "id"]))).filter((name): name is string => !!name)
      : operatorEntries(summary).map((entry) => entry.key)
    const operatorSummary = new Map(operatorEntries(summary).map((entry) => [entry.key, entry.value]))
    return names.map((name) => {
      const summaryItem = operatorSummary.get(name) ?? {}
      return {
        locate_dag: true,
        operator_name: name,
        stage_name: stageName(stage),
        duration: durationNsToMs(record(summaryItem.wallTimeNs).sum !== undefined ? summaryItem.wallTimeNs : pick(summaryItem, ["duration", "durationMs", "costTime", "wallTimeNs"])),
        more_fields: operatorMoreFields(summaryItem),
      }
    })
  })
}

function normalizeOperatorDag(profile: Record<string, unknown>) {
  const dagNodes = list(profile, ["operatorDag", "operatorDAG", "operatorNodes"])
  if (dagNodes.length > 0) return dagNodes.map((item) => ({
    stage_name: pick(item, ["stageName", "stage_name", "stage"]),
    operator_name: pick(item, ["operatorName", "operator_name", "name"]),
    duration: pick(item, ["duration", "durationMs"]),
  }))
  return normalizeOperatorRows(profile).map((item) => ({
    stage_name: item.stage_name,
    operator_name: item.operator_name,
    duration: item.duration,
  }))
}

function jobStatus(profile: Record<string, unknown>) {
  const status = pick(profile, ["status", "state"])
  if (status !== null) return text(status)
  const raw = record(profile.jobStatus)
  return text(pick(raw, ["status", "state", "jobStatus"]))
}

function profileRoot(input: BuildJobProfilePayloadInput) {
  const profile = dataRoot(input.jobProfile)
  const planRoot = dataRoot(input.jobPlan)
  const progressRoot = dataRoot(input.jobProgress)
  const plan = record(planRoot.jobPlan)
  const embeddedPlan = record(profile.jobPlan)
  const jobDesc = record(profile.jobDesc)
  const summary = record(profile.jobSummary)
  const status = record(profile.jobStatus)
  const stats = record(record(summary.stats).inputOutputStats)
  const meta = record(profile.jobMetaLite)
  const incremental = record(meta.incrementalProperty)
  const stages = firstNonEmptyList(
    list(plan, ["stages", "stageList", "stageInfos", "stageExecution"]),
    list(embeddedPlan, ["stages", "stageList", "stageInfos", "stageExecution"]),
    list(profile, ["stages", "stageList", "stageInfos", "stageExecution"]),
  )
  return mergeDefined(
    profile,
    embeddedPlan,
    plan,
    progressRoot,
    jobDesc,
    summary,
    status,
    stages.length > 0 ? { stages } : {},
    compact({
      duration: durationMs(status.runningTime),
      startTime: pageTime(status.startTime),
      endTime: pageTime(status.endTime),
      vcName: jobDesc.virtualCluster,
      owner: pick(record(jobDesc.account), ["userName", "name", "ownerName", "userId"]),
      inputRecord: rowByte(stats.inputRowCount, stats.inputBytes),
      outputRecord: rowByte(stats.outputRowCount, stats.outputBytes),
      cacheBytes: bytes(stats.inputCacheBytes),
      incremental: incrementalProcessing(meta),
      smallFileMerge: smallFileMerge(meta),
      cruCost: cruCost(profile),
      queryTag: jobDesc.queryTag,
    }),
    {
      jobSummary: Object.keys(summary).length > 0 ? summary : profile.jobSummary,
      jobStatus: Object.keys(status).length > 0 ? status : profile.jobStatus,
    },
    profile.jobContent !== undefined ? { sql: profile.jobContent } : {},
  )
}

export function buildJobProfilePayload(input: BuildJobProfilePayloadInput) {
  const profile = profileRoot(input)
  const sql = queryText(profile)
  return {
    job_id: input.jobId,
    workspace_name: input.workspaceName,
    instance_id: input.instanceId,
    status: jobStatus(profile) ?? "--",
    ...(input.files.length > 0 ? { files: input.files } : {}),
    tabs: {
      detail: {
        basic_info: basicInfo(profile),
        job_content: {
          sql: text(sql) ?? "",
          lines: lines(sql),
          copyable: true,
        },
        io_records: {
          rows: normalizeIoRows(profile),
        },
      },
      stage_diagnosis: {
        stage_execution: {
          columns: stageColumns,
          rows: normalizeStageRows(profile),
        },
        duration_concurrency: {
          columns: concurrencyColumns,
          rows: normalizeConcurrencyRows(profile),
        },
        dag: {
          nodes: normalizeStageDag(profile),
        },
      },
      operator_diagnosis: {
        operator_execution: {
          columns: operatorColumns,
          rows: normalizeOperatorRows(profile),
        },
        dag: {
          nodes: normalizeOperatorDag(profile),
        },
      },
    },
  }
}
