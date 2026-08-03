import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-integration-vc-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")

const saveContentCalls: Array<Record<string, unknown>> = []
let vclusters: Array<{ id: string; name: string; type: string }> = []

const actualSdk = await import("@clickzetta/sdk")
const actualResolver = await import("../src/resolver.ts")

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  listVclusters: async () => vclusters,
  resolveVclusterId: async (_c: unknown, name: string) =>
    vclusters.find((v) => v.name === name || v.id === name)?.id,
  saveTaskContent: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    saveContentCalls.push(params)
    return { data: true }
  },
}))

const actualStudioContext = await import("../src/commands/studio-context.ts")
mock.module("../src/commands/studio-context.js", () => ({
  ...actualStudioContext,
  getStudioContext: async () => ({
    projectId: 1417759,
    workspaceId: 1,
    userId: "studi_test_1",
    instanceName: "tmwmzxzs",
    workspaceName: "quick_start",
    baseUrl: "https://api.example.com",
  }),
}))

const actualDatasource = await import("../src/commands/datasource.ts")
mock.module("../src/commands/datasource.js", () => ({
  ...actualDatasource,
  resolveDatasource: async (_c: unknown, nameOrId: string) =>
    nameOrId === "mysql_src"
      ? { id: 100, name: "mysql_src", dsType: 5 }
      : { id: 200, name: "lakehouse_sink", dsType: 1 },
}))

mock.module("../src/resolver.js", () => ({
  ...actualResolver,
  resolveTaskId: async (_config: unknown, nameOrId: string) =>
    nameOrId === "multi_task" ? 555001 : Number(nameOrId),
}))

mock.module("../src/logger.js", () => ({ logOperation: () => {} }))

const actualStudioUrl = await import("../src/commands/studio-url.ts")
mock.module("../src/commands/studio-url.js", () => ({
  ...actualStudioUrl,
  studioUrl: (_c: unknown, fileId: number) => `https://studio.example/task/${fileId}`,
}))

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

beforeEach(() => {
  saveContentCalls.length = 0
  vclusters = [
    { id: "vc-int-1", name: "SYNC_VC", type: "INTEGRATION" },
    { id: "vc-gen-1", name: "GENERAL_VC", type: "GENERAL" },
  ]
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(profileFile, "[profiles.test]\npat = 'pat'\nworkspace = 'quick_start'\ninstance = 'tmwmzxzs'\n")
  process.env.CLICKZETTA_TEST_HOME = home
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  rmSync(home, { recursive: true, force: true })
})

const BASE =
  "task integration setup multi_task --sync-type multi " +
  "--source-datasource mysql_src --source-schema db1 --source-tables t1,t2 " +
  "--sink-datasource lakehouse_sink --sink-schema public --format json"

describe("integration setup: sync VC persistence", () => {
  test("persists adhocConfigs with adhocVcCode/adhocVcId for an INTEGRATION VC", async () => {
    const result = await execute(`${BASE} --vc SYNC_VC`)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)

    expect(saveContentCalls.length).toBe(1)
    const saved = saveContentCalls[0]!
    expect(saved.adhocConfigs).toBeDefined()
    const adhoc = JSON.parse(String(saved.adhocConfigs)) as Record<string, unknown>
    expect(adhoc).toMatchObject({
      multiDataSource: [],
      schema: "public",
      adhocVcCode: "SYNC_VC",
      adhocVcId: "vc-int-1",
    })
  })

  test("rejects a non-INTEGRATION VC and lists available sync VCs", async () => {
    const result = await execute(`${BASE} --vc GENERAL_VC`)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("INTEGRATION")
    expect(result.output).toContain("SYNC_VC")
    expect(saveContentCalls.length).toBe(0)
  })

  test("auto-picks the sole INTEGRATION VC when none is provided", async () => {
    const result = await execute(BASE)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveContentCalls.length).toBe(1)
    const adhoc = JSON.parse(String(saveContentCalls[0]!.adhocConfigs)) as Record<string, unknown>
    expect(adhoc).toMatchObject({ adhocVcCode: "SYNC_VC", adhocVcId: "vc-int-1" })
  })

  test("errors when no INTEGRATION VC exists in the workspace", async () => {
    vclusters = [{ id: "vc-gen-1", name: "GENERAL_VC", type: "GENERAL" }]
    const result = await execute(BASE)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("INTEGRATION")
    expect(saveContentCalls.length).toBe(0)
  })

  test("errors and lists options when multiple INTEGRATION VCs exist and none is chosen", async () => {
    vclusters = [
      { id: "vc-int-1", name: "SYNC_VC", type: "INTEGRATION" },
      { id: "vc-int-2", name: "SYNC_VC_2", type: "INTEGRATION" },
    ]
    const result = await execute(BASE)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("SYNC_VC")
    expect(result.output).toContain("SYNC_VC_2")
    expect(saveContentCalls.length).toBe(0)
  })

  test("whole_db sync also persists the INTEGRATION sync VC", async () => {
    const result = await execute(
      "task integration setup multi_task --sync-type whole_db " +
        "--source-datasource mysql_src --source-schema db1 --source-dbs db1,db2 " +
        "--sink-datasource lakehouse_sink --sink-schema public --vc SYNC_VC --format json",
    )
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    const adhoc = JSON.parse(String(saveContentCalls[0]!.adhocConfigs)) as Record<string, unknown>
    expect(adhoc).toMatchObject({ adhocVcCode: "SYNC_VC", adhocVcId: "vc-int-1" })
    const data = firstJson(result.output).data as Record<string, unknown>
    expect(data.vc).toBe("SYNC_VC")
  })
})
