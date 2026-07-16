import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-runs-refill-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")

const createBackfillCalls: Array<Record<string, unknown>> = []
let mockUserName = "alice"
const actualSdk = await import("@clickzetta/sdk")
const actualResolver = await import("../src/resolver.ts")
const actualStudioContext = await import("../src/commands/studio-context.ts")

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  createBackfill: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    createBackfillCalls.push(params)
    return {
      data: {
        taskInstanceId: 9001,
      },
    }
  },
}))

mock.module("../src/commands/studio-context.js", () => ({
  ...actualStudioContext,
  getStudioContext: async () => ({
    projectId: 9,
    workspaceId: "wid-1",
    userId: 7,
    userName: mockUserName,
    instanceName: "inst",
    workspaceName: "ws",
    baseUrl: "https://api.example.com",
  }),
}))

mock.module("../src/resolver.js", () => ({
  ...actualResolver,
  resolveTaskId: async () => 123,
  resolveRunIdOrTaskName: async () => 456,
}))

mock.module("../src/confirm.js", () => ({
  confirm: async () => true,
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

mock.module("../src/locale.js", () => ({
  t: () => "",
}))

mock.module("../src/commands/studio-url.js", () => ({
  studioUrl: () => "https://studio.example/task/123",
  opsUrl: () => "https://studio.example/runs/9001",
}))

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

beforeEach(() => {
  createBackfillCalls.length = 0
  mockUserName = "alice"
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(profileFile, "[profiles.test]\npat = 'pat'\nworkspace = 'ws'\ninstance = 'inst'\n")
  process.env.CLICKZETTA_TEST_HOME = home
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  rmSync(home, { recursive: true, force: true })
})

describe("runs refill", () => {
  test("sends backend-compatible operator and date range fields", async () => {
    const result = await execute("runs refill 123 --from 2026-01-01 --to 2026-01-02 --name smoke -y")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect(json.error).toBeUndefined()
    expect(createBackfillCalls).toHaveLength(1)
    expect(createBackfillCalls[0]).toMatchObject({
      scheduleTaskId: 123,
      sqlVcCode: "DEFAULT",
      projectId: 9,
      userId: 7,
      createBy: "alice",
      nextType: 0,
      complementType: 1,
      isConcurrence: 2,
      concurrenceNumber: 1,
      complementJobName: "smoke",
      dateList: [{
        bizStartDate: new Date("2026-01-01").getTime(),
        bizEndDate: new Date("2026-01-02").getTime() + 86400000 - 1,
      }],
      complementBizDateBeanList: [{
        bizStartDate: new Date("2026-01-01").getTime(),
        bizEndDate: new Date("2026-01-02").getTime() + 86400000 - 1,
      }],
    })
  })

  test("fails fast when current login context has no user name", async () => {
    mockUserName = "   "
    const result = await execute("runs refill 123 -y")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(2)
    expect(json).toEqual({
      error: {
        code: "INVALID_ARGUMENTS",
        message: "Current login does not expose a user name required by Studio refill API. Re-authenticate or refresh your profile, then retry.",
      },
    })
    expect(createBackfillCalls).toHaveLength(0)
  })

  test("rejects incomplete time boundaries before calling createBackfill", async () => {
    const result = await execute("runs refill 123 --from 2026-01-01 -y")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(2)
    expect(json).toEqual({
      error: {
        code: "INVALID_ARGUMENTS",
        message: "--from and --to must be provided together, or omit both.",
      },
    })
    expect(createBackfillCalls).toHaveLength(0)
  })
})
