/**
 * ClickzettaMcpServer + ToolConfig
 *
 * Python → TS mapping:
 *   mcp_server.py:990-1059  ToolConfig class          → ToolConfig class
 *   mcp_server.py:41-80     ClickzettaMCPServer.__init__ → ClickzettaMcpServer constructor
 *   mcp_server.py:157-183   _initialize_config_params → _initializeConfigParams
 *   mcp_server.py:185-198   _get_service_url          → _getServiceUrl
 *   mcp_server.py:407-433   _resolve_config_from_user_config → _resolveConfigFromUserConfig
 *   mcp_server.py:511-539   _get_config_value         → _getConfigValue
 *
 * Methods that depend on Python-only HTTP/auth services
 * (_authenticate_user, _load_user_config, _resolve_instance_info,
 *  _resolve_config_with_priority, _update_server_connection,
 *  _register_http_handlers, run) are ported as stubs that throw
 * NotImplementedError — they require external service calls
 * (login_server, workspace_server, instance_service) that are not
 * available in the TS package.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { logger } from "./logger.js"
import { McpServerCore } from "./server.js"
import { ToolRegistry } from "./tool-registry.js"
import { getRegionByAlias } from "./config/region.js"
import { Region } from "./config/region.js"

// ---------------------------------------------------------------------------
// ToolConfig — mcp_server.py:990-1059
// ---------------------------------------------------------------------------

/**
 * ToolConfig — mcp_server.py:990-1059
 *
 * Configuration parameters extracted from tool arguments.
 * Holds region/workspace/vcluster/schema with presence-check helpers.
 */
export class ToolConfig {
  // mcp_server.py:995
  private _region: string | undefined
  // mcp_server.py:996
  private _workspace: string | undefined
  // mcp_server.py:997
  private _vcluster: string | undefined
  // mcp_server.py:998
  private _schema: string | undefined

  // mcp_server.py:993-998
  constructor(
    region?: string,
    workspace?: string,
    vcluster?: string,
    schema?: string,
  ) {
    this._region = region
    this._workspace = workspace
    this._vcluster = vcluster
    this._schema = schema
  }

  // mcp_server.py:1000-1007 — region property
  get region(): string | undefined {
    return this._region
  }

  set region(value: string | undefined) {
    this._region = value
  }

  // mcp_server.py:1009-1015 — workspace property
  get workspace(): string | undefined {
    return this._workspace
  }

  set workspace(value: string | undefined) {
    this._workspace = value
  }

  // mcp_server.py:1017-1023 — vcluster property
  get vcluster(): string | undefined {
    return this._vcluster
  }

  set vcluster(value: string | undefined) {
    this._vcluster = value
  }

  // mcp_server.py:1025-1031 — schema property
  get schema(): string | undefined {
    return this._schema
  }

  set schema(value: string | undefined) {
    this._schema = value
  }

  // mcp_server.py:1033-1034
  hasWorkspace(): boolean {
    return this._workspace !== undefined && this._workspace !== null
  }

  // mcp_server.py:1036-1037
  hasRegion(): boolean {
    return this._region !== undefined && this._region !== null
  }

  // mcp_server.py:1039-1040
  hasVcluster(): boolean {
    return this._vcluster !== undefined && this._vcluster !== null
  }

  // mcp_server.py:1042-1043
  hasSchema(): boolean {
    return this._schema !== undefined && this._schema !== null
  }

  // mcp_server.py:1045-1046
  hasRequired(): boolean {
    return this.hasRegion() && this.hasWorkspace()
  }

  // mcp_server.py:1048-1049
  hasAny(): boolean {
    return this.hasRegion() || this.hasWorkspace() || this.hasVcluster() || this.hasSchema()
  }

  // mcp_server.py:1051-1059
  static fromDict(data: Record<string, unknown>): ToolConfig {
    return new ToolConfig(
      data["region"] as string | undefined,
      data["workspace"] as string | undefined,
      data["vcluster"] as string | undefined,
      data["schema"] as string | undefined,
    )
  }
}

// ---------------------------------------------------------------------------
// URL table — mirrors cz_mcp/config/config.ini [URL] section
// Used by _getServiceUrl to resolve region → base URL.
// ---------------------------------------------------------------------------
const REGION_URL_TABLE: Record<string, string> = {
  dev: "https://dev-studio.clickzetta.com",
  sit: "https://sit-studio.clickzetta.com",
  uat: "https://uat-studio.clickzetta.com",
  [Region.CN_SHANGHAI_ALICLOUD]: "https://lakehouse.clickzetta.com",
  [Region.AP_SOURCE_1_ALICLOUD]: "https://ap-southeast-1.clickzetta.com",
  [Region.AP_SHANGHAI_TENCENTCLOUD]: "https://ap-shanghai-tencent.clickzetta.com",
  [Region.AP_BEIJING_TENCENTCLOUD]: "https://ap-beijing-tencent.clickzetta.com",
  [Region.AP_GUANGZHOU_TENCENTCLOUD]: "https://ap-guangzhou-tencent.clickzetta.com",
  [Region.AP_SOURCE_1_AWS]: "https://ap-southeast-1-aws.clickzetta.com",
  [Region.KUAISHOU]: "https://kuaishou.clickzetta.com",
  [Region.KUAISHOU_SGP]: "https://kuaishou-sgp.clickzetta.com",
  [Region.GAOTU]: "https://gaotu.clickzetta.com",
}

// ---------------------------------------------------------------------------
// ClickzettaMcpServer — mcp_server.py:41-988
// ---------------------------------------------------------------------------

/**
 * ClickzettaMcpServer — mcp_server.py:41-988
 *
 * Unified MCP Server supporting both HTTP and STDIO transport modes.
 *
 * Ported methods (fully functional):
 *   constructor              mcp_server.py:44-80
 *   _initializeConfigParams  mcp_server.py:157-183
 *   _getServiceUrl           mcp_server.py:185-198
 *   _resolveConfigFromUserConfig mcp_server.py:407-433
 *   _getConfigValue          mcp_server.py:511-539
 *
 * Stub methods (require external service calls not available in TS):
 *   _updateServerConnection  mcp_server.py:82-155
 *   _authenticateUser        mcp_server.py:200-272
 *   _loadUserConfig          mcp_server.py:274-307
 *   _resolveInstanceInfo     mcp_server.py:309-380
 *   _resolveWorkspaceConfig  mcp_server.py:382-405
 *   _resolveConfigWithPriority mcp_server.py:435-509
 *   initialize               mcp_server.py:541-569
 *   _registerMcpComponents   mcp_server.py:571-584
 *   _registerHttpHandlers    mcp_server.py:586-937
 *   run                      mcp_server.py:939-987
 */
export class ClickzettaMcpServer {
  // mcp_server.py:45
  readonly host: string
  // mcp_server.py:46
  readonly port: number
  // mcp_server.py:47
  readonly transportType: string
  // mcp_server.py:48
  readonly env: string | undefined

  // mcp_server.py:52
  serverCore: McpServerCore | null
  // mcp_server.py:53
  toolRegistry: ToolRegistry | null

  // mcp_server.py:66-80 — low-level MCP server
  readonly lowLevelServer: Server

  // mcp_server.py:44-80
  constructor(
    host = "0.0.0.0",
    port = 8000,
    transportType = "http",
    env?: string,
  ) {
    this.host = host
    this.port = port
    this.transportType = transportType
    this.env = env

    // mcp_server.py:52-54
    this.serverCore = null
    this.toolRegistry = null

    // mcp_server.py:57-63 — transport-specific validation
    if (transportType === "stdio") {
      if (!env) {
        throw new Error("Environment must be specified for STDIO transport")
      }
    } else if (transportType !== "http") {
      throw new Error(`Unsupported transport type: ${transportType}`)
    }

    // mcp_server.py:66-80 — create low-level MCP server
    if (transportType === "http") {
      logger.info("Initializing low-level MCP for HTTP transport...")
      this.lowLevelServer = new Server(
        { name: "MCP Clickzetta Server", version: "0.1.0" },
        { capabilities: { tools: {} } },
      )
    } else {
      // stdio
      logger.info("Initializing low-level MCP server for STDIO transport")
      this.lowLevelServer = new Server(
        { name: "MCP Clickzetta Server", version: "0.1.0" },
        { capabilities: { tools: {} } },
      )
    }
  }

  // mcp_server.py:157-183
  /**
   * Initialize and resolve configuration parameters.
   *
   * Priority: tool params > connection headers
   *
   * @param toolConfigParams - Configuration from tool arguments (highest priority)
   * @param connectionInfo   - Configuration from HTTP headers (medium priority)
   * @returns [toolConfig, connectionInfo]
   */
  _initializeConfigParams(
    toolConfigParams?: Record<string, unknown>,
    connectionInfo?: Record<string, unknown>,
  ): [ToolConfig, Record<string, unknown>] {
    // mcp_server.py:168
    const params = toolConfigParams ?? {}
    // mcp_server.py:169
    const toolConfig = ToolConfig.fromDict(params)
    // mcp_server.py:170
    const connInfo = connectionInfo ?? {}

    // mcp_server.py:172-175
    if (toolConfig.hasAny()) {
      logger.info({ toolConfigParams: params }, "Tool config params")
    }
    if (Object.keys(connInfo).length > 0) {
      logger.info({ connectionInfo: connInfo }, "Connection info from headers")
    }

    // mcp_server.py:177-182 — resolve region: tool params > connection headers
    if (!toolConfig.hasRegion()) {
      const region = getRegionByAlias(connInfo["region"] as string | undefined)
      toolConfig.region = region
      logger.info({ region }, "Resolved region from connection info")
    }

    return [toolConfig, connInfo]
  }

  // mcp_server.py:185-198
  /**
   * Get service URL for the given region.
   *
   * Python reads from cz_mcp/utils/config_utils.read_url(env=temp_region).
   * TS uses the inline REGION_URL_TABLE above.
   *
   * @param tempRegion - Temporary region identifier
   * @returns [serviceUrl, service]
   */
  _getServiceUrl(tempRegion: string): [string, string] {
    // mcp_server.py:195
    const serviceUrl = REGION_URL_TABLE[tempRegion] ?? REGION_URL_TABLE["dev"]!
    // mcp_server.py:196 — strip protocol prefix
    const service = serviceUrl.replace(/^https?:\/\//, "")
    logger.info(
      { serviceUrl, service, centerRegion: tempRegion },
      "[_getServiceUrl] Get Service URL",
    )
    return [serviceUrl, service]
  }

  // mcp_server.py:407-433
  /**
   * Resolve workspace configuration from user config.
   *
   * Updates toolConfig in-place with workspace/vcluster/schema from
   * user_config_dict when the tool config does not already have them.
   *
   * @param userConfigDict - User configuration dictionary
   * @param toolConfig     - Tool configuration object to update
   * @returns [workspaceId, projectId]
   */
  _resolveConfigFromUserConfig(
    userConfigDict: Record<string, unknown>,
    toolConfig: ToolConfig,
  ): [number | undefined, string | undefined] {
    // mcp_server.py:417-421
    const workspace = userConfigDict["workspaceName"] as string | undefined
    const vcluster = (userConfigDict["vcName"] as string | undefined) ?? "DEFAULT"
    const schema = (userConfigDict["schemaName"] as string | undefined) ?? "public"
    const workspaceId = userConfigDict["workspaceId"] as number | undefined
    const projectId = userConfigDict["projectId"] as string | undefined

    // mcp_server.py:423-431
    if (!toolConfig.hasWorkspace()) {
      toolConfig.workspace = workspace
      logger.info({ workspace }, "Using workspace from user config")
    }
    if (!toolConfig.hasVcluster()) {
      toolConfig.vcluster = vcluster
      logger.info({ vcluster }, "Using vcluster from user config")
    }
    if (!toolConfig.hasSchema()) {
      toolConfig.schema = schema
      logger.info({ schema }, "Using schema from user config")
    }

    return [workspaceId, projectId]
  }

  // mcp_server.py:511-539
  /**
   * Get configuration value with priority: connection > user_config > default.
   *
   * @param connectionKey   - Key in connectionInfo dict
   * @param userConfigKey   - Key in userConfigDict
   * @param connectionInfo  - Connection info dictionary
   * @param userConfigDict  - User config dictionary
   * @param useHeader       - Whether to use connection info (must match region/workspace/vcluster)
   * @param useUserConfig   - Whether to use user config (must match region/workspace/vcluster)
   * @param defaultValue    - Default value if nothing found
   * @returns The resolved configuration value
   */
  _getConfigValue(
    connectionKey: string,
    userConfigKey: string,
    connectionInfo: Record<string, unknown>,
    userConfigDict: Record<string, unknown>,
    useHeader: boolean,
    useUserConfig: boolean,
    defaultValue: string | undefined,
  ): string | undefined {
    // mcp_server.py:529-531
    if (useHeader && connectionInfo[connectionKey]) {
      const value = connectionInfo[connectionKey] as string
      logger.info({ key: connectionKey, value }, "Using from connection Header config")
      return value
    }
    // mcp_server.py:532-535
    if (useUserConfig && userConfigDict[userConfigKey]) {
      const value = userConfigDict[userConfigKey] as string
      logger.info({ key: connectionKey, value }, "Using from user config")
      return value
    }
    // mcp_server.py:536-538
    logger.info({ key: connectionKey, value: defaultValue }, "Using from default config")
    return defaultValue
  }

  // mcp_server.py:82-155 — stub: requires external auth/service calls
  /**
   * Update server connection with authentication and configuration.
   *
   * Stub — full implementation requires external service calls
   * (login_server, workspace_server, instance_service) not available in TS.
   *
   * @throws Error always — not implemented
   */
  async _updateServerConnection(
    _authInput: Record<string, unknown>,
    _toolConfigParams?: Record<string, unknown>,
    _connectionInfo?: Record<string, unknown>,
    _centerRegion = "dev",
  ): Promise<void> {
    throw new Error(
      "_updateServerConnection: not implemented — requires external service calls " +
        "(login_server, workspace_server, instance_service)",
    )
  }

  // mcp_server.py:541-569 — stub: requires tool registration + MCP handler wiring
  /**
   * Initialize server components based on transport type.
   *
   * Stub — full implementation requires tool registration and MCP handler wiring.
   *
   * @throws Error always — not implemented
   */
  async initialize(): Promise<void> {
    throw new Error(
      "initialize: not implemented — requires tool registration and MCP handler wiring",
    )
  }

  // mcp_server.py:939-987 — stub: requires initialize() + transport run
  /**
   * Run the MCP server based on transport type.
   *
   * Stub — full implementation requires initialize() and transport run.
   *
   * @throws Error always — not implemented
   */
  async run(): Promise<void> {
    throw new Error(
      "run: not implemented — requires initialize() and transport run",
    )
  }

  // mcp_server.py:624-676 — infer region from host header
  /**
   * Infer region from host header.
   *
   * mcp_server.py:624-642 infer_region_from_host (inner function of handle_call_tool)
   *
   * @param host         - Host header value
   * @param studioRegion - Optional studio region fallback
   * @returns Inferred region string
   */
  static inferRegionFromHost(host: string, studioRegion?: string): string {
    // mcp_server.py:626-629
    if (studioRegion) {
      logger.info({ studioRegion }, "Using studio region as fallback")
      return studioRegion
    }

    // mcp_server.py:631-641
    let env: string
    if (host.startsWith("uat-")) {
      env = "uat"
    } else if (
      host.startsWith("0.0.0.0") ||
      host.startsWith("localhost") ||
      host.startsWith("dev-")
    ) {
      env = "dev"
    } else if (host.endsWith("singdata.com")) {
      env = Region.AP_SOURCE_1_ALICLOUD
    } else if (host.endsWith("clickzetta.com")) {
      env = Region.CN_SHANGHAI_ALICLOUD
    } else {
      env = "dev"
    }

    logger.info({ host, env }, "Infer region from host")
    return env
  }

  // mcp_server.py:644-676 — extract auth from headers/query params
  /**
   * Extract authentication input from headers or query params.
   *
   * mcp_server.py:644-676 extract_auth (inner function of handle_call_tool)
   *
   * @param headers     - Request headers as plain object
   * @param queryParams - Query parameters as plain object
   * @returns Auth input dict with type + credentials
   * @throws Error if no authentication found
   */
  static extractAuth(
    headers: Record<string, string>,
    queryParams: Record<string, string>,
  ): Record<string, string> {
    // mcp_server.py:647-652 — x-lakehouse-token header
    const tokenHeader = headers["x-lakehouse-token"]
    if (tokenHeader) {
      if (tokenHeader.startsWith("Bearer ")) {
        return { type: "pat", pat: tokenHeader.slice("Bearer ".length) }
      }
      if (tokenHeader.trim()) {
        return { type: "pat", pat: tokenHeader.trim() }
      }
    }

    // mcp_server.py:654-657 — key query param
    const tokenQuery = queryParams["key"]
    if (tokenQuery) {
      return { type: "pat", pat: tokenQuery }
    }

    // mcp_server.py:659-674 — username/password
    const username = headers["x-lakehouse-username"]
    const password = headers["x-lakehouse-password"]
    if (username && password) {
      const instanceName = headers["x-lakehouse-instance"]
      if (!instanceName) {
        throw new Error(
          "x-lakehouse-instance header is required when using username/password authentication",
        )
      }
      return { type: "password", username, password, instance_name: instanceName }
    }

    // mcp_server.py:676
    throw new Error(
      "Login failed! token not found in headers or query params, and username/password login failed or not attempted",
    )
  }
}
