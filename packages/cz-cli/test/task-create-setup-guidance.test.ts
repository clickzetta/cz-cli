import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-task-create-setup-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")

const actualSdk = await import("@clickzetta/sdk")
const actualResolver = await import("../src/resolver.ts")

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  listTasks: async () => ({ data: { list: [], total: 0, totalPages: 0 } }),
  createTask: async () => ({ data: 12345 }),
}))

const actualStudioContext = await import("../src/commands/studio-context.ts")

mock.module("../src/commands/studio-context.js", () => ({
  ...actualStudioContext,
  getStudioContext: async () => ({
    projectId: 60001,
    workspaceId: "workspace-1",
    userId: 12365,
    tenantId: 1223,
    instanceId: 32,
    instanceName: "inst",
    workspaceName: "ws",
    baseUrl: "https://dev-api.clickzetta.com",
    token: "token",
    env: "prod",
  }),
}))

mock.module("../src/resolver.js", () => ({
  ...actualResolver,
  resolveFolderIdByName: async () => 389001,
}))

mock.module("../src/logger.js", () => ({ logOperation: () => {} }))

const { execute } = await import("../src/execute.ts")

function payload(output: string): Record<string, unknown> {
  const start = output.indexOf("{")
  const end = output.lastIndexOf("}")
  return JSON.parse(output.slice(start, end + 1)) as Record<string, unknown>
}

beforeEach(() => {
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(profileFile, "[profiles.test]\npat = 'pat'\nworkspace = 'ws'\ninstance = 'inst'\n")
  process.env.CLICKZETTA_TEST_HOME = home
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  rmSync(home, { recursive: true, force: true })
})

describe("task create-setup UI-only next-step guidance", () => {
  test("MULTI_DI guides to `task integration setup`", async () => {
    const result = await execute("task create-setup di_job --type MULTI_DI --folder 389001")
    expect(result.exitCode).toBe(0)
    const envelope = payload(result.output)
    const data = envelope.data as Record<string, unknown>
    expect(String(envelope.ai_message)).toContain("task integration setup")
    expect(data.task_id).toBe(12345)
    expect(typeof data.studio_url).toBe("string")
    expect(String(data.studio_url)).toContain("12345")
    expect(data.content_saved).toBe(false)
    expect(data.cron_saved).toBe(false)
  })

  test("single-table INTEGRATION guides to `task integration setup`", async () => {
    const result = await execute("task create-setup di_single --type INTEGRATION --folder 389001")
    expect(result.exitCode).toBe(0)
    expect(String(payload(result.output).ai_message)).toContain("task integration setup")
  })

  test("MULTI_REALTIME guides to a realtime-sync command", async () => {
    const result = await execute("task create-setup ri_job --type MULTI_REALTIME --folder 389001")
    expect(result.exitCode).toBe(0)
    const msg = String(payload(result.output).ai_message)
    expect(msg).toContain("create-realtime-sync")
    expect(msg).not.toContain("task integration setup")
  })

  test("REALTIME guides to `create-stream-sync`", async () => {
    const result = await execute("task create-setup cdc_job --type REALTIME --folder 389001")
    expect(result.exitCode).toBe(0)
    const msg = String(payload(result.output).ai_message)
    expect(msg).toContain("create-stream-sync")
    expect(msg).not.toContain("task integration setup")
  })

  test("MERGE guides to `save-merge`", async () => {
    const result = await execute("task create-setup merge_job --type MERGE --folder 389001")
    expect(result.exitCode).toBe(0)
    const msg = String(payload(result.output).ai_message)
    expect(msg).toContain("save-merge")
    expect(msg).not.toContain("task integration setup")
  })

  test("FLOW guides to the flow command group", async () => {
    const result = await execute("task create-setup flow_job --type FLOW --folder 389001")
    expect(result.exitCode).toBe(0)
    const msg = String(payload(result.output).ai_message)
    expect(msg).toContain("flow")
    expect(msg).not.toContain("task integration setup")
  })

  test("pure-UI SPARK keeps the Studio guidance and no integration setup hint", async () => {
    const result = await execute("task create-setup spark_job --type SPARK --folder 389001")
    expect(result.exitCode).toBe(0)
    const msg = String(payload(result.output).ai_message)
    expect(msg).toContain("Studio")
    expect(msg).not.toContain("task integration setup")
  })

  test("STREAMING has no matching command, must not mislead to stream-sync", async () => {
    const result = await execute("task create-setup stream_job --type STREAMING --folder 389001")
    expect(result.exitCode).toBe(0)
    const msg = String(payload(result.output).ai_message)
    expect(msg).toContain("Studio")
    expect(msg).not.toContain("create-stream-sync")
    expect(msg).not.toContain("task integration setup")
  })
})
