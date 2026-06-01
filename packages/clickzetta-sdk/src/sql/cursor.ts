/**
 * Cursor class ported from clickzetta/connector/v0/cursor.py.
 * DB-API style cursor for executing SQL and fetching results.
 */

import type { Connection } from "./connection.js"
import type { ColumnSchema, QueryResult } from "./types.js"
import { ProgrammingError } from "../types/errors.js"

const COMMENT_SQL_RE = /^(\s*\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/)?((\s)*--.*?\n)*/i
const SQL_VALUES_RE = /.*VALUES\s*(\(.*\)).*/ims

export interface ColumnDescription {
  name: string
  type: string
  displaySize?: number
  internalSize?: number
  precision?: number
  scale?: number
  nullable?: boolean
}

export class Cursor {
  private _connection: Connection
  private _queryResult: QueryResult | null = null
  private _closed = false
  private _rowIndex = 0
  jobId: string | null = null
  arraysize = 100

  constructor(connection: Connection) {
    this._connection = connection
  }

  get connection(): Connection {
    return this._connection
  }

  close(): void {
    this._closed = true
  }

  get isClosed(): boolean {
    return this._closed
  }

  get rowcount(): number {
    return this._queryResult ? this._queryResult.rowCount : -1
  }

  get description(): ColumnDescription[] | null {
    if (!this._queryResult?.columns) return null
    return this._queryResult.columns.map(col => ({
      name: col.name,
      type: col.type,
      nullable: col.nullable ?? true,
    }))
  }

  /**
   * Execute a SQL statement.
   */
  async execute(operation: string, parameters?: Record<string, unknown>, bindingParams?: unknown[]): Promise<void> {
    await this._execute(operation, parameters, false, bindingParams)
  }

  /**
   * Execute a SQL statement asynchronously (returns job ID immediately).
   */
  async executeAsync(operation: string, parameters?: Record<string, unknown>, bindingParams?: unknown[]): Promise<string> {
    await this._execute(operation, parameters, true, bindingParams)
    return this.jobId!
  }

  /**
   * Execute with a specific job ID.
   */
  async executeWithJobId(
    operation: string,
    jobId?: string,
    parameters?: Record<string, unknown>,
    asynchronous = false,
    bindingParams?: unknown[],
  ): Promise<void> {
    await this._execute(operation, parameters, asynchronous, bindingParams, jobId)
  }

  /**
   * Execute batch insert using qmark style.
   */
  async executemany(operation: string, seqParams?: unknown[][] | null, parameters?: Record<string, unknown>): Promise<void> {
    if (!seqParams || seqParams.length === 0) {
      await this.execute(operation, parameters)
      return
    }

    const operationWoComments = operation.replace(COMMENT_SQL_RE, "")
    const m = SQL_VALUES_RE.exec(operationWoComments)
    if (!m) throw new Error("Failed to rewrite multi-row insert")
    const fmt = m[1]

    const batchSize = 1024
    for (let i = 0; i < seqParams.length; i += batchSize) {
      const batch = seqParams.slice(i, i + batchSize)
      const batchValues: string[] = []
      for (const param of batch) {
        const processed = this._connection.processParamsQmarks(param)
        let count = -1
        const formatted = fmt.replace(/\?/g, () => {
          count++
          return String(processed[count])
        })
        batchValues.push(formatted)
      }
      const fullSql = operation.replace(fmt, batchValues.join(","))
      await this.execute(fullSql, parameters)
    }
  }

  /**
   * Fetch one row from the result set.
   */
  fetchone(): unknown[] | null {
    if (!this._queryResult) throw new ProgrammingError("No result")
    if (this._rowIndex >= this._queryResult.rows.length) return null
    return this._queryResult.rows[this._rowIndex++] as unknown[]
  }

  /**
   * Fetch multiple rows from the result set.
   */
  fetchmany(size?: number): unknown[][] {
    const count = size ?? this.arraysize
    const result: unknown[][] = []
    for (let i = 0; i < count; i++) {
      const row = this.fetchone()
      if (row === null) break
      result.push(row)
    }
    return result
  }

  /**
   * Fetch all remaining rows from the result set.
   */
  fetchall(): unknown[][] {
    if (!this._queryResult) throw new ProgrammingError("No result")
    const remaining = this._queryResult.rows.slice(this._rowIndex)
    this._rowIndex = this._queryResult.rows.length
    return remaining as unknown[][]
  }

  /**
   * Get the current job ID.
   */
  getJobId(): string | null {
    return this.jobId
  }

  /**
   * Check if the async job has finished.
   */
  async isJobFinished(jobId?: string): Promise<boolean> {
    if (this._queryResult) return true
    // Delegate to connection layer for polling
    const id = jobId || this.jobId
    if (!id) return false
    const result = await this._connection.getJobResult(id)
    if (result) {
      this._queryResult = result
      this._rowIndex = 0
      return true
    }
    return false
  }

  /**
   * Cancel a running job.
   */
  async cancel(jobId: string): Promise<void> {
    await this._connection.cancelJob(jobId)
  }

  /**
   * Get a new query ID (formatted job ID).
   */
  queryId(): string {
    return this._connection.formatJobId()
  }

  /**
   * Get the schema (column metadata) of the current result.
   */
  get schema(): ColumnSchema[] | null {
    return this._queryResult?.columns ?? null
  }

  /** No-op for DB-API compatibility. */
  setinputsizes(_sizes: unknown): void {}
  /** No-op for DB-API compatibility. */
  setoutputsize(_size: unknown, _column?: unknown): void {}

  [Symbol.iterator](): Iterator<unknown[]> {
    if (!this._queryResult) throw new ProgrammingError("No result")
    let idx = this._rowIndex
    const rows = this._queryResult.rows
    return {
      next(): IteratorResult<unknown[]> {
        if (idx < rows.length) return { value: rows[idx++] as unknown[], done: false }
        return { value: undefined, done: true }
      },
    }
  }

  private async _execute(
    operation: string,
    parameters?: Record<string, unknown>,
    asynchronous = false,
    bindingParams?: unknown[],
    jobId?: string,
  ): Promise<void> {
    if (!operation?.trim()) throw new Error("sql is empty")

    this._queryResult = null
    this._rowIndex = 0

    let sql = operation.trim()
    if (!sql.endsWith(";")) sql += ";"

    // Process binding params (qmark style)
    if (bindingParams) {
      const processed = this._connection.processParamsQmarks(bindingParams)
      sql = this._connection.getFullSqlWithParams(sql, processed)
    }

    this.jobId = jobId || this._connection.formatJobId()

    const result = await this._connection.submitSql(sql, this.jobId, parameters, asynchronous)
    if (!result) throw new Error(`Failed to execute SQL job ${this.jobId}: received null result`)
    this._queryResult = result
  }
}
