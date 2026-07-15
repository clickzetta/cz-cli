import { afterAll, describe, expect, mock, test } from "bun:test"
import type { StudioConfig } from "../src/types/index.js"

// mock.module registrations persist for the rest of the process; without
// restoring, this studioRequest stub leaks into later files (e.g.
// traceparent.test.ts sees the stub instead of the real studioRequest).
// Capture the real module first and re-register it in afterAll to isolate the leak.
const realStudioClient = { ...(await import("../src/studio/client.js")) }

const studioRequestMock = mock(async () => ({ code: 200, data: {} }))

mock.module("../src/studio/client.js", () => ({
  studioRequest: studioRequestMock,
}))

afterAll(() => {
  mock.module("../src/studio/client.js", () => realStudioClient)
})

import {
  startCdcTables,
  stopCdcTables,
  resyncCdcTables,
  pauseCdcTables,
  recoverCdcTables,
  offlineCdcTask,
  listRealtimeTasks,
  listPipelineTables,
} from "../src/studio/task.js"

function makeConfig(): StudioConfig {
  return {
    baseUrl: "https://test.invalid",
    token: "tok-test",
    instanceName: "inst",
    instanceId: 1,
    userId: 2,
    tenantId: 3,
    workspaceName: "ws1",
  }
}

function lastCall() {
  const call = studioRequestMock.mock.calls[studioRequestMock.mock.calls.length - 1]
  return { path: call?.[1] as string, body: call?.[2] as Record<string, unknown> }
}

describe("realtime per-table ops — field naming (891f8df)", () => {
  test("start-table uses taskIds and coerces ids to ints", async () => {
    studioRequestMock.mockClear()
    await startCdcTables(makeConfig(), 7, ["101", "102"], "ws1")
    const { path, body } = lastCall()
    expect(path).toContain("/start/table")
    expect(body).toEqual({ pipelineId: 7, taskIds: [101, 102], workspace: "ws1" })
  })

  test("stop-table uses taskIds", async () => {
    studioRequestMock.mockClear()
    await stopCdcTables(makeConfig(), 7, [1], "ws1")
    const { path, body } = lastCall()
    expect(path).toContain("/stop/table")
    expect(body).toEqual({ pipelineId: 7, taskIds: [1], workspace: "ws1" })
  })

  test("resync-table uses tables (not taskIds)", async () => {
    studioRequestMock.mockClear()
    await resyncCdcTables(makeConfig(), 7, [1], "ws1")
    const { path, body } = lastCall()
    expect(path).toContain("/resync/table")
    expect(body).toEqual({ pipelineId: 7, tables: [1], workspace: "ws1" })
    expect(body).not.toHaveProperty("taskIds")
  })

  test("pause-table includes sourceTables:[]", async () => {
    studioRequestMock.mockClear()
    await pauseCdcTables(makeConfig(), 9, [5], "ws1")
    const { path, body } = lastCall()
    expect(path).toContain("/pause/cdc")
    expect(body).toEqual({ pipelineId: 9, taskIds: [5], sourceTables: [], workspace: "ws1" })
  })

  test("recover-table omits sourceTables", async () => {
    studioRequestMock.mockClear()
    await recoverCdcTables(makeConfig(), 9, [5], "ws1")
    const { path, body } = lastCall()
    expect(path).toContain("/recover/cdc")
    expect(body).toEqual({ pipelineId: 9, taskIds: [5], workspace: "ws1" })
    expect(body).not.toHaveProperty("sourceTables")
  })
})

describe("realtime task-level ops", () => {
  test("offline sends fileId + updateBy, no workspace", async () => {
    studioRequestMock.mockClear()
    await offlineCdcTask(makeConfig(), 99, "user1")
    const { path, body } = lastCall()
    expect(path).toContain("/pipeline/offline")
    expect(body).toEqual({ fileId: 99, updateBy: "user1" })
  })

  test("list realtime tasks sends projectId + taskNameLike", async () => {
    studioRequestMock.mockClear()
    await listRealtimeTasks(makeConfig(), { projectId: 200, taskNameLike: "sync" })
    const { path, body } = lastCall()
    expect(path).toContain("/timelyTask/list")
    expect(body.projectId).toBe(200)
    expect(body.taskNameLike).toBe("sync")
    expect(body.pageIndex).toBe(1)
  })

  test("list pipeline tables sends fileId; omits empty filters", async () => {
    studioRequestMock.mockClear()
    await listPipelineTables(makeConfig(), { fileId: 42 })
    const { path, body } = lastCall()
    expect(path).toContain("/micro/schedule/list")
    expect(body.fileId).toBe(42)
    expect(body).not.toHaveProperty("table")
    expect(body).not.toHaveProperty("schema")
  })
})
