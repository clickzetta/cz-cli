import { SemanticViewError } from "./error.js"
import { fingerprint, object } from "./metadata.js"
import type { SemanticService } from "./service.js"
import { MANAGED_PROPERTY } from "./compile.js"
import { literal, qualified } from "./sql.js"

// Apache Ossie (formerly Open Semantic Interchange, OSI) is converted by the engine itself:
//   CREATE [OR REPLACE] SEMANTIC VIEW <fqn> USING OSSIE YAML AS '<document>'
//   DESC SEMANTIC VIEW <fqn> AS OSSIE YAML [VERSION '0.1.1']
// The CLI never translates Ossie semantics. It keeps a local copy of the server export, previews it, and
// submits it back, much like a git working tree against a remote. The checks below only mirror the
// engine's document-shape rules so obvious mistakes fail before a round trip; the server stays authoritative.
export const OSSIE_VERSIONS = ["0.2.0.dev0", "0.1.1"] as const
export type OssieVersion = (typeof OSSIE_VERSIONS)[number]
const DIALECTS = ["ANSI_SQL", "SNOWFLAKE", "OSSIE_SQL_2026"]

export type OssieIssue = { path: string; message: string }

function list(value: unknown) {
  return Array.isArray(value) ? value : []
}
function str(value: unknown) {
  return typeof value === "string" ? value : ""
}

export function parseOssieText(text: string) {
  let root: unknown
  try {
    root = Bun.YAML.parse(text)
  } catch (e) {
    throw new SemanticViewError("INVALID_OSSIE_YAML", `Invalid Ossie YAML: ${e instanceof Error ? e.message : e}`)
  }
  if (!root || typeof root !== "object" || Array.isArray(root))
    throw new SemanticViewError("INVALID_OSSIE_YAML", "Invalid Ossie YAML: expected a mapping at the root")
  return root as Record<string, unknown>
}

// True for an Ossie document; the CLI's legacy authoring YAML has `tables` and no Ossie `version`.
export function isOssieText(text: string) {
  try {
    const root = parseOssieText(text)
    return typeof root.version === "string" && ("datasets" in root || "semantic_model" in root)
  } catch {
    return false
  }
}

// Locate the single semantic model in either document layout, applying the engine's version rules.
function modelOf(root: Record<string, unknown>) {
  const version = String(root.version ?? "")
  if (version === "0.1.1") {
    const models = list(root.semantic_model)
    if (models.length !== 1)
      throw new SemanticViewError(
        "MODEL_SELECTION_REQUIRED",
        "An Ossie 0.1.1 document must contain exactly one semantic_model for one semantic view",
      )
    return { version: version as OssieVersion, layout: "semantic_model", model: object(models[0]) }
  }
  if (version === "0.2.0.dev0") {
    if (root.semantic_model !== undefined)
      throw new SemanticViewError(
        "INVALID_OSSIE_YAML",
        "Ossie 0.2.0.dev0 places model properties at the document root; remove the semantic_model wrapper",
      )
    return { version: version as OssieVersion, layout: "flat", model: root }
  }
  throw new SemanticViewError(
    "UNSUPPORTED_OSSIE_VERSION",
    `Unsupported Ossie specification version '${version}' (supported: ${OSSIE_VERSIONS.join(", ")})`,
  )
}

function checkExpression(value: unknown, at: string, issues: OssieIssue[]) {
  const dialects = list(object(value ?? {}).dialects).map((d) => str(object(d).dialect).toUpperCase())
  if (!dialects.some((d) => DIALECTS.includes(d)))
    issues.push({ path: at, message: `No compatible expression dialect (expected ${DIALECTS.join(", ")})` })
}

// Offline preview: identity, counts, sources and the shape problems the engine would reject.
export function inspectOssie(text: string) {
  const { version, layout, model } = modelOf(parseOssieText(text))
  const issues: OssieIssue[] = []
  const datasets = list(model.datasets).map(object)
  if (!datasets.length) issues.push({ path: "datasets", message: "Ossie document 'datasets' must not be empty" })
  const names = new Set<string>()
  const summary = datasets.map((d, i) => {
    const name = str(d.name)
    if (!name) issues.push({ path: `datasets.${i}`, message: "Missing required 'name'" })
    else if (names.has(name)) issues.push({ path: `datasets.${i}`, message: `Duplicate dataset name '${name}'` })
    names.add(name)
    if (!str(d.source).trim()) issues.push({ path: `datasets.${name || i}`, message: "Missing required 'source'" })
    const fields = list(d.fields).map(object)
    fields.forEach((f) => checkExpression(f.expression, `datasets.${name}.fields.${str(f.name)}`, issues))
    return {
      name,
      source: str(d.source),
      primary_key: list(d.primary_key),
      dimensions: fields.filter((f) => f.dimension !== undefined).length,
      facts: fields.filter((f) => f.dimension === undefined).length,
    }
  })
  const relationships = list(model.relationships).map(object)
  relationships.forEach((r, i) => {
    const at = `relationships.${str(r.name) || i}`
    for (const end of [r.from, r.to])
      if (!names.has(str(end))) issues.push({ path: at, message: `Unknown dataset '${str(end)}'` })
    if (!list(r.from_columns).length || list(r.from_columns).length !== list(r.to_columns).length)
      issues.push({ path: at, message: "from_columns and to_columns must be non-empty and the same length" })
  })
  const metrics = list(model.metrics).map(object)
  metrics.forEach((m) => checkExpression(m.expression, `metrics.${str(m.name)}`, issues))
  const vendors = [model, ...datasets]
    .flatMap((node) => list(node.custom_extensions).map((e) => str(object(e).vendor_name)))
    .filter(Boolean)
  return {
    version,
    layout,
    name: str(model.name),
    description: str(model.description),
    datasets: summary,
    relationship_count: relationships.length,
    metric_count: metrics.length,
    custom_extension_vendors: [...new Set(vendors)],
    issues,
    valid: issues.length === 0,
    authority: "Offline shape preview only; the server conversion run by validate/push is authoritative",
  }
}

// Rebind dataset sources (dataset name -> table reference) without touching any other semantics.
export function remapSources(text: string, mapping: Record<string, string>) {
  const root = parseOssieText(text)
  const { model } = modelOf(root)
  const datasets = list(model.datasets).map(object)
  for (const [name, source] of Object.entries(mapping)) {
    const dataset = datasets.find((d) => d.name === name)
    if (!dataset) throw new SemanticViewError("UNKNOWN_DATASET", `Mapping references unknown dataset '${name}'`)
    if (typeof source !== "string" || !source.trim())
      throw new SemanticViewError("INVALID_MAPPING", `Mapping for dataset '${name}' must be a table reference`)
    dataset.source = source
  }
  return Bun.YAML.stringify(root, null, 2)
}

export function createSql(fqn: string, document: string, replace: boolean) {
  return `CREATE ${replace ? "OR REPLACE " : ""}SEMANTIC VIEW ${qualified(fqn)} USING OSSIE YAML AS ${literal(document)}`
}

export function exportSql(fqn: string, version?: string) {
  if (version !== undefined && !OSSIE_VERSIONS.includes(version as OssieVersion))
    throw new SemanticViewError(
      "UNSUPPORTED_OSSIE_VERSION",
      `Unsupported Ossie export version '${version}' (supported: ${OSSIE_VERSIONS.join(", ")})`,
    )
  return `DESC SEMANTIC VIEW ${qualified(fqn)} AS OSSIE YAML${version ? ` VERSION ${literal(version)}` : ""}`
}

function notFound(e: unknown) {
  return e instanceof SemanticViewError && /table or view not found/i.test(e.message)
}

export async function exportOssie(service: SemanticService, input: string, version?: string) {
  const fqn = service.target(input)
  const r = await service.execute(exportSql(fqn, version))
  const yaml = r.rows[0]?.[0]
  if (typeof yaml !== "string" || !yaml.trim())
    throw new SemanticViewError("EMPTY_EXPORT", `Server returned no Ossie YAML for ${fqn}`)
  return { fqn, yaml, fingerprint: fingerprint(yaml), version: version ?? OSSIE_VERSIONS[0], job_id: r.job_id }
}

export async function optionalExport(service: SemanticService, input: string, version?: string) {
  try {
    return await exportOssie(service, input, version)
  } catch (e) {
    if (notFound(e)) return undefined
    throw e
  }
}

export async function validateOssie(service: SemanticService, input: string, document: string) {
  const preview = inspectOssie(document)
  if (!preview.valid)
    throw new SemanticViewError("INVALID_OSSIE_YAML", "Ossie document has shape errors", preview.issues)
  const fqn = service.target(input)
  // OR REPLACE validates the candidate the same way whether or not the view exists yet.
  const r = await service.execute(`EXPLAIN ${createSql(fqn, document, true)}`)
  return { valid: true, fqn, preview, validation_job_id: r.job_id }
}

async function properties(service: SemanticService, fqn: string) {
  const p = await service.execute(`SHOW PROPERTIES ${qualified(fqn)}`)
  return Object.fromEntries(p.rows.map((row) => [String(row[0]), String(row[1])]))
}

// Submit a local document. `baseline` is the remote export fingerprint the edit started from, or
// "absent" for a new view; a different remote state is a conflict, like a rejected non-fast-forward push.
export async function pushOssie(
  service: SemanticService,
  input: string,
  document: string,
  options: { baseline?: string; version?: string } = {},
) {
  const fqn = service.target(input)
  const { validation_job_id, preview } = await validateOssie(service, fqn, document)
  const before = await optionalExport(service, fqn, options.version)
  const current = before?.fingerprint ?? "absent"
  if (options.baseline === undefined && before)
    throw new SemanticViewError(
      "BASELINE_REQUIRED",
      `${fqn} already exists; pull it first (or pass --baseline ${current}) so remote changes are not overwritten`,
      { remote_fingerprint: current },
    )
  if (options.baseline !== undefined && options.baseline !== current)
    throw new SemanticViewError("CONFLICT", "Remote semantic view changed since the local baseline; pull and reconcile", {
      baseline: options.baseline,
      remote_fingerprint: current,
    })
  // The legacy authoring envelope describes a different definition after this replace; drop it.
  const kept = before ? await properties(service, fqn) : {}
  delete kept[MANAGED_PROPERTY]
  let job_id: string | undefined
  try {
    const r = await service.execute(createSql(fqn, document, Boolean(before)), {
      onJobId: (id) => {
        job_id = id
      },
    })
    job_id = r.job_id ?? job_id
  } catch (e) {
    // The statement may or may not have committed; never retry blindly.
    throw new SemanticViewError("PUSH_UNCERTAIN", e instanceof Error ? e.message : String(e), {
      fqn,
      job_id,
      next: "Run `sv status` to compare the remote export with your baseline before retrying",
      cause: e instanceof SemanticViewError ? { code: e.code, details: e.details } : undefined,
    })
  }
  if (Object.keys(kept).length) await service.setProperties(fqn, kept)
  const after = await exportOssie(service, fqn, options.version)
  return {
    status: before ? "replaced" : "created",
    fqn,
    job_id,
    validation_job_id,
    preview,
    restored_properties: Object.keys(kept),
    remote_fingerprint: after.fingerprint,
    // The server canonicalizes (e.g. dataset-qualified expressions); pull to adopt its spelling locally.
    normalized: after.yaml.trim() !== document.trim(),
  }
}
