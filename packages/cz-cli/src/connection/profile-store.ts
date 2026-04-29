import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import { DEFAULT_CONNECTION, type ConnectionConfig } from "@clickzetta/sdk"

const PROFILES_DIR = join(homedir(), ".clickzetta")
const PROFILES_FILE = join(PROFILES_DIR, "profiles.toml")

export type ProfileEntry = Record<string, unknown>

export function loadProfiles(): Record<string, ProfileEntry> {
  try {
    const text = readFileSync(PROFILES_FILE, "utf-8")
    const data = parseTOML(text)
    const profiles = data.profiles
    if (profiles && typeof profiles === "object" && !Array.isArray(profiles)) {
      return profiles as Record<string, ProfileEntry>
    }
    return {}
  } catch {
    return {}
  }
}

export function saveProfiles(profiles: Record<string, ProfileEntry>): void {
  let existing: Record<string, unknown> = {}
  try {
    const text = readFileSync(PROFILES_FILE, "utf-8")
    existing = parseTOML(text) as Record<string, unknown>
  } catch {
    // file doesn't exist or is invalid — start fresh
  }

  existing.profiles = profiles
  const content = stringifyTOML(existing)

  const dir = dirname(PROFILES_FILE)
  mkdirSync(dir, { recursive: true })

  const tmpFile = PROFILES_FILE + ".tmp." + Date.now()
  writeFileSync(tmpFile, content, "utf-8")
  renameSync(tmpFile, PROFILES_FILE)
}

export function getDefaultProfileName(): string | undefined {
  try {
    const text = readFileSync(PROFILES_FILE, "utf-8")
    const data = parseTOML(text)
    const name = data.default_profile
    return typeof name === "string" ? name : undefined
  } catch {
    return undefined
  }
}

export function getProfileConfig(profileName?: string): Partial<ConnectionConfig> | undefined {
  const profiles = loadProfiles()
  if (Object.keys(profiles).length === 0) return undefined

  let profileData: ProfileEntry | undefined
  if (profileName) {
    profileData = profiles[profileName]
  } else {
    const defaultName = getDefaultProfileName()
    if (defaultName) {
      profileData = profiles[defaultName]
    } else {
      profileData = Object.values(profiles)[0]
    }
  }

  if (!profileData) return undefined

  const cfg: Partial<ConnectionConfig> = {
    pat: str(profileData.pat, ""),
    username: str(profileData.username, ""),
    password: str(profileData.password, ""),
    service: str(profileData.service, DEFAULT_CONNECTION.service),
    protocol: normalizeProtocol(str(profileData.protocol, undefined)),
    instance: str(profileData.instance, ""),
    workspace: str(profileData.workspace, ""),
    schema: str(profileData.schema, DEFAULT_CONNECTION.schema),
    vcluster: str(profileData.vcluster, DEFAULT_CONNECTION.vcluster),
  }

  const headers: Record<string, string> = {}
  const raw = profileData.header
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      headers[String(k)] = String(v)
    }
  }
  for (const [k, v] of Object.entries(profileData)) {
    if (k.toLowerCase().startsWith("header.") && k.length > 7) {
      headers[k.slice(7)] = String(v)
    }
  }
  if (Object.keys(headers).length > 0) {
    cfg.customHeaders = headers
  }

  return cfg
}

function str(val: unknown, fallback: string): string
function str(val: unknown, fallback: undefined): string | undefined
function str(val: unknown, fallback: string | undefined): string | undefined {
  if (typeof val === "string") return val
  return fallback
}

function normalizeProtocol(value?: string): string {
  if (!value) return "https"
  const lower = value.toLowerCase().replace(/:\/\/$/, "")
  if (lower === "http") return "http"
  return "https"
}
