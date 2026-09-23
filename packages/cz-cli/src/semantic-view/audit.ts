import { fields, type Model, type Issue } from "./model.js"
import { deploymentIssues } from "./compile.js"
import { normalizeExpression, identifier } from "./sql.js"
import type { SemanticService } from "./service.js"

export function auditModel(model: Model) {
  const findings: Issue[] = [...deploymentIssues(model)]
  const warn = (code: string, path: string, message: string) =>
    findings.push({ code, path, message, severity: "warning" })
  if (!model.description?.trim())
    warn("MISSING_DESCRIPTION", "model", "Add a description that explains the model's business scope")
  model.tables.forEach((t) => {
    if (!t.description?.trim()) warn("MISSING_DESCRIPTION", t.name, "Describe the table grain and business meaning")
    if (!t.primary_key && !t.unique_keys.length)
      warn("MISSING_KEY", t.name, "No primary or unique key is declared; do not infer uniqueness from a name")
    if (model.tables.length > 1 && !model.relationships.some((r) => [r.left_table, r.right_table].includes(t.name)))
      warn("DISCONNECTED_TABLE", t.name, "No relationship connects this logical table")
  })
  const expressions = new Map<string, string>()
  const synonyms = new Map<string, string>()
  fields(model).forEach((f) => {
    if (!f.field.description?.trim())
      warn("MISSING_DESCRIPTION", f.key, "Describe the expression's intended business meaning")
    const key = `${f.kind}:${normalizeExpression(f.field.expr, f.table)}`
    if (expressions.has(key)) warn("DUPLICATE_EXPRESSION", f.key, `Same expression as ${expressions.get(key)}`)
    expressions.set(key, f.key)
    f.field.synonyms.forEach((s) => {
      if (synonyms.has(s.toLowerCase()) && synonyms.get(s.toLowerCase()) !== f.key)
        warn("AMBIGUOUS_SYNONYM", f.key, `Synonym '${s}' also belongs to ${synonyms.get(s.toLowerCase())}`)
      synonyms.set(s.toLowerCase(), f.key)
    })
    if (
      f.kind === "metrics" &&
      !f.field.non_additive_dimensions.length &&
      /balance|inventory|headcount/i.test(f.key + " " + (f.field.description ?? ""))
    )
      warn("SNAPSHOT_GRAIN_REVIEW", f.key, "Check whether this snapshot metric may be aggregated across time")
  })
  const described = [
    ...model.tables.map((t) => t.description),
    ...fields(model)
      .filter((f) => f.kind !== "filters")
      .map((f) => f.field.description),
  ].filter((v): v is string => Boolean(v?.trim()))
  const average = described.length ? described.reduce((n, v) => n + v.length, 0) / described.length : 0
  const components = {
    keys: model.tables.some((t) => t.primary_key || t.unique_keys.length) ? 1 : 0,
    relationships: model.tables.length > 1 ? (model.relationships.length ? 1 : 0) : null,
    metrics: fields(model).some((f) => f.kind === "metrics") ? 1 : 0,
    verified_queries: 2 * (1 - Math.exp((-Math.log(10) / 10) * model.verified_queries.length)),
    descriptions: 1 - Math.exp((-Math.log(100) / 100) * average),
  }
  const maximum = model.tables.length > 1 ? 6 : 5
  const total = Object.values(components).reduce<number>((sum, n) => sum + (n ?? 0), 0)
  return {
    findings,
    score: Math.round((total / maximum) * 10000) / 100,
    components,
    maximum,
    total,
    scoring:
      "Keys 1 + relationships 1 (multi-table only) + metrics 1 + VQR saturation 2 + description depth 1; corrected denominator 6/5. Coverage score, not business correctness certification.",
  }
}

export async function auditData(service: SemanticService, model: Model) {
  const findings = []
  for (const t of model.tables) {
    const source = [
      t.base_table.workspace ?? t.base_table.database ?? service.binding.workspace,
      t.base_table.schema,
      t.base_table.table,
    ]
      .map(identifier)
      .join(".")
    for (const key of [...(t.primary_key ? [t.primary_key] : []), ...t.unique_keys]) {
      const duplicate = await service.execute(
        `SELECT COUNT(*) FROM (SELECT ${key.columns.map(identifier).join(",")} FROM ${source} GROUP BY ${key.columns.map(identifier).join(",")} HAVING COUNT(*) > 1) AS duplicate_keys`,
      )
      const nulls = await service.execute(
        `SELECT COUNT(*) FROM ${source} WHERE ${key.columns.map((c) => `${identifier(c)} IS NULL`).join(" OR ")}`,
      )
      findings.push({
        table: t.name,
        columns: key.columns,
        duplicate_groups: duplicate.rows[0]?.[0],
        null_key_rows: nulls.rows[0]?.[0],
        job_ids: [duplicate.job_id, nulls.job_id],
      })
    }
  }
  return {
    key_checks: findings,
    scope:
      "Full-table key checks; runtime/cost depends on source size. Declared keys are not validated by native SV creation.",
  }
}
