import type { SemanticService } from "./service.js"
import { SemanticViewError } from "./error.js"
import { qualified } from "./sql.js"

// These observations describe individual statements, not a feature matrix inferred from a version.
export async function inspectEnvironment(service: SemanticService, fqn?: string) {
  const target = fqn ? service.target(fqn) : undefined
  const probe = async (sql: string) => {
    const evidence: { job_id?: string } = {}
    try {
      const result = await service.execute(sql, { onJobId: (id) => { evidence.job_id = id } })
      return { status: "supported" as const, sql, job_id: result.job_id ?? evidence.job_id, result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const syntax = /syntax error|parse error|unexpected token|mismatched input|no viable alternative/i.test(message)
      return {
        status: syntax ? "unsupported" as const : "unknown" as const,
        sql,
        ...evidence,
        error: { code: error instanceof SemanticViewError ? error.code : "PROBE_FAILED", message },
      }
    }
  }
  const version = await probe("SELECT version()")
  const listing = await probe("SHOW SEMANTIC VIEWS")
  const exported = target ? await probe(`DESC SEMANTIC VIEW ${qualified(target)} AS OSSIE YAML`) : undefined
  const summarize = (value: Awaited<ReturnType<typeof probe>>) => {
    const { result, ...evidence } = value
    return evidence
  }
  return {
    checked_at: new Date().toISOString(),
    binding: service.binding,
    version: { ...summarize(version), value: version.result?.rows[0]?.[0] },
    native_listing: summarize(listing),
    ossie_export: exported ? summarize(exported) : { status: "not_checked", reason: "Pass --fqn for an accessible existing semantic view" },
    ossie_import: { status: "not_checked", reason: "Validate the actual document with --mode remote before import/push; export support does not prove import support" },
    ontology: { status: "not_checked", reason: "Ossie transport and local knowledge do not establish a server ontology catalog" },
    default_workflow: "native_sv_yaml",
    next_step: "Use read/generate, local validate and plan for the actual candidate; these probes do not certify deployment or business results",
  }
}
