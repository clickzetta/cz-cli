import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseModel } from "../src/semantic-view/model.js"
import { compile } from "../src/semantic-view/compile.js"
import { convertImport, parseImportOptions } from "../src/semantic-view/import.js"
import { editModel } from "../src/semantic-view/edit.js"
import { auditModel } from "../src/semantic-view/audit.js"
import {
  createOptimization,
  runOptimization,
  getOptimization,
  cancelOptimization,
} from "../src/semantic-view/optimization.js"
import { compareQueries, buildQuery, generateQuery, transformQueries } from "../src/semantic-view/query.js"
import { runSv } from "../src/semantic-view/commands.js"
import { SemanticService } from "../src/semantic-view/service.js"
import { withFileLock, atomicWrite } from "../src/semantic-view/files.js"

const base = () =>
  parseModel({
    name: "sales",
    tables: [
      {
        name: "o",
        base_table: { database: "w", schema: "s", table: "orders" },
        dimensions: [{ name: "id", expr: "o.id" }],
        metrics: [{ name: "amount", expr: "SUM(o.amount)" }],
      },
    ],
  })

test("facts reject cross-table dimensions before SQL submission and accept same-grain projections", () => {
  const model = base()
  model.tables[0].facts.push({ ...model.tables[0].metrics[0], name: "raw_amount", expr: "o.amount" })
  model.tables.push({ ...model.tables[0], name: "customer", dimensions: [{ ...model.tables[0].dimensions[0], name: "customer_id" }] })
  expect(() => buildQuery(model, "w.s.sales", { facts: ["o.raw_amount"], dimensions: ["customer.customer_id"] })).toThrow("same logical table")
  expect(buildQuery(model, "w.s.sales", { facts: ["o.raw_amount"], dimensions: ["o.id"], limit: 0 })).toContain("FACTS `o`.`raw_amount`")
})

test("import options reject ignored filters before reading or converting a source", async () => {
  expect(() => parseImportOptions({ include_measures_all: false })).toThrow("Unknown or invalid import option")
  expect(() => parseImportOptions({ include_tables: "Orders" })).toThrow("Unknown or invalid import option")
  expect(() => parseImportOptions({ mapping: { Orders: { schema: "s" } } })).toThrow("Unknown or invalid import option")
  expect(
    parseImportOptions({ include_tables: ["Orders"], mapping: { Orders: { schema: "s", table: "orders" } } }),
  ).toMatchObject({ include_tables: ["Orders"] })
})

test("VQR batch conversion retains order and per-query failures without claiming equivalence", async () => {
  const statements: string[] = []
  const service = new SemanticService(
    async (sql) => {
      statements.push(sql)
      if (sql === "EXPLAIN SELECT missing") throw new Error("Unknown column missing")
      return { columns: [], rows: [], job_id: `job_${statements.length}` }
    },
    { workspace: "w", schema: "s" },
    "test",
  )
  const result = await transformQueries(
    async (_, input) => ({ sql: (input as { sql: string }).sql }),
    service,
    base(),
    ["SELECT 1", "SELECT missing", "SELECT 3"],
    "expand",
  )
  expect(result.success).toBe(false)
  expect(result.results.map((item) => [item.index, item.input_sql, item.success])).toEqual([
    [0, "SELECT 1", true],
    [1, "SELECT missing", false],
    [2, "SELECT 3", true],
  ])
  expect(result.results[0]).toMatchObject({
    compiled: true,
    equivalence_verified: false,
    validation_job_ids: ["job_1", "job_2"],
  })
  expect(result.results[1]).toMatchObject({ error: "Unknown column missing" })
  expect(statements).toHaveLength(5)
  await expect(
    transformQueries(
      async () => {
        throw new Error("must not call LLM")
      },
      service,
      base(),
      ["SELECT 1", "DROP TABLE orders"],
      "truncate",
    ),
  ).rejects.toThrow("readonly")
  expect(statements).toHaveLength(5)
})

test("backend rejects malformed SQL batches before profile access", async () => {
  for (const sqls of ["SELECT 1", [42], [" "]]) {
    await expect(
      runSv("backend", { tool: "expand_verified_query", parameters: JSON.stringify({ sqls }) }),
    ).rejects.toThrow()
  }
})

test("VQR compilation retains SQL and question evidence without executing queries", async () => {
  const statements: string[] = []
  const service = new SemanticService(
    async (sql) => {
      statements.push(sql)
      return { columns: [], rows: [], job_id: "validation_job" }
    },
    { workspace: "w", schema: "s" },
    "test",
  )
  const result = await service.validateQueries({
    ...base(),
    verified_queries: [
      { name: "count", question: "How many?", sql: "SELECT COUNT(*) FROM w.s.orders" },
      { name: "bad", question: "Invalid query", sql: "DELETE FROM w.s.orders" },
    ],
  })
  expect(result.valid).toBe(false)
  expect(result.queries[0]).toMatchObject({
    question: "How many?",
    sql: "SELECT COUNT(*) FROM w.s.orders",
    valid: true,
    job_id: "validation_job",
  })
  expect(result.queries[1]).toMatchObject({ name: "bad", valid: false })
  expect(statements).toEqual(["EXPLAIN SELECT COUNT(*) FROM w.s.orders"])
})

test("same-named physical aggregate is not a metric cycle and rename keeps physical source", () => {
  const model = base()
  expect(compile(model, { workspace: "w", schema: "s" }).sql).toContain("SUM(o.amount)")
  const edited = editModel(model, [
    { operation: "rename_column", params: { table: "o", old_name: "amount", new_name: "revenue" } },
  ])
  expect(edited.tables[0].metrics[0].expr).toBe("SUM(o.amount)")
  expect(edited.tables[0].metrics[0].name).toBe("revenue")
  expect(
    editModel(model, [
      {
        operation: "add_metric",
        params: { table: "o", name: "count_id", expression: "o.id", default_aggregation: "count_distinct" },
      },
    ]).tables[0].metrics[1].expr,
  ).toBe("COUNT(DISTINCT o.id)")
})

test("OSI dialects, composite relationships, keys and provenance convert without invention", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cz-sv-import-"))
  try {
    const file = path.join(dir, "osi.yaml")
    await Bun.write(
      file,
      Bun.YAML.stringify({
        version: "0.2.0",
        name: "sales",
        datasets: [
          {
            name: "o",
            source: "w.s.orders",
            fields: [{ name: "id", expression: { dialects: [{ dialect: "ANSI_SQL", expression: "id" }] } }],
          },
          { name: "c", source: "w.s.customers", primary_key: ["id"], unique_keys: [["code"]], fields: [] },
        ],
        relationships: [{ name: "customer", from: "o", to: "c", from_columns: ["customer_id"], to_columns: ["id"] }],
        metrics: [
          { name: "revenue", expression: { dialects: [{ dialect: "ANSI_SQL", expression: "SUM(o.amount)" }] } },
        ],
      }),
    )
    const result = await convertImport(file, "osi")
    expect(result.losses).toEqual([])
    expect(result.model.relationships[0].left_table).toBe("o")
    expect(result.model.tables[1].unique_keys[0].columns).toEqual(["code"])
    expect(result.model.metrics[0].expr).toBe("SUM(o.amount)")
    expect(result.model.module_custom_instructions).toHaveProperty("osi")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("optimization persists accepted improvements, refuses SQL mutations and supports cancellation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cz-sv-job-"))
  try {
    const job = await createOptimization(base(), { root, iterations: 2 })
    let calls = 0
    const result = await runOptimization(job.id, {
      root,
      complete: async () =>
        ++calls === 1
          ? {
              operations: [
                {
                  operation: "update_column_description",
                  params: { table: "o", column: "amount", description: "Sum of order amounts at order grain" },
                },
              ],
              reason: "Explain metric",
            }
          : {
              operations: [
                {
                  operation: "update_column_expression",
                  params: { table: "o", column: "amount", new_expression: "SUM(o.amount)*10" },
                },
              ],
            },
    })
    expect(result.state).toBe("completed")
    expect(result.history.map((h) => h.accepted)).toEqual([true, false])
    expect(result.best.tables[0].metrics[0].expr).toBe("SUM(o.amount)")
    expect((await getOptimization(job.id, root)).best_score).toBeGreaterThan(job.best_score)
    const cancelled = await createOptimization(base(), { root })
    await cancelOptimization(cancelled.id, root)
    expect(
      (
        await runOptimization(cancelled.id, {
          root,
          complete: async () => {
            throw new Error("must not call")
          },
        })
      ).state,
    ).toBe("cancelled")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("query comparison retains multiplicity and does not mark truncated samples equivalent", async () => {
  let calls = 0
  const service = new SemanticService(
    async () => ({ columns: ["value"], rows: ++calls === 1 ? [[1], [1], [2]] : [[2], [1], [1]] }),
    { workspace: "w", schema: "s" },
    "test",
  )
  expect((await compareQueries(service, "SELECT 1", "SELECT 2")).equivalent).toBe(true)
  await expect(compareQueries(service, "SELECT 1", "SELECT 2", 1)).rejects.toThrow("exceeds")
  await expect(compareQueries(service, "DROP TABLE x", "SELECT 1")).rejects.toThrow("readonly")
  expect(() => buildQuery(base(), "w.s.sales", { metrics: ["missing"] })).toThrow("unique")
})

test("local lock prevents lost updates and is released on errors", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cz-sv-lock-"))
  const file = path.join(root, "model.yaml")
  try {
    await expect(
      withFileLock(file, async () => {
        await atomicWrite(file, "first")
        await withFileLock(file, async () => atomicWrite(file, "second"))
      }),
    ).rejects.toThrow()
    expect(await Bun.file(file).text()).toBe("first")
    await withFileLock(file, async () => atomicWrite(file, "next"))
    expect(await Bun.file(file).text()).toBe("next")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("audit uses corrected single/multiple table denominator and exposes components", () => {
  expect(auditModel(base()).maximum).toBe(5)
  const model = base()
  model.tables.push({ ...model.tables[0], name: "other", metrics: [], dimensions: [] })
  expect(auditModel(model).maximum).toBe(6)
  expect(auditModel(model).findings.some((f) => f.code === "DISCONNECTED_TABLE")).toBe(true)
})

test("filter physical references become declared native fields and predicate uses the same mapping", () => {
  const model = base()
  model.tables[0].metrics[0].name = "revenue"
  model.tables[0].filters.push({
    name: "large",
    expr: "o.amount > 100",
    synonyms: [],
    using_relationships: [],
    non_additive_dimensions: [],
  })
  const native = compile(model, { workspace: "w", schema: "s" })
  const helper = native.native.tables[0].facts[0]
  expect(helper.name).toMatch(/^__cz_filter_/)
  expect(buildQuery(model, "w.s.sales", { metrics: ["o.revenue"], filters: ["o.large"] })).toContain(helper.name)
  expect(model.tables[0].facts).toHaveLength(0)
})

test("query generation repairs compilation errors but never retries a write", async () => {
  const attempts: unknown[] = []
  const service = new SemanticService(
    async (sql) => {
      if (sql.includes("wrong")) throw new Error("unknown column")
      return { columns: [], rows: [], job_id: "compiled" }
    },
    { workspace: "w", schema: "s" },
    "test",
  )
  const result = await generateQuery(
    async (_instruction, input) => {
      attempts.push(input)
      return { sql: attempts.length === 1 ? "SELECT wrong" : "SELECT 1" }
    },
    service,
    base(),
    "w.s.sales",
    "total",
  )
  expect(result.attempts).toBe(2)
  expect(attempts[1]).toHaveProperty("attempts")
  await expect(
    generateQuery(async () => ({ sql: "DROP TABLE orders" }), service, base(), "w.s.sales", "total"),
  ).rejects.toThrow("readonly")
})
