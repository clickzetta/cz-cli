/**
 * Table and RowIterator ported from clickzetta/connector/v0/table.py.
 */

import type { QueryResult } from "./types.js"
import { JobStatus } from "./types.js"

export interface TableInfo {
  workspace: string
  tableName: string
  instance: string
  vcluster: string
}

export function createTable(workspace: string, tableName: string, instance: string, vcluster: string): TableInfo {
  return { workspace, tableName, instance, vcluster }
}

/**
 * RowIterator wraps a QueryResult and provides iteration over rows.
 */
export class RowIterator {
  private _rows: unknown[][]
  private _index = 0
  readonly totalRows: number

  constructor(result: QueryResult) {
    this._rows = result.rows
    this.totalRows = result.rowCount
  }

  [Symbol.iterator](): Iterator<unknown[]> {
    return {
      next: (): IteratorResult<unknown[]> => {
        if (this._index < this._rows.length) {
          return { value: this._rows[this._index++], done: false }
        }
        return { value: undefined, done: true }
      },
    }
  }

  toArray(): unknown[][] {
    return [...this._rows]
  }
}

/**
 * EmptyRowIterator for queries that return no data.
 */
export class EmptyRowIterator extends RowIterator {
  constructor() {
    super({ jobId: "", status: JobStatus.SUCCEEDED, columns: [], rows: [], rowCount: 0 })
  }

  override [Symbol.iterator](): Iterator<unknown[]> {
    return { next: () => ({ value: undefined, done: true as const }) }
  }

  override toArray(): unknown[][] {
    return []
  }
}
