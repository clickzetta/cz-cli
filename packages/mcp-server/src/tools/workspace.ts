/**
 * Workspace tools — port of cz-mcp-server/cz_mcp/tools/workspace_tools.py
 *
 * Python → TS mapping:
 *   workspace_tools.py:20-104  handle_list_user_workspaces  → handleListUserWorkspaces()
 *   workspace_tools.py:107-142 list_user_workspaces_tool()  → (tool definition in registerWorkspaceTools)
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import { apiListUserWorkspaces } from "./studio-api.js"

// ---------------------------------------------------------------------------
// handleListUserWorkspaces — workspace_tools.py:20-104
// ---------------------------------------------------------------------------
async function handleListUserWorkspaces(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    logger.info("Listing all workspaces for user")

    // workspace_tools.py:36-48 — call the API with fixed pageSize=20
    const pageSize = 20
    const workspaceName = arguments_["workspace_pattern"] as string | undefined
    const responseText = await apiListUserWorkspaces(config, {
      pageIndex: 1,
      pageSize,
      workspaceName,
    })

    // workspace_tools.py:51 — parse response
    const responseData = JSON.parse(responseText) as Record<string, unknown>

    // workspace_tools.py:53-87 — success branch
    if (responseData["code"] === "200") {
      // workspace_tools.py:55-58 — capture full count before limiting to 20
      const maxResults = pageSize
      const allWorkspaces = (responseData["data"] as unknown[]) ?? []
      const totalCount = allWorkspaces.length
      const data = allWorkspaces.slice(0, maxResults)

      // workspace_tools.py:61-72 — format workspace data for better readability
      const formattedWorkspaces = data.map((ws) => {
        const w = ws as Record<string, unknown>
        return {
          workspace_name: w["showName"],
          project_id: w["projectId"],
          workspace_id: w["workspaceId"],
          created_time: w["createdTime"],
          updated_time: w["updatedTime"],
          default_schema_name: w["defaultSchemaName"],
          default_vc_name: w["defaultVcName"],
        }
      })

      // workspace_tools.py:74-78 — build message
      const message =
        totalCount > pageSize
          ? `${totalCount} total matches found, showing ${pageSize}. Refine keywords if needed.`
          : "Successfully retrieved all user workspaces"

      return {
        success: true,
        message,
        total_count: totalCount,
        workspaces: formattedWorkspaces,
      }
    } else {
      // workspace_tools.py:88-95 — error branch
      return {
        success: false,
        message: `API request failed: ${responseData["message"] ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    // workspace_tools.py:97-104 — exception handler
    logger.error({ err: e }, "Error in list_user_workspaces")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// registerWorkspaceTools — workspace_tools.py:107-142
// ---------------------------------------------------------------------------
export function registerWorkspaceTools(registry: ToolRegistry, db: LakehouseDB): void {
  const getConfig = () => {
    if (!db.connectionConfig) throw new Error("No connection configuration available")
    return db.connectionConfig
  }

  // workspace_tools.py:109-141 — list_user_workspaces tool definition
  const tools: ToolDefinition[] = [
    {
      name: "list_user_workspaces",
      description:
        "List workspaces accessible to the current user in Clickzetta Studio. " +
        "Supports fuzzy matching search by workspace. " +
        "Returns workspace information including workspace name, projectId, workspace id, and timestamps. " +
        "CRITICAL: this tool return up to 20 most relevant results, when return size < total_count, must prompt users to adjust keywords ",
      inputSchema: {
        type: "object",
        properties: {
          workspace_pattern: {
            type: "string",
            description: "Optional. Supports fuzzy matching search by workspace ",
          },
        },
        additionalProperties: false,
        required: [],
      },
      handler: async (args: Record<string, unknown>) =>
        handleListUserWorkspaces(args, getConfig()),
      tags: ["studio", "workspace", "normalize"],
      samples: [
        {
          description: "List all workspaces for the current user",
          query: { workspace_pattern: "myWorkspace" },
        },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering workspace tools")
  registry.registerTools(tools)
}
