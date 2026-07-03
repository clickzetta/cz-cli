import { describe, expect, mock, test } from "bun:test"
import type { StudioConfig } from "../src/types/index.js"

const studioRequestMock = mock(async () => ({ code: 200, data: {} }))

mock.module("../src/studio/client.js", () => ({
  studioRequest: studioRequestMock,
}))

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
