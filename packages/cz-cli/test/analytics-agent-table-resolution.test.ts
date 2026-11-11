import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-table-resolution-"))
const canonical = "quick_start.ecommerce_sales_analytics.v_gpt_fact_orders"
const orders = { datasetId: 17, sourceId: 8, tableName: canonical, physicalTable: "quick_start.ecommerce_sales_analytics.fact_orders" }
const requests: Array<{ path: string; query: URLSearchParams; body: Record<string, unknown> }> = []
let datasets: Record<string, unknown>[] = []
let paginated = false
let listFailure = false
let repeatedPage = false
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const body = request.method === "GET" ? {} : await request.json() as Record<string, unknown>
    requests.push({ path: url.pathname, query: url.searchParams, body })
    if (url.pathname.endsWith("/datasets/list")) {
      if (listFailure) return Response.json({ success: false, code: "403", message: "permission denied" })
      const filtered = datasets.filter((item) => body.sourceId === undefined || item.sourceId === body.sourceId)
      if (!paginated) return Response.json({ success: true, data: filtered })
      const pageNum = repeatedPage ? 1 : Number(body.pageNum)
      return Response.json({ success: true, data: filtered.slice(pageNum - 1, pageNum), total: filtered.length, pageNum, pageSize: 1 })
    }
    if (url.pathname.endsWith("/metrics/detail")) return Response.json({ success: true, data: { id: 9, datasourceId: 8, domainIds: [5] } })
    return Response.json({ success: true, data: url.pathname.endsWith("/datasets/detail") ? orders : 9 })
  },
})
await Bun.write(join(home, ".clickzetta", "profiles.toml"), `
[profiles.test]
service = "http://127.0.0.1:${server.port}"
protocol = "http"
instance = "test"
workspace = "quick_start"
schema = "ecommerce_sales_analytics"
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
beforeEach(() => {
  requests.length = 0
  datasets = [orders]
  paginated = false
  listFailure = false
  repeatedPage = false
})
async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, "src/main.ts", "analytics-agent", ...args, "--profile", "test"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, CLICKZETTA_TEST_HOME: home, CZ_WORKSPACE: "", CZ_SCHEMA: "", CZ_PROFILE: "" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [output, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { code, output, stderr }
}
const definition = ["--name", "order_count", "--expression", "count(*)"]

describe("dataset metadata resolves table names", () => {
  test.each(["create", "validate"])("metric %s resolves a physical short name before the request", async (command) => {
    const result = await run(["metric", command, "--table-name", "fact_orders", ...definition, "--domain-ids", "[5]"])
    expect(result.code, result.output + result.stderr).toBe(0)
    expect(requests[0]?.body).toEqual({ domainIds: [5], pageNum: 1, pageSize: 200 })
    expect(requests.at(-1)?.body).toEqual({ tableName: canonical, datasourceId: 8, names: ["order_count"], aggExpr: "count(*)", domainIds: [5] })
  })

  test.each(["v_gpt_fact_orders", "ecommerce_sales_analytics.fact_orders", "quick_start.ecommerce_sales_analytics.fact_orders", canonical, "`quick_start`.`ecommerce_sales_analytics`.`fact_orders`"])("resolves %s", async (name) => {
    const result = await run(["metric", "create", "--table-name", name, ...definition])
    expect(result.code, result.output).toBe(0)
    expect(requests.at(-1)?.body.tableName).toBe(canonical)
  })

  test("uses the current scope among names repeated across schemas/workspaces", async () => {
    datasets = [
      { datasetId: 18, sourceId: 8, tableName: "another.ecommerce_sales_analytics.v_gpt_fact_orders" },
      { datasetId: 19, sourceId: 8, tableName: "quick_start.other.v_gpt_fact_orders" }, orders,
    ]
    expect((await run(["metric", "create", "--table-name", "fact_orders", ...definition])).code).toBe(0)
    expect(requests.at(-1)?.body.tableName).toBe(canonical)
  })

  test("explicit workspace/schema override the profile", async () => {
    datasets = [orders, { ...orders, datasetId: 18, tableName: "other.retail.v_gpt_fact_orders", physicalTable: "other.retail.fact_orders" }]
    expect((await run(["metric", "create", "--table-name", "fact_orders", "--workspace", "other", "--schema", "retail", ...definition])).code).toBe(0)
    expect(requests.at(-1)?.body.tableName).toBe("other.retail.v_gpt_fact_orders")
  })

  test("does not guess a view name for shared schema datasets", async () => {
    datasets = [{ ...orders, tableName: orders.physicalTable }]
    expect((await run(["metric", "create", "--table-name", "fact_orders", ...definition])).code).toBe(0)
    expect(requests.at(-1)?.body.tableName).toBe(orders.physicalTable)
  })

  test("physical metadata locates a view stored in the system workspace", async () => {
    datasets = [{ ...orders, tableName: "ns55.public.v_gpt_quick_start_ecommerce_sales_analytics_fact_orders" }]
    expect((await run(["metric", "create", "--table-name", "fact_orders", ...definition])).code).toBe(0)
    expect(requests.at(-1)?.body.tableName).toBe(datasets[0]?.tableName)
  })

  test("ambiguity blocks writes and lists candidates, including datasource IDs", async () => {
    datasets = [orders, { ...orders, datasetId: 18, sourceId: 9 }]
    const result = await run(["metric", "create", "--table-name", "fact_orders", ...definition])
    expect(result.code).not.toBe(0)
    expect(result.output).toContain("AMBIGUOUS_DATASET")
    expect(result.output).toContain(canonical)
    expect(result.output).toContain("datasource 9")
    expect(requests).toHaveLength(1)
  })

  test("datasource selection disambiguates identical paths", async () => {
    datasets = [orders, { ...orders, datasetId: 18, sourceId: 9 }]
    expect((await run(["metric", "create", "--table-name", "fact_orders", "--datasource-id", "9", ...definition])).code).toBe(0)
    expect(requests[0]?.body.sourceId).toBe(9)
    expect(requests.at(-1)?.body.datasourceId).toBe(9)
  })

  test.each(["fact_orders", "ecommerce_sales_analytics.fact_orders"])("a registered short name %s does not bypass ambiguity", async (name) => {
    datasets = [orders, { datasetId: 18, sourceId: 8, tableName: name }]
    const result = await run(["metric", "create", "--table-name", name, ...definition])
    expect(result.code).not.toBe(0)
    expect(result.output).toContain("AMBIGUOUS_DATASET")
    expect(result.output).toContain(canonical)
    expect(result.output).toContain("dataset 18")
    expect(requests).toHaveLength(1)
  })

  test("wrong scope suggests the actual registered path without writing", async () => {
    const result = await run(["metric", "create", "--table-name", "fact_orders", "--schema", "wrong", ...definition])
    expect(result.code).not.toBe(0)
    expect(result.output).toContain("Did you mean:")
    expect(result.output).toContain(canonical)
    expect(requests).toHaveLength(1)
  })

  test("a missing dataset has a useful error and is never submitted", async () => {
    datasets = []
    const result = await run(["metric", "create", "--table-name", "absent", ...definition])
    expect(result.code).not.toBe(0)
    expect(result.output).toContain("DATASET_NOT_FOUND")
    expect(requests).toHaveLength(1)
  })

  test("follows pagination metadata even when the server caps page size", async () => {
    paginated = true
    datasets = [{ datasetId: 16, sourceId: 8, tableName: "quick_start.ecommerce_sales_analytics.other" }, orders]
    expect((await run(["metric", "create", "--table-name", "fact_orders", ...definition])).code).toBe(0)
    expect(requests[1]?.body.pageNum).toBe(2)
    expect(requests.at(-1)?.body.tableName).toBe(canonical)
  })

  test("incomplete pagination fails instead of selecting from a partial list", async () => {
    paginated = true
    repeatedPage = true
    datasets = [orders, { ...orders, datasetId: 18, sourceId: 9 }]
    const result = await run(["metric", "create", "--table-name", "fact_orders", ...definition])
    expect(result.code).not.toBe(0)
    expect(result.output).toContain("pagination did not complete")
    expect(requests.every((item) => item.path.endsWith("/datasets/list"))).toBe(true)
  })

  test("permission failures are not reported as missing tables", async () => {
    listFailure = true
    const result = await run(["metric", "create", "--table-name", "fact_orders", ...definition])
    expect(result.code).not.toBe(0)
    expect(result.output).toContain("permission denied")
    expect(requests).toHaveLength(1)
  })

  test.each([undefined, null])("metric table patches with datasource %s retain the existing datasource and domain scope", async (datasourceId) => {
    datasets = [orders, { ...orders, datasetId: 18, sourceId: 9 }]
    expect((await run(["metric", "update", "9", "--body", JSON.stringify({ tableName: "fact_orders", datasourceId })])).code).toBe(0)
    expect(requests[0]?.path).toEndWith("/metrics/detail")
    expect(requests[1]?.body).toEqual({ sourceId: 8, domainIds: [5], pageNum: 1, pageSize: 200 })
    expect(requests.at(-1)?.body).toEqual({ id: 9, tableName: canonical, datasourceId: 8 })
  })

  test("unrelated metric patches do not look up tables", async () => {
    expect((await run(["metric", "update", "9", "--description", "updated"])).code).toBe(0)
    expect(requests).toHaveLength(1)
  })

  test("metric list resolves the table filter", async () => {
    expect((await run(["metric", "list", "--table-name", "fact_orders"])).code).toBe(0)
    expect(requests.at(-1)?.body).toEqual({ tableName: canonical, datasourceId: 8 })
  })

  test.each(["table", "dataset"])("%s detail resolves a name then reads by dataset ID", async (command) => {
    const result = await run([command, "detail", "--table-name", "fact_orders"])
    expect(result.code, result.output).toBe(0)
    expect(requests.at(-1)?.query.get("datasetId")).toBe("17")
    expect(requests.at(-1)?.query.has("tableName")).toBe(false)
  })

  test("dataset detail by ID does not require metadata listing", async () => {
    expect((await run(["dataset", "detail", "--dataset-id", "17"])).code).toBe(0)
    expect(requests).toHaveLength(1)
  })

  test("a full registered path overrides the current workspace/schema", async () => {
    const result = await run(["metric", "create", "--table-name", canonical, "--workspace", "other", "--schema", "other", ...definition])
    expect(result.code, result.output).toBe(0)
    expect(requests.at(-1)?.body.tableName).toBe(canonical)
  })

  test("dataset update by ID preserves the existing command", async () => {
    const result = await run(["table", "update", "--domain-id", "5", "--dataset-id", "17", "--name", "Orders"])
    expect(result.code, result.output).toBe(0)
    expect(requests.at(-1)?.body).toEqual({ datasetId: 17, displayName: "Orders" })
  })

  test("dataset list exposes the canonical paths and sends filters", async () => {
    expect((await run(["dataset", "list", "--datasource-id", "8", "--domain-ids", "[5]", "--page-size", "50"])).code).toBe(0)
    expect(requests[0]?.body).toEqual({ sourceId: 8, domainIds: [5], pageSize: 50 })
  })

  test("dataset commands require an ID or name before any HTTP call", async () => {
    for (const args of [["dataset", "detail"], ["dataset", "update", "--domain-id", "5", "--description", "new"]]) {
      const result = await run(args)
      expect(result.code, result.output).toBe(2)
      expect(result.output).toContain("--dataset-id or --table-name")
    }
    expect(requests).toHaveLength(0)
  })

  test("dataset update resolves names within the required domain and sends only the patch", async () => {
    const result = await run(["dataset", "update", "--domain-id", "5", "--table-name", "fact_orders", "--description", "orders"])
    expect(result.code, result.output).toBe(0)
    expect(requests[0]?.body.domainIds).toEqual([5])
    expect(requests.at(-1)?.body).toEqual({ datasetId: 17, description: "orders" })
  })
})
