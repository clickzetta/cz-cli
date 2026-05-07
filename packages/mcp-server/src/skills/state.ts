/**
 * State persistence for tracking skill updates.
 *
 * Python → TS mapping:
 *   state_manager.py:14-24  _get_state_cache_dir()  → getStateCacheDir()
 *   state_manager.py:27-43  _get_state_file_path()  → getStateFilePath()
 *   state_manager.py:46-141 StateManager class       → StateManager class
 */

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { logger } from "../logger.js"

// ---------------------------------------------------------------------------
// state_manager.py:14-24 — _get_state_cache_dir()
// ---------------------------------------------------------------------------

function getStateCacheDir(): string {
  const cacheDir = join(tmpdir(), "claude_skills_mcp_cache", "state")
  mkdirSync(cacheDir, { recursive: true })
  return cacheDir
}

// ---------------------------------------------------------------------------
// state_manager.py:27-43 — _get_state_file_path()
// ---------------------------------------------------------------------------

function getStateFilePath(key: string): string {
  const cacheDir = getStateCacheDir()
  // Create hash-based filename to avoid path issues (state_manager.py:42)
  const hashKey = createHash("md5").update(key).digest("hex")
  return join(cacheDir, `${hashKey}.json`)
}

// ---------------------------------------------------------------------------
// state_manager.py:46-141 — StateManager class
// ---------------------------------------------------------------------------

export class StateManager {
  readonly stateKey: string
  readonly stateFile: string
  state: Record<string, unknown>

  constructor(stateKey: string) {
    this.stateKey = stateKey
    this.stateFile = getStateFilePath(stateKey)
    this.state = {}
    this._loadState()
  }

  // state_manager.py:72-85 — _load_state()
  private _loadState(): void {
    if (!existsSync(this.stateFile)) {
      logger.debug({ stateKey: this.stateKey }, "No existing state found")
      this.state = {}
      return
    }

    try {
      const raw = readFileSync(this.stateFile, "utf-8")
      this.state = JSON.parse(raw) as Record<string, unknown>
      logger.debug({ stateKey: this.stateKey, stateFile: this.stateFile }, "Loaded state")
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      logger.warn({ err, stateFile: this.stateFile }, "Failed to load state")
      this.state = {}
    }
  }

  // state_manager.py:87-97 — save_state()
  saveState(): void {
    try {
      // Add timestamp (state_manager.py:91)
      this.state["_last_saved"] = new Date().toISOString()
      writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), "utf-8")
      logger.debug({ stateKey: this.stateKey, stateFile: this.stateFile }, "Saved state")
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      logger.warn({ err, stateFile: this.stateFile }, "Failed to save state")
    }
  }

  // state_manager.py:99-114 — get()
  get(key: string, defaultValue: unknown = null): unknown {
    return key in this.state ? this.state[key] : defaultValue
  }

  // state_manager.py:116-126 — set()
  set(key: string, value: unknown): void {
    this.state[key] = value
  }

  // state_manager.py:128-136 — update()
  update(updates: Record<string, unknown>): void {
    Object.assign(this.state, updates)
  }

  // state_manager.py:138-141 — clear()
  clear(): void {
    this.state = {}
    this.saveState()
  }
}
