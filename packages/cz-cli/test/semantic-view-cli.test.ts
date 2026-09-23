import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"

async function cli(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(
    [process.execPath, new URL("../src/main.ts", import.meta.url).pathname, ...args, "--format", "json"],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, CLICKZETTA_DISABLE_AUTOUPDATE: "1", ...env } },
  )
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, body: JSON.parse(out || err) as { data?: Record<string, unknown>; error?: Record<string, unknown> } }
}
test("real CLI routes sv commands, respects file operations and rejects unapproved deployment", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cz-sv-cli-"))
  try {
    const model = path.join(root, "sales.sv.yaml")
    const written = await cli([
      "sv",
      "write",
      "--file-path",
      model,
      "--yaml-content",
      'name: sales\ntables:\n  - name: o\n    base_table: {database: w, schema: s, table: orders}\n    metrics: [{name: revenue, expr: "SUM(o.amount)"}]',
    ])
    expect(written.code).toBe(0)
    expect(await Bun.file(model).exists()).toBe(true)
    expect((await Bun.file(model + ".manifest.json").json()).state).toBe("draft")
    const compiled = await cli(["sv", "compile", "--file-path", model, "--workspace", "w", "--schema", "s"])
    expect(compiled.code).toBe(0)
    expect(compiled.body.data?.sql).toContain("CREATE SEMANTIC VIEW")
    const qualified = await cli(["sv", "compile", "--file-path", model, "--fqn", "w.s.sales"])
    expect(qualified.code).toBe(0)
    expect(qualified.body.data?.sql).toBe(compiled.body.data?.sql)
    const read = await cli(["sv", "read", "--source", "workspace", "--file-path", model])
    expect(read.body.data?.model).toHaveProperty("name", "sales")
    const edit = await cli([
      "sv",
      "edit",
      "--file-path",
      model,
      "--operations",
      '[{"operation":"update_model_description","params":{"description":"Daily sales"}}]',
    ])
    expect(edit.code).toBe(0)
    expect((await Bun.file(model + ".manifest.json").json()).state).toBe("edited")
    const before = await Bun.file(model).text()
    const bad = await cli(["sv", "edit", "--file-path", model, "--operations", '[{"operation":"unknown","params":{}}]'])
    expect(bad.code).not.toBe(0)
    expect(await Bun.file(model).text()).toBe(before)
    const denied = await cli(["sv", "deploy", "--file-path", model, "--fqn", "w.s.sales"])
    expect(denied.code).not.toBe(0)
    expect(denied.body.error?.code).toBe("WRITE_REQUIRED")
    const help = await cli(["sv", "backend", "--tool", "help"])
    expect(JSON.parse(String(help.body.data?.result)).tools).toContain("osi_write_model")
    expect(JSON.parse(String(help.body.data?.result)).tools).not.toContain("pbi_export")
    expect(JSON.parse(String(help.body.data?.result)).tools).not.toContain("tableau_export")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 15000)

test("SV timeout reaches SQL polling and cancels the running job through the real transport", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cz-sv-timeout-"))
  const requests: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const route = new URL(request.url).pathname
      requests.push(route)
      if (route === "/lh/submitJob" || route === "/lh/getJob") return Response.json({ status: { state: "RUNNING" } })
      if (route === "/lh/cancelJob") return Response.json({})
      return Response.json({ error: "Unexpected request" }, { status: 400 })
    },
  })
  try {
    await mkdir(path.join(root, ".clickzetta"))
    const token =
      "header." +
      Buffer.from(JSON.stringify({ userId: 7, accountId: 3, instanceId: 86, exp: 4_102_444_800 })).toString(
        "base64url",
      ) +
      ".signature"
    await Bun.write(
      path.join(root, ".clickzetta/profiles.toml"),
      [
        'default_profile = "local"',
        "[profiles.local]",
        `service = "127.0.0.1:${server.port}"`,
        'protocol = "http"',
        'instance = "inst"',
        "instance_id = 86",
        'workspace = "ws"',
        "[profiles.local.header]",
        `Cookie = "X-ClickZetta-Token=${token}"`,
      ].join("\n"),
    )
    const env = { HOME: root, CLICKZETTA_TEST_HOME: root }
    const invalid = await cli(["sv", "list", "--timeout", "0"], env)
    expect(invalid.body.error?.code).toBe("INVALID_TIMEOUT")
    expect(requests).toEqual([])
    const result = await cli(["sv", "list", "--timeout", "0.05"], env)
    expect(result.code).not.toBe(0)
    expect(String(result.body.error?.message)).toContain("timed out after 50ms")
    expect(requests).toContain("/lh/submitJob")
    expect(requests).toContain("/lh/getJob")
    expect(requests).toContain("/lh/cancelJob")
    expect(requests.every((route) => ["/lh/submitJob", "/lh/getJob", "/lh/cancelJob"].includes(route))).toBe(true)
  } finally {
    server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 15000)

test("generation transports shared guidance and distinguishes empty, truncated and malformed provider responses", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cz-sv-provider-"))
  const requests: string[] = []
  const responses = [
    { choices: [{ finish_reason: "length", message: { content: '{"model":' } }] },
    { choices: [{ finish_reason: "stop", message: { content: "" } }] },
    { choices: [{ finish_reason: "stop", message: { content: "not JSON" } }] },
    { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ model: { name: "sales", tables: [{ name: "o", base_table: { database: "w", schema: "s", table: "orders" }, metrics: [{ name: "avg_qty", expr: "AVG(o.qty)" }] }] }, coverage: [{ requirement: "average quantity", fields: ["o.avg_qty"], status: "covered" }], assumptions: [] }) } }] },
  ]
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push(await request.text())
      return Response.json(responses[requests.length - 1])
    },
  })
  try {
    await mkdir(path.join(root, ".clickzetta"))
    await Bun.write(path.join(root, ".clickzetta/llm.json"), JSON.stringify({ model: "fixture/test", provider: { fixture: { npm: "@ai-sdk/openai-compatible", options: { apiKey: "test-key", baseURL: `http://127.0.0.1:${server.port}/v1` } } } }))
    const file = path.join(root, "request.json")
    await Bun.write(file, JSON.stringify({ metadata: { columns: ["qty"] }, requirements: ["average quantity"] }))
    for (const code of ["LLM_OUTPUT_TRUNCATED", "LLM_EMPTY_RESPONSE", "INVALID_LLM_RESPONSE"]) {
      const result = await cli(["sv", "generate", "--file-path", file], { CLICKZETTA_TEST_HOME: root })
      expect(result.code).not.toBe(0)
      expect(result.body.error?.code).toBe(code)
    }
    const generated = await cli(["sv", "generate", "--file-path", file], { CLICKZETTA_TEST_HOME: root })
    expect(generated.code).toBe(0)
    expect(generated.body.data?.coverage).toEqual([{ requirement: "average quantity", fields: ["o.avg_qty"], status: "covered" }])
    expect(requests).toHaveLength(4)
    expect(requests[3]).toContain("AVG(quantity)")
    expect(requests[3]).toContain("average quantity")
  } finally {
    server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})
