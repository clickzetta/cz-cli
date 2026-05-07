/**
 * vCluster tools — port of cz-mcp-server/cz_mcp/tools/vc_tools.py
 *
 * Python → TS mapping:
 *   vc_tools.py:19-27   _normalize_api_response     → normalizeApiResponse()
 *   vc_tools.py:30-91   handle_list_vcluster        → handleListVcluster()
 *   vc_tools.py:94-183  handle_create_vcluster      → handleCreateVcluster()
 *   vc_tools.py:186-219 list_vcluster_tool()        → (tool definition in registerVcTools)
 *   vc_tools.py:222-280 create_vcluster_tool()      → (tool definition in registerVcTools)
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import { apiVcList, apiVcCreate } from "./studio-api.js"

// ---------------------------------------------------------------------------
// normalizeApiResponse — vc_tools.py:19-27
// ---------------------------------------------------------------------------
function normalizeApiResponse(response: unknown): Record<string, unknown> {
  if (typeof response === "object" && response !== null && !Array.isArray(response)) {
    return response as Record<string, unknown>
  }
  if (typeof response === "string") {
    return JSON.parse(response) as Record<string, unknown>
  }
  throw new TypeError(`Unsupported response type: ${typeof response}`)
}

// ---------------------------------------------------------------------------
// handleListVcluster — vc_tools.py:30-91
// ---------------------------------------------------------------------------
async function handleListVcluster(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // vc_tools.py:40-41 — extract params
    const workspaceId =
      (arguments_["workspace_id"] as number | string | undefined) ?? config.workspaceId
    const name = (arguments_["name"] as string | undefined) ?? ""

    // vc_tools.py:48-49 — validate workspace_id
    if (!workspaceId) {
      throw new Error("Missing required fields: workspace_id")
    }

    // vc_tools.py:52-62 — call the API
    const responseRaw = await apiVcList(config, { workspaceId, name })
    const responseData = normalizeApiResponse(responseRaw)

    // vc_tools.py:65-73 — success branch
    if (responseData["code"] === "200") {
      const vclusters = (responseData["data"] as unknown[]) ?? []
      const formattedResponse = {
        success: true,
        message: `Successfully fetched ${vclusters.length} vClusters.`,
        count: vclusters.length,
        vclusters,
      }
      return formattedResponse
    } else {
      // vc_tools.py:74-81 — error branch
      return {
        success: false,
        message: `API request failed: ${responseData["message"] ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    // vc_tools.py:84-91 — exception handler
    logger.error({ err: e }, "Error in list_vcluster")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// handleCreateVcluster — vc_tools.py:94-183
// ---------------------------------------------------------------------------
async function handleCreateVcluster(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // vc_tools.py:103-111 — extract params
    const workspaceId =
      (arguments_["workspace_id"] as number | string | undefined) ?? config.workspaceId
    const vcName = arguments_["vc_name"] as string | undefined
    let vcType = arguments_["vc_type"] as string | undefined

    let minSize = arguments_["min_size"] as number | undefined
    let maxSize = arguments_["max_size"] as number | undefined
    let apMaxConcurrency = arguments_["ap_max_concurrency"] as number | undefined
    let apSize = arguments_["ap_size"] as number | undefined

    // vc_tools.py:113-118 — validate required fields
    if (!workspaceId) {
      throw new Error("Missing required fields: workspace_id")
    }
    if (!vcName) {
      throw new Error("Missing required fields: vc_name")
    }
    if (!vcType) {
      throw new Error("Missing required fields: vc_type")
    }

    // vc_tools.py:120-141 — normalize vc_type and apply defaults per type
    vcType = vcType.toUpperCase()
    if (vcType === "GENERAL") {
      if (minSize == null) minSize = 1
      if (maxSize == null) maxSize = 2
    } else if (vcType === "INTEGRATION") {
      if (minSize == null) minSize = 0.25
      if (maxSize == null) maxSize = 1
    } else if (vcType === "ANALYTICS") {
      if (minSize == null) minSize = 1
      if (maxSize == null) maxSize = 2
      if (apMaxConcurrency == null) apMaxConcurrency = 16
      if (apSize == null) apSize = 2
    } else {
      throw new Error("vc_type must be one of GENERAL, INTEGRATION, ANALYTICS")
    }

    // vc_tools.py:143-157 — call the API
    const responseRaw = await apiVcCreate(config, {
      workspaceId,
      vcName,
      vcType,
      minSize,
      maxSize,
      apMaxConcurrency,
      apSize,
    })
    const responseData = normalizeApiResponse(responseRaw)

    // vc_tools.py:160-167 — success branch
    if (responseData["code"] === "200") {
      const data = responseData["data"] ?? {}
      return {
        success: true,
        message: `Successfully created vCluster '${vcName}'.`,
        vcluster: data,
      }
    }

    // vc_tools.py:169-175 — error branch
    return {
      success: false,
      message: `API request failed: ${responseData["message"] ?? "Unknown error"}`,
      code: responseData["code"],
      raw_response: responseData,
    }
  } catch (e) {
    // vc_tools.py:176-183 — exception handler
    logger.error({ err: e }, "Error in create_vcluster")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// registerVcTools — vc_tools.py:186-280
// ---------------------------------------------------------------------------
export function registerVcTools(registry: ToolRegistry, db: LakehouseDB): void {
  const getConfig = () => {
    if (!db.connectionConfig) throw new Error("No connection configuration available")
    return db.connectionConfig
  }

  const tools: ToolDefinition[] = [
    // vc_tools.py:186-219 — list_vcluster tool definition
    {
      name: "list_vcluster",
      description:
        "List all available virtual clusters (vClusters) under a specific workspace and instance " +
        "in Clickzetta Studio. This tool queries the Clickzetta LakeConsole API to retrieve environment " +
        "cluster information associated with a given workspaceId and instanceId.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Optional fuzzy filter for vCluster name. Returns only clusters whose names contain this value.",
          },
        },
        additionalProperties: false,
        required: [],
      },
      handler: async (args: Record<string, unknown>) => handleListVcluster(args, getConfig()),
      tags: ["studio", "vcluster"],
      samples: [
        {
          description: "List all vClusters whose names contain 'sync'",
          query: { name: "sync" },
        },
      ],
    },
    // vc_tools.py:222-280 — create_vcluster tool definition
    {
      name: "create_vcluster",
      description:
        "Create a new virtual cluster (vCluster) in the current Clickzetta workspace. " +
        "Supports vc types GENERAL, INTEGRATION, and ANALYTICS. " +
        "min_size and max_size are optional. " +
        "For GENERAL: min_size defaults to 1, max_size supports 1-4 and defaults to 2. " +
        "For INTEGRATION: min_size defaults to 0.25, max_size supports 1-2 and defaults to 1, where 2 is the maximum. " +
        "For ANALYTICS: min_size defaults to 1, max_size defaults to 2, ap_max_concurrency defaults to 16, and ap_size defaults to 2.",
      inputSchema: {
        type: "object",
        properties: {
          vc_name: {
            type: "string",
            description: "Name of the vCluster to create. MUST in upper case",
          },
          vc_type: {
            type: "string",
            description: "vCluster type, such as INTEGRATION, GENERAL, or ANALYTICS.",
          },
          min_size: {
            type: "number",
            description:
              "Optional minimum size/replicas. Supports decimals such as 0.25 for INTEGRATION. Defaults: GENERAL=1, INTEGRATION=0.25, ANALYTICS=1.",
          },
          max_size: {
            type: "number",
            description:
              "Optional maximum size/replicas. Defaults: GENERAL=2 with allowed range 1-4, INTEGRATION=1 with allowed range 1-2, ANALYTICS=2.",
          },
          ap_max_concurrency: {
            type: "integer",
            description:
              "Optional ANALYTICS-only setting: maximum concurrency. Default is 16.",
          },
          ap_size: {
            type: "integer",
            description: "Optional ANALYTICS-only setting: AP compute size. Default is 2.",
          },
        },
        additionalProperties: false,
        required: ["vc_name", "vc_type"],
      },
      handler: async (args: Record<string, unknown>) => handleCreateVcluster(args, getConfig()),
      tags: ["studio", "vcluster"],
      samples: [
        {
          description: "Create an integration vCluster for data sync workloads",
          query: {
            vc_name: "sync_vc_prod",
            vc_type: "INTEGRATION",
            min_size: 0.25,
            max_size: 1,
          },
        },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering vCluster tools")
  registry.registerTools(tools)
}
