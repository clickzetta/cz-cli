import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parseModel, yaml, fields } from "../src/semantic-view/model.js"
import { compile } from "../src/semantic-view/compile.js"
import { decodeMetadata, semanticShape, sameSemanticDefinition, fingerprint } from "../src/semantic-view/metadata.js"
import { editModel } from "../src/semantic-view/edit.js"
import {
  rewriteReferences,
  expression,
  normalizeExpression,
  arithmeticShape,
  literal,
} from "../src/semantic-view/sql.js"

const example = {
  name: "sales",
  tables: [
    {
      name: "o",
      base_table: { database: "w", schema: "s", table: "orders" },
      primary_key: { columns: ["id"] },
      dimensions: [{ name: "dt", expr: "o.day" }],
      facts: [{ name: "net", expr: "o.amount-o.discount" }],
      metrics: [
        { name: "revenue", expr: "SUM(o.net)" },
        { name: "cnt", expr: "COUNT(o.id)" },
      ],
    },
  ],
  metrics: [
    { name: "avg", expr: "o.revenue/o.cnt" },
    { name: "double_avg", expr: "avg*2" },
  ],
}

test("YAML round trip and unsupported keys fail without loss", () => {
  expect(parseModel(yaml(parseModel(example)))).toEqual(parseModel(example))
  expect(() => parseModel({ ...example, typo: 1 })).toThrow("schema validation")
})
test("native SQL literals escape nested VQR quotes and backslashes", () => {
  expect(literal("O'Brien\\archive")).toBe("'O\\'Brien\\\\archive'")
  const model = parseModel({
    ...example,
    description: "O'Brien\\archive",
    verified_queries: [{ name: "dated", question: "Customer's sales", sql: "SELECT CAST('2000-03-11' AS DATE)" }],
  })
  expect(compile(model, { workspace: "w", schema: "s" }).sql).toContain(
    "QUESTION 'Customer\\'s sales' SQL 'SELECT CAST(\\'2000-03-11\\' AS DATE)'",
  )
  expect(compile(model, { workspace: "w", schema: "s" }).sql).toContain("COMMENT = 'O\\'Brien\\\\\\\\archive'")
})
test("compiler expands scalar derived chains and quotes nonadditive paths by segment", () => {
  const model = parseModel(example)
  model.tables[0].metrics[0].non_additive_dimensions = [
    { dimension: "o.dt", sort_direction: "descending", null_order: "last" },
  ]
  const ddl = compile(model, { workspace: "w", schema: "s" }).sql
  expect(ddl).toContain("NON ADDITIVE BY (`o`.`dt` DESC NULLS LAST)")
  expect(ddl).toContain("(o.revenue/o.cnt)*2")
})
test("references ignore SQL strings, comments and functions", () => {
  expect(
    rewriteReferences("'o.net' || o.net /* o.net */", (p) => (p.join(".") === "o.net" ? "o.changed" : undefined)),
  ).toBe("'o.net' || o.changed /* o.net */")
  expect(() => expression("o.id; DROP TABLE x")).toThrow()
  expect(() => expression("'unterminated")).toThrow()
  expect(normalizeExpression("`sum`(o.amount)", "o")).toBe(normalizeExpression("SUM(amount)", "o"))
})
test("batch edit updates dependencies and remains atomic on failure", () => {
  const model = parseModel(example)
  const edited = editModel(model, [
    { operation: "rename_column", params: { table: "o", old_name: "net", new_name: "net_amount" } },
  ])
  expect(edited.tables[0].metrics[0].expr).toBe("SUM(`o`.`net_amount`)")
  expect(model.tables[0].facts[0].name).toBe("net")
  expect(() => editModel(model, [{ operation: "remove_column", params: { table: "o", column: "net" } }])).toThrow(
    "dependents",
  )
  const removed = editModel(model, [
    { operation: "remove_column", params: { table: "o", column: "net", handle_dependents: "remove" } },
  ])
  expect(fields(removed).map((f) => f.key)).toEqual(["o.dt", "o.cnt"])
})
test("cycles and missing references are rejected", () => {
  expect(() =>
    parseModel({
      ...example,
      metrics: [
        { name: "a", expr: "b+1" },
        { name: "b", expr: "a+1" },
      ],
    }),
  ).toThrow("references")
  expect(() =>
    parseModel({
      ...example,
      relationships: [
        {
          name: "bad",
          left_table: "missing",
          right_table: "o",
          relationship_columns: [{ left_column: "id", right_column: "id" }],
        },
      ],
    }),
  ).toThrow("references")
})
test("live metadata fixtures preserve private fields, ASOF and lost SHOW CREATE metadata", () => {
  const load = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`./fixtures/semantic-view/${name}.json`, import.meta.url), "utf8"),
    ).output.rows as unknown[][]
  const privateModel = decodeMetadata("private_sv", load("88-private-json")).model
  expect(privateModel.tables[0].facts[0].access_modifier).toBe("private_access")
  const asof = decodeMetadata("asof_sv", load("107-asof-json")).model
  expect(asof.relationships[0].relationship_columns[1].type).toBe("asof")
  const metadata = decodeMetadata("metadata_sv", load("47-metadata-json")).model
  expect(metadata.tables[0].constraints[0].type).toBe("BLOOM_FILTER")
  expect(metadata.tables[0].dimensions[0].enum_values).toEqual(["2026-01-01", "2026-01-02"])
  expect(fingerprint(semanticShape(asof))).toBe(fingerprint(semanticShape(parseModel(yaml(asof)))))
})

test("native default UNIQUE flags round trip while nondefault key flags block replacement", () => {
  const raw = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/semantic-view/keys.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).data.raw
  expect(decodeMetadata("retail", [["def", JSON.stringify(raw)]]).unknown).toEqual([])
  raw.logicalTables[4].constraints[1].uniqueKey.enable = true
  expect(decodeMetadata("retail", [["def", JSON.stringify(raw)]]).unknown).toContain(
    "logicalTables.4.constraints.1.key_flags",
  )
  raw.logicalTables[0].constraints[0].primaryKey.rely = false
  expect(decodeMetadata("retail", [["def", JSON.stringify(raw)]]).unknown).toContain(
    "logicalTables.0.constraints.0.key_flags",
  )
})

test("native canonicalization handles case folding, default window ASC and annotation ordering", () => {
  const upper = parseModel({
    name: "sales",
    tables: [
      {
        name: "Orders",
        base_table: { database: "W", schema: "S", table: "T" },
        dimensions: [{ name: "Day", expr: "Orders.dt", is_time: true, synonyms: ["date"], description: "Order day" }],
        metrics: [{ name: "Revenue", expr: "SUM(Orders.amount)" }],
      },
    ],
  })
  const lower = parseModel(
    JSON.stringify(upper)
      .replaceAll("Orders", "orders")
      .replaceAll("Revenue", "revenue")
      .replaceAll("Day", "day")
      .replaceAll('"W"', '"w"')
      .replaceAll('"S"', '"s"')
      .replaceAll('"T"', '"t"'),
  )
  expect(fingerprint(semanticShape(upper))).toBe(fingerprint(semanticShape(lower)))
  expect(normalizeExpression("SUM(SUM(o.amount)) OVER (ORDER BY o.dt ASC ROWS UNBOUNDED PRECEDING)", "o")).toBe(
    normalizeExpression("SUM(SUM(o.amount)) OVER (ORDER BY o.dt ROWS UNBOUNDED PRECEDING)", "o"),
  )
  expect(compile(upper, { workspace: "w", schema: "s" }).sql).toContain(
    "WITH SYNONYMS ('date') is_time = true COMMENT = 'Order day'",
  )
})

test("readback arithmetic accepts redundant grouping without weakening semantic checks or fingerprints", () => {
  const left = parseModel({ ...example, metrics: [{ name: "combined", expr: "o.revenue + o.cnt + o.revenue" }] })
  const right = parseModel({ ...example, metrics: [{ name: "combined", expr: "(o.revenue + o.cnt) + o.revenue" }] })
  expect(fingerprint(semanticShape(left))).not.toBe(fingerprint(semanticShape(right)))
  expect(sameSemanticDefinition(left, right)).toBe(true)
  right.metrics[0].expr = "o.revenue + (o.cnt + o.revenue)"
  expect(sameSemanticDefinition(left, right)).toBe(false)
  right.metrics[0].expr = left.metrics[0].expr
  right.tables[0].primary_key = { columns: ["other_id"] }
  expect(sameSemanticDefinition(left, right)).toBe(false)
  for (const [first, second] of [
    ["a - b - c", "(a - b) - c"],
    ["a / b * c", "(a / b) * c"],
    ["a + b * c", "a + (b * c)"],
    ["-a + b", "(-a) + b"],
  ])
    expect(arithmeticShape(first)).toBe(arithmeticShape(second))
  for (const [first, second] of [
    ["a - b - c", "a - (b - c)"],
    ["a / b * c", "a / (b * c)"],
    ["a + b * c", "(a + b) * c"],
    ["-a + b", "-(a + b)"],
    ["a + b", "b + a"],
  ])
    expect(arithmeticShape(first)).not.toBe(arithmeticShape(second))
  for (const sql of ["SUM(a) + b", "CASE WHEN a > 0 THEN b ELSE c END", "a || b", "a +", "(a+b", "a > b"])
    expect(arithmeticShape(sql)).toBeUndefined()
})

test("readback qualifies unique top-level fields without accepting semantic changes", () => {
  const left = parseModel({
    name: "sales",
    tables: [
      {
        name: "orders",
        base_table: { workspace: "w", schema: "s", table: "orders" },
        dimensions: [{ name: "status", expr: "status", synonyms: ["Paid Status"] }],
        facts: [{ name: "amount", expr: "amount" }],
      },
    ],
    metrics: [{ name: "revenue", expr: "SUM(CASE WHEN status = 'paid' THEN amount END)" }],
  })
  const right = parseModel(left)
  right.tables[0].dimensions[0].synonyms = ["paid status"]
  right.metrics[0].expr = "SUM(CASE WHEN orders.status = 'paid' THEN orders.amount END)"
  expect(fingerprint(semanticShape(left))).not.toBe(fingerprint(semanticShape(right)))
  expect(sameSemanticDefinition(left, right)).toBe(true)
  for (const expr of ["AVG(orders.amount)", "SUM(CASE WHEN orders.status = 'PAID' THEN orders.amount END)"]) {
    const changed = parseModel(right)
    changed.metrics[0].expr = expr
    expect(sameSemanticDefinition(left, changed)).toBe(false)
  }
  const ambiguousLeft = parseModel(left)
  ambiguousLeft.tables.push({ ...left.tables[0], name: "returns" })
  const ambiguousRight = parseModel(right)
  ambiguousRight.tables.push({ ...right.tables[0], name: "returns" })
  expect(sameSemanticDefinition(ambiguousLeft, ambiguousRight)).toBe(false)
})

test("captured native models match compiled author intent after server left grouping", () => {
  for (const [arm, name] of [
    ["without_skills", "tpcds_retail_sv"],
    ["with_skills", "tpcds_retail_analytics_sv"],
  ]) {
    const root = new URL("./fixtures/semantic-view/", import.meta.url)
    const authored = parseModel(readFileSync(new URL(`${arm}.yaml`, root), "utf8"))
    const readback = JSON.parse(readFileSync(new URL(`${arm}.json`, root), "utf8"))
    const native = compile(authored, {
      workspace: "czcli",
      schema: readback.fqn.split(".")[1],
      target: readback.fqn,
    }).native
    expect(sameSemanticDefinition(native, parseModel(readback.native))).toBe(true)
    const changed = parseModel(readback.native)
    changed.metrics[0].expr += " + 1"
    expect(sameSemanticDefinition(native, changed)).toBe(false)
  }
})
