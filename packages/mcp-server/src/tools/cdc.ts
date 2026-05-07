/**
 * CDC real-time task tools — port of cz-mcp-server/cz_mcp/tools/cdc_realtime_tools.py
 *
 * Python → TS mapping:
 *   cdc_realtime_tools.py:19-181  handle_save_cdc_realtime_task → handleSaveCdcRealtimeTask()
 *   cdc_realtime_tools.py:184-423 cdc_realtime_tools()          → registerCdcTools()
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import { apiSaveCdcTask, buildHeaders, getBaseUrl, getApiPath, studioPost } from "./studio-api.js"

// ---------------------------------------------------------------------------
// handleSaveCdcRealtimeTask — cdc_realtime_tools.py:19-181
// ---------------------------------------------------------------------------
async function handleSaveCdcRealtimeTask(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  // cdc_realtime_tools.py:25-38 — extract parameters
  const dataFileId = args["data_file_id"] as number | undefined
  const pipelineType = (args["pipeline_type"] as number | undefined) ?? 3
  const saveMode = (args["save_mode"] as number | undefined) ?? 2
  const syncMode = (args["sync_mode"] as number | undefined) ?? 1
  const sourceDatasourceList = (args["source_datasource_list"] as unknown[]) ?? []
  const syncObjectList = (args["sync_object_list"] as unknown[]) ?? []
  const targetDatasource = (args["target_datasource"] as Record<string, unknown>) ?? {}

  const config = db.connectionConfig
  if (!config) {
    return { success: false, message: "Studio configuration is required" }
  }

  // cdc_realtime_tools.py:41-50 — validate data_file_id
  if (!dataFileId) {
    return { success: false, message: "Missing required parameter: data_file_id" }
  }

  // cdc_realtime_tools.py:52-61 — validate source_datasource_list
  if (!sourceDatasourceList || sourceDatasourceList.length === 0) {
    return {
      success: false,
      message:
        "Missing required parameter: source_datasource_list (at least one source datasource required)",
    }
  }

  // cdc_realtime_tools.py:63-72 — validate sync_object_list
  if (!syncObjectList || syncObjectList.length === 0) {
    return {
      success: false,
      message:
        "Missing required parameter: sync_object_list (at least one sync object required)",
    }
  }

  // cdc_realtime_tools.py:74-83 — validate target_datasource
  if (!targetDatasource || Object.keys(targetDatasource).length === 0) {
    return { success: false, message: "Missing required parameter: target_datasource" }
  }

  // cdc_realtime_tools.py:85-98 — validate source datasource types
  const validSourceTypes = new Set([5, 7, 8, 19, 39, 17, 40, 48])
  for (const sourceDs of sourceDatasourceList) {
    const ds = sourceDs as Record<string, unknown>
    const dsType = ds["datasourceType"] as number | undefined
    if (dsType == null || !validSourceTypes.has(dsType)) {
      return {
        success: false,
        message: `Invalid source datasource type: ${dsType}. Only MySQL (5\\19\\39), PostgreSQL (7\\40\\48), and SQL Server (8) are supported.`,
      }
    }
  }

  // cdc_realtime_tools.py:100-112 — validate target datasource type
  const validTargetTypes = new Set([1, 2])
  const targetType = targetDatasource["datasourceType"] as number | undefined
  if (targetType == null || !validTargetTypes.has(targetType)) {
    return {
      success: false,
      message: `Invalid target datasource type: ${targetType}. Only Lakehouse (1) and Kafka (2) are supported.`,
    }
  }

  logger.info({ dataFileId }, "Saving CDC real-time task")

  try {
    // cdc_realtime_tools.py:117-130 — call the API
    const responseText = await apiSaveCdcTask(config, {
      projectId: config.projectId,
      dataFileId,
      pipelineType,
      saveMode,
      syncMode,
      sourceDatasourceList,
      syncObjectList,
      targetDatasource,
    })

    // cdc_realtime_tools.py:133-167 — parse and format response
    const responseData = JSON.parse(responseText) as Record<string, unknown>

    if (responseData["code"] === "200") {
      const data = (responseData["data"] as Record<string, unknown>) ?? {}
      return {
        success: true,
        message: "Successfully saved multi-table real-time CDC task",
        data,
        task_id: dataFileId,
        next_steps: [
          "1. Review the saved CDC configuration",
          "2. Use submit_task to deploy and start the CDC task (CDC tasks run continuously, no scheduling needed)",
          "3. Monitor the task status through Studio UI or task monitoring tools",
        ],
        important_note:
          "CDC real-time tasks are continuous streaming tasks. " +
          "DO NOT use save_task_configuration, execute_task, or list_task_run with CDC tasks. " +
          "These tools are only for batch/scheduled tasks.",
      }
    } else {
      return {
        success: false,
        message: `API request failed: ${(responseData["message"] as string) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error in save_cdc_realtime_task")
    return {
      success: false,
      message: `Internal error: ${err.message}`,
      error_type: err.name,
    }
  }
}

// ---------------------------------------------------------------------------
// registerCdcTools — cdc_realtime_tools.py:184-423
// ---------------------------------------------------------------------------
export function registerCdcTools(registry: ToolRegistry, db: LakehouseDB): void {
  const tools: ToolDefinition[] = [
    // cdc_realtime_tools.py:187-422 — save_cdc_realtime_task
    {
      name: "save_cdc_realtime_task",
      description:
        "Save multi-table real-time CDC (Change Data Capture) task configuration to Clickzetta Studio. " +
        "This tool creates or updates a real-time data synchronization task that continuously captures changes " +
        "from source databases and syncs them to target systems.\n" +
        "\n" +
        "**⚠️ IMPORTANT LIMITATIONS - CDC Real-Time Tasks:**\n" +
        "CDC real-time tasks are CONTINUOUS STREAMING tasks that run 24/7, NOT batch/scheduled tasks.\n" +
        "**DO NOT use these tools with CDC tasks:**\n" +
        "- ❌ save_task_configuration (CDC tasks don't need scheduling - they run continuously)\n" +
        "- ❌ execute_task (CDC tasks are submitted once and run continuously)\n" +
        "- ❌ list_task_run (CDC tasks don't have discrete 'runs' - they stream continuously)\n" +
        "\n" +
        "**Use these tools instead:**\n" +
        "- ✅ submit_task - Deploy and start the CDC task\n" +
        "- ✅ Studio UI - Monitor real-time sync status and metrics\n" +
        "\n" +
        "**Supported Source Datasources:**\n" +
        "- MySQL (type in [5,39,19])\n" +
        "- PostgreSQL (type in [7,40,48])\n" +
        "- SQL Server (type=8)\n" +
        "- TiDB (type=17)\n" +
        "\n" +
        "**Supported Target Datasources:**\n" +
        "- Lakehouse (type=1)\n" +
        "- Kafka (type=2)\n" +
        "\n" +
        "**Key Features:**\n" +
        "- Multi-table synchronization: Sync entire schemas or multiple tables at once\n" +
        "- Real-time CDC: Captures INSERT, UPDATE, DELETE operations in real-time\n" +
        "- No pre-existing target tables required: Tables are created automatically\n" +
        "- Full + Incremental sync: Initial full data load followed by incremental changes\n" +
        "- Continuous operation: Once started, runs 24/7 until manually stopped\n" +
        "\n" +
        "**Prerequisites:**\n" +
        "1. Create a task first using create_task with task_type=281 (CDC_REALTIME)\n" +
        "2. Source database must have CDC/binlog enabled\n" +
        "3. Proper permissions on source and target datasources\n" +
        "\n" +
        "**Workflow:**\n" +
        "Step 1: create_task(task_type=281, task_name='cdc_sync_task') → Get data_file_id\n" +
        "Step 2: **Call this tool** with data_file_id and configuration\n" +
        "Step 3: submit_task(data_file_id=xxx) to deploy and start the CDC task\n" +
        "Step 4: Monitor through Studio UI (CDC tasks run continuously, no scheduling needed)\n" +
        "\n" +
        "⚠️ **Remember:** CDC tasks are streaming tasks. After submit_task, they run continuously. " +
        "Don't try to schedule or execute them like batch tasks!\n" +
        "\n" +
        "**Sync Modes:**\n" +
        "- sync_mode=1: Full + Incremental (recommended) - Initial full load then capture changes\n" +
        "- sync_mode=2: Incremental only - Only capture changes from current point\n",
      inputSchema: {
        type: "object",
        properties: {
          data_file_id: {
            type: "integer",
            description:
              "REQUIRED. The task file ID obtained from create_task. " +
              "This task must be of type 281 (CDC_REALTIME).",
          },
          pipeline_type: {
            type: "integer",
            description:
              "Pipeline type for multi-table real-time sync:\n" +
              "- 1: Multi-table mirror sync (when user specifies specific tables)\n" +
              "- 2: Multi-table merge\n" +
              "- 3: Whole database mirror (when user specifies a database without specific tables)\n" +
              "Default is 3. System will auto-select based on sync_object_list configuration.",
            enum: [1, 2, 3],
            default: 3,
          },
          save_mode: {
            type: "integer",
            description:
              "Save mode for current operation on saved data:\n" +
              "- 1: Overwrite - Replace existing configuration\n" +
              "- 2: Append - Add to existing configuration (recommended for new tasks)\n" +
              "- 3: Modify - Update existing configuration\n" +
              "Default is 2 (append).",
            enum: [1, 2, 3],
            default: 2,
          },
          sync_mode: {
            type: "integer",
            description:
              "Synchronization mode:\n" +
              "- 1: Full + Incremental (recommended) - Performs initial full data load, then captures incremental changes\n" +
              "- 2: Incremental only - Only captures changes from the current point forward",
            enum: [1, 2],
            default: 1,
          },
          source_datasource_list: {
            type: "array",
            description:
              "REQUIRED. List of source datasources to sync from. " +
              "Each datasource must have datasourceId and datasourceType. " +
              "Supported types: MySQL (5), PostgreSQL (7), SQL Server (8).",
            items: {
              type: "object",
              properties: {
                datasourceId: {
                  type: "integer",
                  description: "Source datasource ID (get from list_data_sources)",
                },
                datasourceType: {
                  type: "integer",
                  description: "Source datasource type: 5=MySQL, 7=PostgreSQL, 8=SQL Server",
                },
              },
              required: ["datasourceId", "datasourceType"],
            },
          },
          sync_object_list: {
            type: "array",
            description:
              "REQUIRED. List of objects (schemas/tables) to synchronize. " +
              "Can specify entire schemas or individual tables.",
            items: {
              type: "object",
              properties: {
                schemaName: {
                  type: "string",
                  description:
                    "Schema/database name to sync. If only schemaName is provided, " +
                    "all tables in the schema will be synced.",
                },
                tableName: {
                  type: "string",
                  description:
                    "Optional. Specific table name to sync. If omitted, all tables in schema are synced.",
                },
              },
              required: ["schemaName"],
            },
          },
          target_datasource: {
            type: "object",
            description:
              "REQUIRED. Target datasource configuration. " +
              "Supported types: Lakehouse (1), Kafka (2).",
            properties: {
              datasourceId: {
                type: "integer",
                description: "Target datasource ID (get from list_data_sources)",
              },
              datasourceType: {
                type: "integer",
                description: "Target datasource type: 1=Lakehouse, 2=Kafka",
              },
            },
            required: ["datasourceId", "datasourceType"],
          },
        },
        required: [
          "data_file_id",
          "source_datasource_list",
          "sync_object_list",
          "target_datasource",
        ],
      },
      handler: async (args: Record<string, unknown>) => {
        return handleSaveCdcRealtimeTask(args, db)
      },
      tags: ["studio", "cdc", "realtime", "sync", "multi-table"],
      samples: [
        {
          description: "Save a MySQL to Lakehouse CDC task syncing entire schema",
          query: {
            data_file_id: 12549001,
            pipeline_type: 3,
            save_mode: 2,
            sync_mode: 1,
            source_datasource_list: [{ datasourceId: 12094, datasourceType: 5 }],
            sync_object_list: [{ schemaName: "wx3" }],
            target_datasource: { datasourceId: 263, datasourceType: 1 },
          },
        },
        {
          description: "Save a PostgreSQL to Kafka CDC task with specific tables",
          query: {
            data_file_id: 12549002,
            sync_mode: 1,
            source_datasource_list: [{ datasourceId: 15001, datasourceType: 7 }],
            sync_object_list: [
              { schemaName: "public", tableName: "users" },
              { schemaName: "public", tableName: "orders" },
            ],
            target_datasource: { datasourceId: 500, datasourceType: 2 },
          },
        },
        {
          description: "Save a SQL Server to Lakehouse CDC task with incremental only mode",
          query: {
            data_file_id: 12549003,
            sync_mode: 2,
            source_datasource_list: [{ datasourceId: 20001, datasourceType: 8 }],
            sync_object_list: [{ schemaName: "dbo" }],
            target_datasource: { datasourceId: 300, datasourceType: 1 },
          },
        },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering CDC tools")
  registry.registerTools(tools)
}
