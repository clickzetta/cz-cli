/**
 * Integration configuration tools — port of
 * cz-mcp-server/cz_mcp/tools/integration_config_tools.py (569 lines)
 *
 * Python → TS mapping:
 *   integration_templates.py:25-929  IntegrationTemplateLibrary → IntegrationTemplateLibrary class
 *   integration_config_tools.py:20-323  IntegrationConfigGenerator → IntegrationConfigGenerator class
 *   integration_config_tools.py:326-405 handle_recommend_integration_config → handleRecommendIntegrationConfig()
 *   integration_config_tools.py:408-569 integration_config_tools()  → registerIntegrationTools()
 *
 * Note: Python's __init__.py has this tool commented out, but it is still implemented here per spec.
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import { apiGetMetaDetail } from "./studio-api.js"

// ---------------------------------------------------------------------------
// IntegrationTemplateLibrary — integration_templates.py:25-929
// ---------------------------------------------------------------------------

// integration_templates.py:42-46 — datasource category lists
const RELATIONAL_DB = [5, 7, 8, 17, 18, 19, 21, 22, 23, 24, 25, 26]

// integration_templates.py:777-898 — type mapping tables
const TYPE_MAPPINGS_TO_LAKEHOUSE: Record<string, string> = {
  // Strings
  VARCHAR: "string", CHAR: "string", TEXT: "string", STRING: "string",
  NVARCHAR: "string", NCHAR: "string", NTEXT: "string",
  CLOB: "string", NCLOB: "string", LONGTEXT: "string",
  MEDIUMTEXT: "string", TINYTEXT: "string", BPCHAR: "string",
  VARCHAR2: "string", "CHARACTER VARYING": "string", CHARACTER: "string",
  NAME: "string", LONGVARCHAR: "string",
  // Integers
  TINYINT: "tinyint", INT8: "bigint", BYTE: "tinyint",
  SMALLINT: "smallint", INT16: "smallint", INT2: "smallint", SHORT: "smallint",
  SMALLSERIAL: "smallint",
  INT: "int", INTEGER: "int", INT32: "int", INT4: "int",
  SERIAL: "decimal", MEDIUMINT: "int",
  BIGINT: "bigint", INT64: "bigint", LONG: "bigint",
  BIGSERIAL: "bigint", OID: "bigint",
  // MySQL UNSIGNED
  "TINYINT UNSIGNED": "smallint", "TINYINT UNSIGNED ZEROFILL": "smallint",
  "SMALLINT UNSIGNED": "int", "SMALLINT UNSIGNED ZEROFILL": "int",
  "MEDIUMINT UNSIGNED": "bigint", "MEDIUMINT UNSIGNED ZEROFILL": "bigint",
  "INT UNSIGNED": "bigint", "INT UNSIGNED ZEROFILL": "bigint",
  "INTEGER UNSIGNED": "bigint", "INTEGER UNSIGNED ZEROFILL": "bigint",
  "BIGINT UNSIGNED": "decimal", "BIGINT UNSIGNED ZEROFILL": "decimal",
  // ClickHouse large ints
  Int128: "decimal", Int256: "decimal",
  UInt64: "decimal", UInt128: "decimal", UInt256: "decimal",
  UINT32: "bigint", UINT64: "decimal", UINT8: "smallint", UINT16: "int",
  // Decimals
  FLOAT: "float", FLOAT4: "float", FLOAT32: "float", REAL: "float",
  "FLOAT UNSIGNED": "float", "FLOAT UNSIGNED ZEROFILL": "float",
  DOUBLE: "double", "DOUBLE PRECISION": "double", FLOAT8: "double", FLOAT64: "double",
  "DOUBLE UNSIGNED": "double", "DOUBLE UNSIGNED ZEROFILL": "double",
  "REAL UNSIGNED": "double", "REAL UNSIGNED ZEROFILL": "double",
  DECIMAL: "decimal", NUMERIC: "decimal", DEC: "decimal", NUMBER: "decimal",
  MONEY: "decimal", SMALLMONEY: "decimal", DECFLOAT: "decimal",
  DECIMAL32: "decimal", DECIMAL64: "decimal", DECIMAL128: "decimal",
  DECIMALV2: "decimal", "DECIMAL UNSIGNED": "decimal",
  // Boolean
  BOOLEAN: "boolean", BOOL: "boolean", BIT: "boolean",
  // Time
  DATE: "date",
  TIME: "time", TIMEZ: "time",
  TIMESTAMP: "timestamp_ltz", DATETIME: "timestamp_ltz",
  TIMESTAMPTZ: "timestamp_ltz", "TIMESTAMP WITH TIME ZONE": "timestamp_ltz",
  DATETIME2: "timestamp_ltz", SMALLDATETIME: "timestamp_ltz",
  // Binary
  BINARY: "binary", VARBINARY: "binary", BLOB: "binary", BYTEA: "binary",
  LONGBLOB: "binary", MEDIUMBLOB: "binary", TINYBLOB: "binary",
  IMAGE: "binary", GEOMETRY: "binary", "LONG RAW": "binary", RAW: "binary",
  BITMAP: "binary", BINDATA: "binary", BYTES: "binary",
  // JSON
  JSON: "json",
  // PostgreSQL special
  UUID: "string", INET: "string", CIDR: "string",
  MACADDR: "string", MACADDR8: "string", XML: "string",
  JSONB: "string", JSONPATH: "string",
  INTERVAL: "string", "BIT VARYING": "string", VARBIT: "string",
  POINT: "string", LINE: "string", LSEG: "string", BOX: "string",
  PATH: "string", POLYGON: "string", CIRCLE: "string",
  TSQUERY: "string", TSVECTOR: "string",
  TSRANGE: "string", INT4RANGE: "string", INT8RANGE: "string",
  NUMRANGE: "string", TSTZRANGE: "string", DATERANGE: "string",
  // MongoDB/NoSQL
  String: "string", OBJECTID: "string", DOCUMENT: "string",
  Integer: "int", Double: "double", Boolean: "boolean",
  // ClickHouse special
  FIXEDSTRING: "string", ENUM8: "string", ENUM16: "string",
  NESTED: "string", STRUCT: "string", COLLECTION: "string",
  INTERVALYEAR: "int", INTERVALQUARTER: "int", INTERVALMONTH: "int",
  INTERVALWEEK: "int", INTERVALDAY: "int", INTERVALHOUR: "int",
  INTERVALMINUTE: "int", INTERVALSECOND: "int",
  // Doris/StarRocks
  LARGEINT: "string", HLL: "binary", SET: "string", ENUM: "string",
  INT24: "int",
  // Oracle
  BINARY_FLOAT: "float", BINARY_DOUBLE: "double",
  // SQLServer
  UNIQUEIDENTIFIER: "string", "INT IDENTITY": "int",
  // Elasticsearch
  OBJECT: "string",
  // Kafka
  UNIXTIME_MICROS: "bigint", TIMESTAMP_LTZ: "timestamp_ltz",
  // Complex
  ARRAY: "string", MAP: "string", ROW: "string",
}

const TYPE_MAPPINGS_FROM_LAKEHOUSE: Record<string, string> = {
  int: "INT", bigint: "LONG", string: "STRING", double: "DOUBLE",
  float: "FLOAT", boolean: "BOOLEAN", date: "STRING", timestamp_ltz: "STRING",
  timestamp: "STRING", tinyint: "INT", smallint: "INT", decimal: "STRING",
}

// integration_templates.py:901-929 — get_template_key
function getTemplateKey(sourceType: number, sinkType: number): string {
  if (sourceType === 2 && sinkType === 1) return "kafka_to_lakehouse"
  if (sourceType === 9 && sinkType === 1) return "oss_to_lakehouse"
  if (sourceType === 12 && sinkType === 1) return "mongodb_to_lakehouse"
  if (sourceType === 3 && sinkType === 1) return "hive_to_lakehouse"
  if (sourceType === 1 && sinkType === 43) return "lakehouse_to_redis"
  if (RELATIONAL_DB.includes(sourceType) && sinkType === 1) return "relational_to_lakehouse"
  return "relational_to_lakehouse"
}

// integration_templates.py:1020-1095 — map_column_type
function mapColumnType(sourceType: string, sourceDsType: number, sinkDsType: number): string {
  if (!sourceType) return "string"

  // Lakehouse → Redis
  if (sourceDsType === 1 && sinkDsType === 43) {
    return TYPE_MAPPINGS_FROM_LAKEHOUSE[sourceType.toLowerCase()] ?? sourceType.toUpperCase()
  }

  // Others → Lakehouse
  if (sinkDsType === 1) {
    // Exact match (preserves case-sensitive types like MongoDB "String")
    let mapped = TYPE_MAPPINGS_TO_LAKEHOUSE[sourceType]
    if (mapped) return mapped

    // Uppercase match
    mapped = TYPE_MAPPINGS_TO_LAKEHOUSE[sourceType.toUpperCase()]
    if (mapped) return mapped

    // Lowercase match
    mapped = TYPE_MAPPINGS_TO_LAKEHOUSE[sourceType.toLowerCase()]
    if (mapped) return mapped

    // Pattern-based fallback
    const upper = sourceType.toUpperCase()
    if (upper.includes("CHAR") || upper.includes("TEXT") || upper.includes("STRING")) return "string"
    if (upper.includes("INT")) {
      if (upper.includes("TINY")) return "tinyint"
      if (upper.includes("SMALL")) return "smallint"
      if (upper.includes("BIG")) return "bigint"
      return "int"
    }
    if (upper.includes("FLOAT") || upper.includes("REAL")) return "float"
    if (upper.includes("DOUBLE")) return "double"
    if (upper.includes("DECIMAL") || upper.includes("NUMERIC") || upper.includes("NUMBER")) return "decimal"
    if (upper.includes("BOOL")) return "boolean"
    if (upper.includes("DATE")) {
      return upper.includes("TIME") ? "timestamp_ltz" : "date"
    }
    if (upper.includes("TIME")) {
      return upper.includes("STAMP") ? "timestamp_ltz" : "time"
    }
    if (upper.includes("BINARY") || upper.includes("BLOB") || upper.includes("BYTE")) return "binary"

    return sourceType.toLowerCase()
  }

  return sourceType
}

// integration_templates.py:50-773 — template definitions (system_columns for Kafka/OSS)
const KAFKA_SYSTEM_COLUMNS = [
  { name: "__key__", type: "STRING", comment: null, nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, partitionColumn: false, cluster: false },
  { name: "__value__", type: "STRING", comment: null, nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, partitionColumn: false, cluster: false },
  { name: "__partition__", type: "INTEGER", comment: null, nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, partitionColumn: false, cluster: false },
  { name: "__offset__", type: "LONG", comment: null, nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, partitionColumn: false, cluster: false },
  { name: "__timestamp__", type: "LONG", comment: null, nullable: false, supportAsSplitKey: false, properties: null, primary: false, sorted: false, partitionColumn: false, cluster: false },
]

// Default values per template key and operator type
// integration_config_tools.py:273-295 — _build_params uses template default_values
function getDefaultParams(templateKey: string, operatorType: "source" | "sink"): Record<string, unknown> {
  if (templateKey === "kafka_to_lakehouse" && operatorType === "source") {
    return { codec: "json", mode: "earliest-offset", endMode: "period", groupId: "0001", database: "--" }
  }
  if (templateKey === "oss_to_lakehouse" && operatorType === "source") {
    return { codec: "csv", isFirstLineHeader: false, isRecursive: false, encoding: "utf-8", fieldDelimiter: "," }
  }
  if (templateKey === "oss_to_lakehouse" && operatorType === "sink") {
    return { vclusterName: "DEFAULT", operatorType: "source" } // OSS sink uses "source" as operatorType
  }
  if (operatorType === "sink") {
    return { vclusterName: "DEFAULT" }
  }
  return {}
}

// ---------------------------------------------------------------------------
// IntegrationConfigGenerator — integration_config_tools.py:20-323
// ---------------------------------------------------------------------------

// integration_config_tools.py:259-295 — _build_params
function buildParams(
  operatorType: "source" | "sink",
  dsType: number,
  table: string,
  namespace: string | undefined,
  templateKey: string,
  customParams: Record<string, unknown> | undefined,
  writeMode = "APPEND",
): Record<string, unknown> {
  // Start with defaults from template — integration_config_tools.py:274
  const params: Record<string, unknown> = { ...getDefaultParams(templateKey, operatorType) }

  // integration_config_tools.py:277-278
  params["dsType"] = dsType
  params["operatorType"] = operatorType

  // integration_config_tools.py:281-285 — skip table/database for Hive source or Redis sink
  const isHiveSource = dsType === 3 && operatorType === "source"
  const isRedisSink = dsType === 43 && operatorType === "sink"
  if (!isHiveSource && !isRedisSink) {
    params["table"] = table
    params["database"] = namespace ?? table
  }

  // integration_config_tools.py:287-289 — write mode for Lakehouse sink
  if (operatorType === "sink" && dsType === 1) {
    params["writeMode"] = writeMode
    params["outputMode"] = writeMode
  }

  // integration_config_tools.py:292-293 — apply custom params
  if (customParams) {
    const overrides = customParams[operatorType] as Record<string, unknown> | undefined
    if (overrides) Object.assign(params, overrides)
  }

  return params
}

// integration_config_tools.py:297-323 — _map_columns
function mapColumns(
  sourceColumns: Record<string, unknown>[],
  sourceType: number,
  sinkType: number,
): Record<string, unknown>[] {
  return sourceColumns.map((col) => {
    const sourceColType = (col["type"] as string) ?? "STRING"
    const sinkColType = mapColumnType(sourceColType, sourceType, sinkType)
    const sinkCol: Record<string, unknown> = { ...col, type: sinkColType }
    // integration_config_tools.py:318-319 — add helper flag for Lakehouse sink
    if (sinkType === 1) {
      sinkCol["helper"] = true
    }
    return sinkCol
  })
}

// integration_config_tools.py:189-257 — _build_job
function buildJob(opts: {
  sourceTable: string
  sinkTable: string
  sourceNamespace: string | undefined
  sinkNamespace: string | undefined
  sourceColumns: Record<string, unknown>[]
  sourceType: number
  sinkType: number
  templateKey: string
  writeMode: string
  parallelism: number
  customParams: Record<string, unknown> | undefined
}): Record<string, unknown> {
  const sourceParams = buildParams(
    "source", opts.sourceType, opts.sourceTable, opts.sourceNamespace,
    opts.templateKey, opts.customParams,
  )
  const sinkParams = buildParams(
    "sink", opts.sinkType, opts.sinkTable, opts.sinkNamespace,
    opts.templateKey, opts.customParams, opts.writeMode,
  )

  const sinkColumns = mapColumns(opts.sourceColumns, opts.sourceType, opts.sinkType)

  // integration_config_tools.py:230 — column mapping: same name → same name
  const columnMapping: Record<string, string> = {}
  for (const col of opts.sourceColumns) {
    const name = col["name"] as string
    columnMapping[name] = name
  }

  return {
    source: {
      dataObject: opts.sourceTable,
      namespace: opts.sourceNamespace ?? opts.sourceTable,
      params: sourceParams,
      columns: opts.sourceColumns,
    },
    sink: {
      dataObject: opts.sinkTable,
      namespace: opts.sinkNamespace ?? "public",
      params: sinkParams,
      columns: sinkColumns,
    },
    setting: {
      parallelism: opts.parallelism,
      errorLimit: { maxCount: -1, collectDirtyData: true, record: -1 },
    },
    columnMapping,
  }
}

// integration_config_tools.py:115-187 — _get_table_columns
async function getTableColumns(
  db: LakehouseDB,
  datasourceId: number,
  namespace: string,
  tableName: string,
  dsType: number,
): Promise<Record<string, unknown>[]> {
  const config = db.connectionConfig!
  try {
    // integration_config_tools.py:125-127 — Kafka: use system columns
    if (dsType === 2) {
      return KAFKA_SYSTEM_COLUMNS as unknown as Record<string, unknown>[]
    }

    // integration_config_tools.py:129-156 — OSS: try API, fallback to system columns
    if (dsType === 9) {
      try {
        const responseText = await apiGetMetaDetail(config, {
          datasourceId,
          namespace,
          dataObjectName: tableName,
        })
        const responseData = JSON.parse(responseText) as Record<string, unknown>
        if (responseData["code"] === "200") {
          const metadata = (responseData["data"] as Record<string, unknown>) ?? {}
          const columns = (metadata["columns"] as Record<string, unknown>[]) ?? []
          if (columns.length > 0) return columns
        }
      } catch (e) {
        logger.warn({ err: e }, "Failed to get OSS metadata, using system columns")
      }
      // OSS fallback: empty (caller handles)
      return []
    }

    // integration_config_tools.py:158-183 — other types: get from metadata API
    const responseText = await apiGetMetaDetail(config, {
      datasourceId,
      namespace,
      dataObjectName: tableName,
    })
    const responseData = JSON.parse(responseText) as Record<string, unknown>
    if (responseData["code"] === "200") {
      const metadata = (responseData["data"] as Record<string, unknown>) ?? {}
      const columns = (metadata["columns"] as Record<string, unknown>[]) ?? []
      if (!columns.length) {
        logger.warn({ tableName }, "No columns found for table")
      }
      return columns
    } else {
      logger.error({ message: responseData["message"] }, "API error getting columns")
      return []
    }
  } catch (e) {
    logger.error({ err: e }, "Error getting table columns")
    return []
  }
}

// integration_config_tools.py:27-113 — generate_config
async function generateConfig(
  db: LakehouseDB,
  opts: {
    sourceDatasourceId: number
    sinkDatasourceId: number
    sourceTable: string
    sinkTable: string
    sourceDatasourceType: number
    sinkDatasourceType: number
    sourceDatasourceName: string
    sinkDatasourceName: string
    sourceNamespace?: string
    sinkNamespace?: string
    writeMode: string
    parallelism: number
    customParams?: Record<string, unknown>
  },
): Promise<Record<string, unknown>> {
  const sourceType = opts.sourceDatasourceType
  const sinkType = opts.sinkDatasourceType

  // integration_config_tools.py:69-70 — get template key
  const templateKey = getTemplateKey(sourceType, sinkType)
  logger.info({ templateKey, sourceType, sinkType }, "Using integration template")

  // integration_config_tools.py:74-80 — get source columns
  const sourceColumns = await getTableColumns(
    db,
    opts.sourceDatasourceId,
    opts.sourceNamespace ?? opts.sourceTable,
    opts.sourceTable,
    sourceType,
  )

  // integration_config_tools.py:83-113 — build config
  const config: Record<string, unknown> = {
    templateKey: 1,
    userParams: {},
    sourceConnection: {
      datasourceId: opts.sourceDatasourceId,
      datasourceName: opts.sourceDatasourceName,
      type: sourceType,
    },
    sinkConnection: {
      datasourceId: opts.sinkDatasourceId,
      datasourceName: opts.sinkDatasourceName,
      type: sinkType,
    },
    jobs: [
      buildJob({
        sourceTable: opts.sourceTable,
        sinkTable: opts.sinkTable,
        sourceNamespace: opts.sourceNamespace,
        sinkNamespace: opts.sinkNamespace,
        sourceColumns,
        sourceType,
        sinkType,
        templateKey,
        writeMode: opts.writeMode,
        parallelism: opts.parallelism,
        customParams: opts.customParams,
      }),
    ],
  }

  return config
}

// ---------------------------------------------------------------------------
// handleRecommendIntegrationConfig — integration_config_tools.py:326-405
// ---------------------------------------------------------------------------
async function handleRecommendIntegrationConfig(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) {
    return { success: false, message: "Studio configuration is required" }
  }

  // integration_config_tools.py:336-348 — extract parameters
  const sourceDatasourceId = args["source_datasource_id"] as number | undefined
  const sinkDatasourceId = args["sink_datasource_id"] as number | undefined
  const sourceTable = args["source_table"] as string | undefined
  const sinkTable = args["sink_table"] as string | undefined
  const sourceDatasourceType = args["source_datasource_type"] as number | undefined
  const sinkDatasourceType = args["sink_datasource_type"] as number | undefined
  const sourceDatasourceName = args["source_datasource_name"] as string | undefined
  const sinkDatasourceName = args["sink_datasource_name"] as string | undefined
  const sourceNamespace = args["source_namespace"] as string | undefined
  const sinkNamespace = args["sink_namespace"] as string | undefined
  const writeMode = (args["write_mode"] as string | undefined) ?? "APPEND"
  const parallelism = (args["parallelism"] as number | undefined) ?? 2
  const customParams = args["custom_params"] as Record<string, unknown> | undefined

  // integration_config_tools.py:351-361 — validate required parameters
  if (
    !sourceDatasourceId || !sinkDatasourceId ||
    !sourceTable || !sinkTable ||
    sourceDatasourceType == null || sinkDatasourceType == null ||
    !sourceDatasourceName || !sinkDatasourceName
  ) {
    return {
      success: false,
      message:
        "Missing required parameters: source_datasource_id, sink_datasource_id, source_table, sink_table, " +
        "source_datasource_type, sink_datasource_type, source_datasource_name, sink_datasource_name",
    }
  }

  try {
    // integration_config_tools.py:364-379 — generate configuration
    const generatedConfig = await generateConfig(db, {
      sourceDatasourceId,
      sinkDatasourceId,
      sourceTable,
      sinkTable,
      sourceDatasourceType,
      sinkDatasourceType,
      sourceDatasourceName,
      sinkDatasourceName,
      sourceNamespace,
      sinkNamespace,
      writeMode,
      parallelism,
      customParams,
    })

    // integration_config_tools.py:382-395 — format response
    return {
      success: true,
      message: "Successfully generated integration configuration",
      configuration: generatedConfig,
      data_file_content: JSON.stringify(generatedConfig),
      next_steps: [
        "1. Review the generated configuration",
        "2. Use save_integration_task to save this configuration to a file",
        "3. Use save_configuration to set up scheduling",
        "4. Use submit_file to deploy the task",
      ],
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error in recommend_integration_config")
    return {
      success: false,
      message: `Internal error: ${err.message}`,
      error_type: err.name,
    }
  }
}

// ---------------------------------------------------------------------------
// registerIntegrationTools — integration_config_tools.py:408-569
// ---------------------------------------------------------------------------
export function registerIntegrationTools(registry: ToolRegistry, db: LakehouseDB): void {
  const tools: ToolDefinition[] = [
    // integration_config_tools.py:411-568 — recommend_integration_config tool
    {
      name: "recommend_integration_config",
      description:
        "Generate complete data integration configuration for 50+ datasource types (MySQL, Kafka, OSS, MongoDB, etc.). " +
        "Handles column mappings, type conversions, and datasource-specific parameters automatically.\n" +
        "\n" +
        "**Prerequisites**: Source table exists (auto-fetched). Sink table MUST exist with compatible schema.\n" +
        "\n" +
        "**Workflow**: 1) Verify source via get_meta_detail 2) Create sink table with correct types 3) Call this tool 4) Save & submit\n" +
        "\n" +
        "**Finding Sink Datasource** (IMPORTANT for LakeHouse):\n" +
        "• For LakeHouse sink: Use list_data_sources to find the datasource matching current project\n" +
        "• Look for dsName pattern: 'LAKEHOUSE_<projectId>_<projectName>'\n" +
        "• Example: Project 97001 with workspace 'zetta_studio_dw' → datasource name 'LAKEHOUSE_97001_zetta_studio_dw'\n" +
        "• The projectId is available in X-Lakehouse-ProjectId header from MCP config\n" +
        "• Each project has its own isolated LakeHouse datasource for data security\n" +
        "• MUST match current project to ensure proper permissions and data isolation\n" +
        "\n" +
        "**Auto Type Mapping** (Source→Lakehouse):\n" +
        "• Strings: VARCHAR/CHAR/TEXT→string\n" +
        "• Integers: TINYINT→tinyint, SMALLINT→smallint, INT→int, BIGINT→bigint\n" +
        "• Decimals: FLOAT→float, DOUBLE→double, DECIMAL→decimal\n" +
        "• Time: DATE→date, TIMESTAMP/DATETIME→timestamp\n" +
        "• MySQL UNSIGNED升级: INT UNSIGNED→bigint, BIGINT UNSIGNED→decimal (Lakehouse不支持UNSIGNED)\n" +
        "• PostgreSQL特殊: UUID/JSONB/INET→string\n" +
        "• MongoDB: OBJECTID/DOCUMENT→string\n" +
        "• ClickHouse: Int128/UInt256→decimal\n" +
        "• Kafka: 固定5列(__key__,__value__,__partition__,__offset__,__timestamp__)\n" +
        "• OSS/S3: 所有类型→string\n" +
        "\n" +
        "Column names unchanged. Complex types→STRING. Large integers→DECIMAL.",
      inputSchema: {
        type: "object",
        properties: {
          source_datasource_id: {
            type: "integer",
            description: "ID of the source datasource (use list_data_sources to find)",
          },
          sink_datasource_id: {
            type: "integer",
            description:
              "ID of the sink datasource. Use list_data_sources to find. " +
              "**For LakeHouse sink (dsType=1)**: Each project has its own LakeHouse datasource. " +
              "Look for datasource with dsName pattern 'LAKEHOUSE_<projectId>_<projectName>' " +
              "that matches the current project (from X-Lakehouse-ProjectId header). " +
              "Example: For project 97001, find datasource named 'LAKEHOUSE_97001_zetta_studio_dw'. " +
              "Using wrong project's LakeHouse will cause permission errors.",
          },
          source_datasource_type: {
            type: "integer",
            description: "Type code of the source datasource (dsType from list_data_sources)",
          },
          sink_datasource_type: {
            type: "integer",
            description: "Type code of the sink datasource (dsType from list_data_sources)",
          },
          source_datasource_name: {
            type: "string",
            description: "Name of the source datasource (dsName from list_data_sources)",
          },
          sink_datasource_name: {
            type: "string",
            description:
              "Name of the sink datasource (dsName from list_data_sources). " +
              "**For LakeHouse sink**: Use pattern 'LAKEHOUSE_<projectId>_<projectName>'. " +
              "Must match the current project to ensure proper data isolation and permissions. " +
              "Example: 'LAKEHOUSE_97001_zetta_studio_dw' for project 97001 with workspace 'zetta_studio_dw'.",
          },
          source_table: {
            type: "string",
            description: "Source table/object name (for Kafka: topic name; for OSS: file path)",
          },
          sink_table: {
            type: "string",
            description: "Sink table name in the target datasource",
          },
          source_namespace: {
            type: "string",
            description: "Source namespace/database/schema (optional, defaults to source_table)",
          },
          sink_namespace: {
            type: "string",
            description: "Sink namespace/database/schema (optional, defaults to 'public')",
          },
          write_mode: {
            type: "string",
            description: "Write mode for sink",
            enum: ["APPEND", "OVERWRITE"],
            default: "APPEND",
          },
          parallelism: {
            type: "integer",
            description: "Task parallelism (default: 2)",
            default: 2,
            minimum: 1,
            maximum: 32,
          },
          custom_params: {
            type: "object",
            description:
              'Custom parameters to override defaults. Structure: ' +
              '{"source": {"param_name": "value"}, "sink": {"param_name": "value"}}. ' +
              'For example, for Kafka: {"source": {"codec": "avro", "groupId": "my_group"}}. ' +
              'For Redis: {"sink": {"redisOpType": "string", "keyColumns": ["id", "name"]}}',
          },
        },
        required: [
          "source_datasource_id", "sink_datasource_id",
          "source_table", "sink_table",
          "source_datasource_type", "sink_datasource_type",
          "source_datasource_name", "sink_datasource_name",
        ],
        additionalProperties: false,
      },
      handler: async (args: Record<string, unknown>) => {
        return handleRecommendIntegrationConfig(args, db)
      },
      tags: ["studio", "integration", "config", "generate", "normalize"],
      samples: [
        {
          description: "Generate MySQL to Lakehouse integration config",
          query: {
            source_datasource_id: 797,
            sink_datasource_id: 794,
            source_datasource_type: 5,
            sink_datasource_type: 1,
            source_datasource_name: "StudioUatmysql",
            sink_datasource_name: "LAKEHOUSE_97001_zetta_studio_dw",
            source_table: "users",
            sink_table: "users_copy",
            source_namespace: "mydb",
            sink_namespace: "public",
            write_mode: "APPEND",
          },
        },
        {
          description: "Generate Kafka to Lakehouse integration config with custom parameters",
          query: {
            source_datasource_id: 15963,
            sink_datasource_id: 1153,
            source_datasource_type: 2,
            sink_datasource_type: 1,
            source_datasource_name: "kafka_source",
            sink_datasource_name: "lakehouse_sink",
            source_table: "user_events",
            sink_table: "kafka_events",
            write_mode: "OVERWRITE",
            custom_params: {
              source: { codec: "avro", groupId: "analytics_group" },
            },
          },
        },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering integration tools")
  registry.registerTools(tools)
}
