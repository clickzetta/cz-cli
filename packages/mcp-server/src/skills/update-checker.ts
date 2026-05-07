/**
 * Update detection for GitHub and local skill sources.
 *
 * Python → TS mapping:
 *   update_checker.py:18-37   UpdateResult dataclass      → UpdateResult interface + factory
 *   update_checker.py:39-239  GitHubSourceTracker class   → GitHubSourceTracker class
 *   update_checker.py:241-342 LocalSourceTracker class    → LocalSourceTracker class
 *   update_checker.py:344-416 UpdateChecker class         → UpdateChecker class
 */

import { statSync, readdirSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { homedir } from "node:os"
import { logger } from "../logger.js"
import { StateManager } from "./state.js"

// ---------------------------------------------------------------------------
// update_checker.py:18-37 — UpdateResult dataclass
// ---------------------------------------------------------------------------

export interface UpdateResult {
  /** Whether any updates were detected. */
  has_updates: boolean
  /** List of source configs that have changes. */
  changed_sources: Record<string, unknown>[]
  /** Number of GitHub API calls made. */
  api_calls_made: number
  /** Any errors encountered during checking. */
  errors: string[]
}

function makeUpdateResult(): UpdateResult {
  return {
    has_updates: false,
    changed_sources: [],
    api_calls_made: 0,
    errors: [],
  }
}

// ---------------------------------------------------------------------------
// update_checker.py:39-239 — GitHubSourceTracker class
// ---------------------------------------------------------------------------

export class GitHubSourceTracker {
  private readonly stateManager: StateManager
  private readonly githubToken: string | null
  private apiCallsThisHour: number
  private lastApiReset: Date

  // update_checker.py:54-65 — __init__()
  constructor(githubToken: string | null = null) {
    this.stateManager = new StateManager("github_tracker")
    this.githubToken = githubToken
    this.apiCallsThisHour = 0
    // Align to current hour boundary (update_checker.py:65)
    const now = new Date()
    this.lastApiReset = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0)
  }

  // update_checker.py:67-98 — _parse_github_url()
  private _parseGithubUrl(url: string): [string, string, string] | null {
    try {
      const parsed = new URL(url)
      const pathParts = parsed.pathname.replace(/^\//, "").split("/").filter(Boolean)

      if (pathParts.length < 2) return null

      const owner = pathParts[0]!
      const repo = pathParts[1]!
      let branch = "main" // Default (update_checker.py:89)

      // Check for /tree/{branch}/ format (update_checker.py:92-93)
      if (pathParts.length > 3 && pathParts[2] === "tree") {
        branch = pathParts[3]!
      }

      return [owner, repo, branch]
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      logger.error({ err, url }, "Failed to parse GitHub URL")
      return null
    }
  }

  // update_checker.py:100-117 — _get_state_key()
  private _getStateKey(owner: string, repo: string, branch: string): string {
    return `${owner}/${repo}/${branch}`
  }

  // update_checker.py:119-127 — _update_api_counter()
  private _updateApiCounter(): void {
    const now = new Date()
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0)

    if (currentHour > this.lastApiReset) {
      // New hour, reset counter (update_checker.py:126-127)
      this.apiCallsThisHour = 0
      this.lastApiReset = currentHour
    }
  }

  // update_checker.py:129-156 — _make_api_request()
  private async _makeApiRequest(url: string): Promise<Record<string, unknown> | null> {
    this._updateApiCounter()
    this.apiCallsThisHour += 1

    const headers: Record<string, string> = {}
    if (this.githubToken) {
      headers["Authorization"] = `token ${this.githubToken}`
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30_000)
      const response = await fetch(url, { headers, signal: controller.signal })
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return (await response.json()) as Record<string, unknown>
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      logger.error({ err, url }, "GitHub API request failed")
      return null
    }
  }

  // update_checker.py:158-220 — check_for_updates()
  async checkForUpdates(sourceConfig: Record<string, unknown>): Promise<boolean> {
    const url = sourceConfig["url"] as string | undefined
    if (!url) return false

    const parsed = this._parseGithubUrl(url)
    if (!parsed) {
      logger.warn({ url }, "Invalid GitHub URL")
      return false
    }

    const [owner, repo, branch] = parsed
    const stateKey = this._getStateKey(owner, repo, branch)

    // Get last known commit SHA (update_checker.py:184)
    const lastSha = this.stateManager.get(stateKey) as string | null

    // Fetch current HEAD commit (update_checker.py:187-188)
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`
    const commitData = await this._makeApiRequest(apiUrl)

    if (!commitData) {
      logger.warn({ owner, repo, branch }, "Failed to fetch commit info")
      return false
    }

    const currentSha = commitData["sha"] as string | undefined
    if (!currentSha) {
      logger.warn({ owner, repo, branch }, "No SHA in commit data")
      return false
    }

    // Check if SHA changed (update_checker.py:200-220)
    if (lastSha === null || lastSha === undefined) {
      // First time checking, save SHA but don't trigger update (update_checker.py:201-207)
      logger.info({ owner, repo, branch, sha: currentSha.slice(0, 7) }, "First check, recording SHA")
      this.stateManager.set(stateKey, currentSha)
      this.stateManager.saveState()
      return false
    }

    if (currentSha !== lastSha) {
      logger.info(
        { owner, repo, branch, from: lastSha.slice(0, 7), to: currentSha.slice(0, 7) },
        "Update detected",
      )
      // Update the SHA (update_checker.py:215-216)
      this.stateManager.set(stateKey, currentSha)
      this.stateManager.saveState()
      return true
    }

    logger.debug({ owner, repo, branch }, "No updates")
    return false
  }

  // update_checker.py:222-238 — get_api_usage()
  getApiUsage(): Record<string, unknown> {
    this._updateApiCounter()
    const limit = this.githubToken ? 5000 : 60

    return {
      calls_this_hour: this.apiCallsThisHour,
      limit_per_hour: limit,
      authenticated: this.githubToken !== null,
      last_reset: this.lastApiReset.toISOString(),
    }
  }
}

// ---------------------------------------------------------------------------
// update_checker.py:241-342 — LocalSourceTracker class
// ---------------------------------------------------------------------------

export class LocalSourceTracker {
  private readonly stateManager: StateManager

  // update_checker.py:250-252 — __init__()
  constructor() {
    this.stateManager = new StateManager("local_tracker")
  }

  // update_checker.py:254-275 — _get_skill_files()
  private _getSkillFiles(path: string): string[] {
    try {
      const localPath = resolve(path.replace(/^~/, homedir()))
      if (!existsSync(localPath)) return []

      const stat = statSync(localPath)
      if (!stat.isDirectory()) return []

      return this._rglob(localPath, "SKILL.md")
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      logger.error({ err, path }, "Error scanning local path")
      return []
    }
  }

  /** Recursively find all files matching name under dir. */
  private _rglob(dir: string, name: string): string[] {
    const results: string[] = []
    const walk = (d: string): void => {
      try {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          const full = `${d}/${entry.name}`
          if (entry.isDirectory()) {
            walk(full)
          } else if (entry.name === name) {
            results.push(full)
          }
        }
      } catch {
        // ignore unreadable dirs
      }
    }
    walk(dir)
    return results
  }

  // update_checker.py:277-341 — check_for_updates()
  checkForUpdates(sourceConfig: Record<string, unknown>): boolean {
    const path = sourceConfig["path"] as string | undefined
    if (!path) return false

    const skillFiles = this._getSkillFiles(path)

    // Get state key (update_checker.py:297)
    const stateKey = `local:${path}`
    const lastMtimes = (this.stateManager.get(stateKey, {}) as Record<string, number>)

    // Check modification times (update_checker.py:301-320)
    const currentMtimes: Record<string, number> = {}
    let hasChanges = false

    for (const skillFile of skillFiles) {
      try {
        const mtime = statSync(skillFile).mtimeMs / 1000 // convert to seconds like Python
        const fileKey = skillFile
        currentMtimes[fileKey] = mtime

        // Check if file is new or modified (update_checker.py:311-317)
        if (!(fileKey in lastMtimes)) {
          logger.info({ skillFile }, "New skill file detected")
          hasChanges = true
        } else if (Math.abs((lastMtimes[fileKey] ?? 0) - mtime) > 0.001) {
          logger.info({ skillFile }, "Modified skill file detected")
          hasChanges = true
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        logger.warn({ err, skillFile }, "Failed to check mtime")
      }
    }

    // Check for deleted files (update_checker.py:322-326)
    for (const fileKey of Object.keys(lastMtimes)) {
      if (!(fileKey in currentMtimes)) {
        logger.info({ fileKey }, "Deleted skill file detected")
        hasChanges = true
      }
    }

    // Update state (update_checker.py:329-341)
    if (hasChanges || Object.keys(lastMtimes).length === 0) {
      // First check or changes detected
      this.stateManager.set(stateKey, currentMtimes)
      this.stateManager.saveState()

      // Don't trigger update on first check (update_checker.py:335-339)
      if (Object.keys(lastMtimes).length === 0) {
        logger.info({ path, count: skillFiles.length }, "First check for local path, tracking files")
        return false
      }
    }

    return hasChanges
  }
}

// ---------------------------------------------------------------------------
// update_checker.py:344-416 — UpdateChecker class
// ---------------------------------------------------------------------------

export class UpdateChecker {
  private readonly githubTracker: GitHubSourceTracker
  private readonly localTracker: LocalSourceTracker

  // update_checker.py:355-364 — __init__()
  constructor(githubToken: string | null = null) {
    this.githubTracker = new GitHubSourceTracker(githubToken)
    this.localTracker = new LocalSourceTracker()
  }

  // update_checker.py:366-406 — check_for_updates()
  async checkForUpdates(skillSources: Record<string, unknown>[]): Promise<UpdateResult> {
    const result = makeUpdateResult()

    for (const sourceConfig of skillSources) {
      const sourceType = sourceConfig["type"] as string | undefined

      try {
        if (sourceType === "github") {
          const hasUpdate = await this.githubTracker.checkForUpdates(sourceConfig)
          if (hasUpdate) {
            result.has_updates = true
            result.changed_sources.push(sourceConfig)
          }
        } else if (sourceType === "local") {
          const hasUpdate = this.localTracker.checkForUpdates(sourceConfig)
          if (hasUpdate) {
            result.has_updates = true
            result.changed_sources.push(sourceConfig)
          }
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        const errorMsg = `Error checking ${sourceType} source: ${err.message}`
        logger.error({ err }, errorMsg)
        result.errors.push(errorMsg)
      }
    }

    // Get API usage stats (update_checker.py:402-404)
    const apiUsage = this.githubTracker.getApiUsage()
    result.api_calls_made = apiUsage["calls_this_hour"] as number

    return result
  }

  // update_checker.py:408-416 — get_api_usage()
  getApiUsage(): Record<string, unknown> {
    return this.githubTracker.getApiUsage()
  }
}
