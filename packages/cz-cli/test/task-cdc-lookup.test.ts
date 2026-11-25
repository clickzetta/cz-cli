import { beforeEach, describe, expect, test } from "bun:test"
import { onStudio, stubStudioContext, studioOk } from "./support/cz-fixtures.js"
import { clearTokenCache } from "@clickzetta/sdk"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Network-boundary test: the real execute → task cdc lookup → studio-context → SDK path runs and
// only fetch is stubbed. `task cdc lookup` turns a datasource, a database and a table into the
// rocket "table to tasks" query and prints one row per source table and pipeline.
const { execute } = await import("../src/execute.ts")

const QUERY_PATH = "/clickzetta-rocket/api/v1/task/pipeline/table/tasks/query"
const bodies: Record<string, unknown>[] = []
let queryResult: { list: Record<string, unknown>[]; total: number } = { list: [], total: 0 }

const mirrorRow = {
  taskPipelineId: 9001, taskName: "cdc_crm", taskType: 283, pipelineType: 1, pipelineStatus: 2,
  datasourceId: 1201, sourceDb: "crm", sourceSchema: "crm", sourceTable: "users",
  targetDb: "gaotu_warehouse", targetSchema: "ods", targetTable: "ods_crm_users_rt",
  snapshotTaskId: 5, snapshotTaskStatus: 8,
}

beforeEach(() => {
  clearTokenCache()
  bodies.length = 0
  queryResult = { list: [mirrorRow], total: 1 }
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'wanxin_test_04'\ninstance = 'tmwmzxzs'\n",
  )
  stubStudioContext()
  onStudio("/ide-authority/v1/projectDataSources/list", () =>
    studioOk({ list: [{ id: 1201, dsName: "crm_master", dsType: 5, status: 1 }], total: 1 }))
  onStudio(QUERY_PATH, (body) => {
    bodies.push(body as Record<string, unknown>)
    return studioOk(queryResult)
  })
})

function parse(r: { output: string }) {
  return JSON.parse(r.output.trim().split("\n")[0]) as Record<string, unknown>
}

describe("task cdc lookup", () => {
  test("resolves the datasource name and matches database and table exactly", async () => {
    const r = await execute("task cdc lookup --datasource crm_master --db crm --table users")
    expect(r.exitCode).toBe(0)
    expect(bodies[0]).toEqual({
      datasourceId: 1201,
      sourceDb: { type: "MATCH", value: "crm" },
      sourceTable: { type: "MATCH", value: "users" },
      pageIndex: 1,
      pageSize: 20,
    })
  })

  test("takes a numeric datasource id and a schema", async () => {
    const r = await execute("task cdc lookup --datasource 1201 --db appdb --schema public --table users")
    expect(r.exitCode).toBe(0)
    expect(bodies[0]!.datasourceId).toBe(1201)
    expect(bodies[0]!.sourceSchema).toEqual({ type: "MATCH", value: "public" })
  })

  test("maps --match to the backend match types", async () => {
    for (const [match, type] of [["like", "LIKE"], ["prefix", "START_WITH"], ["suffix", "END_WITH"]] as const) {
      bodies.length = 0
      const r = await execute(`task cdc lookup --datasource crm_master --table us --match ${match}`)
      expect(r.exitCode).toBe(0)
      expect(bodies[0]!.sourceTable).toEqual({ type, value: "us" })
      expect(bodies[0]!.sourceDb).toBeUndefined()
    }
  })

  test("prints one row per source table and pipeline", async () => {
    queryResult = {
      total: 3,
      list: [
        mirrorRow,
        { ...mirrorRow, taskPipelineId: 9002, taskName: "merge_crm", pipelineType: 2 },
        { ...mirrorRow, taskPipelineId: 9003, taskName: "whole_db", pipelineType: 3 },
      ],
    }
    const r = await execute("task cdc lookup --datasource crm_master --db crm --table users")
    const rows = parse(r).data as Record<string, unknown>[]
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({
      task_id: 9001, task_name: "cdc_crm", pipeline_type: "MULTI_TABLE_MIRROR", pipeline_status: 2,
      datasource_id: 1201, source_db: "crm", source_schema: "crm", source_table: "users",
      target_db: "gaotu_warehouse", target_schema: "ods", target_table: "ods_crm_users_rt",
      snapshot_task_status: 8,
    })
    expect(rows.map((row) => row.pipeline_type)).toEqual(["MULTI_TABLE_MIRROR", "MULTI_TABLE_MERGE", "DATABASE_MIRROR"])
    expect(parse(r).ai_message).toContain("showing 3 of 3")
  })

  test("keeps an unknown pipeline type as its code", async () => {
    queryResult = { total: 1, list: [{ ...mirrorRow, pipelineType: 9 }] }
    const rows = parse(await execute("task cdc lookup --datasource crm_master --table users")).data as Record<string, unknown>[]
    expect(rows[0]!.pipeline_type).toBe(9)
  })

  test("says so when no pipeline syncs the table", async () => {
    queryResult = { list: [], total: 0 }
    const r = await execute("task cdc lookup --datasource crm_master --db crm --table nope")
    expect(r.exitCode).toBe(0)
    expect(parse(r).data).toEqual([])
    expect(parse(r).ai_message).toContain("No pipeline syncs nope")
  })

  test("rejects a page size above 200 before any request", async () => {
    const r = await execute("task cdc lookup --datasource crm_master --table users --page-size 201")
    expect(r.exitCode).toBe(2)
    expect((parse(r).error as Record<string, unknown>).code).toBe("INVALID_ARGUMENTS")
    expect(bodies).toHaveLength(0)
  })

  test("requires --datasource and --table", async () => {
    expect((await execute("task cdc lookup --table users")).exitCode).not.toBe(0)
    expect((await execute("task cdc lookup --datasource crm_master")).exitCode).not.toBe(0)
    expect(bodies).toHaveLength(0)
  })
})
