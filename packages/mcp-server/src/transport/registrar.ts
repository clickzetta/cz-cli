/**
 * MCPComponentRegistrar — unified MCP component registration
 *
 * Python → TS mapping (mcp_registrar.py):
 *   lines  36-57   MCPComponentRegistrar.__init__          → McpComponentRegistrar constructor
 *   lines 200-230  register_tools_to_server                → registerToolsToServer
 *   lines 232-254  register_resources_to_server            → registerResourcesToServer
 *   lines 256-278  register_prompts_to_server              → registerPromptsToServer
 *   lines 575-605  _execute_tool_for_server                → executeToolForServer (private)
 *   lines 704-775  _get_resources_list_for_server          → delegated to registerResources()
 *   lines 777-818  _read_resource_for_server               → delegated to registerResources()
 *   lines 820-853  _get_prompts_list_for_server            → delegated to registerPrompts()
 *   lines 855-895  _get_prompt_for_server                  → delegated to registerPrompts()
 *
 * Provides unified tool/resource/prompt registration for HTTP and STDIO transports,
 * eliminating duplicate code between run-http.ts and run-stdio.ts.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type { McpServerCore, LakehouseDB } from "../server.js"
import type { ToolRegistry } from "../tool-registry.js"
import { SQLWriteDetector } from "../sql-write-detector.js"
import { registerResources } from "../resources/index.js"
import { registerPrompts } from "../prompts/index.js"
import { logger } from "../logger.js"

// ---------------------------------------------------------------------------
// McpComponentRegistrar — mcp_registrar.py:28-57
// ---------------------------------------------------------------------------
export class McpComponentRegistrar {
  // mcp_registrar.py:44
  readonly serverCore: McpServerCore
  // mcp_registrar.py:45
  readonly toolRegistry: ToolRegistry

  // mcp_registrar.py:54-57 — timeout configuration
  readonly defaultTimeout: number   // 30s
  readonly resourceTimeout: number  // 15s
  readonly promptTimeout: number    // 10s

  // mcp_registrar.py:36-57
  constructor(serverCore: McpServerCore, toolRegistry: ToolRegistry) {
    this.serverCore = serverCore
    this.toolRegistry = toolRegistry

    // mcp_registrar.py:54-57
    this.defaultTimeout = 30_000
    this.resourceTimeout = 15_000
    this.promptTimeout = 10_000
  }

  // ==================== MCP Server registration methods ====================

  /**
   * registerToolsToServer — mcp_registrar.py:201-230
   *
   * Registers list_tools and call_tool handlers on the MCP Server.
   */
  registerToolsToServer(server: Server): void {
    try {
      // mcp_registrar.py:209 — get all tools (may be empty if registry not initialized)
      const allTools = this.toolRegistry.isInitialized()
        ? this.toolRegistry.getAllTools()
        : []
      logger.info({ count: allTools.length }, "Registering tools to MCP Server")

      // mcp_registrar.py:212-217 — @server.list_tools()
      server.setRequestHandler(ListToolsRequestSchema, async () => {
        const mcpTools = this.toolRegistry.getMcpToolList(allTools)
        logger.debug({ count: mcpTools.length }, "Returning tools list")
        return { tools: mcpTools }
      })

      // mcp_registrar.py:219-224 — @server.call_tool()
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const name = request.params.name
        // mcp_registrar.py:224 — arguments or {}
        const args = (request.params.arguments as Record<string, unknown>) ?? {}
        return await this._executeToolForServer(name, args)
      })

      logger.info("Tool handlers registered to MCP Server")
    } catch (e) {
      logger.error({ err: e }, "Failed to register tools to MCP Server")
      throw e
    }
  }

  /**
   * registerResourcesToServer — mcp_registrar.py:232-254
   *
   * Delegates to the existing registerResources() implementation which
   * mirrors _get_resources_list_for_server and _read_resource_for_server.
   */
  registerResourcesToServer(server: Server): void {
    try {
      // mcp_registrar.py:240-248 — @server.list_resources() + @server.read_resource()
      registerResources(server)
      logger.info("Resource handlers registered to MCP Server")
    } catch (e) {
      logger.error({ err: e }, "Failed to register resources to MCP Server")
      throw e
    }
  }

  /**
   * registerPromptsToServer — mcp_registrar.py:256-278
   *
   * Delegates to the existing registerPrompts() implementation which
   * mirrors _get_prompts_list_for_server and _get_prompt_for_server.
   */
  registerPromptsToServer(server: Server): void {
    try {
      // mcp_registrar.py:264-272 — @server.list_prompts() + @server.get_prompt()
      registerPrompts(server)
      logger.info("Prompt handlers registered to MCP Server")
    } catch (e) {
      logger.error({ err: e }, "Failed to register prompts to MCP Server")
      throw e
    }
  }

  /**
   * registerAll — convenience method to register all components at once.
   * Calls registerToolsToServer, registerResourcesToServer, registerPromptsToServer.
   */
  registerAll(server: Server): void {
    this.registerToolsToServer(server)
    this.registerResourcesToServer(server)
    this.registerPromptsToServer(server)
    logger.info("All MCP components registered (tools + resources + prompts)")
  }

  // ==================== Private helpers ====================

  /**
   * _executeToolForServer — mcp_registrar.py:575-605
   *
   * Looks up the tool handler, checks if it's a utility tool (no DB needed),
   * and executes it. Returns MCP-compatible content array.
   */
  private async _executeToolForServer(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      // mcp_registrar.py:578-582 — look up handler
      const handler = this.toolRegistry.getToolHandler(toolName)
      if (!handler) {
        const errorMsg = `Tool '${toolName}' not found`
        logger.error({ toolName }, errorMsg)
        return { content: [{ type: "text", text: `Error: ${errorMsg}` }] }
      }

      // mcp_registrar.py:584-587 — check utility tag
      const allTools = this.toolRegistry.isInitialized()
        ? this.toolRegistry.getAllTools()
        : []
      const toolMeta = allTools.find((t) => t.name === toolName)
      const isUtilityTool = toolMeta?.tags.includes("utility") ?? false

      let resultText: unknown

      if (isUtilityTool) {
        // mcp_registrar.py:590-592 — utility tool: no DB, no write detector, no server_core
        logger.info({ toolName }, "Executing utility tool without DB connection")
        resultText = await handler(args, null, null, false, null)
      } else {
        // mcp_registrar.py:594-595 — regular tool: full dependencies
        resultText = await this._executeToolDirect(toolName, args, handler)
      }

      // mcp_registrar.py:597-600 — ensure list return type
      if (Array.isArray(resultText)) {
        // Already a content array — pass through
        return { content: resultText as Array<{ type: string; text: string }> }
      }
      return { content: [{ type: "text", text: String(resultText ?? "") }] }
    } catch (e) {
      const errorMsg = `Tool call failed ${toolName}: ${String(e)}`
      logger.error({ err: e, toolName }, errorMsg)
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }] }
    }
  }

  /**
   * _executeToolDirect — mcp_registrar.py:538-573
   *
   * Acquires a DB connection, creates a SQLWriteDetector, calls the handler
   * with a per-tool timeout, then returns the DB connection.
   */
  private async _executeToolDirect(
    toolName: string,
    args: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (...a: any[]) => any,
  ): Promise<unknown> {
    let db: LakehouseDB | null = null
    try {
      logger.debug({ toolName, args }, "Executing tool")

      // mcp_registrar.py:545 — get DB connection
      db = this.serverCore.getDb()

      // mcp_registrar.py:548 — create write detector
      const writeDetector = new SQLWriteDetector()

      // mcp_registrar.py:551-555 — per-tool timeout
      const toolTimeout =
        toolName === "create_external_function" ? 120_000 : 45_000

      const result = await Promise.race([
        handler(args, db, writeDetector, true, this.serverCore),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool execution timed out: ${toolName}`)),
            toolTimeout,
          ),
        ),
      ])

      return this._formatResultSafe(result)
    } catch (e) {
      logger.error({ err: e, toolName }, "Tool execution failed")
      return this._formatErrorSafe(toolName, e)
    } finally {
      // mcp_registrar.py:568-573 — return DB connection
      if (db !== null) {
        try {
          // McpServerCore uses single-connection mode; no explicit return needed,
          // but we mirror the Python pattern for future pool support.
          logger.debug({ toolName }, "DB connection released")
        } catch (cleanupErr) {
          logger.warn({ err: cleanupErr }, "Failed to release DB connection")
        }
      }
    }
  }

  /**
   * _formatResultSafe — mcp_registrar.py:897-920
   */
  private _formatResultSafe(result: unknown): string {
    try {
      if (result == null) return "Operation completed"
      if (Array.isArray(result)) {
        const texts = result.map((item) => {
          if (item && typeof item === "object") {
            if ("text" in item) return String((item as { text: unknown }).text)
            if ("content" in item) return String((item as { content: unknown }).content)
          }
          return String(item)
        })
        return texts.join("\n") || "Operation completed"
      }
      return String(result)
    } catch (e) {
      logger.error({ err: e }, "Failed to format result")
      return `Result formatting failed: ${String(e)}`
    }
  }

  /**
   * _formatErrorSafe — mcp_registrar.py:922-941
   */
  private _formatErrorSafe(toolName: string, error: unknown): string {
    try {
      const errorStr = String(error).toLowerCase()
      if (errorStr.includes("connection") || errorStr.includes("database")) {
        return `Database connection error [${toolName}]: ${String(error)}`
      }
      if (errorStr.includes("timeout")) {
        return `Operation timed out [${toolName}]: ${String(error)}`
      }
      if (errorStr.includes("permission") || errorStr.includes("access")) {
        return `Permission error [${toolName}]: ${String(error)}`
      }
      if (errorStr.includes("not found") || errorStr.includes("404")) {
        return `Resource not found [${toolName}]: ${String(error)}`
      }
      if (errorStr.includes("invalid") || errorStr.includes("bad")) {
        return `Invalid argument [${toolName}]: ${String(error)}`
      }
      return `Tool execution failed [${toolName}]: ${String(error)}`
    } catch {
      return `Tool execution failed [${toolName}]: unknown error`
    }
  }
}
