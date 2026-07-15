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

import { saveTaskContent } from "../src/studio/task.js"

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

describe("saveTaskContent", () => {
  test("omits paramValueList when caller does not provide it", async () => {
    studioRequestMock.mockClear()

    await saveTaskContent(makeConfig(), {
      dataFileId: 100,
      dataFileContent: "select 1",
      projectId: 200,
      updateBy: "2",
      instanceName: "inst",
      replaceEscapedChars: false,
    })

    const body = studioRequestMock.mock.calls[0]?.[2] as Record<string, unknown>
    expect(body).not.toHaveProperty("paramValueList")
  })
})
