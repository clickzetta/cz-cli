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
// Error types
// ---------------------------------------------------------------------------
export class NotSupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotSupportedError"
  }
}

export class ConnectionException extends Error {
  readonly connectionInfo?: Record<string, unknown>
  constructor(
    message: string,
    connectionInfo?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "ConnectionException"
    this.connectionInfo = connectionInfo
  }
}

export class QueryExecutionException extends Error {
  readonly query?: string
  constructor(
    message: string,
    query?: string,
  ) {
    super(message)
    this.name = "QueryExecutionException"
    this.query = query
  }
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
