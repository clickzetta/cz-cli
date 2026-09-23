import path from "node:path"
import { z } from "zod"
import { parseModel, fields, yaml, type Model } from "./model.js"
import { SemanticViewError } from "./error.js"
import { object } from "./metadata.js"
import { identifier, nameParts } from "./sql.js"

const ImportOptionsSchema = z
  .object({
    name: z.string().min(1).optional(),
    workspace: z.string().min(1).optional(),
    schema: z.string().min(1).optional(),
    mapping: z
      .record(z.string(), z.object({ database: z.string().optional(), schema: z.string(), table: z.string() }).strict())
      .optional(),
    include_tables: z.array(z.string()).optional(),
    include_columns: z.array(z.string()).optional(),
    include_measures: z.array(z.string()).optional(),
  })
  .strict()
export type ImportOptions = z.infer<typeof ImportOptionsSchema>

export function parseImportOptions(input: unknown) {
  const result = ImportOptionsSchema.safeParse(input)
  if (!result.success)
    throw new SemanticViewError(
      "INVALID_IMPORT_OPTIONS",
      "Unknown or invalid import option; no conversion was performed",
      result.error.issues,
    )
  return result.data
}
export type ImportLoss = { path: string; reason: string; source?: unknown }
function list(v: unknown): unknown[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v]
}
function str(v: unknown) {
  return typeof v === "string" ? v : ""
}

export async function analyzeImport(file: string, kind: "osi") {
  const data = await Bun.file(file).bytes()
  if (data.byteLength > 64 * 1024 * 1024) throw new SemanticViewError("IMPORT_TOO_LARGE", "Import input exceeds 64 MiB")
  return {
    kind,
    file_type: path.extname(file).slice(1),
    document: object(Bun.YAML.parse(new TextDecoder().decode(data))),
  }
}

export async function convertImport(file: string, kind: "osi", input: ImportOptions = {}) {
  const options = parseImportOptions(input)
  const source = await analyzeImport(file, kind)
  const losses: ImportLoss[] = []
  const draft: Record<string, unknown> = {
    name:
      options.name ??
      path
        .basename(file)
        .replace(/\.[^.]+$/, "")
        .replace(/\W/g, "_"),
    tables: [],
    relationships: [],
  }
  convertOsi(source.document, draft, options, losses)
  if (!list(draft.tables).length)
    throw new SemanticViewError("EMPTY_IMPORT", "No mapped tables could be imported", { losses })
  const model = parseModel(draft)
  return {
    success: losses.length === 0,
    status: losses.length ? "partial" : "converted",
    model,
    yaml_content: yaml(model),
    semantic_model_name: model.name,
    table_count: model.tables.length,
    column_count: fields(model).length,
    relationship_count: model.relationships.length,
    losses,
    source_format: source.file_type,
  }
}

function mapped(name: string, source: unknown, options: ImportOptions, losses: ImportLoss[]) {
  if (options.mapping?.[name]) return options.mapping[name]
  const value =
    typeof source === "string" && !/\s*(SELECT|WITH)\b/i.test(source)
      ? nameParts(source.replace(/\[([^\]]+)\]/g, "`$1`"))
      : []
  if (value.length >= 2)
    return {
      database: options.workspace ?? (value.length === 3 ? value[0] : undefined),
      schema: options.schema ?? value.at(-2)!,
      table: value.at(-1)!,
    }
  if (options.schema) return { database: options.workspace, schema: options.schema, table: value[0] || name }
  losses.push({ path: name, reason: "Physical table mapping required", source })
  return undefined
}
function selected(name: string, values?: string[]) {
  return !values?.length || values.includes(name)
}

function convertOsi(
  input: Record<string, unknown>,
  draft: Record<string, unknown>,
  options: ImportOptions,
  losses: ImportLoss[],
) {
  const models = list(input.semantic_model ?? input.semantic_models ?? input)
  if (models.length !== 1)
    throw new SemanticViewError("MODEL_SELECTION_REQUIRED", "Import one OSI semantic model at a time")
  const model = object(models[0])
  draft.name = options.name || str(model.name) || draft.name
  draft.description = str(model.description)
  // Retain extensions and AI context in managed metadata even when they have no native equivalent.
  draft.module_custom_instructions = {
    osi: {
      version: input.version,
      ai_context: model.ai_context,
      custom_extensions: model.custom_extensions,
      datasets: list(model.datasets)
        .map(object)
        .map((d) => ({
          name: d.name,
          ai_context: d.ai_context,
          custom_extensions: d.custom_extensions,
          fields: d.fields,
        })),
      relationships: model.relationships,
      metrics: model.metrics,
    },
  }
  const sql = (value: unknown, at: string) => {
    if (typeof value === "string") return value
    const expression = object(value ?? {})
    const dialects = list(expression.dialects).map(object)
    const selected = dialects.find((d) => ["CLICKZETTA", "ANSI_SQL"].includes(str(d.dialect).toUpperCase()))
    const result = selected ? str(selected.expression) : str(expression.sql)
    if (!result)
      losses.push({
        path: at,
        reason: "No ANSI_SQL or ClickZetta expression available; explicit dialect translation required",
        source: value,
      })
    return result
  }
  draft.tables = list(model.datasets)
    .map(object)
    .flatMap((d) => {
      const name = str(d.name)
      if (!selected(name, options.include_tables)) return []
      const base = mapped(name, d.source, options, losses)
      if (!base) return []
      const dims = list(d.fields)
        .map(object)
        .filter((f) => selected(str(f.name), options.include_columns))
        .flatMap((f) => {
          const expr = sql(f.expression, `${name}.${f.name}`)
          if (!expr) return []
          const dimension = object(f.dimension ?? {})
          const context = object(f.ai_context ?? {})
          return [
            {
              name: str(f.name),
              expr,
              description: str(f.description),
              data_type: str(f.datatype) || undefined,
              is_time:
                typeof dimension.is_time === "boolean"
                  ? dimension.is_time
                  : ["Date", "Time", "DateTime", "DateTimeTz"].includes(str(f.datatype))
                    ? true
                    : undefined,
              synonyms: list(context.synonyms).map(String),
            },
          ]
        })
      return [
        {
          name,
          base_table: base,
          description: str(d.description),
          primary_key: list(d.primary_key).length ? { columns: list(d.primary_key) } : undefined,
          unique_keys: list(d.unique_keys).map((columns) => ({ columns: list(columns) })),
          dimensions: dims,
        },
      ]
    })
  draft.metrics = list(model.metrics)
    .map(object)
    .filter((m) => selected(str(m.name), options.include_measures))
    .flatMap((m) => {
      const expr = sql(m.expression, `metrics.${m.name}`)
      return expr
        ? [
            {
              name: str(m.name),
              expr,
              description: str(m.description),
              data_type: str(m.datatype) || undefined,
              synonyms: list(object(m.ai_context ?? {}).synonyms).map(String),
            },
          ]
        : []
    })
  draft.relationships = list(model.relationships)
    .map(object)
    .flatMap((r, i) => {
      const from = typeof r.from === "string" ? r.from : str(object(r.from).dataset)
      const to = typeof r.to === "string" ? r.to : str(object(r.to).dataset)
      const left = list(r.from_columns ?? object(r.from).fields),
        right = list(r.to_columns ?? object(r.to).fields)
      if (!from || !to || left.length !== right.length || !left.length) {
        losses.push({ path: `relationships.${i}`, reason: "Relationship endpoint or key arity mismatch", source: r })
        return []
      }
      if (
        !(draft.tables as { name: string }[]).some((t) => t.name === from) ||
        !(draft.tables as { name: string }[]).some((t) => t.name === to)
      ) {
        losses.push({
          path: `relationships.${i}`,
          reason: "Relationship references a table excluded from this import",
          source: r,
        })
        return []
      }
      return [
        {
          name: str(r.name) || `relationship_${i + 1}`,
          left_table: from,
          right_table: to,
          relationship_columns: left.map((c, j) => ({ left_column: String(c), right_column: String(right[j]) })),
        },
      ]
    })
}
