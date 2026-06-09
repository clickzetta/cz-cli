/**
 * SqlSession — stateful SQL execution layer aligned with
 * `clickzetta-connector-python`'s `Client` class.
 *
 * Python references (clickzetta/connector/v0/):
 *   - client.py:494-502   set_config            → setConfigFromSql
 *   - client.py:504-508   get_configs / get_config → getConfigs / getConfig
 *   - client.py:510-519   pre_process_sql        → preProcessSql
 *   - client.py:535-560   process_use_cmd        → processUseCmd
 *   - client.py:562-567   get_real_schema        → getRealSchema
 *   - client.py:569-676   submit_sql_job         → execute
 *   - enums.py:124-163    CZConnectContext       → session state (workspace/schema/vcluster/configs)
 *   - enums.py:166-178    ClientContextInfo      → clientContext payload in submit body
 *   - utils.py:212-227    strip_leading_comment  → stripLeadingComment
 */

import { getToken } from "../auth/token.js"
import type { ClientOptions } from "../client.js"
import { toServiceUrl } from "../config/region.js"
import { InterfaceError, ProgrammingError } from "../types/errors.js"
import type { ConnectionConfig } from "../types/index.js"
import { splitSql } from "./split.js"
import { submitJob } from "./submit.js"
import { parseJobResponse, pollJobResult } from "./poll.js"
import { isRetryableErrorCode } from "./errors.js"
import {
  type JobID,
  JobStatus,
  type QueryResult,
  newJobId,
} from "./types.js"
import { isVolumeSql, processVolumeSql } from "./volume.js"

/**
 * Mirrors `client.py:69` `DEFAULT_MAXIMUM_TIMEOUT = 60` — the upper bound
 * applied to `hybridPollingTimeout` when the caller is not asynchronous.
 */
export const DEFAULT_MAXIMUM_TIMEOUT = 60

/**
 * Initial polling timeout used by `submit_sql_job` before the hints
 * dispatch loop potentially overrides it (client.py:598).
 */
const INITIAL_POLLING_TIMEOUT = 30

/**
 * `client.py:125` `self.max_retries = 120` — mirrored here as the default
 * cap for `sdk.query.max.retries`. We expose it via the session so tests
 * can assert dispatch logic without a real client.
 */
const DEFAULT_MAX_RETRIES = 120

/** enums.py:134-139 — default configs populated on a fresh CZConnectContext. */
const DEFAULT_CONFIGS: Readonly<Record<string, string>> = Object.freeze({
  "cz.sql.adhoc.result.type": "embedded",
  // enums.py:136 — Python connector default is ARROW. Keeping ARROW here
  // means Lakehouse will return Arrow IPC streams; the SDK's result
  // decoder must handle that format (see poll.ts).
  "cz.sql.adhoc.default.format": "ARROW",
  "cz.sql.job.result.file.presigned.url.enabled": "true",
  "cz.sql.job.result.file.presigned.url.ttl": "3600",
})

/** Mirrors utils.py:212-227 exactly. */
export function stripLeadingComment(input: string): string {
  let ret = input.trim()
  while (ret.startsWith("--") || ret.startsWith("/*")) {
    if (ret.startsWith("--")) {
      const index = ret.indexOf("\n")
      if (index === -1) {
        return ""
      }
      ret = ret.slice(index + 1).trim()
    } else {
      const index = ret.indexOf("*/")
      if (index === -1) {
        return ""
      }
      ret = ret.slice(index + 2).trim()
    }
  }
  return ret
}

/** Mirrors `re.sub(r"\s+", " ", sql)` used inside process_use_cmd. */
export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ")
}

/** Mirrors client.py:562-567 `get_real_schema`. */
export function getRealSchema(schema: string): string {
  const parts = schema.split(".")
  let out = parts[parts.length - 1] ?? ""
  if (out.startsWith("`") && out.endsWith("`") && out.length >= 2) {
    out = out.slice(1, -1)
  }
  return out
}

/** Parameters for `SqlSession.execute`. */
export interface SqlSessionExecuteOptions {
  /**
   * Per-call `%(key)s` substitution values and optional inline hints.
   * Mirrors the Python `parameters` argument of `submit_sql_job`
   * (client.py:574, 605-610).
   */
  params?: Record<string, unknown> & { hints?: Record<string, string> }
  /** Submit asynchronously; server-side polling is disabled. */
  asynchronous?: boolean
  /** Override the session schema for a single call (client.py:649-650). */
  schema?: string
}

export interface SqlSessionOptions {
  /** Session-wide hints merged as the second layer (client.py:604). */
  hints?: Record<string, string>
  /**
   * Extra HTTP headers forwarded on every submit/poll. When omitted, we
   * fall back to `config.customHeaders` inside `toClientOptions`.
   */
  clientHeaders?: Record<string, string>
}

/**
 * Resolved submit parameters returned by `prepareSubmit`. Mirrors the
 * state that Python's `submit_sql_job` packs into `JobDesc` + `SQLJob`
 * just before the HTTP call.
 */
export interface PreparedSubmit {
  sql: string
  workspace: string
  schema: string
  vcluster: string
  asynchronous: boolean
  pollingTimeout: number
  priority: number
  /** Resolved `sdk.query.max.retries`; surfaced for symmetry with Python. */
  maxRetry: number
  jobTimeoutMs: number
  sqlConfigHint: Record<string, string>
  configStatements: string[]
  contextJson: Record<string, unknown>
}

/**
 * Stateful SQL session. Each session tracks its own workspace / schema /
 * vcluster, accumulates SET/USE statements into `configStatements`, and
 * maintains the `configs` dict that ultimately becomes the submit body's
 * `sqlJob.sqlConfig.hint` + `clientContext.contextJson.configs`.
 *
 * This type mirrors the subset of `clickzetta.connector.v0.client.Client`
 * required to drive `submit_sql_job` end-to-end.
 */
export class SqlSession {
  workspace: string
  schema: string
  vcluster: string

  /** SET/USE statements captured in submission order (client.py:201). */
  readonly configStatements: string[] = []
  /** CZConnectContext.configs (enums.py:140). */
  readonly configs: Record<string, string>
  /** Per-session hints merged after configs (client.py:604). */
  readonly hints: Record<string, string>
  /** Written when `cz.sql.timezone` hint appears (client.py:626). */
  timezoneHint?: string
  /** enums.py:132 maxRowSize; mirrored to cz.sql.result.row.partial.limit. */
  maxRowSize = 0

  readonly config: ConnectionConfig
  readonly clientHeaders?: Record<string, string>
  /** connection.py:62 _closed — set by close(), checked before execute(). */
  private _closed = false

  constructor(config: ConnectionConfig, options: SqlSessionOptions = {}) {
    this.config = config
    this.workspace = config.workspace
    this.schema = config.schema
    this.vcluster = config.vcluster
    this.configs = { ...DEFAULT_CONFIGS }
    this.hints = { ...(options.hints ?? {}) }
    this.clientHeaders = options.clientHeaders
  }

  /**
   * connection.py:61-62 close() — mark session as closed.
   * Subsequent execute() calls will throw ProgrammingError.
   */
  close(): void {
    this._closed = true
  }

  /** Returns true if close() has been called. */
  get isClosed(): boolean {
    return this._closed
  }

  // ---------------------------------------------------------------------
  // Config helpers (client.py:494-508, enums.py:162-163)
  // ---------------------------------------------------------------------

  /** enums.py:162-163 `CZConnectContext.set_config`. */
  setConfig(key: string, value: string): void {
    this.configs[key] = value
  }

  /** client.py:504-505 `get_configs`. */
  getConfigs(): Record<string, string> {
    return this.configs
  }

  /** client.py:507-508 `get_config`. */
  getConfig(key: string): string | undefined {
    return this.configs[key]
  }

  /** client.py:494-502 `set_config(sql)`. */
  setConfigFromSql(sql: string): boolean {
    // Python slice is `sql[len("set "):]` — we must preserve exact
    // semantics: the caller has already lowercased the prefix check,
    // so we can drop the leading 4 chars (length of "set ").
    const setStatement = sql.slice("set ".length)
    const eqIdx = setStatement.indexOf("=")
    if (eqIdx === -1) {
      throw new InterfaceError(`Invalid statement ${sql}`)
    }
    const key = setStatement.slice(0, eqIdx).trim()
    const value = setStatement.slice(eqIdx + 1).trim()
    if (!key || !value) {
      throw new InterfaceError(`Invalid statement ${sql}`)
    }
    this.setConfig(key, value)
    return true
  }

  // ---------------------------------------------------------------------
  // SET/USE pre-processing (client.py:510-519, 535-560)
  // ---------------------------------------------------------------------

  /** client.py:510-519 `pre_process_sql`. */
  preProcessSql(sql: string): string | null {
    const multiQueries = splitSql(sql)
    for (let i = 0; i < multiQueries.length; i++) {
      const query = multiQueries[i].trim()
      if (!query) continue
      if (!this.processUseCmd(query)) {
        // Python returns `multi_queries[i] + "\n;"` — keep trailing
        // newline-semicolon so the server sees a terminated statement.
        return multiQueries[i] + "\n;"
      }
    }
    return null
  }

  /** client.py:535-560 `process_use_cmd`. */
  processUseCmd(originSql: string): boolean {
    const stripped = stripLeadingComment(originSql)
    const sql = normalizeWhitespace(stripped)
    const lowerSql = sql.toLowerCase()

    if (lowerSql.startsWith("use ")) {
      this.configStatements.push(sql)
      if (lowerSql.startsWith("use vcluster ")) {
        const vc = sql.slice("use vcluster ".length).trim().replace(/;+$/, "")
        if (vc.includes(" ")) {
          throw new InterfaceError("invalid vcluster: " + vc)
        }
        this.vcluster = vc
      } else if (lowerSql.startsWith("use workspace ")) {
        const ws = sql.slice("use workspace ".length).trim().replace(/;+$/, "")
        if (ws.includes(" ")) {
          throw new InterfaceError("invalid workspace: " + ws)
        }
        this.workspace = ws
      } else if (
        lowerSql.startsWith("use schema ") ||
        lowerSql.startsWith("use ")
      ) {
        // Mirrors client.py:552-554 — choose the correct prefix length.
        const prefix = lowerSql.startsWith("use schema ") ? "use schema " : "use "
        const raw = sql.slice(prefix.length).trim().replace(/;+$/, "")
        // Python calls self.check_schema(...) to hit DESC SCHEMA; we
        // skip that here (session is a pure client-side layer) and
        // only normalise the identifier. Noted in commit divergences.
        this.schema = getRealSchema(raw)
      }
      return true
    }

    if (lowerSql.startsWith("set ")) {
      this.configStatements.push(sql)
      // client.py:557 — set_config is called with the normalised `sql`.
      this.setConfigFromSql(sql)
      return true
    }

    return false
  }

  // ---------------------------------------------------------------------
  // Submit (client.py:569-679)
  // ---------------------------------------------------------------------

  /**
   * Pure, side-effectful-on-session preparation that mirrors
   * client.py:578-660. Separated from `execute` so unit tests can
   * exercise hints dispatch, pyformat substitution, and polling clamp
   * without hitting the network.
   *
   * The method mutates this session (configs/timezoneHint/maxRowSize)
   * and returns the resolved submit-body fields.
   */
  prepareSubmit(
    sql: string,
    options: SqlSessionExecuteOptions = {},
  ): PreparedSubmit | null {
    const { params, asynchronous = false, schema: overrideSchema } = options

    // client.py:578
    let processed = this.preProcessSql(sql)
    // client.py:579-588
    if (!processed) return null

    // client.py:589-602 — defaults.
    let pollingTimeout = INITIAL_POLLING_TIMEOUT
    let sdkJobPriority = 0
    let maxRetry = DEFAULT_MAX_RETRIES
    let sdkJobTimeoutSec = 0
    let sdkJobDefaultNs: string | undefined = undefined

    // client.py:603-610 — three-layer hints merge + pyformat substitution.
    // Python's `hints = self.get_configs()` returns a *reference* to the
    // configs dict, so `hints.update(self.hints)` and the parameter hints
    // update mutate `connect_context.configs` in place. We mirror that
    // here by writing session+call hints into `this.configs` before the
    // dispatch loop runs.
    for (const k of Object.keys(this.hints)) {
      this.configs[k] = this.hints[k]
    }
    if (params && params.hints) {
      for (const k of Object.keys(params.hints)) {
        this.configs[k] = params.hints[k]
      }
    }
    const hints: Record<string, string> = this.configs
    if (params && Object.keys(params).length > 0) {
      for (const key of Object.keys(params)) {
        if (key === "hints") continue
        const marker = "%(" + key + ")s"
        if (processed.includes(marker)) {
          processed = processed.split(marker).join(String(params[key]))
        }
      }
    }

    // client.py:611-635 — hints dispatch. Snapshot keys first because
    // the `maxRowSize` branch mutates the configs dict (same identity
    // as `hints`) by adding `cz.sql.result.row.partial.limit`, and we
    // must not observe that new key as a hint.
    for (const key of Object.keys(hints)) {
      const value = hints[key]
      if (key === "sdk.job.polling.timeout") {
        pollingTimeout = Number.parseInt(value, 10)
      } else if (
        key === "sdk.job.priority" ||
        key === "schedule_job_queue_priority" ||
        key === "priority"
      ) {
        sdkJobPriority = Number.parseInt(value, 10)
      } else if (key === "sdk.query.timeout.ms" || key === "querytimeout") {
        sdkJobTimeoutSec = Number.parseInt(value, 10) / 1000
      } else if (key === "sdk.job.timeout") {
        sdkJobTimeoutSec = Number.parseInt(value, 10)
      } else if (key === "sdk.query.max.retries") {
        const parsed = Number.parseInt(value, 10)
        maxRetry = parsed <= 0 ? DEFAULT_MAX_RETRIES : parsed
      } else if (key === "cz.sql.timezone") {
        this.timezoneHint = value
        this.setConfig(key, value)
      } else if (key === "sdk.job.default.ns") {
        sdkJobDefaultNs = value
      } else if (key === "maxRowSize") {
        this.maxRowSize = Number.parseInt(value, 10)
        this.configs["cz.sql.result.row.partial.limit"] = String(this.maxRowSize)
      } else {
        this.setConfig(key, value)
      }
    }

    // client.py:641-644 — polling_timeout clamp.
    if (asynchronous) {
      pollingTimeout = 0
    }
    if (
      !asynchronous &&
      (pollingTimeout < 0 || pollingTimeout > DEFAULT_MAXIMUM_TIMEOUT)
    ) {
      pollingTimeout = DEFAULT_MAXIMUM_TIMEOUT
    }

    // client.py:647-657
    let submitWorkspace = this.workspace
    let submitSchema = this.schema ?? ""
    if (overrideSchema !== undefined) submitSchema = overrideSchema
    if (sdkJobDefaultNs && sdkJobDefaultNs.split(".").length === 2) {
      const [ns0, ns1] = sdkJobDefaultNs.split(".")
      submitWorkspace = ns0
      submitSchema = ns1
    }

    // client.py:658-660 — jobTimeoutMs overflow guard.
    const MAX_VALUE = Number.MAX_SAFE_INTEGER
    let jobTimeoutMs: number
    if (sdkJobTimeoutSec >= MAX_VALUE || sdkJobTimeoutSec * 1000 >= MAX_VALUE) {
      jobTimeoutMs = MAX_VALUE
    } else {
      jobTimeoutMs = sdkJobTimeoutSec * 1000
    }

    return {
      sql: processed,
      workspace: submitWorkspace,
      schema: submitSchema,
      vcluster: this.vcluster,
      asynchronous,
      pollingTimeout,
      priority: sdkJobPriority,
      maxRetry,
      jobTimeoutMs,
      sqlConfigHint: { ...this.configs },
      configStatements: [...this.configStatements],
      contextJson: this.buildContextJson(),
    }
  }

  /**
   * Execute a SQL string, handling SET/USE pre-processing, hint merging,
   * `%(key)s` parameter substitution, polling-timeout clamping, and
   * submit/poll.
   */
  async execute(
    sql: string,
    options: SqlSessionExecuteOptions = {},
  ): Promise<QueryResult> {
    // _dbapi_helpers.py:6-15 raise_on_closed — guard against use after close.
    if (this._closed) {
      throw new ProgrammingError("Cannot execute on a closed session")
    }
    // cursor.py:172-177 — null/empty SQL guard.
    if (sql == null) {
      throw new ProgrammingError("sql is empty")
    }
    const stripped = sql.trim()
    if (stripped === "") {
      throw new ProgrammingError("sql is empty")
    }
    // cursor.py:180 — ensure trailing ';' so the server parses the final statement.
    const normalizedSql = stripped.endsWith(";") ? stripped : stripped + ";"

    const prepared = this.prepareSubmit(normalizedSql, options)
    if (!prepared) return this.emptyResult()

    const jobId = await this.newJobId()
    const clientOpts = await this.toClientOptions()
    const submitResp = await submitJob(clientOpts, {
      sql: prepared.sql,
      workspace: prepared.workspace,
      schema: prepared.schema,
      vcluster: prepared.vcluster,
      instanceName: this.config.instance,
      instanceId: jobId.instanceId,
      jobId,
      hints: prepared.sqlConfigHint,
      asynchronous: prepared.asynchronous,
      jobTimeoutMs: prepared.jobTimeoutMs,
      pollingTimeout: prepared.pollingTimeout,
      priority: prepared.priority,
      configStatements: prepared.configStatements,
      contextJson: prepared.contextJson,
    })

    if (prepared.asynchronous) {
      return {
        jobId: jobId.id,
        status: JobStatus.SUBMITTED,
        columns: [],
        rows: [],
        rowCount: 0,
      }
    }

    // HYBRID may return terminal result directly (mirrors cz-cli exec.ts).
    const raw = submitResp as { status?: { state?: string } }
    if (
      raw?.status?.state &&
      ["SUCCEED", "FAILED", "CANCELLED"].includes(raw.status.state)
    ) {
      if (
        raw.status.state === "FAILED" &&
        isRetryableErrorCode(
          (raw as { status?: { errorCode?: string } }).status?.errorCode,
        )
      ) {
        const result = await pollJobResult(clientOpts, jobId, {
          jobTimeoutMs: prepared.jobTimeoutMs > 0 ? prepared.jobTimeoutMs : undefined,
          timezone: this.timezoneHint,
          maxRetries: prepared.maxRetry > 0 ? prepared.maxRetry : undefined,
          resubmitFn: () => this.execute(sql, options),
        })
        if (isVolumeSql(sql)) {
          return processVolumeSql(
            {
              clientOpts,
              workspace: prepared.workspace,
              instanceId: jobId.instanceId,
            },
            jobId,
            result,
            sql,
          )
        }
        return result
      }
      return parseJobResponse(
        submitResp as Parameters<typeof parseJobResponse>[0],
        jobId,
        this.timezoneHint,
      )
    }
    const result = await pollJobResult(clientOpts, jobId, {
      jobTimeoutMs: prepared.jobTimeoutMs > 0 ? prepared.jobTimeoutMs : undefined,
      timezone: this.timezoneHint,
      maxRetries: prepared.maxRetry > 0 ? prepared.maxRetry : undefined,
      resubmitFn: () => this.execute(sql, options),
    })

    // Volume SQL post-processing — client.py:1340-1344 + process_volume_sql
    if (isVolumeSql(sql)) {
      return processVolumeSql(
        {
          clientOpts,
          workspace: prepared.workspace,
          instanceId: jobId.instanceId,
        },
        jobId,
        result,
        sql,
      )
    }

    return result
  }

  // ---------------------------------------------------------------------
  // Metadata helpers (client.py:1357-1410)
  // ---------------------------------------------------------------------

  /** client.py:1357 — SHOW TABLES in the given (or current) schema. */
  async getTableNames(schema?: string): Promise<string[]> {
    const s = schema ?? this.schema
    const result = await this.execute(`SHOW TABLES IN ${s}`)
    return result.rows.map((row) => String(Object.values(row)[1]))
  }

  /** client.py:1369 — SHOW SCHEMAS in the current workspace. */
  async getSchemas(): Promise<string[]> {
    const result = await this.execute("SHOW SCHEMAS")
    return result.rows.map((row) => String(Object.values(row)[0]))
  }

  /** client.py:1381 — return column metadata for a table. */
  async getColumns(tableName: string): Promise<QueryResult["columns"]> {
    const result = await this.execute(`SELECT * FROM ${tableName} LIMIT 0`)
    return result.columns
  }

  /** client.py:1395 — check if a table exists. */
  async hasTable(tableName: string): Promise<boolean> {
    try {
      const result = await this.execute(`SHOW CREATE TABLE ${tableName}`)
      return result.status !== JobStatus.FAILED
    } catch {
      return false
    }
  }

  /** client.py:521 — check if a schema exists. */
  async checkSchema(schemaName: string): Promise<boolean> {
    try {
      await this.execute(`DESC SCHEMA ${schemaName}`)
      return true
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private emptyResult(): QueryResult {
    return {
      jobId: "",
      status: JobStatus.SUCCEEDED,
      columns: [],
      rows: [],
      rowCount: 0,
    }
  }

  /** Serialise the CZConnectContext payload (enums.py:143-154). */
  private buildContextJson(): Record<string, unknown> {
    return {
      host: null,
      instance: this.config.instance,
      user: this.config.username || null,
      workspace: this.workspace,
      schema: this.schema,
      vc: this.vcluster,
      maxRowSize: this.maxRowSize,
      priority: "",
      configs: { ...this.configs },
    }
  }

  /** Resolve JobID using cached auth token, matching cz-cli exec.ts. */
  private async newJobId(): Promise<JobID> {
    const token = await getToken(this.config)
    return newJobId(this.workspace, token.instanceId)
  }

  private async toClientOptions(): Promise<ClientOptions> {
    const token = await getToken(this.config)
    return {
      baseUrl: toServiceUrl(this.config.service, this.config.protocol),
      token: token.token,
      customHeaders: this.clientHeaders ?? this.config.customHeaders,
      config: this.config,
    }
  }
}

/**
 * connection.py:256-261 connect() — top-level factory that mirrors the
 * Python `clickzetta.connect(**kwargs)` entry point.
 *
 * Creates a SqlSession from a ConnectionConfig (or a clickzetta:// URL
 * string) and returns it ready for use.
 */
export function connect(
  configOrUrl: ConnectionConfig | string,
  options?: SqlSessionOptions,
): SqlSession {
  if (typeof configOrUrl === "string") {
    const { connectionConfigFromUrl } = require("../config/parseUrl.js") as typeof import("../config/parseUrl.js")
    return new SqlSession(connectionConfigFromUrl(configOrUrl), options)
  }
  return new SqlSession(configOrUrl, options)
}
