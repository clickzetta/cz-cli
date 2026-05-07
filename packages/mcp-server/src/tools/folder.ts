/**
 * Folder tools — port of cz-mcp-server/cz_mcp/tools/folder_tools.py
 *
 * Python → TS mapping:
 *   folder_tools.py:19-87   handle_create_folder        → handleCreateFolder()
 *   folder_tools.py:90-127  create_folder_tool()        → (tool definition in registerFolderTools)
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import { studioPost, getBaseUrl, getApiPath, buildHeaders } from "./studio-api.js"

// ---------------------------------------------------------------------------
// handleCreateFolder — folder_tools.py:19-87
// ---------------------------------------------------------------------------
async function handleCreateFolder(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // folder_tools.py:29-31 — extract parameters
    const parentFolderId = arguments_["parent_folder_id"] as number | undefined
    const dataFolderName = arguments_["data_folder_name"] as string | undefined

    // folder_tools.py:33-34 — validate config
    if (!config) {
      throw new Error("Server connection_config is not initialized")
    }

    // folder_tools.py:37-41 — use config project ID and username
    const projectId = config.projectId
    const createdBy = config.username ?? ""

    logger.info({ projectId }, "create project folder for project_id")

    // folder_tools.py:44-54 — call the API
    const url = getBaseUrl(config.env, config.baseUrl) + getApiPath("DATA_FOLDER_ADD")
    const headers = buildHeaders(config)
    const responseText = await studioPost(url, headers, {
      projectId,
      createdBy,
      parentFolderId,
      dataFolderName,
    })

    // folder_tools.py:57 — parse response
    const responseData = JSON.parse(responseText) as Record<string, unknown>

    // folder_tools.py:59-70 — success branch
    if (responseData["code"] === "200") {
      const folderId = responseData["data"]
      const formattedResponse = {
        success: true,
        message: "Successfully create folder",
        folder_id: folderId,
      }
      return formattedResponse
    } else {
      // folder_tools.py:71-78 — error branch
      return {
        success: false,
        message: `[handle_create_folder]API request failed: ${responseData["message"] ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    // folder_tools.py:80-87 — exception handler
    logger.error({ err: e }, "Error in create folder")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// registerFolderTools — folder_tools.py:90-127
// ---------------------------------------------------------------------------
export function registerFolderTools(registry: ToolRegistry, db: LakehouseDB): void {
  const getConfig = () => {
    if (!db.connectionConfig) throw new Error("No connection configuration available")
    return db.connectionConfig
  }

  // folder_tools.py:92-127 — create_folder tool definition
  const tools: ToolDefinition[] = [
    {
      name: "create_folder",
      description:
        "Create a new data folder within a specified project workspace in Clickzetta Studio. " +
        "Supports defining the folder name, parent folder, folder type, and metadata such as creator information. " +
        "In this configuration, the folder will be created in the Clickzetta Studio workspace where projectId is specified.",
      inputSchema: {
        type: "object",
        properties: {
          data_folder_name: {
            type: "string",
            description:
              "Name of the folder to be created. Must be unique within the same parent folder.",
          },
          parent_folder_id: {
            type: "integer",
            description:
              "ID of the parent folder under which the new folder will be created.",
          },
        },
        additionalProperties: false,
        required: ["data_folder_name", "parent_folder_id"],
      },
      handler: async (args: Record<string, unknown>) => handleCreateFolder(args, getConfig()),
      tags: ["studio", "project", "normalize"],
      samples: [
        {
          description:
            "Create a new folder named cc in Click zetta Studio project (ID 97001), under parent folder with ID 528042.",
          query: {
            data_folder_name: "test_folder",
            parent_folder_id: 528042,
          },
        },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering folder tools")
  registry.registerTools(tools)
}
