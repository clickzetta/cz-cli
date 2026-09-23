import { z } from "zod"
import { ModelSchema, parseModel, fields, type Model } from "./model.js"
import { SemanticViewError } from "./error.js"
import { identifier, references, rewriteReferences } from "./sql.js"

export const operationNames = [
  "add_table",
  "rename_table",
  "remove_table",
  "add_dimension",
  "add_fact",
  "add_metric",
  "add_filter",
  "rename_column",
  "remove_column",
  "remove_metric",
  "remove_dimension",
  "remove_fact",
  "remove_filter",
  "update_column_expression",
  "update_model_description",
  "update_table_description",
  "update_column_description",
  "update_column_synonyms",
  "update_column_sample_values",
  "set_primary_key",
  "add_unique_key",
  "add_relationship",
  "rename_relationship",
  "remove_relationship",
  "delete_relationship",
  "update_custom_instructions",
  "add_vqr",
  "remove_vqr",
  "remove_vqrs",
] as const
const Operations = z.array(
  z.object({ operation: z.enum(operationNames), params: z.record(z.string(), z.unknown()) }).strict(),
)
export type Operation = z.infer<typeof Operations>[number]

export function editModel(input: Model, operations: unknown) {
  const model = structuredClone(input)
  Operations.parse(operations).forEach((op) => apply(model, op))
  return parseModel(model)
}

function str(p: Record<string, unknown>, key: string) {
  if (typeof p[key] !== "string" || !p[key])
    throw new SemanticViewError("INVALID_OPERATION", `Missing string parameter: ${key}`)
  return p[key] as string
}
function list(p: Record<string, unknown>, key: string) {
  return z.array(z.string()).parse(p[key])
}
function table(model: Model, name: string) {
  const t = model.tables.find((t) => t.name === name)
  if (!t) throw new SemanticViewError("NOT_FOUND", `Unknown logical table: ${name}`)
  return t
}
function field(model: Model, owner: string, name: string) {
  const item = fields(model).find((f) => f.table === owner && f.field.name === name)
  if (!item) throw new SemanticViewError("NOT_FOUND", `Unknown field: ${owner}.${name}`)
  return item
}
function rewrite(model: Model, change: (parts: string[], owner: string) => string[] | undefined) {
  fields(model).forEach((f) => {
    f.field.expr = rewriteReferences(f.field.expr, (p, call) =>
      call ? undefined : change(p, f.table)?.map(identifier).join("."),
    )
  })
  model.verified_queries.forEach((q) => {
    q.sql = rewriteReferences(q.sql, (p, call) => (call ? undefined : change(p, "")?.map(identifier).join(".")))
  })
}

function aggregated(p: Record<string, unknown>) {
  const expr = str(p, p.expr === undefined ? "expression" : "expr")
  if (p.default_aggregation === undefined) return expr
  const aggregate = z
    .enum(["sum", "avg", "min", "max", "count", "count_distinct", "median"])
    .parse(String(p.default_aggregation).toLowerCase())
  return aggregate === "count_distinct" ? `COUNT(DISTINCT ${expr})` : `${aggregate.toUpperCase()}(${expr})`
}

function apply(model: Model, op: Operation) {
  const p = op.params
  const owner = typeof p.table === "string" ? p.table : ""
  if (op.operation === "add_table") {
    model.tables.push(
      ModelSchema.shape.tables.element.parse({
        name: str(p, "name"),
        base_table: p.base_table,
        description: p.description,
      }),
    )
    return
  }
  if (op.operation === "rename_table") {
    const old = str(p, "old_table_name"),
      next = str(p, "new_table_name")
    table(model, old).name = next
    model.relationships.forEach((r) => {
      if (r.left_table === old) r.left_table = next
      if (r.right_table === old) r.right_table = next
    })
    fields(model).forEach((f) =>
      f.field.non_additive_dimensions.forEach((d) => {
        if (d.table === old) d.table = next
        if (d.dimension.startsWith(old + ".")) d.dimension = next + d.dimension.slice(old.length)
      }),
    )
    rewrite(model, (parts) => (parts.length > 1 && parts[0] === old ? [next, ...parts.slice(1)] : undefined))
    return
  }
  if (op.operation === "remove_table") {
    const name = str(p, "table_name")
    table(model, name)
    if (
      model.relationships.some((r) => [r.left_table, r.right_table].includes(name)) ||
      fields(model).some((f) => f.table !== name && references(f.field.expr).refs.some((r) => r.parts[0] === name)) ||
      model.verified_queries.some((q) => references(q.sql).refs.some((r) => r.parts[0] === name))
    )
      throw new SemanticViewError(
        "DEPENDENTS_EXIST",
        "Remove table relationships, dependent expressions and queries explicitly first",
      )
    model.tables = model.tables.filter((t) => t.name !== name)
    return
  }
  if (["add_dimension", "add_fact", "add_metric", "add_filter"].includes(op.operation)) {
    const kind = (
      { add_dimension: "dimensions", add_fact: "facts", add_metric: "metrics", add_filter: "filters" } as const
    )[op.operation as "add_dimension" | "add_fact" | "add_metric" | "add_filter"]
    if (!owner && kind !== "metrics")
      throw new SemanticViewError("INVALID_OPERATION", "This field must belong to a table")
    const value = ModelSchema.shape.metrics.unwrap().element.parse({
      name: str(p, "name"),
      expr: aggregated(p),
      description: p.description,
      data_type: p.data_type,
      synonyms: p.synonyms,
      using_relationships: p.using_relationships,
      non_additive_dimensions: p.non_additive_dimensions,
      access_modifier: p.access_modifier,
      is_time: p.is_time,
      is_unique: p.is_unique,
      enum_values: p.enum_values,
      sample_values: p.sample_values,
    })
    if (!owner) {
      model.metrics.push(value)
      return
    }
    table(model, owner)[kind].push(value)
    return
  }
  if (op.operation === "rename_column") {
    const old = str(p, "old_name"),
      next = str(p, "new_name")
    const renamed = field(model, owner, old).field
    const physicalExpression = renamed.expr
    renamed.name = next
    rewrite(model, (parts, context) =>
      parts.join(".") === `${owner}.${old}`
        ? [owner, next]
        : parts.length === 1 && parts[0] === old && context === owner
          ? [next]
          : undefined,
    )
    renamed.expr = physicalExpression
    fields(model).forEach((f) =>
      f.field.non_additive_dimensions.forEach((d) => {
        if (d.table === owner && d.dimension === old) d.dimension = next
        if (d.dimension === `${owner}.${old}`) d.dimension = `${owner}.${next}`
      }),
    )
    return
  }
  if (["remove_column", "remove_metric", "remove_dimension", "remove_fact", "remove_filter"].includes(op.operation)) {
    removeField(
      model,
      owner,
      str(p, p.column === undefined ? "name" : "column"),
      p.handle_dependents === "remove",
      new Set(),
    )
    return
  }
  if (op.operation.startsWith("update_column_")) {
    const item = field(model, owner, str(p, "column")).field
    if (op.operation === "update_column_expression") item.expr = str(p, "new_expression")
    if (op.operation === "update_column_description") item.description = z.string().parse(p.description)
    if (op.operation === "update_column_synonyms") item.synonyms = list(p, "synonyms")
    if (op.operation === "update_column_sample_values") item.sample_values = z.array(z.unknown()).parse(p.sample_values)
    return
  }
  if (op.operation === "update_model_description") {
    model.description = z.string().parse(p.description)
    return
  }
  if (op.operation === "update_table_description") {
    table(model, owner).description = z.string().parse(p.description)
    return
  }
  if (op.operation === "set_primary_key") {
    table(model, owner).primary_key = { columns: list(p, "columns") }
    return
  }
  if (op.operation === "add_unique_key") {
    table(model, owner).unique_keys.push({ columns: list(p, "columns") })
    return
  }
  if (op.operation === "add_relationship") {
    const left = p.relationship_columns ? undefined : list(p, "left_columns")
    const right = p.relationship_columns ? undefined : list(p, "right_columns")
    if (left && left.length !== right?.length)
      throw new SemanticViewError("INVALID_OPERATION", "Relationship column counts must match")
    model.relationships.push(
      ModelSchema.shape.relationships.unwrap().element.parse({
        name: str(p, "name"),
        left_table: str(p, "left_table"),
        right_table: str(p, "right_table"),
        relationship_columns:
          p.relationship_columns ?? left!.map((c, i) => ({ left_column: c, right_column: right![i] })),
        join_type: p.join_type,
        relationship_type: p.relationship_type,
      }),
    )
    return
  }
  if (op.operation === "rename_relationship") {
    const old = str(p, "old_name"),
      next = str(p, "new_name")
    const rel = model.relationships.find((r) => r.name === old)
    if (!rel) throw new SemanticViewError("NOT_FOUND", `Unknown relationship: ${old}`)
    rel.name = next
    fields(model).forEach((f) => {
      f.field.using_relationships = f.field.using_relationships.map((r) => (r === old ? next : r))
    })
    return
  }
  if (["remove_relationship", "delete_relationship"].includes(op.operation)) {
    const name = str(p, "relationship_name")
    if (!model.relationships.some((r) => r.name === name))
      throw new SemanticViewError("NOT_FOUND", `Unknown relationship: ${name}`)
    const dependents = fields(model).filter((f) => f.field.using_relationships.includes(name))
    if (dependents.length && p.handle_dependents !== "remove")
      throw new SemanticViewError(
        "DEPENDENTS_EXIST",
        "Metrics select this relationship",
        dependents.map((f) => f.key),
      )
    dependents.forEach((f) => {
      if (fields(model).some((x) => x.key === f.key)) removeField(model, f.table, f.field.name, true, new Set())
    })
    model.relationships = model.relationships.filter((r) => r.name !== name)
    return
  }
  if (op.operation === "update_custom_instructions") {
    if (p.sql_generation === undefined && p.question_categorization === undefined)
      throw new SemanticViewError("INVALID_OPERATION", "At least one instruction module is required")
    model.module_custom_instructions = {
      ...(typeof model.module_custom_instructions === "object" ? model.module_custom_instructions : {}),
      ...p,
    }
    return
  }
  if (op.operation === "add_vqr") {
    model.verified_queries.push(ModelSchema.shape.verified_queries.unwrap().element.parse(p.verified_query ?? p))
    return
  }
  const names = op.operation === "remove_vqrs" ? list(p, "names") : [str(p, "name")]
  if (names.some((n) => !model.verified_queries.some((q) => q.name === n)))
    throw new SemanticViewError("NOT_FOUND", "One or more verified queries do not exist")
  model.verified_queries = model.verified_queries.filter((q) => !names.includes(q.name))
}

function removeField(model: Model, owner: string, name: string, cascade: boolean, seen: Set<string>) {
  const item = field(model, owner, name)
  if (seen.has(item.key)) return
  seen.add(item.key)
  const depends = (sql: string, table: string) =>
    references(sql).refs.some(
      (r) =>
        !r.call && (r.parts.join(".") === item.key || (r.parts.length === 1 && r.parts[0] === name && table === owner)),
    )
  const dependents = fields(model).filter(
    (f) =>
      f.key !== item.key &&
      (depends(f.field.expr, f.table) ||
        f.field.non_additive_dimensions.some(
          (d) => d.dimension === item.key || (d.dimension === name && (d.table ?? f.table) === owner),
        )),
  )
  const queries = model.verified_queries.filter((q) => depends(q.sql, owner))
  if ((dependents.length || queries.length) && !cascade)
    throw new SemanticViewError("DEPENDENTS_EXIST", `Field ${item.key} has dependents`, {
      fields: dependents.map((f) => f.key),
      queries: queries.map((q) => q.name),
    })
  dependents.forEach((f) => {
    if (fields(model).some((x) => x.key === f.key)) removeField(model, f.table, f.field.name, cascade, seen)
  })
  model.verified_queries = model.verified_queries.filter((q) => !queries.includes(q))
  if (!owner) {
    model.metrics = model.metrics.filter((f) => f.name !== name)
    return
  }
  const t = table(model, owner)
  t[item.kind] = t[item.kind].filter((f) => f.name !== name)
}
