import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-task-flow-temp-run-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")

const executeFlowCalls: Array<Record<string, unknown>> = []

const actualSdk = await import("@clickzetta/sdk")
const actualResolver = await import("../src/resolver.ts")
const actualStudioContext = await import("../src/commands/studio-context.ts")

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  resolveVclusterId: async (_config: Record<string, unknown>, vcCode: string) => `${vcCode}-id`,
  getTaskDetail: async () => ({
    data: {
      id: 13585004,
      dataFileName: "codex_ext_ds_gate_pub_194321",
      fileType: 500,
      paramValueList: [
        { paramKey: "ds", paramValue: "2026-07-15", paramType: "manual", encrypt: false, ignore: false, ref: 0 },
      ],
    },
  }),
  getFlowParams: async () => ({
    data: {
      children: [
        { id: 13585005, name: "checkpoint_gate" },
        { id: 13585006, name: "definition_probe" },
      ],
    },
  }),
  getFlowNodeDetail: async (_config: Record<string, unknown>, _flowId: number, nodeId: number) => ({
    data: {
      nodeId,
      paramValueList: nodeId === 13585005
        ? [{ paramKey: "ds", paramValue: "2026-07-01", paramType: "manual", encrypt: false, ignore: false, ref: 0 }]
        : [],
    },
  }),
  executeFlow: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    executeFlowCalls.push(params)
    return {
      data: {
        scheduleInstanceId: 880001,
        sessionId: 770001,
      },
    }
  },
}))

mock.module("../src/commands/studio-context.js", () => ({
  ...actualStudioContext,
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
}))

mock.module("../src/resolver.js", () => ({
  ...actualResolver,
  resolveTaskId: async () => 13585004,
  resolveNodeId: async () => 0,
  resolveFolderIdByName: async () => 0,
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

const { execute } = await import("../src/execute.ts")

beforeEach(() => {
  executeFlowCalls.length = 0
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(profileFile, "[profiles.test]\npat = 'pat'\nworkspace = 'ws'\ninstance = 'inst'\n")
  process.env.CLICKZETTA_TEST_HOME = home
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  rmSync(home, { recursive: true, force: true })
})

describe("task flow temp-run command", () => {
  test("temp-run returns TEMP semantics and schedule validation guidance", async () => {
    const result = await execute("task flow temp-run 13585004 --vc DEFAULT --param ds=2026-07-16 --format json")

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data).toMatchObject({
      schedule_instance_id: 880001,
      session_id: 770001,
      run_type_name: "TEMP",
    })
    expect(parsed.ai_message).toContain("TEMP instance")
    expect(parsed.ai_message).toContain("does not create a formal SCHEDULE run")
    expect(parsed.ai_message).toContain("runs list --task 13585004 --run-type SCHEDULE")
    expect(parsed.ai_message).toContain("attempts list --run-id <schedule_run_id>")
    expect(executeFlowCalls[0]).toMatchObject({
      dataFileId: 13585004,
      vcCode: "DEFAULT",
      vcId: "DEFAULT-id",
    })
  })
})
