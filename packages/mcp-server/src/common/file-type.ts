/**
 * file-type.ts — port of cz_mcp/common/file_type.py
 *
 * Python → TS mapping:
 *   file_type.py:4-16   FileType enum          → FileType const enum
 *   file_type.py:19-31  OFFLINE_FILE_TYPE_MAP  → OFFLINE_FILE_TYPE_MAP
 *   file_type.py:33-37  REALTIME_FILE_TYPE_MAP → REALTIME_FILE_TYPE_MAP
 *   file_type.py:38-41  FILE_TYPE_MAP          → FILE_TYPE_MAP
 */

// file_type.py:4-16 — FileType enum (IntEnum in Python → const enum in TS)
export const enum FileType {
  Virtual = 0, // 虚拟任务
  DataIntegration = 1, // 离线同步
  LakeHouse = 4, // SQL
  Shell = 5, // Shell
  Python3 = 7, // Python
  RealTimeDI = 14, // 实时同步
  JDBC = 15, // JDBC
  DynamicTable = 16, // 动态表
  ContinuousJob = 17, // 流式SQL
  FullIncrementalSync = 280, // 全增量一体同步
  MultipleRISync = 281, // 多表实时同步
  MultipleDISync = 291, // 多表离线同步
  DatabrickSql = 300, // Databricks SQL
  DatabrickNotebook = 301, // Databricks Notebook
  Spark = 400, // Spark
  Flow = 500, // 组合任务
}

// file_type.py:19-31 — OFFLINE_FILE_TYPE_MAP
export const OFFLINE_FILE_TYPE_MAP: Record<number, string> = {
  [FileType.LakeHouse]: "SQL",
  [FileType.Python3]: "Python",
  [FileType.Shell]: "Shell",
  [FileType.DataIntegration]: "离线同步",
  [FileType.JDBC]: "JDBC",
  [FileType.ContinuousJob]: "流式SQL",
  [FileType.DynamicTable]: "动态表",
  [FileType.Virtual]: "虚拟任务",
  [FileType.DatabrickSql]: "Databricks SQL",
  [FileType.DatabrickNotebook]: "Databricks Notebook",
  [FileType.Spark]: "Spark",
  [FileType.Flow]: "组合任务",
  [FileType.MultipleDISync]: "多表离线同步",
}

// file_type.py:33-37 — REALTIME_FILE_TYPE_MAP
export const REALTIME_FILE_TYPE_MAP: Record<number, string> = {
  [FileType.MultipleRISync]: "多表实时同步",
  [FileType.FullIncrementalSync]: "全增量一体同步",
  [FileType.RealTimeDI]: "实时同步",
}

// file_type.py:38-41 — FILE_TYPE_MAP
export const FILE_TYPE_MAP: Record<number, string> = {
  ...OFFLINE_FILE_TYPE_MAP,
  ...REALTIME_FILE_TYPE_MAP,
}
