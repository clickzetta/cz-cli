/**
 * config utils — port of cz-mcp-server/cz_mcp/utils/config_utils.py
 *
 * Python → TS mapping:
 *   config_utils.py:8-9    module-level conf + path setup → configDir constant
 *   config_utils.py:11-18  read_ini()                     → readIni()
 *   config_utils.py:21-31  read_url()                     → readUrl()
 *   config_utils.py:33-43  read_web_url()                 → readWebUrl()
 *   config_utils.py:46-52  read_api()                     → readApi()
 *   config_utils.py:55-62  read_env_configuration()       → readEnvConfiguration()
 *   config_utils.py:65-71  read_data_source_config()      → readDataSourceConfig()
 *   config_utils.py:74-80  read_sections_ini()            → readSectionsIni()
 *   config_utils.py:82-87  read_config_ini()              → readConfigIni()
 *
 * Divergences from Python:
 *   - Python uses configparser (INI file parser) + a module-level shared ConfigParser instance.
 *     TS uses a simple synchronous INI parser (no new npm deps) with a module-level cache.
 *   - Python's context dict (context_utils.py) is replaced by a module-level `context` map.
 *   - Function names are camelCase per TS convention.
 *   - Python's loguru logger is replaced by console.error for error reporting.
 */

import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// config_utils.py:8-9 — module-level path setup
// Resolve config/ directory relative to this file's location (mirrors __file__ logic)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// Walk up two levels: utils/ → src/ → package root, then into config/
const configDir = resolve(__dirname, "..", "..", "config")

// context_utils.py:4 — simple context map (replaces Python's mutable dict)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const context: Record<string, any> = {}

// ---------------------------------------------------------------------------
// Internal INI parser — replaces configparser (no new npm deps)
// ---------------------------------------------------------------------------

/** Parsed INI structure: section → key → value */
type IniData = Record<string, Record<string, string>>

/** Module-level cache keyed by absolute file path (mirrors Python's shared ConfigParser) */
const _iniCache: Map<string, IniData> = new Map()

/**
 * Parse an INI file into a nested map.
 * Supports [section] headers and key=value / key: value pairs.
 * Lines starting with # or ; are treated as comments.
 */
function _parseIni(filePath: string): IniData {
  if (_iniCache.has(filePath)) {
    return _iniCache.get(filePath)!
  }

  const data: IniData = {}
  let currentSection = "__default__"

  try {
    const content = readFileSync(filePath, "utf-8")
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#") || line.startsWith(";")) continue

      if (line.startsWith("[") && line.endsWith("]")) {
        currentSection = line.slice(1, -1).trim()
        if (!(currentSection in data)) data[currentSection] = {}
        continue
      }

      const sepIdx = line.indexOf("=") !== -1 ? line.indexOf("=") : line.indexOf(":")
      if (sepIdx === -1) continue

      const key = line.slice(0, sepIdx).trim().toLowerCase()
      const value = line.slice(sepIdx + 1).trim()

      if (!(currentSection in data)) data[currentSection] = {}
      data[currentSection]![key] = value
    }
  } catch {
    // File not found or unreadable — return empty data
  }

  _iniCache.set(filePath, data)
  return data
}

// config_utils.py:11-18
export function readIni(filePath: string, section: string, key: string): string | null {
  try {
    const absPath = join(configDir, filePath)
    const data = _parseIni(absPath)
    const sectionData = data[section]
    if (!sectionData) return null
    return sectionData[key.toLowerCase()] ?? null
  } catch (e) {
    console.error(`Error reading INI file: ${e}`)
    return null
  }
}

// config_utils.py:21-31
export function readUrl(section = "URL", env?: string): string {
  try {
    const absPath = join(configDir, "config.ini")
    const resolvedEnv = env ?? (context["env"] as string | undefined) ?? "dev"
    const data = _parseIni(absPath)
    const sectionData = data[section]
    if (!sectionData) return ""
    return sectionData[resolvedEnv.toLowerCase()] ?? ""
  } catch (e) {
    console.error(`Error: ${e}`)
    return ""
  }
}

// config_utils.py:33-43
export function readWebUrl(section = "WEB", env?: string): string {
  try {
    const absPath = join(configDir, "config.ini")
    const resolvedEnv = env ?? (context["env"] as string | undefined) ?? "dev"
    const data = _parseIni(absPath)
    const sectionData = data[section]
    if (!sectionData) return ""
    return sectionData[resolvedEnv.toLowerCase()] ?? ""
  } catch (e) {
    console.error(`Error: ${e}`)
    return ""
  }
}

// config_utils.py:46-52
export function readApi(key: string, section = "API"): string {
  try {
    return readIni("api_properties.ini", section, key) ?? ""
  } catch (e) {
    console.error(`Error: ${e}`)
    return ""
  }
}

// config_utils.py:55-62
export function readEnvConfiguration(key: string, section = "variable"): string {
  try {
    const env = context["env"] as string | undefined
    if (!env) return ""
    const filePath = `${env}_properties.ini`
    return readIni(filePath, section, key) ?? ""
  } catch (e) {
    console.error(`Error: ${e}`)
    return ""
  }
}

// config_utils.py:65-71
export function readDataSourceConfig(section: string, key: string): string {
  try {
    const env = context["env"] as string | undefined
    if (!env) return ""
    return readIni(`${env}_dataSource_config.ini`, section, key) ?? ""
  } catch (e) {
    console.error(`Error: ${e}`)
    return ""
  }
}

// config_utils.py:74-80
export function readSectionsIni(key: string): string[] {
  try {
    const absPath = join(configDir, key)
    const data = _parseIni(absPath)
    const sections = Object.keys(data).filter((s) => s !== "__default__")
    if (sections.length === 0) return []
    const firstSection = sections[0]!
    return Object.keys(data[firstSection]!)
  } catch (e) {
    console.error(`Error: ${e}`)
    return []
  }
}

// config_utils.py:82-87
export function readConfigIni(section: string, key: string): string {
  try {
    const absPath = join(configDir, "config.ini")
    const data = _parseIni(absPath)
    const sectionData = data[section]
    if (!sectionData) return ""
    return sectionData[key.toLowerCase()] ?? ""
  } catch (e) {
    console.error(`Error: ${e}`)
    return ""
  }
}
