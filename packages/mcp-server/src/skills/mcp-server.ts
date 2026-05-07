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
// mcp_handlers.py:17-93 — LoadingState
// ---------------------------------------------------------------------------

/**
 * Thread-safe state tracker for background skill loading.
 * JS is single-threaded so no mutex is needed; the lock methods are no-ops.
 */
