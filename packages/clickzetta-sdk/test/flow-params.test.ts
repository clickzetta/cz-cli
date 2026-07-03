import { describe, expect, mock, test } from "bun:test"
import type { StudioConfig } from "../src/types/index.js"

const studioRequestMock = mock(async () => ({ code: "200", data: null }))

mock.module("../src/studio/client.js", () => ({
  studioRequest: studioRequestMock,
}))

import { saveFlowNodeContent } from "../src/studio/flow.js"

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

function lastBody(): Record<string, unknown> {
  return studioRequestMock.mock.calls[0]?.[2] as Record<string, unknown>
}

describe("saveFlowNodeContent param chains", () => {
  test("defaults input/output param lists to null when not provided", async () => {
    studioRequestMock.mockClear()

    await saveFlowNodeContent(makeConfig(), {
      dataFileId: 100,
      nodeId: 200,
      dataFileContent: "select 1",
      projectId: 1379015,
      updateBy: "2",
      instanceName: "inst",
    })

    expect(studioRequestMock.mock.calls[0]?.[1]).toBe(
      "/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration",
    )
    const body = lastBody()
    expect(body.inputParamValueList).toBeNull()
    expect(body.outputParamValueList).toBeNull()
    expect(body.paramValueList).toEqual([])
  })

  test("passes through output param (producer side)", async () => {
    studioRequestMock.mockClear()

    const outputParamValueList = [
      { encrypt: false, id: "1", ignore: false, paramKey: "_output", paramType: "auto", paramValue: "$[output]" },
    ]
    await saveFlowNodeContent(makeConfig(), {
      dataFileId: 100,
      nodeId: 200,
      dataFileContent: "select 'a' as a",
      projectId: 1379015,
      updateBy: "2",
      instanceName: "inst",
      outputParamValueList,
    })

    const body = lastBody()
    expect(body.outputParamValueList).toEqual(outputParamValueList)
    expect(body.inputParamValueList).toBeNull()
  })

  test("passes through input param with dependency id (consumer side)", async () => {
    studioRequestMock.mockClear()

    const inputParamValueList = [
      {
        encrypt: false,
        id: "1",
        ignore: false,
        paramKey: "a",
        paramType: "auto",
        paramValue: "$[output]",
        dependencyId: "201",
        ref: 0,
      },
    ]
    await saveFlowNodeContent(makeConfig(), {
      dataFileId: 100,
      nodeId: 202,
      dataFileContent: 'select "${a}"',
      projectId: 1379015,
      updateBy: "2",
      instanceName: "inst",
      inputParamValueList,
    })

    const body = lastBody()
    expect(body.inputParamValueList).toEqual(inputParamValueList)
    expect(body.outputParamValueList).toBeNull()
  })
})
