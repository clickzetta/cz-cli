import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-task-create-condition-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")
const createCalls: Array<Record<string, unknown>> = []

const actualSdk = await import("@clickzetta/sdk")
const actualResolver = await import("../src/resolver.ts")

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  listTasks: async () => ({ data: { list: [], total: 0, totalPages: 0 } }),
  createTask: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    createCalls.push(params)
    return { data: 12345 }
  },
}))

mock.module("../src/commands/studio-context.js", () => ({
  getStudioContext: async () => ({
    projectId: 60001,
    workspaceId: "workspace-1",
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
}))

mock.module("../src/resolver.js", () => ({
  ...actualResolver,
  resolveFolderIdByName: async () => 389001,
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

mock.module("../src/studio-url.js", () => ({
  studioUrl: () => "https://studio.example/task/12345",
}))

const { execute } = await import("../src/execute.ts")

beforeEach(() => {
  createCalls.length = 0
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(profileFile, "[profiles.test]\npat = 'pat'\nworkspace = 'ws'\ninstance = 'inst'\n")
  process.env.CLICKZETTA_TEST_HOME = home
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  rmSync(home, { recursive: true, force: true })
})

describe("task create condition", () => {
  test("maps CONDITION to Studio fileType 19", async () => {
    const result = await execute("task create studi_test_1testif_20260628011624 --type CONDITION --folder 389001")

    expect(result.exitCode).toBe(0)
    expect(createCalls).toEqual([
      {
        fileType: "19",
        createdBy: "12365",
        projectId: 60001,
        dataFileName: "studi_test_1testif_20260628011624",
        fileDescription: undefined,
        dataFolderId: 389001,
        workspaceName: "wanxin-test-ws-03",
      },
    ])
  })
})
