/**
 * docker-compatibility.ts — port of cz_mcp/common/docker_compatibility.py
 */

import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { homedir, platform } from "node:os"
import { normalize } from "node:path"
import { logger } from "../logger.js"

export function isWindowsDocker(): boolean {
  const isDocker =
    existsSync("/.dockerenv") ||
    !!process.env.DOCKER_CONTAINER ||
    (() => {
      try {
        return existsSync("/proc/1/cgroup") && readFileSync("/proc/1/cgroup", "utf-8").includes("docker")
      } catch {
        return false
      }
    })()

  if (!isDocker) return false

  const windowsIndicators = [
    (process.env.DOCKER_HOST ?? "").includes("npipe"),
    process.env.DOCKER_BUILDKIT_PROGRESS === "plain",
    existsSync("/mnt/wsl"),
  ]

  return windowsIndicators.some(Boolean)
}

export function normalizePath(path: string): string {
  if (!path) return path

  let normalized = path.replace(/\\/g, "/")

  if (isWindowsDocker() && normalized.length > 1 && normalized[1] === ":") {
    const drive = normalized[0].toLowerCase()
    const rest = normalized.slice(2)
    normalized = `/${drive}${rest}`
  }

  return normalized
}

export function getDockerFriendlyConfigPaths(filename = "connections.json"): string[] {
  const standardPaths = [
    `/app/.clickzetta/lakehouse_connection/${filename}`,
    `/app/config/lakehouse_connection/${filename}`,
    `${homedir()}/.clickzetta/${filename}`,
    `config/lakehouse_connection/${filename}`,
  ]

  let paths = standardPaths
  if (isWindowsDocker()) {
    const user = process.env.USERNAME ?? "user"
    const windowsPaths = [
      `/mnt/c/Users/${user}/.clickzetta/${filename}`,
      `/app/.clickzetta/${filename}`,
      `/config/${filename}`,
    ]
    paths = [...windowsPaths, ...standardPaths]
  }

  return paths.map(normalizePath)
}

export function safeFileAccess(filepath: string): boolean {
  try {
    const normalized = normalizePath(filepath)
    if (!existsSync(normalized)) return false
    const stat = statSync(normalized)
    if (!stat.isFile()) return false
    accessSync(normalized, constants.R_OK)
    return true
  } catch (e) {
    logger.debug(`File access check failed ${filepath}: ${e}`)
    return false
  }
}

export function safeDirectoryCreate(dirpath: string): boolean {
  try {
    const normalized = normalizePath(dirpath)
    mkdirSync(normalized, { recursive: true })
    return true
  } catch (e) {
    logger.warn(`Directory creation failed ${dirpath}: ${e}`)
    return false
  }
}

export function getWindowsDockerDebugInfo(): Record<string, unknown> {
  return {
    platform: platform(),
    is_docker: existsSync("/.dockerenv"),
    is_windows_docker: isWindowsDocker(),
    docker_host: process.env.DOCKER_HOST ?? "",
    user: process.env.USER ?? process.env.USERNAME ?? "",
    home: homedir(),
    cwd: process.cwd(),
    path_exists_checks: {
      "/.dockerenv": existsSync("/.dockerenv"),
      "/mnt/wsl": existsSync("/mnt/wsl"),
      "/app": existsSync("/app"),
      "/app/.clickzetta": existsSync("/app/.clickzetta"),
    },
    env_vars: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k.includes("DOCKER") || k.includes("WSL") || k === "PATH"),
    ),
  }
}

export function createSafeConnectionManager(): { configFile: string | null } | null {
  try {
    if (isWindowsDocker()) {
      logger.info("Detected Windows Docker environment, using enhanced initialization")
      const debugInfo = getWindowsDockerDebugInfo()
      logger.debug({ debugInfo }, "Windows Docker environment info")

      const configPaths = getDockerFriendlyConfigPaths()
      let configFile: string | null = null

      for (const p of configPaths) {
        if (safeFileAccess(p)) {
          configFile = p
          logger.info(`Found config file in Windows Docker environment: ${p}`)
          break
        } else {
          logger.debug(`Config file not accessible: ${p}`)
        }
      }

      return { configFile }
    }
    return { configFile: null }
  } catch (e) {
    logger.error(`Failed to create connection manager: ${e}`)
    logger.error("Possible causes: 1) Config file path issue 2) Permission issue 3) Windows Docker specifics")
    if (isWindowsDocker()) {
      const debugInfo = getWindowsDockerDebugInfo()
      logger.error({ debugInfo }, "Windows Docker debug info")
    }
    return null
  }
}

export function logDockerEnvironmentInfo(): void {
  logger.info(`Docker environment detection:`)
  logger.info(`  - In Docker: ${existsSync("/.dockerenv")}`)
  logger.info(`  - Windows Docker: ${isWindowsDocker()}`)
  logger.info(`  - Platform: ${platform()}`)
  logger.info(`  - CWD: ${process.cwd()}`)
  logger.info(`  - Home: ${homedir()}`)

  if (isWindowsDocker()) {
    const debugInfo = getWindowsDockerDebugInfo()
    logger.info({ debugInfo }, "Windows Docker details")
  }
}
