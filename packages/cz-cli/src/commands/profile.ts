import type { Argv } from "yargs"
import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import { JobStatus } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { loadProfiles, saveProfiles, getDefaultProfileName, type ProfileEntry } from "../connection/profile-store.js"
import { getExecContext, execSql, isQueryResult } from "./exec.js"

const PROFILES_DIR = join(homedir(), ".clickzetta")
const PROFILES_FILE = join(PROFILES_DIR, "profiles.toml")

const VALID_UPDATE_KEYS = [
  "pat", "username", "password", "service", "protocol",
  "instance", "workspace", "schema", "vcluster",
]

function loadFullFile(): Record<string, unknown> {
  try {
    const text = readFileSync(PROFILES_FILE, "utf-8")
    return parseTOML(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

function saveFullFile(data: Record<string, unknown>): void {
  mkdirSync(PROFILES_DIR, { recursive: true })
  const content = stringifyTOML(data)
  const tmp = PROFILES_FILE + ".tmp." + Date.now()
  writeFileSync(tmp, content, "utf-8")
  renameSync(tmp, PROFILES_FILE)
}

function maskSecret(val: string, prefixLen = 8): string {
  if (!val) return ""
  return val.length > prefixLen ? val.slice(0, prefixLen) + "****" : "****"
}

export function registerProfileCommand(cli: Argv<GlobalArgs>): void {
  cli.command("profile", "Manage connection profiles", (yargs) =>
    yargs
      .command(
        "list",
        "List all profiles",
        (y) => y.option("show-secret", { type: "boolean", default: false, describe: "Reveal secrets" }),
        (argv) => {
          const format = argv.output
          try {
            const data = loadFullFile()
            const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
            const defaultProfile = data.default_profile as string | undefined
            const result = Object.entries(profiles).map(([name, p]) => {
              const pat = String(p.pat ?? "")
              const entry: Record<string, unknown> = {
                name,
                auth_mode: pat ? "pat" : "password",
                pat: argv["show-secret"] ? pat : maskSecret(pat),
                username: pat ? "" : String(p.username ?? ""),
                service: String(p.service ?? ""),
                protocol: String(p.protocol ?? "https"),
                instance: String(p.instance ?? ""),
                workspace: String(p.workspace ?? ""),
                is_default: name === defaultProfile,
              }
              if (argv["show-secret"] && !pat && p.password) {
                entry.password = String(p.password)
              }
              return entry
            })
            logOperation("profile list", { ok: true })
            success(result, { format })
          } catch (err) {
            error("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "detail <name>",
        "Show full config for a profile",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .option("show-secret", { type: "boolean", default: false, describe: "Reveal secrets" }),
        (argv) => {
          const format = argv.output
          try {
            const data = loadFullFile()
            const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
            const defaultProfile = data.default_profile as string | undefined
            const profile = profiles[argv.name as string]
            if (!profile) {
              error("PROFILE_NOT_FOUND", `Profile '${argv.name}' not found`, { format })
            }
            const result: Record<string, unknown> = {
              name: argv.name,
              is_default: argv.name === defaultProfile,
              ...profile,
            }
            if (!argv["show-secret"]) {
              if (result.pat) result.pat = maskSecret(String(result.pat))
              if (result.password) result.password = "******"
            }
            logOperation("profile detail", { ok: true })
            success(result, { format })
          } catch (err) {
            error("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "create <name>",
        "Create a new profile",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .option("pat", { type: "string", describe: "Personal Access Token" })
            .option("username", { type: "string", describe: "Username" })
            .option("password", { type: "string", describe: "Password" })
            .option("service", { type: "string", describe: "Service endpoint" })
            .option("protocol", { type: "string", choices: ["https", "http"] as const, describe: "Protocol" })
            .option("instance", { type: "string", describe: "Instance name" })
            .option("workspace", { type: "string", describe: "Workspace name" })
            .option("schema", { type: "string", describe: "Default schema" })
            .option("vcluster", { type: "string", describe: "Virtual cluster" })
            .option("skip-verify", { type: "boolean", default: false, describe: "Skip connection verification" }),
        async (argv) => {
          const format = argv.output
          try {
            const data = loadFullFile()
            const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
            const name = argv.name as string
            if (profiles[name]) {
              error("PROFILE_EXISTS", `Profile '${name}' already exists`, { format })
            }
            const hasPat = Boolean(argv.pat)
            const hasUserPwd = Boolean(argv.username && argv.password)
            if (hasPat && (argv.username || argv.password)) {
              error("INVALID_ARGUMENTS", "Cannot specify both --pat and --username/--password.", { format, exitCode: 2 })
            }
            if (!hasPat && !hasUserPwd) {
              error("INVALID_ARGUMENTS", "Provide either --pat or both --username and --password.", { format, exitCode: 2 })
            }
            const inst = argv.instance ?? ""
            const ws = argv.workspace ?? ""
            if (!inst || !ws) {
              error("INVALID_ARGUMENTS", "Both --instance and --workspace are required.", { format, exitCode: 2 })
            }
            const profileObj: ProfileEntry = {
              service: argv.service ?? "dev-api.clickzetta.com",
              protocol: argv.protocol ?? "https",
              instance: inst,
              workspace: ws,
              schema: argv.schema ?? "public",
              vcluster: argv.vcluster ?? "default",
            }
            if (hasPat) {
              profileObj.pat = argv.pat!
            } else {
              profileObj.username = argv.username!
              profileObj.password = argv.password!
            }
            if (!argv["skip-verify"]) {
              try {
                const ctx = await getExecContext({
                  ...profileObj as Record<string, unknown>,
                  pat: profileObj.pat as string | undefined,
                  username: profileObj.username as string | undefined,
                  password: profileObj.password as string | undefined,
                  service: profileObj.service as string,
                  instance: profileObj.instance as string,
                  workspace: profileObj.workspace as string,
                  schema: profileObj.schema as string,
                  vcluster: profileObj.vcluster as string,
                })
                const r = await execSql(ctx, "SELECT 1", { timeoutMs: 30000 })
                if (isQueryResult(r) && r.status === JobStatus.FAILED) {
                  error("CONNECTION_FAILED", `Verification failed: ${r.errorMessage ?? "Query failed"}`, { format })
                }
              } catch (err) {
                error("CONNECTION_FAILED", `Failed to connect: ${err instanceof Error ? err.message : String(err)}`, { format })
              }
            }
            profiles[name] = profileObj
            data.profiles = profiles
            if (Object.keys(profiles).length === 1) {
              data.default_profile = name
            }
            saveFullFile(data)
            logOperation("profile create", { ok: true })
            success({ message: `Profile '${name}' created successfully` }, { format })
          } catch (err) {
            if ((err as { code?: string }).code === "EXIT") throw err
            error("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "update <name> <key> <value>",
        "Update a profile field",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .positional("key", { type: "string", demandOption: true })
            .positional("value", { type: "string", demandOption: true }),
        (argv) => {
          const format = argv.output
          try {
            const data = loadFullFile()
            const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
            const name = argv.name as string
            const key = argv.key as string
            const value = argv.value as string
            if (!profiles[name]) {
              error("PROFILE_NOT_FOUND", `Profile '${name}' not found`, { format })
            }
            if (!VALID_UPDATE_KEYS.includes(key) && !key.startsWith("header.")) {
              error("INVALID_KEY", `Invalid key '${key}'. Valid: ${VALID_UPDATE_KEYS.join(", ")}, header.<NAME>`, { format })
            }
            if (key === "protocol" && !["http", "https"].includes(value.toLowerCase())) {
              error("INVALID_ARGUMENTS", "protocol must be http or https", { format })
            }
            profiles[name][key] = key === "protocol" ? value.toLowerCase() : value
            if (key === "pat") {
              delete profiles[name].username
              delete profiles[name].password
            }
            if (key === "username" || key === "password") {
              delete profiles[name].pat
            }
            data.profiles = profiles
            saveFullFile(data)
            logOperation("profile update", { ok: true })
            success({ message: `Profile '${name}' updated successfully` }, { format })
          } catch (err) {
            error("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "delete <name>",
        "Delete a profile",
        (y) => y.positional("name", { type: "string", demandOption: true }),
        (argv) => {
          const format = argv.output
          try {
            const data = loadFullFile()
            const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
            const name = argv.name as string
            if (!profiles[name]) {
              error("PROFILE_NOT_FOUND", `Profile '${name}' not found`, { format })
            }
            delete profiles[name]
            data.profiles = profiles
            saveFullFile(data)
            logOperation("profile delete", { ok: true })
            success({ message: `Profile '${name}' deleted successfully` }, { format })
          } catch (err) {
            error("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "use <name>",
        "Set default profile",
        (y) => y.positional("name", { type: "string", demandOption: true }),
        (argv) => {
          const format = argv.output
          try {
            const data = loadFullFile()
            const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
            const name = argv.name as string
            if (!profiles[name]) {
              error("PROFILE_NOT_FOUND", `Profile '${name}' not found`, { format })
            }
            data.default_profile = name
            saveFullFile(data)
            logOperation("profile use", { ok: true })
            success({ message: `Profile '${name}' set as default` }, { format })
          } catch (err) {
            error("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .demandCommand(1, ""),
  )
}
