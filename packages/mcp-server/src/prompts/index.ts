/**
 * MCP Prompts registration
 *
 * Python → TS mapping:
 *   mcp_registrar.py:256-278   register_prompts_to_server     → registerPrompts()
 *   mcp_registrar.py:820-853   _get_prompts_list_for_server   → list_prompts handler
 *   mcp_registrar.py:855-895   _get_prompt_for_server         → get_prompt handler
 *   prompts/system_prompt.py:1-167                            → CZ_SYSTEM_PROMPT
 *   prompts/semantic_view_modification_prompt.py:1-264        → ADD_DIMENSIONS_PROMPT, REMOVE_DIMENSIONS_PROMPT,
 *                                                                ADD_TABLES_PROMPT, REMOVE_TABLES_PROMPT
 *   prompts/semantic_view_query_generation_prompt.py:1-309    → SEMANTIC_QUERY_GENERATION_PROMPT
 *   prompts/snowflake_yaml_generation_prompt.py:1-505         → SNOWFLAKE_YAML_GENERATION_PROMPT
 *   prompts/snowflake_yaml_step_prompts.py:1-430              → STEP1..STEP3 prompts
 *   prompts/__init__.py:11-16                                 → PROMPTS registry
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { logger } from "../logger.js"

// ---------------------------------------------------------------------------
// Prompt argument type
// ---------------------------------------------------------------------------
interface PromptArgument {
  name: string
  description: string
  required: boolean
}

interface PromptDefinition {
  name: string
  description: string
  arguments?: PromptArgument[]
  content?: string
}

// ---------------------------------------------------------------------------
// system_prompt.py:1-167 — CZ_SYSTEM_PROMPT
// (description field contains the full prompt text, matching Python dict structure)
// ---------------------------------------------------------------------------
// NOTE: The Python CZ_SYSTEM_PROMPT dict uses "description" as the prompt body.
// We keep the same structure here.
const CZ_SYSTEM_PROMPT: PromptDefinition = {
  name: "cz_system_prompt",
  description: `
<system_role>
You are the Agent for the Clickzetta Studio system, responsible for receiving complex business requirements from users, performing task decomposition, workflow planning, and sub-task orchestration.
</system_role>

<critical_workflow>
⚠️ MANDATORY: Whenever the question requires any domain-specific knowledge beyond common sense or simple recall, you MUST strictly follow this workflow:

<step number="1" priority="CRITICAL">
<name>Search for Relevant Skills whenever the question requires any domain-specific knowledge beyond common sense or simple recall</name>
<action>Immediately call the find_helpful_skills tool</action>
<when>
- First step for ANY user request
- Regardless of task complexity or your confidence level
- BEFORE executing any searches, coding, or other operations
</when>
<output>Retrieve best practices and step-by-step guidance from the verified skills library</output>
</step>

<step number="2" priority="HIGH">
<name>Evaluate Skills Results and EXECUTE</name>
<condition_a>
<if>Relevant skills found</if>
<then>
When a user asks about the available skills, list_skills must be invoked.
⚠️ CRITICAL: You MUST EXECUTE the skills if they contain scripts, commands, or step-by-step instructions

<execution_protocol>
1. READ the skill instructions carefully, especially sections marked "AI EXECUTION INSTRUCTIONS"
2. EXECUTE the commands/tools specified in the skill (e.g., cz-table-stats, cz-sql-history)
3. PARSE the output and extract SQL queries, python scripts or other results
4. EXECUTE any generated SQL queries using the appropriate MCP tools (e.g., LH-execute_read_query)

❌ DO NOT:
- Just explain what the skill does without executing it
- Show the user the skill documentation content
- Skip the execution steps and provide generic advice

✅ DO:
- Actually run the commands specified in the skill
- Execute all generated SQL queries or API calls
- Provide analysis based on REAL execution results
</execution_protocol>
</then>
</condition_a>
<condition_b>
<if>No relevant skills found OR skills information insufficient</if>
<then>Proceed to step 3</then>
</condition_b>
</step>

<step number="3" priority="HIGH">
<name>Search Product Knowledge</name>
<action>Call the get_product_knowledge tool</action>
<when>
- find_helpful_skills returned no relevant results
- OR existing skills lack required technical details
</when>
<search_for>
- Product specifications
- API reference documentation
- Configuration details
- Technical architecture and implementation details
</search_for>
</step>

<step number="4" priority="NORMAL">
<name>Execute Task</name>
<action>Only after completing steps 1-3, proceed with searches, coding, or other operations</action>
</step>
</critical_workflow>

<anti_hallucination_rules>
⚠️ CRITICAL - Never fabricate or guess information:

<rule priority="CRITICAL">
If tool returns no results or incomplete data: State "No information available from tools" - DO NOT guess or make assumptions
</rule>

<rule priority="CRITICAL">
If documentation doesn't support a claim: State "No reliable documentation supports this viewpoint" - DO NOT fabricate references
</rule>

<rule priority="CRITICAL">
If uncertain or data is incomplete: Skip it and acknowledge the gap - DO NOT attempt to fill with assumptions or speculation
</rule>

<rule priority="CRITICAL">
Only use actual tool results: NEVER generate unverified hypotheses, fictional research, or made-up data
</rule>

<rule priority="CRITICAL">
If tool call fails or times out: Acknowledge the failure - DO NOT make up what the result might have been
</rule>

<examples>
✅ CORRECT: "The find_helpful_skills tool returned no relevant skills for this task."
❌ WRONG: "Based on common practices, you should probably..." (when no tool data supports this)

✅ CORRECT: "The get_product_knowledge tool shows no documentation for this feature."
❌ WRONG: "This feature likely works by..." (when no documentation exists)

✅ CORRECT: "The query returned incomplete results. I cannot provide information on X."
❌ WRONG: "Although the data is incomplete, X probably means..." (speculation)
</examples>
</anti_hallucination_rules>

<core_responsibilities>

<responsibility category="Requirement Understanding and Analysis">
<task>Understand User Intent</task>
<details>
Carefully analyze the business requirements proposed by users and identify key information:
- Business objectives: What goals does the user want to achieve?
- Data objects: Which data tables and data sources are involved?
- Processing logic: What kind of data processing logic is needed?
- Scheduling requirements: Is scheduled execution needed? What is the frequency?
- Quality requirements: Is data quality checking needed?
</details>
</responsibility>

<responsibility category="Requirement Clarification">
<task>Proactively Ask for Key Information</task>
<when>When requirements are unclear</when>
<ask_about>
- Data sources and target tables
- Business rules and processing logic
- Scheduling time and frequency
- Data quality requirements
</ask_about>
</responsibility>

<responsibility category="Task Decomposition and Planning">
<principle>Decompose complex requirements into executable sub-tasks</principle>
<requirements>
<requirement>Independence: Sub-tasks can be executed independently</requirement>
<requirement>Clarity: Clear inputs, outputs, and execution standards</requirement>
<requirement>Traceability: Clear success/failure criteria</requirement>
</requirements>

<common_task_types>
<task_type id="1">Data Synchronization Tasks: Offline sync, real-time sync, full and incremental sync</task_type>
<task_type id="2">Data Processing Tasks: SQL tasks, Python tasks, Shell tasks</task_type>
<task_type id="3">Data Quality Tasks: DQC rule creation, quality monitoring</task_type>
<task_type id="4">Scheduling Configuration Tasks: Task scheduling setup, dependency configuration</task_type>
<task_type id="5">Operations Management Tasks: Task monitoring, data backfill, task status checking</task_type>
</common_task_types>
</responsibility>

</core_responsibilities>

<execution_guidelines>
<guideline priority="CRITICAL">
Always call find_helpful_skills first, then call get_product_knowledge as needed
</guideline>
<guideline priority="CRITICAL">
Never fabricate information - only use actual tool results
</guideline>
<guideline priority="HIGH">
Follow the best practices and step-by-step guidance in the skills library
</guideline>
<guideline priority="NORMAL">
Maintain independence, clarity, and traceability in task decomposition
</guideline>
</execution_guidelines>
`,
}

// ---------------------------------------------------------------------------
// semantic_view_modification_prompt.py:7-90 — ADD_DIMENSIONS_PROMPT
// ---------------------------------------------------------------------------
const ADD_DIMENSIONS_PROMPT: PromptDefinition = {
  name: "add_dimensions_to_semantic_view",
  description: "根据用户描述，从已有表中选择合适的维度添加到 Semantic View",
  arguments: [
    {
      name: "semantic_view_name",
      description: "要修改的 Semantic View 名称",
      required: true,
    },
    {
      name: "user_description",
      description: "用户描述想要添加的维度（自然语言）",
      required: true,
    },
  ],
  content: `
# 任务：为 Semantic View 增加新维度

## 输入
1. Semantic View 名称: {semantic_view_name}
2. 用户描述: {user_description}

## 步骤

### 1. 获取 Semantic View 定义
使用 \`desc_semantic_view\` 获取当前定义，查看：
- 已有的 TABLES（逻辑表）
- 已有的 DIMENSIONS（已添加的维度）
- 可用的表字段

### 2. 分析用户需求
从用户描述中提取：
- 需要添加的维度类型（日期、地区、类别等）
- 相关的业务实体（订单、客户、商品等）
- 维度的用途

### 3. 选择维度
从 TABLES 中选择合适的字段作为维度：
- 字段必须来自已定义的逻辑表
- 避免重复（检查已有 DIMENSIONS）
- 考虑字段的业务含义

### 4. 输出 JSON
返回要添加的维度列表：

\`\`\`json
{
  "dimensions": [
    {
      "logical_table": "逻辑表名",
      "dimension_name": "字段名",
      "alias": "维度别名",
      "synonyms": ["同义词1", "同义词2"],
      "comment": "维度说明"
    }
  ]
}
\`\`\`

## 示例

**用户描述**: "我想按订单日期分析"

**输出**:
\`\`\`json
{
  "dimensions": [
    {
      "logical_table": "Orders",
      "dimension_name": "o_orderdate",
      "alias": "订单日期",
      "synonyms": ["下单日期", "订单时间"],
      "comment": "订单的下单日期，用于时间维度分析"
    }
  ]
}
\`\`\`

**注意**：
- 只返回 JSON，不要解释
- 确保字段存在于逻辑表中
- 不要添加已存在的维度
`,
}

// ---------------------------------------------------------------------------
// semantic_view_modification_prompt.py:93-141 — REMOVE_DIMENSIONS_PROMPT
// ---------------------------------------------------------------------------
const REMOVE_DIMENSIONS_PROMPT: PromptDefinition = {
  name: "remove_dimensions_from_semantic_view",
  description: "根据用户描述，选择要从 Semantic View 中删除的维度",
  arguments: [
    {
      name: "semantic_view_name",
      description: "要修改的 Semantic View 名称",
      required: true,
    },
    {
      name: "user_description",
      description: "用户描述想要删除的维度",
      required: true,
    },
  ],
  content: `
# 任务：从 Semantic View 删除维度

## 步骤

### 1. 获取当前维度
使用 \`desc_semantic_view\` 查看所有已有维度

### 2. 匹配用户描述
根据用户描述匹配要删除的维度：
- 使用维度名称
- 使用同义词
- 使用注释中的描述

### 3. 输出 JSON
\`\`\`json
{
  "dimensions_to_remove": ["dimension_name1", "dimension_name2"]
}
\`\`\`

## 示例

**用户描述**: "删除订单日期维度"

**输出**:
\`\`\`json
{
  "dimensions_to_remove": ["o_orderdate"]
}
\`\`\`
`,
}

// ---------------------------------------------------------------------------
// semantic_view_modification_prompt.py:144-213 — ADD_TABLES_PROMPT
// ---------------------------------------------------------------------------
const ADD_TABLES_PROMPT: PromptDefinition = {
  name: "add_tables_to_semantic_view",
  description: "根据用户描述，选择要添加到 Semantic View 的表",
  arguments: [
    {
      name: "semantic_view_name",
      description: "要修改的 Semantic View 名称",
      required: true,
    },
    {
      name: "user_description",
      description: "用户描述想要添加的表",
      required: true,
    },
  ],
  content: `
# 任务：为 Semantic View 添加新表

## 步骤

### 1. 获取可用表
使用 \`get_all_tables_metadata\` 获取 schema 中的所有表

### 2. 分析用户需求
提取需要的表类型和业务实体

### 3. 选择表并定义关系
\`\`\`json
{
  "tables": [
    {
      "logical_name": "逻辑表名",
      "physical_table": "workspace.schema.table_name",
      "foreign_keys": [
        {
          "column": "关联字段",
          "references": "引用的逻辑表"
        }
      ],
      "comment": "表说明"
    }
  ]
}
\`\`\`

## 示例

**用户描述**: "我想添加商品表进行商品维度分析"

**输出**:
\`\`\`json
{
  "tables": [
    {
      "logical_name": "Product",
      "physical_table": "datagpt_ws.SV_LXJ.PRODUCT",
      "foreign_keys": [
        {
          "column": "p_partkey",
          "references": "LineItem"
        }
      ],
      "comment": "商品信息表，包含商品属性和分类"
    }
  ]
}
\`\`\`
`,
}

// ---------------------------------------------------------------------------
// semantic_view_modification_prompt.py:216-263 — REMOVE_TABLES_PROMPT
// ---------------------------------------------------------------------------
const REMOVE_TABLES_PROMPT: PromptDefinition = {
  name: "remove_tables_from_semantic_view",
  description: "根据用户描述，选择要从 Semantic View 中删除的表",
  arguments: [
    {
      name: "semantic_view_name",
      description: "要修改的 Semantic View 名称",
      required: true,
    },
    {
      name: "user_description",
      description: "用户描述想要删除的表",
      required: true,
    },
  ],
  content: `
# 任务：从 Semantic View 删除表

## 步骤

### 1. 获取当前表
使用 \`desc_semantic_view\` 查看所有已有表

### 2. 检查依赖
确认删除表不会破坏外键关系

### 3. 输出 JSON
\`\`\`json
{
  "tables_to_remove": ["logical_table_name1", "logical_table_name2"]
}
\`\`\`

## 示例

**用户描述**: "删除 LineItem 表"

**输出**:
\`\`\`json
{
  "tables_to_remove": ["LineItem"]
}
\`\`\`

**警告**: 如果其他表依赖此表，会提示错误
`,
}

// ---------------------------------------------------------------------------
// prompts/__init__.py:11-16 — PROMPTS registry
// Maps prompt name → PromptDefinition, mirrors Python PROMPTS dict.
// ---------------------------------------------------------------------------
export const PROMPTS: Record<string, PromptDefinition> = {
  cz_system_prompt: CZ_SYSTEM_PROMPT,
  add_dimensions_to_semantic_view: ADD_DIMENSIONS_PROMPT,
  remove_dimensions_from_semantic_view: REMOVE_DIMENSIONS_PROMPT,
  add_tables_to_semantic_view: ADD_TABLES_PROMPT,
  remove_tables_from_semantic_view: REMOVE_TABLES_PROMPT,
}

// ---------------------------------------------------------------------------
// registerPrompts — mcp_registrar.py:256-278
//
// Registers list_prompts and get_prompt handlers on the MCP Server.
// Mirrors _get_prompts_list_for_server (lines 820-853) and
// _get_prompt_for_server (lines 855-895).
// ---------------------------------------------------------------------------
export function registerPrompts(server: Server): void {
  // mcp_registrar.py:264-267 — @server.list_prompts()
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    // mcp_registrar.py:820-853 — _get_prompts_list_for_server
    const promptList = Object.entries(PROMPTS).map(([, data]) => ({
      name: data.name,
      description: data.description,
      arguments: (data.arguments ?? []).map((arg) => ({
        name: arg.name,
        description: arg.description,
        required: arg.required,
      })),
    }))
    logger.info({ count: promptList.length }, "Returning prompts list")
    return { prompts: promptList }
  })

  // mcp_registrar.py:269-272 — @server.get_prompt()
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    // mcp_registrar.py:855-895 — _get_prompt_for_server
    const name = request.params.name
    const args = (request.params.arguments as Record<string, string> | undefined) ?? {}

    // mcp_registrar.py:860-861 — prompt not found
    const promptObj = Object.values(PROMPTS).find((p) => p.name === name)
    if (!promptObj) {
      throw new Error(`Prompt not found: ${name}`)
    }

    // mcp_registrar.py:863-877 — special handling for create_table_interactive
    if (name === "create_table_interactive") {
      const tableName = args["table_name"] ?? ""
      const columns = args["columns"] ?? ""
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Create a table named '${tableName}' with the following columns:\n\n${columns}`,
            },
          },
        ],
      }
    }

    // mcp_registrar.py:879-891 — default: return description as prompt text
    const text = promptObj.content ?? promptObj.description
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text,
          },
        },
      ],
    }
  })

  logger.info("Prompts registered")
}
