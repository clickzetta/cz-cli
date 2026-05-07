/**
 * task-type.ts — port of cz_mcp/common/task_type.py
 *
 * Python → TS mapping:
 *   task_type.py:1-17   TaskType enum            → TaskType const enum
 *   task_type.py:20-33  OFFLINE_TASK_TYPE_MAP    → OFFLINE_TASK_TYPE_MAP
 *   task_type.py:35-40  REALTIME_TASK_TYPE_MAP   → REALTIME_TASK_TYPE_MAP
 *   task_type.py:41-44  TASK_TYPE_MAP            → TASK_TYPE_MAP
 *   task_type.py:47-63  TASK_FILE_TYPE_MAPPING   → TASK_FILE_TYPE_MAPPING
 */

import { FileType } from "./file-type.js"

// task_type.py:4-17 — TaskType enum
export const enum TaskType {
  Virtual = 0, // 虚拟任务
  DataIntegration = 10, // 离线同步
  LakeHouse = 23, // SQL
  Shell = 24, // Shell
  Python3 = 26, // Python
  RealTimeDI = 28, // 实时同步
  JDBC = 29, // JDBC
  DynamicTable = 30, // 动态表
  ContinuousJob = 31, // 流式SQL
  FullIncrementalSync = 280, // 全增量一体同步 (开发独有，调度没有)
  MultipleRISync = 281, // 多表实时同步
  MultipleDISync = 291, // 多表离线同步
  DatabrickSql = 300, // Databricks SQL
  DatabrickNotebook = 301, // Databricks Notebook
  Spark = 400, // Spark
  Flow = 500, // 组合任务
}

// task_type.py:20-33 — OFFLINE_TASK_TYPE_MAP
export const OFFLINE_TASK_TYPE_MAP: Record<number, string> = {
  [TaskType.LakeHouse]: "SQL",
  [TaskType.Python3]: "Python",
  [TaskType.Shell]: "Shell",
  [TaskType.DataIntegration]: "离线同步",
  [TaskType.JDBC]: "JDBC",
  [TaskType.ContinuousJob]: "流式SQL",
  [TaskType.DynamicTable]: "动态表",
  [TaskType.Virtual]: "虚拟任务",
  [TaskType.DatabrickSql]: "Databricks SQL",
  [TaskType.DatabrickNotebook]: "Databricks Notebook",
  [TaskType.Spark]: "Spark",
  [TaskType.Flow]: "组合任务",
  [TaskType.MultipleDISync]: "多表离线同步",
}

// task_type.py:35-40 — REALTIME_TASK_TYPE_MAP
export const REALTIME_TASK_TYPE_MAP: Record<number, string> = {
  [TaskType.MultipleRISync]: "多表实时同步",
  [TaskType.FullIncrementalSync]: "全增量一体同步",
  [TaskType.RealTimeDI]: "实时同步",
}

// task_type.py:41-44 — TASK_TYPE_MAP
export const TASK_TYPE_MAP: Record<number, string> = {
  ...OFFLINE_TASK_TYPE_MAP,
  ...REALTIME_TASK_TYPE_MAP,
}

// task_type.py:47-63 — TASK_FILE_TYPE_MAPPING
export const TASK_FILE_TYPE_MAPPING: Record<number, FileType> = {
  [TaskType.LakeHouse]: FileType.LakeHouse,
  [TaskType.Python3]: FileType.Python3,
  [TaskType.Shell]: FileType.Shell,
  [TaskType.DataIntegration]: FileType.DataIntegration,
  [TaskType.JDBC]: FileType.JDBC,
  [TaskType.ContinuousJob]: FileType.ContinuousJob,
  [TaskType.DynamicTable]: FileType.DynamicTable,
  [TaskType.Virtual]: FileType.Virtual,
  [TaskType.DatabrickSql]: FileType.DatabrickSql,
  [TaskType.DatabrickNotebook]: FileType.DatabrickNotebook,
  [TaskType.Spark]: FileType.Spark,
  [TaskType.Flow]: FileType.Flow,
  [TaskType.MultipleDISync]: FileType.MultipleDISync,
  [TaskType.MultipleRISync]: FileType.MultipleRISync,
  [TaskType.FullIncrementalSync]: FileType.FullIncrementalSync,
  [TaskType.RealTimeDI]: FileType.RealTimeDI,
}
