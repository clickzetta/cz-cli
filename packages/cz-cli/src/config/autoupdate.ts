export * as ConfigAutoupdate from "./autoupdate"

import os from "node:os"
import path from "node:path"
import { czConfigCandidates, parseCzConfigText } from "./cz-config"

export type Value = boolean | "notify"

type Input = { home?: string; env?: NodeJS.ProcessEnv }

export async function read(input: Input = {}) {
  const env = input.env ?? process.env
  const file = configPath(input)
  const config = await readObject(file, true)
  const configured = value(config.autoupdate) ?? await migrate(input)
  const override = environmentOverride(env)
  return {
    value: override?.value ?? configured ?? true,
    configured: configured ?? null,
    path: file,
    source: override?.source ?? (configured === undefined ? "default" : file),
    defaulted: configured === undefined && override === undefined,
    suppressed_by: suppression(env) ?? null,
  }
}

export async function write(autoupdate: Value, input: Input = {}) {
  const file = configPath(input)
  const config = await readObject(file, true)
  await Bun.write(file, JSON.stringify({ ...config, autoupdate }, null, 2) + "\n")
}

export function suppression(env: NodeJS.ProcessEnv = process.env) {
  const disabled = ["CLICKZETTA_SKIP_UPDATE_ONCE", "CLICKZETTA_DISABLE_AUTOUPDATE"]
    .find((key) => env[key] === "1")
  if (disabled) return disabled
  if (["1", "true", "yes"].includes((env.CZ_SKIP_UPDATE ?? "").trim().toLowerCase())) {
    return "CZ_SKIP_UPDATE"
  }
}

function environmentOverride(env: NodeJS.ProcessEnv): { value: Value; source: string } | undefined {
  if (["true", "false", "notify"].includes(env.CLICKZETTA_AUTOUPDATE ?? "")) {
    return {
      value: env.CLICKZETTA_AUTOUPDATE === "notify" ? "notify" : env.CLICKZETTA_AUTOUPDATE === "true",
      source: "CLICKZETTA_AUTOUPDATE",
    }
  }
}

function configPath(input: Input) {
  const env = input.env ?? process.env
  return path.join(input.home ?? env.CLICKZETTA_TEST_HOME ?? os.homedir(), ".clickzetta", "czcli.json")
}

function value(input: unknown) {
  return input === true || input === false || input === "notify" ? input : undefined
}

async function readObject(file: string, strict = false) {
  const text = await Bun.file(file).text().catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  return text === undefined ? {} : parseCzConfigText(text, { strict })
}

async function migrate(input: Input) {
  const env = input.env ?? process.env
  const home = input.home ?? env.CLICKZETTA_TEST_HOME ?? os.homedir()
  // Only consult legacy locations when the canonical file has no preference.
  // Preserve their former precedence once, then stop reading them on later runs.
  // This includes upstream opencode's system/MDM sources deliberately: cz-cli
  // owns this preference in one user file, not a live upstream policy hierarchy.
  const { ConfigManaged } = await import("opencode/config/managed")
  const managed = env.CLICKZETTA_TEST_MANAGED_CONFIG_DIR ?? ConfigManaged.managedConfigDir()
  const files = [
    path.join(env.XDG_STATE_HOME ?? path.join(home, ".local", "state"), "clickzetta", "update-check.json"),
    ...czConfigCandidates(home, env).slice(1),
    path.join(managed, "opencode.json"),
    path.join(managed, "opencode.jsonc"),
  ]
  const preferences = await Promise.all(files.map(async (file) => value((await readObject(file)).autoupdate)))
  const mobile = await ConfigManaged.readManagedPreferences().catch(() => undefined)
  const migrated = (mobile ? value(parseCzConfigText(mobile.text).autoupdate) : undefined)
    ?? preferences.findLast((item) => item !== undefined)
  if (migrated !== undefined) await write(migrated, input)
  return migrated
}
