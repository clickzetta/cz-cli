/**
 * Connection class ported from clickzetta/connector/v0/connection.py.
 * DB-API style connection for ClickZetta Lakehouse.
 */

import { Cursor } from "./cursor.js"
import { Converter, quote } from "./converter.js"
import type { QueryResult } from "./types.js"
import { newJobId } from "./types.js"

export interface ConnectOptions {
  username: string
  password: string
  service: string
  instance: string
  workspace: string
  schema: string
  vcluster: string
  /** Optional HTTP pool size */
  httpPoolSize?: number
}

/**
 * Connection wraps a ClickZetta client session.
 * Provides cursor creation, parameter processing, and SQL submission.
 */
export class Connection {
  private _closed = false
  private _cursors: Set<Cursor> = new Set()
  private _converter = new Converter()
  private _options: ConnectOptions
  private _submitFn: ((sql: string, jobId: string, params?: Record<string, unknown>, async_?: boolean) => Promise<QueryResult | null>) | null = null

  constructor(options: ConnectOptions) {
    this._options = options
  }

  /** Set the internal submit function (injected by the session layer). */
  setSubmitFn(fn: (sql: string, jobId: string, params?: Record<string, unknown>, async_?: boolean) => Promise<QueryResult | null>): void {
    this._submitFn = fn
  }

  get isClosed(): boolean {
    return this._closed
  }

  close(): void {
    this._closed = true
    for (const cursor of this._cursors) {
      if (!cursor.isClosed) cursor.close()
    }
    this._cursors.clear()
  }

  /** No-op for DB-API compatibility. */
  commit(): void {}

  /** Create a new cursor. */
  cursor(): Cursor {
    this._ensureOpen()
    const c = new Cursor(this)
    this._cursors.add(c)
    return c
  }

  /** Format a new job ID. */
  formatJobId(): string {
    return newJobId(this._options.workspace, 100).id
  }

  /** Submit SQL for execution (delegates to session layer). */
  async submitSql(
    sql: string,
    jobId: string,
    parameters?: Record<string, unknown>,
    asynchronous?: boolean,
  ): Promise<QueryResult | null> {
    this._ensureOpen()
    if (!this._submitFn) throw new Error("Connection not initialized: no submit function set")
    return this._submitFn(sql, jobId, parameters, asynchronous)
  }

  /**
   * Process qmark-style binding parameters.
   * Converts each param to its SQL-quoted form.
   */
  processParamsQmarks(params: unknown[] | Record<string, unknown> | null | undefined): string[] {
    if (!params) return []
    if (Array.isArray(params)) {
      return params.map(p => this._processSingleParam(p))
    }
    return Object.values(params).map(v => this._processSingleParam(v))
  }

  /**
   * Replace ? placeholders in SQL with processed params.
   */
  getFullSqlWithParams(command: string, params: string[]): string {
    if (!params.length) return command
    const parts = command.split("?")
    const result: string[] = [parts[0]]
    for (let i = 0; i < params.length; i++) {
      result.push(params[i])
      if (i + 1 < parts.length) result.push(parts[i + 1])
    }
    return result.join("")
  }

  get workspace(): string { return this._options.workspace }
  get schema(): string { return this._options.schema }
  get vcluster(): string { return this._options.vcluster }
  get instance(): string { return this._options.instance }
  get service(): string { return this._options.service }

  useSchema(schema: string): void { this._options.schema = schema }
  useWorkspace(workspace: string): void { this._options.workspace = workspace }
  useVcluster(vcluster: string): void { this._options.vcluster = vcluster }
  useHttp(): void { /* protocol switch placeholder */ }

  /** Get job result by ID (for async polling). */
  async getJobResult(jobId: string): Promise<QueryResult | null> {
    this._ensureOpen()
    if (!this._submitFn) throw new Error("Connection not initialized: no submit function set")
    // Delegate to session layer — the submit function handles job result retrieval
    return null
  }

  /** Cancel a running job. */
  async cancelJob(_jobId: string): Promise<void> {
    this._ensureOpen()
    // Placeholder — actual cancellation delegated to session layer
  }

  /** Get job profile. */
  async getJobProfile(_jobId: string): Promise<unknown> {
    this._ensureOpen()
    return null
  }

  /** Get job progress. */
  async getJobProgress(_jobId: string): Promise<unknown> {
    this._ensureOpen()
    return null
  }

  /** Get job summary. */
  async getJobSummary(_jobId: string): Promise<unknown> {
    this._ensureOpen()
    return null
  }

  /** Get job plan. */
  async getJobPlan(_jobId: string): Promise<unknown> {
    this._ensureOpen()
    return null
  }

  private _processSingleParam(param: unknown): string {
    return quote(this._converter.convertTo(param))
  }

  private _ensureOpen(): void {
    if (this._closed) throw new Error("Operating on a closed connection.")
  }
}

/**
 * Create a new Connection (mirrors Python's `connect(**kwargs)`).
 */
export function connect(options: ConnectOptions): Connection {
  return new Connection(options)
}
