/**
 * DQC tools — port of cz-mcp-server/cz_mcp/tools/dqc_tools.py
 *
 * Python → TS mapping:
 *   dqc_tools.py:19-144  handle_create_dqc_rule  → handleCreateDqcRule()
 *   dqc_tools.py:147-383 create_dqc_rule()       → (tool definition in registerDqcTools)
 *
 * redirect_url_utils.py:96-119 _build_dqc_studio_url → buildDqcStudioUrl()
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"
import type { StudioConfig } from "../server.js"
import { apiDqcAdd } from "./studio-api.js"

// ---------------------------------------------------------------------------
// ENV_WEB_URLS — redirect_url_utils.py + config.ini [WEB] section
// ---------------------------------------------------------------------------
const ENV_WEB_URLS: Record<string, string> = {
  dev: "dev-app.clickzetta.com",
  uat: "uat-app.clickzetta.com",
  "cn-shanghai-alicloud": "cn-shanghai-alicloud.app.clickzetta.com",
  "ap-southeast-1-alicloud": "ap-southeast-1-alicloud.app.singdata.com",
  "ap-shanghai-tencentcloud": "ap-shanghai-tencentcloud.app.clickzetta.com",
  "ap-beijing-tencentcloud": "ap-beijing-tencentcloud.app.clickzetta.com",
  "ap-guangzhou-tencentcloud": "ap-guangzhou-tencentcloud.app.clickzetta.com",
  "cn-north-1-aws": "cn-north-1-aws.app.clickzetta.com",
  "ap-southeast-1-aws": "ap-southeast-1-aws.app.singdata.com",
}

// ---------------------------------------------------------------------------
// buildDqcStudioUrl — redirect_url_utils.py:96-119 _build_dqc_studio_url
// ---------------------------------------------------------------------------
function buildDqcStudioUrl(config: StudioConfig, objectName: string): string | null {
  try {
    const baseUrl = ENV_WEB_URLS[config.env]
    const projectId = config.projectId
    const instance = config.instance
    if (!baseUrl || !projectId || !instance) {
      logger.warn("Cannot build DQC Studio URL: missing base_url, project_id or instance")
      return null
    }
    return (
      `https://${instance}.${baseUrl}/dqc?listType=qualityRule` +
      `&objectName=${objectName}&workspaceId=${projectId}&projectId=${projectId}&env=prod`
    )
  } catch (e) {
    logger.warn({ err: e }, "Error building DQC Studio URL")
    return null
  }
}

// ---------------------------------------------------------------------------
// handleCreateDqcRule — dqc_tools.py:19-144
// ---------------------------------------------------------------------------
async function handleCreateDqcRule(
  arguments_: Record<string, unknown>,
  config: NonNullable<LakehouseDB["connectionConfig"]>,
): Promise<Record<string, unknown>> {
  try {
    // dqc_tools.py:35-38 — extract config fields
    const jwtToken = config.token
    const workspace = config.workspace
    const instanceName = config.instance
    const projectId = config.projectId

    // dqc_tools.py:41-63 — extract parameters
    const objectName = arguments_["object_name"] as string | undefined
    const ruleDescription =
      (arguments_["rule_description"] as string | undefined) ?? "Auto-generated DQC rule"

    // Rule configuration
    const tagCode = arguments_["tag_code"] as string | undefined
    const columnName = arguments_["column_name"] as string | undefined
    const checkerInfoStr = arguments_["checker_info"] as string | undefined

    // Trigger configuration
    const triggerType = (arguments_["trigger_type"] as string | undefined) ?? "REST"
    const triggerCron = arguments_["trigger_cron"] as string | undefined
    const mainSchedulerTaskId = arguments_["main_scheduler_task_id"] as number | undefined
    const level = arguments_["level"] as number | undefined

    // Execution configuration
    const vcluster = (arguments_["vcluster"] as string | undefined) ?? "DEFAULT"
    const timeout = (arguments_["timeout"] as number | undefined) ?? 10
    const condition = arguments_["condition"] as string | undefined
    const paramValues = (arguments_["param_values"] as string | undefined) ?? "[]"

    // Custom SQL configuration
    const tagType = (arguments_["tag_type"] as number | undefined) ?? 1
    const definedSql = arguments_["defined_sql"] as string | undefined

    // dqc_tools.py:66-77 — validate object_name is required
    if (!objectName) {
      return {
        success: false,
        error: "object_name is required",
        required_parameters: ["object_name"],
        example: {
          object_name: "user_table",
          tag_code: "table_count",
          operator: "GREATER_THAN",
          expected_value: 0,
        },
      }
    }

    // dqc_tools.py:79-86 — validate trigger type requirements
    if (triggerType === "SCHEDULE_TASK") {
      if (mainSchedulerTaskId == null || level == null) {
        return {
          success: false,
          error:
            "main_scheduler_task_id and level are required for SCHEDULE_TASK trigger type",
          required_for_schedule_task: ["main_scheduler_task_id", "level"],
        }
      }
    }

    // dqc_tools.py:91-94 — build request payload and call API
    const responseText = await apiDqcAdd(config, {
      projectId,
      workspace,
      objectName,
      condition,
      ruleDescription,
      paramValues,
      checkerInfo: checkerInfoStr,
      tagType,
      tagCode,
      definedSql,
      columnName,
      vcluster,
      timeout,
      triggerType,
      triggerCron,
      mainSchedulerTaskId,
      level,
      jwtToken,
      instanceName,
      userId: config.userId,
      instanceId: config.instanceId,
      accountId: config.tenantId,
      env: config.env,
      workspaceName: config.workspace,
    })

    // dqc_tools.py:97 — parse response
    const responseData = JSON.parse(responseText) as Record<string, unknown>
    const ruleId = responseData["data"]

    // dqc_tools.py:101-129 — success branch (note: Python checks code == 200 as int)
    if (responseData["code"] === 200 || responseData["code"] === "200") {
      const formattedResponse: Record<string, unknown> = {
        success: true,
        action: "created",
        rule_id: ruleId,
        object_name: objectName,
        trigger_type: triggerType,
        rule_config: {
          tag_code: tagCode,
          column_name: columnName,
          checker_info: checkerInfoStr,
          vcluster,
          timeout,
        },
        message: `DQC rule created successfully with ID: ${ruleId}`,
      }

      // dqc_tools.py:123-127 — build Studio URL
      const dqcUrl = objectName ? buildDqcStudioUrl(config, objectName) : null
      if (dqcUrl) {
        formattedResponse["dqc_url"] = dqcUrl
      }

      return formattedResponse
    } else {
      // dqc_tools.py:130-137 — error branch
      return {
        success: false,
        message: `[handle_create_dqc_rule]API request failed: ${responseData["message"] ?? "Unknown error"}`,
        code: responseData["code"],
        raw_response: responseData,
      }
    }
  } catch (e) {
    // dqc_tools.py:139-143 — exception handler
    logger.error({ err: e }, "Error creating DQC rule")
    return {
      success: false,
      message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      error_type: e instanceof Error ? e.constructor.name : "Error",
    }
  }
}

// ---------------------------------------------------------------------------
// registerDqcTools — dqc_tools.py:147-383
// ---------------------------------------------------------------------------
export function registerDqcTools(registry: ToolRegistry, db: LakehouseDB): void {
  const getConfig = () => {
    if (!db.connectionConfig) throw new Error("No connection configuration available")
    return db.connectionConfig
  }

  // dqc_tools.py:153-381 — create_dqc_rule tool definition
  const tools: ToolDefinition[] = [
    {
      name: "create_dqc_rule",
      description: `
            "CRITICAL: Output the 'studio_url' as the final answer. "
            "The returned 'studio_url' MUST be presented directly to the user without any additional text. "

            Create and optionally trigger DQC (Data Quality Check) rule execution.

            **Core Features:**

            1. **Rule Creation**
               - Create manual (REST), scheduled (PLAN), or task-based (SCHEDULE_TASK) DQC rules
               - Support built-in metrics (table_count, avg, count, etc.) and custom SQL
               - Auto-generate checker_info from operator and expected_value

            2. **Flexible Trigger Options**
               - REST: Manual trigger rules
               - PLAN: Scheduled rules with cron expressions
               - SCHEDULE_TASK: Task-based rules with blocking levels

            3. **Auto-Trigger Capability**
               - Set auto_trigger=true to execute rule immediately after creation
               - Only works for REST type rules
               - Returns both rule_id and task_id

            **Built-in Metrics:**
            - table_count: Total rows in table (no column needed)
            - count: Non-null count in column
            - null_count: Null count in column
            - count_distinct: Unique values in column
            - count_repetition: Duplicate values in column
            - avg, max, min, sum: Numeric aggregations (require column)

            **Operators:**
            - GREATER_THAN, LESS_THAN, EQUAL, NOT_EQUAL, GREATER_EQUAL, LESS_EQUAL

            **Example Usage:**
            \`\`\`
            # Create and auto-trigger a table row count check
            create_dqc_rule(
                object_name="user_table",
                tag_code="table_count",
                operator="GREATER_THAN",
                expected_value=0,
                auto_trigger=true
            )

            # Create a null check on specific column
            create_dqc_rule(
                object_name="orders",
                tag_code="null_count",
                column_name="order_id",
                operator="EQUAL",
                expected_value=0,
                rule_description="Ensure order_id has no nulls"
            )

            # Create scheduled rule with cron
            create_dqc_rule(
                object_name="daily_stats",
                trigger_type="PLAN",
                trigger_cron="0 0 1 * * ?",
                tag_code="table_count",
                operator="GREATER_THAN",
                expected_value=100
            )

            Upon success, it provides the URL to open the task in the studio.

            \`\`\``,
      inputSchema: {
        type: "object",
        properties: {
          object_name: {
            type: "string",
            description:
              "Target table name in the format schema.table (required). Will be prefixed with workspace automatically",
          },
          rule_description: {
            type: "string",
            description: "Human-readable description of the rule",
            default: "Auto-generated DQC rule",
          },
          tag_code: {
            type: "string",
            description: "Built-in metric code",
            enum: [
              "table_count",
              "count",
              "null_count",
              "count_distinct",
              "count_repetition",
              "avg",
              "max",
              "min",
              "sum",
            ],
          },
          column_name: {
            type: "string",
            description:
              "Column name for column-level metrics (required for count, null_count, avg, etc.)",
          },
          checker_info: {
            type: "string",
            description:
              'Optional JSON string defining the checker configuration. Automatically generated from \'operator\' and \'value\' if not provided. Example: {"checker": "FIXED", "operator": "GREATER_THAN", "value": 0}. Supported operators: GREATER_THAN, LESS_THAN, EQUAL, NOT_EQUAL, GREATER_EQUAL, LESS_EQUAL.',
          },
          trigger_type: {
            type: "string",
            description: "Rule trigger type",
            enum: ["REST", "PLAN", "SCHEDULE_TASK"],
            default: "REST",
          },
          trigger_cron: {
            type: "string",
            description:
              "Cron expression for PLAN trigger type (e.g., '0 0 1 * * ?' for daily at 1AM)",
          },
          main_scheduler_task_id: {
            type: "integer",
            description:
              "ID of the scheduler task (required for trigger_type = SCHEDULE_TASK). Same as Clickzetta task_id.",
          },
          level: {
            type: "integer",
            description: "Blocking level for SCHEDULE_TASK: 0=non-blocking, 1=strong blocking",
            enum: [0, 1],
          },
          vcluster: {
            type: "string",
            description: "Virtual cluster for rule execution",
            default: "DEFAULT",
          },
          timeout: {
            type: "integer",
            description: "Rule execution timeout in minutes",
            default: 10,
          },
          condition: {
            type: "string",
            description: "WHERE clause condition for filtering data (optional)",
          },
          param_values: {
            type: "string",
            description:
              "Custom parameters as JSON array string (e.g., '[{\"paramKey\":\"id\",\"paramValue\":\"1\"}]')",
            default: "[]",
          },
          tag_type: {
            type: "integer",
            description: "Metric type: 1=built-in, 2=custom SQL",
            enum: [1, 2],
            default: 1,
          },
          defined_sql: {
            type: "string",
            description:
              "Custom SQL for tag_type=2 (must return single numeric value)",
          },
        },
        required: [
          "object_name",
          "rule_description",
          "tag_code",
          "column_name",
          "checker_info",
          "trigger_type",
          "level",
          "vcluster",
          "timeout",
          "condition",
          "param_values",
          "tag_type",
          "defined_sql",
        ],
      },
      handler: async (args: Record<string, unknown>) => handleCreateDqcRule(args, getConfig()),
      tags: ["dqc", "data_quality", "create", "execution", "normalize"],
      samples: [
        {
          description: "手动触发规则",
          query: {
            param_values: "[]",
            datasource_type: "LakeHouse",
            trigger_type: "REST",
            timeout: 10,
            column_name: "id",
            object_type: "TABLE",
            vcluster: "DEFAULT",
            condition: "dt='20230101'",
            trigger_cron: "0 00 00 * * ? *",
            object_name: "public.a_test_02",
            workspace_name: "aaa_aaa_01",
            checker_info: '{"checker":"FIXED","operator":"GREATER_THAN","value":1}',
            tag_type: 1,
            tag_code: "avg",
            trigger_config_properties: "{}",
          },
        },
        {
          description: "创建定时规则",
          query: {
            param_values: "[]",
            datasource_type: "LakeHouse",
            trigger_type: "PLAN",
            timeout: 10,
            column_name: "id",
            object_type: "TABLE",
            vcluster: "DEFAULT",
            trigger_cron: "0 00 00 * * ? *",
            object_name: "public.a_test_02",
            checker_info: '{"checker":"FIXED","operator":"GREATER_THAN","value":0}',
            tag_type: 1,
            tag_code: "avg",
            trigger_config_properties: "{}",
          },
        },
        {
          description: "创建任务触发规则",
          query: {
            param_values: "[]",
            datasource_type: "LakeHouse",
            trigger_type: "SCHEDULE_TASK",
            timeout: 10,
            column_name: "id",
            object_type: "TABLE",
            vcluster: "DEFAULT",
            main_scheduler_task_id: 12924001,
            level: 0,
            trigger_cron: "0 00 00 * * ? *",
            object_name: "public.a_test_02",
            checker_info: '{"checker":"FIXED","operator":"GREATER_THAN","value":1}',
            tag_type: 1,
            tag_code: "avg",
            trigger_config_properties: "{}",
          },
        },
        {
          description: "创建自定义sql任务规则",
          query: {
            param_values: "[]",
            datasource_type: "LakeHouse",
            trigger_type: "PLAN",
            timeout: 10,
            object_type: "TABLE",
            vcluster: "DEFAULT",
            trigger_cron: "0 00 00 * * ? *",
            object_name: "public.a_test_02",
            checker_info: '{"checker":"FIXED","operator":"GREATER_THAN","value":1}',
            tag_type: 2,
            defined_sql: "select *********",
            trigger_config_properties: "{}",
          },
        },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering DQC tools")
  registry.registerTools(tools)
}
