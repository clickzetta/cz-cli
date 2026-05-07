/**
 * config-path.ts — port of cz_mcp/common/config_path_utils.py
 *
 * Python → TS mapping:
 *   config_path_utils.py:14-44   find_config_file()        → findConfigFile()
 *   config_path_utils.py:46-64   get_config_file_path()    → getConfigFilePath()
 *   config_path_utils.py:66-84   is_docker_environment()   → isDockerEnvironment()
 *   config_path_utils.py:86-96   get_backup_directory()    → getBackupDirectory()
 *   config_path_utils.py:98-115  ensure_config_directory() → ensureConfigDirectory()
 *   config_path_utils.py:117-119 get_connections_json_path() → getConnectionsJsonPath()
 *
 * Divergences:
 *   - Python uses os.path.expanduser; TS uses homedir() from node:os.
 *   - Python's loguru logger replaced by console.debug/warn/info/error.
 *   - /proc/1/cgroup check is preserved but wrapped in try/catch.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname } from "node:path"

// config_path_utils.py:14-44
export function findConfigFile(
  filename = "connections.json",
  additionalPaths?: string[],
): string | null {
  const standardPaths = [
    `/app/.clickzetta/lakehouse_connection/${filename}`,
    `/app/config/lakehouse_connection/${filename}`,
    `${homedir()}/.clickzetta/${filename}`,
    `config/lakehouse_connection/${filename}`,
  ]

  const allPaths = additionalPaths ? [...additionalPaths, ...standardPaths] : standardPaths

  console.debug(`查找配置文件 ${filename}，搜索路径: ${JSON.stringify(allPaths)}`)

  for (const path of allPaths) {
    if (existsSync(path)) {
      console.debug(`找到配置文件: ${path}`)
      return path
    } else {
      console.debug(`配置文件不存在: ${path}`)
    }
  }

  console.warn(`未找到配置文件: ${filename}`)
  return null
}

// config_path_utils.py:46-64
export function getConfigFilePath(
  filename = "connections.json",
  additionalPaths?: string[],
): string {
  const configPath = findConfigFile(filename, additionalPaths)
  if (configPath) {
    return configPath
  }
  const defaultPath = `${homedir()}/.clickzetta/${filename}`
  console.info(`使用默认配置文件路径: ${defaultPath}`)
  return defaultPath
}

// config_path_utils.py:66-84
export function isDockerEnvironment(): boolean {
  // Method 1: check /.dockerenv
  if (existsSync("/.dockerenv")) {
    return true
  }

  // Method 2: check env var
  if (process.env["DOCKER_CONTAINER"]) {
    return true
  }

  // Method 3: check /proc/1/cgroup
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf-8")
    if (cgroup.includes("docker")) {
      return true
    }
  } catch {
    // not available on non-Linux
  }

  return false
}

// config_path_utils.py:86-96
export function getBackupDirectory(): string {
  if (existsSync("/app/.clickzetta")) {
    return "/app/.clickzetta/backups"
  }
  return `${homedir()}/.clickzetta/backups`
}

// config_path_utils.py:98-115
export function ensureConfigDirectory(path: string): boolean {
  try {
    let directory: string
    try {
      const stat = statSync(path)
      directory = stat.isFile() ? dirname(path) : path
    } catch {
      // path doesn't exist yet — treat as directory path
      directory = path.endsWith(".json") || path.includes(".") ? dirname(path) : path
    }
    mkdirSync(directory, { recursive: true })
    return true
  } catch (e) {
    console.error(`无法创建配置目录 ${path}: ${e}`)
    return false
  }
}

// config_path_utils.py:117-119
export function getConnectionsJsonPath(): string {
  return getConfigFilePath("connections.json")
}
