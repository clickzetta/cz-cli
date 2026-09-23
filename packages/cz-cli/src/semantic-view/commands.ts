import path from "node:path"
import { readTracking, trackFile } from "./tracking.js"
import { z } from "zod"
import type { SvArgs } from "../commands/sv.js"
import { parseModel, yaml, modelSchema, validateModel, type Model } from "./model.js"
import { capabilities, compile } from "./compile.js"
import { connect, type SemanticService } from "./service.js"
import { editModel, operationNames } from "./edit.js"
import { atomicWrite, withFileLock, workspaceFile } from "./files.js"
import { fingerprint, object } from "./metadata.js"
import { identifier, storedName } from "./sql.js"
import { SemanticViewError } from "./error.js"
import { auditModel, auditData } from "./audit.js"
import { completion, generateModel, propose } from "./provider.js"
import { buildQuery, generateQuery, transformQuery, transformQueries } from "./query.js"
import { analyzeImport, convertImport, parseImportOptions } from "./import.js"
import {
  createOptimization,
  getOptimization,
  listOptimizations,
  cancelOptimization,
  runOptimization,
  spawnOptimization,
} from "./optimization.js"

function required(value: string | undefined, name: string) {
  if (!value) throw new SemanticViewError("ARGUMENT_REQUIRED", `${name} is required`)
  return value
}
function authorized(args: SvArgs) {
  if (!args.write)
    throw new SemanticViewError(
      "WRITE_REQUIRED",
      "Use --write for an authorized remote deployment; local edits do not require this flag",
    )
}
async function load(args: SvArgs) {
  return parseModel(args.yamlContent ?? (await Bun.file(workspaceFile(required(args.filePath, "--file-path"))).text()))
}
function target(args: SvArgs, model?: Model) {
  return required(args.fqn ?? args.name ?? model?.name, "--fqn")
}
async function outputFile(args: SvArgs, value: unknown) {
  if (!args.outPath) return {}
  return atomicWrite(
    workspaceFile(args.outPath),
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
  )
}

export async function runSv(command: string, args: SvArgs): Promise<unknown> {
  if (["deploy", "recover"].includes(command)) authorized(args)
  if (command === "capabilities")
    return { ...capabilities(), schema: modelSchema(), edit_operations: operationNames, backend_tools: backendTools }
  if (command === "compile") {
    const model = await load(args)
    const result = compile(model, {
      workspace: required(args.workspace ?? (args.fqn && storedName(args.fqn).length === 3 ? storedName(args.fqn)[0] : undefined), "--workspace or fully qualified --fqn"),
      schema: args.schema ?? "public",
      target: args.fqn,
    })
    return { ...result, ...(await outputFile(args, result.sql)) }
  }
  if (command === "write") {
    const model = parseModel(required(args.yamlContent, "--yaml-content"))
    const file = workspaceFile(args.filePath, model.name)
    return withFileLock(file, async () => {
      const written = await atomicWrite(file, yaml(model))
      const tracking = await trackFile(file, {
        fqn: args.sourceObject,
        profile: args.profile,
        local_fingerprint: written.fingerprint,
        state: "draft",
      })
      return { ...written, ...tracking, source_object: args.sourceObject, model }
    })
  }
  if (command === "edit") {
    const ops = args.operationsFile
      ? await Bun.file(workspaceFile(args.operationsFile)).json()
      : (JSON.parse(required(args.operations, "--operations or --operations-file")) as unknown)
    if (Array.isArray(ops) && ops.length === 0) return { operations: operationNames }
    const file = workspaceFile(required(args.filePath, "--file-path"))
    return withFileLock(file, async () => {
      const before = await Bun.file(file).text()
      if (args.baseline && args.baseline !== fingerprint(before))
        throw new SemanticViewError("CONFLICT", "Local file changed since baseline")
      const model = editModel(parseModel(before), ops)
      const previous = await readTracking(file)
      const written = await atomicWrite(file, yaml(model))
      const tracking = await trackFile(file, { ...previous, local_fingerprint: written.fingerprint, state: "edited" })
      return { ...written, ...tracking, model }
    })
  }
  if (command === "read" && args.source === "workspace") {
    const model = await load(args)
    return { model, yaml: yaml(model), ...(await outputFile(args, yaml(model))) }
  }
  if (command === "validate" && args.mode === "local") {
    const model = await load(args)
    return { valid: true, issues: validateModel(model), capabilities: capabilities() }
  }
  if (command === "generate") {
    const request = (await Bun.file(workspaceFile(required(args.filePath, "--file-path"))).json()) as unknown
    const result = await generateModel(await completion(args), await groundedRequest(args, request))
    const response = { json_proto: { semanticYaml: yaml(result.model) }, assumptions: result.assumptions, coverage: result.coverage }
    return { ...response, ...(await outputFile(args, response)) }
  }
  if (command === "optimize") {
    if (args.semanticChanges) authorized(args)
    if (args.action === "list") return { jobs: await listOptimizations(args.stateRoot) }
    if (args.action === "get") return getOptimization(required(args.id, "--id"), args.stateRoot)
    if (args.action === "cancel") return cancelOptimization(required(args.id, "--id"), args.stateRoot)
    if (args.action === "run") return runOptimization(required(args.id, "--id"), { root: args.stateRoot })
    const job = await createOptimization(await load(args), {
      iterations: args.iterations,
      model: args.model,
      llm: args.llm,
      root: args.stateRoot,
      profile: args.profile,
      target: args.fqn,
      evaluate: args.evaluate,
      semanticChanges: args.semanticChanges,
      history: args.historyFile ? await Bun.file(workspaceFile(args.historyFile)).text() : undefined,
    })
    return args.foreground
      ? runOptimization(job.id, { root: args.stateRoot })
      : spawnOptimization(job.id, args.stateRoot)
  }
  if (command === "import") {
    const kind = z.enum(["osi"]).parse(args.kind)
    const file = workspaceFile(required(args.filePath, "--file-path"))
    if (args.mode === "local" && !args.outPath) return analyzeImport(file, kind)
    const result = await convertImport(file, kind, parseImportOptions(JSON.parse(args.parameters ?? "{}")))
    if (result.losses.length && !args.allowLossy) return result
    return { ...result, ...(await outputFile(args, result.yaml_content)) }
  }
  if (command === "audit") {
    const model = await load(args)
    const result = {
      ...auditModel(model),
      ...(args.data ? { data: await auditData(await connect(args), model) } : {}),
      ...(args.criteria
        ? {
            custom: await (
              await completion(args)
            )(
              "Evaluate each user-supplied criterion against the provided semantic model. Return {findings:[{criterion,status,evidence}],unknowns:[]}. Distinguish supported evidence, failure and not-verifiable; do not invent business correctness.",
              { model, criteria: args.criteria },
            ),
          }
        : {}),
    }
    return { ...result, ...(await outputFile(args, result)) }
  }
  if (command === "suggest") {
    const model = await load(args)
    const context = args.historyFile ? await Bun.file(workspaceFile(args.historyFile)).text() : undefined
    const result = await propose(await completion(args), args.kind ?? "relationships", model, context)
    return { result, ...(await outputFile(args, result)) }
  }
  if (command === "backend") return backend(args)
  const service = await connect(args)
  if (command === "list" || command === "search") return service.list(args.query ?? "", args.limit ?? 20)
  if (command === "read" || command === "describe") {
    const result = await service.read(target(args))
    if (!args.outPath) return result
    const file = workspaceFile(args.outPath)
    return withFileLock(file, async () => {
      const written = await atomicWrite(file, result.yaml)
      const tracking = await trackFile(file, {
        fqn: result.fqn,
        profile: args.profile,
        identity: service.identity,
        remote_fingerprint: result.fingerprint,
        local_fingerprint: written.fingerprint,
        remote_version: result.version,
        state: "downloaded",
      })
      return { ...result, path: written.path, local_fingerprint: written.fingerprint, ...tracking }
    })
  }
  if (command === "recover") {
    authorized(args)
    return service.recover(workspaceFile(required(args.filePath, "--file-path")))
  }
  const model = args.filePath || args.yamlContent ? await load(args) : (await service.read(target(args))).model
  if (command === "plan") return service.plan(model, target(args, model))
  if (command === "deploy") {
    authorized(args)
    const file = args.filePath ? workspaceFile(args.filePath) : undefined
    const previous = file ? await readTracking(file) : undefined
    if (file && fingerprint(parseModel(await Bun.file(file).text())) !== fingerprint(model))
      throw new SemanticViewError("CONFLICT", "Local model changed while preparing deployment")
    const baseline =
      args.baseline ??
      (previous?.identity === service.identity && previous.fqn === service.target(target(args, model))
        ? previous.remote_fingerprint
        : undefined)
    const result = await service.deploy(model, target(args, model), { baseline, stateRoot: args.stateRoot })
    if (!file) return result
    try {
      const tracking = await withFileLock(file, async () =>
        trackFile(file, {
          fqn: result.fqn,
          profile: args.profile,
          identity: service.identity,
          remote_fingerprint: result.fingerprint,
          local_fingerprint: fingerprint(await Bun.file(file).text()),
          state: fingerprint(parseModel(await Bun.file(file).text())) === fingerprint(model) ? "deployed" : "edited",
        }),
      )
      return { ...result, ...tracking }
    } catch (e) {
      return { ...result, tracking_error: e instanceof Error ? e.message : String(e) }
    }
  }
  if (command === "validate") {
    const plan = args.mode === "queries" ? undefined : await service.plan(model, target(args, model))
    const queries = ["queries", "all"].includes(args.mode ?? "") ? await service.validateQueries(model) : undefined
    return {
      valid: queries?.valid ?? true,
      definition: plan ? { valid: true, job_id: plan.validation_job_id } : undefined,
      queries,
    }
  }
  if (command === "query") {
    const query = args.question
      ? await generateQuery(await completion(args), service, model, service.target(target(args, model)), args.question)
      : { sql: buildQuery(model, service.target(target(args, model)), args), executed: false }
    const result = {
      ...query,
      ...(args.execute ? { executed: true, result: await service.execute(query.sql as string) } : {}),
    }
    return { ...result, ...(await outputFile(args, result)) }
  }
  throw new SemanticViewError("UNKNOWN_COMMAND", `Unknown SV command: ${command}`)
}

export const backendTools = [
  "help",
  "cz_semantic_view_search",
  "semantic_model_edit",
  "generate_semantic_model_yaml",
  "reflect_semantic_model",
  "suggest_relationships",
  "generate_descriptions",
  "filters_and_metrics_suggestions",
  "verified_query_suggestions",
  "validate_verified_queries",
  "expand_verified_query",
  "truncate_verified_query",
  "osi_write_model",
  "create_agentic_optimization",
  "get_agentic_optimization",
  "list_agentic_optimizations",
  "cancel_agentic_optimization",
] as const

async function backend(args: SvArgs): Promise<unknown> {
  const request = args.parameters
    ? object(JSON.parse(args.parameters))
    : args.filePath?.endsWith(".json")
      ? object(await Bun.file(workspaceFile(args.filePath)).json())
      : {}
  const tool = args.tool ?? String(request.tool ?? "help")
  const p = request.parameters ? object(request.parameters) : request
  if (!backendTools.includes(tool as (typeof backendTools)[number]))
    throw new SemanticViewError("UNKNOWN_TOOL", `Unknown backend tool: ${tool}`, backendTools)
  const result = await backendResult(tool, p, args)
  return { result: JSON.stringify(result) }
}

async function backendResult(tool: string, p: Record<string, unknown>, args: SvArgs): Promise<unknown> {
  if (tool === "help") return { tools: backendTools, operations: operationNames, capabilities: capabilities() }
  if (tool === "cz_semantic_view_search") {
    const service = await connect(args)
    return p.describe_view
      ? service.read(String(p.describe_view))
      : service.list(String(p.search_query ?? ""), Number(p.max_results ?? 20))
  }
  if (tool === "osi_write_model") {
    authorized(args)
    if ((typeof p.yaml_content === "string") === (typeof p.file_path === "string"))
      throw new SemanticViewError("INVALID_IMPORT_SOURCE", "Supply exactly one of yaml_content or file_path")
    const supplied = typeof p.yaml_content === "string" ? p.yaml_content : undefined
    const file = supplied
      ? path.resolve("cz_project", ".sv", "imports", crypto.randomUUID() + ".yaml")
      : workspaceFile(String(p.file_path))
    if (supplied) await atomicWrite(file, supplied)
    const result = await convertImport(
      file,
      "osi",
      parseImportOptions(
        Object.fromEntries(
          Object.entries(p).filter(([key]) => !["file_path", "yaml_content", "target_db_schema"].includes(key)),
        ),
      ),
    )
    if (result.losses.length)
      throw new SemanticViewError(
        "LOSSY_IMPORT",
        "Resolve all import losses before direct OSI deployment",
        result.losses,
      )
    const service = await connect(args)
    return service.deploy(
      result.model,
      `${String(p.target_db_schema ?? `${service.binding.workspace}.${service.binding.schema}`)}.${result.model.name}`,
    )
  }
  if (tool === "list_agentic_optimizations") return listOptimizations(args.stateRoot)
  if (tool === "get_agentic_optimization") return getOptimization(String(p.id), args.stateRoot)
  if (tool === "cancel_agentic_optimization") return cancelOptimization(String(p.id), args.stateRoot)
  if (tool === "generate_semantic_model_yaml") {
    const result = await generateModel(await completion(args), await groundedRequest(args, p))
    return { semanticYaml: yaml(result.model), assumptions: result.assumptions, coverage: result.coverage }
  }
  const sqls = p.sqls === undefined ? undefined : z.array(z.string().trim().min(1)).parse(p.sqls)
  const model = await loadBackendModel(args, p)
  if (tool === "semantic_model_edit") {
    const result = editModel(model, p.operations)
    return { yaml_content: yaml(result), model: result }
  }
  if (tool === "create_agentic_optimization") {
    if (args.semanticChanges) authorized(args)
    const job = await createOptimization(model, {
      iterations: Number(p.iterations ?? 3),
      model: args.model,
      llm: args.llm,
      root: args.stateRoot,
      profile: args.profile,
      target: args.fqn,
      evaluate: args.evaluate,
      semanticChanges: args.semanticChanges,
      history: args.historyFile ? await Bun.file(workspaceFile(args.historyFile)).text() : undefined,
    })
    return spawnOptimization(job.id, args.stateRoot)
  }
  if (tool === "reflect_semantic_model") return { valid: true, issues: validateModel(model), audit: auditModel(model) }
  if (tool === "validate_verified_queries") {
    if (sqls)
      model.verified_queries = sqls.map((sql, i) => ({
        name: `query_${i + 1}`,
        question: `Validation query ${i + 1}`,
        sql,
      }))
    const service = await connect(args)
    const validation = await service.validateQueries(model)
    return {
      ...validation,
      results: validation.queries.map((query) => ({ ...query, question: sqls ? null : query.question })),
      validation_method: "EXPLAIN original SQL against existing server objects; no logical SQL expansion",
    }
  }
  if (tool === "expand_verified_query" || tool === "truncate_verified_query") {
    if (sqls) {
      if (!sqls.length) throw new SemanticViewError("EMPTY_QUERY_BATCH", "Supply at least one SQL string to transform")
      return transformQueries(
        await completion(args),
        await connect(args),
        model,
        sqls,
        tool.startsWith("expand") ? "expand" : "truncate",
        args.evaluate,
        typeof p.semantic_view === "string" ? p.semantic_view : args.fqn,
      )
    }
    return transformQuery(
      await completion(args),
      await connect(args),
      model,
      String(p.sql ?? p.query ?? ""),
      tool.startsWith("expand") ? "expand" : "truncate",
      args.evaluate,
      typeof p.semantic_view === "string" ? p.semantic_view : args.fqn,
    )
  }
  return propose(await completion(args), tool, model, p)
}

async function loadBackendModel(args: SvArgs, p: Record<string, unknown>) {
  if (typeof p.semantic_model === "string" || (p.semantic_model && typeof p.semantic_model === "object"))
    return parseModel(p.semantic_model)
  if (typeof p.yaml_content === "string") return parseModel(p.yaml_content)
  if (typeof p.semantic_view === "string") {
    const service = await connect(args)
    return (await service.read(p.semantic_view)).model
  }
  return load({ ...args, filePath: typeof p.file_path === "string" ? p.file_path : args.filePath })
}

async function groundedRequest(args: SvArgs, request: unknown) {
  const input = object(request)
  const proto = object(input.json_proto ?? input)
  if (!Array.isArray(proto.tables) || !proto.tables.length) return request
  const service = await connect(args)
  const tables = []
  for (const value of proto.tables) {
    const table = object(value)
    if (typeof table.table !== "string" || typeof table.schema !== "string")
      throw new SemanticViewError("INVALID_SOURCE", "Source tables require schema and table")
    const fqn = [String(table.workspace ?? table.database ?? service.binding.workspace), table.schema, table.table]
      .map(identifier)
      .join(".")
    const metadata = await service.execute(`DESC TABLE ${fqn}`)
    const requested = Array.isArray(table.columnNames) ? table.columnNames.map(String) : []
    if (requested.some((c) => !metadata.rows.some((row) => String(row[0]) === c)))
      throw new SemanticViewError("MISSING_SOURCE_COLUMN", `Requested source column missing from ${fqn}`)
    tables.push({
      ...table,
      physical_metadata: { columns: metadata.columns, rows: metadata.rows },
      metadata_job_id: metadata.job_id,
    })
  }
  return { ...proto, tables }
}
