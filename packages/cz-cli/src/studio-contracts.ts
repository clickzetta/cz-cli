// Studio task enum contracts mirrored from cz_mcp.common.{file_type,task_type,enums}.
export const StudioFileType = {
  Virtual: 0,
  DataIntegration: 1,
  LakeHouse: 4,
  Shell: 5,
  Python3: 7,
  RealTimeDI: 14,
  JDBC: 15,
  DynamicTable: 16,
  ContinuousJob: 17,
  Condition: 19,
  Merge: 20,
  FullIncrementalSync: 280,
  MultipleRISync: 281,
  MultipleDISync: 291,
  DatabrickSql: 300,
  DatabrickNotebook: 301,
  Spark: 400,
  Flow: 500,
} as const

export const StudioTaskType = {
  Virtual: 0,
  DataIntegration: 10,
  Condition: 19,
  LakeHouse: 23,
  Shell: 24,
  Python3: 26,
  RealTimeDI: 28,
  JDBC: 29,
  DynamicTable: 30,
  ContinuousJob: 31,
  Merge: 20,
  FullIncrementalSync: 280,
  MultipleRISync: 281,
  MultipleDISync: 291,
  DatabrickSql: 300,
  DatabrickNotebook: 301,
  Spark: 400,
  Flow: 500,
} as const

export const StudioTaskRunStatus = {
  Success: 1,
  NotStarted: 2,
  Failed: 3,
  Running: 4,
  WaitingResource: 5,
  WaitingUpstream: 6,
  Paused: 7,
  UpstreamFailed: 8,
} as const

export const StudioTaskRunType = {
  Schedule: 1,
  Temp: 3,
  Refill: 4,
} as const

export const StudioRerunProperty = {
  AnyTime: 1,
  FailedOnly: 2,
  NotRerun: 3,
} as const

export const StudioSelfDependsJob = {
  No: 0,
  Yes: 1,
} as const

export const StudioTaskStatus = {
  Online: 1,
  Offline: 2,
} as const

export const StudioTaskEditState = {
  WaitForSave: 10,
  WaitForPublish: 20,
  ModifiedAfterPublish: 80,
  Published: 100,
} as const

export const StudioTaskPriority = {
  Low: 1,
  Medium: 2,
  High: 3,
} as const

export const StudioScheduleRateType = {
  Minute: 1,
  Hour: 2,
  Day: 3,
  Week: 4,
  Month: 5,
  Cron: 6,
} as const

export const StudioTriggerType = {
  Schedule: 1,
  Manual: 2,
} as const

export const StudioLineageAddMethod = {
  Manual: 1,
  SystemParsed: 2,
} as const

export const StudioDependencyStrategy = {
  Default: 0,
} as const

export const StudioMergeStatus = {
  Success: "SUCCESS",
  Failed: "FAILED",
  Skipped: "SKIPPED",
} as const

export const StudioMergeLogic = {
  And: "AND",
  Or: "OR",
} as const

export const StudioCdcRunStatus = {
  Running: 2,
  Stopped: 4,
} as const

export const StudioCdcDeployStatus = {
  NotDeployed: 0,
  Deployed: 1,
  Running: 2,
  Stopped: 3,
  Failed: 4,
} as const

export const STUDIO_TASK_TO_FILE_TYPE = {
  [StudioTaskType.Virtual]: StudioFileType.Virtual,
  [StudioTaskType.DataIntegration]: StudioFileType.DataIntegration,
  [StudioTaskType.Condition]: StudioFileType.Condition,
  [StudioTaskType.LakeHouse]: StudioFileType.LakeHouse,
  [StudioTaskType.Shell]: StudioFileType.Shell,
  [StudioTaskType.Python3]: StudioFileType.Python3,
  [StudioTaskType.RealTimeDI]: StudioFileType.RealTimeDI,
  [StudioTaskType.JDBC]: StudioFileType.JDBC,
  [StudioTaskType.DynamicTable]: StudioFileType.DynamicTable,
  [StudioTaskType.ContinuousJob]: StudioFileType.ContinuousJob,
  [StudioTaskType.Merge]: StudioFileType.Merge,
  [StudioTaskType.FullIncrementalSync]: StudioFileType.FullIncrementalSync,
  [StudioTaskType.MultipleRISync]: StudioFileType.MultipleRISync,
  [StudioTaskType.MultipleDISync]: StudioFileType.MultipleDISync,
  [StudioTaskType.DatabrickSql]: StudioFileType.DatabrickSql,
  [StudioTaskType.DatabrickNotebook]: StudioFileType.DatabrickNotebook,
  [StudioTaskType.Spark]: StudioFileType.Spark,
  [StudioTaskType.Flow]: StudioFileType.Flow,
} as const

export const FILE_TYPE_TO_TASK_TYPE = Object.fromEntries(
  Object.entries(STUDIO_TASK_TO_FILE_TYPE).map(([taskType, fileType]) => [fileType, Number(taskType)]),
) as Record<number, number>

export const CLI_TASK_TYPE_ALIASES: Record<string, number> = {
  SQL: StudioFileType.LakeHouse,
  LAKEHOUSE: StudioFileType.LakeHouse,
  PYTHON: StudioFileType.Python3,
  SHELL: StudioFileType.Shell,
  JDBC: StudioFileType.JDBC,
  CONDITION: StudioFileType.Condition,
  MERGE: StudioFileType.Merge,
  SPARK: StudioFileType.Spark,
  FLOW: StudioFileType.Flow,
  INTEGRATION: StudioFileType.DataIntegration,
  DI: StudioFileType.DataIntegration,
  REALTIME: StudioFileType.RealTimeDI,
  CDC: StudioFileType.RealTimeDI,
  DYNAMIC_TABLE: StudioFileType.DynamicTable,
  DT: StudioFileType.DynamicTable,
  STREAMING: StudioFileType.ContinuousJob,
  CONTINUOUS: StudioFileType.ContinuousJob,
  FULL_INCREMENTAL: StudioFileType.FullIncrementalSync,
  MULTI_REALTIME: StudioFileType.MultipleRISync,
  MULTI_DI: StudioFileType.MultipleDISync,
  DATABRICKS_SQL: StudioFileType.DatabrickSql,
  DATABRICKS_NOTEBOOK: StudioFileType.DatabrickNotebook,
  VIRTUAL: StudioFileType.Virtual,
}

export const UI_ONLY_FILE_TYPES = new Set<number>([
  StudioFileType.Spark,
  StudioFileType.Flow,
  StudioFileType.Merge,
  StudioFileType.DataIntegration,
  StudioFileType.RealTimeDI,
  StudioFileType.DynamicTable,
  StudioFileType.ContinuousJob,
  StudioFileType.FullIncrementalSync,
  StudioFileType.MultipleRISync,
  StudioFileType.MultipleDISync,
  StudioFileType.DatabrickSql,
  StudioFileType.DatabrickNotebook,
])

export const DEPENDENCY_OUTPUT_PARSE_FILE_TYPES = new Set<number>([
  StudioFileType.DataIntegration,
  StudioFileType.LakeHouse,
])

export const SCRIPT_FILE_TYPES = new Set<number>([
  StudioFileType.LakeHouse,
  StudioFileType.Shell,
  StudioFileType.Python3,
  StudioFileType.JDBC,
  StudioFileType.Condition,
])

export const UI_ONLY_SYNC_FILE_TYPES = new Set<number>([
  StudioFileType.DataIntegration,
  StudioFileType.RealTimeDI,
  StudioFileType.ContinuousJob,
  StudioFileType.FullIncrementalSync,
  StudioFileType.MultipleRISync,
  StudioFileType.MultipleDISync,
])

export const CDC_FILE_TYPES = new Set<number>([
  StudioFileType.RealTimeDI,
  StudioFileType.ContinuousJob,
  StudioFileType.FullIncrementalSync,
  StudioFileType.MultipleRISync,
  StudioFileType.MultipleDISync,
])

export const INTEGRATION_FILE_TYPES = new Set<number>([
  StudioFileType.DataIntegration,
  StudioFileType.RealTimeDI,
  StudioFileType.ContinuousJob,
  StudioFileType.FullIncrementalSync,
  StudioFileType.MultipleRISync,
  StudioFileType.MultipleDISync,
])

export const FILE_TYPE_NAMES: Record<number, string> = {
  [StudioFileType.Virtual]: "VIRTUAL",
  [StudioFileType.DataIntegration]: "INTEGRATION",
  [StudioFileType.LakeHouse]: "SQL",
  [StudioFileType.Shell]: "SHELL",
  [StudioFileType.Python3]: "PYTHON",
  [StudioFileType.RealTimeDI]: "REALTIME",
  [StudioFileType.JDBC]: "JDBC",
  [StudioFileType.DynamicTable]: "DYNAMIC_TABLE",
  [StudioFileType.ContinuousJob]: "CONTINUOUS_SQL",
  [StudioFileType.Condition]: "CONDITION",
  [StudioFileType.Merge]: "MERGE",
  [StudioFileType.FullIncrementalSync]: "FULL_INCREMENTAL",
  [StudioFileType.MultipleRISync]: "MULTI_REALTIME",
  [StudioFileType.MultipleDISync]: "MULTI_DI",
  [StudioFileType.DatabrickSql]: "DATABRICKS_SQL",
  [StudioFileType.DatabrickNotebook]: "DATABRICKS_NOTEBOOK",
  [StudioFileType.Spark]: "SPARK",
  [StudioFileType.Flow]: "FLOW",
}

export const TASK_TYPE_NAMES: Record<number, string> = {
  [StudioTaskType.Virtual]: "VIRTUAL",
  [StudioTaskType.DataIntegration]: "INTEGRATION",
  [StudioTaskType.Condition]: "CONDITION",
  [StudioTaskType.LakeHouse]: "SQL",
  [StudioTaskType.Shell]: "SHELL",
  [StudioTaskType.Python3]: "PYTHON",
  [StudioTaskType.RealTimeDI]: "REALTIME",
  [StudioTaskType.JDBC]: "JDBC",
  [StudioTaskType.DynamicTable]: "DYNAMIC_TABLE",
  [StudioTaskType.ContinuousJob]: "CONTINUOUS_SQL",
  [StudioTaskType.Merge]: "MERGE",
  [StudioTaskType.FullIncrementalSync]: "FULL_INCREMENTAL",
  [StudioTaskType.MultipleRISync]: "MULTI_REALTIME",
  [StudioTaskType.MultipleDISync]: "MULTI_DI",
  [StudioTaskType.DatabrickSql]: "DATABRICKS_SQL",
  [StudioTaskType.DatabrickNotebook]: "DATABRICKS_NOTEBOOK",
  [StudioTaskType.Spark]: "SPARK",
  [StudioTaskType.Flow]: "FLOW",
}

export const TASK_RUN_STATUS_NAMES: Record<number, string> = {
  [StudioTaskRunStatus.Success]: "SUCCESS",
  [StudioTaskRunStatus.NotStarted]: "WAITING",
  [StudioTaskRunStatus.Failed]: "FAILED",
  [StudioTaskRunStatus.Running]: "RUNNING",
  [StudioTaskRunStatus.WaitingResource]: "WAITING_RESOURCE",
  [StudioTaskRunStatus.WaitingUpstream]: "WAITING_UPSTREAM",
  [StudioTaskRunStatus.Paused]: "PAUSED",
  [StudioTaskRunStatus.UpstreamFailed]: "UPSTREAM_FAILED",
}

export const TASK_RUN_TYPE_NAMES: Record<number, string> = {
  [StudioTaskRunType.Schedule]: "SCHEDULE",
  [StudioTaskRunType.Temp]: "TEMP",
  [StudioTaskRunType.Refill]: "REFILL",
}

export const TASK_EDIT_STATE_CLI_NAMES: Record<number, string> = {
  [StudioTaskEditState.WaitForSave]: "draft",
  [StudioTaskEditState.WaitForPublish]: "published",
  [StudioTaskEditState.ModifiedAfterPublish]: "modified_after_publish",
  [StudioTaskEditState.Published]: "offline",
}

export const TASK_EDIT_STATE_STAT_NAMES: Record<number, string> = {
  [StudioTaskEditState.WaitForSave]: "DRAFT",
  [StudioTaskEditState.WaitForPublish]: "PUBLISHED",
  [StudioTaskEditState.ModifiedAfterPublish]: "MODIFIED_AFTER_PUBLISH",
  [StudioTaskEditState.Published]: "OFFLINE",
}

export const SCHEDULE_RATE_TYPE_NAMES: Record<number, string> = {
  [StudioScheduleRateType.Minute]: "minute",
  [StudioScheduleRateType.Hour]: "hourly",
  [StudioScheduleRateType.Day]: "daily",
  [StudioScheduleRateType.Week]: "weekly",
  [StudioScheduleRateType.Month]: "monthly",
  [StudioScheduleRateType.Cron]: "cron",
}

function enumName(names: Record<number, string>, value: unknown, fallback = "UNKNOWN") {
  const code = Number(value)
  if (Number.isFinite(code) && code in names) return names[code]!
  if (value === undefined || value === null || value === "") return fallback
  return String(value)
}

export function fileTypeName(value: unknown) {
  return enumName(FILE_TYPE_NAMES, value)
}

export function taskTypeName(value: unknown) {
  return enumName(TASK_TYPE_NAMES, value)
}

export function taskRunStatusName(value: unknown) {
  return enumName(TASK_RUN_STATUS_NAMES, value)
}

export function taskRunTypeName(value: unknown) {
  return enumName(TASK_RUN_TYPE_NAMES, value)
}

export function taskEditStateCliName(value: unknown) {
  return enumName(TASK_EDIT_STATE_CLI_NAMES, value)
}

export function taskEditStateStatName(value: unknown) {
  return enumName(TASK_EDIT_STATE_STAT_NAMES, value)
}

export function addMethodName(value: unknown): "manual" | "system_parsed" | "unknown" {
  const code = Number(value)
  if (code === StudioLineageAddMethod.Manual) return "manual"
  if (code === StudioLineageAddMethod.SystemParsed) return "system_parsed"
  return "unknown"
}

export function lineageTaskTypeName(value: unknown): "integration" | "sql" | "condition" | "unknown" {
  const code = Number(value)
  if (code === StudioFileType.DataIntegration) return "integration"
  if (code === StudioFileType.LakeHouse) return "sql"
  if (code === StudioFileType.Condition) return "condition"
  return "unknown"
}

export function scheduleRateTypeName(value: unknown) {
  return SCHEDULE_RATE_TYPE_NAMES[Number(value)] ?? "unknown"
}

export function depStrategyName(value: unknown): "default" | "unknown" {
  if (Number(value) === StudioDependencyStrategy.Default) return "default"
  return "unknown"
}
