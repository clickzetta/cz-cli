import { afterAll, describe, expect, mock, test } from "bun:test"
import type { StudioConfig } from "../src/types/index.js"

// Restore the real client afterwards: mock.module registrations outlive this file.
const realStudioClient = { ...(await import("../src/studio/client.js")) }

const studioRequestMock = mock(async () => ({ code: 200, data: [] }))

mock.module("../src/studio/client.js", () => ({
  studioRequest: studioRequestMock,
}))

afterAll(() => {
  mock.module("../src/studio/client.js", () => realStudioClient)
})

import { getTableSyncStatus } from "../src/studio/task.js"

const config: StudioConfig = {
  baseUrl: "https://test.invalid",
  token: "tok-test",
  instanceName: "inst",
  instanceId: 1,
  userId: 2,
  tenantId: 3,
  workspaceName: "ws",
}

describe("getTableSyncStatus", () => {
  test("posts the pipeline and target tables to rocket with the tenant", async () => {
    studioRequestMock.mockClear()

    await getTableSyncStatus(config, 100, [{ schema: "s", table: "t" }])

    const [, path, body] = studioRequestMock.mock.calls[0] as unknown as [StudioConfig, string, unknown]
    expect(path).toBe("/clickzetta-rocket/api/v1/ops/inner/table/syncStatus?tenantId=3")
    expect(body).toEqual({ taskPipelineId: 100, targetTables: [{ schema: "s", table: "t" }] })
  })

  test("omits targetTables to ask for every table", async () => {
    studioRequestMock.mockClear()

    await getTableSyncStatus(config, 100)

    expect(studioRequestMock.mock.calls[0]?.[2]).toEqual({ taskPipelineId: 100 })
  })
})
