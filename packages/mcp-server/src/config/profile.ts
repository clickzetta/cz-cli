/**
 * StudioConfigManager — port of cz-mcp-server/cz_mcp/studio_config_manager.py
 *
 * Python → TS mapping:
 *   studio_config_manager.py:20-168  StudioConfig dataclass → StudioConfig interface
 *   studio_config_manager.py:172-337 StudioConfigManager class → StudioConfigManager class
 *   studio_config_manager.py:195-272 load_config              → StudioConfigManager.loadFromFile
 *   studio_config_manager.py:274-333 login                    → (deferred; HTTP transport handles auth)
 *   studio_config_manager.py:160-169 to_clickzetta_params     → StudioConfigManager.toClientOptions
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ConnectionConfig } from "@clickzetta/sdk"
import { withDefaultQueryTag } from "../trace.js"

// ---------------------------------------------------------------------------
// StudioConfig — mirrors studio_config_manager.py StudioConfig dataclass
// studio_config_manager.py:20-72
// ---------------------------------------------------------------------------
export interface StudioConfig {
  // studio_config_manager.py:21 — JWT token
  token: string
  // studio_config_manager.py:22 — instance name
  instance: string
  // studio_config_manager.py:23 — Instance ID from login response
  instanceId: number
  // studio_config_manager.py:24 — workspace name
  workspace: string
  // studio_config_manager.py:25 — workspace ID
  workspaceId: number
  // studio_config_manager.py:26
  vcluster: string
  // studio_config_manager.py:27
  schema: string
  // studio_config_manager.py:28
  service: string

  // studio_config_manager.py:30-35 — Environment and URLs
  env: string
  regionId: number
  regionCode: string
  baseUrl: string
  loginUrl: string

  // studio_config_manager.py:37-43 — Optional metadata
  projectId: string
  userId: number
  tenantId: number
  username: string
  expireTime: number

  // studio_config_manager.py:45-50 — Server configuration
  transportType: string
  enableResources: boolean
  enablePrompts: boolean
  resourceRequestTimeout: number
  promptRequestTimeout: number

  // studio_config_manager.py:52-53 — Query and execution hints
  hints: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Default hints — studio_config_manager.py:60-72 _get_default_hints
// ---------------------------------------------------------------------------
function getDefaultHints(): Record<string, unknown> {
  return withDefaultQueryTag({
    "sdk.job.timeout": 300,
    "cz.storage.parquet.vector.index.read.memory.cache": "true",
    "cz.storage.parquet.vector.index.read.local.cache": "false",
    "spark.sql.ansi.enabled": "true",
    "spark.sql.storeAssignmentPolicy": "ANSI",
    "cz.sql.allowComplexTypeInSelect": "true",
    "cz.sql.allowCollectionInDataFrame": "true",
  })
}

// ---------------------------------------------------------------------------
// Minimal INI parser — handles key=value lines, ignores [sections] and # comments
// ---------------------------------------------------------------------------
function parseIni(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
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
// StudioConfigManager — studio_config_manager.py:172-337
// ---------------------------------------------------------------------------
export class StudioConfigManager {
  /**
   * Load config from config/{env}_properties.ini relative to package root,
   * then apply overrides.
   *
   * studio_config_manager.py:195-272 load_config (STDIO branch)
   *
   * INI key mapping (dev_properties.ini):
   *   [variable] instancename     → instance
   *   [variable] workSpaceName    → workspace
   *   [variable] adhocVcCode      → vcluster
   *   [variable] adhocSchemaName  → schema
   *   [variable] projectId        → projectId
   *   [USER]     username         → username
   *   [USER]     pat_token        → pat (used as token for direct auth)
   */
  static loadFromFile(env: string, overrides?: Partial<StudioConfig>): StudioConfig {
    // Resolve relative to the package root (two levels up from src/config/)
    const packageRoot = resolve(new URL("../../..", import.meta.url).pathname)
    const configPath = resolve(packageRoot, "config", `${env}_properties.ini`)

    let ini: Record<string, string> = {}
    try {
      const content = readFileSync(configPath, "utf-8")
      ini = parseIni(content)
    } catch {
      // Config file is optional — overrides may supply all needed values
    }

    const config: StudioConfig = {
      token: ini["token"] ?? "",
      instance: ini["instancename"] ?? ini["instance"] ?? "",
      instanceId: Number(ini["instanceId"] ?? 0),
      workspace: ini["workSpaceName"] ?? ini["workspace"] ?? "",
      workspaceId: 0,
      vcluster: ini["adhocVcCode"] ?? ini["vcluster"] ?? "DEFAULT",
      schema: ini["adhocSchemaName"] ?? ini["schema"] ?? "public",
      service: ini["service"] ?? "",
      env,
      regionId: 0,
      regionCode: ini["cspRegion"] ?? "",
      baseUrl: ini["base_url"] ?? "",
      loginUrl: ini["login"] ?? "",
      projectId: ini["projectId"] ?? "",
      userId: Number(ini["userId"] ?? 0),
      tenantId: Number(ini["tenantId"] ?? 0),
      username: ini["username"] ?? "",
      expireTime: 0,
      transportType: "stdio",
      enableResources: true,
      enablePrompts: true,
      resourceRequestTimeout: 30.0,
      promptRequestTimeout: 20.0,
      hints: getDefaultHints(),
    }

    // Apply overrides (overrides take priority)
    if (overrides) {
      for (const [k, v] of Object.entries(overrides)) {
        if (v !== undefined && v !== null) {
      ;(config as unknown as Record<string, unknown>)[k] = v
        }
      }
    }

    return config
  }

  /**
   * Build a StudioConfig directly from a Bearer token.
   * studio_config_manager.py:274-333 login (HTTP mode — token comes from header)
   *
   * This is the HTTP transport path: the token is already resolved by the
   * caller (e.g. from an Authorization header), so we just assemble the
   * config struct without hitting the login endpoint.
   */
  static fromToken(
    token: string,
    opts: Partial<Omit<StudioConfig, "token">>,
  ): StudioConfig {
    return {
      token,
      instance: opts.instance ?? "",
      instanceId: opts.instanceId ?? 0,
      workspace: opts.workspace ?? "",
      workspaceId: opts.workspaceId ?? 0,
      vcluster: opts.vcluster ?? "DEFAULT",
      schema: opts.schema ?? "public",
      service: opts.service ?? "",
      env: opts.env ?? "dev",
      regionId: opts.regionId ?? 0,
      regionCode: opts.regionCode ?? "",
      baseUrl: opts.baseUrl ?? "",
      loginUrl: opts.loginUrl ?? "",
      projectId: opts.projectId ?? "",
      userId: opts.userId ?? 0,
      tenantId: opts.tenantId ?? 0,
      username: opts.username ?? "",
      expireTime: opts.expireTime ?? 0,
      transportType: opts.transportType ?? "http",
      enableResources: opts.enableResources ?? true,
      enablePrompts: opts.enablePrompts ?? true,
      resourceRequestTimeout: opts.resourceRequestTimeout ?? 30.0,
      promptRequestTimeout: opts.promptRequestTimeout ?? 20.0,
      hints: opts.hints ?? getDefaultHints(),
    }
  }

  /**
   * Convert StudioConfig to @clickzetta/sdk ConnectionConfig.
   * studio_config_manager.py:160-169 to_clickzetta_params
   *
   * Python uses ClickzettaConnectionParams (magic_token, instance, service,
   * workspace, vcluster, schema). TS side uses ConnectionConfig which also
   * needs pat/username/password/protocol fields.
   *
   * Divergence: Python connector uses `magic_token`; TS SDK uses `pat` +
   * token cache. We pass the JWT as `pat` so getToken() can return it
   * directly without a login round-trip.
   */
  static toClientOptions(config: StudioConfig): ConnectionConfig {
    return {
      pat: config.token,
      username: config.username,
      password: "",
      service: config.service,
      protocol: "https",
      instance: config.instance,
      workspace: config.workspace,
      schema: config.schema,
      vcluster: config.vcluster,
    }
  }
}
