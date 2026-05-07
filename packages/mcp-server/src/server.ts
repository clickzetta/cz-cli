/**
 * LakehouseDB — skeleton port of cz-mcp-server/cz_mcp/core/server_core.py
 *
 * Python → TS mapping:
 *   server_core.py:35        AUTH_EXPIRATION_TIME → LakehouseDB.AUTH_EXPIRATION_TIME
 *   server_core.py:37-65     EnhancedLakehouseDB.__init__ → LakehouseDB constructor
 *   server_core.py:67-83     create_from_connection_config → LakehouseDB.createFromConnectionConfig
 *   server_core.py:203-271   execute_query → LakehouseDB.executeQuery (stub)
 *   server_core.py:316-325   add_insight → LakehouseDB.addInsight
 *   server_core.py:327-345   get_memo → LakehouseDB.getMemo
 *   server_core.py:347-379   get_connection_info → LakehouseDB.getConnectionInfo
 *   server_core.py:381-392   close → LakehouseDB.close
 *   server_core.py:432-612   MCPServerCore → McpServerCore class
 *
 * NOTE: Real Lakehouse client integration is deferred to Block 2.
 *       executeQuery throws NotSupportedError as a placeholder.
 */

import { logger } from "./logger.js"
import { ConfigurationException } from "./tool-registry.js"
import type { StudioConfig } from "./config/profile.js"
import { LakehouseClient } from "./lakehouse-client.js"

// Re-export StudioConfig so existing callers that import from server.js keep working.
export type { StudioConfig } from "./config/profile.js"

// ---------------------------------------------------------------------------
// Error types — exceptions.py:11-165
// ---------------------------------------------------------------------------

/** exceptions.py:11-47 MCPBaseException */
export class MCPBaseException extends Error {
  readonly errorCode: string
  readonly details: Record<string, unknown>
  readonly timestamp: string
  override readonly cause?: unknown

  constructor(
    message: string,
    init: { errorCode?: string; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message)
    this.name = "MCPBaseException"
    this.errorCode = init.errorCode ?? this.constructor.name
    this.details = init.details ?? {}
    this.timestamp = new Date().toISOString()
    this.cause = init.cause
  }

  toDict(): Record<string, unknown> {
    return {
      success: false,
      error_code: this.errorCode,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      cause: this.cause != null ? String(this.cause) : null,
    }
  }
}

export class NotSupportedError extends MCPBaseException {
  constructor(message: string) {
    super(message)
    this.name = "NotSupportedError"
  }
}

/** exceptions.py:50-58 ConnectionException */
export class ConnectionException extends MCPBaseException {
  readonly connectionInfo?: Record<string, unknown>
  constructor(
    message: string,
    connectionInfo?: Record<string, unknown>,
  ) {
    super(message, { details: connectionInfo ? { connection_info: connectionInfo } : {} })
    this.name = "ConnectionException"
    this.connectionInfo = connectionInfo
  }
}

/** exceptions.py:61-69 ToolExecutionException */
export class ToolExecutionException extends MCPBaseException {
  readonly toolName?: string
  constructor(message: string, toolName?: string) {
    super(message, { details: toolName ? { tool_name: toolName } : {} })
    this.name = "ToolExecutionException"
    this.toolName = toolName
  }
}

/** exceptions.py:72-80 ValidationException */
export class ValidationException extends MCPBaseException {
  readonly validationErrors?: Record<string, unknown>
  constructor(message: string, validationErrors?: Record<string, unknown>) {
    super(message, { details: validationErrors ? { validation_errors: validationErrors } : {} })
    this.name = "ValidationException"
    this.validationErrors = validationErrors
  }
}

/** exceptions.py:83-91 PermissionException */
export class PermissionException extends MCPBaseException {
  readonly requiredPermission?: string
  constructor(message: string, requiredPermission?: string) {
    super(message, { details: requiredPermission ? { required_permission: requiredPermission } : {} })
    this.name = "PermissionException"
    this.requiredPermission = requiredPermission
  }
}

/** exceptions.py:105-113 TransportException */
export class TransportException extends MCPBaseException {
  readonly transportType?: string
  constructor(message: string, transportType?: string) {
    super(message, { details: transportType ? { transport_type: transportType } : {} })
    this.name = "TransportException"
    this.transportType = transportType
  }
}

/** exceptions.py:116-126 QueryExecutionException */
export class QueryExecutionException extends MCPBaseException {
  readonly query?: string
  constructor(message: string, query?: string) {
    const details: Record<string, unknown> = {}
    if (query) {
      details["query"] = query.length > 500 ? query.slice(0, 500) + "..." : query
      details["query_length"] = query.length
    }
    super(message, { details })
    this.name = "QueryExecutionException"
    this.query = query
  }
}

/**
 * exceptions.py:141-165 map_exception — map a generic Error to the
 * appropriate MCPBaseException subclass.
 */
export function mapException(err: unknown, context?: string): MCPBaseException {
  const details: Record<string, unknown> = {}
  if (context) details["context"] = context
  const typeName = err instanceof Error ? err.constructor.name : typeof err
  details["original_exception_type"] = typeName
  const message = err instanceof Error ? err.message : String(err)

  if (err instanceof TypeError || err instanceof RangeError) {
    return new ValidationException(message, details)
  }
  if (err instanceof MCPBaseException) return err
  return new MCPBaseException(message, {
    errorCode: `MAPPED_${typeName.toUpperCase()}`,
    details,
    cause: err,
  })
}

// ---------------------------------------------------------------------------
// LakehouseDB — server_core.py:28-392
// ---------------------------------------------------------------------------
export class LakehouseDB {
  // server_core.py:35
  static readonly AUTH_EXPIRATION_TIME = 1800 // 30-minute session timeout

  // server_core.py:54
  connectionConfig: StudioConfig | null
  // server_core.py:55 — placeholder; Block 2 injects real client
  lakehouseClient: LakehouseClient | null
  // server_core.py:56
  insights: string[]
  // server_core.py:57
  managedWorkspace: string[]
  // server_core.py:58
  authTime: number
  // server_core.py:61
  enableQueryCache: boolean

  // server_core.py:37-65
  constructor(
    connectionConfig: StudioConfig | null = null,
    enableQueryCache = false,
  ) {
    this.connectionConfig = connectionConfig
    this.lakehouseClient = null
    this.insights = []
    this.managedWorkspace = []
    this.authTime = 0
    this.enableQueryCache = enableQueryCache
  }

  // server_core.py:67-83
  static createFromConnectionConfig(config: StudioConfig): LakehouseDB {
    if (!config.token) {
      throw new ConfigurationException(
        "Missing token in connection_config",
      )
    }
    logger.info({ config }, "Creating LakehouseDB with config")
    return new LakehouseDB(config)
  }

  /**
   * Check whether the current session has expired.
   * Mirrors the inline check at server_core.py:233:
   *   if not self.lakehouse_client or time.time() - self.auth_time > AUTH_EXPIRATION_TIME
   */
  isSessionExpired(): boolean {
    if (!this.lakehouseClient) return true
    return Date.now() / 1000 - this.authTime > LakehouseDB.AUTH_EXPIRATION_TIME
  }

  /**
   * executeQuery — server_core.py:203-271
   *
   * Real implementation: re-initialises the LakehouseClient when the session
   * has expired, then delegates to LakehouseClient.runSql().
   *
   * Returns [rows, errorMessage] where errorMessage is "" on success,
   * matching the Python tuple convention (server_core.py:268-271).
   */
  async executeQuery(
    query: string,
    _useCache = false,
    _cacheTtl = 300,
  ): Promise<[Array<Record<string, unknown>>, string]> {
    if (!this.connectionConfig) {
      throw new ConnectionException("No connection configuration available")
    }

    // server_core.py:233 — re-initialise when session expired
    if (this.isSessionExpired()) {
      logger.info("Session expired or not initialised — creating new LakehouseClient")
      if (this.lakehouseClient) {
        this.lakehouseClient.close()
      }
      this.lakehouseClient = new LakehouseClient(this.connectionConfig)
      this.lakehouseClient.connect()
      this.authTime = Date.now() / 1000
      // server_core.py:157 — fetch managed workspaces (optional, failure is non-fatal)
      await this._fetchManagedWorkspaces()
    }

    try {
      const rows = await this.lakehouseClient!.runSql(query)
      return [rows, ""]
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.error({ err: e, query: query.slice(0, 80) }, "executeQuery failed")
      throw new QueryExecutionException(msg, query)
    }
  }

  // server_core.py:316-325
  addInsight(insight: string): void {
    const trimmed = insight?.trim()
    if (trimmed) {
      this.insights.push(trimmed)
      logger.debug({ insight: trimmed.slice(0, 50) }, "添加洞察")
    }
  }

  // server_core.py:327-345
  getMemo(): string {
    if (this.insights.length === 0) {
      return "暂无数据洞察。"
    }

    let memo = "📊 数据洞察备忘录 📊\n\n"
    memo += "关键发现:\n\n"
    memo += this.insights.map((i) => `- ${i}`).join("\n")

    if (this.insights.length > 1) {
      memo += `\n\n总结:\n分析发现了 ${this.insights.length} 个关键数据洞察，`
      memo += "为战略优化和增长提供了机会。"
    }

    return memo
  }

  // server_core.py:347-379
  getConnectionInfo(): Record<string, unknown> {
    if (!this.connectionConfig) {
      return {
        error: `Invalid connection configuration type: ${typeof this.connectionConfig}`,
        config_value: String(this.connectionConfig),
      }
    }

    return {
      service: this.connectionConfig.service,
      workspace: this.connectionConfig.workspace,
      schema: this.connectionConfig.schema,
      vcluster: this.connectionConfig.vcluster,
      instance: this.connectionConfig.instance,
      connected: this.lakehouseClient !== null,
      auth_time: this.authTime,
      time_since_auth: this.authTime ? Date.now() / 1000 - this.authTime : 0,
      managed_workspaces: this.managedWorkspace,
      performance_features: {
        query_cache_enabled: this.enableQueryCache,
      },
    }
  }

  // server_core.py:381-392
  async close(): Promise<void> {
    if (this.lakehouseClient) {
      try {
        this.lakehouseClient.close()
        logger.debug("Lakehouse连接已关闭")
      } catch (e) {
        logger.warn({ err: e }, "关闭连接时发生错误")
      } finally {
        this.lakehouseClient = null
        this.authTime = 0
      }
    }
  }

  /**
   * server_core.py:184-201 — fetch managed workspaces via SHOW CATALOGS.
   * Optional: failure is non-fatal, falls back to empty list.
   */
  private async _fetchManagedWorkspaces(): Promise<void> {
    try {
      const rows = await this.lakehouseClient!.runSql(
        "SHOW CATALOGS WHERE category='MANAGED'",
      )
      this.managedWorkspace = rows
        .filter((r) => "workspace_name" in r)
        .map((r) => String(r["workspace_name"] ?? ""))
        .filter(Boolean)
      logger.debug({ count: this.managedWorkspace.length }, "获取到管理的workspace")
    } catch (e) {
      logger.warn({ err: e }, "获取管理workspace失败，使用空列表")
      this.managedWorkspace = []
    }
  }
}

// ---------------------------------------------------------------------------
// McpServerCore — server_core.py:432-612
// ---------------------------------------------------------------------------
export class McpServerCore {
  db: LakehouseDB | null
  connectionConfig: StudioConfig | null
  private _initialized: boolean

  // server_core.py:439-447
  constructor() {
    this.db = null
    this.connectionConfig = null
    this._initialized = false
    logger.info("McpServerCore created (single-connection mode)")
  }

  // server_core.py:449-473
  initialize(connectionConfig: StudioConfig): void {
    try {
      logger.info("Initializing MCP Server Core")
      this.connectionConfig = connectionConfig
      this.db = LakehouseDB.createFromConnectionConfig(connectionConfig)
      this._initialized = true
      logger.info("MCP Server Core initialization completed")
    } catch (e) {
      logger.error({ err: e }, "Server core initialization failed")
      throw new ConfigurationException(
        `MCP Server Core initialization failed: ${String(e)}`,
      )
    }
  }

  // server_core.py:475-522
  updateConnectionConfig(connectionConfig: StudioConfig): void {
    try {
      const configChanged =
        !this.connectionConfig ||
        this.connectionConfig.service !== connectionConfig.service ||
        this.connectionConfig.workspace !== connectionConfig.workspace ||
        this.connectionConfig.vcluster !== connectionConfig.vcluster ||
        this.connectionConfig.instance !== connectionConfig.instance ||
        this.connectionConfig.schema !== connectionConfig.schema ||
        this.connectionConfig.token !== connectionConfig.token

      if (configChanged) {
        logger.info(
          {
            service: connectionConfig.service,
            workspace: connectionConfig.workspace,
            vcluster: connectionConfig.vcluster,
            instance: connectionConfig.instance,
            schema: connectionConfig.schema,
          },
          "Connection config changed, updating database connection",
        )
        this.connectionConfig = connectionConfig
        const newDb = LakehouseDB.createFromConnectionConfig(connectionConfig)
        this.setDbInstance(newDb)
        logger.info("Database connection updated successfully")
      } else {
        logger.debug("Connection config unchanged, skipping database reconnection")
      }
    } catch (e) {
      logger.error({ err: e }, "Failed to update connection config")
      throw new ConfigurationException(`Failed to update connection config: ${String(e)}`)
    }
  }

  // server_core.py:524-527
  isInitialized(): boolean {
    return this._initialized
  }

  // server_core.py:528-541
  getDb(): LakehouseDB {
    if (!this.db) {
      throw new ConfigurationException("数据库连接未初始化")
    }
    return this.db
  }

  // server_core.py:543-560
  setDbInstance(newDb: LakehouseDB): void {
    const oldDb = this.db
    this.db = newDb
    if (oldDb && oldDb !== newDb) {
      oldDb.close().catch((e) => {
        logger.warn({ err: e }, "关闭旧数据库连接时出现警告")
      })
    }
  }

  // server_core.py:601-612
  async shutdown(): Promise<void> {
    logger.info("关闭MCP服务器核心")
    if (this.db) {
      await this.db.close()
    }
    this._initialized = false
    logger.info("MCP服务器核心已关闭")
  }

  // server_core.py:614-632
  getServerStats(): Record<string, unknown> {
    const stats: Record<string, unknown> = {
      initialized: this._initialized,
    }
    if (this.db) {
      stats["database_info"] = this.db.getConnectionInfo()
    }
    return stats
  }
}
