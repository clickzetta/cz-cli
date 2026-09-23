import { materializeFilters } from "./filters.js"
import { fields, type Model } from "./model.js"
import { SemanticViewError } from "./error.js"
import { identifier, qualified, expression } from "./sql.js"
import { requireReadonlyQuery, type SemanticService } from "./service.js"
import type { Completion } from "./provider.js"
import { object } from "./metadata.js"
import queryingGuide from "../../../../skills/semantic-view/reference/querying_existing_views.md" with { type: "text" }

export function buildQuery(
  model: Model,
  fqn: string,
  options: {
    dimensions?: string[]
    metrics?: string[]
    facts?: string[]
    filters?: string[]
    where?: string
    limit?: number
  },
) {
  const all = fields(model)
  const resolve = (key: string, kinds: string[]) => {
    const matches = all.filter((f) => (f.key === key || f.field.name === key) && kinds.includes(f.kind))
    if (matches.length !== 1)
      throw new SemanticViewError(
        "UNKNOWN_OR_AMBIGUOUS_FIELD",
        `Select a unique ${kinds.join("/")} using its table-qualified name: ${key}`,
      )
    if (matches[0].field.access_modifier === "private_access")
      throw new SemanticViewError("PRIVATE_FIELD", `Cannot query private field ${key} directly`)
    return matches[0]
  }
  const dimensions = (options.dimensions ?? []).map((k) => resolve(k, ["dimensions", "time_dimensions"]))
  const metrics = (options.metrics ?? []).map((k) => resolve(k, ["metrics"]))
  const facts = (options.facts ?? []).map((k) => resolve(k, ["facts"]))
  if (!dimensions.length && !metrics.length && !facts.length)
    throw new SemanticViewError("FIELDS_REQUIRED", "Select dimensions, facts or metrics")
  if (metrics.length && facts.length)
    throw new SemanticViewError("INCOMPATIBLE_FIELDS", "Query either facts or aggregate metrics, not both")
  if (facts.length && new Set([...facts, ...dimensions].map((field) => field.table)).size > 1)
    throw new SemanticViewError(
      "INCOMPATIBLE_FACT_GRAIN",
      "FACTS and DIMENSIONS must come from the same logical table; use an exposed same-table key or a suitable named metric instead of mixing entity grains",
    )
  const prepared = materializeFilters(model)
  const predicates = (options.filters ?? []).map((k) => `(${prepared.predicates.get(resolve(k, ["filters"]).key)})`)
  if (options.where) predicates.push(`(${expression(options.where)})`)
  const parts = [qualified(fqn)]
  if (dimensions.length)
    parts.push(
      `DIMENSIONS ${dimensions.map((d) => [...(d.table ? [d.table] : []), d.field.name].map(identifier).join(".")).join(",")}`,
    )
  if (facts.length)
    parts.push(
      `FACTS ${facts.map((d) => [...(d.table ? [d.table] : []), d.field.name].map(identifier).join(".")).join(",")}`,
    )
  if (metrics.length)
    parts.push(
      `METRICS ${metrics.map((d) => [...(d.table ? [d.table] : []), d.field.name].map(identifier).join(".")).join(",")}`,
    )
  if (predicates.length) parts.push(`WHERE ${predicates.join(" AND ")}`)
  const limit = options.limit ?? 100
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new SemanticViewError("INVALID_LIMIT", "Limit must be a nonnegative integer")
  return `SELECT * FROM SEMANTIC_VIEW(${parts.join(" ")})${limit ? ` LIMIT ${limit}` : ""}`
}

export async function generateQuery(
  complete: Completion,
  service: SemanticService,
  model: Model,
  fqn: string,
  question: string,
) {
  const attempts: { sql?: string; error: string }[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = object(
      await complete(
        `Generate a single readonly ClickZetta SELECT grounded in this model. Return {sql:string,explanation:string}. Canonical form: SELECT * FROM SEMANTIC_VIEW(fqn DIMENSIONS alias.field METRICS alias.metric WHERE alias.filter_column = value), with no comma after the view name or before clauses. Outer SELECT references returned column names, never internal logical aliases; disambiguate duplicate names inside separate subqueries rather than guessing display suffixes. Respect PRIVATE, prepared named filter predicates, required window dimensions, declared business instructions and VQR examples. Do not invent fields. Repair previous EXPLAIN errors if supplied. SQL generation does not execute the data query. The following shared workflow supplies query decision rules; do not execute its CLI examples.\n${queryingGuide}`,
        { model, fqn, question, filter_predicates: Object.fromEntries(materializeFilters(model).predicates), attempts },
      ),
    )
    if (typeof result.sql !== "string") throw new SemanticViewError("INVALID_LLM_RESPONSE", "Expected SQL string")
    // Reject non-readonly output immediately; retry only a readonly query's compilation error.
    requireReadonlyQuery(result.sql)
    try {
      const validated = await service.execute(`EXPLAIN ${result.sql}`)
      return {
        ...result,
        sql: result.sql,
        validation_job_id: validated.job_id,
        executed: false,
        attempts: attempts.length + 1,
      }
    } catch (e) {
      attempts.push({ sql: result.sql, error: e instanceof Error ? e.message : String(e) })
    }
  }
  throw new SemanticViewError(
    "QUERY_GENERATION_FAILED",
    "Generated query did not compile after three attempts",
    attempts,
  )
}

export async function transformQuery(
  complete: Completion,
  service: SemanticService,
  model: Model,
  sql: string,
  direction: "expand" | "truncate",
  compare = false,
  fqn?: string,
) {
  requireReadonlyQuery(sql)
  const candidate = object(
    await complete(
      `Transform this readonly query: ${direction === "expand" ? "expand semantic references into explicit physical SQL joins and expressions" : "rewrite physical SQL using the supplied semantic model where provably expressible"}. Return {sql:string,explanation:string,assumptions:string[]}. Preserve grouping grain, NULL behavior, temporal joins, predicates and aggregation. Native syntax: SELECT * FROM SEMANTIC_VIEW(fqn DIMENSIONS alias.field METRICS alias.metric). Outer SELECT uses unqualified output names, not logical aliases. Use the supplied target FQN when available; do not invent a deployed target. If equivalence is uncertain, state the uncertainty in assumptions. Never execute anything.`,
      { model, sql, fqn },
    ),
  )
  if (typeof candidate.sql !== "string") throw new SemanticViewError("INVALID_LLM_RESPONSE", "Expected transformed SQL")
  requireReadonlyQuery(candidate.sql)
  const original = await service.execute(`EXPLAIN ${sql}`)
  const transformed = await service.execute(`EXPLAIN ${candidate.sql}`)
  const comparison = compare ? await compareQueries(service, sql, candidate.sql) : undefined
  return {
    ...candidate,
    compiled: true,
    equivalence_verified: comparison?.equivalent ?? false,
    comparison,
    validation_job_ids: [original.job_id, transformed.job_id],
  }
}

export async function transformQueries(
  complete: Completion,
  service: SemanticService,
  model: Model,
  sqls: string[],
  direction: "expand" | "truncate",
  compare = false,
  fqn?: string,
) {
  // Reject a write anywhere in the batch before spending model or query resources.
  sqls.forEach(requireReadonlyQuery)
  const results = []
  for (const [index, sql] of sqls.entries()) {
    try {
      results.push({
        ...(await transformQuery(complete, service, model, sql, direction, compare, fqn)),
        index,
        input_sql: sql,
        success: true,
      })
    } catch (error) {
      results.push({
        index,
        input_sql: sql,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { success: results.every((result) => result.success), results }
}

/** Compare complete bounded results, never claim equivalence from a truncated sample. */
export async function compareQueries(service: SemanticService, left: string, right: string, maxRows = 10000) {
  requireReadonlyQuery(left)
  requireReadonlyQuery(right)
  const results = await Promise.all(
    [left, right].map((sql) =>
      service.execute(`SELECT * FROM (${sql.trim().replace(/;$/, "")}) AS cz_sv_comparison LIMIT ${maxRows + 1}`),
    ),
  )
  if (results.some((r) => r.rows.length > maxRows))
    throw new SemanticViewError(
      "EVALUATION_TOO_LARGE",
      `Result exceeds ${maxRows} rows; exact comparison was not performed`,
    )
  const canonical = (rows: unknown[][]) => rows.map((row) => JSON.stringify(row)).sort()
  return {
    equivalent:
      results[0].columns.length === results[1].columns.length &&
      JSON.stringify(canonical(results[0].rows)) === JSON.stringify(canonical(results[1].rows)),
    row_counts: results.map((r) => r.rows.length),
    job_ids: results.map((r) => r.job_id),
    comparison:
      "Exact row multiset; column positions matter, row ordering is excluded; no sampling or approximate numeric coercion",
  }
}
