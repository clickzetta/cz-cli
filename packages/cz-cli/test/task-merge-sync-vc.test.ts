import { beforeEach, describe, expect, test } from "bun:test"
import { onFetch, onStudio, stubStudioContext } from "./support/cz-fixtures.js"
import { clearTokenCache } from "@clickzetta/sdk"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Network-boundary test for `task create-merge-sync --task-id <id> --vc <vc>`: re-running on an
// existing task must change only the VC and keep the rest of its schedule config.

const TASK_ID = 13536001
const saveConfigCalls: Array<Record<string, unknown>> = []

const { execute } = await import("../src/execute.ts")

beforeEach(() => {
  clearTokenCache()
  saveConfigCalls.length = 0
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'quick_start'\ninstance = 'tmwmzxzs'\n",
  )
  stubStudioContext({ userId: 777, projectId: 1417759, workspaceName: "quick_start" })

  onStudio("/ide-authority/v1/projectDataSources/list", () => ({
    code: 0,
    data: { list: [
      { id: 1555, dsName: "mysql_src", dsType: 5 },
      { id: 14000, dsName: "LAKEHOUSE_quick_start", dsType: 1 },
    ] },
  }))
  onStudio("/ide-admin/v1/dataFile/getDetail", () => ({
    code: 0,
    data: { id: TASK_ID, projectId: 1417759, dataFileName: "merge_sync", fileType: 281 },
  }))
  onStudio("/ide-admin/v1/timelyTask/ruleContent/start/edit", () => ({ code: 0, data: true }))
  onFetch({
    match: (url) => url.includes("/ide-admin/v1/timelyTask/pipeline/check/async/result"),
    respond: () => ({ code: 0, data: { finish: true, valid: true, tableListStr: "{0:{1555:[{\"name\":\"t1\"}]}}", tableSchemaStr: "[]" } }),
  })
  onStudio("/ide-admin/v1/timelyTask/pipeline/check/async", () => ({ code: 0, data: "uuid-1" }))
  onStudio("/ide-admin/v1/timelyTask/ruleContent/change/tmp", () => ({ code: 0, data: true }))
  onStudio("/clickzetta-lakeconsole/api/v1/vcluster/list", () => ({
    code: 0,
    data: [{ id: "vc-new-id", name: "NEW_VC", type: "GENERAL" }],
  }))
  // Existing config with non-default values that must survive the VC change.
  onStudio("/ide-admin/v1/dataFileConfiguration/getFileConfigurationDetail", () => ({
    code: 0,
    data: {
      cronExpress: "0 30 02 * * ? *",
      activeStartTime: "2026-01-15T00:00:00.000Z",
      activeEndTime: "2030-12-31T00:00:00.000Z",
      schemaName: "ods",
      etlVcCode: "OLD_VC",
      etlVcId: "vc-old-id",
      retryCount: 3,
      retryIntervalTime: 5,
      retryIntervalTimeUnit: "m",
      rerunProperty: "1",
      selfDependsJob: 1,
      taskPriority: "5",
      scheduleRateType: 1,
      fileOutputTableDTOS: [{ tableName: "ods.merged" }],
    },
  }))
  onFetch({
    match: (url) => url.includes("/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration"),
    respond: (_url, _method, body) => {
      const b = (body ?? {}) as Record<string, unknown>
      if (Number(b.onlySaveContent) !== 1) saveConfigCalls.push(b)
      return { code: 0, data: true }
    },
  })
})

describe("task create-merge-sync --task-id --vc", () => {
  test("changes only the VC of an existing task and keeps its schedule config", async () => {
    const result = await execute(
      `task create-merge-sync merge_sync --folder 1001 --source 1555 --source-db db1 --tables t1 ` +
        `--target 14000 --target-schema public --target-table merged --task-id ${TASK_ID} --vc NEW_VC`,
    )
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveConfigCalls).toHaveLength(1)
    const saved = saveConfigCalls[0]
    expect(saved.etlVcCode).toBe("NEW_VC")
    expect(saved.etlVcId).toBe("vc-new-id")
    expect(saved.dataFileId).toBe(TASK_ID)
    expect(saved.cronExpress).toBe("0 30 02 * * ? *")
    expect(String(saved.activeStartTime)).toStartWith("2026-01-15")
    expect(String(saved.activeEndTime)).toStartWith("2030-12-31")
    expect(saved.schemaName).toBe("ods")
    expect(Number(saved.retryCount)).toBe(3)
    expect(String(saved.rerunProperty)).toBe("1")
    expect(Number(saved.selfDependsJob)).toBe(1)
    expect(String(saved.taskPriority)).toBe("5")
    expect(Number(saved.scheduleRateType)).toBe(1)
    expect(saved.dataFileOutputListReqs).toEqual([{ tableName: "ods.merged" }])
  })
})
