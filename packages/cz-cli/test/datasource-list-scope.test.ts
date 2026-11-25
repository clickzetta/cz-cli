import { beforeEach, describe, expect, test } from "bun:test"
import { onStudio, stubStudioContext, studioOk } from "./support/cz-fixtures.js"
import { clearTokenCache } from "@clickzetta/sdk"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { datasourceScope, datasourceUrl } from "../src/commands/datasource.ts"

// Network-boundary test, same approach as datasource-list-secrets.test.ts: the real
// execute → datasource list → studio-context → SDK path runs and only fetch is stubbed.
//
// `datasource list` must (1) ask the backend for the workspace scope, (2) drop rows the
// backend matched by project id substring, (3) return a url per row and (4) refuse a
// --tenant-id / --instance-id that differs from the resolved context.
const { execute } = await import("../src/execute.ts")

const PROJECT_ID = 41004
const URL_PW = "url-password-value"

const LIST_PATH = "/ide-authority/v1/projectDataSources/list"
const listBodies: Record<string, unknown>[] = []

const backendRows = [
  { id: 1, dsName: "es_a", dsType: 13, status: 1, relatedProjectIds: "41004",
    connectionParams: { hosts: ["https://a:9200", "https://b:9200"], apiKey: "es-api-key-value" } },
  { id: 2, dsName: "mysql_shared", dsType: 5, status: 1, relatedProjectIds: "*",
    connectionParams: { jdbcUrl: `jdbc:mysql://db:3306/x?user=u&password=${URL_PW}`, username: "u" } },
  { id: 3, dsName: "kafka_b", dsType: 2, status: 1, relatedProjectIds: "1, 41004",
    connectionParams: '{"bootstrapServers":"k1:9092,k2:9092"}' },
  // The backend matches the id as a substring: 3341004 contains 41004 but is another project.
  { id: 4, dsName: "other_ws", dsType: 5, status: 1, relatedProjectIds: "3341004",
    connectionParams: { jdbcUrl: "jdbc:mysql://other:3306" } },
  { id: 5, dsName: "smb_c", dsType: 57, status: 1, relatedProjectIds: "41004",
    connectionParams: { host: "smb.example.com", port: "445" } },
  { id: 6, dsName: "hbase_d", dsType: 10, status: 1, relatedProjectIds: "41004",
    connectionParams: { quorum: "zk" } },
  // No membership from the backend: kept, but never asserted to belong to the workspace.
  { id: 7, dsName: "unknown_missing", dsType: 5, status: 1, connectionParams: { jdbcUrl: "jdbc:mysql://u1:3306" } },
  { id: 8, dsName: "unknown_null", dsType: 5, status: 1, relatedProjectIds: null, connectionParams: { jdbcUrl: "jdbc:mysql://u2:3306" } },
]

beforeEach(() => {
  clearTokenCache()
  listBodies.length = 0
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'wanxin_test_04'\ninstance = 'tmwmzxzs'\n",
  )
  stubStudioContext({ tenantId: 10, instanceId: 86, projectId: PROJECT_ID })
  onStudio(LIST_PATH, (body) => {
    listBodies.push(body as Record<string, unknown>)
    return studioOk({ list: backendRows, total: backendRows.length })
  })
  onStudio("/ide-authority/v1/projectDataSources/listNamespaces", () => studioOk({ list: ["db1"] }))
})

function parse(r: { output: string }) {
  return JSON.parse(r.output.trim().split("\n")[0]) as Record<string, unknown>
}

function rowsOf(r: { output: string }) {
  return parse(r).data as Record<string, unknown>[]
}

describe("datasource list scope", () => {
  test("asks the backend for the workspace's project", async () => {
    const r = await execute("datasource list")
    expect(r.exitCode).toBe(0)
    expect(listBodies[0]!.projectId).toBe(PROJECT_ID)
    expect(listBodies[0]!.workspace).toBe("wanxin_test_04")
  })

  test("drops rows of other workspaces, marks shared ones and keeps unknown membership explicit", async () => {
    const r = await execute("datasource list")
    const rows = rowsOf(r)
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 5, 6, 7, 8])
    expect(rows.find((row) => row.id === 2)!.scope).toBe("shared")
    expect(rows.find((row) => row.id === 1)!.scope).toBe("workspace")
    expect(rows.find((row) => row.id === 3)!.scope).toBe("workspace")
    expect(rows.find((row) => row.id === 7)!.scope).toBe("unknown")
    expect(rows.find((row) => row.id === 8)!.scope).toBe("unknown")
    expect(parse(r).ai_message).toContain("2 row(s) carry no workspace membership")
    expect(parse(r).ai_message).toContain("Dropped 1 row")
    expect(parse(r).ai_message).toContain("project 41004")
  })

  test("reports tenant and instance on every row", async () => {
    const rows = rowsOf(await execute("datasource list"))
    expect(rows.every((row) => row.tenantId === 10 && row.instanceId === 86)).toBe(true)
  })

  test("returns one url per row from the address-like connection param", async () => {
    const rows = rowsOf(await execute("datasource list"))
    const url = (id: number) => rows.find((row) => row.id === id)!.url
    expect(url(1)).toBe("https://a:9200,https://b:9200")
    expect(url(3)).toBe("k1:9092,k2:9092")
    expect(url(5)).toBe("smb.example.com:445")
    // no address-like param: the field is absent rather than a made-up value
    expect(rows.find((row) => row.id === 6)!.url).toBeUndefined()
  })

  test("masks credentials inside the url unless --show-secrets", async () => {
    const masked = await execute("datasource list")
    expect(masked.output).not.toContain(URL_PW)
    expect(rowsOf(masked).find((row) => row.id === 2)!.url).toBe("jdbc:mysql://db:3306/x?user=u&password=********")

    const plain = await execute("datasource list --show-secrets")
    expect(rowsOf(plain).find((row) => row.id === 2)!.url).toContain(URL_PW)
  })

  test("accepts matching --tenant-id and --instance-id", async () => {
    const r = await execute("datasource list --tenant-id 10 --instance-id 86")
    expect(r.exitCode).toBe(0)
    expect(rowsOf(r)).toHaveLength(7)
  })

  test("rejects a different --tenant-id without sending the datasource list request", async () => {
    const r = await execute("datasource list --tenant-id 11")
    expect(r.exitCode).not.toBe(0)
    expect((parse(r).error as Record<string, unknown>).code).toBe("SCOPE_MISMATCH")
    expect(listBodies).toHaveLength(0)
  })

  test("rejects a different --instance-id without sending the datasource list request", async () => {
    const r = await execute("datasource list --instance-id 999")
    expect(r.exitCode).not.toBe(0)
    expect((parse(r).error as Record<string, unknown>).code).toBe("SCOPE_MISMATCH")
    expect(listBodies).toHaveLength(0)
  })

  test("name resolution of other commands keeps the tenant-wide search", async () => {
    const r = await execute("datasource catalogs 1")
    expect(r.exitCode).toBe(0)
    expect(listBodies.length).toBeGreaterThan(0)
    expect(listBodies.every((body) => body.projectId === undefined)).toBe(true)
  })
})

describe("datasourceUrl", () => {
  test("prefers jdbcUrl, then other address keys", () => {
    expect(datasourceUrl({ jdbcUrl: "jdbc:mysql://h:3306", endpoint: "e" })).toBe("jdbc:mysql://h:3306")
    expect(datasourceUrl({ endpoint: "oss-cn-hangzhou.aliyuncs.com" })).toBe("oss-cn-hangzhou.aliyuncs.com")
    expect(datasourceUrl({ hostAndPorts: ["r1:6379", "r2:6379"] })).toBe("r1:6379,r2:6379")
    expect(datasourceUrl({ metaStoreSlbUrl: "47.0.0.1:8923", metaStoreUrl: "internal:8923" })).toBe("47.0.0.1:8923")
  })

  test("accepts JSON-string params and ignores unusable values", () => {
    expect(datasourceUrl('{"url":"http://ck:8123"}')).toBe("http://ck:8123")
    expect(datasourceUrl({ jdbcUrl: "", hosts: [], uri: "mongodb://m:27017" })).toBe("mongodb://m:27017")
    expect(datasourceUrl({ host: "h" })).toBe("h")
    expect(datasourceUrl(undefined)).toBeUndefined()
    expect(datasourceUrl("not json")).toBeUndefined()
    expect(datasourceUrl([{ url: "x" }])).toBeUndefined()
  })
})

describe("datasourceScope", () => {
  test("matches the project id exactly, not as a substring", () => {
    expect(datasourceScope("*", 60001)).toBe("shared")
    expect(datasourceScope("60001", 60001)).toBe("workspace")
    expect(datasourceScope("1,60001, 7", 60001)).toBe("workspace")
    expect(datasourceScope("3360001", 60001)).toBe("other")
    expect(datasourceScope("160001,600011", 60001)).toBe("other")
  })

  test("keeps rows whose scope the backend did not report", () => {
    expect(datasourceScope(undefined, 60001)).toBe("unknown")
    expect(datasourceScope("", 60001)).toBe("unknown")
  })
})
