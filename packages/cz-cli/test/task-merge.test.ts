import { beforeEach, describe, expect, test } from "bun:test"
import { onStudio, onFetch, stubStudioContext } from "./support/cz-fixtures.js"
import { clearTokenCache } from "@clickzetta/sdk"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Network-boundary test: no mock.module of our own src or of @clickzetta/sdk. The real cz-cli
// path runs and only the network boundary (globalThis.fetch) is stubbed via
// path/body fixtures. HOME/profile are isolated by test/preload.ts.

const createCalls: Array<Record<string, unknown>> = []
const saveContentCalls: Array<Record<string, unknown>> = []
const saveConfigCalls: Array<Record<string, unknown>> = []
const submitTaskCalls: Array<Record<string, unknown>> = []
let mergeHasConfig = true
let storedConfig: Record<string, unknown> = {}

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

// Name → id map used by resolveTaskId (listFiles) and getTaskDetail.
const TASK_IDS: Record<string, number> = { select_3: 13533003, merge_task: 13535004 }

beforeEach(() => {
  clearTokenCache()
  createCalls.length = 0
  saveContentCalls.length = 0
  saveConfigCalls.length = 0
  submitTaskCalls.length = 0
  mergeHasConfig = true
  storedConfig = {}
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'quick_start'\ninstance = 'tmwmzxzs'\n",
  )
  // userId is a string identity in this fixture — Studio returns it from login.
  stubStudioContext({ userId: "studi_test_1" as unknown as number, projectId: 1417759, workspaceName: "quick_start" })

  // listFiles: duplicate-name check (body carries folderId) → no existing task;
  // resolveTaskId lookup (no folderId) → the matching task by name.
  onFetch({
    match: (url) => url.includes("/ide-admin/v1/ai/mcp/listFiles"),
    respond: (_url, _method, body) => {
      const b = (body ?? {}) as Record<string, unknown>
      if (b.folderId !== undefined) return { code: 0, data: { list: [], total: 0, totalPages: 0 } }
      const name = String(b.fileName ?? "")
      const id = TASK_IDS[name]
      return { code: 0, data: { list: id ? [{ dataFileName: name, id }] : [] } }
    },
  })
  // createTask (addAndReturnId) → capture, return new merge task id
  onStudio("/ide-admin/v1/dataFile/addAndReturnId", (body) => {
    createCalls.push(body as Record<string, unknown>)
    return { code: 0, data: 13535004 }
  })
  // getTaskDetail (getDetail) — keyed by body.id
  onStudio("/ide-admin/v1/dataFile/getDetail", (body) => {
    const id = Number((body as Record<string, unknown>).id)
    if (id === 13533003) {
      return {
        code: 0,
        data: { id: 13533003, projectId: 128008, dataFileName: "select_3", fileType: 19, ownerCnName: "owner-cn", ownerEnName: "owner-en" },
      }
    }
    return {
      code: 0,
      data: {
        id,
        projectId: 1417759,
        dataFileName: "merge_task",
        fileType: 20,
        hasConfig: mergeHasConfig,
        ownerCnName: "owner-cn",
        ownerEnName: "owner-en",
      },
    }
  })
  // getTaskConfigDetail
  onStudio("/ide-admin/v1/dataFileConfiguration/getFileConfigurationDetail", () => ({
    code: 0,
    data: {
      cronExpress: "0 00 00 * * ? *",
      activeStartTime: "2026-06-29T00:00:00.000Z",
      activeEndTime: "2099-01-01T00:00:00.000Z",
      schemaName: "public",
      etlVcCode: "DEFAULT",
      retryCount: 1,
      retryIntervalTime: 1,
      retryIntervalTimeUnit: "m",
      rerunProperty: "1",
      selfDependsJob: 0,
      executeTimeout: 0,
      executeTimeoutUnit: "m",
      configProperties: "{\"extConfig\":{},\"enableAutoMv\":false}",
      dataFileName: "merge_task",
      fileDescription: "",
      ...storedConfig,
    },
  }))
  // resolveVclusterId → listVclusters
  onStudio("/clickzetta-lakeconsole/api/v1/vcluster/list", () => ({
    code: 0,
    data: [{ id: "vc-default-id", name: "DEFAULT", type: "GENERAL" }],
  }))
  // saveDataFileConfiguration: saveTaskContent (onlySaveContent=1) vs saveTaskConfig (onlySaveContent=0)
  onFetch({
    match: (url) => url.includes("/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration"),
    respond: (_url, _method, body) => {
      const b = (body ?? {}) as Record<string, unknown>
      if (Number(b.onlySaveContent) === 1) saveContentCalls.push(b)
      else saveConfigCalls.push(b)
      return { code: 0, data: true }
    },
  })
  // submitTask
  onStudio("/ide-admin/v1/dataFile/submit", (body) => {
    submitTaskCalls.push(body as Record<string, unknown>)
    return { code: 0, data: true }
  })

  // taskPreCheck — workspace-param pre-check gate before publish.
  onStudio("/ide-admin/v1/workspaceParams/task/preCheck", () => ({
    code: 0,
    data: { pass: true, details: [] },
  }))
})

describe("task merge", () => {
  test("creates merge tasks with Studio fileType 20", async () => {
    const result = await execute("task create merge_task --type MERGE --folder 454001")

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(createCalls[0]).toMatchObject({
      fileType: "20",
      dataFileName: "merge_task",
      dataFolderId: 454001,
      projectId: 1417759,
    })
  })

  test("save-merge saves content rule and schedule dependency", async () => {
    const result = await execute("task save-merge merge_task --dependency select_3 --status SUCCESS --status FAILED --status SKIPPED")

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveContentCalls).toHaveLength(1)
    expect(saveContentCalls[0]?.dataFileContent).toEqual(JSON.stringify({
      mergeRule: {
        logic: "AND",
        conditions: [
          {
            dependencyId: 13533003,
            statusIn: ["SUCCESS", "FAILED", "SKIPPED"],
          },
        ],
      },
      finalStatus: "SUCCESS",
    }))
    expect(saveContentCalls[0]).toMatchObject({
      dataFileId: 13535004,
      paramValueList: [],
      inputParamValueList: [],
      outputParamValueList: [],
      adhocConfigs: "{\"multiDataSource\":[],\"schema\":\"public\"}",
    })
    expect(saveConfigCalls[0]).toMatchObject({
      dataFileId: 13535004,
      projectId: 1417759,
      fileType: 20,
      dataFileName: "merge_task",
      cronExpress: "0 00 00 * * ? *",
      dependencyTimeout: 3,
      dependencyTimeoutUnit: "d",
      dataFileInputListReqs: [
        {
          dependencyProjectId: 128008,
          dependencyFileId: 13533003,
          dependencyFileName: "select_3",
          dependencyInputName: "quick_start.select_3",
          parseType: 2,
          depStrategy: 0,
        },
      ],
      dataFileOutputListReqs: [],
    })
  })

  test("save-merge rejects unsupported status values before saving", async () => {
    const result = await execute("task save-merge merge_task --dependency select_3 --status UNKNOWN")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(2)
    expect(json).toEqual({
      error: {
        code: "INVALID_ARGUMENTS",
        message: "Unsupported merge status: UNKNOWN. Use SUCCESS, FAILED, SKIPPED.",
      },
    })
    expect(saveContentCalls).toHaveLength(0)
    expect(saveConfigCalls).toHaveLength(0)
  })

  test("save-merge rejects invalid cron before saving content", async () => {
    const result = await execute("task save-merge merge_task --dependency select_3 --cron invalid")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(2)
    expect(json.error).toMatchObject({ code: "INVALID_CRON" })
    expect(saveContentCalls).toHaveLength(0)
    expect(saveConfigCalls).toHaveLength(0)
  })

  // Crons Studio can hold (set in the Studio UI or by an older cz-cli) that the adapter cannot re-express exactly.
  const STORED_SCHEDULE = { schedule: [["everyday"]], frequency: "1", scheduleStartTime: "2026-06-29 00:00:00" }
  for (const cron of ["0 0 0 * 1,3 ? *", "0 5,20 3 * * ? *", "0 0 1,5,9 * * ? *", "0 0 0 * * ? 2027", "0 0 0 ? * 0 *"]) {
    test(`save-merge without --cron saves the stored cron '${cron}' back unchanged`, async () => {
      storedConfig = { cronExpress: cron, ...STORED_SCHEDULE }
      const result = await execute("task save-merge merge_task --dependency select_3")

      if (result.exitCode !== 0) console.log(result.output)
      expect(result.exitCode).toBe(0)
      expect(saveContentCalls).toHaveLength(1)
      expect(saveConfigCalls).toHaveLength(1)
      expect(saveConfigCalls[0]).toMatchObject({ cronExpress: cron, ...STORED_SCHEDULE })
    })
  }

  test("save-merge without --cron still converts a stored cron the adapter expresses exactly", async () => {
    storedConfig = { cronExpress: "0 30 8 * * ? *", ...STORED_SCHEDULE }
    const result = await execute("task save-merge merge_task --dependency select_3")

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveConfigCalls[0]).toMatchObject({ cronExpress: "0 30 08 * * ? *", ...STORED_SCHEDULE })
  })

  test("save-merge names the stored cron when it must rebuild a schedule it cannot convert", async () => {
    storedConfig = { cronExpress: "0 5,20 3 * * ? *" }
    const result = await execute("task save-merge merge_task --dependency select_3")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(2)
    expect(json.error).toMatchObject({ code: "INVALID_CRON" })
    expect(String((json.error as Record<string, unknown>).message)).toContain("stored cron '0 5,20 3 * * ? *'")
    expect(String((json.error as Record<string, unknown>).message)).toContain("--cron")
    expect(saveContentCalls).toHaveLength(0)
    expect(saveConfigCalls).toHaveLength(0)
  })

  test("save-merge rejects an invalid --cron even when the stored cron is valid", async () => {
    storedConfig = { cronExpress: "0 30 8 * * ? *", ...STORED_SCHEDULE }
    const result = await execute("task save-merge merge_task --dependency select_3 --cron '0 8,12 * * *'")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(2)
    expect(json.error).toMatchObject({ code: "INVALID_CRON" })
    expect(String((json.error as Record<string, unknown>).message)).not.toContain("stored cron")
    expect(saveContentCalls).toHaveLength(0)
    expect(saveConfigCalls).toHaveLength(0)
  })

  test("deploy rejects merge tasks before save-merge configuration", async () => {
    mergeHasConfig = false

    const result = await execute("task deploy merge_task -y")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(2)
    expect(json).toEqual({
      error: {
        code: "NO_MERGE_CONFIG",
        message: "MERGE task is not configured. Run: cz-cli task save-merge 13535004 --dependency <upstream> --status SUCCESS",
      },
    })
    expect(submitTaskCalls).toHaveLength(0)
  })

  test("deploy publishes configured merge tasks", async () => {
    const result = await execute("task deploy merge_task -y")

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(submitTaskCalls).toEqual([
      {
        commitMsg: "Published via cz-cli",
        dataFileId: 13535004,
        projectId: 1417759,
        updatedBy: "studi_test_1",
      },
    ])
  })
})

describe("task create-setup cron validation", () => {
  test("invalid cron is rejected before any task is created", async () => {
    const result = await execute("task create-setup orphan_check --folder 454001 --type SQL --content 'select 1' --cron '0 8,12 * * *'")
    expect(result.exitCode).toBe(2)
    expect(firstJson(result.output).error).toMatchObject({ code: "INVALID_CRON" })
    expect(createCalls).toHaveLength(0)
    expect(saveContentCalls).toHaveLength(0)
    expect(saveConfigCalls).toHaveLength(0)
  })
})
