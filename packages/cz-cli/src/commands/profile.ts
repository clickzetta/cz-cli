import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import { JobStatus } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { loadProfiles, saveProfiles, getDefaultProfileName, type ProfileEntry } from "../connection/profile-store.js"
import { registerBootstrapCommands } from "./profile-bootstrap.js"
import { getExecContext, execSql, isQueryResult } from "./exec.js"
import { VERSION } from "../version.js"

const PROFILES_DIR = join(homedir(), ".clickzetta")
const PROFILES_FILE = join(PROFILES_DIR, "profiles.toml")

interface JdbcConfig {
  instance: string
  service: string
  workspace: string
  username?: string
  password?: string
  schema?: string
  vcluster?: string
  protocol?: string
}

function parseJdbcUrl(jdbc: string): JdbcConfig | undefined {
  if (!jdbc.startsWith("jdbc:clickzetta://")) return undefined
  try {
    const url = new URL(jdbc.slice(5))
    const host = url.hostname
    if (!host) return undefined
    const parts = host.split(".")
    if (parts.length < 4) return undefined
    const params = url.searchParams
    const ws = url.pathname.replace(/^\//, "") || params.get("workspace") || ""
    const cfg: JdbcConfig = {
      instance: parts[0],
      service: parts.slice(1).join("."),
      workspace: ws,
    }
    if (params.has("username")) cfg.username = params.get("username")!
    if (params.has("password")) cfg.password = params.get("password")!
    if (params.has("schema")) cfg.schema = params.get("schema")!
    if (params.has("virtualCluster")) cfg.vcluster = params.get("virtualCluster")!
    if (params.has("protocol")) {
      const p = params.get("protocol")!.toLowerCase()
      cfg.protocol = p === "http" ? "http" : "https"
    }
    return cfg
  } catch {
    return undefined
  }
}

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
  cli.command("profile", "Manage connection profiles", (yargs) => {
    yargs
      .command(
        "list",
        "List all profiles",
        (y) => y.option("show-secret", { type: "boolean", default: false, describe: "Reveal secrets" }),
        (argv) => {
          const format = argv.format
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
              const agent = (p as Record<string, unknown>).agent as Record<string, unknown> | undefined
              if (agent) {
                const agentToken = String(agent.token ?? "")
                entry.agent = {
                  endpoint: agent.endpoint ?? "",
                  token: argv["show-secret"] ? agentToken : (agentToken.length > 8 ? agentToken.slice(0, 8) + "****" : "****"),
                  user_id: agent.user_id ?? "",
                  tenant_id: agent.tenant_id ?? "",
                  instance_id: agent.instance_id ?? "",
                }
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
        ["detail <name>", "show <name>"],
        "Show full config for a profile",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .option("show-secret", { type: "boolean", default: false, describe: "Reveal secrets" }),
        (argv) => {
          const format = argv.format
          try {
            const data = loadFullFile()
            const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
            const defaultProfile = data.default_profile as string | undefined
            const profile = profiles[argv.name as string]
            if (!profile) {
              return error("PROFILE_NOT_FOUND", `Profile '${argv.name}' not found`, { format })
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
            .option("jdbc", { type: "string", describe: "JDBC connection URL (jdbc:clickzetta://...)" })
            .option("pat", { type: "string", describe: "Personal Access Token" })
            .option("username", { type: "string", describe: "Username" })
            .option("password", { type: "string", describe: "Password" })
            .option("service", { type: "string", describe: "Service endpoint" })
            .option("protocol", { type: "string", choices: ["https", "http"] as const, describe: "Protocol" })
            .option("instance", { type: "string", describe: "Instance name" })
            .option("workspace", { type: "string", describe: "Workspace name" })
            .option("schema", { type: "string", describe: "Default schema" })
            .option("vcluster", { type: "string", describe: "Virtual cluster" })
            .option("header", { type: "string", array: true, describe: "Custom HTTP header KEY=VALUE (repeatable)" })
            .option("skip-verify", { type: "boolean", default: false, describe: "Skip connection verification" }),
        async (argv) => {
          const format = argv.format
          try {
            const data = loadFullFile()
            const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
            const name = argv.name as string
            if (profiles[name]) {
              return error("PROFILE_EXISTS", `Profile '${name}' already exists`, { format })
            }
            let jdbcCfg: JdbcConfig | undefined
            if (argv.jdbc) {
              jdbcCfg = parseJdbcUrl(argv.jdbc)
              if (!jdbcCfg) {
                return error("INVALID_ARGUMENTS", "Invalid --jdbc. Expected: jdbc:clickzetta://<instance>.<service>/<workspace>?username=<u>&password=<p>", { format, exitCode: 2 })
              }
            }
            const resolvedUsername = argv.username ?? jdbcCfg?.username
            const resolvedPassword = argv.password ?? jdbcCfg?.password
            const hasPat = Boolean(argv.pat)
            const hasUserPwd = Boolean(resolvedUsername && resolvedPassword)
            if (hasPat && (resolvedUsername || resolvedPassword)) {
              return error("INVALID_ARGUMENTS", "Cannot specify both --pat and --username/--password.", { format, exitCode: 2 })
            }
            if (!hasPat && !hasUserPwd) {
              return error("INVALID_ARGUMENTS", "Provide either --pat or both --username and --password.", { format, exitCode: 2 })
            }
            const inst = argv.instance ?? jdbcCfg?.instance ?? ""
            const ws = argv.workspace ?? jdbcCfg?.workspace ?? ""
            if (!inst || !ws) {
              return error("INVALID_ARGUMENTS", "Both --instance and --workspace are required.", { format, exitCode: 2 })
            }
            const profileObj: ProfileEntry = {
              service: argv.service ?? jdbcCfg?.service ?? "dev-api.clickzetta.com",
              protocol: argv.protocol ?? jdbcCfg?.protocol ?? "https",
              instance: inst,
              workspace: ws,
              schema: argv.schema ?? jdbcCfg?.schema ?? "public",
              vcluster: argv.vcluster ?? jdbcCfg?.vcluster ?? "default",
            }
            if (hasPat) {
              profileObj.pat = argv.pat!
            } else {
              profileObj.username = resolvedUsername!
              profileObj.password = resolvedPassword!
            }
            if (argv.header) {
              const headerDict: Record<string, string> = {}
              for (const h of argv.header as string[]) {
                if (h.includes("=")) {
                  const [hk, ...rest] = h.split("=")
                  headerDict[hk.trim()] = rest.join("=").trim()
                }
              }
              if (Object.keys(headerDict).length > 0) {
                profileObj.header = headerDict
              }
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
                  return error("CONNECTION_FAILED", `Verification failed: ${r.errorMessage ?? "Query failed"}`, { format })
                }
              } catch (err) {
                return error("CONNECTION_FAILED", `Failed to connect: ${err instanceof Error ? err.message : String(err)}`, { format })
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
        `Update a profile field. Valid keys: pat, username, password, service, protocol, instance, workspace, schema, vcluster, header.<NAME>`,
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true, describe: "Profile name" })
            .positional("key", { type: "string", demandOption: true, describe: "Field to update: pat | username | password | service | protocol | instance | workspace | schema | vcluster | header.<NAME>" })
            .positional("value", { type: "string", demandOption: true, describe: "New value" }),
        (argv) => {
          const format = argv.format
          try {
            const data = loadFullFile()
            const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
            const name = argv.name as string
            const key = argv.key as string
            const value = argv.value as string
            if (!profiles[name]) {
              return error("PROFILE_NOT_FOUND", `Profile '${name}' not found`, { format })
            }
            if (!VALID_UPDATE_KEYS.includes(key) && !key.startsWith("header.")) {
              return error("INVALID_KEY", `Invalid key '${key}'. Valid: ${VALID_UPDATE_KEYS.join(", ")}, header.<NAME>`, { format })
            }
            if (key === "protocol" && !["http", "https"].includes(value.toLowerCase())) {
              return error("INVALID_ARGUMENTS", "protocol must be http or https", { format })
            }
            if (key.startsWith("header.")) {
              const headerName = key.slice(7)
              // Store headers as a nested "header" dict (matching Python behavior)
              const headerDict = (profiles[name].header ?? {}) as Record<string, string>
              if (value === "") {
                // Empty value deletes the header key (matching Python behavior)
                delete headerDict[headerName]
              } else {
                headerDict[headerName] = value
              }
              if (Object.keys(headerDict).length > 0) {
                profiles[name].header = headerDict
              } else {
                delete profiles[name].header
              }
              // Remove legacy flat header.X keys if present
              delete profiles[name][key]
            } else {
              profiles[name][key] = key === "protocol" ? value.toLowerCase() : value
            }
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
          const format = argv.format
          try {
            const data = loadFullFile()
            const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
            const name = argv.name as string
            if (!profiles[name]) {
              return error("PROFILE_NOT_FOUND", `Profile '${name}' not found`, { format })
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
          const format = argv.format
          try {
            const data = loadFullFile()
            const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
            const name = argv.name as string
            if (!profiles[name]) {
              return error("PROFILE_NOT_FOUND", `Profile '${name}' not found`, { format })
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
      .command(
        "status",
        "Show connection status",
        () => {},
        async (argv) => {
          const format = argv.format
          const info: Record<string, unknown> = { cli_version: VERSION }
          try {
            const ctx = await getExecContext(argv)
            try {
              const [wsR, schR] = await Promise.all([
                execSql(ctx, "SELECT current_workspace() AS workspace"),
                execSql(ctx, "SELECT current_schema() AS schema"),
              ])
              if (isQueryResult(wsR) && wsR.status === JobStatus.SUCCEEDED && wsR.rows.length > 0) {
                info.workspace = wsR.rows[0][0]
              }
              if (isQueryResult(schR) && schR.status === JobStatus.SUCCEEDED && schR.rows.length > 0) {
                info.schema = schR.rows[0][0]
              }
              info.connected = true
            } catch (connErr) {
              info.connected = false
              info.error = connErr instanceof Error ? connErr.message : String(connErr)
            }
          } catch (connErr) {
            info.connected = false
            info.error = connErr instanceof Error ? connErr.message : String(connErr)
          }
          logOperation("profile status", { ok: info.connected as boolean })
          success(info, { format })
        },
      )
      .command(
        "quickstart",
        "First-time onboarding: decode a Lakehouse credential string and create a profile",
        (y) =>
          y
            .option("credential", { type: "string", describe: "Base64-encoded credential string from Lakehouse registration" })
            .option("profile-name", { type: "string", default: "default", describe: "Profile name to create" })
            .option("skip-verify", { type: "boolean", default: false, describe: "Skip connection verification" }),
        async (argv) => {
          const format = argv.format
          const REGISTER_URLS = [
            "https://accounts.clickzetta.com/register?ref=cz-cli (China)",
            "https://accounts.singdata.com/register?ref=cz-cli (International)",
          ]
          if (!argv.credential) {
            return success({
              message: "No Lakehouse credential provided. Please register for an account first.",
              register_urls: REGISTER_URLS,
              next_step: "After registration you will receive a base64-encoded credential string. Run: cz-cli profile quickstart --credential <YOUR_CREDENTIAL_STRING>",
            }, { format })
          }
          let cred: Record<string, unknown>
          try {
            const decoded = Buffer.from(argv.credential as string, "base64").toString("utf-8")
            cred = JSON.parse(decoded) as Record<string, unknown>
          } catch (e) {
            return error("INVALID_CREDENTIAL", `Invalid base64 or JSON: ${e instanceof Error ? e.message : String(e)}`, { format })
          }
          const instanceName = cred!.instanceName as string | undefined
          const accessToken = cred!.accessToken as string | undefined
          if (!instanceName || !accessToken) {
            return error("INVALID_CREDENTIAL", "Missing required fields in credential: instanceName, accessToken", { format })
          }
          const profileName = argv["profile-name"] as string
          const data = loadFullFile()
          const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
          if (profiles[profileName]) {
            return error("PROFILE_EXISTS", `Profile '${profileName}' already exists. Use a different name or delete it first.`, { format })
          }
          const profileObj: ProfileEntry = {
            instance: instanceName!,
            workspace: (cred!.workspaceName as string) ?? "default",
            schema: (cred!.schema as string) ?? "public",
            vcluster: (cred!.virtualCluster as string) ?? "default",
            pat: accessToken!,
            service: (cred!.service as string) ?? "dev-api.clickzetta.com",
            protocol: (cred!.protocol as string) ?? "https",
          }
          if (!argv["skip-verify"]) {
            try {
              const ctx = await getExecContext({
                ...profileObj as Record<string, unknown>,
                pat: profileObj.pat as string | undefined,
                service: profileObj.service as string,
                instance: profileObj.instance as string,
                workspace: profileObj.workspace as string,
                schema: profileObj.schema as string,
                vcluster: profileObj.vcluster as string,
              })
              const r = await execSql(ctx, "SELECT 1", { timeoutMs: 30000 })
              if (isQueryResult(r) && r.status === JobStatus.FAILED) {
                return error("CONNECTION_FAILED", `Verification failed: ${r.errorMessage ?? "Query failed"}`, { format })
              }
            } catch (e) {
              return error("CONNECTION_FAILED", `Failed to connect: ${e instanceof Error ? e.message : String(e)}`, { format })
            }
          }
          profiles[profileName] = profileObj
          data.profiles = profiles
          if (Object.keys(profiles).length === 1) {
            data.default_profile = profileName
          }
          saveFullFile(data)
          logOperation("profile quickstart", { ok: true })
          success({
            message: `Profile '${profileName}' created successfully from credential string.`,
            profile_name: profileName,
            instance: instanceName,
            workspace: profileObj.workspace,
          }, { format })
        },
      )
    registerBootstrapCommands(yargs)
    return commandGroup(yargs, "profile")
  })
}
