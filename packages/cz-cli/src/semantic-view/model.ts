import { z } from "zod"
import { SemanticViewError } from "./error.js"
import { expression, references } from "./sql.js"

const name = z.string().min(1)
const column = z
  .object({
    name,
    expr: z.string().min(1),
    description: z.string().optional(),
    synonyms: z.array(z.string()).default([]),
    data_type: z.string().optional(),
    sample_values: z.array(z.unknown()).optional(),
    unique: z.boolean().optional(),
    is_unique: z.boolean().optional(),
    is_time: z.boolean().optional(),
    enum_values: z.array(z.unknown()).optional(),
    access_modifier: z.enum(["public_access", "private_access"]).optional(),
    using_relationships: z.array(name).default([]),
    non_additive_dimensions: z
      .array(
        z
          .object({
            table: name.optional(),
            dimension: name,
            sort_direction: z.enum(["ascending", "descending"]).default("ascending"),
            null_order: z.enum(["first", "last"]).default("last"),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
const key = z.object({ columns: z.array(name).min(1) }).strict()
const table = z
  .object({
    name,
    description: z.string().optional(),
    synonyms: z.array(z.string()).default([]),
    base_table: z.object({ database: name.optional(), workspace: name.optional(), schema: name, table: name }).strict(),
    primary_key: key.optional(),
    unique_keys: z.array(key).default([]),
    dimensions: z.array(column).default([]),
    time_dimensions: z.array(column).default([]),
    facts: z.array(column).default([]),
    metrics: z.array(column).default([]),
    filters: z.array(column).default([]),
    constraints: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .strict()
const relationship = z
  .object({
    name,
    left_table: name,
    right_table: name,
    relationship_columns: z
      .array(
        z
          .object({
            left_column: name,
            right_column: name.optional(),
            type: z.enum(["equi", "asof", "range"]).default("equi"),
            right_range: z.object({ start_column: name, end_column: name }).strict().optional(),
          })
          .strict(),
      )
      .min(1),
    join_type: z.enum(["left", "left_outer", "inner", "right", "full"]).default("left_outer"),
    relationship_type: z.enum(["many_to_one", "one_to_one", "many_to_many"]).default("many_to_one"),
  })
  .strict()
const vqr = z
  .object({
    name,
    question: name,
    sql: name,
    verified_at: z.union([z.string(), z.number()]).optional(),
    verified_by: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    use_as_onboarding_question: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict()
export const ModelSchema = z
  .object({
    name,
    description: z.string().optional(),
    tables: z.array(table).min(1),
    relationships: z.array(relationship).default([]),
    metrics: z.array(column).default([]),
    verified_queries: z.array(vqr).default([]),
    module_custom_instructions: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    custom_instructions: z.string().optional(),
    properties: z.record(z.string(), z.string()).default({}),
  })
  .strict()
export type Model = z.infer<typeof ModelSchema>
export type Field = z.infer<typeof column>
export type Table = z.infer<typeof table>
export type Relationship = z.infer<typeof relationship>
export type VerifiedQuery = z.infer<typeof vqr>
export type Issue = { code: string; path: string; message: string; severity: "error" | "warning" }

export function parseModel(input: unknown): Model {
  const value = typeof input === "string" ? Bun.YAML.parse(input) : input
  const parsed = ModelSchema.safeParse(value)
  if (!parsed.success)
    throw new SemanticViewError("INVALID_MODEL", "Semantic model schema validation failed", parsed.error.issues)
  const issues = validateModel(parsed.data).filter((x) => x.severity === "error")
  if (issues.length) throw new SemanticViewError("INVALID_MODEL", "Semantic model references are invalid", issues)
  return parsed.data
}

export function fields(model: Model) {
  return model.tables
    .flatMap((table) =>
      (["dimensions", "time_dimensions", "facts", "metrics", "filters"] as const).flatMap((kind) =>
        table[kind].map((field) => ({ table: table.name, kind, field, key: `${table.name}.${field.name}` })),
      ),
    )
    .concat(model.metrics.map((field) => ({ table: "", kind: "metrics" as const, field, key: field.name })))
}

export function validateModel(model: Model): Issue[] {
  const issues: Issue[] = []
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message, severity: "error" })
  const unique = (values: string[], path: string) => {
    const seen = new Set<string>()
    values.forEach((value) => {
      if (seen.has(value.toLowerCase())) add("DUPLICATE_NAME", path, `Duplicate name: ${value}`)
      seen.add(value.toLowerCase())
    })
  }
  unique(
    model.tables.map((t) => t.name),
    "tables",
  )
  unique(
    model.relationships.map((r) => r.name),
    "relationships",
  )
  unique(
    model.verified_queries.map((q) => q.name),
    "verified_queries",
  )
  unique(
    fields(model).map((f) => f.key),
    "fields",
  )
  const aliases = new Set(model.tables.map((t) => t.name.toLowerCase()))
  model.relationships.forEach((r, i) => {
    if (!aliases.has(r.left_table.toLowerCase()) || !aliases.has(r.right_table.toLowerCase()))
      add("MISSING_TABLE", `relationships.${i}`, "Both relationship tables must exist")
    r.relationship_columns.forEach((c, j) => {
      if (c.type === "range" ? !c.right_range : !c.right_column)
        add(
          "MISSING_COLUMN",
          `relationships.${i}.relationship_columns.${j}`,
          "Relationship requires a right column or range",
        )
    })
    if (r.relationship_columns.filter((c) => c.type === "asof").length > 1)
      add("INVALID_ASOF", `relationships.${i}`, "A relationship can have only one ASOF column")
  })
  fields(model).forEach((f) => {
    expression(f.field.expr)
    f.field.using_relationships.forEach((r) => {
      if (!model.relationships.some((x) => x.name === r))
        add("MISSING_RELATIONSHIP", f.key, `Unknown USING relationship: ${r}`)
    })
    f.field.non_additive_dimensions.forEach((d) => {
      const key = d.table
        ? `${d.table}.${d.dimension}`
        : d.dimension.includes(".")
          ? d.dimension
          : `${f.table}.${d.dimension}`
      if (!fields(model).some((x) => ["dimensions", "time_dimensions"].includes(x.kind) && x.key === key))
        add("MISSING_DIMENSION", f.key, `Unknown non-additive dimension: ${key}`)
    })
    references(f.field.expr)
      .refs.filter((r) => !r.call && r.parts.length === 2)
      .forEach((r) => {
        if (!aliases.has(r.parts[0].toLowerCase()))
          add("MISSING_TABLE", f.key, `Unknown expression alias: ${r.parts[0]}`)
      })
  })
  // Check cycles between named metrics. Physical columns of the same name are resolved by the engine.
  const metrics = fields(model).filter((f) => f.kind === "metrics")
  const visit = (key: string, trail: string[]) => {
    if (trail.includes(key)) {
      add("CYCLIC_METRIC", key, [...trail, key].join(" -> "))
      return
    }
    const item = metrics.find((m) => m.key === key)
    if (!item) return
    references(item.field.expr)
      .refs.filter((r) => !r.call)
      .forEach((r) => {
        const key = r.parts.join(".")
        const target = metrics.find((m) => m.key === key || (r.parts.length === 1 && m.key === `${item.table}.${key}`))
        if (target && !(target.key === item.key && r.aggregate)) visit(target.key, [...trail, item.key])
      })
  }
  metrics.forEach((m) => visit(m.key, []))
  return issues
}

export function yaml(model: Model) {
  return Bun.YAML.stringify(model, null, 2)
}
export function modelSchema() {
  return z.toJSONSchema(ModelSchema)
}
