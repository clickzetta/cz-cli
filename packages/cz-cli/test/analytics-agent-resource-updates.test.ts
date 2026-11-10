import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Exercise the real CLI, profile resolution and HTTP transport in a child
// process. The local server records the contract without replacing src modules.
const home = mkdtempSync(join(tmpdir(), "cz-resource-updates-"))
const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = []
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    requests.push({ path: url.pathname, method: request.method, body: await request.json() })
    if (url.pathname.endsWith("/disable")) return Response.json({ message: "not found" }, { status: 404 })
    if (url.pathname.endsWith("/list")) return Response.json({ success: true, data: [] })
    return Response.json({ success: true, data: 9 })
  },
})
await Bun.write(join(home, ".clickzetta", "profiles.toml"), `
[profiles.test]
service = "http://127.0.0.1:${server.port}"
protocol = "http"
instance = "test"
analysis_agent_endpoint = "http://127.0.0.1:${server.port}"
[profiles.test.agent]
token = "test-token"
tenant_id = 55
user_id = 44
instance_id = 11
`)

afterAll(() => {
  server.stop(true)
  rmSync(home, { recursive: true, force: true })
})
beforeEach(() => { requests.length = 0 })

async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, "src/main.ts", "analytics-agent", ...args, "--profile", "test"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, CLICKZETTA_TEST_HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [output, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { code, output, stderr }
}

const definition = ["--table-name", "orders", "--name", "total", "--expression", "count(*)"]
const dsl = JSON.stringify({ sql: "select count(*) as n from orders", relatedTables: ["orders"], outputColumns: [{ name: "n", metricName: "total", type: "bigint" }] })

describe("resource partial updates and optional domains", () => {
  test.each(["create", "validate"])("metric %s accepts omitted domain and default datasource", async (command) => {
    const result = await run(["metric", command, ...definition])
    expect(result.code, result.output + result.stderr).toBe(0)
    expect(requests).toEqual([{ path: `/open/api/v1/analytics-agent/metrics/${command}`, method: "POST", body: { tableName: "orders", names: ["total"], aggExpr: "count(*)" } }])
  })

  test.each(["create", "validate"])("metric %s preserves explicit empty domains", async (command) => {
    const result = await run(["metric", command, ...definition, "--domain-ids", "[]"])
    expect(result.code, result.output).toBe(0)
    expect(requests[0]?.body.domainIds).toEqual([])
  })

  test("metric list needs no domain or datasource filter", async () => {
    expect((await run(["metric", "list", "--page-num", "2", "--page-size", "20"])).code).toBe(0)
    expect(requests[0]?.body).toEqual({ pageNum: 2, pageSize: 20 })
  })

  test("metric update sends clearing values and version metadata without domains", async () => {
    expect((await run(["metric", "update", "9", "--description", "", "--alias", "[]", "--base-version-id", "12", "--version-description", "clear fields"])).code).toBe(0)
    expect(requests[0]?.path).toBe("/open/api/v1/analytics-agent/metrics/partialUpdate")
    expect(requests[0]?.body).toEqual({ id: 9, description: "", alias: [], baseVersionId: 12, versionDescription: "clear fields" })
  })

  test.each(['[" "]', '["", "\\t"]', " , "])("metric alias %j does not implicitly clear existing aliases", async (alias) => {
    expect((await run(["metric", "update", "9", "--description", "new description", "--alias", alias])).code).toBe(0)
    expect(requests[0]?.body).toEqual({ id: 9, description: "new description" })
  })

  test.each([null, { sql: "x" }, [], 1, true].map((content) => [content]))("answer-builder update rejects non-string body content %j before HTTP", async (content) => {
    const result = await run(["answer-builder", "update", "9", "--body", JSON.stringify({ content })])
    expect(result.code, result.output + result.stderr).toBe(2)
    expect(JSON.parse(result.output).error).toMatchObject({ code: "USAGE_ERROR", message: "body.content must be a JSON-encoded DSL string" })
    expect(requests).toHaveLength(0)
  })

  test("answer-builder update validates DSL from body before HTTP", async () => {
    const result = await run(["answer-builder", "update", "9", "--body", JSON.stringify({ content: '{"sql":"x"}' })])
    expect(result.code, result.output).toBe(2)
    expect(JSON.parse(result.output).error.message).toContain("outputColumns")
    expect(requests).toHaveLength(0)
  })

  test("answer-builder update rejects object content from body-file before HTTP", async () => {
    const bodyFile = join(home, "invalid-content-body.json")
    await Bun.write(bodyFile, JSON.stringify({ content: { sql: "x" } }))
    expect((await run(["answer-builder", "update", "9", "--body-file", bodyFile])).code).toBe(2)
    expect(requests).toHaveLength(0)
  })

  test("answer-builder update accepts validated DSL strings from body", async () => {
    expect((await run(["answer-builder", "update", "9", "--body", JSON.stringify({ content: dsl })])).code).toBe(0)
    expect(requests[0]?.body).toEqual({ id: 9, content: dsl })
  })

  test.each(["create", "validate"])("answer-builder %s accepts no domain and DSL from body", async (command) => {
    const result = await run(["answer-builder", command, "--analysis-name", "total", "--datasource-id", "8", "--body", JSON.stringify({ content: dsl })])
    expect(result.code, result.output).toBe(0)
    expect(requests[0]?.body).toEqual({ analysisName: "total", datasourceId: 8, content: dsl })
  })

  test.each(["create", "validate"])("answer-builder %s accepts explicit empty domains", async (command) => {
    const result = await run(["answer-builder", command, "--analysis-name", "total", "--datasource-id", "8", "--content", dsl, "--domain-ids", "[]"])
    expect(result.code, result.output).toBe(0)
    expect(requests[0]?.body.domainIds).toEqual([])
  })

  test("answer-builder partial update reads files and prefers explicit content over the base body", async () => {
    const contentFile = join(home, "content.json")
    const sqlFile = join(home, "query.sql")
    const bodyFile = join(home, "body.json")
    await Promise.all([
      Bun.write(contentFile, dsl),
      Bun.write(sqlFile, "select ${dims}, count(*) as n from orders group by ${dims}"),
      Bun.write(bodyFile, JSON.stringify({ analysisDesc: "中文说明", content: "old definition", domainIds: [] })),
    ])
    const result = await run(["answer-builder", "update", "9", "--content-file", contentFile, "--sql-file", sqlFile, "--body-file", bodyFile])
    expect(result.code, result.output + result.stderr).toBe(0)
    expect(requests[0]?.body).toEqual({
      id: 9,
      analysisDesc: "中文说明",
      domainIds: [],
      content: JSON.stringify({ ...JSON.parse(dsl), sql: "select ${dims}, count(*) as n from orders group by ${dims}" }),
    })
  })

  test("answer-builder description update does not send unrelated definition fields", async () => {
    expect((await run(["answer-builder", "update", "9", "--analysis-desc", "new description"])).code).toBe(0)
    expect(requests).toEqual([{ path: "/open/api/v1/analytics-agent/answer-builders/update", method: "POST", body: { id: 9, analysisDesc: "new description" } }])
  })

  test("answer-builder update preserves nulls, clearing arrays and version metadata from body", async () => {
    const body = { id: 88, analysisName: null, analysisDesc: "", domainIds: [], baseVersionId: 12, versionDescription: "clear" }
    expect((await run(["answer-builder", "update", "9", "--body", JSON.stringify(body)])).code).toBe(0)
    expect(requests[0]?.body).toEqual({ ...body, id: 9 })
  })

  test("answer-builder update forwards version flags and status", async () => {
    expect((await run(["answer-builder", "update", "9", "--status", "DISABLE", "--base-version-id", "12", "--version-description", "disable"])).code).toBe(0)
    expect(requests[0]?.body).toEqual({ id: 9, status: "DISABLE", baseVersionId: 12, versionDescription: "disable" })
  })

  test("answer-builder update allows replacing SQL/DSL explicitly", async () => {
    expect((await run(["answer-builder", "update", "9", "--content", dsl, "--sql", "select count(*) as n from other_orders"])).code).toBe(0)
    expect(JSON.parse(String(requests[0]?.body.content)).sql).toBe("select count(*) as n from other_orders")
  })

  test("answer-builder update flags override domains in body", async () => {
    expect((await run(["answer-builder", "update", "9", "--body", '{"domainIds":[5]}', "--domain-ids", "[]"])).code).toBe(0)
    expect(requests[0]?.body).toEqual({ id: 9, domainIds: [] })
  })

  test.each(["metric", "answer-builder"])("%s disable fallback uses only id/status", async (resource) => {
    expect((await run([resource, "disable", "9"])).code).toBe(0)
    expect(requests).toHaveLength(2)
    expect(requests[1]?.body).toEqual({ id: 9, status: "DISABLE" })
    expect(requests[1]?.path).toBe(resource === "metric" ? "/open/api/v1/analytics-agent/metrics/partialUpdate" : "/open/api/v1/analytics-agent/answer-builders/update")
  })

  test("datasource rename does not resend connection or type", async () => {
    expect((await run(["datasource", "update", "8", "--name", "renamed"])).code).toBe(0)
    expect(requests).toEqual([{ path: "/open/api/v1/datasources/8", method: "PUT", body: { name: "renamed" } }])
  })

  test("datasource validation sends only requested connection fields", async () => {
    expect((await run(["datasource", "update", "8", "--connection", '{"host":"new-host"}', "--validate-only"])).code).toBe(0)
    expect(requests[0]?.body).toEqual({ connection: { host: "new-host" }, validateOnly: true })
  })

  test("domain update needs no name and preserves empty sample question array", async () => {
    expect((await run(["domain", "update", "5", "--description", "new description", "--sample-questions", "[]"])).code).toBe(0)
    expect(requests).toEqual([{ path: "/open/api/v1/analytics-agent/domains/5", method: "PUT", body: { description: "new description", sampleQuestions: [] } }])
  })

  test.each(["metric", "answer-builder"])("%s domain validation rejects invalid body arrays before HTTP", async (resource) => {
    for (const domainIds of [[0], [-1], [1.2], ["5"], [null], {}]) {
      const result = await run([resource, "list", "--body", JSON.stringify({ domainIds })])
      expect(result.code, result.output).toBe(2)
      expect(requests).toHaveLength(0)
    }
  })

  test.each([
    ["answer-builder", "update", "9"],
    ["answer-builder", "update", "9", "--content", '{"sql":"select 1"}'],
    ["answer-builder", "create", "--analysis-name", "total", "--content", dsl],
    ["metric", "update", "9", "--body", '{"domainIds":[],"alias":[]}'],
    ["datasource", "update", "8", "--connection", "[]"],
  ])("invalid request %j is rejected before HTTP", async (...args) => {
    expect((await run(args)).code).toBe(2)
    expect(requests).toHaveLength(0)
  })
})
