import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-task-save-config-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")

const saveCalls: Array<Record<string, unknown>> = []
const actualSdk = await import("@clickzetta/sdk")
const actualResolver = await import("../src/resolver.ts")
const actualDatasource = await import("../src/commands/datasource.ts")

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  getTaskConfigDetail: async () => ({
    data: {
      cronExpress: "0 00 00 * * ? *",
      activeStartTime: "2026-01-01T00:00:00.000Z",
      activeEndTime: "2099-01-01T00:00:00.000Z",
      schemaName: "public",
      etlVcCode: "DEFAULT",
      etlVcId: 1,
      retryCount: 1,
      retryIntervalTime: 1,
      retryIntervalTimeUnit: "m",
      rerunProperty: 3,
      selfDependsJob: 0,
      executeTimeout: 0,
      executeTimeoutUnit: "m",
      dataFileDependencyDTOS: [],
      configProperties: "{}",
    },
  }),
  saveTaskConfig: async (config: Record<string, unknown>) => {
    saveCalls.push(config)
    return { data: { ok: true } }
  },
}))

mock.module("../src/commands/studio-context.js", () => ({
  getStudioContext: async () => ({
    projectId: 9,
    workspaceId: "wid-1",
    userId: 7,
    instanceName: "inst",
  }),
}))

mock.module("../src/resolver.js", () => ({
  ...actualResolver,
  resolveTaskId: async () => 123,
  resolveNodeId: async () => 456,
  resolveFolderIdByName: async () => 789,
}))

mock.module("../src/confirm.js", () => ({
  confirm: async () => true,
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

mock.module("../src/studio-url.js", () => ({
  studioUrl: () => "https://studio.example/task/123",
}))

mock.module("../src/locale.js", () => ({
  t: () => "",
}))

mock.module("../src/connection/config.js", () => ({
  resolveConnectionConfig: async () => ({}),
}))

mock.module("../src/commands/datasource.js", () => ({
  ...actualDatasource,
  resolveDatasource: async () => ({ id: 1, dsType: 15 }),
}))

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

beforeEach(() => {
  saveCalls.length = 0
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(profileFile, "[profiles.test]\npat = 'pat'\nworkspace = 'ws'\ninstance = 'inst'\n")
  process.env.CLICKZETTA_TEST_HOME = home
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  rmSync(home, { recursive: true, force: true })
})

describe("task save-config dependency validation", () => {
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
  })
})
