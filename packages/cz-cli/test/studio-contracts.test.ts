import { describe, expect, test } from "bun:test"
import {
  StudioFileType,
  StudioTaskType,
  StudioTaskRunStatus,
  StudioScheduleRateType,
  StudioMergeLogic,
  StudioMergeStatus,
  STUDIO_TASK_TO_FILE_TYPE,
  CLI_TASK_TYPE_ALIASES,
  UI_ONLY_FILE_TYPES,
  DEPENDENCY_OUTPUT_PARSE_FILE_TYPES,
  taskTypeName,
  fileTypeName,
  taskRunStatusName,
} from "../src/studio-contracts.ts"

describe("Studio task contracts", () => {
  test("mirrors Python FileType and TaskType contracts", () => {
    expect(StudioFileType.LakeHouse).toBe(4)
    expect(StudioFileType.Python3).toBe(7)
    expect(StudioFileType.Flow).toBe(500)
    expect(StudioFileType.Merge).toBe(20)
    expect(StudioTaskType.LakeHouse).toBe(23)
    expect(StudioTaskType.DataIntegration).toBe(10)
    expect(StudioTaskType.Flow).toBe(500)
    expect(StudioTaskType.Merge).toBe(20)
    expect(STUDIO_TASK_TO_FILE_TYPE[StudioTaskType.LakeHouse]).toBe(StudioFileType.LakeHouse)
    expect(STUDIO_TASK_TO_FILE_TYPE[StudioTaskType.DataIntegration]).toBe(StudioFileType.DataIntegration)
    expect(STUDIO_TASK_TO_FILE_TYPE[StudioTaskType.Merge]).toBe(StudioFileType.Merge)
  })

  test("keeps condition task as a named Studio file type", () => {
    expect(StudioFileType.Condition).toBe(19)
    expect(CLI_TASK_TYPE_ALIASES.CONDITION).toBe(StudioFileType.Condition)
    expect(fileTypeName(StudioFileType.Condition)).toBe("CONDITION")
    expect(taskTypeName(StudioTaskType.Condition)).toBe("CONDITION")
    expect(CLI_TASK_TYPE_ALIASES.MERGE).toBe(StudioFileType.Merge)
    expect(fileTypeName(StudioFileType.Merge)).toBe("MERGE")
    expect(taskTypeName(StudioTaskType.Merge)).toBe("MERGE")
  })

  test("exposes named sets for command branching", () => {
    expect(UI_ONLY_FILE_TYPES.has(StudioFileType.Flow)).toBe(true)
    expect(UI_ONLY_FILE_TYPES.has(StudioFileType.LakeHouse)).toBe(false)
    expect(DEPENDENCY_OUTPUT_PARSE_FILE_TYPES.has(StudioFileType.LakeHouse)).toBe(true)
    expect(DEPENDENCY_OUTPUT_PARSE_FILE_TYPES.has(StudioFileType.DataIntegration)).toBe(true)
  })

  test("mirrors Python enum names for run status and schedule rate", () => {
    expect(StudioTaskRunStatus.Success).toBe(1)
    expect(StudioTaskRunStatus.Failed).toBe(3)
    expect(StudioScheduleRateType.Day).toBe(3)
    expect(StudioScheduleRateType.Cron).toBe(6)
    expect(Object.values(StudioMergeStatus)).toEqual(["SUCCESS", "FAILED", "SKIPPED"])
    expect(Object.values(StudioMergeLogic)).toEqual(["AND", "OR"])
  })

  test("preserves unknown enum values in labels", () => {
    expect(fileTypeName(999)).toBe("999")
    expect(taskTypeName("888")).toBe("888")
    expect(taskRunStatusName(undefined)).toBe("UNKNOWN")
  })
})
