import { describe, expect, mock, test } from "bun:test"
import type { StudioConfig } from "../src/types/index.js"

const studioRequestMock = mock(async () => ({ code: 200, data: {} }))

mock.module("../src/studio/client.js", () => ({
  studioRequest: studioRequestMock,
}))

import {
  listDqcRules,
  createDqcSqlRule,
  getDqcRule,
  updateDqcRuleFull,
  runDqcRule,
  deleteDqcRule,
  getDqcStatistics,
  type DqcTrigger,
} from "../src/studio/dqc.js"

function makeConfig(): StudioConfig {
  return {
    baseUrl: "https://test.invalid",
    token: "tok-test",
    instanceName: "inst",
    instanceId: 1,
    workspaceId: 10,
    projectId: 20,
    userId: 2,
    tenantId: 3,
    workspaceName: "ws1",
    env: "prod",
  }
}

function restTrigger(): DqcTrigger {
  return { triggerType: "REST", triggerCron: null, mainSchedulerTaskId: null, subSchedulerTaskId: null, level: null }
}

function lastCall() {
  const call = studioRequestMock.mock.calls[studioRequestMock.mock.calls.length - 1]
  return { path: call?.[1] as string, body: call?.[2] as Record<string, unknown>, method: call?.[4] as string | undefined }
}

describe("dqc SDK — endpoints & payloads", () => {
  test("list sends projectId, LakeHouse type, sortBy; adds fuzzyObjectName only when set", async () => {
    studioRequestMock.mockClear()
    await listDqcRules(makeConfig(), { projectId: 20, fuzzyObjectName: "sales.orders", pageNum: 2, pageSize: 5 })
    const { path, body } = lastCall()
    expect(path).toBe("/clickzetta-dqc/api/v1/rule/list")
    expect(body.datasourceType).toBe("LakeHouse")
    expect(body.projectId).toBe(20)
    expect(body.workspaceId).toBe(20)
    expect(body.sortBy).toBe("create_time")
    expect(body.pageNum).toBe(2)
    expect(body.pageSize).toBe(5)
    expect(body.fuzzyObjectName).toBe("sales.orders")
  })

  test("list omits fuzzyObjectName when not provided", async () => {
    studioRequestMock.mockClear()
    await listDqcRules(makeConfig(), { projectId: 20 })
    const { body } = lastCall()
    expect(body).not.toHaveProperty("fuzzyObjectName")
    expect(body.pageNum).toBe(1)
    expect(body.pageSize).toBe(10)
  })

  test("create posts defined_sql rule with checkerInfo + vcluster", async () => {
    studioRequestMock.mockClear()
    await createDqcSqlRule(makeConfig(), {
      projectId: 20,
      objectName: "sales.orders",
      definedSql: "select count(*) from sales.orders where amount < 0",
      checkerInfo: JSON.stringify({ checker: "FIXED", operator: "EQUAL", value: 0 }),
      vcluster: "analytics_vc",
      owner: "2",
      trigger: restTrigger(),
    })
    const { path, body } = lastCall()
    expect(path).toBe("/clickzetta-dqc/api/v1/rule/add")
    expect(body.tagType).toBe(2)
    expect(body.tagCode).toBe("defined_sql")
    expect(body.objectType).toBe("TABLE")
    expect(body.vcluster).toBe("analytics_vc")
    expect(body.paramValues).toBe("[]")
    expect(body.checkerInfo).toBe(JSON.stringify({ checker: "FIXED", operator: "EQUAL", value: 0 }))
    expect(body.definedSql).toBe("select count(*) from sales.orders where amount < 0")
    expect(body.triggerType).toBe("REST")
    // REST trigger has no cron / scheduler ids
    expect(body).not.toHaveProperty("triggerCron")
    expect(body).not.toHaveProperty("mainSchedulerTaskId")
    expect(body).not.toHaveProperty("level")
  })

  test("create includes PLAN cron and SCHEDULE_TASK ids only when present", async () => {
    studioRequestMock.mockClear()
    await createDqcSqlRule(makeConfig(), {
      projectId: 20,
      objectName: "t",
      definedSql: "select 1",
      checkerInfo: "{}",
      vcluster: "v",
      owner: "2",
      trigger: { triggerType: "SCHEDULE_TASK", triggerCron: null, mainSchedulerTaskId: 100, subSchedulerTaskId: null, level: 1 },
    })
    const { body } = lastCall()
    expect(body.triggerType).toBe("SCHEDULE_TASK")
    expect(body.mainSchedulerTaskId).toBe(100)
    expect(body.level).toBe(1)
    expect(body).not.toHaveProperty("subSchedulerTaskId")
    expect(body).not.toHaveProperty("triggerCron")
  })

  test("get uses GET with ruleId in query", async () => {
    studioRequestMock.mockClear()
    await getDqcRule(makeConfig(), 123)
    const { path, body, method } = lastCall()
    expect(path).toBe("/clickzetta-dqc/api/v1/rule/get?ruleId=123")
    expect(body).toBeUndefined()
    expect(method).toBe("GET")
  })

  test("update posts the full payload as-is", async () => {
    studioRequestMock.mockClear()
    await updateDqcRuleFull(makeConfig(), { id: 123, vcluster: "v2", desc: "x" })
    const { path, body } = lastCall()
    expect(path).toBe("/clickzetta-dqc/api/v1/rule/update")
    expect(body).toEqual({ id: 123, vcluster: "v2", desc: "x" })
  })

  test("run posts ruleId, triggerType and rerun as 0/1", async () => {
    studioRequestMock.mockClear()
    await runDqcRule(makeConfig(), 123, "TEST", true)
    const { path, body } = lastCall()
    expect(path).toBe("/clickzetta-dqc/api/v1/rule/run")
    expect(body).toEqual({ ruleId: 123, triggerType: "TEST", rerun: 1 })
  })

  test("run defaults triggerType=TEST and rerun=0", async () => {
    studioRequestMock.mockClear()
    await runDqcRule(makeConfig(), 5)
    const { body } = lastCall()
    expect(body).toEqual({ ruleId: 5, triggerType: "TEST", rerun: 0 })
  })

  test("delete uses GET with ruleId in query", async () => {
    studioRequestMock.mockClear()
    await deleteDqcRule(makeConfig(), 123)
    const { path, method } = lastCall()
    expect(path).toBe("/clickzetta-dqc/api/v1/rule/del?ruleId=123")
    expect(method).toBe("GET")
  })

  test("stat routes to statRuleTask vs statRuleAndTable", async () => {
    studioRequestMock.mockClear()
    await getDqcStatistics(makeConfig(), "rule_task")
    expect(lastCall().path).toBe("/clickzetta-dqc/api/v1/dqc/stat/statRuleTask")
    await getDqcStatistics(makeConfig(), "rule_table")
    expect(lastCall().path).toBe("/clickzetta-dqc/api/v1/dqc/stat/statRuleAndTable")
    expect(lastCall().method).toBe("GET")
  })
})
