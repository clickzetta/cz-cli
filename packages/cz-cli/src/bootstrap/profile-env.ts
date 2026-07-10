import fs from "fs"
import os from "os"
import path from "path"
import { parse as parseToml } from "smol-toml"

const PROFILE_ENV = {
  pat: "CZ_PAT",
  username: "CZ_USERNAME",
  password: "CZ_PASSWORD",
  service: "CZ_SERVICE",
  protocol: "CZ_PROTOCOL",
  instance: "CZ_INSTANCE",
  workspace: "CZ_WORKSPACE",
  schema: "CZ_SCHEMA",
  vcluster: "CZ_VCLUSTER",
  accounts_url: "CZ_ACCOUNTS_URL",
} as const

export function applyClickZettaProfile(profile?: string) {
  try {
    const profilesPath = path.join(process.env.CLICKZETTA_TEST_HOME || os.homedir(), ".clickzetta", "profiles.toml")
    const toml = parseToml(fs.readFileSync(profilesPath, "utf-8")) as Record<string, unknown>
    const target = profile ?? (typeof toml.default_profile === "string" ? toml.default_profile : undefined)
    if (!target) return
    process.env.CZ_PROFILE = target
    const profiles = toml.profiles as Record<string, Partial<Record<keyof typeof PROFILE_ENV, string>>> | undefined
    const entry = profiles?.[target]
    if (!entry) return
    Object.entries(PROFILE_ENV).forEach(([field, envName]) => {
      const value = entry[field as keyof typeof PROFILE_ENV]
      if (value) process.env[envName] = value
    })
  } catch {}
}
