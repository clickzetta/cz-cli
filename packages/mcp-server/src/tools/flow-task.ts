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
// handleRemoveFlowNode — flow_task_tools.py:176-203
// ---------------------------------------------------------------------------
async function handleRemoveFlowNode(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const fileId = arguments_["task_id"] as number | undefined
    if (!fileId) {
      return { success: false, message: "task_id is required" }
    }
    const [nodeId, err] = await requireNodeName(arguments_, "node_name", fileId, config)
    if (err) {
      return { success: false, message: err }
    }
    const response = await apiFlowRemoveNode(config, { fileId, nodeId: nodeId! })
    return parseFlowResponse(response, "Flow node removed successfully")
  } catch (e) {
    logger.error({ err: e }, "Error in remove_flow_node")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// handleBindFlowNode — flow_task_tools.py:206-245
// ---------------------------------------------------------------------------
async function handleBindFlowNode(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const dataFileId = arguments_["task_id"] as number | undefined
    if (!dataFileId) {
      return { success: false, message: "task_id is required" }
    }
    const [upstreamNodeId, upstreamErr] = await requireNodeName(
      arguments_, "upstream_node_name", dataFileId, config,
    )
    if (upstreamErr) {
      return { success: false, message: `upstream: ${upstreamErr}` }
    }
    const [downstreamNodeId, downstreamErr] = await requireNodeName(
      arguments_, "downstream_node_name", dataFileId, config,
    )
    if (downstreamErr) {
      return { success: false, message: `downstream: ${downstreamErr}` }
    }
    const response = await apiFlowBindNode(config, {
      currentFileId: (arguments_["downstream_file_id"] as number | undefined) ?? dataFileId,
      currentNodeId: downstreamNodeId!,
      currentProjectId:
        (arguments_["downstream_project_id"] as string | undefined) ?? config.projectId,
      dependencyFileId: (arguments_["upstream_file_id"] as number | undefined) ?? dataFileId,
      dependencyNodeId: upstreamNodeId!,
      dependencyProjectId:
        (arguments_["upstream_project_id"] as string | undefined) ?? config.projectId,
    })
    return parseFlowResponse(response, "Flow nodes bound successfully")
  } catch (e) {
    logger.error({ err: e }, "Error in bind_flow_node")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// handleUnbindFlowNode — flow_task_tools.py:248-271
// ---------------------------------------------------------------------------
async function handleUnbindFlowNode(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const depId = arguments_["dependency_id"] as number | undefined
    const fileId = arguments_["task_id"] as number | undefined
    if (!depId || !fileId) {
      return { success: false, message: "task_id and dependency_id are required" }
    }
    const response = await apiFlowUnbindNode(config, { depId, fileId })
    return parseFlowResponse(response, "Flow node dependency unbound successfully")
  } catch (e) {
    logger.error({ err: e }, "Error in unbind_flow_node")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// handleSubmitFlow — flow_task_tools.py:274-297
// Mirrors submit_flow_and_wait: submit then poll for completion.
// flow_task_server.py:258-286 — FlowSubmitStatusEnum: 0=INIT,1=SUBMITTING,2=SUCCESS,3=FAILED
// ---------------------------------------------------------------------------
async function handleSubmitFlow(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const fileId = arguments_["task_id"] as number | undefined
    if (!fileId) {
      return { success: false, message: "task_id is required" }
    }
    const submitResponse = await apiFlowSubmit(config, {
      fileId,
      projectId: (arguments_["project_id"] as string | undefined) ?? config.projectId,
    })
    const submitData = JSON.parse(submitResponse) as Record<string, unknown>
    if (String(submitData["code"]) !== "200") {
      return parseFlowResponse(submitResponse, "Flow submitted successfully")
    }
    const traceId = submitData["data"] as string | undefined
    if (!traceId) {
      return parseFlowResponse(submitResponse, "Flow submitted successfully")
    }
    // Poll for completion — flow_task_server.py:271-286
    const maxWait = 60_000
    const pollInterval = 3_000
    const start = Date.now()
    while (Date.now() - start < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
      const statusResponse = await apiFlowCheckSubmitStatus(config, traceId)
      const statusData = JSON.parse(statusResponse) as Record<string, unknown>
      if (String(statusData["code"]) === "200") {
        const status = statusData["data"] as number
        if (status === 2) {
          return { success: true, message: "Flow submitted successfully", data: { submitTraceId: traceId } }
        } else if (status === 3) {
          return { success: false, message: "Flow submit failed", data: { submitTraceId: traceId } }
        }
      }
    }
    return { success: false, message: `Submit timeout after ${maxWait / 1000}s`, data: { submitTraceId: traceId } }
  } catch (e) {
    logger.error({ err: e }, "Error in submit_flow")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// handleGetFlowNodeDetail — flow_task_tools.py:300-323
// ---------------------------------------------------------------------------
async function handleGetFlowNodeDetail(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const flowTaskId = arguments_["task_id"] as number | undefined
    const nodeId = arguments_["node_id"] as number | undefined
    if (!flowTaskId || !nodeId) {
      return { success: false, message: "task_id and node_id are required" }
    }
    const response = await apiFlowGetNodeDetail(config, { dataFileId: flowTaskId, nodeId })
    return parseFlowResponse(response, "Node detail retrieved successfully")
  } catch (e) {
    logger.error({ err: e }, "Error in get_flow_node_detail")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// handleSaveNodeContent — flow_task_tools.py:326-356
// ---------------------------------------------------------------------------
async function handleSaveNodeContent(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const flowTaskId = arguments_["task_id"] as number | undefined
    const nodeId = arguments_["node_id"] as number | undefined
    const content = arguments_["content"] as string | undefined
    if (!flowTaskId || !nodeId) {
      return { success: false, message: "task_id and node_id are required" }
    }
    if (content == null) {
      return { success: false, message: "content is required" }
    }
    const response = await apiFlowSaveNodeContent(config, {
      dataFileId: flowTaskId,
      nodeId,
      content,
      projectId: (arguments_["project_id"] as string | undefined) ?? config.projectId,
      paramValueList: arguments_["param_value_list"] as unknown[] | undefined,
      userName: config.username,
      userId: config.userId != null ? String(config.userId) : undefined,
    })
    return parseFlowResponse(response, "Node content saved successfully")
  } catch (e) {
    logger.error({ err: e }, "Error in save_node_content")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// handleSaveNodeConfiguration — flow_task_tools.py:359-411
// ---------------------------------------------------------------------------
async function handleSaveNodeConfiguration(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const flowTaskId = arguments_["task_id"] as number | undefined
    const nodeId = arguments_["node_id"] as number | undefined
    if (!flowTaskId) {
      return { success: false, message: "task_id (flow task ID) is required" }
    }
    if (!nodeId) {
      return { success: false, message: "node_id is required" }
    }
    // flow_task_tools.py:376-386 — fetch node detail to get defaults
    const detailResponse = await apiFlowGetNodeDetail(config, { dataFileId: flowTaskId, nodeId })
    const detailData = JSON.parse(detailResponse) as Record<string, unknown>
    if (String(detailData["code"]) !== "200") {
      return {
        success: false,
        message: `Failed to get node detail: ${(detailData["message"] as string | undefined) ?? "Unknown error"}`,
      }
    }
    const nodeDetail = (detailData["data"] ?? {}) as Record<string, unknown>
    // flow_task_tools.py:390-392 — use node detail defaults, allow user override
    const schemaName =
      (arguments_["schema_name"] as string | undefined) ??
      (nodeDetail["defaultSchemaName"] as string | undefined) ??
      "public"
    const etlVcCode =
      (arguments_["etl_vc_code"] as string | undefined) ??
      (nodeDetail["defaultVcName"] as string | undefined) ??
      "DEFAULT"
    const etlVcId = arguments_["etl_vc_id"] as string | undefined
    const response = await apiFlowSaveNodeConfiguration(config, {
      dataFileId: flowTaskId,
      nodeId,
      projectId: (arguments_["project_id"] as string | undefined) ?? config.projectId,
      schemaName,
      etlVcCode,
      etlVcId,
      userName: config.username,
      userId: config.userId != null ? String(config.userId) : undefined,
    })
    return parseFlowResponse(response, "Node configuration saved successfully")
  } catch (e) {
    logger.error({ err: e }, "Error in save_node_configuration")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// INSTANCE_STATUS_MAP — flow_task_tools.py:414-424
// ---------------------------------------------------------------------------
const INSTANCE_STATUS_MAP: Record<number, string> = {
  [-1]: "disabled(已下线)",
  1: "success(运行成功)",
  2: "un_execute(未运行)",
  3: "fail(运行失败)",
  4: "executing(运行中)",
  5: "waiting_queue(等待队列资源中)",
  6: "waiting_dependency(等待上游节点运行完成)",
  7: "stop(已暂停)",
  8: "waiting_dependency_success(上游节点运行失败阻塞运行)",
}

// ---------------------------------------------------------------------------
// handleListFlowNodeInstances — flow_task_tools.py:427-470
// ---------------------------------------------------------------------------
async function handleListFlowNodeInstances(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    const flowId = arguments_["flow_id"] as number | undefined
    const flowInstanceId = arguments_["flow_instance_id"] as number | undefined
    if (!flowId || !flowInstanceId) {
      return { success: false, message: "flow_id and flow_instance_id are required" }
    }
    const response = await apiFlowListNodeInstances(config, {
      flowId,
      flowInstanceId,
      flowNodeId: arguments_["flow_node_id"] as number | undefined,
      flowNodeInstanceId: arguments_["flow_node_instance_id"] as number | undefined,
    })
    const responseData = JSON.parse(response) as Record<string, unknown>
    if (String(responseData["code"]) === "200") {
      const instances = (responseData["data"] ?? []) as Record<string, unknown>[]
      // flow_task_tools.py:452-455 — translate instanceStatus to readable name
      for (const inst of instances) {
        const status = inst["instanceStatus"] as number | undefined
        if (status != null) {
          inst["instanceStatusName"] = INSTANCE_STATUS_MAP[status] ?? `unknown(${status})`
        }
      }
      return {
        success: true,
        message: `Found ${instances.length} node instance(s)`,
        data: instances,
      }
    }
    return {
      success: false,
      message: `API failed: ${(responseData["message"] as string | undefined) ?? "Unknown error"}`,
      code: responseData["code"],
    }
  } catch (e) {
    logger.error({ err: e }, "Error in list_flow_node_instances")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Routing hint constants — flow_task_tools.py:473-488
// ---------------------------------------------------------------------------
const FLOW_TOOL_ROUTING_HINT =
  "\n\n⚠️ This tool is ONLY for Flow tasks (组合任务, task_type=500). " +
  "For creating/removing/binding flow nodes, use flow-specific tools. " +
  "For saving node content, use save_non_integration_task_content with the node's data_file_id. " +
  "For saving node schedule config, use save_task_configuration with the node's task_id."

const FLOW_WORKFLOW_HINT =
  "\n\n**Flow Workflow:** " +
  "1) create_task(task_type=500) → get flow task_id; " +
  "2) create_flow_node → add nodes (returns node data_file_id); " +
  "3) bind_flow_node → set dependencies (or use dependency_node_name in step 2); " +
  "4) save_node_content → write SQL/code to each node using node's node_id; " +
  "5) save_node_configuration → configure vs and schema for each node; " +
  "6) submit_flow → publish/deploy the flow."

// ---------------------------------------------------------------------------
// registerFlowTaskTools — flow_task_tools.py:491-859
// ---------------------------------------------------------------------------
export function registerFlowTaskTools(registry: ToolRegistry, db: LakehouseDB): void {
  const getConfig = () => {
    if (!db.connectionConfig) throw new Error("No connection configuration available")
    return db.connectionConfig
  }

  const tools: ToolDefinition[] = [
    // flow_task_tools.py:494-523 — get_flow_dag
    {
      name: "get_flow_dag",
      description:
        "**When to Use:** User asks to view, check, or inspect the structure/nodes/dependencies " +
        "of a Flow task (组合任务/工作流), e.g.:\n" +
        "- '查看组合任务结构', '这个flow有哪些节点', 'show me the flow DAG'\n" +
        "- '组合任务的依赖关系是什么', 'what nodes are in this flow'\n" +
        "- Before bind_flow_node/remove_flow_node to look up node names\n\n" +
        "Get the DAG (Directed Acyclic Graph) structure of a Flow task (组合任务). " +
        "Returns all nodes (with nodeId, nodeName, fileType) and their dependency edges. " +
        "A Flow task is created via create_task with task_type=500. " +
        "The returned task_id is used as the task_id parameter for all flow node operations." +
        FLOW_TOOL_ROUTING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "REQUIRED. The ID of the flow task (obtained from create_task response).",
          },
        },
        required: ["task_id"],
      },
      handler: async (args: Record<string, unknown>) => handleGetFlowDag(args, getConfig()),
      tags: ["studio", "flow", "read"],
      samples: [
        { description: "查看组合任务12345的DAG结构", query: { task_id: 12345 } },
      ],
    },
    // flow_task_tools.py:524-577 — create_flow_node
    {
      name: "create_flow_node",
      description:
        "**When to Use:** User asks to add a node/step/subtask to a Flow task (组合任务/工作流), e.g.:\n" +
        "- '给组合任务添加一个SQL节点', '在flow里新建一个Python步骤'\n" +
        "- '添加flow子任务', 'add a node to the flow'\n" +
        "- '创建组合任务节点', 'create a flow step'\n\n" +
        "❌ Do NOT use task_management_operation/save_content to create flow nodes.\n\n" +
        "Create a new node (子节点/子任务) in a Flow task (组合任务). " +
        "A flow node represents a sub-task within the flow. " +
        "Supported node types: sql (default), python, shell, data_integration, jdbc, virtual, continuous_job, spark. " +
        "Use dependency_node_name to set execution order between nodes." +
        FLOW_WORKFLOW_HINT +
        FLOW_TOOL_ROUTING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "REQUIRED. The flow task ID (obtained from create_task response with task_type=500).",
          },
          node_name: {
            type: "string",
            description: "REQUIRED. Name of the new node.",
          },
          node_type: {
            type: "string",
            description: "Type of the node. Options: sql, python, shell, data_integration, jdbc, virtual, continuous_job, spark. Default: sql.",
            enum: ["sql", "python", "shell", "data_integration", "jdbc", "virtual", "continuous_job", "spark"],
            default: "sql",
          },
          node_description: {
            type: "string",
            description: "Optional description for the node.",
          },
          dependency_node_name: {
            type: "string",
            description: "Optional. Name of an existing node that this new node should depend on (run after).",
          },
          content: {
            type: "string",
            description: "Optional. Initial SQL/code content for the node.",
          },
        },
        required: ["task_id", "node_name"],
      },
      handler: async (args: Record<string, unknown>) => handleCreateFlowNode(args, getConfig()),
      tags: ["studio", "flow", "write"],
      samples: [
        { description: "给flow添加一个SQL节点", query: { task_id: 12345, node_name: "extract_data" } },
        { description: "创建Python节点并依赖extract_data", query: { task_id: 12345, node_name: "transform", node_type: "python", dependency_node_name: "extract_data" } },
      ],
    },
    // flow_task_tools.py:578-605 — remove_flow_node
    {
      name: "remove_flow_node",
      description:
        "**When to Use:** User asks to delete/remove a node from a Flow task (组合任务), e.g.:\n" +
        "- '删除组合任务里的某个节点', 'remove a node from the flow'\n" +
        "- '把flow里的xxx节点去掉'\n\n" +
        "Remove a node (子节点) from a Flow task (组合任务/工作流). " +
        "This will also remove all dependencies associated with the node. " +
        "Use get_flow_dag first to find the exact node name." +
        FLOW_TOOL_ROUTING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "REQUIRED. The flow task ID.",
          },
          node_name: {
            type: "string",
            description: "REQUIRED. The name of the node to remove. Use get_flow_dag to find available node names.",
          },
        },
        required: ["task_id", "node_name"],
      },
      handler: async (args: Record<string, unknown>) => handleRemoveFlowNode(args, getConfig()),
      tags: ["studio", "flow", "write"],
      samples: [],
    },
    // flow_task_tools.py:606-641 — bind_flow_node
    {
      name: "bind_flow_node",
      description:
        "**When to Use:** User asks to add a dependency/edge between two nodes in a Flow task (组合任务), e.g.:\n" +
        "- '给flow节点添加依赖', '设置节点执行顺序'\n" +
        "- '让A节点在B节点之后执行', 'add dependency between flow nodes'\n" +
        "- '连接两个flow节点', 'set execution order'\n\n" +
        "Create a dependency edge: upstream_node runs first → then downstream_node. " +
        "Both nodes must already exist in the same flow. " +
        "Alternatively, use dependency_node_name in create_flow_node to set dependencies at creation time." +
        FLOW_TOOL_ROUTING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "REQUIRED. The flow task ID.",
          },
          upstream_node_name: {
            type: "string",
            description: "REQUIRED. Name of the node that runs FIRST (上游节点).",
          },
          downstream_node_name: {
            type: "string",
            description: "REQUIRED. Name of the node that runs AFTER upstream (下游节点).",
          },
        },
        required: ["task_id", "upstream_node_name", "downstream_node_name"],
      },
      handler: async (args: Record<string, unknown>) => handleBindFlowNode(args, getConfig()),
      tags: ["studio", "flow", "write"],
      samples: [
        { description: "设置依赖: extract_data → transform", query: { task_id: 12345, upstream_node_name: "extract_data", downstream_node_name: "transform" } },
      ],
    },
    // flow_task_tools.py:642-668 — unbind_flow_node
    {
      name: "unbind_flow_node",
      description:
        "**When to Use:** User asks to remove a dependency/edge between flow nodes (组合任务), e.g.:\n" +
        "- '删除flow节点之间的依赖', '解除节点依赖关系'\n" +
        "- 'remove dependency between flow nodes'\n\n" +
        "Remove a dependency edge between two nodes in a Flow task (组合任务/工作流). " +
        "Call get_flow_dag first — each dependency in the response has an 'id' field, pass that as dependency_id." +
        FLOW_TOOL_ROUTING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "REQUIRED. The flow task ID.",
          },
          dependency_id: {
            type: "integer",
            description: "REQUIRED. The dependency ID to remove (the 'id' field from dependencies in get_flow_dag result).",
          },
        },
        required: ["task_id", "dependency_id"],
      },
      handler: async (args: Record<string, unknown>) => handleUnbindFlowNode(args, getConfig()),
      tags: ["studio", "flow", "write"],
      samples: [],
    },
    // flow_task_tools.py:669-694 — submit_flow
    {
      name: "submit_flow",
      description:
        "**When to Use:** User asks to submit/publish/deploy a Flow task (组合任务), e.g.:\n" +
        "- '提交组合任务', '发布flow', 'deploy the flow', '上线组合任务'\n" +
        "- 'submit the flow task', '发布工作流'\n\n" +
        "❌ Do NOT use publish_task for Flow tasks — use this tool instead.\n\n" +
        "Submit/publish a Flow task (组合任务/工作流) for deployment and scheduling. " +
        "Automatically polls for completion status. " +
        "All nodes should be properly configured before submitting." +
        FLOW_WORKFLOW_HINT +
        FLOW_TOOL_ROUTING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "REQUIRED. The flow task ID to submit.",
          },
        },
        required: ["task_id"],
      },
      handler: async (args: Record<string, unknown>) => handleSubmitFlow(args, getConfig()),
      tags: ["studio", "flow", "write"],
      samples: [],
    },
    // flow_task_tools.py:695-725 — get_flow_node_detail
    {
      name: "get_flow_node_detail",
      description:
        "**When to Use:** User asks to view the detail/content of a flow node (查看组合任务节点详情), e.g.:\n" +
        "- '查看flow节点内容', '获取组合任务节点详情'\n" +
        "- 'get flow node detail', 'show node content'\n\n" +
        "Get detail of a specific node within a Flow task (组合任务), including " +
        "fileContent, defaultSchemaName, defaultVcName, ownerCnName, hasConfig, etc. " +
        "Use get_flow_dag first to find the node_id." +
        FLOW_TOOL_ROUTING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "REQUIRED. The flow task ID (the parent flow's dataFileId).",
          },
          node_id: {
            type: "integer",
            description: "REQUIRED. The node ID (the 'id' field from get_flow_dag).",
          },
        },
        required: ["task_id", "node_id"],
      },
      handler: async (args: Record<string, unknown>) => handleGetFlowNodeDetail(args, getConfig()),
      tags: ["studio", "flow", "read"],
      samples: [
        { description: "查看flow节点详情", query: { task_id: 13262001, node_id: 13265002 } },
      ],
    },
    // flow_task_tools.py:726-772 — save_node_content
    {
      name: "save_node_content",
      description:
        "**When to Use:** User asks to save SQL/code content to a flow node (保存组合任务节点内容), e.g.:\n" +
        "- '给flow节点写SQL', '保存组合任务节点代码'\n" +
        "- 'save content to flow node', 'write SQL to flow node'\n\n" +
        "Save SQL/Shell/Python content to a specific node within a Flow task (组合任务). " +
        "Use get_flow_dag first to find the node_id. " +
        "Supports parameterized content via param_value_list.\n\n" +
        "**IMPORTANT:** Preserve actual newline characters (\\n) as line breaks in content." +
        FLOW_TOOL_ROUTING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "REQUIRED. The flow task ID (the parent flow's dataFileId).",
          },
          node_id: {
            type: "integer",
            description: "REQUIRED. The node ID (the 'id' field from get_flow_dag).",
          },
          content: {
            type: "string",
            description: "REQUIRED. SQL/Shell/Python content to save to the node.",
          },
          param_value_list: {
            type: "array",
            description: "Optional. Parameter key-value pairs for dynamic variables.",
            items: {
              type: "object",
              properties: {
                paramKey: { type: "string", description: "Parameter name." },
                paramValue: { type: "string", description: "Parameter value or expression." },
              },
            },
          },
        },
        required: ["task_id", "node_id", "content"],
      },
      handler: async (args: Record<string, unknown>) => handleSaveNodeContent(args, getConfig()),
      tags: ["studio", "flow", "write"],
      samples: [
        { description: "给flow节点保存SQL", query: { task_id: 13262001, node_id: 13265003, content: "select 1;" } },
      ],
    },
    // flow_task_tools.py:773-816 — save_node_configuration
    {
      name: "save_node_configuration",
      description:
        "**When to Use:** User asks to save/configure the schedule of a flow node (组合任务节点调度配置), e.g.:\n" +
        "- '给flow节点配置调度', '保存组合任务节点配置'\n" +
        "- 'configure flow node', 'save flow node config'\n\n" +
        "Save schedule configuration for a specific node within a Flow task (组合任务). " +
        "Automatically fetches node defaults (schema, vc) from getDetail API. " +
        "Most scheduling parameters use sensible defaults (daily, retry=1, etc.). " +
        "Use get_flow_dag first to find the node_id." +
        FLOW_TOOL_ROUTING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "integer",
            description: "REQUIRED. The flow task ID (the parent flow's dataFileId).",
          },
          node_id: {
            type: "integer",
            description: "REQUIRED. The node ID (the 'id' field from get_flow_dag).",
          },
          schema_name: {
            type: "string",
            description: "Optional. Database schema. Auto-filled from node detail if not provided.",
          },
          etl_vc_code: {
            type: "string",
            description: "Optional. Virtual cluster name. Auto-filled from node detail if not provided.",
          },
          etl_vc_id: {
            type: "string",
            description: "Optional. Virtual cluster ID.",
          },
        },
        required: ["task_id", "node_id"],
      },
      handler: async (args: Record<string, unknown>) => handleSaveNodeConfiguration(args, getConfig()),
      tags: ["studio", "flow", "write"],
      samples: [
        { description: "保存flow节点配置", query: { task_id: 13262001, node_id: 13265003 } },
      ],
    },
    // flow_task_tools.py:817-858 — list_flow_node_instances
    {
      name: "list_flow_node_instances",
      description:
        "**When to Use:** User asks to check the run status of nodes within a flow instance (组合任务节点运行状态), e.g.:\n" +
        "- '查看组合任务各节点的运行情况', '这次flow跑的怎么样'\n" +
        "- 'show flow node instance status', 'which nodes failed in this flow run'\n" +
        "- '组合任务节点执行详情', 'flow node execution details'\n\n" +
        "List all node instances of a specific flow run (组合任务运行实例) with detailed execution info. " +
        "Returns each node's status (waiting/running/success/failed/killed/timeout/skipped), " +
        "start/end times, failure messages, retry count, etc. " +
        "Requires flow_id (the flow task's flowId) and flow_instance_id (a specific run instance). " +
        "Optionally filter by flow_node_id or flow_node_instance_id." +
        FLOW_TOOL_ROUTING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          flow_id: {
            type: "integer",
            description: "REQUIRED. The flow ID (flowId from get_flow_dag node data).",
          },
          flow_instance_id: {
            type: "integer",
            description: "REQUIRED. The flow instance ID (a specific run/execution of the flow).",
          },
          flow_node_id: {
            type: "integer",
            description: "Optional. Filter by a specific flow node ID.",
          },
          flow_node_instance_id: {
            type: "integer",
            description: "Optional. Filter by a specific flow node instance ID.",
          },
        },
        required: ["flow_id", "flow_instance_id"],
      },
      handler: async (args: Record<string, unknown>) => handleListFlowNodeInstances(args, getConfig()),
      tags: ["studio", "flow", "read"],
      samples: [
        { description: "查看flow运行实例的各节点状态", query: { flow_id: 13262001, flow_instance_id: 99001 } },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering flow-task tools")
  registry.registerTools(tools)
}
