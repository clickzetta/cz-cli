import { materializeFilters } from "./filters.js"
import { SemanticViewError } from "./error.js"
import { fields, type Model, type Field, type Issue } from "./model.js"
import { expression, identifier, literal, qualified, references, rewriteReferences, storedName } from "./sql.js"

export type Binding = { workspace: string; schema: string; target?: string }
export const MANAGED_PROPERTY = "cz.sv.authoring.v1"

export function capabilities() {
  return {
    dialect: "clickzetta-semantic-v1.8",
    verification: "integration-tested on release-v1.8/25fde96; validate against the connected deployment",
    native: [
      "dimensions",
      "scalar_facts",
      "entity_facts",
      "metrics",
      "relationships",
      "asof",
      "using_relationships",
      "private_access",
      "window_metrics",
      "non_additive_dimensions",
      "verified_queries",
    ],
    managed: [
      "filters",
      "sample_values",
      "data_type",
      "custom_instructions",
      "module_custom_instructions",
      "false_traits",
    ],
    rewrites: ["scalar_derived_metric_chains"],
    blocked: ["range_relationship", "computed_fact_relationship_key", "many_to_many", "non_left_relationship"],
    managed_contract:
      "Managed authoring fields are stored in an integrity-checked property and consumed by cz-cli; they are not engine-native features.",
  }
}

export function compile(model: Model, binding: Binding, replace = false) {
  const target = storedName(binding.target ?? `${binding.workspace}.${binding.schema}.${model.name}`)
  const fqn =
    target.length === 1
      ? [binding.workspace, binding.schema, ...target]
      : target.length === 2
        ? [binding.workspace, ...target]
        : target
  const issues = deploymentIssues(model)
  if (issues.length)
    throw new SemanticViewError(
      "UNSUPPORTED_SEMANTICS",
      "The model contains semantics this native deployment cannot preserve",
      issues,
    )
  const metrics = fields(model).filter((f) => f.kind === "metrics")
  const expand = (field: Field, table: string, trail: string[] = []): string =>
    rewriteReferences(field.expr, (parts, call, aggregate) => {
      if (call) return undefined
      const key = parts.join(".")
      const ref = metrics.find((f) => f.key === key || (parts.length === 1 && f.key === `${table}.${key}`))
      if (
        !ref ||
        (aggregate && ref.key === (table ? `${table}.${field.name}` : field.name)) ||
        !references(ref.field.expr).refs.some(
          (r) =>
            !r.call &&
            metrics.some(
              (m) =>
                (m.key === r.parts.join(".") || (r.parts.length === 1 && m.key === `${ref.table}.${r.parts[0]}`)) &&
                !(r.aggregate && m.key === ref.key),
            ),
        )
      )
        return undefined
      if (trail.includes(ref.key)) throw new SemanticViewError("CYCLIC_METRIC", trail.concat(ref.key).join(" -> "))
      if (
        ref.field.using_relationships.length ||
        ref.field.non_additive_dimensions.length ||
        /\bOVER\s*\(/i.test(ref.field.expr)
      )
        throw new SemanticViewError(
          "UNSUPPORTED_METRIC_CHAIN",
          `Cannot inline contextual metric ${ref.key}; use an explicit base-metric expression`,
        )
      return `(${expand(ref.field, ref.table, trail.concat(ref.key))})`
    })
  const native = materializeFilters(model).model
  native.tables.forEach((t) => {
    t.base_table = {
      database: t.base_table.workspace ?? t.base_table.database ?? binding.workspace,
      schema: t.base_table.schema,
      table: t.base_table.table,
    }
    t.dimensions.push(...t.time_dimensions.map((f) => ({ ...f, is_time: f.is_time ?? true })))
    t.time_dimensions = []
    t.metrics.forEach((f) => {
      f.expr = expand(f, t.name)
    })
  })
  native.metrics.forEach((f) => {
    f.expr = expand(f, "")
  })
  const definitions = native.tables.map((t) => {
    const keys = [
      t.primary_key ? `PRIMARY KEY (${t.primary_key.columns.map(identifier).join(",")})` : "",
      ...t.unique_keys.map((k) => `UNIQUE (${k.columns.map(identifier).join(",")})`),
    ]
    const indexes = t.constraints.map((c) => {
      if (
        typeof c.name !== "string" ||
        c.kind !== "index" ||
        !Array.isArray(c.columns) ||
        c.columns.some((x) => typeof x !== "string") ||
        c.type !== "BLOOM_FILTER"
      )
        throw new SemanticViewError("UNSUPPORTED_CONSTRAINT", `Cannot emit constraint on ${t.name}`, c)
      return `INDEX ${identifier(c.name)} (${(c.columns as string[]).map(identifier).join(",")}) BLOOMFILTER`
    })
    return `${identifier(t.name)} AS ${[t.base_table.database!, t.base_table.schema, t.base_table.table].map(identifier).join(".")} ${keys.filter(Boolean).join(" ")} ${indexes.join(" ")}${annotations(t)}`
  })
  const relationships = native.relationships.map(
    (r) =>
      `${identifier(r.name)} AS ${identifier(r.left_table)} (${r.relationship_columns.map((c) => identifier(c.left_column)).join(",")}) REFERENCES ${identifier(r.right_table)} (${r.relationship_columns.map((c) => `${c.type === "asof" ? "ASOF " : ""}${identifier(c.right_column!)}`).join(",")})`,
  )
  const parts = [
    `CREATE ${replace ? "OR REPLACE " : ""}SEMANTIC VIEW ${fqn.map(identifier).join(".")}`,
    `TABLES (\n${definitions.join(",\n")}\n)`,
  ]
  if (relationships.length) parts.push(`RELATIONSHIPS (\n${relationships.join(",\n")}\n)`)
  for (const kind of ["facts", "dimensions", "metrics"] as const) {
    const selected = fields(native).filter((f) => f.kind === kind)
    if (!selected.length) continue
    parts.push(
      `${kind.toUpperCase()} (\n${selected
        .map((f) => {
          const access = kind !== "dimensions" && f.field.access_modifier === "private_access" ? "PRIVATE " : ""
          const using = f.field.using_relationships.length
            ? ` USING (${f.field.using_relationships.map(identifier).join(",")})`
            : ""
          const nonadditive = f.field.non_additive_dimensions.length
            ? ` NON ADDITIVE BY (${f.field.non_additive_dimensions.map((d) => `${d.table ? [d.table, d.dimension].map(identifier).join(".") : qualified(d.dimension.includes(".") ? d.dimension : `${f.table}.${d.dimension}`)} ${d.sort_direction === "descending" ? "DESC" : "ASC"} NULLS ${d.null_order === "first" ? "FIRST" : "LAST"}`).join(",")})`
            : ""
          const traits = `${f.field.is_time === true ? " is_time = true" : ""}${f.field.is_unique === true || f.field.unique === true ? " is_unique = true" : ""}${f.field.enum_values?.length ? ` enum_values = [${f.field.enum_values.map((v) => enumLiteral(v, f.field.data_type)).join(",")}]` : ""}`
          return `${access}${f.table ? identifier(f.table) + "." : ""}${identifier(f.field.name)}${using}${nonadditive} AS ${expression(f.field.expr)}${annotations(f.field, traits)}`
        })
        .join(",\n")}\n)`,
    )
  }
  // The top-level table comment is unescaped again when persisted by the server.
  if (model.description !== undefined) parts.push(`COMMENT = ${literal(model.description.replaceAll("\\", "\\\\"))}`)
  if (model.verified_queries.length)
    parts.push(
      `AI_VERIFIED_QUERIES (\n${model.verified_queries.map((q) => `${identifier(q.name)} AS (QUESTION ${literal(q.question)}${q.verified_at === undefined ? "" : ` VERIFIED_AT ${timestamp(q.verified_at)}`}${q.use_as_onboarding_question === undefined ? "" : ` ONBOARDING_QUESTION ${q.use_as_onboarding_question ? "TRUE" : "FALSE"}`}${q.verified_by === undefined ? "" : ` VERIFIED_BY ${literal(typeof q.verified_by === "string" ? q.verified_by : JSON.stringify(q.verified_by))}`} SQL ${literal(q.sql)})`).join(",\n")}\n)`,
    )
  return { sql: parts.join("\n"), fqn: fqn.join("."), native, managed: capabilities().managed }
}

function annotations(value: { synonyms?: string[]; description?: string }, traits = "") {
  return `${value.synonyms?.length ? ` WITH SYNONYMS (${value.synonyms.map(literal).join(",")})` : ""}${traits}${value.description === undefined ? "" : ` COMMENT = ${literal(value.description)}`}`
}

function enumLiteral(value: unknown, type?: string) {
  if (value === null) return "NULL"
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "string") return `${type?.toUpperCase() === "DATE" ? "DATE " : ""}${literal(value)}`
  throw new SemanticViewError("INVALID_ENUM", "enum_values must contain SQL scalar values")
}

function timestamp(value: string | number) {
  if (!/^\d+$/.test(String(value)))
    throw new SemanticViewError("INVALID_TIMESTAMP", "verified_at must be epoch seconds")
  return String(value)
}

export function deploymentIssues(model: Model): Issue[] {
  const issues: Issue[] = []
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message, severity: "error" })
  model.relationships.forEach((r) => {
    if (r.relationship_columns.some((c) => c.type === "range"))
      add(
        "RANGE_UNSUPPORTED",
        r.name,
        "RANGE relationships are not available in the verified native dialect; no relationship will be dropped",
      )
    if (!["left", "left_outer"].includes(r.join_type))
      add("JOIN_TYPE_UNSUPPORTED", r.name, `Cannot preserve ${r.join_type} relationship semantics`)
    if (r.relationship_type === "many_to_many")
      add("CARDINALITY_UNSUPPORTED", r.name, "Many-to-many relationships require explicit grain handling")
    r.relationship_columns.forEach((c) => {
      if (model.tables.find((t) => t.name === r.left_table)?.facts.some((f) => f.name === c.left_column))
        add(
          "COMPUTED_KEY_UNSUPPORTED",
          r.name,
          "Native relationships cannot bind computed facts; materialize the key in a source view",
        )
    })
  })
  return issues
}
