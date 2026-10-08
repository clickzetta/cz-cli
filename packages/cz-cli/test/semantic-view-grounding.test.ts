import { expect, test } from "bun:test"
import { generateModel } from "../src/semantic-view/provider.js"
import { inspectEnvironment } from "../src/semantic-view/environment.js"
import { SemanticService } from "../src/semantic-view/service.js"
import { SemanticViewError } from "../src/semantic-view/error.js"

const model = {
  name: "measurements",
  tables: [{ name: "m", base_table: { database: "w", schema: "s", table: "measurements" }, metrics: [{ name: "mean_quantity", expr: "AVG(m.quantity)" }] }],
}
const knowledge = {
  sources: [{ id: "d1", locator: "definitions.md#mean" }],
  requirements: [{ id: "r1", statement: "Mean quantity excludes NULL from the denominator", source_ids: ["d1"], state: "confirmed" }],
}
const coverage = [{ requirement_id: "r1", fields: ["m.mean_quantity"], status: "covered" }]

test("generation forwards cited definitions and retains original provenance outside the engine model", async () => {
  const result = await generateModel(async (instruction, input) => {
    expect(instruction).toContain("requirement_id")
    expect(input).toHaveProperty("request.json_proto.knowledge", knowledge)
    return { model, coverage, knowledge: { sources: [] } }
  }, { json_proto: { knowledge } })
  expect(result.knowledge).toEqual(knowledge)
  expect(result.coverage).toEqual(coverage)
  expect(result.model).not.toHaveProperty("knowledge")
})

test("generation repairs structural errors once with original evidence and then stops", async () => {
  let calls = 0
  const result = await generateModel(async (_, input) => {
    calls++
    if (calls === 1) return { model, coverage: [{ ...coverage[0], fields: ["wrong"] }] }
    expect(input).toHaveProperty("request.knowledge", knowledge)
    expect(input).toHaveProperty("repair.error.details.available", ["m.mean_quantity"])
    return { model, coverage }
  }, { knowledge })
  expect(calls).toBe(2)
  expect(result).toHaveProperty("generation_repair.trigger", "INVALID_COVERAGE")
  calls = 0
  await expect(generateModel(async () => { calls++; return { model, coverage: [] } }, { knowledge })).rejects.toHaveProperty("code", "INVALID_COVERAGE")
  expect(calls).toBe(2)
})

test("invalid provenance is rejected before generation", async () => {
  for (const request of [
    { knowledge: { ...knowledge, sources: [] } },
    { knowledge: { ...knowledge, requirements: [...knowledge.requirements, ...knowledge.requirements] } },
    { knowledge: { ...knowledge, sources: [...knowledge.sources, ...knowledge.sources] } },
    { json_proto: {}, knowledge },
  ]) {
    let calls = 0
    await expect(generateModel(async () => { calls++; return { model, coverage } }, request)).rejects.toHaveProperty("code", "INVALID_KNOWLEDGE")
    expect(calls).toBe(0)
  }
})

test("structured coverage rejects omissions, duplicates, unknown IDs, invented fields and unsupported completion claims", async () => {
  for (const candidate of [
    undefined, [], [...coverage, ...coverage],
    [{ ...coverage[0], requirement_id: "other" }],
    [{ ...coverage[0], fields: ["m.invented"] }],
    [{ ...coverage[0], fields: [] }],
    [{ ...coverage[0], status: "unresolved" }],
  ]) {
    await expect(generateModel(async () => ({ model, coverage: candidate }), { knowledge })).rejects.toHaveProperty("code", "INVALID_COVERAGE")
  }
})

test("proposed and conflicting definitions stay unresolved while independent modeling proceeds", async () => {
  for (const state of ["proposed", "conflict"]) {
    const request = { knowledge: { ...knowledge, requirements: [{ ...knowledge.requirements[0], state }] } }
    await expect(generateModel(async () => ({ model, coverage }), request)).rejects.toHaveProperty("code", "INVALID_COVERAGE")
    const result = await generateModel(async () => ({ model, coverage: [{ ...coverage[0], fields: [], status: "unresolved", reason: "Definition needs resolution" }] }), request)
    expect(result.coverage).toHaveLength(1)
    expect(result.knowledge?.requirements[0].state).toBe(state)
    const unmapped = await generateModel(async () => ({ model, coverage: [{ requirement_id: "r1", status: "unresolved", reason: "Needs a definition" }] }), request)
    expect(unmapped.coverage).toEqual([{ requirement_id: "r1", fields: [], status: "unresolved", reason: "Needs a definition" }])
  }
})

test("existing generation callers without structured knowledge retain their coverage contract", async () => {
  const legacy = [{ requirement: "Mean quantity", fields: ["m.mean_quantity"], status: "covered" }]
  const result = await generateModel(async () => ({ model, coverage: legacy }), { requirements: ["Mean quantity"] })
  expect(result.coverage).toEqual(legacy)
  expect(result).not.toHaveProperty("knowledge")
})

test("structured generation refuses guessed keys but accepts source-specific observed evidence", async () => {
  const noKey = { ...model, tables: [{ ...model.tables[0], primary_key: null }] }
  const normalized = await generateModel(async () => ({ model: noKey, coverage }), { knowledge })
  expect(normalized.model.tables[0].primary_key).toBeUndefined()
  const keyed = { ...model, tables: [{ ...model.tables[0], primary_key: { columns: ["row_id"] } }] }
  await expect(generateModel(async () => ({ model: keyed, coverage }), { knowledge })).rejects.toHaveProperty("code", "UNVERIFIED_KEYS")
  const key_evidence = [{ source_id: "d1", base_table: model.tables[0].base_table, columns: ["row_id"], kind: "primary" }]
  const result = await generateModel(async () => ({ model: keyed, coverage }), { knowledge: { ...knowledge, key_evidence } })
  expect(result.model.tables[0].primary_key?.columns).toEqual(["row_id"])
  for (const wrong of [
    { ...key_evidence[0], kind: "unique" },
    { ...key_evidence[0], columns: ["other"] },
    { ...key_evidence[0], base_table: { ...model.tables[0].base_table, table: "other" } },
  ]) {
    await expect(generateModel(async () => ({ model: keyed, coverage }), { knowledge: { ...knowledge, key_evidence: [wrong] } })).rejects.toHaveProperty("code", "UNVERIFIED_KEYS")
  }
  const unique = { ...model, tables: [{ ...model.tables[0], unique_keys: [{ columns: ["row_id"] }] }] }
  await expect(generateModel(async () => ({ model: unique, coverage }), { knowledge })).rejects.toHaveProperty("code", "UNVERIFIED_KEYS")
})

test("remote probes distinguish old server syntax from permission failure and never submit writes", async () => {
  for (const failure of ["Syntax error near AS", "Permission denied", "Network unavailable"]) {
    const statements: string[] = []
    const service = new SemanticService(async (sql, options) => {
      statements.push(sql)
      await options?.onJobId?.(`job_${statements.length}`)
      if (sql.startsWith("DESC")) throw new SemanticViewError("CZLH-42000", failure)
      return { columns: ["value"], rows: [["release-v1.8/25fde96"]] }
    }, { workspace: "w", schema: "s" }, "test")
    const result = await inspectEnvironment(service, "existing")
    expect(statements).toEqual(["SELECT version()", "SHOW SEMANTIC VIEWS", "DESC SEMANTIC VIEW `w`.`s`.`existing` AS OSSIE YAML"])
    expect(result.ossie_export.status).toBe(failure.startsWith("Syntax") ? "unsupported" : "unknown")
    expect(result.ossie_export).toHaveProperty("job_id", "job_3")
    expect(result.ossie_import.status).toBe("not_checked")
    expect(result.default_workflow).toBe("native_sv_yaml")
  }
})

test("export success does not certify import or ontology, and no target skips export", async () => {
  const service = new SemanticService(async () => ({ columns: [], rows: [] }), { workspace: "w", schema: "s" }, "test")
  expect((await inspectEnvironment(service)).ossie_export.status).toBe("not_checked")
  const result = await inspectEnvironment(service, "existing")
  expect(result.ossie_export.status).toBe("supported")
  expect(result.ossie_import.status).toBe("not_checked")
  expect(result.ontology.status).toBe("not_checked")
})
