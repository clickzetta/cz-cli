/**
 * HTTP server with MCP Streamable HTTP transport.
 *
 * Python → TS mapping:
 *   http_server.py:31-64    LoadingState class          → LoadingState class
 *   http_server.py:66-136   register_mcp_tools()        → registerMcpTools()
 *   http_server.py:138-185  health_check()              → buildHealthResponse()
 *   http_server.py:188-319  initialize_backend()        → initializeBackend()
 *   http_server.py:322-348  run_server()                → runServer()
 *
 * Framework divergences from Python:
 *   - FastMCP + uvicorn → @modelcontextprotocol/sdk Server + Hono + node:http
 *   - threading.Lock → JS single-threaded (no lock needed; kept as structural parity)
 *   - threading.Thread → Promise + async background loader
 *   - mcp.tool() decorator → server.setRequestHandler(CallToolRequestSchema)
 *   - load_skills_in_batches / load_all_skills → loadFromLocal (available in loader.ts)
 */

import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { Hono } from "hono"
import { logger } from "../logger.js"
import { loadConfig } from "./config.js"
import { HourlyScheduler } from "./scheduler.js"
import { SkillSearchEngine } from "./search.js"
import { loadFromLocal } from "./loader.js"
import { UpdateChecker } from "./update-checker.js"
import type { SkillsConfig, SkillSource } from "./config.js"

// ---------------------------------------------------------------------------
// Global state — http_server.py:24-28
// ---------------------------------------------------------------------------

let searchEngine: SkillSearchEngine | null = null
let loadingStateGlobal: LoadingState | null = null
let updateCheckerGlobal: UpdateChecker | null = null
let schedulerGlobal: HourlyScheduler | null = null
let configGlobal: SkillsConfig | null = null

// ---------------------------------------------------------------------------
// http_server.py:31-64 — LoadingState class
// ---------------------------------------------------------------------------

/**
 * State tracker for background skill loading.
 * Python uses threading.Lock; JS is single-threaded so the lock is a no-op.
 */
export class LoadingState {
  totalSkills: number = 0
  loadedSkills: number = 0
  isComplete: boolean = false
  errors: string[] = []

  // http_server.py:41-45 — update_progress()
  updateProgress(loaded: number, total?: number): void {
    this.loadedSkills = loaded
    if (total !== undefined) {
      this.totalSkills = total
    }
  }

  // http_server.py:47-49 — add_error()
  addError(error: string): void {
    this.errors.push(error)
  }

  // http_server.py:51-53 — mark_complete()
  markComplete(): void {
    this.isComplete = true
  }

  // http_server.py:55-63 — get_status_message()
  getStatusMessage(): string | null {
    if (this.isComplete) return null
    if (this.loadedSkills === 0) {
      return "[LOADING: Skills are being loaded in the background, please wait...]\n"
    }
    if (this.totalSkills > 0) {
      return `[LOADING: ${this.loadedSkills}/${this.totalSkills} skills loaded, indexing in progress...]\n`
    }
    return `[LOADING: ${this.loadedSkills} skills loaded so far, indexing in progress...]\n`
  }
}

// ---------------------------------------------------------------------------
// http_server.py:66-136 — register_mcp_tools()
// ---------------------------------------------------------------------------

/**
 * Register MCP tools on the given server instance.
 *
 * Python uses FastMCP @mcp.tool() decorators; here we use the low-level SDK
 * setRequestHandler(ListToolsRequestSchema) + setRequestHandler(CallToolRequestSchema).
 */
export function registerMcpTools(
  server: Server,
  defaultTopK: number = 3,
  maxContentChars: number | null = null,
): void {
  // http_server.py:76-99 — find_helpful_skills tool definition
  const findHelpfulSkillsTool = {
    name: "find_helpful_skills",
    description:
      "Always call this tool FIRST whenever the question requires any domain-specific knowledge " +
      "beyond common sense or simple recall. Use it at task start, regardless of the task and whether " +
      "you are sure about the task, It performs semantic search over a curated library of proven skills " +
      "and returns ranked candidates with step-by-step guidance and best practices. Do this before any " +
      "searches, coding, or any other actions as this will inform you about the best approach to take.",
    inputSchema: {
      type: "object" as const,
      properties: {
        task_description: { type: "string", description: "Description of the task to find skills for" },
        top_k: { type: "number", description: "Number of top results to return", default: defaultTopK },
        list_documents: { type: "boolean", description: "Whether to list available documents", default: true },
      },
      required: ["task_description"],
    },
  }

  // http_server.py:101-119 — read_skill_document tool definition
  const readSkillDocumentTool = {
    name: "read_skill_document",
    description:
      "Use after finding a relevant skill to retrieve specific documents (scripts, references, assets). " +
      "Supports pattern matching (e.g., 'scripts/*.py') to fetch multiple files. Returns text content or URLs " +
      "and never executes code. Prefer pulling only the files you need to complete the current step.",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_name: { type: "string", description: "Name of the skill to read documents from" },
        document_path: { type: "string", description: "Path or glob pattern for the document(s) to read" },
        include_base64: { type: "boolean", description: "Whether to include base64-encoded binary content", default: false },
      },
      required: ["skill_name"],
    },
  }

  // http_server.py:121-135 — list_skills tool definition
  const listSkillsTool = {
    name: "list_skills",
    description:
      "Returns the full inventory of loaded skills (names, descriptions, sources, document counts) " +
      "for exploration or debugging. For task-driven work, prefer calling 'find_helpful_skills' first " +
      "to locate the most relevant option before reading documents." +
      "** USE CASES **\n" +
      "- What skills does Clickzetta MCP offer?\n" +
      "- What skills do I have?\n",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  }

  // Register list-tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [findHelpfulSkillsTool, readSkillDocumentTool, listSkillsTool],
    }
  })

  // Register call-tool handler — http_server.py:87-135 tool implementations
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params

    // http_server.py:87-99 — find_helpful_skills handler
    if (name === "find_helpful_skills") {
      const taskDescription = args["task_description"] as string
      const topK = (args["top_k"] as number | undefined) ?? defaultTopK
      const listDocuments = (args["list_documents"] as boolean | undefined) ?? true

      const loadingMsg = loadingStateGlobal?.getStatusMessage()

      if (!searchEngine) {
        const msg = loadingMsg ?? "[ERROR: Search engine not initialized]\n"
        return { content: [{ type: "text", text: msg }] }
      }

      const results = searchEngine.search(taskDescription, topK)

      if (results.length === 0) {
        const noResults = loadingMsg
          ? `${loadingMsg}No skills found yet for: ${taskDescription}`
          : `No skills found for: ${taskDescription}`
        return { content: [{ type: "text", text: noResults }] }
      }

      const lines: string[] = []
      if (loadingMsg) lines.push(loadingMsg)

      for (const result of results) {
        const skillName = result["name"] as string
        const skillDesc = result["description"] as string
        const skillContent = result["content"] as string
        const skillDocs = result["documents"] as Record<string, unknown>
        const score = result["relevance_score"] as number

        lines.push(`## ${skillName} (score: ${score.toFixed(3)})`)
        lines.push(skillDesc)
        lines.push("")
        const content = maxContentChars !== null
          ? skillContent.slice(0, maxContentChars)
          : skillContent
        lines.push(content)
        if (listDocuments && skillDocs && Object.keys(skillDocs).length > 0) {
          lines.push("\n**Available documents:**")
          for (const docPath of Object.keys(skillDocs)) {
            lines.push(`  - ${docPath}`)
          }
        }
        lines.push("")
      }

      return { content: [{ type: "text", text: lines.join("\n") }] }
    }

    // http_server.py:101-119 — read_skill_document handler
    if (name === "read_skill_document") {
      const skillName = args["skill_name"] as string
      const documentPath = args["document_path"] as string | undefined
      const includeBase64 = (args["include_base64"] as boolean | undefined) ?? false

      if (!searchEngine) {
        return { content: [{ type: "text", text: "[ERROR: Search engine not initialized]\n" }] }
      }

      // Search for the skill by exact name
      const allResults = searchEngine.search(skillName, 1)
      const skillResult = allResults.find((r) => r["name"] === skillName)

      if (!skillResult) {
        return { content: [{ type: "text", text: `Skill not found: ${skillName}` }] }
      }

      const skillDocs = skillResult["documents"] as Record<string, { type: string; content?: string; size?: number; url?: string }> | undefined

      if (!documentPath) {
        // List all documents
        const docList = skillDocs ? Object.keys(skillDocs) : []
        if (docList.length === 0) {
          return { content: [{ type: "text", text: `No documents available for skill: ${skillName}` }] }
        }
        return { content: [{ type: "text", text: `Documents for ${skillName}:\n${docList.map((d) => `  - ${d}`).join("\n")}` }] }
      }

      if (!skillDocs) {
        return { content: [{ type: "text", text: `No documents available for skill: ${skillName}` }] }
      }

      // Fetch specific document (supports prefix matching for glob-style paths)
      const matchingDocs = Object.keys(skillDocs).filter((p) =>
        documentPath.includes("*")
          ? p.startsWith(documentPath.replace(/\*.*$/, ""))
          : p === documentPath,
      )

      if (matchingDocs.length === 0) {
        return { content: [{ type: "text", text: `Document not found: ${documentPath} in skill ${skillName}` }] }
      }

      const parts: string[] = []
      for (const docPath of matchingDocs) {
        const doc = skillDocs[docPath]
        if (!doc) continue
        parts.push(`### ${docPath}`)
        if (doc.type === "text" && doc.content) {
          parts.push(doc.content)
        } else if (doc.type === "image") {
          if (includeBase64 && doc.content) {
            parts.push(`[base64 image, ${doc.size ?? 0} bytes]`)
          } else if (doc.url) {
            parts.push(`[image: ${doc.url}]`)
          } else {
            parts.push(`[image, ${doc.size ?? 0} bytes]`)
          }
        }
        parts.push("")
      }

      return { content: [{ type: "text", text: parts.join("\n") }] }
    }

    // http_server.py:121-135 — list_skills handler
    if (name === "list_skills") {
      const loadingMsg = loadingStateGlobal?.getStatusMessage()

      if (!searchEngine) {
        const msg = loadingMsg ?? "No skills loaded yet."
        return { content: [{ type: "text", text: msg }] }
      }

      // Use a broad search to get all skills
      const allResults = searchEngine.search("", 1000)

      if (allResults.length === 0) {
        const msg = loadingMsg ?? "No skills loaded yet."
        return { content: [{ type: "text", text: msg }] }
      }

      const lines: string[] = []
      if (loadingMsg) lines.push(loadingMsg)
      lines.push(`## Loaded Skills (${allResults.length} total)\n`)

      for (const result of allResults) {
        const skillName = result["name"] as string
        const skillDesc = result["description"] as string
        const skillSource = result["source"] as string
        const skillDocs = result["documents"] as Record<string, unknown> | undefined
        const docCount = skillDocs ? Object.keys(skillDocs).length : 0

        lines.push(`### ${skillName}`)
        lines.push(`**Description:** ${skillDesc}`)
        lines.push(`**Source:** ${skillSource}`)
        lines.push(`**Documents:** ${docCount}`)
        lines.push("")
      }

      return { content: [{ type: "text", text: lines.join("\n") }] }
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }] }
  })
}

// ---------------------------------------------------------------------------
// http_server.py:138-185 — health_check()
// ---------------------------------------------------------------------------

/**
 * Build the health check response object.
 * Python returns a Starlette JSONResponse; here we return a plain object
 * that the Hono route handler serialises with c.json().
 */
export function buildHealthResponse(): Record<string, unknown> {
  const response: Record<string, unknown> = {
    status: "ok",
    version: "1.0.6",
    skills_loaded: 0,
    models_loaded: false,
    loading_complete: loadingStateGlobal ? loadingStateGlobal.isComplete : false,
  }

  // http_server.py:154-157 — auto-update info
  if (configGlobal) {
    response["auto_update_enabled"] = configGlobal.auto_update_enabled
  }

  // http_server.py:159-166 — scheduler status
  if (schedulerGlobal) {
    const schedulerStatus = schedulerGlobal.getStatus()
    response["next_update_check"] = schedulerStatus["next_run_time"] ?? null
    response["last_update_check"] = schedulerStatus["last_run_time"] ?? null
  }

  // http_server.py:168-176 — GitHub API usage
  if (updateCheckerGlobal) {
    const apiUsage = updateCheckerGlobal.getApiUsage()
    response["github_api_calls_this_hour"] = apiUsage["calls_this_hour"] ?? 0
    response["github_api_limit"] = apiUsage["limit_per_hour"] ?? 60
    response["github_authenticated"] = apiUsage["authenticated"] ?? false
  }

  // http_server.py:178-183 — loading errors (last 5)
  if (loadingStateGlobal && loadingStateGlobal.errors.length > 0) {
    response["update_errors"] = loadingStateGlobal.errors.slice(-5)
  }

  return response
}

// ---------------------------------------------------------------------------
// http_server.py:188-319 — initialize_backend()
// ---------------------------------------------------------------------------

export interface InitBackendOptions {
  configPath?: string
  verbose?: boolean
}

/**
 * Load all skills from all configured sources (local + github).
 * Replaces Python's load_all_skills() / load_skills_in_batches() which are
 * not yet ported to TS — we use the available loadFromLocal() for local sources.
 */
function loadAllSkillsFromConfig(config: SkillsConfig): ReturnType<typeof loadFromLocal> {
  const allSkills: ReturnType<typeof loadFromLocal> = []
  for (const source of config.skill_sources) {
    if (source.type === "local" && source.path) {
      const skills = loadFromLocal(source.path, config)
      allSkills.push(...skills)
    }
    // GitHub sources: not yet ported; skip with a log
    if (source.type === "github") {
      logger.info({ url: source.url }, "GitHub skill source skipped (not yet ported to TS)")
    }
  }
  return allSkills
}

export async function initializeBackend(opts: InitBackendOptions = {}): Promise<Server> {
  const { configPath, verbose = false } = opts

  if (verbose) {
    logger.level = "debug"
  }

  logger.info("Initializing Claude Skills MCP Backend")

  // http_server.py:203-204 — load configuration
  const config = loadConfig(configPath)
  configGlobal = config

  // http_server.py:207-208 — initialize search engine
  logger.info("Initializing search engine...")
  searchEngine = new SkillSearchEngine(config.embedding_model)

  // http_server.py:211 — initialize loading state
  loadingStateGlobal = new LoadingState()

  // http_server.py:213-218 — initialize update checker
  const githubToken = config.github_api_token ?? null
  updateCheckerGlobal = new UpdateChecker(githubToken)
  logger.info(
    { tokenProvided: githubToken !== null },
    "Update checker initialized",
  )

  // http_server.py:220-224 — create MCP server and register tools
  const mcpServer = new Server(
    { name: "claude-skills-mcp-backend", version: "1.0.6" },
    { capabilities: { tools: {} } },
  )
  registerMcpTools(mcpServer, config.default_top_k, config.max_skill_content_chars)

  // http_server.py:232-251 — background loader (Promise instead of threading.Thread)
  const backgroundLoader = async (): Promise<void> => {
    try {
      logger.info("Starting background skill loading...")
      const skills = loadAllSkillsFromConfig(config)
      searchEngine!.addSkills(skills)
      loadingStateGlobal!.updateProgress(skills.length, skills.length)
      loadingStateGlobal!.markComplete()
      logger.info({ count: skills.length }, "Background skill loading complete")
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      logger.error({ err }, "Error in background loading")
      loadingStateGlobal!.addError(err.message)
      loadingStateGlobal!.markComplete()
    }
  }

  // Fire-and-forget (http_server.py:250-252)
  void backgroundLoader()
  logger.info("Background loading started, server is ready")

  // http_server.py:254-319 — auto-update scheduler
  if (config.auto_update_enabled) {
    const intervalMinutes = config.auto_update_interval_minutes

    // http_server.py:258-310 — update_callback
    const updateCallback = async (): Promise<void> => {
      try {
        logger.info("Running scheduled update check...")

        const result = await updateCheckerGlobal!.checkForUpdates(
          config.skill_sources as unknown as Record<string, unknown>[],
        )

        logger.info(
          { changedSources: result.changed_sources.length, apiCalls: result.api_calls_made },
          "Update check complete",
        )

        if (result.errors.length > 0) {
          for (const error of result.errors) {
            logger.warn({ error }, "Update check error")
            loadingStateGlobal!.addError(error)
          }
        }

        // http_server.py:279-293 — reload skills if updates detected
        if (result.has_updates) {
          logger.info({ count: result.changed_sources.length }, "Reloading changed sources...")
          logger.info("Reloading all skills...")
          const newSkills = loadAllSkillsFromConfig(config)
          searchEngine!.indexSkills(newSkills)
          logger.info({ count: newSkills.length }, "Re-indexed skills after update")
        } else {
          logger.info("No updates detected")
        }

        // http_server.py:297-305 — warn if approaching API limit
        const apiUsage = updateCheckerGlobal!.getApiUsage()
        if (
          !(apiUsage["authenticated"] as boolean) &&
          (apiUsage["calls_this_hour"] as number) >= 50
        ) {
          logger.warn(
            { calls: apiUsage["calls_this_hour"], limit: 60 },
            "Approaching GitHub API rate limit",
          )
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        const errorMsg = `Error during scheduled update: ${err.message}`
        logger.error({ err }, errorMsg)
        loadingStateGlobal!.addError(errorMsg)
      }
    }

    // http_server.py:312-317 — create and start scheduler
    schedulerGlobal = new HourlyScheduler(intervalMinutes, updateCallback)
    schedulerGlobal.start()
    logger.info({ intervalMinutes }, "Auto-update scheduler started")
  } else {
    logger.info("Auto-update disabled in configuration")
  }

  return mcpServer
}

// ---------------------------------------------------------------------------
// http_server.py:322-348 — run_server()
// ---------------------------------------------------------------------------

export interface RunServerOptions {
  host?: string
  port?: number
  configPath?: string
  verbose?: boolean
}

/**
 * Run the HTTP server.
 *
 * Python uses uvicorn + FastMCP streamable HTTP app; here we use
 * @modelcontextprotocol/sdk WebStandardStreamableHTTPServerTransport + Hono.
 */
export async function runServer(opts: RunServerOptions = {}): Promise<void> {
  const { host = "127.0.0.1", port = 8765, configPath, verbose = false } = opts

  // http_server.py:330 — initialize backend
  const mcpServer = await initializeBackend({ configPath, verbose })

  // http_server.py:333-338 — set up HTTP app with /health and /mcp routes
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  await mcpServer.connect(transport)

  const app = new Hono()

  // http_server.py:336 — health route (no auth)
  app.get("/health", (c) => c.json(buildHealthResponse()))

  // http_server.py:333 — MCP streamable HTTP route
  app.all("/mcp", async (c) => {
    const response = await transport.handleRequest(c.req.raw)
    return response
  })

  // http_server.py:341-348 — run server (uvicorn.Server → node:http)
  return new Promise((resolve, reject) => {
    const nodeServer = createServer(async (req, res) => {
      const url = `http://${req.headers.host ?? `${host}:${port}`}${req.url ?? "/"}`
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v)
        } else {
          headers.set(key, value)
        }
      }

      let body: BodyInit | null = null
      if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        body = Buffer.concat(chunks)
      }

      const webReq = new Request(url, {
        method: req.method ?? "GET",
        headers,
        body,
        // @ts-expect-error — duplex required for streaming bodies in Node.js fetch
        duplex: "half",
      })

      try {
        const webRes = await app.fetch(webReq)
        res.statusCode = webRes.status
        webRes.headers.forEach((value, key) => res.setHeader(key, value))
        if (webRes.body) {
          const reader = webRes.body.getReader()
          const pump = async (): Promise<void> => {
            const { done, value } = await reader.read()
            if (done) { res.end(); return }
            res.write(value)
            return pump()
          }
          await pump()
        } else {
          res.end()
        }
      } catch (err) {
        logger.error({ err }, "HTTP request handler error")
        res.statusCode = 500
        res.end(JSON.stringify({ error: "Internal server error" }))
      }
    })

    nodeServer.on("error", (err) => { logger.error({ err }, "HTTP server error"); reject(err) })
    nodeServer.listen(port, host, () => {
      logger.info({ host, port }, "Claude Skills MCP Backend listening")
      logger.info(`  Health: http://${host}:${port}/health`)
      logger.info(`  MCP:    http://${host}:${port}/mcp`)
    })
    nodeServer.on("close", () => resolve())
  })
}
