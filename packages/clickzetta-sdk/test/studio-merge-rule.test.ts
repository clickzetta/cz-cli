import { afterAll, describe, expect, mock, test } from "bun:test"
import type { StudioConfig } from "../src/types/index.js"

// Restore the real client afterwards: mock.module registrations outlive this file.
const realStudioClient = { ...(await import("../src/studio/client.js")) }

const studioRequestMock = mock(async (..._args: unknown[]) => ({ code: 200, data: {} as unknown }))

mock.module("../src/studio/client.js", () => ({
  studioRequest: studioRequestMock,
}))

afterAll(() => {
  mock.module("../src/studio/client.js", () => realStudioClient)
})

import { cacheMergeRule, checkMergeRule, saveMergeTaskContent, startMergeRuleEdit } from "../src/studio/task.js"

const config: StudioConfig = {
  baseUrl: "https://test.invalid",
  token: "tok-test",
  instanceName: "inst",
  instanceId: 1,
  userId: 2,
  tenantId: 3,
  workspaceName: "ws",
}

const rule = { datasourceExpression: { exact: [7] }, dbExpression: {}, schemaExpression: { exact: ["db"] }, tableExpression: { exact: ["t1"] } }

describe("checkMergeRule", () => {
  test("starts an async check and polls its result until it finishes", async () => {
    studioRequestMock.mockReset()
    studioRequestMock
      .mockResolvedValueOnce({ code: 200, data: "uuid-1" })
      .mockResolvedValueOnce({ code: 200, data: { finish: false } })
      .mockResolvedValueOnce({ code: 200, data: { finish: true, valid: true, tableListStr: "l", tableSchemaStr: "s" } })

    const result = await checkMergeRule(
      config,
      { pipelineId: 10, projectId: 20, virtualSchema: "vs", virtualTable: "vt", pipelineRule: [rule] },
      { intervalMs: 1 },
    )

    expect(result).toMatchObject({ valid: true, tableListStr: "l", tableSchemaStr: "s" })
    const calls = studioRequestMock.mock.calls
    expect(calls).toHaveLength(3)
    expect(calls[0]?.[1]).toBe("/ide-admin/v1/timelyTask/pipeline/check/async")
    expect(calls[0]?.[2]).toEqual({
      pipelineId: 10,
      projectId: 20,
      virtualSchema: "vs",
      virtualTable: "vt",
      pipelineRule: [rule],
      heterogeneous: false,
      supportNoPK: false,
    })
    expect(calls[1]?.[1]).toBe("/ide-admin/v1/timelyTask/pipeline/check/async/result?uuid=uuid-1")
    expect(calls[1]?.[4]).toBe("GET")
  })

  test("gives up once the timeout passes", async () => {
    studioRequestMock.mockReset()
    studioRequestMock.mockResolvedValueOnce({ code: 200, data: "uuid-2" })
    studioRequestMock.mockResolvedValue({ code: 200, data: { finish: false } })

    await expect(
      checkMergeRule(
        config,
        { pipelineId: 10, projectId: 20, virtualSchema: "vs", virtualTable: "vt", pipelineRule: [rule] },
        { timeoutMs: 0, intervalMs: 1 },
      ),
    ).rejects.toThrow("uuid-2")
  })
})

describe("merge rule edit session", () => {
  test("passes the session id as czClientSessionUid on every step", async () => {
    studioRequestMock.mockReset()
    studioRequestMock.mockResolvedValue({ code: 200, data: {} })

    await startMergeRuleEdit(config, 10, "sess-1")
    await cacheMergeRule(config, "sess-1", { pipelineId: 10, virtualSchema: "vs", virtualTable: "vt", tableListStr: "l", tableSchemaStr: "s" })
    await saveMergeTaskContent(config, "sess-1", { dataFileId: 10, dataFileContent: { a: 1 }, projectId: 20, updateBy: "2", instanceName: "inst" })

    const calls = studioRequestMock.mock.calls
    expect(calls[0]?.[1]).toBe("/ide-admin/v1/timelyTask/ruleContent/start/edit?pipelineId=10")
    for (const call of calls) expect(call[3]).toEqual({ czClientSessionUid: "sess-1" })
    expect(calls[1]?.[2]).toMatchObject({ pipelineId: 10, templateType: 1, pipelineType: 2, tableListStr: "l", tableSchemaStr: "s" })
    expect(calls[2]?.[2]).toMatchObject({ dataFileId: 10, dataFileContent: '{"a":1}', onlySaveContent: 1 })
  })
})
