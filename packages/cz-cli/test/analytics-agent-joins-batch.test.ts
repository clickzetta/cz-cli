import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Exercise the global parser and real HTTP transport, including scalar middleware.
const home = mkdtempSync(join(tmpdir(), "cz-joins-batch-"))
const requests: Array<{ path: string; body: Record<string, unknown> }> = []
let response: unknown
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    requests.push({ path: new URL(request.url).pathname, body: await request.json() })
    return Response.json({ success: true, data: response })
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
beforeEach(() => {
  requests.length = 0
  response = { submittedCount: 4, status: "ok", results: applied }
})
const flags = [
  "101:ws.demo.v_gpt_orders.customer_id=102:ws.demo.v_gpt_customers.id@n:1",
  "103:ws.demo.v_gpt_items.order_id=101:ws.demo.v_gpt_orders.id@n:1",
  "103:ws.demo.v_gpt_items.product_id=104:ws.demo.v_gpt_products.id@n:1",
  "105:ws.demo.v_gpt_shipments.order_id=101:ws.demo.v_gpt_orders.id@n:1",
]
const applied = flags.map((_, index) => ({ index, status: "applied", joinId: 700 + index }))
async function run(values = flags, args = values.flatMap((value) => ["--join", value])) {
  const child = Bun.spawn([
    process.execPath, "src/main.ts", "analytics-agent", "domain", "joins", "apply",
    "--domain-id", "55", ...args, "--profile", "test",
  ], {
    cwd: join(import.meta.dir, ".."), env: { ...process.env, CLICKZETTA_TEST_HOME: home },
    stdout: "pipe", stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ])
  return { code, stdout, stderr, payload: JSON.parse(stdout) }
}

describe("domain joins batch apply", () => {
  test("four repeated flags reach the server in order in one request", async () => {
    const result = await run()
    expect(result.code, result.stdout + result.stderr).toBe(0)
    expect(requests).toEqual([{
      path: "/open/api/v1/analytics-agent/domains/55/joins/apply",
      body: { joins: [
        { datasetId: 101, tableName: "ws.demo.v_gpt_orders", attrCode: "customer_id", joinDatasetId: 102, joinTableName: "ws.demo.v_gpt_customers", joinAttrCode: "id", relation: "n:1" },
        { datasetId: 103, tableName: "ws.demo.v_gpt_items", attrCode: "order_id", joinDatasetId: 101, joinTableName: "ws.demo.v_gpt_orders", joinAttrCode: "id", relation: "n:1" },
        { datasetId: 103, tableName: "ws.demo.v_gpt_items", attrCode: "product_id", joinDatasetId: 104, joinTableName: "ws.demo.v_gpt_products", joinAttrCode: "id", relation: "n:1" },
        { datasetId: 105, tableName: "ws.demo.v_gpt_shipments", attrCode: "order_id", joinDatasetId: 101, joinTableName: "ws.demo.v_gpt_orders", joinAttrCode: "id", relation: "n:1" },
      ] },
    }])
    expect(result.payload.data).toEqual({
      requestedCount: 4, submittedCount: 4, appliedCount: 4, alreadyExistsCount: 0, rejectedCount: 0,
      status: "ok", results: applied,
    })
  })

  test.each([0, 1, 3])("invalid item at index %s stops the entire batch before HTTP", async (index) => {
    const result = await run(flags.map((value, i) => i === index ? "invalid" : value))
    expect(result.code).not.toBe(0)
    expect(result.payload.error.code).toBe("USAGE_ERROR")
    expect(result.payload.error.message).toContain(`--join item ${index + 1}`)
    expect(requests).toHaveLength(0)
  })

  test("single join still works", async () => {
    response = { submittedCount: 1, results: [applied[0]] }
    const result = await run([flags[0]!])
    expect(result.code).toBe(0)
    expect(result.payload.data).toMatchObject({ requestedCount: 1, appliedCount: 1, status: "ok" })
    expect(requests[0]?.body.joins).toHaveLength(1)
  })

  test("all already-existing results succeed with submittedCount zero", async () => {
    response = { submittedCount: 0, results: applied.map((item) => ({ ...item, status: "already_exists" })) }
    const result = await run()
    expect(result.code).toBe(0)
    expect(result.payload.data).toMatchObject({ requestedCount: 4, appliedCount: 0, alreadyExistsCount: 4, rejectedCount: 0, submittedCount: 0 })
  })

  test("partial rejection fails with counts, reasons and all original results", async () => {
    const results = [applied[0], { index: 1, status: "already_exists", joinId: 42 },
      { index: 2, status: "rejected", reason: "column not found" }, applied[3]]
    response = { status: "ok", submittedCount: 2, results }
    const result = await run()
    expect(result.code).toBe(1)
    expect(result.payload.error.code).toBe("JOIN_APPLY_REJECTED")
    expect(result.payload.data).toEqual({ status: "partial_failure", requestedCount: 4, submittedCount: 2, appliedCount: 2, alreadyExistsCount: 1, rejectedCount: 1, results })
  })

  test.each([
    { label: "missing item", results: applied.slice(0, 3) },
    { label: "duplicate index", results: [applied[0], applied[0], applied[2], applied[3]] },
    { label: "out-of-range index", results: [...applied.slice(0, 3), { index: 4, status: "applied" }] },
    { label: "unknown status", results: [...applied.slice(0, 3), { index: 3, status: "queued" }] },
    { label: "null item", results: [null, ...applied.slice(1)] },
    { label: "non-array results", results: {} },
  ])("rejects $label instead of claiming success", async ({ results }) => {
    response = { status: "ok", submittedCount: 4, results }
    const result = await run()
    expect(result.code).toBe(1)
    expect(result.payload.error.code).toBe("JOIN_APPLY_RESULT_MISMATCH")
    expect(result.payload.data.results).toEqual(results)
  })

  test("submittedCount inconsistent with results is reported", async () => {
    response = { submittedCount: 1, results: applied }
    expect((await run()).payload.error.code).toBe("JOIN_APPLY_RESULT_MISMATCH")
  })

  test.each([null, { submittedCount: 1, status: "ok" }])("legacy response %j does not invent verified counts", async (data) => {
    response = data
    const result = await run()
    expect(result.code).toBe(0)
    expect(result.payload.data).toMatchObject({ requestedCount: 4, status: "unverified" })
    expect(result.payload.data.appliedCount).toBeUndefined()
    expect(result.payload.ai_message).toContain("domain joins list")
  })

  test.each([
    ["--join"],
    ["--join", "--join", flags[0]!],
    ["--join", flags[0]!, "--join"],
    ["--join", flags[0]!, "--join", "--join", flags[1]!],
    ["--join="],
  ].map((args) => ({ args })))("missing join value in $args stops before HTTP", async ({ args }) => {
    response = { submittedCount: 0, results: [] }
    const result = await run([], args)
    expect(result.code, result.stdout + result.stderr).not.toBe(0)
    expect(result.payload.error.code).toBe(args[0] === "--join=" ? "USAGE_ERROR" : "INTERNAL_ERROR")
    expect(result.payload.error.message).toContain(args[0] === "--join=" ? "--join item 1" : "Not enough arguments following: join")
    expect(requests).toHaveLength(0)
  })

  test.each([["rejected"], ["applied"], ["already_exists"], [], {}, null, false, 0].map((status) => ({ status })))(
    "rejects non-string status $status",
    async ({ status }) => {
      response = { submittedCount: 0, results: flags.map((_, index) => ({ index, status })) }
      const result = await run()
      expect(result.code).toBe(1)
      expect(result.payload.error.code).toBe("JOIN_APPLY_RESULT_MISMATCH")
    },
  )

  test("JSON input is rejected rather than silently losing items", async () => {
    const result = await run(['{"datasetId":101}', flags[3]!])
    expect(result.code).not.toBe(0)
    expect(result.payload.error.message).toContain("--join item 1")
    expect(requests).toHaveLength(0)
  })
})
