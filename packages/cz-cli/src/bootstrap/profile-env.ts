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

// The credential env vars. These are mutually exclusive ALTERNATIVES (a profile
// authenticates by PAT *or* by username/password), so they must be cleared as a
// group when the active profile changes — unlike the non-auth vars, which are an
// independent override layer.
const CREDENTIAL_ENV = ["CZ_PAT", "CZ_USERNAME", "CZ_PASSWORD"] as const

// The credential values this module (or run-cli.ts) last wrote from a profile.
// A credential is cleared on a profile switch only when the live env still holds
// exactly that value — proof it is a leftover and not something the user set.
//
// Provenance is tracked by VALUE, not by a boolean flag: a flag is sticky for the
// life of the process, so after any profile had supplied a PAT, a subsequently
// user-set CZ_PAT would be wrongly cleared. Comparing values is self-healing.
// It is also not a "snapshot the env at import" scheme, because run-cli.ts expands
// --profile into CZ_* before this module is ever imported — such a baseline would
// already contain a profile's credential and mistake it for the user's own.
const lastWritten = new Map<string, string>()

/** Record credential values written from a profile, so a later switch can clear them. */
export function noteProfileDerivedCredentials(written: Record<string, string>) {
  for (const [name, value] of Object.entries(written)) lastWritten.set(name, value)
}

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
    // Reset the credential vars to their process-start values before applying the
    // target profile. The auth fields are mutually exclusive ALTERNATIVES, not
    // independent settings, and this function runs more than once per process
    // (mcp serve applies a per-call `profile`). Overwrite-only updates leaked them
    // across switches: going from a PAT profile to a username/password one kept
    // the stale CZ_PAT, which then won the auth priority in
    // resolveConnectionConfig() and authenticated as the PREVIOUS identity.
    //
    // Resetting to the baseline rather than deleting outright is what keeps a
    // genuinely user-supplied `CZ_PAT=… cz-cli agent` working: the baseline is the
    // env as it existed before any profile was applied, so a user's own credential
    // survives while a previous apply()'s leftovers do not.
    //
    // Only the auth trio is touched. The non-auth CZ_* vars are a legitimate
    // override layer that resolveConnectionConfig() applies ON TOP of the profile,
    // so `CZ_SCHEMA=x cz-cli agent` must keep working when the profile omits it.
    for (const envName of CREDENTIAL_ENV) {
      const written = lastWritten.get(envName)
      if (written !== undefined && process.env[envName] === written) {
        delete process.env[envName]
        lastWritten.delete(envName)
      }
    }
    Object.entries(PROFILE_ENV).forEach(([field, envName]) => {
      const value = entry[field as keyof typeof PROFILE_ENV]
      if (value) {
        process.env[envName] = value
        if ((CREDENTIAL_ENV as readonly string[]).includes(envName)) lastWritten.set(envName, value)
      }
    })
  } catch {}
}
