import { beforeEach, describe, expect, test } from "bun:test"
import { onStudio, onFetch, stubStudioContext } from "./support/cz-fixtures.js"
import { clearTokenCache } from "@clickzetta/sdk"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Network-boundary test: no mock.module of our own src or of @clickzetta/sdk. The real cz-cli
// path runs and only the network boundary (globalThis.fetch) is stubbed via
// path/body fixtures. HOME/profile are isolated by test/preload.ts.
//
// Several distinct SDK calls share one backend path
// (/dataFileConfiguration/saveDataFileConfiguration). They are told apart by body:
//   - saveTaskConfig      : onlySaveContent=0, no collectType
//   - saveFlowNodeConfig  : onlySaveContent=0, collectType=2 (useFlowConfig)
//   - saveFlowNodeContent : onlySaveContent=1, collectType=2
// Likewise getTaskDetail vs getFlowNodeDetail share /dataFile/getDetail; the flow
// node call carries a `nodeId` in the body.

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
const submitTaskCalls: Array<Record<string, unknown>> = []
const bindFlowNodeCalls: Array<Record<string, unknown>> = []
let failNodeConfigDetail = false

const { execute } = await import("../src/execute.ts")

beforeEach(() => {
  clearTokenCache()
  saveTaskConfigCalls.length = 0
  saveFlowNodeConfigCalls.length = 0
  saveFlowNodeContentCalls.length = 0
  submitTaskCalls.length = 0
  bindFlowNodeCalls.length = 0
  failNodeConfigDetail = false
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'wanxin-test-ws-03'\ninstance = 'tmwmzxzs'\n",
  )
  stubStudioContext({
    userId: 12365,
    projectId: 60001,
    tenantId: 1223,
    instanceId: 32,
    workspaceName: "wanxin-test-ws-03",
  })

  // getTaskDetail (no nodeId) vs getFlowNodeDetail (has nodeId) share /dataFile/getDetail.
  onFetch({
    match: (url) => url.includes("/ide-admin/v1/dataFile/getDetail"),
    respond: (_url, _method, body) => {
      const b = (body ?? {}) as Record<string, unknown>
      if (b.nodeId !== undefined) {
        // getFlowNodeDetail
        const nodeId = Number(b.nodeId)
        return {
          code: 0,
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
        }
      }
      // getTaskDetail
      const id = Number(b.id)
      return {
        code: 0,
        data: id === 13412004
          ? { id: 13412004, dataFileName: "condition_flow", fileType: 500, fileFlowStatus: 100, deployStatus: 1 }
          : { id, dataFileName: "test_condition", fileType: 19, fileContent: conditionContent, paramValueList: [] },
      }
    },
  })

  // getTaskConfigDetail
  onFetch({
    match: (url) => url.includes("/ide-admin/v1/dataFileConfiguration/getFileConfigurationDetail"),
    respond: (_url, _method, body) => {
      const b = (body ?? {}) as Record<string, unknown>
      const nodeId = b.nodeId === undefined ? undefined : Number(b.nodeId)
      const dataFileId = Number(b.dataFileId)
      if (failNodeConfigDetail && nodeId === 13412006) {
        // Simulate a backend failure loading node config detail.
        return { code: 1, message: "node config detail failed" }
      }
      return {
        code: 0,
        data: {
          projectId: 60001,
          dataFileId,
          dataFileName: nodeId === 13412005
            ? "condition_node"
            : nodeId === 13412006
              ? "succ_node"
              : dataFileId === 13412004
                ? "condition_flow"
                : "test_condition",
          fileType: nodeId === 13412005
            ? 19
            : nodeId === 13412006
              ? 4
              : dataFileId === 13412004
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
          etlVcCode: nodeId === 13412006 ? "NODE_SQL_VC" : undefined,
          etlVcId: nodeId === 13412006 ? "node-sql-vc-id" : undefined,
          configProperties: "{}",
          dataFileDependencyDTOS: [],
          fileOutputTableDTOS: [],
        },
      }
    },
  })

  // getFlowDag — succ_node gains its dependency once a bind has been issued.
  onStudio("/ide-admin/v1/flow/getDag", () => ({
    code: 0,
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
  }))

  // bindFlowNode
  onStudio("/ide-admin/v1/flow/node/bind", (body) => {
    bindFlowNodeCalls.push(body as Record<string, unknown>)
    return { code: 0, data: { ok: true } }
  })

  // resolveVclusterId → listVclusters
  onStudio("/clickzetta-lakeconsole/api/v1/vcluster/list", () => ({
    code: 0,
    data: [
      { id: "1664618098965906057", name: "AUTO_STOP_TEST_01", type: "GENERAL" },
      { id: "node-sql-vc-id", name: "NODE_SQL_VC", type: "GENERAL" },
    ],
  }))

  // submitTask
  onStudio("/ide-admin/v1/dataFile/submit", (body) => {
    submitTaskCalls.push(body as Record<string, unknown>)
    return { code: 0, data: { ok: true } }
  })

  // saveDataFileConfiguration — one path, three callers told apart by body fields.
  onFetch({
    match: (url) => url.includes("/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration"),
    respond: (_url, _method, body) => {
      const b = (body ?? {}) as Record<string, unknown>
      const onlySaveContent = Number(b.onlySaveContent)
      const collectType = b.collectType === undefined ? undefined : Number(b.collectType)
      if (collectType === 2 && onlySaveContent === 1) saveFlowNodeContentCalls.push(b)
      else if (collectType === 2 && onlySaveContent === 0) saveFlowNodeConfigCalls.push(b)
      else if (onlySaveContent === 0) saveTaskConfigCalls.push(b)
      return { code: 0, data: { ok: true } }
    },
  })
})

describe("condition task contracts", () => {
  test("standalone condition save-config derives branch outputs from conditionConfig", async () => {
    const result = await execute("task save-config 13392003 --vc AUTO_STOP_TEST_01")

    if (result.exitCode !== 0) console.log(result.output)
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

    if (result.exitCode !== 0) console.log(result.output)
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

    if (result.exitCode !== 0) console.log(result.output)
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

    if (result.exitCode !== 0) console.log(result.output)
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

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveTaskConfigCalls[0]).toMatchObject({
      dataFileName: "condition_flow",
      etlVcCode: "AUTO_STOP_TEST_01",
      etlVcId: "1664618098965906057",
    })
    expect(saveFlowNodeContentCalls).toHaveLength(2)
    const conditionSave = saveFlowNodeContentCalls.find((call) => call.nodeId === 13412005)
    const sqlSave = saveFlowNodeContentCalls.find((call) => call.nodeId === 13412006)
    // saveFlowNodeContent encodes vc/schema into the adhocConfigs JSON on the wire.
    expect(conditionSave).toMatchObject({
      nodeId: 13412005,
      dataFileContent: conditionContent,
    })
    expect(JSON.parse(String(conditionSave?.adhocConfigs))).toMatchObject({
      schema: "public",
      adhocVcCode: "AUTO_STOP_TEST_01",
      adhocVcId: "1664618098965906057",
    })
    expect(conditionSave?.paramValueList).toEqual([
      { paramKey: "paramsA", paramValue: "1", paramType: "auto", ignore: false, encrypt: false, ref: 0 },
    ])
    expect(sqlSave).toMatchObject({
      nodeId: 13412006,
      dataFileContent: "select 1;",
    })
    expect(JSON.parse(String(sqlSave?.adhocConfigs))).toMatchObject({
      schema: "public",
      adhocVcCode: "NODE_SQL_VC",
      adhocVcId: "node-sql-vc-id",
    })
    expect(submitTaskCalls).toEqual([
      {
        commitMsg: "Published flow via cz-cli",
        dataFileId: 13412004,
        projectId: 60001,
        updatedBy: "12365",
      },
    ])
  })

  test("flow submit fails instead of overwriting child node config when node config detail cannot be loaded", async () => {
    failNodeConfigDetail = true

    const result = await execute("task flow submit 13412004 --vc AUTO_STOP_TEST_01")

    expect(result.exitCode).toBe(1)
    expect(submitTaskCalls).toHaveLength(0)
    expect(saveFlowNodeContentCalls.some((call) => call.nodeId === 13412006)).toBe(false)
  })
})
