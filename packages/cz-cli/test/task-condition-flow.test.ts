import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-task-condition-flow-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")

const conditionContent = JSON.stringify({
  conditionConfig: {
    branches: [
      { expression: "${paramsA} == 1", outputName: "branch_success", sequence: "seq-success" },
      { expression: "${paramsA} == 3", outputName: "branch_missing", sequence: "seq-missing" },
    ],
    defaultOutputName: "default_branch",
    defaultSequence: "seq-default",
  },
})

const saveTaskConfigCalls: Array<Record<string, unknown>> = []
const saveFlowNodeConfigCalls: Array<Record<string, unknown>> = []
const saveFlowNodeContentCalls: Array<Record<string, unknown>> = []
const submitFlowCalls: Array<Record<string, unknown>> = []
const taskPreCheckCalls: Array<Record<string, unknown>> = []
const checkFlowSubmitStatusCalls: Array<Record<string, unknown>> = []
const bindFlowNodeCalls: Array<Record<string, unknown>> = []
let failNodeConfigDetail = false
let flowPreCheckPass = true
let flowSubmitStatus = 2

const actualSdk = await import("@clickzetta/sdk")
const actualResolver = await import("../src/resolver.ts")

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  getTaskDetail: async (_config: Record<string, unknown>, fileId: number) => ({
    data: fileId === 13412004
      ? { id: 13412004, dataFileName: "condition_flow", fileType: 500, fileFlowStatus: 100, deployStatus: 1 }
      : {
        id: fileId,
        dataFileName: "test_condition",
        fileType: 19,
        fileContent: conditionContent,
        paramValueList: [],
      },
  }),
  getTaskConfigDetail: async (_config: Record<string, unknown>, params: Record<string, unknown>) => ({
    data: (() => {
      if (failNodeConfigDetail && params.nodeId === 13412006) throw new Error("node config detail failed")
      return {
      projectId: 60001,
      dataFileId: params.dataFileId,
      dataFileName: params.nodeId === 13412005
        ? "condition_node"
        : params.nodeId === 13412006
          ? "succ_node"
          : params.dataFileId === 13412004
            ? "condition_flow"
            : "test_condition",
      fileType: params.nodeId === 13412005
        ? 19
        : params.nodeId === 13412006
          ? 4
          : params.dataFileId === 13412004
            ? 500
            : 19,
      schemaName: "public",
      cronExpress: "0 */5 * * * ? *",
      retryCount: 1,
      retryIntervalTime: 1,
      retryIntervalTimeUnit: "m",
      rerunProperty: 1,
      selfDependsJob: 0,
      activeStartTime: "2026-05-06",
      activeEndTime: "2026-05-09",
      etlVcCode: params.nodeId === 13412006 ? "NODE_SQL_VC" : undefined,
      etlVcId: params.nodeId === 13412006 ? "node-sql-vc-id" : undefined,
      configProperties: "{}",
      dataFileDependencyDTOS: [],
      fileOutputTableDTOS: [],
      }
    })(),
  }),
  saveTaskConfig: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    saveTaskConfigCalls.push(params)
    return { data: { ok: true } }
  },
  submitFlow: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    submitFlowCalls.push(params)
    return { data: "trace-flow-001" }
  },
  taskPreCheck: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    taskPreCheckCalls.push(params)
    return {
      data: flowPreCheckPass
        ? { pass: true, details: [{ fileId: 13412004, fileName: "condition_flow", invalidParams: [] }] }
        : { pass: false, details: [{ fileId: 13412004, fileName: "condition_flow", invalidParams: [{ paramKey: "tenant", reason: "参数未上线(当前状态:未发布)" }] }] },
    }
  },
  checkFlowSubmitStatus: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    checkFlowSubmitStatusCalls.push(params)
    return { data: flowSubmitStatus }
  },
  saveTaskContent: async () => ({ data: { ok: true } }),
  getFlowDag: async () => ({
    data: [
      { id: 13412005, fileName: "condition_node", fileType: 19 },
      {
        id: 13412006,
        fileName: "succ_node",
        fileType: 4,
        dependencies: bindFlowNodeCalls.length > 0
          ? [{ dependencyNodeId: 13412005, dependencyRefTables: "branch_success", sequence: "seq-success" }]
          : [],
      },
    ],
  }),
  getFlowNodeDetail: async (_config: Record<string, unknown>, _flowId: number, nodeId: number) => ({
    data: nodeId === 13412005
      ? {
        nodeId,
        fileContent: conditionContent,
        fileType: 19,
        dataFileName: "condition_node",
        fileName: "condition_node",
        ownerCnName: "studi_test_1",
        ownerEnName: "12365",
        defaultSchemaName: "public",
        defaultVcName: "AUTO_STOP_TEST_01",
        paramValueList: [{ paramKey: "paramsA", paramValue: "1", paramType: "auto", ignore: false, encrypt: false, ref: 0 }],
      }
      : {
        nodeId,
        fileContent: "select 1;",
        fileType: 4,
        dataFileName: "succ_node",
        fileName: "succ_node",
        ownerCnName: "studi_test_1",
        ownerEnName: "12365",
        defaultSchemaName: "public",
        defaultVcName: "AUTO_STOP_TEST_01",
      },
  }),
  saveFlowNodeContent: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    saveFlowNodeContentCalls.push(params)
    return { data: { ok: true } }
  },
  resolveVclusterId: async (_config: Record<string, unknown>, vcCode: string) => {
    if (vcCode === "AUTO_STOP_TEST_01") return "1664618098965906057"
    if (vcCode === "NODE_SQL_VC") return "node-sql-vc-id"
    return undefined
  },
  saveFlowNodeConfig: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    saveFlowNodeConfigCalls.push(params)
    return { data: { ok: true } }
  },
  bindFlowNode: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    bindFlowNodeCalls.push(params)
    return { data: { ok: true } }
  },
}))

mock.module("../src/commands/studio-context.js", () => ({
  getStudioContext: async () => ({
    projectId: 60001,
    workspaceId: "3030397973845742780",
    userId: 12365,
    tenantId: 1223,
    instanceId: 32,
    instanceName: "tmwmzxzs",
    workspaceName: "wanxin-test-ws-03",
    baseUrl: "https://dev-api.clickzetta.com",
    token: "token",
    env: "prod",
  }),
  getGatewayContext: async () => ({
    projectId: 0,
    workspaceId: 0,
    userId: 12365,
    tenantId: 1223,
    instanceId: 32,
    instanceName: "tmwmzxzs",
    workspaceName: "wanxin-test-ws-03",
    baseUrl: "https://dev-api.clickzetta.com",
    token: "token",
    env: "prod",
    userName: "studi_test_1",
  }),
  getProfileAgentContext: () => undefined,
}))

mock.module("../src/resolver.js", () => ({
  ...actualResolver,
  resolveNodeId: async (_config: Record<string, unknown>, _fileId: number, name: string) => {
    if (name === "condition_node") return 13412005
    if (name === "succ_node") return 13412006
    return Number(name)
  },
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

mock.module("../src/studio-url.js", () => ({
  studioUrl: (_config: Record<string, unknown>, fileId: number) => `https://studio.example/task/${fileId}`,
}))

const { execute } = await import("../src/execute.ts")

beforeEach(() => {
  saveTaskConfigCalls.length = 0
  saveFlowNodeConfigCalls.length = 0
  saveFlowNodeContentCalls.length = 0
  submitFlowCalls.length = 0
  taskPreCheckCalls.length = 0
  checkFlowSubmitStatusCalls.length = 0
  bindFlowNodeCalls.length = 0
  failNodeConfigDetail = false
  flowPreCheckPass = true
  flowSubmitStatus = 2
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(profileFile, "[profiles.test]\npat = 'pat'\nworkspace = 'ws'\ninstance = 'inst'\n")
  process.env.CLICKZETTA_TEST_HOME = home
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  rmSync(home, { recursive: true, force: true })
})

describe("condition task contracts", () => {
  test("standalone condition save-config derives branch outputs from conditionConfig", async () => {
    const result = await execute("task save-config 13392003 --vc AUTO_STOP_TEST_01")

    expect(result.exitCode).toBe(0)
    const outputs = saveTaskConfigCalls[0]?.dataFileOutputListReqs as Record<string, unknown>[]
    expect(outputs.map((item) => item.refTableName).sort()).toEqual([
      "branch_missing",
      "branch_success",
      "default_branch",
    ])
    expect(outputs[0]).toMatchObject({
      projectId: 60001,
      dataFileId: saveTaskConfigCalls[0]?.dataFileId,
      dataFileName: "test_condition",
      parseType: 2,
    })
  })

  test("flow condition node-save-config derives branch outputs from conditionConfig", async () => {
    const result = await execute("task flow node-save-config 13412004 --node-id 13412005 --vc AUTO_STOP_TEST_01")

    expect(result.exitCode).toBe(0)
    const outputs = saveFlowNodeConfigCalls[0]?.dataFileOutputListReqs as Record<string, unknown>[]
    expect(outputs.map((item) => item.refTableName).sort()).toEqual([
      "branch_missing",
      "branch_success",
      "default_branch",
    ])
    expect(outputs[0]).toMatchObject({
      projectId: 60001,
      dataFileId: saveFlowNodeConfigCalls[0]?.dataFileId,
      dataFileName: "condition_node",
      parseType: 2,
    })
    expect(String(outputs[0]?.fileShowName)).toMatch(/^wanxin-test-ws-03\..+\.condition_node$/)
  })

  test("flow node-save-config sends Studio weekly selected-day schedule fields", async () => {
    const result = await execute('task flow node-save-config 13412004 --node-id 13412005 --cron "0 00 07 ? * MON-FRI *"')

    expect(result.exitCode).toBe(0)
    expect(saveFlowNodeConfigCalls[0]).toMatchObject({
      cronExpress: "0 00 07 ? * 1,2,3,4,5 *",
      scheduleRateType: 3,
      schedule: [
        ["weekly", "1"],
        ["weekly", "2"],
        ["weekly", "3"],
        ["weekly", "4"],
        ["weekly", "5"],
      ],
      frequency: "1",
      activeEndTime: "2099-01-01T00:00:00.000Z",
      isScheduleRateTypeOff: false,
      useActiveEndTime: false,
      enableAutoMv: false,
    })
    const scheduleStartTime = new Date(String(saveFlowNodeConfigCalls[0]?.scheduleStartTime))
    expect(scheduleStartTime.getHours()).toBe(7)
    expect(scheduleStartTime.getMinutes()).toBe(0)
  })

  test("flow bind --branch records the selected condition branch on the downstream config", async () => {
    const result = await execute("task flow bind 13412004 --upstream condition_node --downstream succ_node --branch branch_success")

    expect(result.exitCode).toBe(0)
    expect(bindFlowNodeCalls[0]).toMatchObject({
      currentNodeId: 13412006,
      dependencyNodeId: 13412005,
    })
    expect(bindFlowNodeCalls[0]?.currentFileId).toBe(bindFlowNodeCalls[0]?.dependencyFileId)
    const deps = saveFlowNodeConfigCalls[0]?.dataFileInputListReqs as Record<string, unknown>[]
    expect(deps).toEqual([
      {
        dependencyProjectId: 60001,
        dependencyFileId: bindFlowNodeCalls[0]?.currentFileId,
        dependencyInputName: expect.stringMatching(/^wanxin-test-ws-03\..+\.condition_node$/),
        refTableNames: "branch_success",
        parseType: 1,
        dependencyNodeId: 13412005,
        dependencyNodeName: "condition_node",
        sequence: "seq-success",
      },
    ])
  })

  test("flow submit refreshes each child node content with concrete vc and schema config", async () => {
    const result = await execute("task flow submit 13412004 --vc AUTO_STOP_TEST_01")

    expect(result.exitCode).toBe(0)
    expect(saveTaskConfigCalls[0]).toMatchObject({
      dataFileName: "condition_flow",
      etlVcCode: "AUTO_STOP_TEST_01",
      etlVcId: "1664618098965906057",
    })
    expect(saveFlowNodeContentCalls).toHaveLength(2)
    const conditionSave = saveFlowNodeContentCalls.find((call) => call.nodeId === 13412005)
    const sqlSave = saveFlowNodeContentCalls.find((call) => call.nodeId === 13412006)
    expect(conditionSave).toMatchObject({
      nodeId: 13412005,
      dataFileContent: conditionContent,
      schemaName: "public",
      vcCode: "AUTO_STOP_TEST_01",
      vcId: "1664618098965906057",
    })
    expect(conditionSave?.paramValueList).toEqual([
      { paramKey: "paramsA", paramValue: "1", paramType: "auto", ignore: false, encrypt: false, ref: 0 },
    ])
    expect(sqlSave).toMatchObject({
      nodeId: 13412006,
      dataFileContent: "select 1;",
      schemaName: "public",
      vcCode: "NODE_SQL_VC",
      vcId: "node-sql-vc-id",
    })
    expect(submitFlowCalls).toEqual([
      {
        commitMsg: "Published flow via cz-cli",
        fileId: 13412004,
        projectId: 60001,
        env: "prod",
      },
    ])
    expect(taskPreCheckCalls).toEqual([
      {
        fileIds: [13412004],
        projectId: 60001,
      },
    ])
    expect(checkFlowSubmitStatusCalls).toEqual([
      { submitTraceId: "trace-flow-001" },
    ])
  })

  test("flow submit fails instead of overwriting child node config when node config detail cannot be loaded", async () => {
    failNodeConfigDetail = true

    const result = await execute("task flow submit 13412004 --vc AUTO_STOP_TEST_01")

    expect(result.exitCode).toBe(1)
    expect(submitFlowCalls).toHaveLength(0)
    expect(saveFlowNodeContentCalls.some((call) => call.nodeId === 13412006)).toBe(false)
  })

  test("flow submit stops when workspace param pre-check fails", async () => {
    flowPreCheckPass = false

    const result = await execute("task flow submit 13412004 --vc AUTO_STOP_TEST_01")

    expect(result.exitCode).toBe(1)
    expect(submitFlowCalls).toHaveLength(0)
    expect(checkFlowSubmitStatusCalls).toHaveLength(0)
  })

  test("flow submit returns error when async submit status becomes failed", async () => {
    flowSubmitStatus = 3

    const result = await execute("task flow submit 13412004 --vc AUTO_STOP_TEST_01")

    expect(result.exitCode).toBe(1)
    expect(submitFlowCalls).toHaveLength(1)
    expect(checkFlowSubmitStatusCalls).toEqual([
      { submitTraceId: "trace-flow-001" },
    ])
  })
})
