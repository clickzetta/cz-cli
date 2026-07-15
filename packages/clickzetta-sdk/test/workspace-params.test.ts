import { afterAll, describe, expect, mock, test } from "bun:test"
import type { StudioConfig } from "../src/types/index.js"

// mock.module registrations persist for the rest of the process; without
// restoring, this studioRequest stub leaks into later files (e.g.
// traceparent.test.ts sees the stub instead of the real studioRequest).
// Capture the real module first and re-register it in afterAll to isolate the leak.
const realStudioClient = { ...(await import("../src/studio/client.js")) }

const studioRequestMock = mock(async () => ({ code: "200", data: null }))

mock.module("../src/studio/client.js", () => ({
  studioRequest: studioRequestMock,
}))

afterAll(() => {
  mock.module("../src/studio/client.js", () => realStudioClient)
})

import {
  addWorkspaceParam,
  deleteWorkspaceParam,
  disableWorkspaceParam,
  enableWorkspaceParam,
  listWorkspaceParams,
  updateWorkspaceParam,
} from "../src/studio/workspace-params.js"

function makeConfig(): StudioConfig {
  return {
    baseUrl: "https://test.invalid",
    token: "tok-test",
    instanceName: "inst",
    instanceId: 1,
    userId: 2,
    tenantId: 3,
    workspaceName: "ws",
  }
}

describe("workspace params API", () => {
  test("lists workspace params with Studio projectId paging body", async () => {
    studioRequestMock.mockClear()

    await listWorkspaceParams(makeConfig(), { projectId: 1379015, pageIndex: 1, pageSize: 10 })

    expect(studioRequestMock.mock.calls[0]?.[1]).toBe("/ide-admin/v1/workspaceParams/list")
    expect(studioRequestMock.mock.calls[0]?.[2]).toEqual({
      projectId: 1379015,
      pageIndex: 1,
      pageSize: 10,
    })
  })

  test("adds workspace param with Studio workspaceParams body", async () => {
    studioRequestMock.mockClear()

    await addWorkspaceParam(makeConfig(), {
      projectId: 1379015,
      paramKey: "quick_start_test_num",
      paramValue: "123",
      sourceType: 0,
      encrypt: 0,
    })

    expect(studioRequestMock.mock.calls[0]?.[1]).toBe("/ide-admin/v1/workspaceParams/add")
    expect(studioRequestMock.mock.calls[0]?.[2]).toEqual({
      projectId: 1379015,
      paramKey: "quick_start_test_num",
      paramValue: "123",
      sourceType: 0,
      encrypt: 0,
    })
  })

  test("updates workspace param with Studio workspaceParams body", async () => {
    studioRequestMock.mockClear()

    await updateWorkspaceParam(makeConfig(), {
      projectId: 1379015,
      id: 157,
      paramKey: "quick_start_test_num",
      paramValue: "456",
      sourceType: 0,
      encrypt: 0,
    })

    expect(studioRequestMock.mock.calls[0]?.[1]).toBe("/ide-admin/v1/workspaceParams/update")
    expect(studioRequestMock.mock.calls[0]?.[2]).toEqual({
      projectId: 1379015,
      id: 157,
      paramKey: "quick_start_test_num",
      paramValue: "456",
      sourceType: 0,
      encrypt: 0,
    })
  })

  test("enables workspace param through publish endpoint", async () => {
    studioRequestMock.mockClear()

    await enableWorkspaceParam(makeConfig(), { projectId: 1379015, id: 157 })

    expect(studioRequestMock.mock.calls[0]?.[1]).toBe("/ide-admin/v1/workspaceParams/publish")
    expect(studioRequestMock.mock.calls[0]?.[2]).toEqual({ projectId: 1379015, id: 157 })
  })

  test("disables workspace param through offline endpoint", async () => {
    studioRequestMock.mockClear()

    await disableWorkspaceParam(makeConfig(), { projectId: 1379015, id: 157 })

    expect(studioRequestMock.mock.calls[0]?.[1]).toBe("/ide-admin/v1/workspaceParams/offline")
    expect(studioRequestMock.mock.calls[0]?.[2]).toEqual({ projectId: 1379015, paramIds: [157] })
  })

  test("deletes workspace param through delete endpoint", async () => {
    studioRequestMock.mockClear()

    await deleteWorkspaceParam(makeConfig(), { projectId: 1379015, id: 157 })

    expect(studioRequestMock.mock.calls[0]?.[1]).toBe("/ide-admin/v1/workspaceParams/delete")
    expect(studioRequestMock.mock.calls[0]?.[2]).toEqual({ projectId: 1379015, paramIds: [157] })
  })
})
