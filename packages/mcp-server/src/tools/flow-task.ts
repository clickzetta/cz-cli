/**
 * Flow Task tools — port of cz-mcp-server/cz_mcp/tools/flow_task_tools.py
 *
 * Python → TS mapping:
 *   flow_task_tools.py:21-32   NODE_TYPE_MAP                  → NODE_TYPE_MAP
 *   flow_task_tools.py:35-48   _resolve_node_type()           → resolveNodeType()
 *   flow_task_tools.py:51-74   _resolve_node_name()           → resolveNodeName()
 *   flow_task_tools.py:77-82   _require_node_name()           → requireNodeName()
 *   flow_task_tools.py:85-99   _parse_response()              → parseFlowResponse()
 *   flow_task_tools.py:102-123 handle_get_flow_dag()          → handleGetFlowDag()
 *   flow_task_tools.py:126-173 handle_create_flow_node()      → handleCreateFlowNode()
 *   flow_task_tools.py:176-203 handle_remove_flow_node()      → handleRemoveFlowNode()
 *   flow_task_tools.py:206-245 handle_bind_flow_node()        → handleBindFlowNode()
 *   flow_task_tools.py:248-271 handle_unbind_flow_node()      → handleUnbindFlowNode()
 *   flow_task_tools.py:274-297 handle_submit_flow()           → handleSubmitFlow()
 *   flow_task_tools.py:300-323 handle_get_flow_node_detail()  → handleGetFlowNodeDetail()
 *   flow_task_tools.py:326-356 handle_save_node_content()     → handleSaveNodeContent()
 *   flow_task_tools.py:359-411 handle_save_node_configuration() → handleSaveNodeConfiguration()
 *   flow_task_tools.py:414-424 INSTANCE_STATUS_MAP            → INSTANCE_STATUS_MAP
 *   flow_task_tools.py:427-470 handle_list_flow_node_instances() → handleListFlowNodeInstances()
 *   flow_task_tools.py:491-859 get_flow_task_tools()          → registerFlowTaskTools()
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import {
  apiFlowGetDag,
  apiFlowCreateNode,
  apiFlowBindNode,
  apiFlowUnbindNode,
  apiFlowRemoveNode,
  apiFlowSubmit,
  apiFlowCheckSubmitStatus,
  apiFlowListNodeInstances,
  apiFlowSaveNodeContent,
  apiFlowGetNodeDetail,
  apiFlowSaveNodeConfiguration,
} from "./studio-api.js"

// ---------------------------------------------------------------------------
// NODE_TYPE_MAP — flow_task_tools.py:21-32
// AI-friendly node type mapping: string name → FileType integer
// ---------------------------------------------------------------------------
const NODE_TYPE_MAP: Record<string, number> = {
  sql: 4,
  shell: 5,
  python: 7,
  data_integration: 1,
  jdbc: 15,
  virtual: 0,
  continuous_job: 17,
  spark: 400,
}

const NODE_TYPE_NAMES = Object.entries(NODE_TYPE_MAP)
  .map(([k, v]) => `${k}(${v})`)
  .join(", ")

// ---------------------------------------------------------------------------
// resolveNodeType — flow_task_tools.py:35-48
// ---------------------------------------------------------------------------
function resolveNodeType(fileType: unknown): number {
  if (typeof fileType === "number") return fileType
  if (typeof fileType === "string") {
    const lower = fileType.toLowerCase().trim()
    if (lower in NODE_TYPE_MAP) return NODE_TYPE_MAP[lower]!
    const parsed = parseInt(lower, 10)
    if (!isNaN(parsed)) return parsed
  }
  throw new Error(`Unknown node type '${fileType}'. Supported: ${NODE_TYPE_NAMES}`)
}

// ---------------------------------------------------------------------------
// resolveNodeName — flow_task_tools.py:51-74
// Resolve a node name to its node ID by fetching the DAG.
// Returns [nodeId, errorMsg] — one of them is null.
// ---------------------------------------------------------------------------
async function resolveNodeName(
  dataFileId: number,
  nodeName: string,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<[number | null, string | null]> {
  const response = await apiFlowGetDag(config, dataFileId)
  const data = JSON.parse(response) as Record<string, unknown>
  if (String(data["code"]) !== "200") {
    return [null, `Failed to fetch DAG: ${(data["message"] as string | undefined) ?? "Unknown error"}`]
  }
  const dag = data["data"]
  let nodes: Record<string, unknown>[]
  if (Array.isArray(dag)) {
    nodes = dag as Record<string, unknown>[]
  } else {
    nodes = ((dag as Record<string, unknown>)?.["nodes"] as Record<string, unknown>[] | undefined) ?? []
  }
  const matched = nodes.filter((n) => n["fileName"] === nodeName)
  if (matched.length === 1) {
    return [matched[0]!["id"] as number, null]
  }
  if (matched.length === 0) {
    const available = nodes.map((n) => n["fileName"])
    return [null, `Node '${nodeName}' not found. Available nodes: ${JSON.stringify(available)}`]
  }
  return [null, `Multiple nodes named '${nodeName}' found. Use node_id instead.`]
}

// ---------------------------------------------------------------------------
// requireNodeName — flow_task_tools.py:77-82
// ---------------------------------------------------------------------------
async function requireNodeName(
  arguments_: Record<string, unknown>,
  nameKey: string,
  dataFileId: number,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<[number | null, string | null]> {
  const nodeName = arguments_[nameKey] as string | undefined
  if (!nodeName) return [null, `${nameKey} is required`]
  return resolveNodeName(dataFileId, nodeName, config)
}

// ---------------------------------------------------------------------------
// parseFlowResponse — flow_task_tools.py:85-99
// ---------------------------------------------------------------------------
function parseFlowResponse(
  responseText: string,
  successMsg: string,
): Record<string, unknown> {
  const responseData = JSON.parse(responseText) as Record<string, unknown>
  if (String(responseData["code"]) === "200") {
    return {
      success: true,
      message: successMsg,
      data: responseData["data"],
    }
  }
  return {
    success: false,
    message: `API failed: ${(responseData["message"] as string | undefined) ?? "Unknown error"}`,
    code: responseData["code"],
  }
}

// ---------------------------------------------------------------------------
// handleGetFlowDag — flow_task_tools.py:102-123
// ---------------------------------------------------------------------------
async function handleGetFlowDag(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const dataFileId = arguments_["task_id"] as number | undefined
    if (!dataFileId) {
      return { success: false, message: "task_id is required" }
    }
    const response = await apiFlowGetDag(config, dataFileId)
    return parseFlowResponse(response, "Flow DAG retrieved successfully")
  } catch (e) {
    logger.error({ err: e }, "Error in get_flow_dag")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// handleCreateFlowNode — flow_task_tools.py:126-173
// ---------------------------------------------------------------------------
async function handleCreateFlowNode(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const dataFileId = arguments_["task_id"] as number | undefined
    const nodeName = arguments_["node_name"] as string | undefined
    if (!dataFileId || !nodeName) {
      return { success: false, message: "task_id and node_name are required" }
    }

    // flow_task_tools.py:141-146 — resolve node type, default to sql
    const rawType = arguments_["node_type"] ?? "sql"
    let fileType: number
    try {
      fileType = resolveNodeType(rawType)
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }

    // flow_task_tools.py:148-155 — resolve dependency by name
    let depNodeId: number | undefined
    const depNodeName = arguments_["dependency_node_name"] as string | undefined
    if (depNodeName) {
      const [resolvedId, err] = await resolveNodeName(dataFileId, depNodeName, config)
      if (err) {
        return { success: false, message: `dependency: ${err}` }
      }
      depNodeId = resolvedId ?? undefined
    }

    const response = await apiFlowCreateNode(config, {
      dataFileId,
      projectId: (arguments_["project_id"] as string | undefined) ?? config.projectId,
      nodeName,
      fileType,
      nodeDescription: arguments_["node_description"] as string | undefined,
      dependencyNodeId: depNodeId,
      position: arguments_["position"],
      content: arguments_["content"] as string | undefined,
    })
    return parseFlowResponse(response, "Flow node created successfully")
  } catch (e) {
    logger.error({ err: e }, "Error in create_flow_node")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// registerFlowTaskTools — flow_task_tools.py:491-859
// TODO: Full tool definitions to be completed in a follow-up
// ---------------------------------------------------------------------------
export function registerFlowTaskTools(_registry: ToolRegistry, _db: LakehouseDB): void {
  // Placeholder — full tool definitions pending
}
