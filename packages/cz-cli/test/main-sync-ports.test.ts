import { beforeEach, describe, expect, test } from "bun:test"
import { onStudio, onFetch, studioOk, stubStudioContext } from "./support/cz-fixtures.js"
import { clearTokenCache } from "@clickzetta/sdk"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const { execute } = await import("../src/execute.ts")

// Network-boundary tests for the origin/main v1.17.23 ports: the real cz-cli path
// runs and only globalThis.fetch is stubbed. HOME/profile isolated by test/preload.ts.

const refillBodies: Array<Record<string, unknown>> = []
const saveConfigBodies: Array<Record<string, unknown>> = []
const answerBuilderBodies: Array<Record<string, unknown>> = []

function writeProfile(): void {
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'wanxin_test_04'\ninstance = 'inst'\nanalysis_agent_endpoint = 'https://dev-api.clickzetta.com'\n",
  )
}

beforeEach(() => {
  clearTokenCache()
  refillBodies.length = 0
  saveConfigBodies.length = 0
  answerBuilderBodies.length = 0
  writeProfile()
  stubStudioContext({})
})

describe("runs refill — full Studio payload (#56)", () => {
  test("builds createBy/userId/dateList/complementBizDateBeanList from the login and window", async () => {
    onFetch({
      match: (url) => url.includes("/ide-admin/v1/complementTask/createComplementJob"),
      respond: (_url, _method, body) => {
        refillBodies.push((body ?? {}) as Record<string, unknown>)
        return { code: 0, data: { complementJobId: 999 } }
      },
    })

    const result = await execute("runs refill 4242 --from 2026-01-01 --to 2026-01-02 --vc DEFAULT -y")
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(refillBodies).toHaveLength(1)
    const body = refillBodies[0]!
    expect(body.scheduleTaskId).toBe(4242)
    expect(body.createBy).toBe("UAT_TEST")
    expect(body.userId).toBe(13)
    expect(body.nextType).toBe(0)
    expect(body.complementType).toBe(1)
    expect(body.isConcurrence).toBe(2)
    expect(body.concurrenceNumber).toBe(1)
    const dateList = body.dateList as Array<Record<string, unknown>>
    expect(dateList).toHaveLength(1)
    expect(typeof dateList[0]!.bizStartDate).toBe("number")
    expect(typeof dateList[0]!.bizEndDate).toBe("number")
    expect(body.complementBizDateBeanList).toEqual(dateList)
    // Legacy fields must be gone.
    expect(body.operate_user).toBeUndefined()
    expect(body.bizStartTime).toBeUndefined()
  })
})

describe("integration setup multi — sync VC binding (#57)", () => {
  function stubDatasourcesAndSave(): void {
    onStudio("/ide-authority/v1/projectDataSources/list", () =>
      studioOk({
        list: [
          { id: 100, dsName: "src_ds", dsType: 7 },
          { id: 200, dsName: "sink_ds", dsType: 1 },
        ],
      }),
    )
    onFetch({
      match: (url) => url.includes("/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration"),
      respond: (_url, _method, body) => {
        saveConfigBodies.push((body ?? {}) as Record<string, unknown>)
        return { code: 0, data: { ok: true } }
      },
    })
  }

  test("auto-picks the sole INTEGRATION vcluster and persists it as adhocConfigs", async () => {
    stubDatasourcesAndSave()
    onStudio("/clickzetta-lakeconsole/api/v1/vcluster/list", () =>
      studioOk([
        { id: "vc-sync-1", name: "SYNC_VC", type: "INTEGRATION" },
        { id: "vc-gen-1", name: "GENERAL_VC", type: "GENERAL" },
      ]),
    )

    const result = await execute(
      "task integration setup 5555 --sync-type multi --source-datasource src_ds --source-schema s --source-tables t1,t2 --sink-datasource sink_ds --sink-schema public",
    )
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveConfigBodies).toHaveLength(1)
    const adhoc = JSON.parse(String(saveConfigBodies[0]!.adhocConfigs)) as Record<string, unknown>
    expect(adhoc.adhocVcCode).toBe("SYNC_VC")
    expect(adhoc.adhocVcId).toBe("vc-sync-1")
    expect(adhoc.schema).toBe("public")
  })

  test("rejects a compute VC passed via --vc with INVALID_VCLUSTER", async () => {
    stubDatasourcesAndSave()
    onStudio("/clickzetta-lakeconsole/api/v1/vcluster/list", () =>
      studioOk([
        { id: "vc-sync-1", name: "SYNC_VC", type: "INTEGRATION" },
        { id: "vc-gen-1", name: "GENERAL_VC", type: "GENERAL" },
      ]),
    )

    const result = await execute(
      "task integration setup 5555 --sync-type multi --vc GENERAL_VC --source-datasource src_ds --source-schema s --source-tables t1 --sink-datasource sink_ds --sink-schema public",
    )
    expect(result.exitCode).not.toBe(0)
    const j = JSON.parse(result.output.trim().split("\n")[0]) as Record<string, unknown>
    expect((j.error as Record<string, unknown>).code).toBe("INVALID_VCLUSTER")
    expect(saveConfigBodies).toHaveLength(0)
  })
})

describe("analytics-agent answer-builder — --sql wrapping (#63)", () => {
  test("--sql is injected into content.sql without hand-escaping JSON", async () => {
    onFetch({
      match: (url) => url.includes("/open/api/v1/analytics-agent/answer-builders/validate"),
      respond: (_url, _method, body) => {
        answerBuilderBodies.push((body ?? {}) as Record<string, unknown>)
        return { data: { success: true, code: "200", data: { valid: true } } }
      },
    })

    const dsl = JSON.stringify({ outputColumns: [{ name: "amt", metricName: "sales", type: "decimal" }] })
    const result = await execute(
      `analytics-agent answer-builder validate --analysis-name ab --datasource-id 8 --domain-id 27 --content '${dsl}' --sql 'SELECT sum(x) AS amt FROM t'`,
    )
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(answerBuilderBodies).toHaveLength(1)
    const content = JSON.parse(String(answerBuilderBodies[0]!.content)) as Record<string, unknown>
    expect(content.sql).toBe("SELECT sum(x) AS amt FROM t")
    const outputColumns = content.outputColumns as Array<Record<string, unknown>>
    expect(outputColumns[0]!.metricName).toBe("sales")
  })

  test("rejects outputColumns with empty metricName", async () => {
    const dsl = JSON.stringify({ outputColumns: [{ name: "amt", metricName: "" }] })
    const result = await execute(
      `analytics-agent answer-builder validate --analysis-name ab --datasource-id 8 --domain-id 27 --content '${dsl}' --sql 'SELECT 1 AS amt'`,
    )
    expect(result.exitCode).not.toBe(0)
    const j = JSON.parse(result.output.trim().split("\n")[0]) as Record<string, unknown>
    expect((j.error as Record<string, unknown>).code).toBe("USAGE_ERROR")
  })
})

