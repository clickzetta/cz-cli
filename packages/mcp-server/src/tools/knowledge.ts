/**
 * Knowledge index tools — port of cz-mcp-server/cz_mcp/tools/knowledge_index_tools.py
 *
 * Python → TS mapping:
 *   knowledge_index_tools.py:21-125  RestProviderV2 class         → RestProviderV2 class
 *   knowledge_index_tools.py:127-193 handle_put_knowledge         → handlePutKnowledge()
 *   knowledge_index_tools.py:196-267 handle_search_knowledge      → handleSearchKnowledge()
 *   knowledge_index_tools.py:270-310 handle_get_product_knowledge → handleGetProductKnowledge()
 *   knowledge_index_tools.py:312-484 create_knowledge_tools()     → registerKnowledgeTools()
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"

// ---------------------------------------------------------------------------
// Constants — knowledge_index_tools.py:17-18
// ---------------------------------------------------------------------------
const RETRY_COUNT = 3
const RETRY_DELAY_MS = 500 // 0.5 seconds

// ---------------------------------------------------------------------------
// RestProviderV2 — knowledge_index_tools.py:21-125
// ---------------------------------------------------------------------------
class RestProviderV2 {
  // knowledge_index_tools.py:22-27
  readonly endpoint: string
  readonly tenantId: number
  space: string
  readonly apiKey: string

  constructor(tenantId: number, env: string) {
    this.endpoint = "http://aliyun-sh-knowledge.clickzetta-inc.com" // Hardcode to aliyun sh-prod
    this.tenantId = tenantId
    this.space = "mcp_" + env
    this.apiKey = "ddeyswnxhjcuehocivtfbslwwllpadhk" // Hardcode
    logger.info({ endpoint: this.endpoint }, "Initializing rest db provider")
  }

  // knowledge_index_tools.py:34-70 — async_put
  async asyncPut(
    key: string,
    providers: string[],
    meta: string,
    tags: string[] = [],
  ): Promise<unknown> {
    logger.info({ space: this.space, key, meta, tags }, "put called")
    const url =
      `${this.endpoint}/v2/put?tenant_id=${this.tenantId}&api_key=${this.apiKey}` +
      `&space=${this.space}&providers=${providers.join(",")}`
    const payload = { key, meta, k_id: "", tags }

    let lastExc: unknown
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          const body = await response.text()
          throw new Error(`async_put failed with HTTP ${response.status}, body: ${body}, url: ${url}`)
        }
        const json = (await response.json()) as Record<string, unknown>
        return json["result"]
      } catch (e) {
        lastExc = e
        if (attempt < RETRY_COUNT) {
          logger.warn({ attempt, err: e }, `async_put attempt ${attempt} failed, retrying...`)
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
        }
      }
    }
    throw lastExc
  }

  // knowledge_index_tools.py:72-113 — async_search
  async asyncSearch(
    key: string,
    limit: number,
    providers: string[],
    rerank: boolean,
    maxDistance = 1000.0,
    minScore = 0.0,
    tags: string[] = [],
  ): Promise<unknown[]> {
    logger.info(
      { space: this.space, key, limit, maxDistance, minScore, providers, tags },
      "async_msearch called",
    )
    const url =
      `${this.endpoint}/v2/search?tenant_id=${this.tenantId}&api_key=${this.apiKey}` +
      `&space=${this.space}&providers=${providers.join(",")}`
    const payload = {
      key,
      limit,
      rank_func: rerank ? "Reranker" : "None",
      max_distance: maxDistance,
      min_score: minScore,
      tags,
      metric_aggressive: false,
    }

    let lastExc: unknown
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          const body = await response.text()
          throw new Error(`msearch failed with HTTP ${response.status}, body: ${body}, url: ${url}`)
        }
        const json = (await response.json()) as Record<string, unknown>
        return json["result"] as unknown[]
      } catch (e) {
        lastExc = e
        if (attempt < RETRY_COUNT) {
          logger.warn({ attempt, err: e }, `async_search attempt ${attempt} failed, retrying...`)
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
        }
      }
    }
    throw lastExc
  }

  // knowledge_index_tools.py:115-124 — create_space
  createSpace(providers: string[]): unknown {
    const url =
      `${this.endpoint}/v2/create_space?tenant_id=${this.tenantId}&api_key=${this.apiKey}` +
      `&space=${this.space}&providers=${providers.join(",")}`
    // Synchronous fetch is not available in Node; use a fire-and-forget pattern
    // matching Python's requests.get() call
    fetch(url).catch((e) => {
      logger.warn({ err: e }, "create_space failed (swallowed)")
    })
    return null
  }
}

// ---------------------------------------------------------------------------
// handlePutKnowledge — knowledge_index_tools.py:127-193
// ---------------------------------------------------------------------------
async function handlePutKnowledge(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) {
    return { success: false, error: "Server not initialized! db connection_config is None" }
  }

  const env = config.env
  const tenantId = config.tenantId

  // knowledge_index_tools.py:148-152
  const key = args["key"] as string | undefined
  const meta = (args["meta"] as string | undefined) ?? ""
  const tags = (args["tags"] as string[]) ?? []
  const indexList = (args["index_list"] as string[]) ?? ["vector"]

  if (!key || key.trim() === "") {
    return { success: false, error: "key is required" }
  }

  // knowledge_index_tools.py:160-168 — map index types to providers
  const indexProviders: string[] = []
  for (const index of indexList) {
    if (index === "vector") indexProviders.push("lh-vector")
    else if (index === "scalar") indexProviders.push("es")
  }
  if (indexProviders.length === 0) indexProviders.push("lh-vector")

  const kbProvider = new RestProviderV2(tenantId, env)

  // knowledge_index_tools.py:171-175 — create_space (swallow errors)
  try {
    kbProvider.createSpace(indexProviders)
  } catch (_e) {
    // swallow any exception and let put throw if failed
  }

  try {
    await kbProvider.asyncPut(key, indexProviders, meta, tags)
    return { success: true, action: "created" }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error putting knowledge")
    return { success: false, error: err.message }
  }
}

// ---------------------------------------------------------------------------
// handleSearchKnowledge — knowledge_index_tools.py:196-267
// ---------------------------------------------------------------------------
async function handleSearchKnowledge(
  args: Record<string, unknown>,
  db: LakehouseDB,
): Promise<Record<string, unknown>> {
  const config = db.connectionConfig
  if (!config) {
    return { success: false, error: "Server not initialized! db connection_config is None" }
  }

  const env = config.env
  const tenantId = config.tenantId

  // knowledge_index_tools.py:217-224
  const query = args["query"] as string | undefined
  const limit = (args["limit"] as number | undefined) ?? 8
  const rerank = (args["rerank"] as boolean | undefined) ?? false
  const maxDistance = (args["max_distance"] as number | undefined) ?? 1000.0
  const minScore = (args["min_score"] as number | undefined) ?? 0.0
  const tags = (args["tags"] as string[]) ?? []
  const indexList = (args["index_list"] as string[]) ?? ["vector"]

  if (!query || query.trim() === "") {
    return { success: false, error: "query is required" }
  }

  // knowledge_index_tools.py:232-240 — map index types to providers
  const indexProviders: string[] = []
  for (const index of indexList) {
    if (index === "vector") indexProviders.push("lh-vector")
    else if (index === "scalar") indexProviders.push("es")
  }
  if (indexProviders.length === 0) indexProviders.push("lh-vector")

  const kbProvider = new RestProviderV2(tenantId, env)

  try {
    const knowledges = await kbProvider.asyncSearch(
      query,
      limit,
      indexProviders,
      rerank,
      maxDistance,
      minScore,
      tags,
    )
    return { success: true, action: "created", knowledges }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error searching knowledge")
    return { success: false, error: err.message }
  }
}

// ---------------------------------------------------------------------------
// handleGetProductKnowledge — knowledge_index_tools.py:270-310
// ---------------------------------------------------------------------------
async function handleGetProductKnowledge(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = args["query"] as string | undefined
  const limit = (args["limit"] as number | undefined) ?? 5

  // knowledge_index_tools.py:274-276 — fixed tenant/space for product docs
  const provider = new RestProviderV2(107, "prod")
  provider.space = "zetta_doc_qa"

  try {
    const results = await provider.asyncSearch(query ?? "", limit, ["lh-vector"], false)
    logger.debug({ results }, "Search results for query")

    // knowledge_index_tools.py:287-299 — corrective RAG guidance
    const correctiveRagGuidance =
      "<CORRECTIVE-RAG EVALUATION REQUIRED>\n" +
      "• Assess if these results are relevant to your query\n" +
      "• If relevance is low, modify the query and call get_product_knowledge again\n" +
      "• Try different keywords, remove high-weight terms (clickzetta, lakehouse, studio, 任务, 作业)\n" +
      "• Maximum 3 attempts recommended for optimal results\n" +
      "• Consider using more specific technical terms or Chinese keywords\n\n" +
      "**IMPORTANT SQL ENGINE CONTEXT**:\n" +
      "• This system uses Lakehouse SQL Engine (云器Lakehouse - 基于增量计算的云湖仓) with its own SQL dialect\n" +
      "• Compatible with Spark basic syntax only\n" +
      "• Stick to YunQi(云器) Lakehouse-specific SQL features and syntax to avoid confusion" +
      "</CORRECTIVE-RAG EVALUATION REQUIRED>\n"

    return { results, corrective_rag_guidance: correctiveRagGuidance }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err }, "Error getting product knowledge")
    return { success: false, error: err.message }
  }
}

// ---------------------------------------------------------------------------
// registerKnowledgeTools — knowledge_index_tools.py:312-484
// ---------------------------------------------------------------------------
export function registerKnowledgeTools(registry: ToolRegistry, db: LakehouseDB): void {
  const tools: ToolDefinition[] = [
    // knowledge_index_tools.py:318-359 — put_knowledge
    {
      name: "put_knowledge",
      description: "Put a text knowledge entry into the knowledge base with index created.",
      inputSchema: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "The text to index.",
          },
          meta: {
            type: "string",
            description:
              "The meta information associated with the knowledge entry, will not be indexed but will be retrieved if a later search recalled this knowledge.",
          },
          tags: {
            type: "array",
            description: "tags of this knowledge, can be used as search filters",
            items: { type: "string" },
            default: [],
          },
          index_list: {
            type: "array",
            description:
              "index_list of this knowledge, vector and/or scalar or both. default empty means vector index",
            items: { type: "string" },
            default: [],
          },
        },
        required: ["key"],
      },
      handler: async (args: Record<string, unknown>) => {
        return handlePutKnowledge(args, db)
      },
      tags: ["create", "execution", "normalize"],
      samples: [
        {
          key: "北京是中国的首都",
          meta: "This is a knowledge about Beijing.",
          tags: ["category=geography", "type=capital"],
          index_list: ["vector"],
        },
      ],
    },
    // knowledge_index_tools.py:361-438 — search_knowledge
    {
      name: "search_knowledge",
      description:
        "Search manually entered and labeled knowledge base content, including successful cases and feedback.\n\n" +
        "**SEARCH OPTIMIZATION RULES**:\n" +
        "• Remove high-weight terms before querying: clickzetta, lakehouse, studio, 任务, 作业\n" +
        "• Prioritize Chinese queries as embedding model is trained on Chinese\n" +
        "• Retrieved results may be inaccurate, evaluate confidence and re-query if needed\n\n" +
        "**NOTE**: This tool queries user-specific knowledge only. For product technical documentation, use get_product_knowledge tool.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The text to search.",
          },
          tags: {
            type: "array",
            description: "tags of will be used as search filters",
            items: { type: "string" },
            default: [],
          },
          index_list: {
            type: "array",
            description:
              "index_list to search from, vector and/or scalar or both. default empty means vector index",
            items: { type: "string" },
            default: [],
          },
          limit: {
            type: "integer",
            description: "maximum number of results to return",
            default: 8,
          },
          rerank: {
            type: "boolean",
            description: "whether to rerank the results with reranking model",
            default: false,
          },
          max_distance: {
            type: "number",
            description: "maximum distance for vector search",
            default: 1000.0,
          },
          min_score: {
            type: "number",
            description: "minimum score for scalar search",
            default: 0.0,
          },
        },
        required: ["query"],
      },
      handler: async (args: Record<string, unknown>) => {
        return handleSearchKnowledge(args, db)
      },
      tags: ["execution", "normalize"],
      samples: [
        { query: "北京是中国的首都" },
        { query: "中国的首都是什么？", tags: ["category=geography"], limit: 3 },
        { query: "中国的首都是什么？", index_list: ["vector", "scalar"], limit: 5, rerank: true },
        { query: "中国的首都是什么？", index_list: ["scalar"], limit: 5, min_score: 0.5 },
      ],
    },
    // knowledge_index_tools.py:441-482 — get_product_knowledge
    {
      name: "get_product_knowledge",
      description:
        "Search Clickzetta Lakehouse and Studio specification knowledge base for domain-specific " +
        "technical documentation and product knowledge. To assist in answering questions about product features, usage, " +
        "SQL dialects, APIs, java and python SDKs, configurations, and best practices.\n\n" +
        "**SEARCH OPTIMIZATION RULES**:\n" +
        "• Remove high-weight terms keyword before querying: clickzetta, lakehouse, studio, 任务, 作业\n" +
        "• Prioritize Chinese queries as embedding model is trained on Chinese Tech Document\n" +
        "• Retrieved results may be inaccurate, evaluate confidence and re-query if needed\n\n" +
        "**IMPORTANT**: This tool searches PRODUCT DOCUMENTATION only. For user-specific " +
        "knowledge (successful cases, feedback), use search_knowledge tool instead.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The text to search.",
          },
          limit: {
            type: "integer",
            description: "maximum number of results to return",
            default: 8,
          },
        },
        required: ["query"],
      },
      handler: async (args: Record<string, unknown>) => {
        return handleGetProductKnowledge(args)
      },
      tags: ["execution", "normalize"],
      samples: [
        { query: "Java SDK 参考" },
        { query: "Java SDK 参考", limit: 3 },
      ],
    },
  ]

  logger.info({ count: tools.length }, "Registering knowledge tools")
  registry.registerTools(tools)
}
