import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-task-lineage-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")

let fileType = 4
let fileContent = "create table dwd_table as select * from ods_table;"
const parseCalls: Array<Record<string, unknown>> = []

const actualSdk = await import("@clickzetta/sdk")
const actualResolver = await import("../src/resolver.ts")

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  getTaskDetail: async () => ({
    data: {
      id: 11407009,
      fileType,
      dataFileName: fileType === 1 ? "sync_job" : "dwd_table",
      fileContent,
    },
  }),
  getTaskConfigDetail: async () => ({
    data: {
      schemaName: "public",
    },
  }),
  parseTaskDependencyOut: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    parseCalls.push(params)
    return {
      data: {
        fileOutputTableDTOS: [
          {
            projectId: 41004,
            dataFileId: 11407009,
            dataFileVersion: 0,
            dataFileName: "dwd_table",
            fileShowName: "wanxin_test_04.dwd_table",
            refTableName: "wanxin_test_04.public.dwd_table",
            parseType: 2,
          },
        ],
        dataFileDependencyDTOS: [
          {
            dependencyProjectId: 41004,
            dependencyFileId: 11407008,
            dependencyFileVersion: 1,
            dependencyFileName: "cxx_dump",
            scheduleRateType: 3,
            scheduleStartTime: "00:00",
            dependencyInputName: "wanxin_test_04.cxx_dump",
            refTableNames: "wanxin_test_04.public.ods_table",
            parseType: 2,
            id: 11407008,
            projectName: "wanxin_test_04",
          },
        ],
        tableGuidListWithoutTask: [],
      },
    }
  },
}))

mock.module("../src/commands/studio-context.js", () => ({
  getStudioContext: async () => ({
    projectId: 41004,
    workspaceId: "7162858493138728877",
    userId: 13,
    tenantId: 10,
    instanceId: 86,
    instanceName: "jnsxwfyr",
    workspaceName: "wanxin_test_04",
    baseUrl: "https://uat-api.clickzetta.com",
    token: "token",
    env: "prod",
  }),
  getGatewayContext: async () => ({
    projectId: 0,
    workspaceId: 0,
    userId: 13,
    tenantId: 10,
    instanceId: 86,
    instanceName: "jnsxwfyr",
    workspaceName: "wanxin_test_04",
    baseUrl: "https://uat-api.clickzetta.com",
    token: "token",
    env: "prod",
    userName: "UAT_TEST",
  }),
}))

mock.module("../src/resolver.js", () => ({
  ...actualResolver,
  resolveTaskId: async () => 11407009,
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

mock.module("../src/studio-url.js", () => ({
  studioUrl: () => "https://studio.example/task/11407009",
}))

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as {
    data?: {
      outputs: Record<string, unknown>[]
      dependencies: Record<string, unknown>[]
      save_payload?: unknown
    }
    error?: Record<string, unknown>
  }
}

beforeEach(() => {
  fileType = 4
  fileContent = "create table dwd_table as select * from ods_table;"
  parseCalls.length = 0
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(profileFile, "[profiles.test]\npat = 'pat'\nworkspace = 'ws'\ninstance = 'inst'\n")
  process.env.CLICKZETTA_TEST_HOME = home
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  rmSync(home, { recursive: true, force: true })
})

describe("task lineage", () => {
  test("parses SQL task dependencies and outputs with user-facing fields", async () => {
    const result = await execute("task lineage dwd_table")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect(parseCalls).toEqual([
      {
        projectId: 41004,
        workspaceId: "7162858493138728877",
        schemaName: "public",
        dataFileContent: "create table dwd_table as select * from ods_table;",
        dataFileId: 11407009,
      },
    ])
    expect(json.data?.outputs[0]).toMatchObject({
      output_table_name: "wanxin_test_04.dwd_table",
      ref_table_name: "wanxin_test_04.public.dwd_table",
      task_id: 11407009,
      project_id: 41004,
      add_method: 2,
      add_method_name: "system_parsed",
    })
    expect(json.data?.dependencies[0]).toMatchObject({
      name: "cxx_dump",
      workspace: "wanxin_test_04",
      output_table_name: "wanxin_test_04.cxx_dump",
      schedule_rate_type: 3,
      schedule_start_time: "00:00",
      add_method: 2,
      add_method_name: "system_parsed",
      dep_strategy: 0,
      dependency_task_id: 11407008,
      dependency_project_id: 41004,
    })
    expect(json.data?.save_payload).toBeUndefined()
  })

  test("passes integration content through without local restructuring", async () => {
    fileType = 1
    fileContent = "{\"jobs\":[{\"name\":\"saved\"}]}"

    const result = await execute("task lineage sync_job --content '{\"jobs\":[{\"name\":\"draft\"}]}'")

    expect(result.exitCode).toBe(0)
    expect(parseCalls[0]?.dataFileContent).toBe("{\"jobs\":[{\"name\":\"draft\"}]}")
  })

  test("renders table format as flattened lineage rows", async () => {
    const result = await execute("task lineage dwd_table --format table")

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("record_type")
    expect(result.output).toContain("output_table_name")
    expect(result.output).toContain("schedule_start_time")
    expect(result.output).toContain("output")
    expect(result.output).toContain("dependency")
    expect(result.output).toContain("wanxin_test_04.public.dwd_table")
    expect(result.output).toContain("wanxin_test_04.cxx_dump")
    expect(result.output).toContain("system_parsed")
    expect(result.output).not.toContain("save_payload")
    expect(result.output).not.toContain("outputs")
    expect(result.output).not.toContain("[{")
  })

  test("rejects unsupported task types before calling parse API", async () => {
    fileType = 7

    const result = await execute("task lineage py_task")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(2)
    expect(json.error).toEqual({
      code: "UNSUPPORTED_TASK_TYPE",
      message: "task lineage only supports SQL and integration tasks.",
    })
    expect(parseCalls).toHaveLength(0)
  })
})
