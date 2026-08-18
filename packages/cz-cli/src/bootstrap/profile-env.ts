import fs from "fs"
import os from "os"
import path from "path"
import { parse as parseToml } from "smol-toml"
import { ConnectionEnv } from "../connection/env.js"

/** profiles.toml field → the `CZ_*` field it travels as. */
const FIELDS = {
  pat: "pat",
  username: "username",
  password: "password",
  service: "service",
  protocol: "protocol",
  instance: "instance",
  workspace: "workspace",
  schema: "schema",
  vcluster: "vcluster",
  accounts_url: "accountsUrl",
} as const satisfies Record<string, ConnectionEnv.Field>

/**
 * Expand a profile into the `CZ_*` layer this process (and its children) read.
 *
 * Runs more than once per process — `mcp serve` applies a per-call profile — so
 * the previous profile's values must not survive the switch. That reset lives in
 * ConnectionEnv.apply, which replaces the derived layer wholesale and leaves the
 * user's own variables alone; this function only decides WHAT to expand.
 */
export function applyClickZettaProfile(profile?: string) {
  const file = path.join(process.env.CLICKZETTA_TEST_HOME || os.homedir(), ".clickzetta", "profiles.toml")
  const toml = readProfiles(file)
  const target = profile ?? (typeof toml?.default_profile === "string" ? toml.default_profile : undefined)
  if (!target) return

  const profiles = toml?.profiles as Record<string, Record<string, unknown>> | undefined
  const entry = profiles?.[target]
  const fields: ConnectionEnv.Fields = {}
  for (const [key, field] of Object.entries(FIELDS)) {
    const value = entry?.[key]
    if (typeof value === "string" && value.length > 0) fields[field] = value
  }
  ConnectionEnv.apply(fields, target)
}

function readProfiles(file: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(file)) return undefined
  // A hand-edited profiles.toml can be syntactically broken. Every other reader
  // (loadProfiles, the token store) degrades to "no profiles" rather than taking
  // the CLI down, and this runs on the startup path, so it does the same.
  try {
    return parseToml(fs.readFileSync(file, "utf-8")) as Record<string, unknown>
  } catch {
    return undefined
  }
}
