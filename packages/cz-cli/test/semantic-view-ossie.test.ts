import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { SemanticService } from "../src/semantic-view/service.js"
import { SemanticViewError } from "../src/semantic-view/error.js"
import { MANAGED_PROPERTY } from "../src/semantic-view/compile.js"
import {
  createSql,
  exportSql,
  inspectOssie,
  isOssieText,
  pushOssie,
  remapSources,
  validateOssie,
} from "../src/semantic-view/ossie.js"
import { runSv } from "../src/semantic-view/commands.js"

const current = `version: "0.2.0.dev0"
name: sales
datasets:
  - name: orders
    source: s.orders
    primary_key: [order_id]
    fields:
      - name: order_id
        expression: {dialects: [{dialect: ANSI_SQL, expression: order_id}]}
        dimension: {}
      - name: amount
        expression: {dialects: [{dialect: ANSI_SQL, expression: amount}]}
metrics:
  - name: revenue
    expression: {dialects: [{dialect: ANSI_SQL, expression: "SUM(orders.amount)"}]}
`

const legacy = `version: "0.1.1"
semantic_model:
  - name: legacy_sales
    datasets:
      - name: orders
        source: s.orders
        fields: []
`

// A fake server: one semantic view whose export changes only when a CREATE succeeds.
function server(initial?: string) {
  const state = { yaml: initial, properties: { owner_note: "keep", [MANAGED_PROPERTY]: "{}" } as Record<string, string> }
  const statements: string[] = []
  const service = new SemanticService(
    async (sql) => {
      statements.push(sql)
      if (sql.startsWith("EXPLAIN ")) return { columns: ["plan"], rows: [["ok"]], job_id: "explain" }
      if (sql.startsWith("DESC SEMANTIC VIEW")) {
        if (!state.yaml) throw new SemanticViewError("CZLH-42000", "table or view not found - w.s.sales")
        return { columns: ["ddl"], rows: [[state.yaml]], job_id: "export" }
      }
      if (sql.startsWith("SHOW PROPERTIES")) return { columns: ["k", "v"], rows: Object.entries(state.properties) }
      if (sql.startsWith("CREATE ")) {
        state.yaml = "# canonical\n" + sql.slice(sql.indexOf(" AS '") + 5, -1)
        state.properties = {}
        return { columns: [], rows: [], job_id: "create" }
      }
      if (sql.startsWith("ALTER SEMANTIC VIEW")) return { columns: [], rows: [], job_id: "alter" }
      throw new Error(`unexpected SQL: ${sql}`)
    },
    { workspace: "w", schema: "s" },
    "test",
  )
  return { service, statements, state }
}

test("Ossie SQL spells the engine's import/export statements and escapes the document", () => {
  expect(createSql("w.s.sales", "name: it's", true)).toBe(
    "CREATE OR REPLACE SEMANTIC VIEW `w`.`s`.`sales` USING OSSIE YAML AS 'name: it\\'s'",
  )
  expect(exportSql("w.s.sales")).toBe("DESC SEMANTIC VIEW `w`.`s`.`sales` AS OSSIE YAML")
  expect(exportSql("w.s.sales", "0.1.1")).toBe("DESC SEMANTIC VIEW `w`.`s`.`sales` AS OSSIE YAML VERSION '0.1.1'")
  expect(() => exportSql("w.s.sales", "0.3")).toThrow("Unsupported Ossie export version")
})

test("preview accepts both Ossie layouts and mirrors the engine's shape rules", () => {
  expect(isOssieText(current)).toBe(true)
  expect(isOssieText("name: sales\ntables: []")).toBe(false)
  const flat = inspectOssie(current)
  expect(flat).toMatchObject({ version: "0.2.0.dev0", layout: "flat", name: "sales", metric_count: 1, valid: true })
  expect(flat.datasets[0]).toMatchObject({ name: "orders", dimensions: 1, facts: 1 })
  expect(inspectOssie(legacy)).toMatchObject({ version: "0.1.1", layout: "semantic_model", name: "legacy_sales" })
  expect(() => inspectOssie(current.replace("0.2.0.dev0", "0.3.0"))).toThrow("Unsupported Ossie specification version")
  expect(() => inspectOssie(legacy.replace("semantic_model:", "semantic_model: []\nx:"))).toThrow("exactly one")
  const bad = inspectOssie(current.replaceAll("ANSI_SQL", "BIGQUERY"))
  expect(bad.valid).toBe(false)
  expect(bad.issues.map((i) => i.path)).toContain("metrics.revenue")
})

test("source mapping rebinds only dataset sources", () => {
  const mapped = inspectOssie(remapSources(current, { orders: "prod.sales.orders" }))
  expect(mapped.datasets[0].source).toBe("prod.sales.orders")
  expect(mapped.metric_count).toBe(1)
  expect(() => remapSources(current, { missing: "a.b" })).toThrow("unknown dataset")
})

test("validate runs the server conversion through EXPLAIN without creating anything", async () => {
  const { service, statements } = server()
  const result = await validateOssie(service, "sales", current)
  expect(result).toMatchObject({ valid: true, fqn: "w.s.sales", validation_job_id: "explain" })
  expect(statements).toEqual([`EXPLAIN ${createSql("w.s.sales", current, true)}`])
  await expect(validateOssie(service, "sales", current.replaceAll("ANSI_SQL", "BIGQUERY"))).rejects.toThrow(
    "shape errors",
  )
  expect(statements).toHaveLength(1)
})

test("push creates when absent, requires a baseline to replace, and rejects stale baselines", async () => {
  const { service, statements, state } = server()
  const created = await pushOssie(service, "sales", current, { baseline: "absent" })
  expect(created).toMatchObject({ status: "created", fqn: "w.s.sales", job_id: "create", normalized: true })
  expect(statements.some((s) => s.startsWith("CREATE SEMANTIC VIEW `w`.`s`.`sales` USING OSSIE YAML"))).toBe(true)

  await expect(pushOssie(service, "sales", current)).rejects.toMatchObject({ code: "BASELINE_REQUIRED" })
  await expect(pushOssie(service, "sales", current, { baseline: "stale" })).rejects.toMatchObject({ code: "CONFLICT" })

  state.properties = { owner_note: "keep", [MANAGED_PROPERTY]: "{}" }
  const replaced = await pushOssie(service, "sales", current, { baseline: created.remote_fingerprint })
  expect(replaced.status).toBe("replaced")
  expect(replaced.restored_properties).toEqual(["owner_note"])
  expect(statements.some((s) => s.startsWith("CREATE OR REPLACE SEMANTIC VIEW"))).toBe(true)
  expect(statements.at(-2)).toBe("ALTER SEMANTIC VIEW `w`.`s`.`sales` SET TBLPROPERTIES ('owner_note'='keep')")
})

test("a failed CREATE is reported as uncertain with its job id instead of being retried", async () => {
  const { service, statements } = server()
  const execute = service.execute
  const failing = new SemanticService(
    async (sql, options) => {
      if (sql.startsWith("CREATE ")) {
        await options?.onJobId?.("job_lost")
        throw new Error("connection reset")
      }
      return execute(sql, options)
    },
    service.binding,
    service.identity,
  )
  await expect(pushOssie(failing, "sales", current, { baseline: "absent" })).rejects.toMatchObject({
    code: "PUSH_UNCERTAIN",
    details: { job_id: "job_lost" },
  })
  expect(statements.filter((s) => s.startsWith("CREATE"))).toHaveLength(0)
})

test("local commands preview, map and track Ossie files without contacting a server", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cz-sv-ossie-"))
  try {
    const source = path.join(root, "sales.ossie.yaml")
    await Bun.write(source, current)
    const preview = (await runSv("import", { kind: "osi", filePath: source } as never)) as { preview: { name: string } }
    expect(preview.preview.name).toBe("sales")
    const out = path.join(root, "mapped.ossie.yaml")
    const drafted = (await runSv("import", {
      kind: "ossie",
      filePath: source,
      outPath: out,
      parameters: '{"mapping":{"orders":"prod.sales.orders"}}',
    } as never)) as { tracking: { state: string; format: string; ossie_version: string } }
    expect(drafted.tracking).toMatchObject({ state: "draft", format: "ossie", ossie_version: "0.2.0.dev0" })
    expect(inspectOssie(await Bun.file(out).text()).datasets[0].source).toBe("prod.sales.orders")
    await expect(
      runSv("import", { kind: "ossie", filePath: source, parameters: '{"include_tables":["orders"]}' } as never),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT_OPTIONS" })
    expect(await runSv("validate", { filePath: source, mode: "local" } as never)).toMatchObject({ valid: true })
    expect(await runSv("read", { source: "workspace", filePath: source } as never)).toMatchObject({ format: "ossie" })
    await expect(runSv("audit", { filePath: source } as never)).rejects.toMatchObject({ code: "OSSIE_DOCUMENT" })
    await expect(runSv("push", { filePath: source } as never)).rejects.toMatchObject({ code: "WRITE_REQUIRED" })
    expect(await runSv("status", { filePath: source } as never)).toMatchObject({ local: "untracked", state: "untracked" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
