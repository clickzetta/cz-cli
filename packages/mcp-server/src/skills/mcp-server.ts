/**
 * MCP server implementation for Claude Skills search.
 *
 * Python → TS mapping:
 *   mcp_handlers.py:17-93   LoadingState         → LoadingState
 *   mcp_handlers.py:94-577  SkillsMCPServer      → SkillsMcpServer
 *   mcp_handlers.py:578-668 handle_search_skills → handleSearchSkills
 *   mcp_handlers.py:669-804 handle_read_skill_document → handleReadSkillDocument
 *   mcp_handlers.py:805-854 handle_list_skills   → handleListSkills
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { logger } from "../logger.js"
import type { SkillSearchEngine } from "./search.js"
import type { Skill } from "./loader.js"
// LoadingState is defined in http-server.ts (identical to mcp_handlers.py:17-93)
export { LoadingState } from "./http-server.js"
import type { LoadingState } from "./http-server.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** TextContent shape used by MCP tool responses. */
interface TextContent {
  type: "text"
  text: string
}

/**
 * Minimal fnmatch equivalent: convert a glob pattern to a RegExp and test.
 * Supports * (any chars) and ? (single char), same as Python fnmatch.fnmatch.
 * mcp_handlers.py:413 — fnmatch.fnmatch(doc_path, document_path)
 */
function fnmatch(name: string, pattern: string): boolean {
  // Escape regex special chars except * and ?
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  const regexStr = escaped.replace(/\*/g, ".*").replace(/\?/g, ".")
  return new RegExp(`^${regexStr}$`).test(name)
}

// ---------------------------------------------------------------------------
// mcp_handlers.py:94-577 — SkillsMCPServer → SkillsMcpServer
// ---------------------------------------------------------------------------

/**
 * MCP Server for searching Claude Agent Skills.
 * mcp_handlers.py:94-577
 */
export class SkillsMcpServer {
  // mcp_handlers.py:129-133
  readonly searchEngine: SkillSearchEngine
  readonly loadingState: LoadingState
  readonly defaultTopK: number
  readonly maxContentChars: number | null
  readonly server: Server

  // mcp_handlers.py:109-138 — __init__()
  constructor(
    searchEngine: SkillSearchEngine,
    loadingState: LoadingState,
    defaultTopK = 3,
    maxContentChars: number | null = null,
  ) {
    this.searchEngine = searchEngine
    this.loadingState = loadingState
    this.defaultTopK = defaultTopK
    this.maxContentChars = maxContentChars
    this.server = new Server(
      { name: "claude-skills-mcp", version: "0.1.0" },
      { capabilities: { tools: {} } },
    )

    // mcp_handlers.py:136
    this._registerHandlers()

    logger.info("MCP server initialized")
  }

  // mcp_handlers.py:140-245 — _register_handlers()
  private _registerHandlers(): void {
    // mcp_handlers.py:143-233 — @self.server.list_tools()
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "find_helpful_skills",
            title: "Find the most helpful skill for any task",
            description:
              "Always call this tool FIRST whenever the question requires any domain-specific knowledge " +
              "beyond common sense or simple recall. Use it at task start, regardless of the task and whether " +
              "you are sure about the task, It performs semantic search over a curated library of proven skills " +
              "and returns ranked candidates with step-by-step guidance and best practices. Do this before any " +
              "searches, coding, or any other actions as this will inform you about the best approach to take.",
            inputSchema: {
              type: "object",
              properties: {
                task_description: {
                  type: "string",
                  description:
                    "Description of the task you want to accomplish. Be specific about your goal, " +
                    "context, or problem domain for better results (e.g., 'debug Python API errors', " +
                    "'process genomic data', 'build React dashboard')",
                },
                top_k: {
                  type: "integer",
                  description: `Number of skills to return (default: ${this.defaultTopK}). Higher values provide more options but may include less relevant results.`,
                  default: this.defaultTopK,
                  minimum: 1,
                  maximum: 20,
                },
                list_documents: {
                  type: "boolean",
                  description:
                    "Include a list of available documents (scripts, references, assets) for each skill (default: True)",
                  default: true,
                },
              },
              required: ["task_description"],
            },
          },
          {
            name: "read_skill_document",
            title: "Open skill documents and assets",
            description:
              "Use after finding a relevant skill to retrieve specific documents (scripts, references, assets). " +
              "Supports pattern matching (e.g., 'scripts/*.py') to fetch multiple files. Returns text content or URLs " +
              "and never executes code. Prefer pulling only the files you need to complete the current step.",
            inputSchema: {
              type: "object",
              properties: {
                skill_name: {
                  type: "string",
                  description: "Name of the skill (as returned by find_helpful_skills)",
                },
                document_path: {
                  type: "string",
                  description:
                    "Path or pattern to match documents. Examples: 'scripts/example.py', " +
                    "'scripts/*.py', 'references/*', 'assets/diagram.png'. " +
                    "If not provided, returns a list of all available documents.",
                },
                include_base64: {
                  type: "boolean",
                  description:
                    "For images: if True, return base64-encoded content; if False, return only URL. " +
                    "Default: False (URL only for efficiency)",
                  default: false,
                },
              },
              required: ["skill_name"],
            },
          },
          {
            name: "list_skills",
            title: "List available skills",
            description:
              "Returns the full inventory of loaded skills (names, descriptions, sources, document counts) " +
              "for exploration or debugging. For task-driven work, prefer calling 'find_helpful_skills' first " +
              "to locate the most relevant option before reading documents.",
            inputSchema: {
              type: "object",
              properties: {},
              required: [],
            },
          },
        ],
      }
    })

    // mcp_handlers.py:235-245 — @self.server.call_tool()
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      const arguments_ = (args ?? {}) as Record<string, unknown>

      if (name === "find_helpful_skills") {
        return { content: await this._handleSearchSkills(arguments_) }
      } else if (name === "read_skill_document") {
        return { content: await this._handleReadSkillDocument(arguments_) }
      } else if (name === "list_skills") {
        return { content: await this._handleListSkills(arguments_) }
      } else {
        throw new Error(`Unknown tool: ${name}`)
      }
    })
  }

  // mcp_handlers.py:247-352 — _handle_search_skills()
  private async _handleSearchSkills(
    arguments_: Record<string, unknown>,
  ): Promise<TextContent[]> {
    return handleSearchSkills(
      arguments_,
      this.searchEngine,
      this.loadingState,
      this.defaultTopK,
      this.maxContentChars,
    )
  }

  // mcp_handlers.py:354-505 — _handle_read_skill_document()
  private async _handleReadSkillDocument(
    arguments_: Record<string, unknown>,
  ): Promise<TextContent[]> {
    return handleReadSkillDocument(arguments_, this.searchEngine)
  }

  // mcp_handlers.py:507-565 — _handle_list_skills()
  private async _handleListSkills(
    arguments_: Record<string, unknown>,
  ): Promise<TextContent[]> {
    return handleListSkills(arguments_, this.searchEngine, this.loadingState)
  }

  // mcp_handlers.py:567-574 — run()
  async run(): Promise<void> {
    logger.info("Starting MCP server with stdio transport")
    const { StdioServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/stdio.js"
    )
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
  }
}

// ---------------------------------------------------------------------------
// mcp_handlers.py:578-668 — handle_search_skills (standalone)
// ---------------------------------------------------------------------------

/**
 * Handle find_helpful_skills tool calls (standalone version for HTTP server).
 * mcp_handlers.py:578-668
 */
export async function handleSearchSkills(
  arguments_: Record<string, unknown>,
  searchEngine: SkillSearchEngine,
  loadingState: LoadingState | null,
  defaultTopK = 3,
  maxContentChars: number | null = null,
): Promise<TextContent[]> {
  // mcp_handlers.py:587-589
  const taskDescription = arguments_["task_description"] as string | undefined
  if (!taskDescription) {
    throw new Error("task_description is required")
  }

  // mcp_handlers.py:591-592
  const topK = (arguments_["top_k"] as number | undefined) ?? defaultTopK
  const listDocuments = (arguments_["list_documents"] as boolean | undefined) ?? true

  const responseParts: string[] = []

  // mcp_handlers.py:597-599 — add loading status
  const statusMsg = loadingState ? loadingState.getStatusMessage() : null
  if (statusMsg) {
    responseParts.push(statusMsg)
  }

  // mcp_handlers.py:602
  const results = searchEngine.search(taskDescription, topK)

  // mcp_handlers.py:604-622
  if (!results.length) {
    if (
      loadingState &&
      !loadingState.isComplete &&
      loadingState.loadedSkills === 0
    ) {
      return [
        {
          type: "text",
          text:
            (statusMsg ?? "") +
            "No skills loaded yet. Please wait for skills to load and try again.",
        },
      ]
    }
    return [
      {
        type: "text",
        text: "No relevant skills found for the given task description.",
      },
    ]
  }

  // mcp_handlers.py:624-626
  responseParts.push(
    `Found ${results.length} relevant skill(s) for: '${taskDescription}'\n`,
  )

  // mcp_handlers.py:628-664
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    responseParts.push(`\n${"=".repeat(80)}`)
    responseParts.push(`\nSkill ${i + 1}: ${result["name"] as string}`)
    responseParts.push(
      `\nRelevance Score: ${((result["relevance_score"] as number) ?? 0).toFixed(4)}`,
    )
    responseParts.push(`\nSource: ${result["source"] as string}`)
    responseParts.push(`\nDescription: ${result["description"] as string}`)

    const documents = (result["documents"] as Record<string, unknown> | undefined) ?? {}
    const docKeys = Object.keys(documents)
    if (docKeys.length > 0) {
      responseParts.push(`\nAdditional Documents: ${docKeys.length} file(s)`)

      if (listDocuments) {
        responseParts.push("\nAvailable Documents:")
        for (const docPath of [...docKeys].sort()) {
          const docInfo = documents[docPath] as Record<string, unknown>
          const docType = (docInfo["type"] as string | undefined) ?? "unknown"
          const docSize = (docInfo["size"] as number | undefined) ?? 0
          const sizeKb = docSize / 1024
          responseParts.push(`  - ${docPath} (${docType}, ${sizeKb.toFixed(1)} KB)`)
        }
      }
    }

    responseParts.push(`\n${"-".repeat(80)}`)
    responseParts.push("\nFull Content:\n")

    const content = result["content"] as string
    if (maxContentChars !== null && content.length > maxContentChars) {
      const truncated = content.slice(0, maxContentChars) + "..."
      responseParts.push(truncated)
      responseParts.push(
        `\n\n[Content truncated at ${maxContentChars} characters. ` +
          `View full skill at: ${result["source"] as string}]`,
      )
    } else {
      responseParts.push(content)
    }

    responseParts.push(`\n${"=".repeat(80)}\n`)
  }

  return [{ type: "text", text: responseParts.join("\n") }]
}

// ---------------------------------------------------------------------------
// mcp_handlers.py:669-804 — handle_read_skill_document (standalone)
// ---------------------------------------------------------------------------

/**
 * Handle read_skill_document tool calls (standalone version for HTTP server).
 * mcp_handlers.py:669-804
 */
export async function handleReadSkillDocument(
  arguments_: Record<string, unknown>,
  searchEngine: SkillSearchEngine,
): Promise<TextContent[]> {
  // mcp_handlers.py:675-677
  const skillName = arguments_["skill_name"] as string | undefined
  if (!skillName) {
    throw new Error("skill_name is required")
  }

  // mcp_handlers.py:679-680
  const documentPath = arguments_["document_path"] as string | undefined
  const includeBase64 = (arguments_["include_base64"] as boolean | undefined) ?? false

  // mcp_handlers.py:683-688 — find skill by name
  let skill: Skill | null = null
  for (const s of searchEngine.skills) {
    if (s.name === skillName) {
      skill = s
      break
    }
  }

  // mcp_handlers.py:689-695
  if (!skill) {
    return [
      {
        type: "text",
        text: `Skill '${skillName}' not found. Please use find_helpful_skills to find valid skill names.`,
      },
    ]
  }

  // mcp_handlers.py:697-714 — no document_path: list all documents
  if (!documentPath) {
    if (!skill.documents || Object.keys(skill.documents).length === 0) {
      return [
        {
          type: "text",
          text: `Skill '${skillName}' has no additional documents.`,
        },
      ]
    }

    const responseParts = [`Available documents for skill '${skillName}':\n`]
    for (const [docPath, docInfo] of Object.entries(skill.documents).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      const docType = (docInfo["type"] as string | undefined) ?? "unknown"
      const docSize = (docInfo["size"] as number | undefined) ?? 0
      const sizeKb = docSize / 1024
      responseParts.push(`  - ${docPath} (${docType}, ${sizeKb.toFixed(1)} KB)`)
    }

    return [{ type: "text", text: responseParts.join("\n") }]
  }

  // mcp_handlers.py:716-728 — match documents by pattern
  const matchingDocs: Record<string, Record<string, unknown>> = {}
  for (const [docPath, docInfo] of Object.entries(skill.documents)) {
    if (fnmatch(docPath, documentPath) || docPath === documentPath) {
      matchingDocs[docPath] = docInfo as unknown as Record<string, unknown>
    }
  }

  if (Object.keys(matchingDocs).length === 0) {
    return [
      {
        type: "text",
        text: `No documents matching '${documentPath}' found in skill '${skillName}'.`,
      },
    ]
  }

  // mcp_handlers.py:730-736 — lazy fetch
  for (const docPath of Object.keys(matchingDocs)) {
    const docInfo = matchingDocs[docPath]!
    if (!docInfo["fetched"] && !("content" in docInfo)) {
      const fetched = skill.getDocument(docPath)
      if (fetched) {
        matchingDocs[docPath] = fetched as unknown as Record<string, unknown>
      }
    }
  }

  // mcp_handlers.py:738-801 — format response
  const responseParts: string[] = []
  const matchingEntries = Object.entries(matchingDocs)

  if (matchingEntries.length === 1) {
    // mcp_handlers.py:741-768 — single document
    const [docPath, docInfo] = matchingEntries[0]!
    const docType = docInfo["type"] as string | undefined

    if (docType === "text") {
      responseParts.push(`Document: ${docPath}\n`)
      responseParts.push("=".repeat(80))
      responseParts.push(`\n${(docInfo["content"] as string | undefined) ?? ""}`)
    } else if (docType === "image") {
      responseParts.push(`Image: ${docPath}\n`)
      if (docInfo["size_exceeded"]) {
        responseParts.push(
          `Size: ${(((docInfo["size"] as number | undefined) ?? 0) / 1024).toFixed(1)} KB (exceeds limit)`,
        )
        responseParts.push(`\nURL: ${(docInfo["url"] as string | undefined) ?? "N/A"}`)
      } else if (includeBase64) {
        responseParts.push(
          `Base64 Content:\n${(docInfo["content"] as string | undefined) ?? ""}`,
        )
        if ("url" in docInfo) {
          responseParts.push(
            `\n\nAlternatively, access via URL: ${docInfo["url"] as string}`,
          )
        }
      } else {
        responseParts.push(`URL: ${(docInfo["url"] as string | undefined) ?? "N/A"}`)
        if ("content" in docInfo) {
          responseParts.push("\n(Set include_base64=true to get base64-encoded content)")
        }
      }
    }
  } else {
    // mcp_handlers.py:770-801 — multiple documents
    responseParts.push(
      `Found ${matchingEntries.length} documents matching '${documentPath}':\n`,
    )

    for (const [docPath, docInfo] of [...matchingEntries].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const docType = docInfo["type"] as string | undefined
      responseParts.push(`\n${"=".repeat(80)}`)
      responseParts.push(`\nDocument: ${docPath}`)
      responseParts.push(`\nType: ${docType ?? "unknown"}`)
      responseParts.push(
        `\nSize: ${(((docInfo["size"] as number | undefined) ?? 0) / 1024).toFixed(1)} KB`,
      )

      if (docType === "text") {
        responseParts.push("\nContent:")
        responseParts.push("-".repeat(80))
        responseParts.push(`\n${(docInfo["content"] as string | undefined) ?? ""}`)
      } else if (docType === "image") {
        if (docInfo["size_exceeded"]) {
          responseParts.push("\n(Size exceeds limit)")
          responseParts.push(`\nURL: ${(docInfo["url"] as string | undefined) ?? "N/A"}`)
        } else if (includeBase64) {
          responseParts.push(
            `\nBase64 Content: ${(docInfo["content"] as string | undefined) ?? ""}`,
          )
          if ("url" in docInfo) {
            responseParts.push(`\nURL: ${docInfo["url"] as string}`)
          }
        } else {
          responseParts.push(`\nURL: ${(docInfo["url"] as string | undefined) ?? "N/A"}`)
        }
      }

      responseParts.push(`\n${"=".repeat(80)}`)
    }
  }

  return [{ type: "text", text: responseParts.join("\n") }]
}

// ---------------------------------------------------------------------------
// mcp_handlers.py:805-854 — handle_list_skills (standalone)
// ---------------------------------------------------------------------------

/**
 * Handle list_skills tool calls (standalone version for HTTP server).
 * mcp_handlers.py:805-854
 */
export async function handleListSkills(
  _arguments: Record<string, unknown>,
  searchEngine: SkillSearchEngine,
  loadingState: LoadingState | null,
): Promise<TextContent[]> {
  const responseParts: string[] = []

  // mcp_handlers.py:814-816 — add loading status
  const statusMsg = loadingState ? loadingState.getStatusMessage() : null
  if (statusMsg) {
    responseParts.push(statusMsg)
  }

  // mcp_handlers.py:818-827
  const skills = searchEngine.skills
  if (!skills.length) {
    if (loadingState && !loadingState.isComplete) {
      return [
        {
          type: "text",
          text:
            (statusMsg ?? "") +
            "No skills loaded yet. Please wait for skills to load.",
        },
      ]
    }
    return [{ type: "text", text: "No skills currently loaded." }]
  }

  // mcp_handlers.py:829-835
  responseParts.push(`Total skills loaded: ${skills.length}\n`)
  responseParts.push("=".repeat(80))
  responseParts.push("\n")

  // mcp_handlers.py:837-852
  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i]!
    // mcp_handlers.py:839-844 — format source as owner/repo for GitHub URLs
    let source = skill.source
    if (source.includes("github.com")) {
      const match = source.match(/github\.com\/([^/]+\/[^/]+)/)
      if (match) {
        source = match[1]!
      }
    }

    const docCount = Object.keys(skill.documents).length

    responseParts.push(`${i + 1}. ${skill.name}`)
    responseParts.push(`   Description: ${skill.description}`)
    responseParts.push(`   Source: ${source}`)
    responseParts.push(`   Documents: ${docCount} file(s)`)
    responseParts.push("")
  }

  return [{ type: "text", text: responseParts.join("\n") }]
}

