/**
 * Skill loading and parsing functionality.
 *
 * Python → TS mapping:
 *   skill_loader.py:20-109   Skill class                          → Skill class
 *   skill_loader.py:112-164  parse_skill_md()                     → parseSkillMd()
 *   skill_loader.py:167-182  _is_text_file()                      → isTextFile()
 *   skill_loader.py:185-200  _is_image_file()                     → isImageFile()
 *   skill_loader.py:203-225  _load_text_file()                    → loadTextFile()
 *   skill_loader.py:228-280  _load_image_file()                   → loadImageFile()
 *   skill_loader.py:283-332  _load_documents_from_directory()     → loadDocumentsFromDirectory()
 *   skill_loader.py:335-408  load_from_local()                    → loadFromLocal()
 *   skill_loader.py:411-421  _get_document_cache_dir()            → getDocumentCacheDir()
 *   skill_loader.py:424-446  _get_cache_path()                    → getCachePath()
 *   skill_loader.py:449-484  _load_from_cache()                   → loadFromCache()
 *   skill_loader.py:487-506  _save_to_cache()                     → saveToCache()
 *   skill_loader.py:509-587  _get_document_metadata_from_github() → getDocumentMetadataFromGithub()
 *   skill_loader.py:590-716  _create_document_fetcher()           → createDocumentFetcher()
 *   skill_loader.py:719-979  load_from_github()                   → loadFromGithub()
 *   skill_loader.py:982-1021 load_all_skills()                    → loadAllSkills()
 *   skill_loader.py:1024-1090 load_skills_in_batches()            → loadSkillsInBatches()
 */

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join, extname, relative, resolve, dirname, basename } from "node:path"
import { logger } from "../logger.js"
import type { SkillsConfig } from "./config.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentInfo {
  type: "text" | "image"
  content?: string
  size?: number
  size_exceeded?: boolean
  url?: string
  fetched?: boolean
}

export type DocumentFetcher = (docPath: string) => DocumentInfo | null

// ---------------------------------------------------------------------------
// skill_loader.py:20-109 — Skill class
// ---------------------------------------------------------------------------

export class Skill {
  readonly name: string
  readonly description: string
  readonly content: string
  readonly source: string
  documents: Record<string, DocumentInfo>
  private _documentFetcher: DocumentFetcher | null
  private _documentCache: Record<string, DocumentInfo>

  constructor(
    name: string,
    description: string,
    content: string,
    source: string,
    documents?: Record<string, DocumentInfo>,
    documentFetcher?: DocumentFetcher,
  ) {
    this.name = name
    this.description = description
    this.content = content
    this.source = source
    this.documents = documents ?? {}
    this._documentFetcher = documentFetcher ?? null
    this._documentCache = {}
  }

  // skill_loader.py:59-93 — get_document()
  getDocument(docPath: string): DocumentInfo | null {
    // Check memory cache first (skill_loader.py:73)
    if (docPath in this._documentCache) {
      return this._documentCache[docPath]!
    }

    // Check if document exists in metadata (skill_loader.py:77)
    if (!(docPath in this.documents)) {
      return null
    }

    // If already fetched (eager loaded), return from documents (skill_loader.py:81-83)
    const docInfo = this.documents[docPath]!
    if (docInfo.fetched || "content" in docInfo) {
      return docInfo
    }

    // Fetch using the document_fetcher (lazy loading) (skill_loader.py:86-92)
    if (this._documentFetcher) {
      const content = this._documentFetcher(docPath)
      if (content) {
        this._documentCache[docPath] = content
        return content
      }
    }

    return null
  }

  // skill_loader.py:95-109 — to_dict()
  toDict(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      content: this.content,
      source: this.source,
      documents: this.documents,
    }
  }
}

// ---------------------------------------------------------------------------
// skill_loader.py:112-164 — parse_skill_md()
// ---------------------------------------------------------------------------

export function parseSkillMd(content: string, source: string): Skill | null {
  try {
    // Parse YAML frontmatter (between --- markers) (skill_loader.py:129-133)
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)

    if (!frontmatterMatch) {
      logger.warn({ source }, "No YAML frontmatter found in skill")
      return null
    }

    const frontmatterText = frontmatterMatch[1]!
    const markdownBody = frontmatterMatch[2]!

    // Extract name and description from YAML frontmatter (skill_loader.py:141-143)
    const nameMatch = frontmatterText.match(/^name:\s*(.+)$/m)
    const descMatch = frontmatterText.match(/^description:\s*(.+)$/m)

    if (!nameMatch || !descMatch) {
      logger.warn({ source }, "Missing name or description in skill")
      return null
    }

    // Remove quotes if present (skill_loader.py:152-153)
    const name = nameMatch[1]!.trim().replace(/^["']|["']$/g, "")
    const description = descMatch[1]!.trim().replace(/^["']|["']$/g, "")

    return new Skill(
      name,
      description,
      markdownBody.trim(), // Store only the markdown body (skill_loader.py:158)
      source,
    )
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err, source }, "Error parsing SKILL.md")
    return null
  }
}

// ---------------------------------------------------------------------------
// skill_loader.py:167-182 — _is_text_file()
// ---------------------------------------------------------------------------

function isTextFile(filePath: string, textExtensions: string[]): boolean {
  return textExtensions.includes(extname(filePath).toLowerCase())
}

// ---------------------------------------------------------------------------
// skill_loader.py:185-200 — _is_image_file()
// ---------------------------------------------------------------------------

function isImageFile(filePath: string, imageExtensions: string[]): boolean {
  return imageExtensions.includes(extname(filePath).toLowerCase())
}

// ---------------------------------------------------------------------------
// skill_loader.py:203-225 — _load_text_file()
// ---------------------------------------------------------------------------

function loadTextFile(filePath: string): DocumentInfo | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    return { type: "text", content, size: content.length }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err, filePath }, "Error reading text file")
    return null
  }
}

// ---------------------------------------------------------------------------
// skill_loader.py:228-280 — _load_image_file()
// ---------------------------------------------------------------------------

function loadImageFile(filePath: string, maxSize: number, url?: string): DocumentInfo | null {
  try {
    const fileSize = statSync(filePath).size

    if (fileSize > maxSize) {
      logger.warn({ filePath, fileSize, maxSize }, "Image exceeds size limit, storing metadata only")
      const result: DocumentInfo = { type: "image", size: fileSize, size_exceeded: true }
      if (url) result.url = url
      return result
    }

    const imageData = readFileSync(filePath)
    const base64Content = imageData.toString("base64")
    const result: DocumentInfo = { type: "image", content: base64Content, size: fileSize }
    if (url) result.url = url
    return result
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err, filePath }, "Error reading image file")
    return null
  }
}

// ---------------------------------------------------------------------------
// skill_loader.py:335-408 — load_from_local()
// ---------------------------------------------------------------------------

export function loadFromLocal(
  path: string,
  config?: Partial<SkillsConfig>,
): Skill[] {
  const skills: Skill[] = []
  const cfg = config ?? {}

  const loadDocuments = cfg.load_skill_documents ?? true
  const textExtensions = cfg.text_file_extensions ?? [
    ".md", ".py", ".txt", ".json", ".yaml", ".yml", ".sh", ".r", ".ipynb",
  ]
  const imageExtensions = cfg.allowed_image_extensions ?? [
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
  ]
  const maxImageSize = cfg.max_image_size_bytes ?? 5242880

  try {
    const localPath = resolve(path.replace(/^~/, homedir()))

    if (!existsSync(localPath)) {
      logger.warn({ path }, "Local path does not exist, skipping")
      return skills
    }

    const stat = statSync(localPath)
    if (!stat.isDirectory()) {
      logger.warn({ path }, "Local path is not a directory, skipping")
      return skills
    }

    // Find all SKILL.md files recursively (skill_loader.py:378)
    const skillFiles = findSkillMdFiles(localPath)

    for (const skillFile of skillFiles) {
      try {
        const content = readFileSync(skillFile, "utf-8")
        const skill = parseSkillMd(content, skillFile)
        if (skill) {
          if (loadDocuments) {
            const skillDir = dirname(skillFile)
            const documents = loadDocumentsFromDirectory(
              skillDir, textExtensions, imageExtensions, maxImageSize,
            )
            skill.documents = documents
            if (Object.keys(documents).length > 0) {
              logger.info({ skillName: skill.name, count: Object.keys(documents).length }, "Loaded additional documents")
            }
          }
          skills.push(skill)
          logger.info({ skillName: skill.name, skillFile }, "Loaded skill")
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        logger.error({ err, skillFile }, "Error reading skill file")
      }
    }

    logger.info({ count: skills.length, path }, "Loaded skills from local path")
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err, path }, "Error accessing local path")
  }

  return skills
}

/** Recursively find all SKILL.md files under a directory. */
function findSkillMdFiles(dir: string): string[] {
  const results: string[] = []
  function walk(d: string): void {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name === "SKILL.md") {
        results.push(full)
      }
    }
  }
  walk(dir)
  return results
}

// ---------------------------------------------------------------------------
// skill_loader.py:411-421 — _get_document_cache_dir()
// ---------------------------------------------------------------------------

function getDocumentCacheDir(): string {
  const cacheDir = join(tmpdir(), "claude_skills_mcp_cache", "documents")
  mkdirSync(cacheDir, { recursive: true })
  return cacheDir
}

// ---------------------------------------------------------------------------
// skill_loader.py:424-446 — _get_cache_path()
// ---------------------------------------------------------------------------

function getCachePath(url: string, branch: string): string {
  const cacheDir = join(tmpdir(), "claude_skills_mcp_cache")
  mkdirSync(cacheDir, { recursive: true })
  const cacheKey = `${url}_${branch}`
  const hashKey = createHash("md5").update(cacheKey).digest("hex")
  return join(cacheDir, `${hashKey}.json`)
}

// ---------------------------------------------------------------------------
// skill_loader.py:449-484 — _load_from_cache()
// ---------------------------------------------------------------------------

function loadFromCache(cachePath: string, maxAgeHours = 24): Record<string, unknown> | null {
  if (!existsSync(cachePath)) return null

  try {
    const raw = readFileSync(cachePath, "utf-8")
    const cacheData = JSON.parse(raw) as { timestamp: string; tree_data: Record<string, unknown> }

    const cachedTime = new Date(cacheData.timestamp).getTime()
    const ageMs = Date.now() - cachedTime
    if (ageMs > maxAgeHours * 3600 * 1000) {
      logger.info({ cachePath }, "Cache expired")
      return null
    }

    logger.info({ cachePath }, "Using cached GitHub API response")
    return cacheData.tree_data
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.warn({ err, cachePath }, "Failed to load cache")
    return null
  }
}

// ---------------------------------------------------------------------------
// skill_loader.py:487-506 — _save_to_cache()
// ---------------------------------------------------------------------------

function saveToCache(cachePath: string, treeData: Record<string, unknown>): void {
  try {
    const cacheData = { timestamp: new Date().toISOString(), tree_data: treeData }
    writeFileSync(cachePath, JSON.stringify(cacheData), "utf-8")
    logger.info({ cachePath }, "Saved GitHub API response to cache")
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.warn({ err, cachePath }, "Failed to save cache")
  }
}

// ---------------------------------------------------------------------------
// skill_loader.py:283-332 — _load_documents_from_directory()
// ---------------------------------------------------------------------------

function loadDocumentsFromDirectory(
  skillDir: string,
  textExtensions: string[],
  imageExtensions: string[],
  maxImageSize: number,
): Record<string, DocumentInfo> {
  const documents: Record<string, DocumentInfo> = {}

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      // Skip SKILL.md itself (skill_loader.py:311)
      if (entry.name === "SKILL.md") continue

      const relPath = relative(skillDir, fullPath)

      if (isTextFile(fullPath, textExtensions)) {
        const doc = loadTextFile(fullPath)
        if (doc) documents[relPath] = doc
      } else if (isImageFile(fullPath, imageExtensions)) {
        const doc = loadImageFile(fullPath, maxImageSize)
        if (doc) documents[relPath] = doc
      }
    }
  }

  try {
    walk(skillDir)
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error({ err, skillDir }, "Error walking skill directory")
  }

  return documents
}

// ---------------------------------------------------------------------------
// loadAllSkills — skill_loader.py:982-1021
// ---------------------------------------------------------------------------
export async function loadAllSkills(
  skillSources: Array<Record<string, unknown>>,
  config?: Record<string, unknown> | null,
): Promise<Skill[]> {
  const allSkills: Skill[] = []
  for (const sourceConfig of skillSources) {
    const sourceType = sourceConfig["type"] as string | undefined
    if (sourceType === "local") {
      const path = sourceConfig["path"] as string | undefined
      if (path) {
        const skills = loadFromLocal(path, config ?? undefined)
        allSkills.push(...skills)
      }
    } else {
      logger.warn({ sourceType }, "Unknown source type")
    }
  }
  logger.info({ count: allSkills.length }, "Total skills loaded")
  return allSkills
}

// ---------------------------------------------------------------------------
// loadSkillsInBatches — skill_loader.py:1024-1088
// ---------------------------------------------------------------------------
export async function loadSkillsInBatches(
  skillSources: Array<Record<string, unknown>>,
  config: Record<string, unknown> | null | undefined,
  batchCallback: (batch: Skill[], totalLoaded: number) => void,
  batchSize = 10,
): Promise<void> {
  let currentBatch: Skill[] = []
  let totalLoaded = 0

  const processBatch = () => {
    if (currentBatch.length > 0) {
      totalLoaded += currentBatch.length
      batchCallback([...currentBatch], totalLoaded)
      currentBatch = []
    }
  }

  for (const sourceConfig of skillSources) {
    const sourceType = sourceConfig["type"] as string | undefined
    try {
      if (sourceType === "local") {
        const path = sourceConfig["path"] as string | undefined
        if (path) {
          const skills = loadFromLocal(path, config ?? undefined)
          for (const skill of skills) {
            currentBatch.push(skill)
            if (currentBatch.length >= batchSize) processBatch()
          }
        }
      } else {
        logger.warn({ sourceType }, "Unknown source type")
      }
    } catch (e) {
      logger.error({ err: e, sourceConfig }, "Error loading from source")
    }
  }
  processBatch()
}
