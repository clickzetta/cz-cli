/**
 * LakehouseClient — port of cz-mcp-server/cz_mcp/core/enhanced_lakehouse.py
 *
 * Python → TS mapping:
 *   enhanced_lakehouse.py:40-47   ClickzettaConnectionParams dataclass → (inlined into StudioConfig)
 *   enhanced_lakehouse.py:50-180  EnhancedLakehouseClient              → LakehouseClient class
 *   enhanced_lakehouse.py:55-81   __init__                             → constructor
 *   enhanced_lakehouse.py:83-88   connect                              → connect()
 *   enhanced_lakehouse.py:105-135 _connect_via_api                     → _connectViaApi()
 *   enhanced_lakehouse.py:137-146 close                                → close()
 *   enhanced_lakehouse.py:148-153 run_sql                              → runSql()
 *   enhanced_lakehouse.py:155-180 _run_sql_via_api                     → _runSqlViaApi()
 *   enhanced_lakehouse.py:183-214 create_lakehouse_client_from_token   → createLakehouseClientFromToken()
 *
 * Divergences from Python:
 *   - Python uses clickzetta.connect() (DB-API cursor); TS uses SqlSession.execute()
 *   - Python returns JSON string from run_sql; TS returns rows array directly
 *   - runSqlWithSchema() is a TS addition (no Python equivalent) for callers
 *     that need column metadata alongside rows
 *   - Python has gRPC mode; TS only implements connect-API mode (no gRPC client)
 */

import { SqlSession } from "@clickzetta/sdk"
import type { ColumnSchema } from "@clickzetta/sdk"
import { StudioConfigManager } from "./config/profile.js"
import type { StudioConfig } from "./config/profile.js"
import { logger } from "./logger.js"

// ---------------------------------------------------------------------------
// LakehouseClient — enhanced_lakehouse.py:50-180 EnhancedLakehouseClient
// ---------------------------------------------------------------------------
export class LakehouseClient {
  // enhanced_lakehouse.py:71 — connection_params
  private readonly connectionConfig: StudioConfig

  // enhanced_lakehouse.py:77 — _connect_conn / _connect_cursor
  private _session: SqlSession | null = null

  // enhanced_lakehouse.py:80 — use_connect_api (always true in TS; no gRPC)
  private _connected = false

  // enhanced_lakehouse.py:55-81 __init__
  constructor(config: StudioConfig) {
    this.connectionConfig = config
  }

  // enhanced_lakehouse.py:83-88 connect
  connect(): void {
    this._connectViaApi()
  }

  // enhanced_lakehouse.py:105-135 _connect_via_api
  private _connectViaApi(): void {
    try {
      const connConfig = StudioConfigManager.toClientOptions(this.connectionConfig)
      this._session = new SqlSession(connConfig, {
        hints: this.connectionConfig.hints as Record<string, string>,
      })
      this._connected = true
      logger.info(
        {
          instance: this.connectionConfig.instance,
          service: this.connectionConfig.service,
          workspace: this.connectionConfig.workspace,
          vcluster: this.connectionConfig.vcluster,
          schema: this.connectionConfig.schema,
        },
        "Connected via clickzetta SDK SqlSession",
      )
    } catch (e) {
      throw new Error(`Failed to connect via clickzetta SDK: ${String(e)}`)
    }
  }

  // enhanced_lakehouse.py:137-146 close
  close(): void {
    this._session = null
    this._connected = false
  }

  // enhanced_lakehouse.py:148-153 run_sql (connect-API branch)
  async runSql(
    sql: string,
    opts?: { workspace?: string; schema?: string; vcluster?: string },
  ): Promise<Array<Record<string, unknown>>> {
    const { rows } = await this.runSqlWithSchema(sql, opts)
    return rows
  }

  /**
   * Execute SQL and return both rows and column metadata.
   * TS addition — no direct Python equivalent; Python callers reconstruct
   * column names from cursor.description inside _run_sql_via_api.
   *
   * enhanced_lakehouse.py:155-180 _run_sql_via_api (logic aligned)
   */
  async runSqlWithSchema(
    sql: string,
    opts?: { workspace?: string; schema?: string; vcluster?: string },
  ): Promise<{ rows: Array<Record<string, unknown>>; columns: ColumnSchema[] }> {
    if (!this._session) {
      // Lazy connect — mirrors Python's implicit cursor reuse
      this._connectViaApi()
    }

    // Apply per-call workspace/schema/vcluster overrides by temporarily
    // mutating the session state (mirrors Python cursor re-use pattern).
    const session = this._session!
    const savedWorkspace = session.workspace
    const savedSchema = session.schema
    const savedVcluster = session.vcluster

    if (opts?.workspace) session.workspace = opts.workspace
    if (opts?.schema) session.schema = opts.schema
    if (opts?.vcluster) session.vcluster = opts.vcluster

    try {
      // enhanced_lakehouse.py:162 — execute with hints
      const result = await session.execute(sql, {
        params: { hints: this.connectionConfig.hints as Record<string, string> },
      })

      // enhanced_lakehouse.py:164-175 — convert rows to list of dicts
      return {
        rows: result.rows,
        columns: result.columns,
      }
    } catch (e) {
      logger.error({ err: e }, "SQL execution failed via SDK")
      throw new Error(`SQL execution failed: ${String(e)}`)
    } finally {
      // Restore session state
      session.workspace = savedWorkspace
      session.schema = savedSchema
      session.vcluster = savedVcluster
    }
  }

  // enhanced_lakehouse.py:80 — use_connect_api / connection state
  isConnected(): boolean {
    return this._connected && this._session !== null
  }
}

// ---------------------------------------------------------------------------
// Factory — enhanced_lakehouse.py:183-214 create_lakehouse_client_from_token
// ---------------------------------------------------------------------------

/**
 * Create a LakehouseClient from a magic/JWT token.
 * enhanced_lakehouse.py:183-214 create_lakehouse_client_from_token
 *
 * Python creates ClickzettaConnectionParams then EnhancedLakehouseClient.
 * TS creates StudioConfig via StudioConfigManager.fromToken then LakehouseClient.
 */
export function createLakehouseClientFromToken(
  token: string,
  instance: string,
  service: string,
  workspace: string,
  schema = "public",
  vcluster = "DEFAULT",
): LakehouseClient {
  const config = StudioConfigManager.fromToken(token, {
    instance,
    service,
    workspace,
    schema,
    vcluster,
  })
  return new LakehouseClient(config)
}
