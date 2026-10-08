import { z } from "zod"
import { SemanticViewError } from "./error.js"
import { fields, type Model } from "./model.js"
import { object } from "./metadata.js"

const text = z.string().trim().min(1)
const knowledgeSchema = z.object({
  sources: z.array(z.object({ id: text, locator: text }).strict()),
  requirements: z.array(z.object({
    id: text,
    statement: text,
    source_ids: z.array(text).min(1),
    state: z.enum(["confirmed", "proposed", "conflict"]),
  }).strict()),
  key_evidence: z.array(z.object({
    source_id: text,
    base_table: z.object({ database: text, schema: text, table: text }).strict(),
    columns: z.array(text).min(1),
    kind: z.enum(["primary", "unique"]),
  }).strict()).optional(),
}).strict()

export function readKnowledge(request: unknown) {
  const input = object(request)
  const proto = object(input.json_proto ?? input)
  if (input.json_proto !== undefined && input.knowledge !== undefined)
    throw new SemanticViewError("INVALID_KNOWLEDGE", "Place knowledge inside json_proto so source grounding preserves it")
  if (proto.knowledge === undefined) return undefined
  const parsed = knowledgeSchema.safeParse(proto.knowledge)
  if (!parsed.success)
    throw new SemanticViewError("INVALID_KNOWLEDGE", "Invalid knowledge sources or requirements", parsed.error.issues)
  const knowledge = parsed.data
  for (const values of [knowledge.sources, knowledge.requirements]) {
    if (new Set(values.map((value) => value.id)).size !== values.length)
      throw new SemanticViewError("INVALID_KNOWLEDGE", "Knowledge IDs must be unique within sources and requirements")
  }
  const sources = new Set(knowledge.sources.map((source) => source.id))
  if (knowledge.requirements.some((item) => item.source_ids.some((id) => !sources.has(id))))
    throw new SemanticViewError("INVALID_KNOWLEDGE", "Requirement references an unknown source ID")
  if (knowledge.key_evidence?.some((item) => !sources.has(item.source_id)))
    throw new SemanticViewError("INVALID_KNOWLEDGE", "Key evidence references an unknown source ID")
  return knowledge
}

export function checkKeyEvidence(model: Model, knowledge: ReturnType<typeof readKnowledge>) {
  if (!knowledge) return
  for (const table of model.tables) {
    const keys = [
      ...(table.primary_key ? [{ ...table.primary_key, kind: "primary" }] : []),
      ...table.unique_keys.map((key) => ({ ...key, kind: "unique" })),
    ]
    for (const key of keys) {
      const supported = knowledge.key_evidence?.some((evidence) =>
        evidence.kind === key.kind &&
        evidence.base_table.database === table.base_table.database &&
        evidence.base_table.schema === table.base_table.schema &&
        evidence.base_table.table === table.base_table.table &&
        evidence.columns.length === key.columns.length &&
        evidence.columns.every((column) => key.columns.includes(column)),
      )
      if (!supported)
        throw new SemanticViewError("UNVERIFIED_KEYS", "Generated keys require matching knowledge.key_evidence; omit inferred keys or supply observed key evidence", { table: table.name, kind: key.kind, columns: key.columns })
    }
  }
}

export function checkCoverage(model: Model, knowledge: ReturnType<typeof readKnowledge>, input: unknown) {
  // Keep the historical free-form contract for callers that have not opted into structured knowledge.
  if (!knowledge) return input ?? []
  const parsed = z.array(z.object({
    requirement_id: text,
    requirement: text.optional(),
    fields: z.array(text).default([]),
    status: z.enum(["covered", "unresolved"]),
    reason: text.optional(),
  }).strict()).safeParse(input)
  if (!parsed.success)
    throw new SemanticViewError("INVALID_COVERAGE", "Structured knowledge requires coverage for every requirement", parsed.error.issues)
  const coverage = parsed.data
  const keys = new Set(fields(model).map((field) => field.key))
  const ids = new Set(knowledge.requirements.map((item) => item.id))
  if (coverage.length !== ids.size || new Set(coverage.map((item) => item.requirement_id)).size !== ids.size || coverage.some((item) => !ids.has(item.requirement_id)))
    throw new SemanticViewError("INVALID_COVERAGE", "Each knowledge requirement must appear exactly once in coverage")
  for (const item of coverage) {
    const requirement = knowledge.requirements.find((value) => value.id === item.requirement_id)!
    if (item.fields.some((key) => !keys.has(key)))
      throw new SemanticViewError("INVALID_COVERAGE", `Unknown logical field in ${item.requirement_id}`, { supplied: item.fields, available: [...keys] })
    if (item.status === "covered" && (requirement.state !== "confirmed" || !item.fields.length))
      throw new SemanticViewError("INVALID_COVERAGE", `Covered requirement ${item.requirement_id} needs confirmed evidence and actual model fields`)
    if (item.status === "unresolved" && !item.reason)
      throw new SemanticViewError("INVALID_COVERAGE", `Unresolved requirement ${item.requirement_id} needs a reason`)
  }
  return coverage
}
