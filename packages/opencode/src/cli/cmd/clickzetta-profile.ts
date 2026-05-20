import fs from "fs"
import os from "os"
import path from "path"
import { parse as parseToml } from "smol-toml"

export function applyClickZettaProfile(profile?: string) {
  if (!profile) return
  process.env.CZ_PROFILE = profile
  try {
    const profilesPath = path.join(process.env.CLICKZETTA_TEST_HOME || os.homedir(), ".clickzetta", "profiles.toml")
    const toml = parseToml(fs.readFileSync(profilesPath, "utf-8")) as Record<string, unknown>
    const profiles = toml.profiles as Record<string, Record<string, string>> | undefined
    const entry = profiles?.[profile]
    if (!entry) return
    if (entry.pat) process.env.CZ_PAT = entry.pat
    if (entry.username) process.env.CZ_USERNAME = entry.username
    if (entry.password) process.env.CZ_PASSWORD = entry.password
    if (entry.service) process.env.CZ_SERVICE = entry.service
    if (entry.protocol) process.env.CZ_PROTOCOL = entry.protocol
    if (entry.instance) process.env.CZ_INSTANCE = entry.instance
    if (entry.workspace) process.env.CZ_WORKSPACE = entry.workspace
    if (entry.schema) process.env.CZ_SCHEMA = entry.schema
    if (entry.vcluster) process.env.CZ_VCLUSTER = entry.vcluster
  } catch {}
}
