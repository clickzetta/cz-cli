/**
 * file-path.ts — port of cz_mcp/common/file_path_utils.py
 *
 * Python → TS mapping:
 *   file_path_utils.py:13-26   FilePathManager class constants → module constants
 *   file_path_utils.py:28-31   get_upload_directories()        → getUploadDirectories()
 *   file_path_utils.py:33-36   get_download_directories()      → getDownloadDirectories()
 *   file_path_utils.py:38-57   find_upload_file()              → findUploadFile()
 *   file_path_utils.py:59-82   get_default_download_path()     → getDefaultDownloadPath()
 *   file_path_utils.py:84-100  ensure_upload_directories()     → ensureUploadDirectories()
 *   file_path_utils.py:102-117 ensure_download_directories()   → ensureDownloadDirectories()
 *   file_path_utils.py:119-152 get_search_summary()            → getSearchSummary()
 *   file_path_utils.py:155-175 get_enhanced_file_path()        → getEnhancedFilePath()
 *   file_path_utils.py:177-218 get_enhanced_download_path()    → getEnhancedDownloadPath()
 *
 * Divergences:
 *   - Python uses os.path.expanduser; TS uses homedir() from node:os.
 *   - Python's class-based FilePathManager is flattened to module-level functions.
 *   - Python's os.access(W_OK) check is approximated via try/catch on mkdirSync.
 */

import { accessSync, constants, existsSync, mkdirSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// file_path_utils.py:17-20 — DEFAULT_UPLOAD_DIRS
const DEFAULT_UPLOAD_DIRS = [
  "/app/.clickzetta/data/uploads",
  `${homedir()}/.clickzetta/data/uploads`,
]

// file_path_utils.py:22-25 — DEFAULT_DOWNLOAD_DIRS
const DEFAULT_DOWNLOAD_DIRS = [
  "/app/.clickzetta/data/downloads",
  `${homedir()}/.clickzetta/data/downloads`,
]

// file_path_utils.py:28-31
export function getUploadDirectories(): string[] {
  return DEFAULT_UPLOAD_DIRS.slice()
}

// file_path_utils.py:33-36
export function getDownloadDirectories(): string[] {
  return DEFAULT_DOWNLOAD_DIRS.slice()
}

// file_path_utils.py:38-57
export function findUploadFile(filename: string): string | null {
  // If already absolute or exists in cwd, return directly
  if (filename.startsWith("/") || existsSync(filename)) {
    return existsSync(filename) ? filename : null
  }

  for (const uploadDir of getUploadDirectories()) {
    if (existsSync(uploadDir)) {
      const candidate = join(uploadDir, filename)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }

  // Not found — return original path so caller can handle the error
  return filename
}

// file_path_utils.py:59-82
export function getDefaultDownloadPath(filename: string): string {
  for (const downloadDir of getDownloadDirectories()) {
    try {
      mkdirSync(downloadDir, { recursive: true })
      // Verify writable
      accessSync(downloadDir, constants.W_OK)
      return join(downloadDir, filename)
    } catch {
      continue
    }
  }
  // Fallback to current directory
  return filename
}

// file_path_utils.py:84-100
export function ensureUploadDirectories(): string[] {
  const created: string[] = []
  for (const uploadDir of getUploadDirectories()) {
    try {
      mkdirSync(uploadDir, { recursive: true })
      if (existsSync(uploadDir)) {
        created.push(uploadDir)
      }
    } catch {
      // ignore permission errors, try next
    }
  }
  return created
}

// file_path_utils.py:102-117
export function ensureDownloadDirectories(): string[] {
  const created: string[] = []
  for (const downloadDir of getDownloadDirectories()) {
    try {
      mkdirSync(downloadDir, { recursive: true })
      if (existsSync(downloadDir)) {
        created.push(downloadDir)
      }
    } catch {
      // ignore permission errors, try next
    }
  }
  return created
}

export interface DirectoryStatus {
  path: string
  exists: boolean
  readable: boolean
  containsFile: boolean
}

export interface SearchSummary {
  requestedFile: string
  searchDirectories: string[]
  foundPath: string | null
  searchSuccessful: boolean
  directoryStatus: DirectoryStatus[]
}

// file_path_utils.py:119-152
export function getSearchSummary(filename: string, foundPath: string | null): SearchSummary {
  const uploadDirs = getUploadDirectories()

  const directoryStatus: DirectoryStatus[] = uploadDirs.map((dirPath) => {
    const exists = existsSync(dirPath)
    let readable = false
    if (exists) {
      try {
        readdirSync(dirPath)
        readable = true
      } catch {
        readable = false
      }
    }
    const containsFile = readable ? existsSync(join(dirPath, filename)) : false
    return { path: dirPath, exists, readable, containsFile }
  })

  return {
    requestedFile: filename,
    searchDirectories: uploadDirs,
    foundPath,
    searchSuccessful: foundPath !== null && existsSync(foundPath),
    directoryStatus,
  }
}

export interface EnhancedFilePathInfo {
  type: "url" | "local_file"
  originalPath: string
  searchSummary?: SearchSummary
}

// file_path_utils.py:155-175
export function getEnhancedFilePath(
  sourcePath: string,
): [string, EnhancedFilePathInfo | { error: string }] {
  if (!sourcePath) {
    return [sourcePath, { error: "源路径为空" }]
  }

  if (/^(https?|ftps?):\/\//.test(sourcePath)) {
    return [sourcePath, { type: "url", originalPath: sourcePath }]
  }

  const foundPath = findUploadFile(sourcePath)
  const searchSummary = getSearchSummary(sourcePath, foundPath)

  return [foundPath ?? sourcePath, { type: "local_file", originalPath: sourcePath, searchSummary }]
}

export interface EnhancedDownloadPathInfo {
  type: "user_specified" | "default_download"
  path: string
  defaultDirectories?: string[]
  availableDirectories?: string[]
  filename?: string
}

// file_path_utils.py:177-218
export function getEnhancedDownloadPath(
  targetPath: string | null | undefined,
  defaultFilename: string,
): [string, EnhancedDownloadPathInfo] {
  if (targetPath) {
    return [targetPath, { type: "user_specified", path: targetPath }]
  }

  const defaultPath = getDefaultDownloadPath(defaultFilename)
  const downloadDirs = getDownloadDirectories()
  const availableDirs = ensureDownloadDirectories()

  return [
    defaultPath,
    {
      type: "default_download",
      path: defaultPath,
      defaultDirectories: downloadDirs,
      availableDirectories: availableDirs,
      filename: defaultFilename,
    },
  ]
}
