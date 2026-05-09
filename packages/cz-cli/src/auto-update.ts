/**
 * Background version check + auto-update for standalone cz-cli binaries.
 *
 * Ported from cz-tool/cz_cli/auto_update.py — same semantics:
 * - Throttle GitHub API checks to every 4 hours
 * - Persist state in ~/.clickzetta/.update_state.json
 * - Support CZ_SKIP_UPDATE env var to disable
 * - Only run for standalone binary installs (not dev/bun)
 * - On newer version: print notice to stderr, attempt auto-update via install.sh
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { execSync } from "node:child_process"
import { VERSION } from "./version.js"

const REPO = "clickzetta/cz-cli"
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`
const CHECK_INTERVAL_HOURS = 4
const STATE_DIR = join(homedir(), ".clickzetta")
const STATE_FILE = join(STATE_DIR, ".update_state.json")

// ── Version comparison ──────────────────────────────────────────────────────

function parseVersion(v: string): number[] {
  const stripped = v.replace(/^v/, "")
  return stripped.split(".").map((seg) => {
    const n = parseInt(seg, 10)
    return Number.isNaN(n) ? 0 : n
  })
}

function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote)
  const l = parseVersion(local)
  const len = Math.max(r.length, l.length)
  for (let i = 0; i < len; i++) {
    const rv = r[i] ?? 0
    const lv = l[i] ?? 0
    if (rv > lv) return true
    if (rv < lv) return false
  }
  return false
}

// ── State persistence (throttle API calls) ──────────────────────────────────

interface UpdateState {
  last_check?: number
  latest?: string
  skip_update?: boolean
}

function readState(): UpdateState {
  try {
    const raw = readFileSync(STATE_FILE, "utf-8")
    return JSON.parse(raw) as UpdateState
  } catch {
    return {}
  }
}

function writeState(state: UpdateState): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    const existing = readState()
    // Preserve skip_update across writes
    if (state.skip_update === undefined) {
      state.skip_update = existing.skip_update ?? false
    }
    writeFileSync(STATE_FILE, JSON.stringify(state), "utf-8")
  } catch {
    // Non-critical — silently ignore write failures
  }
}

function shouldCheck(): boolean {
  const state = readState()
  const last = state.last_check ?? 0
  return (Date.now() / 1000 - last) > CHECK_INTERVAL_HOURS * 3600
}

// ── Fetch latest version ────────────────────────────────────────────────────

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const resp = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!resp.ok) return null
    const data = (await resp.json()) as { tag_name?: string }
    return data.tag_name ?? null
  } catch {
    return null
  }
}

// ── Detect standalone binary ────────────────────────────────────────────────

function isStandaloneBinary(): boolean {
  // If running under bun with a source .ts file, this is dev mode
  const argv1 = process.argv[1] ?? ""
  if (argv1.endsWith(".ts")) return false

  // Check if the executable lives under ~/.local/bin (install location)
  try {
    const exe = resolve(process.execPath)
    const installDir = resolve(join(homedir(), ".local", "bin"))
    if (exe.startsWith(installDir)) return true
    const script = resolve(argv1)
    return script.startsWith(installDir)
  } catch {
    return false
  }
}

// ── Auto-update via install.sh ──────────────────────────────────────────────

function runUpdate(version: string): boolean {
  const installUrl = `https://github.com/${REPO}/releases/download/${version}/install.sh`
  try {
    execSync(`curl -fsSL "${installUrl}" | sh`, {
      env: {
        ...process.env,
        CZ_VERSION: version,
        NON_INTERACTIVE: "1",
        SKIP_PATH_PROMPT: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    })
    return true
  } catch {
    return false
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

function log(msg: string): void {
  process.stderr.write(msg + "\n")
}

export async function checkAndUpdate(): Promise<void> {
  // Check CZ_SKIP_UPDATE env var
  const skipEnv = (process.env.CZ_SKIP_UPDATE ?? "").trim().toLowerCase()
  if (["1", "true", "yes"].includes(skipEnv)) return

  // Check state file skip_update flag
  const state = readState()
  const skipFile = String(state.skip_update ?? false).trim().toLowerCase()
  if (["1", "true", "yes"].includes(skipFile)) return

  // Only auto-update standalone binary installs
  if (!isStandaloneBinary()) return

  // Throttle: only check every 4 hours
  if (!shouldCheck()) return

  const latest = await fetchLatestVersion()
  writeState({ last_check: Date.now() / 1000, latest: latest ?? "" })

  if (!latest) return
  if (!isNewer(latest, VERSION)) return

  log(`New version available: ${VERSION} -> ${latest}`)
  log("  Updating...")

  const ok = runUpdate(latest)
  if (ok) {
    log(`Updated to ${latest}. Restart cz-cli to use the new version.`)
  } else {
    log(`Auto-update failed. Run manually:`)
    log(`  curl -fsSL https://github.com/${REPO}/releases/latest/download/install.sh | sh`)
  }
}
