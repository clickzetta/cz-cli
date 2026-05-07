/**
 * StudioConfigManager — skeleton port of cz-mcp-server/cz_mcp/studio_config_manager.py
 *
 * Python → TS mapping:
 *   run_stdio_server.py:80-135  config loading → StudioConfigManager.loadFromFile
 *
 * Block 2 will fill in real auth/token logic.
 * This block implements file reading: node:fs + hand-rolled key=value INI parser
 * (no external ini library, per constraints).
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// ---------------------------------------------------------------------------
// StudioConfig — mirrors cz_mcp/studio_config_manager.py StudioConfig dataclass
// ---------------------------------------------------------------------------
export interface StudioConfig {
  token?: string
  username?: string
  password?: string
  pat?: string
  instance?: string
  service?: string
  workspace?: string
  schema?: string
  vcluster?: string
  env?: string
  baseUrl?: string
  loginUrl?: string
  region?: string
}

// ---------------------------------------------------------------------------
// Minimal INI parser — handles key=value lines, ignores [sections] and # comments
// ---------------------------------------------------------------------------
function parseIni(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    // skip blank lines, section headers, and comments
    if (!line || line.startsWith("[") || line.startsWith("#") || line.startsWith(";")) {
      continue
    }
    const eqIdx = line.indexOf("=")
    if (eqIdx === -1) continue
    const key = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1).trim()
    if (key) {
      result[key] = value
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// StudioConfigManager
// ---------------------------------------------------------------------------
export class StudioConfigManager {
  /**
   * Load config from config/{env}_properties.ini relative to cwd,
   * then apply CLI overrides.
   *
   * run_stdio_server.py:80-135 — config loading section
   */
  static loadFromFile(env: string, overrides?: Partial<StudioConfig>): StudioConfig {
    const configPath = resolve(process.cwd(), "config", `${env}_properties.ini`)

    let ini: Record<string, string> = {}
    try {
      const content = readFileSync(configPath, "utf-8")
      ini = parseIni(content)
    } catch {
      // Config file is optional — CLI overrides may supply all needed values
    }

    // Map common INI keys to StudioConfig fields
    const config: StudioConfig = {
      env,
      instance: ini["instance"] ?? ini["x_lakehouse_instance"],
      service: ini["service"] ?? ini["base_url"] ?? ini["x_lakehouse_service"],
      workspace: ini["workspace"] ?? ini["x_lakehouse_workspace"],
      schema: ini["schema"] ?? ini["x_lakehouse_schema"],
      vcluster: ini["vcluster"] ?? ini["x_lakehouse_vcluster"],
      username: ini["username"] ?? ini["x_lakehouse_username"],
      password: ini["password"] ?? ini["x_lakehouse_password"],
      pat: ini["pat_token"] ?? ini["x_lakehouse_pat"] ?? ini["x_lakehouse_token"],
      token: ini["token"],
      baseUrl: ini["base_url"],
      loginUrl: ini["login_url"],
      region: ini["region"] ?? ini["x_lakehouse_region"],
    }

    // Apply CLI overrides (run_stdio_server.py:90-133 apply_cli_config_overrides)
    if (overrides) {
      for (const [k, v] of Object.entries(overrides)) {
        if (v !== undefined && v !== null && v !== "") {
          ;(config as Record<string, unknown>)[k] = v
        }
      }
    }

    return config
  }
}
