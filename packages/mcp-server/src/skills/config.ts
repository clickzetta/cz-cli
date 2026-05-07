/**
 * Configuration management for Skills MCP server.
 *
 * Python → TS mapping:
 *   config.py:10-46   DEFAULT_CONFIG constant  → DEFAULT_CONFIG
 *   config.py:49-85   load_config()            → loadConfig()
 *   config.py:88-141  get_example_config()     → getExampleConfig()
 */

import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { logger } from "../logger.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillSource {
  type: "github" | "local"
  url?: string
  path?: string
  subpath?: string
}

export interface SkillsConfig {
  skill_sources: SkillSource[]
  embedding_model: string
  default_top_k: number
  max_skill_content_chars: number | null
  load_skill_documents: boolean
  max_image_size_bytes: number
  allowed_image_extensions: string[]
  text_file_extensions: string[]
  auto_update_enabled: boolean
  auto_update_interval_minutes: number
  github_api_token: string | null
}

// ---------------------------------------------------------------------------
// config.py:10-46 — DEFAULT_CONFIG
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: SkillsConfig = {
  skill_sources: [
    {
      type: "github",
      url: "https://github.com/anthropics/skills",
    },
    {
      type: "github",
      url: "https://github.com/K-Dense-AI/claude-scientific-skills",
    },
    {
      type: "local",
      path: "~/.claude/skills",
    },
  ],
  embedding_model: "all-MiniLM-L6-v2",
  default_top_k: 3,
  max_skill_content_chars: null,
  load_skill_documents: true,
  max_image_size_bytes: 5242880, // 5MB
  allowed_image_extensions: [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"],
  text_file_extensions: [
    ".md",
    ".py",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".sh",
    ".r",
    ".ipynb",
    ".xml",
  ],
  auto_update_enabled: true,
  auto_update_interval_minutes: 60,
  github_api_token: null,
}

// ---------------------------------------------------------------------------
// config.py:49-85 — load_config()
// ---------------------------------------------------------------------------

export function loadConfig(configPath?: string): SkillsConfig {
  if (!configPath) {
    logger.info("No config file specified, using default configuration")
    return { ...DEFAULT_CONFIG }
  }

  try {
    const configFile = resolve(configPath.replace(/^~/, process.env.HOME ?? "~"))

    if (!existsSync(configFile)) {
      logger.warn({ configPath }, "Config file not found, using defaults")
      return { ...DEFAULT_CONFIG }
    }

    const raw = readFileSync(configFile, "utf-8")
    const config = JSON.parse(raw) as Partial<SkillsConfig>

    // Merge with defaults for any missing keys (config.py:76-78)
    const merged: SkillsConfig = { ...DEFAULT_CONFIG, ...config }

    logger.info({ configPath }, "Loaded configuration from file")
    return merged
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err, configPath }, "Error loading config, falling back to defaults")
    return { ...DEFAULT_CONFIG }
  }
}

// ---------------------------------------------------------------------------
// config.py:88-141 — get_example_config()
// ---------------------------------------------------------------------------

export function getExampleConfig(): string {
  const configWithComments = {
    skill_sources: [
      {
        type: "github",
        url: "https://github.com/anthropics/skills",
        comment:
          "Official Anthropic skills - diverse examples with Python scripts, images, documents",
      },
      {
        type: "github",
        url: "https://github.com/K-Dense-AI/claude-scientific-skills",
        comment: "70+ scientific skills for bioinformatics, cheminformatics, and analysis",
      },
      {
        type: "local",
        path: "~/.claude/skills",
        comment: "Your custom local skills (optional - directory doesn't need to exist)",
      },
    ],
    embedding_model: "all-MiniLM-L6-v2",
    default_top_k: 3,
    max_skill_content_chars: null,
    comment_max_chars:
      "Set to an integer (e.g., 5000) to truncate skill content, or null for unlimited",
    load_skill_documents: true,
    max_image_size_bytes: 5242880,
    allowed_image_extensions: [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"],
    text_file_extensions: [
      ".md",
      ".py",
      ".txt",
      ".json",
      ".yaml",
      ".yml",
      ".sh",
      ".r",
      ".ipynb",
      ".xml",
    ],
    auto_update_enabled: true,
    comment_auto_update: "Enable automatic hourly skill updates (checks at :00 of each hour)",
    auto_update_interval_minutes: 60,
    comment_interval: "Check for updates every N minutes (synced to clockface hours)",
    github_api_token: null,
    comment_token:
      "Optional GitHub personal access token for 5000 req/hr (default: 60 req/hr)",
  }
  return JSON.stringify(configWithComments, null, 2)
}
