import { describe, it, expect, beforeEach } from "bun:test"
import {
  ToolRegistry,
  ToolDefinitionCache,
  ToolDefinition,
  ConfigurationException,
  TOP_LEVEL_DESCRIPTION,
} from "../src/tool-registry.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "test_tool",
    description: "A test tool",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "SQL query" },
      },
      required: ["query"],
    },
    handler: async (_args: unknown) => ({ result: "ok" }),
    tags: ["test"],
    samples: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// ToolDefinitionCache
// ---------------------------------------------------------------------------

describe("ToolDefinitionCache", () => {
  it("returns a schema on first call (cache miss)", () => {
    const cache = new ToolDefinitionCache()
    const tool = makeTool()
    const schema = cache.getToolSchema(tool)
    expect(schema["name"]).toBe("test_tool")
    expect(schema["description"]).toBe("A test tool")
    const stats = cache.getCacheStats() as { performance: { cache_misses: number; cache_hits: number } }
    expect(stats.performance.cache_misses).toBe(1)
    expect(stats.performance.cache_hits).toBe(0)
  })

  it("returns a cache hit on second call", () => {
    const cache = new ToolDefinitionCache()
    const tool = makeTool()
    cache.getToolSchema(tool)
    cache.getToolSchema(tool)
    const stats = cache.getCacheStats() as { performance: { cache_hits: number } }
    expect(stats.performance.cache_hits).toBe(1)
  })

  it("returns a copy so external mutation does not corrupt cache", () => {
    const cache = new ToolDefinitionCache()
    const tool = makeTool()
    const schema = cache.getToolSchema(tool)
    ;(schema as Record<string, unknown>)["name"] = "mutated"
    const schema2 = cache.getToolSchema(tool)
    expect(schema2["name"]).toBe("test_tool")
  })

  it("preloadTools marks cache as initialized", () => {
    const cache = new ToolDefinitionCache()
    expect(cache.isInitialized()).toBe(false)
    cache.preloadTools([makeTool()])
    expect(cache.isInitialized()).toBe(true)
  })

  it("clearCache resets stats and initialized flag", () => {
    const cache = new ToolDefinitionCache()
    cache.preloadTools([makeTool()])
    cache.getToolSchema(makeTool())
    cache.clearCache()
    expect(cache.isInitialized()).toBe(false)
    const stats = cache.getCacheStats() as {
      cached_tools: number
      performance: { cache_hits: number; cache_misses: number; total_tools_cached: number }
    }
    expect(stats.cached_tools).toBe(0)
    expect(stats.performance.cache_hits).toBe(0)
    expect(stats.performance.cache_misses).toBe(0)
    expect(stats.performance.total_tools_cached).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

describe("ToolRegistry", () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  it("registers a tool and listTools returns it", () => {
    const tool = makeTool()
    registry.registerTools([tool])
    const list = registry.getMcpToolList()
    expect(list.length).toBe(1)
    expect(list[0]!.name).toBe("test_tool")
  })

  it("getToolHandler returns the correct handler", () => {
    const handler = async () => ({ result: "handler_ok" })
    const tool = makeTool({ handler })
    registry.registerTools([tool])
    expect(registry.getToolHandler("test_tool")).toBe(handler)
  })

  it("getToolHandler returns undefined for unknown tool", () => {
    registry.registerTools([makeTool()])
    expect(registry.getToolHandler("nonexistent")).toBeUndefined()
  })

  it("getToolSchema injects region/workspace/vcluster/schema params", () => {
    registry.registerTools([makeTool()])
    const list = registry.getMcpToolList()
    const schema = list[0]!.inputSchema as { properties: Record<string, unknown> }
    expect(schema.properties).toHaveProperty("region")
    expect(schema.properties).toHaveProperty("workspace")
    expect(schema.properties).toHaveProperty("vcluster")
    expect(schema.properties).toHaveProperty("schema")
  })

  it("getToolSchema returns null for unknown tool", () => {
    registry.registerTools([makeTool()])
    expect(registry.getToolSchema("nonexistent")).toBeNull()
  })

  it("_validateTool throws on missing name", () => {
    expect(() =>
      registry.registerTools([makeTool({ name: "" })]),
    ).toThrow(ConfigurationException)
  })

  it("_validateTool throws on missing description", () => {
    expect(() =>
      registry.registerTools([makeTool({ description: "" })]),
    ).toThrow(ConfigurationException)
  })

  it("_validateTool throws on missing inputSchema", () => {
    expect(() =>
      // @ts-expect-error intentionally passing null
      registry.registerTools([makeTool({ inputSchema: null })]),
    ).toThrow(ConfigurationException)
  })

  it("_validateTool throws when inputSchema has no type field", () => {
    expect(() =>
      registry.registerTools([
        makeTool({ inputSchema: { properties: {} } }),
      ]),
    ).toThrow(ConfigurationException)
  })

  it("getToolsByTag appends TOP_LEVEL_DESCRIPTION to description", () => {
    registry.registerTools([makeTool({ tags: ["analytics"] })])
    const tools = registry.getToolsByTag("analytics")
    expect(tools.length).toBe(1)
    expect(tools[0]!.description).toContain(TOP_LEVEL_DESCRIPTION)
  })

  it("getToolsByTag returns empty array for unknown tag", () => {
    registry.registerTools([makeTool()])
    expect(registry.getToolsByTag("unknown_tag")).toHaveLength(0)
  })

  it("getAllowedTools filters by name", () => {
    const t1 = makeTool({ name: "tool_a" })
    const t2 = makeTool({ name: "tool_b" })
    registry.registerTools([t1, t2])
    const allowed = registry.getAllowedTools(["tool_a"])
    expect(allowed.map((t) => t.name)).toEqual(["tool_b"])
  })

  it("getAllowedTools filters by tag", () => {
    const t1 = makeTool({ name: "tool_a", tags: ["admin"] })
    const t2 = makeTool({ name: "tool_b", tags: ["user"] })
    registry.registerTools([t1, t2])
    const allowed = registry.getAllowedTools([], ["admin"])
    expect(allowed.map((t) => t.name)).toEqual(["tool_b"])
  })

  it("getAllTools throws when not initialized", () => {
    expect(() => registry.getAllTools()).toThrow(ConfigurationException)
  })

  it("reset clears all state", () => {
    registry.registerTools([makeTool()])
    registry.reset()
    expect(registry.isInitialized()).toBe(false)
    expect(() => registry.getAllTools()).toThrow(ConfigurationException)
  })

  it("getMcpToolList appends TOP_LEVEL_DESCRIPTION to description", () => {
    registry.registerTools([makeTool()])
    const list = registry.getMcpToolList()
    expect(list[0]!.description).toContain(TOP_LEVEL_DESCRIPTION)
  })

  it("getMcpToolList includes required params in description", () => {
    registry.registerTools([makeTool()])
    const list = registry.getMcpToolList()
    // The tool has required: ["query"], so description should mention it
    expect(list[0]!.description).toContain("query")
  })
})
