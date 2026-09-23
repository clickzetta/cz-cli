import path from "node:path"
import { JobStatus, analyzeSql, requestRaw } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { getExecContext, execSql, isQueryResult } from "../commands/exec.js"
import { compile, MANAGED_PROPERTY, type Binding } from "./compile.js"
import { decodeMetadata, fingerprint, semanticShape, sameSemanticDefinition, object } from "./metadata.js"
import { SemanticViewError } from "./error.js"
import { parseModel, yaml, type Model } from "./model.js"
import { identifier, literal, qualified, storedName } from "./sql.js"
import { atomicWrite, withFileLock } from "./files.js"

export type SqlResult = { columns: string[]; rows: unknown[][]; job_id?: string }
export type Executor = (
  sql: string,
  options?: { json?: boolean; onJobId?: (id: string) => void | Promise<void> },
) => Promise<SqlResult>

export async function connect(args: Partial<GlobalArgs> & { timeout?: number }) {
  if (
    args.timeout !== undefined &&
    (!Number.isFinite(args.timeout) || args.timeout <= 0 || !Number.isFinite(args.timeout * 1000))
  )
    throw new SemanticViewError("INVALID_TIMEOUT", "SQL job timeout must be a finite positive number of seconds")
  const ctx = await getExecContext(args)
  const execute: Executor = async (sql, options) => {
    const r = await execSql(ctx, sql, {
      hints: options?.json ? { "cz.sql.desc.format": "json" } : undefined,
      onJobId: options?.onJobId,
      timeoutMs: args.timeout === undefined ? undefined : args.timeout * 1000,
    })
    if (!isQueryResult(r) || r.status !== JobStatus.SUCCEEDED)
      throw new SemanticViewError(
        isQueryResult(r) ? (r.errorCode ?? "SQL_ERROR") : "SQL_ERROR",
        isQueryResult(r) ? (r.errorMessage ?? `Query did not succeed: ${r.status}`) : "Unexpected asynchronous result",
      )
    return { columns: r.columns.map((c) => c.name), rows: r.rows, job_id: r.jobId }
  }
  const inspectJob = async (id: string) => {
    const raw = await requestRaw<{ status?: { state?: string } }>(ctx.clientOpts, "/lh/getJob", {
      get_result_request: {
        account: { user_id: 0 },
        job_id: { id, workspace: ctx.config.workspace, instance_id: ctx.instanceId() },
        offset: 0,
        user_agent: "",
      },
      user_agent: "",
    })
    return raw.status?.state ?? "UNKNOWN"
  }
  return new SemanticService(
    execute,
    { workspace: ctx.config.workspace, schema: ctx.config.schema || "public" },
    `${ctx.config.service}/${ctx.config.instance}/${ctx.config.workspace}`,
    inspectJob,
  )
}

export class SemanticService {
  constructor(
    readonly execute: Executor,
    readonly binding: Binding,
    readonly identity: string,
    readonly inspectJob?: (id: string) => Promise<string>,
  ) {}

  target(input: string) {
    const parts = storedName(input)
    return (
      parts.length === 1
        ? [this.binding.workspace, this.binding.schema, ...parts]
        : parts.length === 2
          ? [this.binding.workspace, ...parts]
          : parts
    )
      .join(".")
      .toLowerCase()
  }

  async read(input: string) {
    const fqn = this.target(input)
    const r = await this.execute(`DESC SEMANTIC VIEW EXTENDED ${qualified(fqn)}`, { json: true })
    const metadata = decodeMetadata(storedName(fqn).at(-1)!, r.rows)
    const p = await this.execute(`SHOW PROPERTIES ${qualified(fqn)}`)
    const properties = Object.fromEntries(p.rows.map((r) => [String(r[0]), String(r[1])]))
    const nativeFingerprint = fingerprint(semanticShape(metadata.model))
    const envelope = properties[MANAGED_PROPERTY] ? object(JSON.parse(properties[MANAGED_PROPERTY])) : undefined
    const managedValid = envelope?.native_fingerprint === nativeFingerprint && envelope.fqn === fqn
    const model = managedValid ? parseModel(envelope.model) : metadata.model
    model.properties = Object.fromEntries(Object.entries(properties).filter(([k]) => k !== MANAGED_PROPERTY))
    return {
      fqn,
      model,
      yaml: yaml(model),
      native: metadata.model,
      raw: metadata.raw,
      native_fingerprint: nativeFingerprint,
      fingerprint: fingerprint({ definition: nativeFingerprint, properties }),
      properties,
      version: metadata.version,
      modified_at: metadata.modified_at,
      creator: metadata.creator,
      unmapped: metadata.unknown,
      managed_status: !envelope ? "absent" : managedValid ? "verified" : "stale",
      job_id: r.job_id,
    }
  }

  async optionalRead(input: string) {
    try {
      return await this.read(input)
    } catch (e) {
      if (e instanceof SemanticViewError && /table or view not found/i.test(e.message)) return undefined
      throw e
    }
  }

  async list(query = "", limit = 20) {
    const result = await this.execute(
      `SHOW SEMANTIC VIEWS IN ${qualified(`${this.binding.workspace}.${this.binding.schema}`)}`,
    )
    const candidates = result.rows.map((row) => `${this.binding.workspace}.${String(row[0])}.${String(row[1])}`)
    if (!query)
      return {
        views: candidates.slice(0, limit).map((fqn) => ({ fqn })),
        total: candidates.length,
        truncated: candidates.length > limit,
      }
    const matches = []
    for (const fqn of candidates) {
      const model = await this.read(fqn)
      if (JSON.stringify(model.model).toLowerCase().includes(query.toLowerCase()))
        matches.push({ fqn, description: model.model.description })
    }
    return { views: matches.slice(0, limit), total: matches.length, truncated: matches.length > limit }
  }

  async plan(model: Model, target: string) {
    const before = await this.optionalRead(target)
    if (before?.unmapped.length || before?.managed_status === "stale")
      throw new SemanticViewError(
        "UNSAFE_REPLACEMENT",
        "Remote metadata contains unknown fields or changed outside the managed model; download and reconcile before replacing",
        before,
      )
    const candidate = compile(model, { ...this.binding, target: this.target(target) }, Boolean(before))
    if (
      Buffer.byteLength(
        JSON.stringify({
          version: 1,
          fqn: candidate.fqn,
          native_fingerprint: fingerprint(semanticShape(candidate.native)),
          model,
        }),
      ) >
      1024 * 1024
    )
      throw new SemanticViewError(
        "MODEL_TOO_LARGE",
        "Managed authoring metadata exceeds 1 MiB; split the model before deployment",
      )
    const validation = await this.execute(`EXPLAIN ${candidate.sql}`)
    return {
      ...candidate,
      before,
      baseline: before?.fingerprint ?? null,
      validation_job_id: validation.job_id,
      changed:
        !before ||
        fingerprint(semanticShape(candidate.native)) !== before.native_fingerprint ||
        fingerprint(model) !== fingerprint(before.model),
    }
  }

  async validateQueries(model: Model) {
    const results = []
    for (const q of model.verified_queries) {
      try {
        requireReadonlyQuery(q.sql)
        const r = await this.execute(`EXPLAIN ${q.sql}`)
        results.push({ name: q.name, question: q.question, sql: q.sql, valid: true, job_id: r.job_id })
      } catch (e) {
        results.push({
          name: q.name,
          question: q.question,
          sql: q.sql,
          valid: false,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
    return { valid: results.every((r) => r.valid), queries: results }
  }

  async deploy(
    model: Model,
    target: string,
    options: { baseline?: string; validateQueries?: boolean; stateRoot?: string } = {},
  ) {
    const fqn = this.target(target)
    const root = options.stateRoot ?? path.resolve("cz_project", ".sv", "deployments")
    const lock = path.join(root, fingerprint([this.identity, fqn]))
    return withFileLock(lock, async () => {
      const plan = await this.plan(model, fqn)
      if (options.baseline && options.baseline !== (plan.baseline ?? "absent"))
        throw new SemanticViewError("CONFLICT", "Remote model changed since the provided baseline")
      const id = crypto.randomUUID()
      const file = path.join(root, `${id}.json`)
      const journal = {
        id,
        fqn,
        identity: this.identity,
        started_at: new Date().toISOString(),
        state: "prepared",
        expected_native_fingerprint: fingerprint(semanticShape(plan.native)),
        sql: plan.sql,
        model,
        before: plan.before,
        job_id: "",
        properties: { ...plan.before?.properties, ...model.properties } as Record<string, string>,
        error: "",
      }
      delete journal.properties[MANAGED_PROPERTY]
      const save = () => atomicWrite(file, JSON.stringify(journal, null, 2))
      await save()
      const current = await this.optionalRead(fqn)
      if ((current?.fingerprint ?? null) !== plan.baseline)
        throw new SemanticViewError("CONFLICT", "Remote definition changed while preparing deployment")
      try {
        journal.state = "submitting"
        await save()
        const r = await this.execute(plan.sql, {
          onJobId: async (id) => {
            journal.job_id = id
            await save()
          },
        })
        journal.job_id = r.job_id ?? journal.job_id
        journal.state = "created"
        await save()
        // Restore user properties before further validation, including when verification fails.
        await this.setProperties(fqn, journal.properties)
        const actual = await this.read(fqn)
        const expected = fingerprint(semanticShape(plan.native))
        if (actual.native_fingerprint !== expected && !sameSemanticDefinition(plan.native, actual.native))
          throw new SemanticViewError(
            "READBACK_MISMATCH",
            "Persisted semantic definition differs from the compiled model",
            { expected: semanticShape(plan.native), actual: semanticShape(actual.native) },
          )
        const queries = options.validateQueries === false ? undefined : await this.validateQueries(model)
        if (queries && !queries.valid)
          throw new SemanticViewError(
            "QUERY_VALIDATION_FAILED",
            "Definition was created, but one or more verified queries failed compilation",
            queries,
          )
        const envelope = JSON.stringify({ version: 1, fqn, native_fingerprint: actual.native_fingerprint, model })
        if (Buffer.byteLength(envelope) > 1024 * 1024)
          throw new SemanticViewError("MODEL_TOO_LARGE", "Managed authoring metadata exceeds 1 MiB")
        await this.setProperties(fqn, { [MANAGED_PROPERTY]: envelope })
        const after = await this.read(fqn)
        if (
          after.managed_status !== "verified" ||
          Object.entries(journal.properties).some(([k, v]) => after.properties[k] !== v)
        )
          throw new SemanticViewError("READBACK_MISMATCH", "Properties or authoring metadata did not round trip")
        journal.state = "deployed"
        await save()
        return {
          status: "deployed",
          fqn,
          id,
          recovery_file: file,
          fingerprint: after.fingerprint,
          job_id: journal.job_id,
          queries,
          managed: plan.managed,
        }
      } catch (e) {
        journal.state = journal.state === "created" ? "partial" : "uncertain"
        journal.error = e instanceof Error ? e.message : String(e)
        await save()
        throw new SemanticViewError("DEPLOYMENT_INCOMPLETE", journal.error, {
          status: journal.state,
          fqn,
          job_id: journal.job_id,
          recovery_file: file,
          cause: e instanceof SemanticViewError ? { code: e.code, details: e.details } : undefined,
        })
      }
    })
  }

  async setProperties(fqn: string, properties: Record<string, string>) {
    if (!Object.keys(properties).length) return
    await this.execute(
      `ALTER SEMANTIC VIEW ${qualified(fqn)} SET TBLPROPERTIES (${Object.entries(properties)
        .map(([k, v]) => `${literal(k)}=${literal(v)}`)
        .join(",")})`,
    )
  }

  async recover(file: string) {
    const journal = object(await Bun.file(file).json())
    if (journal.identity !== this.identity || typeof journal.fqn !== "string")
      throw new SemanticViewError("WRONG_TARGET", "Recovery journal belongs to a different connection")
    if (journal.state === "uncertain" || journal.state === "submitting") {
      const state =
        this.inspectJob && typeof journal.job_id === "string" && journal.job_id
          ? await this.inspectJob(journal.job_id)
          : "UNKNOWN"
      if (!["SUCCEED", "FAILED", "CANCELLED"].includes(state))
        throw new SemanticViewError(
          "JOB_RECONCILIATION_REQUIRED",
          "Original job has not reached a confirmed terminal state",
          { job_id: journal.job_id, state },
        )
      if (state !== "SUCCEED")
        throw new SemanticViewError(
          "ORIGINAL_JOB_FAILED",
          "The original job did not succeed; prepare a fresh deployment from the recorded model",
          { state },
        )
    }
    const fqn = journal.fqn
    const root = path.dirname(path.resolve(file))
    return withFileLock(path.join(root, fingerprint([this.identity, fqn])), async () => {
      const current = await this.read(fqn)
      const model = parseModel(journal.model)
      const native = compile(model, { ...this.binding, target: fqn }, Boolean(journal.before)).native
      // Old journals recorded the pre-server expression spelling. Confirm that
      // exact expected definition first, then tolerate only the same arithmetic tree.
      if (
        current.native_fingerprint !== journal.expected_native_fingerprint &&
        !(
          fingerprint(semanticShape(native)) === journal.expected_native_fingerprint &&
          sameSemanticDefinition(native, current.native)
        )
      )
        throw new SemanticViewError(
          "CONFLICT",
          "The current native definition does not match the recorded deployment; recovery will not overwrite external changes",
        )
      const properties = Object.fromEntries(Object.entries(object(journal.properties)).map(([k, v]) => [k, String(v)]))
      delete properties[MANAGED_PROPERTY]
      if (Object.entries(current.properties).some(([k, v]) => k !== MANAGED_PROPERTY && properties[k] !== v))
        throw new SemanticViewError("CONFLICT", "Properties changed after the interrupted deployment")
      const queries = await this.validateQueries(model)
      if (!queries.valid)
        throw new SemanticViewError(
          "QUERY_VALIDATION_FAILED",
          "Recorded verified queries do not compile; reconcile the model before recovery",
          queries,
        )
      await this.setProperties(fqn, {
        ...properties,
        [MANAGED_PROPERTY]: JSON.stringify({ version: 1, fqn, native_fingerprint: current.native_fingerprint, model }),
      })
      const after = await this.read(fqn)
      if (after.managed_status !== "verified" || Object.entries(properties).some(([k, v]) => after.properties[k] !== v))
        throw new SemanticViewError("READBACK_MISMATCH", "Recovery properties did not round trip")
      journal.state = "deployed"
      journal.recovered_at = new Date().toISOString()
      await atomicWrite(file, JSON.stringify(journal, null, 2))
      return { status: "deployed", recovered: true, fqn, recovery_file: file, fingerprint: after.fingerprint, queries }
    })
  }
}

export function requireReadonlyQuery(sql: string) {
  const check = analyzeSql(sql)
  if (check.kind !== "readonly" || check.statements.length !== 1 || !/^\s*(SELECT|WITH)\b/i.test(sql))
    throw new SemanticViewError("READONLY_QUERY_REQUIRED", "Expected exactly one readonly SELECT query")
}
