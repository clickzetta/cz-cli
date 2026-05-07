/**
 * ToolRegistry — line-by-line port of cz-mcp-server/cz_mcp/core/tool_registry.py
 *
 * Python → TS mapping:
 *   tool_registry.py:15-21  SYSTEM_PROMPT constant
 *   tool_registry.py:42     TOP_LEVEL_DESCRIPTION
 *   tool_registry.py:44     REQUIRED_FLAG
 *   tool_registry.py:47-54  Tool model          → ToolDefinition interface
 *   tool_registry.py:57-164 ToolDefinitionCache → ToolDefinitionCache class
 *   tool_registry.py:167-535 ToolRegistry       → ToolRegistry class
 */

import { logger } from "./logger.js"

// tool_registry.py:15-21
export const SYSTEM_PROMPT = `
<execution_context>
• Executable commands/Python available in terminal (e.g., use Bash to get [CURRENT_DATE])
• If specific region/instance specified in query, workspace parameter is REQUIRED to avoid context confusion
• Tool responses contain \`_user_preferences\` - display as ONE concise line: 🔹 user:{username}|workspace:{workspace_name}|vc:{vcluster}|schema:{schema}
</execution_context>
`

// tool_registry.py:42
export const TOP_LEVEL_DESCRIPTION = SYSTEM_PROMPT

// tool_registry.py:44
export const REQUIRED_FLAG = "REQUIRED. "

// tool_registry.py:47-54 — Tool model
export interface ToolDefinition {
  name: string
  description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => any
  tags: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  samples: Array<Record<string, any>>
  title?: string
}

/** Minimal MCP Tool shape (mirrors mcp.types.Tool from Python SDK) */
export interface McpTool {
  name: string
  description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: Record<string, any>
}

// tool_registry.py:57-164
export class ToolDefinitionCache {
  // tool_registry.py:60
  private _cache: Map<string, Record<string, unknown>>
  // tool_registry.py:61
  private _initialized: boolean
  // tool_registry.py:65-70 — performance stats (no RLock needed; TS is single-threaded)
  private _stats: {
    cache_hits: number
    cache_misses: number
    preload_time: number
    total_tools_cached: number
  }

  constructor() {
    this._cache = new Map()
    this._initialized = false
    this._stats = {
      cache_hits: 0,
      cache_misses: 0,
      preload_time: 0,
      total_tools_cached: 0,
    }
  }

  // tool_registry.py:72-96
  getToolSchema(tool: ToolDefinition): Record<string, unknown> {
    if (!this._cache.has(tool.name)) {
      // cache miss — create new schema entry
      this._cache.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })
      this._stats.cache_misses++
      this._stats.total_tools_cached = this._cache.size
    } else {
      // cache hit
      this._stats.cache_hits++
    }
    // return a shallow copy to avoid external mutation (tool_registry.py:96)
    return { ...this._cache.get(tool.name)! }
  }

  // tool_registry.py:98-124
  preloadTools(tools: ToolDefinition[]): void {
    const startTime = Date.now()
    logger.info({ count: tools.length }, "预加载工具定义到缓存")

    for (const tool of tools) {
      if (!this._cache.has(tool.name)) {
        this._cache.set(tool.name, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })
      }
    }

    this._initialized = true
    this._stats.total_tools_cached = this._cache.size

    const preloadTime = (Date.now() - startTime) / 1000
    this._stats.preload_time = preloadTime

    logger.info(
      { cached: this._cache.size, preload_time_s: preloadTime.toFixed(3) },
      "工具定义缓存初始化完成",
    )
  }

  // tool_registry.py:126-128
  isInitialized(): boolean {
    return this._initialized
  }

  // tool_registry.py:130-148
  getCacheStats(): Record<string, unknown> {
    const totalRequests = this._stats.cache_hits + this._stats.cache_misses
    const hitRate =
      totalRequests > 0 ? (this._stats.cache_hits / totalRequests) * 100 : 0

    return {
      initialized: this._initialized,
      cached_tools: this._cache.size,
      tool_names: [...this._cache.keys()],
      performance: {
        ...this._stats,
        hit_rate_percent: Math.round(hitRate * 100) / 100,
        total_requests: totalRequests,
      },
    }
  }

  // tool_registry.py:150-164
  clearCache(): void {
    this._cache.clear()
    this._initialized = false
    this._stats = {
      cache_hits: 0,
      cache_misses: 0,
      preload_time: 0,
      total_tools_cached: 0,
    }
    logger.info("工具定义缓存已清空")
  }
}

/**
 * Placeholder — Block 2 will fill in the real region description.
 * tool_registry.py:11 — from .region_config import get_region_description
 */
export function getRegionDescription(): string {
  return ""
}

/** ConfigurationException mirrors cz_mcp/core/exceptions.py */
export class ConfigurationException extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigurationException"
  }
}

// tool_registry.py:167-535
export class ToolRegistry {
  // tool_registry.py:175-179
  private _allTools: ToolDefinition[]
  private _handlersMap: Map<string, ToolDefinition["handler"]>
  private _definitionCache: ToolDefinitionCache
  private _initialized: boolean
  toolMap: Map<string, ToolDefinition>

  constructor() {
    this._allTools = []
    this._handlersMap = new Map()
    this._definitionCache = new ToolDefinitionCache()
    this._initialized = false
    this.toolMap = new Map()
  }

  // tool_registry.py:181-206
  registerTools(tools: ToolDefinition[]): void {
    logger.info({ count: tools.length }, "注册工具")

    // validate
    for (const tool of tools) {
      this._validateTool(tool)
    }

    // copy
    this._allTools = [...tools]

    // build handlers map
    this._handlersMap = new Map(tools.map((t) => [t.name, t.handler]))

    // preload cache
    this._definitionCache.preloadTools(tools)

    // build tool_map
    this.toolMap = new Map(tools.map((t) => [t.name, t]))

    this._initialized = true
    logger.info({ count: this._allTools.length }, "工具注册完成")
  }

  // tool_registry.py:208-236
  private _validateTool(tool: ToolDefinition): void {
    if (!tool.name) {
      throw new ConfigurationException("工具名称不能为空")
    }
    if (!tool.description) {
      throw new ConfigurationException(`工具 '${tool.name}' 缺少描述`)
    }
    if (!tool.inputSchema) {
      throw new ConfigurationException(`工具 '${tool.name}' 缺少inputSchema`)
    }
    if (typeof tool.handler !== "function") {
      throw new ConfigurationException(
        `工具 '${tool.name}' 的handler不是可调用对象`,
      )
    }
    if (typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) {
      throw new ConfigurationException(
        `工具 '${tool.name}' 的inputSchema必须是对象`,
      )
    }
    if (!("type" in tool.inputSchema)) {
      throw new ConfigurationException(
        `工具 '${tool.name}' 的inputSchema缺少type字段`,
      )
    }
  }

  // tool_registry.py:238-248
  getAllTools(): ToolDefinition[] {
    if (!this._initialized) {
      throw new ConfigurationException("工具注册器未初始化")
    }
    return [...this._allTools]
  }

  // tool_registry.py:250-284
  getAllowedTools(
    excludeTools?: string[],
    excludeTags?: string[],
  ): ToolDefinition[] {
    if (!this._initialized) {
      throw new ConfigurationException("工具注册器未初始化")
    }

    const excludeToolsSet = new Set(excludeTools ?? [])
    const excludeTagsSet = new Set(excludeTags ?? [])

    const allowed: ToolDefinition[] = []
    for (const tool of this._allTools) {
      if (excludeToolsSet.has(tool.name)) continue
      if (tool.tags.some((tag) => excludeTagsSet.has(tag))) continue
      allowed.push(tool)
    }

    logger.info(
      { allowed: allowed.length, total: this._allTools.length },
      "过滤后允许的工具数量",
    )
    return allowed
  }

  // tool_registry.py:286-296
  getToolHandler(toolName: string): ToolDefinition["handler"] | undefined {
    return this._handlersMap.get(toolName)
  }

  // tool_registry.py:298-311
  getToolSchema(toolName: string): Record<string, unknown> | null {
    for (const tool of this._allTools) {
      if (tool.name === toolName) {
        return this._definitionCache.getToolSchema(tool)
      }
    }
    return null
  }

  // tool_registry.py:313-328
  getToolsByTag(tag: string): ToolDefinition[] {
    const tools: ToolDefinition[] = []
    for (const tool of this._allTools) {
      if (tool.tags.includes(tag)) {
        // mutate description in-place, matching Python behaviour (line 326)
        tool.description = tool.description + TOP_LEVEL_DESCRIPTION
        tools.push(tool)
      }
    }
    return tools
  }

  // tool_registry.py:330-384
  private _processToolForList(
    tool: ToolDefinition,
  ): { name: string; description: string; inputSchema: Record<string, unknown> } | null {
    const schema = this._definitionCache.getToolSchema(tool)
    if (!schema["name"]) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputSchema: Record<string, any> = {
      ...(schema["inputSchema"] as Record<string, unknown>),
    }

    if (!("properties" in inputSchema)) {
      inputSchema["properties"] = {}
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties: Record<string, any> = inputSchema["properties"]

    // tool_registry.py:351-368 — four common config params
    const configParams: Record<string, { type: string; description: string }> = {
      region: {
        type: "string",
        description: `DO NOT SET unless user explicitly requests to change region. ${getRegionDescription()} Setting this will switch the cloud environment (e.g., from Alibaba Cloud to AWS). Only pass this parameter when user explicitly asks to change region.`,
      },
      workspace: {
        type: "string",
        description:
          "DO NOT SET unless user explicitly requests to change workspace. This parameter switches the workspace context. Only pass this parameter when user explicitly asks to switch to a different workspace.",
      },
      vcluster: {
        type: "string",
        description:
          "DO NOT SET unless user explicitly requests to change virtual cluster. This parameter switches the virtual cluster (vc) context. Only pass this parameter when user explicitly asks to switch to a different vcluster.",
      },
      schema: {
        type: "string",
        description:
          "DO NOT SET unless user explicitly requests to change schema. This parameter switches the database schema context (e.g., 'public', 'dev', 'sit'). Setting wrong schema like 'sit' may cause connection failures. Only pass this parameter when user explicitly asks to switch schema.",
      },
    }

    for (const [paramName, paramDef] of Object.entries(configParams)) {
      if (!(paramName in properties)) {
        properties[paramName] = paramDef
      }
    }

    // tool_registry.py:374-378
    const required: string[] = inputSchema["required"] ?? []
    let requiredStr = ""
    if (required.length > 0) {
      requiredStr = `; **REQUIRED PARAMETERS** ${required.join(",")};`
    }
    const desc =
      (schema["description"] as string) + requiredStr + TOP_LEVEL_DESCRIPTION

    return {
      name: schema["name"] as string,
      description: desc,
      inputSchema,
    }
  }

  // tool_registry.py:386-410
  getMcpToolList(allowedTools?: ToolDefinition[]): McpTool[] {
    const tools = allowedTools ?? this._allTools
    const mcpTools: McpTool[] = []

    for (const tool of tools) {
      const processed = this._processToolForList(tool)
      if (processed === null) continue
      mcpTools.push({
        name: processed.name,
        description: processed.description,
        inputSchema: processed.inputSchema,
      })
    }

    return mcpTools
  }

  // tool_registry.py:412-439
  getToolList(allowedTools?: ToolDefinition[]): ToolDefinition[] {
    const tools = allowedTools ?? this._allTools
    const result: ToolDefinition[] = []

    for (const tool of tools) {
      const processed = this._processToolForList(tool)
      if (processed === null) continue
      result.push({
        name: processed.name,
        description: processed.description,
        inputSchema: processed.inputSchema,
        handler: tool.handler,
        tags: [...(tool.tags ?? [])],
        samples: [...(tool.samples ?? [])],
      })
    }

    return result
  }

  // tool_registry.py:441-459
  getRegistryStats(): Record<string, unknown> {
    const tagCounts: Record<string, number> = {}
    for (const tool of this._allTools) {
      for (const tag of tool.tags) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
      }
    }

    return {
      initialized: this._initialized,
      total_tools: this._allTools.length,
      handlers_count: this._handlersMap.size,
      tag_distribution: tagCounts,
      cache_stats: this._definitionCache.getCacheStats(),
    }
  }

  // tool_registry.py:461-463
  isInitialized(): boolean {
    return this._initialized
  }

  // tool_registry.py:465-471
  reset(): void {
    this._allTools = []
    this._handlersMap.clear()
    this._definitionCache.clearCache()
    this._initialized = false
    this.toolMap.clear()
    logger.info("工具注册器已重置")
  }
}

// tool_registry.py:474-488 — global singleton
let _globalRegistry: ToolRegistry | null = null

export function getToolRegistry(): ToolRegistry {
  if (_globalRegistry === null) {
    _globalRegistry = new ToolRegistry()
  }
  return _globalRegistry
}
