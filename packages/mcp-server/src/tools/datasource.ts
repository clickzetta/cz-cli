/**
 * Datasource tools — port of cz-mcp-server/cz_mcp/tools/datasource_tools.py
 *
 * Python → TS mapping:
 *   datasource_tools.py:27-78   DATASOURCE_TYPE_MAP              → DATASOURCE_TYPE_MAP
 *   datasource_tools.py:80-172  handle_list_data_sources         → handleListDataSources()
 *   datasource_tools.py:175-264 handle_list_namespaces           → handleListNamespaces()
 *   datasource_tools.py:267-377 handle_list_metadata_objects     → handleListMetadataObjects()
 *   datasource_tools.py:380-469 handle_get_metadata_detail       → handleGetMetadataDetail()
 *   datasource_tools.py:472-678 list_data_sources()              → registerDatasourceTools()
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import {
  apiDatasourceList,
  apiGetNamespaceList,
  apiGetMetaList,
  apiGetMetaDetail,
} from "./studio-api.js"

// ---------------------------------------------------------------------------
// DATASOURCE_TYPE_MAP — datasource_tools.py:27-78
// ---------------------------------------------------------------------------
const DATASOURCE_TYPE_MAP: Record<number, string> = {
  1: "LakeHouse",
  2: "Kafka",
  3: "Hive",
  4: "ClickHouse",
  5: "MySQL",
  7: "PostgreSQL",
  8: "SqlServer",
  9: "Oss",
  10: "Hbase",
  11: "Odps",
  12: "MongoDB",
  13: "ElasticSearch7",
  14: "Doris",
  15: "StarRocks",
  16: "SelectDB",
  17: "TiDB",
  18: "MariaDB",
  19: "PolarDB",
  20: "Hologres",
  21: "DB2",
  22: "Greenplum",
  23: "AdbMysql",
  24: "AdbPostgresql",
  25: "Oracle",
  26: "DM",
  27: "COS",
  28: "LogHub",
  30: "customJdbc",
  31: "sensorsApi",
  32: "mirrorJdbc",
  33: "PostgreSqlCdc",
  34: "MySqlCdc",
  35: "RestfulApi",
  36: "SqlserverCdc",
  37: "Amqp",
  38: "S3",
  39: "Aurora_For_Mysql",
  40: "Aurora_For_Postgresql",
  41: "Aurora_For_Mysql_CDC",
  42: "Aurora_For_Postgresql_CDC",
  43: "Redis",
  44: "Databricks",
  45: "AutoMQ",
  46: "Redshift",
  47: "Sap_Hana",
  48: "Polardb_For_Postgresql",
  49: "Polardb_For_Mysql_CDC",
  50: "Polardb_For_Postgresql_CDC",
  51: "DynamoDB",
  52: "KafkaCdc",
}

// ---------------------------------------------------------------------------
// handleListDataSources — datasource_tools.py:80-172
// ---------------------------------------------------------------------------
async function handleListDataSources(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) {
    return { success: false, message: "Studio configuration is required" }
  }

  // datasource_tools.py:97-104 — extract parameters
  const dsName = args["ds_name"] as string | undefined
  const dsType = args["ds_type"] as number | undefined
  const pageIndex = (args["page_index"] as number | undefined) ?? 1
  const pageSize = (args["page_size"] as number | undefined) ?? 20

  logger.info(
    { projectId: config.projectId, pageIndex, pageSize },
    "Fetching data source list",
  )

  try {
    // datasource_tools.py:110-123 — call the API
    const responseText = await apiDatasourceList(config, {
      dsName,
      dsType,
      pageIndex,
      pageSize,
    })

    // datasource_tools.py:126-172 — parse and format response
    const responseData = JSON.parse(responseText) as Record<string, unknown>

    if (responseData["code"] === "200") {
      const data = responseData["data"] ?? {}

      // datasource_tools.py:132-137 — handle both list and dict response formats
      let dataSources: Record<string, unknown>[]
      let totalCount: number
      if (Array.isArray(data)) {
        dataSources = data as Record<string, unknown>[]
        totalCount = dataSources.length
      } else {
        const dataObj = data as Record<string, unknown>
        dataSources = (dataObj["list"] as Record<string, unknown>[]) ?? []
        totalCount = (dataObj["total"] as number) ?? dataSources.length
      }

      // datasource_tools.py:139-142 — remove connectionParams to save tokens
      for (const ds of dataSources) {
        if ("connectionParams" in ds) {
          delete ds["connectionParams"]
        }
      }

      return {
        success: true,
        message: `Successfully fetched page ${pageIndex} with ${dataSources.length} data sources.`,
        page_index: pageIndex,
        page_size: pageSize,
        count: dataSources.length,
        total_count: totalCount,
        has_more: pageIndex * pageSize < totalCount,
        data_sources: dataSources,
      }
    } else {
      return {
        success: false,
        message: `[handle_list_data_sources]API request failed: ${(responseData["message"] as string) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error in list data sources")
    return {
      success: false,
      message: `Internal error: ${err.message}`,
      error_type: err.name,
    }
  }
}

// ---------------------------------------------------------------------------
// handleListNamespaces — datasource_tools.py:175-264
// ---------------------------------------------------------------------------
async function handleListNamespaces(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) {
    return { success: false, message: "Studio configuration is required" }
  }

  // datasource_tools.py:191-193
  const datasourceId = args["datasource_id"] as number | undefined
  const namespaceFilter = args["namespace_filter"] as string | undefined

  if (!datasourceId) {
    return { success: false, message: "datasource_id is required" }
  }

  logger.info({ datasourceId }, "Fetching namespace list")

  try {
    // datasource_tools.py:208-217 — call the API
    const responseText = await apiGetNamespaceList(config, datasourceId)

    // datasource_tools.py:220-255 — parse and format response
    const responseData = JSON.parse(responseText) as Record<string, unknown>

    if (responseData["code"] === "200") {
      const data = (responseData["data"] as Record<string, unknown>) ?? {}
      let namespaces = (data["list"] as unknown[]) ?? []
      const originalCount = namespaces.length

      // datasource_tools.py:229-237 — apply fuzzy matching filter if provided
      if (namespaceFilter) {
        const filterLower = namespaceFilter.toLowerCase()
        namespaces = namespaces.filter((ns) =>
          String(ns).toLowerCase().includes(filterLower),
        )
        logger.info(
          { originalCount, filteredCount: namespaces.length, namespaceFilter },
          "Filtered namespaces",
        )
      }

      return {
        success: true,
        message:
          `Successfully fetched ${namespaces.length} namespaces.` +
          (namespaceFilter ? ` (filtered by '${namespaceFilter}')` : ""),
        count: namespaces.length,
        total_before_filter: originalCount,
        namespaces,
        filter_applied: namespaceFilter ?? null,
      }
    } else {
      return {
        success: false,
        message: `[handle_list_namespaces]API request failed: ${(responseData["message"] as string) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error in get namespace list")
    return {
      success: false,
      message: `Internal error: ${err.message}`,
      error_type: err.name,
    }
  }
}

// ---------------------------------------------------------------------------
// handleListMetadataObjects — datasource_tools.py:267-377
// ---------------------------------------------------------------------------
async function handleListMetadataObjects(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) {
    return { success: false, message: "Studio configuration is required" }
  }

  // datasource_tools.py:284-287
  const datasourceId = args["datasource_id"] as number | undefined
  const namespace = args["namespace"] as string | undefined
  const tableFilter = args["table_filter"] as string | undefined

  if (!datasourceId) {
    return { success: false, message: "datasource_id is required" }
  }
  if (!namespace) {
    return { success: false, message: "namespace is required" }
  }

  logger.info({ datasourceId, namespace }, "Fetching data objects")

  try {
    // datasource_tools.py:309-319 — call the API
    const responseText = await apiGetMetaList(config, { datasourceId, namespace })

    // datasource_tools.py:322-368 — parse and format response
    const responseData = JSON.parse(responseText) as Record<string, unknown>

    if (responseData["code"] === "200") {
      const data = (responseData["data"] as Record<string, unknown>) ?? {}
      let dataObjects = (data["list"] as unknown[]) ?? []
      const originalCount = dataObjects.length

      // datasource_tools.py:331-350 — apply fuzzy matching filter if provided
      if (tableFilter) {
        const filterLower = tableFilter.toLowerCase()
        const filteredObjects: unknown[] = []
        for (const obj of dataObjects) {
          if (typeof obj === "string") {
            if (obj.toLowerCase().includes(filterLower)) filteredObjects.push(obj)
          } else if (typeof obj === "object" && obj !== null) {
            const o = obj as Record<string, unknown>
            const tableName =
              (o["name"] as string) ??
              (o["table_name"] as string) ??
              (o["tableName"] as string) ??
              String(obj)
            if (tableName.toLowerCase().includes(filterLower)) filteredObjects.push(obj)
          } else {
            if (String(obj).toLowerCase().includes(filterLower)) filteredObjects.push(obj)
          }
        }
        logger.info(
          { originalCount, filteredCount: filteredObjects.length, tableFilter },
          "Filtered data objects",
        )
        dataObjects = filteredObjects
      }

      return {
        success: true,
        message:
          `Successfully fetched ${dataObjects.length} data objects.` +
          (tableFilter ? ` (filtered by '${tableFilter}')` : ""),
        count: dataObjects.length,
        total_before_filter: originalCount,
        data_objects: dataObjects,
        filter_applied: tableFilter ?? null,
      }
    } else {
      return {
        success: false,
        message: `[handle_list_metadata_objects]API request failed: ${(responseData["message"] as string) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error in get meta list")
    return {
      success: false,
      message: `Internal error: ${err.message}`,
      error_type: err.name,
    }
  }
}

// ---------------------------------------------------------------------------
// handleGetMetadataDetail — datasource_tools.py:380-469
// ---------------------------------------------------------------------------
async function handleGetMetadataDetail(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) {
    return { success: false, message: "Studio configuration is required" }
  }

  // datasource_tools.py:397-400
  const datasourceId = args["datasource_id"] as number | undefined
  const namespace = args["namespace"] as string | undefined
  const dataObjectName = args["data_object_name"] as string | undefined

  if (!datasourceId) {
    return { success: false, message: "datasource_id is required" }
  }
  if (!namespace) {
    return { success: false, message: "namespace is required" }
  }
  if (!dataObjectName) {
    return { success: false, message: "data_object_name is required" }
  }

  logger.info({ datasourceId, namespace, dataObjectName }, "Fetching metadata")

  try {
    // datasource_tools.py:429-440 — call the API
    const responseText = await apiGetMetaDetail(config, {
      datasourceId,
      namespace,
      dataObjectName,
    })

    // datasource_tools.py:443-460 — parse and format response
    const responseData = JSON.parse(responseText) as Record<string, unknown>

    if (responseData["code"] === "200") {
      const metadata = responseData["data"] ?? {}
      return {
        success: true,
        message: "Successfully fetched metadata details.",
        metadata,
      }
    } else {
      return {
        success: false,
        message: `[handle_get_metadata_detail]API request failed: ${(responseData["message"] as string) ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error in get meta detail")
    return {
      success: false,
      message: `Internal error: ${err.message}`,
      error_type: err.name,
    }
  }
}

// ---------------------------------------------------------------------------
// registerDatasourceTools — datasource_tools.py:472-678
// ---------------------------------------------------------------------------
export function registerDatasourceTools(registry: ToolRegistry, db: LakehouseDB): void {
  // Build ds_type description from map — datasource_tools.py:516-517
  const dsTypeDescription =
    "Data source type code (RECOMMENDED when using ds_name filter for better performance). Full mapping:\n" +
    Object.entries(DATASOURCE_TYPE_MAP)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")

  const tools: ToolDefinition[] = [
    // datasource_tools.py:475-552 — list_data_sources
    {
      name: "list_data_sources",
      description:
        "Retrieve all available data sources in the specified Clickzetta Studio project. " +
        "This API lists all active data sources configured for the current workspace, " +
        "including metadata such as source name, type, and connection information.\n\n" +
        "**Self-Contained Tool**: This tool handles all data retrieval internally. " +
        "No need to query table structures or use additional tools - it provides complete datasource information directly.\n\n" +
        "**⚠️ STRONGLY RECOMMENDED - Use Filter Parameters**: When querying datasources, it is STRONGLY RECOMMENDED to use " +
        "filter parameters (`ds_name` and/or `ds_type`). Without filters, the response may be extremely large and cause " +
        "performance issues or output truncation. Always try to narrow down your search scope.\n\n" +
        "**Performance Tip**: When searching for a specific datasource, it is HIGHLY RECOMMENDED to specify " +
        "the `ds_type` parameter along with `ds_name`. This significantly improves query performance and accuracy " +
        "by narrowing down the search scope. For example, if you know you're looking for a MySQL datasource, " +
        "always include `ds_type: 5` in your query.\n\n" +
        "**Common datasource types**:\n" +
        "- 1: Lakehouse\n" +
        "- 2: Kafka\n" +
        "- 3: Hive\n" +
        "- 4: ClickHouse\n" +
        "- 5: MySQL\n" +
        "- 7: PostgreSQL\n" +
        "- 8: SQL Server\n" +
        "- 9: OSS (Object Storage)\n" +
        "- 12: MongoDB\n" +
        "- 43: Redis\n\n" +
        "**Pagination**: This tool returns only one page of results per call.\n\n" +
        "When the user asks for 'all items', 'the full list', or any request that cannot be fulfilled by a single page, " +
        "the assistant MUST repeatedly call this tool, incrementing page_index each time, " +
        "until all pages are retrieved or no more data is returned.\n\n" +
        "The assistant is responsible for performing the loop and merging all pages before responding to the user.",
      inputSchema: {
        type: "object",
        properties: {
          ds_name: {
            type: "string",
            description:
              "Name of the data source to filter results by (supports fuzzy match). RECOMMENDED: Use together with ds_type for better performance.",
          },
          ds_type: {
            type: "integer",
            description: dsTypeDescription,
          },
          page_index: {
            type: "integer",
            description: "Page index (1-based). Default is 1.",
            default: 1,
          },
          page_size: {
            type: "integer",
            description: "Number of items per page. Default is 20.",
            default: 20,
          },
        },
        additionalProperties: false,
      },
      handler: async (args: Record<string, unknown>) => {
        return handleListDataSources(args, db)
      },
      tags: ["studio", "datasource", "project", "api"],
      samples: [
        {
          description: "Fetch first page of all data sources.",
          query: { page_index: 1, page_size: 20 },
        },
        {
          description: "Fetch all MySQL data sources (recommended: filter by type).",
          query: { ds_type: 5, page_index: 1, page_size: 50 },
        },
        {
          description:
            "Search for a specific MySQL datasource by name (BEST PRACTICE: include ds_type).",
          query: { ds_name: "MySQL_Prod", ds_type: 5, page_index: 1, page_size: 20 },
        },
        {
          description: "Search for Lakehouse datasources containing 'test' in name.",
          query: { ds_name: "test", ds_type: 1, page_index: 1, page_size: 20 },
        },
      ],
    },
    // datasource_tools.py:553-593 — list_namespaces
    {
      name: "list_namespaces",
      description:
        "Retrieve the list of namespaces (schemas/databases) available in a specific data source. " +
        "This API returns all namespaces that can be accessed within the given data source, " +
        "which is useful for exploring the hierarchical structure of external data systems.\n\n" +
        "**⚠️ STRONGLY RECOMMENDED - Use Filter Parameter**: It is STRONGLY RECOMMENDED to use the " +
        "`namespace_filter` parameter when querying namespaces. Without filtering, the response may contain " +
        "a large number of namespaces, leading to excessive output size and potential performance issues. " +
        "Always try to narrow down your search by providing a filter string.\n\n" +
        "**Fuzzy Matching**: Supports optional `namespace_filter` parameter for case-insensitive substring matching. " +
        "When provided, only namespaces containing the filter string will be returned.",
      inputSchema: {
        type: "object",
        properties: {
          datasource_id: {
            type: "integer",
            description: "The unique identifier of the data source to query namespaces from.",
          },
          namespace_filter: {
            type: "string",
            description:
              "Optional filter to perform case-insensitive fuzzy matching on namespace names. Only namespaces containing this substring will be returned.",
          },
        },
        required: ["datasource_id"],
        additionalProperties: false,
      },
      handler: async (args: Record<string, unknown>) => {
        return handleListNamespaces(args, db)
      },
      tags: ["studio", "datasource", "namespace", "schema", "api"],
      samples: [
        {
          description: "Get all namespaces for data source with ID 26412.",
          query: { datasource_id: 26412 },
        },
        {
          description: "Get namespaces containing 'demo' for data source with ID 26412.",
          query: { datasource_id: 26412, namespace_filter: "demo" },
        },
      ],
    },
    // datasource_tools.py:594-638 — list_metadata_objects
    {
      name: "list_metadata_objects",
      description:
        "List all data objects (tables/views/collections) within a specific namespace " +
        "of a data source. This API provides metadata about all accessible data objects in the " +
        "specified namespace, enabling discovery of available datasets.\n\n" +
        "**⚠️ STRONGLY RECOMMENDED - Use Filter Parameter**: It is STRONGLY RECOMMENDED to use the " +
        "`table_filter` parameter when querying data objects. Without filtering, the response may contain " +
        "a large number of tables/views, leading to excessive output size and potential performance issues. " +
        "Always try to narrow down your search by providing a filter string.\n\n" +
        "**Fuzzy Matching**: Supports optional `table_filter` parameter for case-insensitive substring matching. " +
        "When provided, only tables/objects containing the filter string will be returned.",
      inputSchema: {
        type: "object",
        properties: {
          datasource_id: {
            type: "integer",
            description: "The unique identifier of the data source.",
          },
          namespace: {
            type: "string",
            description: "The namespace (schema/database name) to query data objects from.",
          },
          table_filter: {
            type: "string",
            description:
              "Optional filter to perform case-insensitive fuzzy matching on table/object names. Only objects containing this substring will be returned.",
          },
        },
        required: ["datasource_id", "namespace"],
        additionalProperties: false,
      },
      handler: async (args: Record<string, unknown>) => {
        return handleListMetadataObjects(args, db)
      },
      tags: ["studio", "datasource", "metadata", "table", "api"],
      samples: [
        {
          description: "Get all data objects in namespace '00_wky_demo' for data source 26412.",
          query: { datasource_id: 26412, namespace: "00_wky_demo" },
        },
        {
          description:
            "Get data objects containing 'user' in namespace '00_wky_demo' for data source 26412.",
          query: { datasource_id: 26412, namespace: "00_wky_demo", table_filter: "user" },
        },
      ],
    },
    // datasource_tools.py:639-678 — get_metadata_detail
    {
      name: "get_metadata_detail",
      description:
        "Get detailed metadata information for a specific data object (table/view/collection). " +
        "This API returns comprehensive schema information including column names, data types, " +
        "constraints, and other metadata properties of the specified data object.",
      inputSchema: {
        type: "object",
        properties: {
          datasource_id: {
            type: "integer",
            description: "The unique identifier of the data source.",
          },
          namespace: {
            type: "string",
            description: "The namespace (schema/database name) containing the data object.",
          },
          data_object_name: {
            type: "string",
            description:
              "The name of the data object (table/view/collection) to retrieve metadata for.",
          },
        },
        required: ["datasource_id", "namespace", "data_object_name"],
        additionalProperties: false,
      },
      handler: async (args: Record<string, unknown>) => {
        return handleGetMetadataDetail(args, db)
      },
      tags: ["studio", "datasource", "metadata", "schema", "column", "api"],
      samples: [
        {
          description: "Get metadata details for table 'abbbbbc' in namespace '00_wky_demo'.",
          query: {
            datasource_id: 26412,
            namespace: "00_wky_demo",
            data_object_name: "abbbbbc",
          },
        },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering datasource tools")
  registry.registerTools(tools)
}
