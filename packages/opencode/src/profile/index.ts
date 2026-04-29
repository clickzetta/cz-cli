import fs from "fs"
import os from "os"
import path from "path"
import { parse, stringify } from "smol-toml"
import { execFileSync } from "child_process"

const PROFILES_DIR = path.join(os.homedir(), ".clickzetta")
const PROFILES_PATH = path.join(PROFILES_DIR, "profiles.toml")

export interface Profile {
  username?: string
  password?: string
  pat?: string
  service?: string
  protocol?: string
  instance?: string
  workspace?: string
  schema?: string
  vcluster?: string
}

interface ProfilesData {
  default_profile?: string
  profiles: Record<string, Profile>
}

const VALID_KEYS = ["pat", "username", "password", "service", "protocol", "instance", "workspace", "schema", "vcluster"]
const SECRET_KEYS = ["password", "pat"]

export function loadProfiles(): ProfilesData {
  if (!fs.existsSync(PROFILES_PATH)) {
    return { profiles: {} }
  }
  const raw = fs.readFileSync(PROFILES_PATH, "utf-8")
  const data = parse(raw) as any
  const profiles = data.profiles ?? {}
  let defaultProfile = data.default_profile
  if (defaultProfile && !profiles[defaultProfile]) {
    const keys = Object.keys(profiles)
    defaultProfile = keys[0]
  }
  return { default_profile: defaultProfile, profiles }
}

function saveProfiles(data: ProfilesData): void {
  fs.mkdirSync(PROFILES_DIR, { recursive: true })
  const tmp = PROFILES_PATH + ".tmp"
  fs.writeFileSync(tmp, stringify({ default_profile: data.default_profile ?? "", profiles: data.profiles } as any))
  fs.renameSync(tmp, PROFILES_PATH)
}

export function listProfiles(showSecret = false): { default_profile?: string; profiles: Record<string, Profile> } {
  const data = loadProfiles()
  if (!showSecret) {
    for (const p of Object.values(data.profiles)) {
      redactSecrets(p)
    }
  }
  return data
}

export function getProfile(name: string, showSecret = false): Profile | undefined {
  const data = loadProfiles()
  const p = data.profiles[name]
  if (p && !showSecret) redactSecrets(p)
  return p
}

export function getDefaultProfile(): { name: string; profile: Profile } | undefined {
  const data = loadProfiles()
  if (!data.default_profile || !data.profiles[data.default_profile]) return undefined
  return { name: data.default_profile, profile: data.profiles[data.default_profile] }
}

export function createProfile(name: string, opts: Profile & { jdbc?: string; skipVerify?: boolean }): void {
  const data = loadProfiles()
  if (data.profiles[name]) {
    throw new Error(`Profile "${name}" already exists`)
  }
  const profile = opts.jdbc ? parseJdbc(opts.jdbc) : buildProfile(opts)

  if (!opts.skipVerify) {
    verifyConnection(profile)
  }

  data.profiles[name] = profile
  if (!data.default_profile) data.default_profile = name
  saveProfiles(data)
}

export function deleteProfile(name: string): void {
  const data = loadProfiles()
  if (!data.profiles[name]) {
    throw new Error(`Profile "${name}" not found`)
  }
  delete data.profiles[name]
  const remaining = Object.keys(data.profiles)
  if (!data.default_profile || !data.profiles[data.default_profile]) {
    data.default_profile = remaining[0]
  }
  saveProfiles(data)
}

export function useProfile(name: string): void {
  const data = loadProfiles()
  if (!data.profiles[name]) {
    throw new Error(`Profile "${name}" not found`)
  }
  data.default_profile = name
  saveProfiles(data)
}

export function updateProfile(name: string, key: string, value: string): void {
  const data = loadProfiles()
  if (!data.profiles[name]) {
    throw new Error(`Profile "${name}" not found`)
  }
  if (!VALID_KEYS.includes(key)) {
    throw new Error(`Invalid key "${key}". Valid keys: ${VALID_KEYS.join(", ")}`)
  }
  if (key === "protocol" && value !== "http" && value !== "https") {
    throw new Error(`Protocol must be "http" or "https"`)
  }
  ;(data.profiles[name] as any)[key] = value
  saveProfiles(data)
}

function buildProfile(opts: Profile): Profile {
  const p: Profile = {}
  if (opts.pat) p.pat = opts.pat
  if (opts.username) p.username = opts.username
  if (opts.password) p.password = opts.password
  if (opts.service) p.service = opts.service
  if (opts.protocol) p.protocol = opts.protocol
  if (opts.instance) p.instance = opts.instance
  if (opts.workspace) p.workspace = opts.workspace
  if (opts.schema) p.schema = opts.schema
  if (opts.vcluster) p.vcluster = opts.vcluster
  return p
}

function parseJdbc(jdbc: string): Profile {
  const match = jdbc.match(/^jdbc:clickzetta:\/\/([^/]+)\/(\S+?)(?:\?(.*))?$/)
  if (!match) throw new Error("Invalid JDBC URL format")
  const hostPart = match[1]
  const workspace = match[2]
  const params = new URLSearchParams(match[3] || "")
  const dotIdx = hostPart.indexOf(".")
  const instance = dotIdx > 0 ? hostPart.substring(0, dotIdx) : hostPart
  const service = dotIdx > 0 ? hostPart.substring(dotIdx + 1) : undefined
  const p: Profile = { instance, workspace }
  if (service) p.service = service
  if (params.get("username") || params.get("user")) p.username = params.get("username") || params.get("user") || undefined
  if (params.get("password")) p.password = params.get("password") || undefined
  if (params.get("schema")) p.schema = params.get("schema") || undefined
  if (params.get("virtualCluster")) p.vcluster = params.get("virtualCluster") || undefined
  if (params.get("protocol")) p.protocol = params.get("protocol") || undefined
  return p
}

function redactSecrets(p: Profile): void {
  for (const key of SECRET_KEYS) {
    if ((p as any)[key]) (p as any)[key] = "****"
  }
}

function findCzCli(): string {
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "cz-cli"),
    "cz-cli",
  ]
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" })
      return c
    } catch {}
  }
  throw new Error("cz-cli not found. Cannot verify connection.")
}

function verifyConnection(profile: Profile): void {
  const czCli = findCzCli()
  const args = ["sql", "SELECT 1", "-o", "json"]
  if (profile.username) args.push("--username", profile.username)
  if (profile.password) args.push("--password", profile.password)
  if (profile.pat) args.push("--pat", profile.pat)
  if (profile.service) args.push("--service", profile.service)
  if (profile.protocol) args.push("--protocol", profile.protocol)
  if (profile.instance) args.push("--instance", profile.instance)
  if (profile.workspace) args.push("--workspace", profile.workspace)
  if (profile.vcluster) args.push("--vcluster", profile.vcluster)

  try {
    execFileSync(czCli, args, { stdio: "pipe", timeout: 30000 })
  } catch (e: any) {
    const stderr = e.stderr?.toString().trim() || e.message
    throw new Error(`Connection verification failed: ${stderr}`)
  }
}
