import path from "node:path"
import { spawn } from "node:child_process"
import { open, readdir } from "node:fs/promises"
import { atomicWrite, withFileLock } from "./files.js"
import { type Model, yaml } from "./model.js"
import { object, fingerprint } from "./metadata.js"
import { auditModel } from "./audit.js"
import { editModel, operationNames } from "./edit.js"
import { completion, type Completion } from "./provider.js"
import { connect, type SemanticService } from "./service.js"
import { generateQuery, compareQueries } from "./query.js"
import { qualified } from "./sql.js"
import { SemanticViewError } from "./error.js"

export type Optimization = {
  id: string
  state: "queued" | "running" | "completed" | "failed" | "cancelled"
  created_at: string
  updated_at: string
  model: Model
  iterations: number
  completed_iterations: number
  model_option?: string
  llm?: string
  best: Model
  baseline_score: number
  best_score: number
  history: { iteration: number; score?: number; accepted: boolean; reason: string }[]
  error?: string
  pid?: number
  profile?: string
  target?: string
  evaluate?: boolean
  semantic_changes?: boolean
  history_context?: string
  baseline_accuracy?: number
  best_accuracy?: number
  evaluations?: unknown[]
}
export function jobRoot(root?: string) {
  return path.resolve(root ?? "cz_project/.sv/optimizations")
}
function jobPath(id: string, root?: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new SemanticViewError("INVALID_JOB_ID", "Invalid optimization job ID")
  return path.join(jobRoot(root), id + ".json")
}
export async function createOptimization(
  model: Model,
  options: {
    iterations?: number
    model?: string
    llm?: string
    root?: string
    profile?: string
    target?: string
    evaluate?: boolean
    semanticChanges?: boolean
    history?: string
  } = {},
) {
  const iterations = options.iterations ?? 3
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 20)
    throw new SemanticViewError("INVALID_BUDGET", "Optimization iterations must be between 1 and 20")
  if (options.evaluate && (!options.target || !model.verified_queries.length))
    throw new SemanticViewError(
      "EVALUATION_REQUIRED",
      "Accuracy optimization requires --fqn and at least one trusted VQR",
    )
  if (options.evaluate && model.verified_queries.length > 10)
    throw new SemanticViewError(
      "EVALUATION_BUDGET",
      "Accuracy optimization supports up to 10 explicit VQRs per job; select a representative evaluation suite",
    )
  if (options.semanticChanges && !options.evaluate)
    throw new SemanticViewError(
      "EVALUATION_REQUIRED",
      "Semantic changes require accuracy evaluation against trusted VQRs",
    )
  const score = auditModel(model).score
  const now = new Date().toISOString()
  const job: Optimization = {
    id: crypto.randomUUID(),
    state: "queued",
    created_at: now,
    updated_at: now,
    model,
    iterations,
    completed_iterations: 0,
    model_option: options.model,
    llm: options.llm,
    best: model,
    baseline_score: score,
    best_score: score,
    history: [],
    profile: options.profile,
    target: options.target,
    evaluate: options.evaluate,
    semantic_changes: options.semanticChanges,
    history_context: options.history,
    evaluations: [],
  }
  await atomicWrite(jobPath(job.id, options.root), JSON.stringify(job, null, 2))
  return job
}
export async function getOptimization(id: string, root?: string) {
  const job = (await Bun.file(jobPath(id, root)).json()) as Optimization
  if (job.state === "running" && job.pid) {
    try {
      process.kill(job.pid, 0)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH")
        return {
          ...job,
          state: "failed" as const,
          error:
            "Optimization worker exited without completing; saved best model is available. Create a new job to continue.",
        }
      throw e
    }
  }
  return job
}
export async function listOptimizations(root?: string) {
  const files = await readdir(jobRoot(root)).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return []
    throw e
  })
  return Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map((f) =>
        getOptimization(f.slice(0, -5), root).then((j) => ({
          id: j.id,
          state: j.state,
          created_at: j.created_at,
          baseline_score: j.baseline_score,
          best_score: j.best_score,
          completed_iterations: j.completed_iterations,
        })),
      ),
  )
}
export async function cancelOptimization(id: string, root?: string) {
  const job = await getOptimization(id, root)
  if (["completed", "failed", "cancelled"].includes(job.state)) return { id, state: job.state }
  await atomicWrite(jobPath(id, root) + ".cancel", "cancelled\n")
  return { id, state: "cancel_requested" }
}
export async function runOptimization(
  id: string,
  options: { root?: string; complete?: Completion; service?: SemanticService } = {},
) {
  const file = jobPath(id, options.root)
  return withFileLock(file, async () => {
    const job = await getOptimization(id, options.root)
    if (job.state !== "queued")
      throw new SemanticViewError("JOB_NOT_QUEUED", `Job is ${job.state}; interrupted jobs are not implicitly resumed`)
    const controller = new AbortController()
    const timer = setInterval(() => {
      void Bun.file(file + ".cancel")
        .exists()
        .then((exists) => {
          if (exists) controller.abort()
        })
    }, 500)
    const save = async () => {
      job.updated_at = new Date().toISOString()
      await atomicWrite(file, JSON.stringify(job, null, 2))
    }
    try {
      job.state = "running"
      job.pid = process.pid
      await save()
      if (await Bun.file(file + ".cancel").exists()) {
        job.state = "cancelled"
        await save()
        return job
      }
      const complete = options.complete ?? (await completion({ model: job.model_option, llm: job.llm }))
      const service = job.evaluate ? (options.service ?? (await connect({ profile: job.profile }))) : undefined
      if (service) {
        job.baseline_accuracy = await accuracy(complete, service, job.model, job.target!, job, controller.signal)
        job.best_accuracy = job.baseline_accuracy
        await save()
      }
      for (let i = 0; i < job.iterations; i++) {
        if (await Bun.file(file + ".cancel").exists()) {
          job.state = "cancelled"
          break
        }
        const proposal = object(
          await complete(
            "Improve this semantic model using its audit findings, trusted verified-query examples, supplied query history and evaluation failures. Return {operations:[{operation,params}],reason:string}. You may improve descriptions, synonyms and module instructions. Only propose add_vqr when supplied query_history contains the exact SQL; without query_history do not add VQRs. update_column_description requires params {table,column,description}; update_table_description requires {table,description}; update_model_description requires {description}; update_column_synonyms requires {table,column,synonyms}; update_custom_instructions requires {sql_generation} or {question_categorization}. Follow the provided objective. Preserve physical source bindings and existing VQR ground truth. If structural changes are disabled, also preserve all fields, SQL expressions and relationships. Never fabricate business facts. Return proposals only; the CLI evaluates disposable candidate views when enabled.",
            {
              model: job.best,
              audit: auditModel(job.best),
              trusted_queries: job.model.verified_queries,
              query_history: job.history_context,
              evaluations: job.evaluations,
              operations: operationNames,
              objective: job.semantic_changes
                ? "Structural changes to existing expressions, fields and relationships are allowed only if evaluated against trusted VQR results. Do not add source tables or change physical source bindings."
                : "Preserve existing SQL business semantics",
            },
            controller.signal,
          ),
        )
        const operations = Array.isArray(proposal.operations) ? proposal.operations : []
        const allowed = new Set<string>(
          job.semantic_changes
            ? operationNames.filter((n) => !["add_table", "add_vqr", "remove_vqr", "remove_vqrs"].includes(n))
            : [
                "update_model_description",
                "update_table_description",
                "update_column_description",
                "update_column_synonyms",
                "update_custom_instructions",
                "add_vqr",
              ],
        )
        if (operations.some((o) => !allowed.has(String(object(o).operation)))) {
          job.history.push({
            iteration: i + 1,
            accepted: false,
            reason: "Candidate attempted a semantic mutation outside this optimization objective",
          })
          job.completed_iterations = i + 1
          await save()
          continue
        }
        const candidate = editModel(job.best, operations)
        if (
          job.semantic_changes &&
          candidate.tables.some(
            (t) => !job.model.tables.some((original) => fingerprint(original.base_table) === fingerprint(t.base_table)),
          )
        )
          throw new SemanticViewError(
            "SOURCE_BINDING_CHANGED",
            "Optimization cannot introduce ungrounded physical sources",
          )
        const newQueries = candidate.verified_queries.filter(
          (q) => !job.model.verified_queries.some((v) => v.name === q.name),
        )
        if (newQueries.length) {
          const validator = service ?? options.service ?? (await connect({ profile: job.profile }))
          const validation = await validator.validateQueries({ ...candidate, verified_queries: newQueries })
          if (!validation.valid) {
            job.history.push({ iteration: i + 1, accepted: false, reason: JSON.stringify(validation) })
            job.completed_iterations = i + 1
            await save()
            continue
          }
          if (newQueries.some((q) => !historyContains(job.history_context, q.sql))) {
            job.history.push({
              iteration: i + 1,
              accepted: false,
              reason:
                "New VQR SQL must occur verbatim in supplied query history; model-generated SQL is not trusted ground truth",
            })
            job.completed_iterations = i + 1
            await save()
            continue
          }
        }
        const score = auditModel(candidate).score
        const measured = service
          ? job.semantic_changes
            ? await evaluateCandidate(complete, service, candidate, job, options.root, controller.signal)
            : await accuracy(complete, service, candidate, job.target!, job, controller.signal)
          : undefined
        const accepted =
          measured === undefined
            ? score > job.best_score
            : measured > (job.best_accuracy ?? 0) || (measured === job.best_accuracy && score > job.best_score)
        if (accepted) {
          job.best = candidate
          job.best_score = score
          if (measured !== undefined) job.best_accuracy = measured
        }
        job.history.push({ iteration: i + 1, score, accepted, reason: String(proposal.reason ?? "") })
        job.completed_iterations = i + 1
        await save()
      }
      if (job.state === "running") job.state = controller.signal.aborted ? "cancelled" : "completed"
      await atomicWrite(path.join(jobRoot(options.root), id + ".sv.yaml"), yaml(job.best))
      await save()
      return job
    } catch (e) {
      job.state = controller.signal.aborted ? "cancelled" : "failed"
      job.error = e instanceof Error ? e.message : String(e)
      await save()
      return job
    } finally {
      clearInterval(timer)
    }
  })
}

export async function spawnOptimization(id: string, root?: string) {
  const entry = process.argv[1]
  const dev = process.execPath === process.argv[0] && entry && /\.[cm]?[jt]s$/.test(entry)
  const args = [...(dev ? [entry] : []), "sv", "optimize", "--action", "run", "--id", id, "--state-root", jobRoot(root)]
  const logPath = jobPath(id, root).replace(/\.json$/, ".log")
  const log = await open(logPath, "a", 0o600)
  try {
    // Bun's unref alone did not survive the compiled parent's explicit process.exit.
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: { ...process.env, CLICKZETTA_DISABLE_AUTOUPDATE: "1" },
      windowsHide: true,
    })
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve)
      child.once("error", reject)
    })
    child.unref()
    return {
      id,
      state: "queued",
      worker_pid: child.pid,
      worker_log: logPath,
      objective:
        "Improve model quality and measured VQR accuracy; evaluate permitted changes without replacing the user target automatically",
    }
  } catch (e) {
    const job = await getOptimization(id, root)
    job.state = "failed"
    job.error = e instanceof Error ? e.message : String(e)
    job.updated_at = new Date().toISOString()
    await atomicWrite(jobPath(id, root), JSON.stringify(job, null, 2))
    throw e
  } finally {
    await log.close()
  }
}

async function accuracy(
  complete: Completion,
  service: SemanticService,
  model: Model,
  target: string,
  job: Optimization,
  signal: AbortSignal,
) {
  const results = []
  for (const query of job.model.verified_queries) {
    if (signal.aborted) throw new SemanticViewError("CANCELLED", "Optimization cancelled")
    try {
      // Hold out the exact example being evaluated to avoid rewarding verbatim copying.
      const candidate = {
        ...model,
        verified_queries: model.verified_queries.filter((q) => q.name !== query.name && q.question !== query.question),
      }
      const generated = await generateQuery(
        (instruction, input) => complete(instruction, input, signal),
        service,
        candidate,
        service.target(target),
        query.question,
      )
      const comparison = await compareQueries(service, query.sql, generated.sql)
      results.push({ name: query.name, sql: generated.sql, ...comparison })
    } catch (e) {
      results.push({ name: query.name, equivalent: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  const score = (100 * results.filter((r) => r.equivalent).length) / results.length
  job.evaluations?.push({ iteration: job.completed_iterations, score, results })
  return score
}

function historyContains(history: string | undefined, sql: string) {
  if (!history) return false
  if (history.includes(sql)) return true
  const visit = (value: unknown): boolean =>
    typeof value === "string"
      ? value === sql
      : Array.isArray(value)
        ? value.some(visit)
        : value !== null && typeof value === "object"
          ? Object.values(value).some(visit)
          : false
  try {
    return visit(JSON.parse(history))
  } catch {
    return false
  }
}

async function evaluateCandidate(
  complete: Completion,
  service: SemanticService,
  candidate: Model,
  job: Optimization,
  root: string | undefined,
  signal: AbortSignal,
) {
  const parts = service.target(job.target!).split(".")
  const target = [...parts.slice(0, -1), "cz_sv_opt_" + crypto.randomUUID().replaceAll("-", "")].join(".")
  try {
    await service.deploy(candidate, target, { baseline: "absent", stateRoot: path.join(jobRoot(root), "deployments") })
    return await accuracy(complete, service, candidate, target, job, signal)
  } catch (e) {
    job.evaluations?.push({ candidate_target: target, error: e instanceof Error ? e.message : String(e), score: 0 })
    return -1
  } finally {
    // The random target was allocated exclusively for this job. Never delete the user's view.
    if (await service.optionalRead(target)) await service.execute(`DROP SEMANTIC VIEW ${qualified(target)}`)
  }
}
