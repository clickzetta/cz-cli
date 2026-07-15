import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-task-merge-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")

const createCalls: Array<Record<string, unknown>> = []
const saveContentCalls: Array<Record<string, unknown>> = []
const saveConfigCalls: Array<Record<string, unknown>> = []
const submitTaskCalls: Array<Record<string, unknown>> = []
const taskPreCheckCalls: Array<Record<string, unknown>> = []
let mergeHasConfig = true
let taskPreCheckPass = true

const actualSdk = await import("@clickzetta/sdk")
const actualResolver = await import("../src/resolver.ts")

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  listTasks: async () => ({ data: { list: [] } }),
  createTask: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    createCalls.push(params)
    return { data: 13535004 }
  },
  getTaskDetail: async (_config: Record<string, unknown>, fileId: number) => ({
    data: fileId === 13533003
      ? {
        id: 13533003,
        projectId: 128008,
        dataFileName: "select_3",
        fileType: 19,
        ownerCnName: "owner-cn",
        ownerEnName: "owner-en",
      }
      : {
        id: fileId,
        projectId: 1417759,
        dataFileName: "merge_task",
        fileType: 20,
        hasConfig: mergeHasConfig,
        ownerCnName: "owner-cn",
        ownerEnName: "owner-en",
      },
  }),
  getTaskConfigDetail: async () => ({
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
    },
  }),
  resolveVclusterId: async () => "vc-default-id",
  saveTaskContent: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    saveContentCalls.push(params)
    return { data: true }
  },
  saveTaskConfig: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    saveConfigCalls.push(params)
    return { data: true }
  },
  submitTask: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    submitTaskCalls.push(params)
    return { data: true }
  },
  taskPreCheck: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    taskPreCheckCalls.push(params)
    return {
      data: taskPreCheckPass
        ? { pass: true, details: [{ fileId: 13535004, fileName: "merge_task", invalidParams: [] }] }
        : { pass: false, details: [{ fileId: 13535004, fileName: "merge_task", invalidParams: [{ paramKey: "tenant", reason: "参数不存在" }] }] },
    }
  },
}))

mock.module("../src/commands/studio-context.js", () => ({
  getStudioContext: async () => ({
    projectId: 1417759,
    workspaceId: 1,
    userId: "studi_test_1",
    instanceName: "tmwmzxzs",
    workspaceName: "quick_start",
    baseUrl: "https://api.example.com",
  }),
  getProfileAgentContext: () => undefined,
  getGatewayContext: async () => ({
    projectId: 1417759,
    workspaceId: 1,
    userId: "studi_test_1",
    tenantId: 1223,
    instanceId: 32,
    instanceName: "tmwmzxzs",
    workspaceName: "quick_start",
    baseUrl: "https://api.example.com",
  }),
}))

mock.module("../src/resolver.js", () => ({
  ...actualResolver,
  resolveTaskId: async (_config: Record<string, unknown>, nameOrId: string) => {
    if (nameOrId === "select_3") return 13533003
    if (nameOrId === "merge_task" || nameOrId === "13535004") return 13535004
    return Number(nameOrId)
  },
  resolveFolderIdByName: async () => 454001,
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

mock.module("../src/studio-url.js", () => ({
  studioUrl: (_config: Record<string, unknown>, fileId: number) => `https://studio.example/task/${fileId}`,
}))

mock.module("../src/locale.js", () => ({
  t: () => "",
}))

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

beforeEach(() => {
  createCalls.length = 0
  saveContentCalls.length = 0
  saveConfigCalls.length = 0
  submitTaskCalls.length = 0
  taskPreCheckCalls.length = 0
  mergeHasConfig = true
  taskPreCheckPass = true
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(profileFile, "[profiles.test]\npat = 'pat'\nworkspace = 'quick_start'\ninstance = 'tmwmzxzs'\n")
  process.env.CLICKZETTA_TEST_HOME = home
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  rmSync(home, { recursive: true, force: true })
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
    expect(saveContentCalls[0]?.dataFileContent).toEqual({
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
    })
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
    expect(taskPreCheckCalls).toEqual([
      {
        fileIds: [13535004],
        projectId: 1417759,
      },
    ])
  })

  test("deploy blocks submit when workspace param pre-check fails", async () => {
    taskPreCheckPass = false

    const result = await execute("task deploy merge_task -y")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json.error).toMatchObject({
      code: "WORKSPACE_PARAM_PRECHECK_FAILED",
    })
    expect(submitTaskCalls).toHaveLength(0)
  })
})
