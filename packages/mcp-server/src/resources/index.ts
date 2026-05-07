/**
 * MCP Resources registration
 *
 * Python → TS mapping:
 *   mcp_registrar.py:232-254  register_resources_to_server  → registerResources()
 *   mcp_registrar.py:704-775  _get_resources_list_for_server → list_resources handler
 *   mcp_registrar.py:777-818  _read_resource_for_server      → read_resource handler
 *
 * Resources exposed:
 *   memo://insights                — Data Insights Memo (text/plain)
 *   schema://get_available_regions — Clickzetta region list (application/json)
 *   file://<path>                  — Markdown doc resources (text/markdown)
 */

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { getAvailableRegions } from "../config/region.js"
import { logger } from "../logger.js"

// mcp_registrar.py:306-313 — Chinese display names for markdown files
const MARKDOWN_CHINESE_NAMES: string[] = [
  "Lakehouse架构实体关系详细描述",
  "Lakehouse UI 组件样式规范（中文）",
  "Lakehouse UI 数据流程图规范（中文）",
  "Lakehouse样式指南（中文）",
  "快速体验Lakehouse",
]

/**
 * Resolve the markdown resource directory.
 * mcp_registrar.py:306 — os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "resource", "markdown"))
 */
function getMarkdownDir(): string {
  // __dirname equivalent for ESM
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  return resolve(__dirname, "..", "resource", "markdown")
}

interface MarkdownFileInfo {
  filename: string
  filePath: string
  chineseName: string
  description: string
}

/**
 * mcp_registrar.py:294-342 — _get_cached_markdown_files (no caching in TS; simple scan)
 */
function getMarkdownFiles(): MarkdownFileInfo[] {
  const markdownDir = getMarkdownDir()
  if (!existsSync(markdownDir)) {
    logger.warn({ markdownDir }, "Markdown directory does not exist")
    return []
  }
  try {
    const mdFiles = readdirSync(markdownDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
    return mdFiles.map((filename, idx) => {
      const filePath = join(markdownDir, filename)
      const chineseName =
        idx < MARKDOWN_CHINESE_NAMES.length ? MARKDOWN_CHINESE_NAMES[idx] : filename
      return {
        filename,
        filePath,
        chineseName,
        description: `Markdown 文档: ${chineseName}`,
      }
    })
  } catch (e) {
    logger.error({ err: e }, "Failed to read markdown directory")
    return []
  }
}

/**
 * registerResources — mirrors mcp_registrar.py:232-254 register_resources_to_server
 *
 * Registers list_resources and read_resource handlers on the MCP Server.
 */
export function registerResources(server: Server): void {
  // mcp_registrar.py:240-243 — @server.list_resources()
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    // mcp_registrar.py:704-775 — _get_resources_list_for_server
    const resources: Array<{
      uri: string
      name: string
      description: string
      mimeType: string
    }> = []

    // mcp_registrar.py:709-715 — memo://insights
    resources.push({
      uri: "memo://insights",
      name: "Data Insights Memo",
      description: "A living document of discovered data insights",
      mimeType: "text/plain",
    })

    // mcp_registrar.py:716-722 — schema://get_available_regions
    resources.push({
      uri: "schema://get_available_regions",
      name: "Clickzetta region list",
      description: "Available region list in Clickzetta Studio with their region_id and url",
      mimeType: "application/json",
    })

    // mcp_registrar.py:724-756 — markdown file resources
    const mdFiles = getMarkdownFiles()
    for (const info of mdFiles) {
      resources.push({
        uri: `file://${info.filePath}`,
        name: info.chineseName,
        description: info.description,
        mimeType: "text/markdown",
      })
    }

    logger.info({ count: resources.length }, "Returning resources list")
    return { resources }
  })

  // mcp_registrar.py:245-248 — @server.read_resource()
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    // mcp_registrar.py:777-818 — _read_resource_for_server
    const uriStr = String(request.params.uri)

    try {
      if (uriStr === "memo://insights") {
        // mcp_registrar.py:784-789 — return memo content
        // No DB connection in this standalone implementation; return placeholder
        return {
          contents: [
            {
              uri: uriStr,
              mimeType: "text/plain",
              text: "暂无数据洞察。",
            },
          ],
        }
      }

      if (uriStr === "schema://get_available_regions") {
        // mcp_registrar.py:792-795 — return regions as JSON
        const regions = getAvailableRegions()
        return {
          contents: [
            {
              uri: uriStr,
              mimeType: "application/json",
              text: JSON.stringify(regions, null, 2),
            },
          ],
        }
      }

      if (uriStr.startsWith("file://")) {
        // mcp_registrar.py:805-811 — read file
        const filePath = uriStr.slice(7) // strip "file://"
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`)
        }
        const content = readFileSync(filePath, "utf-8")
        return {
          contents: [
            {
              uri: uriStr,
              mimeType: "text/markdown",
              text: content,
            },
          ],
        }
      }

      // mcp_registrar.py:813-814 — unknown resource
      throw new Error(`Unknown resource: ${uriStr}`)
    } catch (e) {
      logger.error({ err: e, uri: uriStr }, "Failed to read resource")
      throw e
    }
  })

  logger.info("Resources registered")
}
