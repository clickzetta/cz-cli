import { beforeEach, describe, expect, test } from "bun:test"
import { onStudio, onFetch, stubStudioContext } from "./support/cz-fixtures.js"
import { clearTokenCache } from "@clickzetta/sdk"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Network-boundary test: no mock.module of our own src or of @clickzetta/sdk. The real cz-cli
// path runs and only the network boundary (globalThis.fetch) is stubbed via
// path/body fixtures. HOME/profile are isolated by test/preload.ts.

const saveCalls: Array<Record<string, unknown>> = []
const parseCalls: Array<Record<string, unknown>> = []
const outputDtos = [
  {
    projectId: 9,
    dataFileId: 123,
    dataFileVersion: 0,
    dataFileName: "lineage_smoke",
    fileShowName: "ws.lineage_smoke",
    refTableName: "ws.public.lineage_smoke_out",
    parseType: 2,
  },
]
const manualOutputDtos = [
  {
    projectId: 9,
    dataFileId: 123,
    dataFileVersion: 0,
    dataFileName: "lineage_smoke",
    ownerCnName: "owner-cn",
    ownerEnName: "owner-en",
    fileShowName: "ws.manual_output",
    refTableName: "ws.public.manual_output",
    parseType: 1,
  },
]

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

beforeEach(() => {
  clearTokenCache()
  saveCalls.length = 0
  parseCalls.length = 0
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'ws'\ninstance = 'inst'\n",
  )
  stubStudioContext({ userId: 7, projectId: 9, workspaceId: "wid-1" as unknown as number, workspaceName: "ws" })

  // getTaskDetail
  onStudio("/ide-admin/v1/dataFile/getDetail", () => ({
    code: 0,
    data: {
      id: 123,
      fileType: 4,
      dataFileName: "lineage_smoke",
      fileContent: "create table lineage_smoke_out as select * from upstream_table;",
      ownerCnName: "owner-cn",
      ownerEnName: "owner-en",
    },
  }))
  // getTaskConfigDetail
  onStudio("/ide-admin/v1/dataFileConfiguration/getFileConfigurationDetail", () => ({
    code: 0,
    data: {
      cronExpress: "0 00 00 * * ? *",
      activeStartTime: "2026-01-01T00:00:00.000Z",
      activeEndTime: "2099-01-01T00:00:00.000Z",
      schedule: [["weekly", "1"], ["weekly", "2"]],
      frequency: "1",
      scheduleStartTime: "2026-01-01T07:00:00.000Z",
      isScheduleRateTypeOff: false,
      useActiveEndTime: false,
      schemaName: "public",
      etlVcCode: "DEFAULT",
      retryCount: 1,
      retryIntervalTime: 1,
      retryIntervalTimeUnit: "m",
      rerunProperty: 3,
      selfDependsJob: 0,
      executeTimeout: 0,
      executeTimeoutUnit: "m",
      dataFileDependencyDTOS: [],
      fileOutputTableDTOS: outputDtos,
      configProperties: "{}",
    },
  }))
  // parseTaskDependencyOut
  onStudio("/ide-admin/v1/dataFileConfiguration/parseDataFileDependencyOut", (body) => {
    parseCalls.push(body as Record<string, unknown>)
    return {
      code: 0,
      data: {
        dataFileDependencyDTOS: [
          {
            dependencyProjectId: 9,
            dependencyFileId: 456,
            dependencyFileVersion: 1,
            dependencyFileName: "upstream",
            dependencyInputName: "ws.upstream",
            refTableNames: "ws.public.upstream_table",
            parseType: 2,
          },
        ],
        fileOutputTableDTOS: outputDtos,
      },
    }
  })
  // resolveVclusterId → listVclusters (DEFAULT → vc-default-id)
  onStudio("/clickzetta-lakeconsole/api/v1/vcluster/list", () => ({
    code: 0,
    data: [{ id: "vc-default-id", name: "DEFAULT", type: "GENERAL" }],
  }))
  // saveDataFileConfiguration — capture only config saves (onlySaveContent=0)
  onFetch({
    match: (url) => url.includes("/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration"),
    respond: (_url, _method, body) => {
      const b = (body ?? {}) as Record<string, unknown>
      if (Number(b.onlySaveContent) === 0) saveCalls.push(b)
      return { code: 0, data: { ok: true } }
    },
  })
})

describe("task save-config dependency validation", () => {
  test("requires at least one explicit save-config option", async () => {
    const result = await execute("task save-config 123")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(2)
    expect(json).toEqual({
      error: {
        code: "INVALID_ARGUMENTS",
        message: "At least one configuration option is required.",
      },
    })
    expect(saveCalls).toHaveLength(0)
    expect(parseCalls).toHaveLength(0)
  })

  test("fails fast when a dependency item is missing taskId", async () => {
    const result = await execute(`task save-config 123 --deps replace --dep-tasks '[{"taskName":"upstream"}]'`)
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json).toEqual({
      error: {
        code: "INVALID_ARGUMENTS",
        message: "--dep-tasks[0]: taskId is required",
      },
    })
    expect(saveCalls).toHaveLength(0)
    expect(parseCalls).toHaveLength(0)
  })

  test("fails fast when a dependency item is missing taskName", async () => {
    const result = await execute(`task save-config 123 --deps replace --dep-tasks '[{"taskId":456}]'`)
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json).toEqual({
      error: {
        code: "INVALID_ARGUMENTS",
        message: "--dep-tasks[0]: taskName is required",
      },
    })
    expect(saveCalls).toHaveLength(0)
    expect(parseCalls).toHaveLength(0)
  })

  test("save-config keeps existing lineage unless auto-lineage is enabled", async () => {
    const result = await execute("task save-config 123 --retry-count 2")

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(parseCalls).toHaveLength(0)
    expect(saveCalls[0]?.dataFileInputListReqs).toEqual([])
    expect(saveCalls[0]?.dataFileOutputListReqs).toEqual(outputDtos)
    expect(saveCalls[0]).toMatchObject({
      ownerCnName: "owner-cn",
      ownerEnName: "owner-en",
      etlVcCode: "DEFAULT",
      etlVcId: "vc-default-id",
    })
  })

  test("save-config parses lineage only when auto-lineage is enabled", async () => {
    const result = await execute("task save-config 123 --retry-count 2 --auto-lineage")

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(parseCalls[0]).toMatchObject({
      projectId: 9,
      workspaceId: "wid-1",
      schemaName: "public",
      dataFileContent: "create table lineage_smoke_out as select * from upstream_table;",
      dataFileId: 123,
    })
    expect(saveCalls[0]?.dataFileInputListReqs).toEqual([
      expect.objectContaining({
        dependencyFileId: 456,
        dependencyFileName: "upstream",
        depStrategy: 0,
      }),
    ])
    expect(saveCalls[0]?.dataFileOutputListReqs).toEqual(outputDtos)
    expect(saveCalls[0]).toMatchObject({
      ownerCnName: "owner-cn",
      ownerEnName: "owner-en",
      etlVcCode: "DEFAULT",
      etlVcId: "vc-default-id",
    })
  })

  test("save-cron keeps existing lineage by default and resolves DEFAULT virtual cluster ID", async () => {
    const result = await execute('task save-cron 123 --cron "0 30 2 * * ? *"')

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(parseCalls).toHaveLength(0)
    expect(saveCalls[0]?.dataFileInputListReqs).toEqual([])
    expect(saveCalls[0]?.dataFileOutputListReqs).toEqual(outputDtos)
    expect(saveCalls[0]).toMatchObject({
      ownerCnName: "owner-cn",
      ownerEnName: "owner-en",
      etlVcCode: "DEFAULT",
      etlVcId: "vc-default-id",
    })
  })

  test("save-cron sends Studio weekly selected-day schedule fields", async () => {
    const result = await execute('task save-cron 123 --cron "0 00 07 ? * MON-FRI *"')

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveCalls[0]).toMatchObject({
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
      isScheduleRateTypeOff: false,
      useActiveEndTime: false,
      enableAutoMv: false,
    })
    expect(saveCalls[0]?.scheduleStartTime).toBe(new Date(2026, 0, 1, 7, 0, 0, 0).toISOString())
  })

  test("save-config preserves existing Studio schedule UI fields", async () => {
    const result = await execute("task save-config 123 --retry-count 2")

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveCalls[0]).toMatchObject({
      schedule: [["weekly", "1"], ["weekly", "2"]],
      frequency: "1",
      scheduleStartTime: "2026-01-01T07:00:00.000Z",
      isScheduleRateTypeOff: false,
      useActiveEndTime: false,
    })
  })

  test("save-cron parses lineage only when auto-lineage is enabled", async () => {
    const result = await execute('task save-cron 123 --cron "0 30 2 * * ? *" --auto-lineage')

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(parseCalls).toHaveLength(1)
    expect(saveCalls[0]?.dataFileInputListReqs).toEqual([
      expect.objectContaining({
        dependencyFileId: 456,
        depStrategy: 0,
      }),
    ])
    expect(saveCalls[0]?.dataFileOutputListReqs).toEqual(outputDtos)
    expect(saveCalls[0]).toMatchObject({
      ownerCnName: "owner-cn",
      ownerEnName: "owner-en",
      etlVcCode: "DEFAULT",
      etlVcId: "vc-default-id",
    })
  })

  test("save-config replaces output tables from manual output parameters", async () => {
    const result = await execute(`task save-config 123 --outputs replace --output-tables '[{"outputTableName":"ws.manual_output","refTableName":"ws.public.manual_output"}]'`)

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(parseCalls).toHaveLength(0)
    expect(saveCalls[0]?.dataFileOutputListReqs).toEqual(manualOutputDtos)
  })

  test("save-cron clears output tables from manual output action", async () => {
    const result = await execute('task save-cron 123 --cron "0 30 2 * * ? *" --outputs clear')

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(parseCalls).toHaveLength(0)
    expect(saveCalls[0]?.dataFileOutputListReqs).toEqual([])
  })

  test("recovers output tables when the runtime splits the JSON into fragments", async () => {
    // Stripped quotes + an internal space cause the shell/agent to split the value
    // into a separate positional fragment, which previously failed with "Unknown command".
    const result = await execute("task save-schedule 123 --outputs replace --output-tables [{outputTableName:ws.manual_output, refTableName:ws.public.manual_output}]")

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveCalls[0]?.dataFileOutputListReqs).toEqual(manualOutputDtos)
  })

  test("recovers output tables when quotes are stripped without a split", async () => {
    const result = await execute("task save-config 123 --outputs replace --output-tables [{outputTableName:ws.manual_output,refTableName:ws.public.manual_output}]")

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveCalls[0]?.dataFileOutputListReqs).toEqual(manualOutputDtos)
  })

  test("recovers output tables from a backslash-escaped, split blob", async () => {
    const result = await execute("task save-schedule 123 --outputs replace --output-tables [{outputTableName\\:\\ws.manual_output\\,\\refTableName\\:\\ws.public.manual_output\\}]")

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveCalls[0]?.dataFileOutputListReqs).toEqual(manualOutputDtos)
  })

  test("returns INVALID_ARGUMENTS when output-tables cannot be parsed or recovered", async () => {
    const result = await execute("task save-schedule 123 --outputs replace --output-tables not-json-at-all")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect((json.error as Record<string, unknown>)?.code).toBe("INVALID_ARGUMENTS")
    expect(saveCalls).toHaveLength(0)
  })
})
