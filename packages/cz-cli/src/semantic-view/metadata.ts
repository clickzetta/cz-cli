import { createHash } from "node:crypto"
import { SemanticViewError } from "./error.js"
import { parseModel, fields, type Model } from "./model.js"
import { normalizeExpression, nameParts, arithmeticShape, rewriteReferences, sqlKeyword } from "./sql.js"

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SemanticViewError("INVALID_RESPONSE", "Expected metadata object")
  return value as Record<string, unknown>
}
function array(value: unknown) {
  return Array.isArray(value) ? value : []
}
function text(value: unknown) {
  return typeof value === "string" ? value : ""
}
function named(value: unknown) {
  const item = object(value)
  return [...array(item.namespace).map(String), text(item.name)].filter(Boolean).join(".")
}

export function decodeMetadata(name: string, rows: unknown[][]) {
  const entries = Object.fromEntries(rows.filter((r) => typeof r[0] === "string").map((r) => [String(r[0]), r[1]]))
  if (typeof entries.def !== "string")
    throw new SemanticViewError(
      "INCOMPLETE_METADATA",
      "JSON DESC did not return a semantic definition; the server may not support cz.sql.desc.format=json",
    )
  const raw = object(JSON.parse(entries.def))
  const source: Record<string, unknown> = {
    name,
    description: text(entries.comment),
    tables: [],
    relationships: [],
    metrics: [],
    verified_queries: [],
    properties: {},
  }
  const tables = array(raw.logicalTables).map((value) => {
    const t = object(value)
    const ref = object(t.tableIdentifier)
    const constraints = array(t.constraints).map(object)
    return {
      name: text(t.alias),
      base_table: {
        database: String(array(ref.namespace)[0]),
        schema: String(array(ref.namespace)[1]),
        table: text(ref.name),
      },
      description: text(t.comment),
      synonyms: array(t.synonyms),
      primary_key: constraints.find((c) => c.primaryKey)
        ? {
            columns: array(object(constraints.find((c) => c.primaryKey)!.primaryKey).fields).map((f) =>
              text(object(f).fieldName),
            ),
          }
        : undefined,
      unique_keys: constraints
        .filter((c) => c.uniqueKey)
        .map((c) => ({ columns: array(object(c.uniqueKey).uniqueFields).map((f) => text(object(f).fieldName)) })),
      constraints: constraints
        .filter((c) => c.index)
        .map((c) => ({
          kind: "index",
          name: text(c.name),
          type: text(object(c.index).type),
          columns: array(object(object(c.index).key).fields).map((f) => text(object(f).fieldName)),
        })),
      dimensions: [] as Record<string, unknown>[],
      facts: [] as Record<string, unknown>[],
      metrics: [] as Record<string, unknown>[],
      filters: [] as Record<string, unknown>[],
    }
  })
  source.tables = tables
  const unknown = Object.keys(raw).filter(
    (k) =>
      ![
        "logicalTables",
        "facts",
        "dimensions",
        "metrics",
        "filters",
        "variables",
        "relationships",
        "verifiedQueries",
      ].includes(k),
  )
  if (array(raw.variables).length) unknown.push("variables")
  const inspect = (value: Record<string, unknown>, allowed: string[], path: string) =>
    Object.keys(value)
      .filter((k) => !allowed.includes(k))
      .forEach((k) => unknown.push(`${path}.${k}`))
  array(raw.logicalTables)
    .map(object)
    .forEach((t, i) => {
      inspect(t, ["tableIdentifier", "alias", "constraints", "synonyms", "comment"], `logicalTables.${i}`)
      array(t.constraints)
        .map(object)
        .forEach((c, j) => {
          inspect(
            c,
            ["name", "primaryKey", "uniqueKey", "index", "specId", "properties"],
            `logicalTables.${i}.constraints.${j}`,
          )
          if (array(c.properties).length) unknown.push(`logicalTables.${i}.constraints.${j}.properties`)
          const key = c.primaryKey ?? c.uniqueKey
          // Bare UNIQUE is DISABLE NOVALIDATE RELY; bare PRIMARY KEY enables all three.
          const defaults: Record<string, boolean> = c.primaryKey
            ? { enable: true, validate: true, rely: true }
            : { enable: false, validate: false, rely: true }
          if (
            key &&
            Object.entries(defaults).some(([k, value]) => object(key)[k] !== undefined && object(key)[k] !== value)
          )
            unknown.push(`logicalTables.${i}.constraints.${j}.key_flags`)
          if (!c.primaryKey && !c.uniqueKey && !c.index) unknown.push(`logicalTables.${i}.constraints.${j}`)
        })
    })
  for (const kind of ["dimensions", "facts", "metrics", "filters"] as const)
    array(raw[kind])
      .map(object)
      .forEach((f, i) => {
        inspect(
          f,
          [
            "name",
            "expressionText",
            "expressionExpandedText",
            "synonyms",
            "comment",
            "trait",
            "accessModifier",
            "privateAccess",
            "isPrivate",
            "usingRelationships",
            "nonAdditiveBy",
          ],
          `${kind}.${i}`,
        )
        if (f.trait) inspect(object(f.trait), ["isTime", "isUnique", "enumValues"], `${kind}.${i}.trait`)
      })
  array(raw.relationships)
    .map(object)
    .forEach((r, i) => {
      inspect(
        r,
        ["name", "leftTable", "rightTable", "leftColumns", "rightColumns", "kind", "asofColumnIndex"],
        `relationships.${i}`,
      )
      if (r.kind && !["EQUI", "ASOF", "EQUAL"].includes(String(r.kind)))
        unknown.push(`relationships.${i}.kind:${r.kind}`)
    })
  array(raw.verifiedQueries)
    .map(object)
    .forEach((q, i) =>
      inspect(q, ["name", "question", "sql", "verifiedAt", "verifiedBy", "onboardingQuestion"], `verifiedQueries.${i}`),
    )
  for (const kind of ["dimensions", "facts", "metrics", "filters"] as const) {
    array(raw[kind]).forEach((value) => {
      const f = object(value)
      const ref = object(f.name)
      const owner = array(ref.namespace).map(String).join(".")
      const trait = f.trait ? object(f.trait) : {}
      const field = {
        name: text(ref.name),
        expr: text(f.expressionText) || text(f.expressionExpandedText),
        description: text(f.comment),
        synonyms: array(f.synonyms),
        ...(typeof trait.isTime === "boolean" ? { is_time: trait.isTime } : {}),
        ...(typeof trait.isUnique === "boolean" ? { is_unique: trait.isUnique } : {}),
        ...(array(trait.enumValues).length
          ? {
              enum_values: array(trait.enumValues).map(enumValue),
              ...(array(trait.enumValues).every((v) => object(v).date !== undefined) ? { data_type: "DATE" } : {}),
            }
          : {}),
        ...(f.accessModifier === "PRIVATE" || f.privateAccess === true || f.isPrivate === true
          ? { access_modifier: "private_access" }
          : {}),
        using_relationships: array(f.usingRelationships),
        non_additive_dimensions: array(f.nonAdditiveBy).map((value) => {
          const d = object(value)
          return {
            table:
              nameParts(text(d.dimension)).length > 1 ? nameParts(text(d.dimension)).slice(0, -1).join(".") : undefined,
            dimension: nameParts(text(d.dimension)).at(-1)!,
            sort_direction: d.descending ? "descending" : "ascending",
            null_order: d.nullsFirst ? "first" : "last",
          }
        }),
      }
      const table = tables.find((t) => t.name === owner)
      if (table) {
        table[kind].push(field)
        return
      }
      if (kind === "metrics" && !owner) {
        ;(source.metrics as unknown[]).push(field)
        return
      }
      throw new SemanticViewError("INCOMPLETE_METADATA", `Cannot locate owner of ${named(f.name)}`)
    })
  }
  source.relationships = array(raw.relationships).map((value, i) => {
    const r = object(value)
    const left = array(r.leftColumns).map(String)
    const right = array(r.rightColumns).map(String)
    return {
      name: text(r.name) || `relationship_${i + 1}`,
      left_table: text(r.leftTable),
      right_table: text(r.rightTable),
      relationship_columns: left.map((col, i) => ({
        left_column: col,
        right_column: right[i],
        type: r.kind === "ASOF" && i === Number(r.asofColumnIndex ?? left.length - 1) ? "asof" : "equi",
      })),
    }
  })
  source.verified_queries = array(raw.verifiedQueries).map((value) => {
    const q = object(value)
    return {
      name: text(q.name),
      question: text(q.question),
      sql: text(q.sql),
      ...(q.verifiedAt === undefined ? {} : { verified_at: q.verifiedAt }),
      ...(q.verifiedBy === undefined ? {} : { verified_by: q.verifiedBy }),
      ...(q.onboardingQuestion === undefined ? {} : { use_as_onboarding_question: q.onboardingQuestion }),
    }
  })
  return {
    model: parseModel(source),
    raw,
    unknown,
    version: text(entries.version),
    modified_at: text(entries.last_modified_time),
    creator: text(entries.creator),
  }
}

function enumValue(value: unknown): unknown {
  const v = object(value)
  if (v.date !== undefined) return new Date(Number(v.date) * 86400000).toISOString().slice(0, 10)
  const item = Object.entries(v).find(([k]) => !["type", "isNull"].includes(k))
  if (v.isNull) return null
  if (!item) throw new SemanticViewError("UNSUPPORTED_ENUM", "Unknown enum value representation", value)
  return item[1]
}

export function semanticShape(model: Model) {
  return {
    description: model.description ?? "",
    tables: model.tables
      .map((t) => ({
        name: t.name.toLowerCase(),
        source: [t.base_table.database ?? t.base_table.workspace, t.base_table.schema, t.base_table.table].map((v) =>
          v?.toLowerCase(),
        ),
        primary_key: (t.primary_key?.columns ?? []).map((c) => c.toLowerCase()),
        unique_keys: t.unique_keys.map((k) => k.columns.map((c) => c.toLowerCase())),
        constraints: t.constraints.map((c) => ({
          ...c,
          name: typeof c.name === "string" ? c.name.toLowerCase() : c.name,
          columns: Array.isArray(c.columns) ? c.columns.map((v) => String(v).toLowerCase()) : c.columns,
        })),
        description: t.description ?? "",
        synonyms: t.synonyms,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    fields: fields(model)
      .filter((f) => f.kind !== "filters")
      .map((f) => ({
        name: f.key.toLowerCase(),
        kind: f.kind === "time_dimensions" ? "dimensions" : f.kind,
        expr: normalizeExpression(f.field.expr, f.table || undefined),
        description: f.field.description ?? "",
        synonyms: f.field.synonyms,
        private: f.field.access_modifier === "private_access",
        is_time: f.field.is_time === true || f.kind === "time_dimensions",
        is_unique: f.field.is_unique === true || f.field.unique === true,
        enum_values: f.field.enum_values ?? [],
        using: f.field.using_relationships.map((r) => r.toLowerCase()),
        nonadditive: f.field.non_additive_dimensions.map((d) => ({
          dimension: (d.table
            ? `${d.table}.${d.dimension}`
            : d.dimension.includes(".")
              ? d.dimension
              : `${f.table}.${d.dimension}`
          ).toLowerCase(),
          sort_direction: d.sort_direction,
          null_order: d.null_order,
        })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    relationships: model.relationships
      .map((r) => ({
        name: r.name.toLowerCase(),
        left: r.left_table.toLowerCase(),
        right: r.right_table.toLowerCase(),
        columns: r.relationship_columns.map((c) => ({
          ...c,
          left_column: c.left_column.toLowerCase(),
          right_column: c.right_column?.toLowerCase(),
        })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    vqr: model.verified_queries
      .map((q) => ({
        name: q.name.toLowerCase(),
        question: q.question,
        sql: q.sql.trim(),
        verified_at: q.verified_at === undefined ? undefined : String(q.verified_at),
        verified_by: typeof q.verified_by === "object" ? JSON.stringify(q.verified_by) : q.verified_by,
        onboarding: q.use_as_onboarding_question,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
}

export function sameSemanticDefinition(left: Model, right: Model) {
  const shapes = [left, right].map((model) => {
    const entries = fields(model)
    const topMetrics = new Set(model.metrics.map((metric) => metric.name.toLowerCase()))
    const shape = semanticShape(model)
    return {
      ...shape,
      tables: shape.tables.map((table) => ({
        ...table,
        synonyms: table.synonyms.map((synonym) => synonym.toLowerCase()),
      })),
      fields: shape.fields.map((field) => {
        // DESC qualifies unique logical fields in top-level metrics. Do not
        // guess physical columns, ambiguous owners or shadowed metric names.
        // Stored fingerprints remain strict for conflict detection.
        const expr = topMetrics.has(field.name)
          ? normalizeExpression(
              rewriteReferences(field.expr, (parts, call) => {
                if (call || parts.length !== 1 || sqlKeyword(parts[0]) || topMetrics.has(parts[0].toLowerCase()))
                  return undefined
                const matches = entries.filter(
                  (entry) =>
                    entry.table &&
                    entry.kind !== "filters" &&
                    entry.field.name.toLowerCase() === parts[0].toLowerCase(),
                )
                return matches.length === 1 ? matches[0].key : undefined
              }),
            )
          : field.expr
        return {
          ...field,
          expr: arithmeticShape(expr) ?? expr,
          synonyms: field.synonyms.map((synonym) => synonym.toLowerCase()),
        }
      }),
    }
  })
  return fingerprint(shapes[0]) === fingerprint(shapes[1])
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    )
  return value
}
