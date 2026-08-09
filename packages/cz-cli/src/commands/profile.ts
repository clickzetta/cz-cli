import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import { spawnSync } from "node:child_process"
import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import { JobStatus } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { loadProfiles, saveProfiles, getDefaultProfileName, type ProfileEntry } from "../connection/profile-store.js"
import { parseJdbcUrl } from "../connection/jdbc.js"
import { registerBootstrapCommands } from "./profile-bootstrap.js"
import { getExecContext, execSql, isQueryResult } from "./exec.js"
import { accountLoginUrlForService } from "./account-login.js"
import { browserOpenCommandForPlatform } from "./setup.js"
import { VERSION } from "../version.js"

function profilesDir() {
  return join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta")
}

function profilesFile() {
  return join(profilesDir(), "profiles.toml")
}

const VALID_UPDATE_KEYS = [
  "pat", "username", "password", "service", "protocol",
  "instance", "workspace", "schema", "vcluster",
  "analysis_agent_endpoint",
]

function loadFullFile(): Record<string, unknown> {
  try {
    const text = readFileSync(profilesFile(), "utf-8")
    return parseTOML(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

function saveFullFile(data: Record<string, unknown>): void {
  const file = profilesFile()
  mkdirSync(profilesDir(), { recursive: true })
  const content = stringifyTOML(data)
  const tmp = file + ".tmp." + Date.now()
  writeFileSync(tmp, content, "utf-8")
  renameSync(tmp, file)
}

function maskSecret(val: string, prefixLen = 8): string {
  if (!val) return ""
  return val.length > prefixLen ? val.slice(0, prefixLen) + "****" : "****"
}

function maskProfileSecrets(profile: Record<string, unknown>): Record<string, unknown> {
  const result = { ...profile }
  if (result.pat) result.pat = maskSecret(String(result.pat))
  if (result.password) result.password = "******"
  if (result.header && typeof result.header === "object" && !Array.isArray(result.header)) {
    result.header = Object.fromEntries(
      Object.entries(result.header as Record<string, unknown>).map(([key, value]) =>
        key.toLowerCase() === "cookie" ? [key, maskSecret(String(value), 16)] : [key, value],
      ),
    )
  }
  return result
}

function hasCookieTokenHeader(headers: string[] | undefined): boolean {
  return headers?.some((header) => {
    const separator = header.indexOf("=")
    if (separator <= 0) return false
    if (header.slice(0, separator).trim().toLowerCase() !== "cookie") return false
    return header
      .slice(separator + 1)
      .split(";")
      .some((cookie) => {
        const cookieSeparator = cookie.indexOf("=")
        return cookieSeparator > 0
          && cookie.slice(0, cookieSeparator).trim().toLowerCase() === "x-clickzetta-token"
          && cookie.slice(cookieSeparator + 1).trim().length > 0
      })
  }) ?? false
}

function selectedProfile(data: Record<string, unknown>, explicitName?: string): { name: string; profile: ProfileEntry } | undefined {
  const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
  if (explicitName) {
    const profile = profiles[explicitName]
    if (!profile) return
    return { name: explicitName, profile }
  }
  const defaultName = typeof data.default_profile === "string" ? data.default_profile : getDefaultProfileName()
  if (defaultName && profiles[defaultName]) {
    return { name: defaultName, profile: profiles[defaultName] }
  }
  const first = Object.entries(profiles)[0]
  if (!first) return
  return { name: first[0], profile: first[1] }
}

function cachedTenantName(profile: ProfileEntry): string {
  return String(profile.tenant_name ?? profile.account_display_name ?? "").trim()
}

async function resolveTenantNameRemotely(profile: ProfileEntry): Promise<{ tenantName: string; source: string }> {
  const service = String(profile.service ?? "").trim()
  const protocol = String(profile.protocol ?? "https").trim() || "https"
  const instance = String(profile.instance ?? "").trim()
  const pat = String(profile.pat ?? "").trim()
  const username = String(profile.username ?? "").trim()
  const password = String(profile.password ?? "").trim()
  if (!service || !instance) throw new Error("profile service and instance are required to resolve tenant name")
  if (!pat && !(username && password)) {
    throw new Error("profile must contain PAT or username/password to resolve tenant name")
  }
  const { getCurrentUser, getToken, toServiceUrl } = await import("@clickzetta/sdk")
  const baseUrl = toServiceUrl(service, protocol)
  const token = await getToken({
    pat,
    username,
    password,
    service,
    protocol,
    instance,
    workspace: String(profile.workspace ?? ""),
    schema: String(profile.schema ?? "public"),
    vcluster: String(profile.vcluster ?? "default"),
  })
  const user = await getCurrentUser(baseUrl, token.token)
  const tenantName = String(user.accountDisplayName ?? "").trim()
  if (!tenantName) throw new Error("accountDisplayName not found from current user")
  return { tenantName, source: pat ? "resolved_pat" : "resolved_password" }
}

function openBrowserBestEffort(url: string): boolean {
  const opener = browserOpenCommandForPlatform(process.platform, url)
  try {
    const result = spawnSync(opener.command, opener.args, { stdio: "ignore" })
    return !result.error && (result.status ?? 0) === 0
  } catch {
    return false
  }
}

export function registerProfileCommand(cli: Argv<GlobalArgs>): void {
  cli.command("profile", "Manage connection profiles", (yargs) => {
    yargs
      .command(
        "list",
        "List all profiles",
        (y) => y.option("show-secret", { type: "boolean", default: false, describe: "Reveal secrets" }),
        (argv) => {
          const format = argv.format_explicit ? argv.format : "table"
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
                username: String(p.username ?? ""),
                service: String(p.service ?? ""),
                protocol: String(p.protocol ?? "https"),
                instance: String(p.instance ?? ""),
                workspace: String(p.workspace ?? ""),
                is_default: name === defaultProfile,
              }
              if (typeof p.analysis_agent_endpoint === "string") {
                entry.analysis_agent_endpoint = p.analysis_agent_endpoint
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
            if (!argv["show-secret"]) Object.assign(result, maskProfileSecrets(result))
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
            .option("analysis-agent-endpoint", { type: "string", describe: "Analysis agent endpoint" })
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
            let jdbcCfg: Partial<import("@clickzetta/sdk").ConnectionConfig> | undefined
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
            const headerAuth = hasCookieTokenHeader(argv.header as string[] | undefined)
            if (hasPat && (resolvedUsername || resolvedPassword)) {
              return error("INVALID_ARGUMENTS", "Cannot specify both --pat and --username/--password.", { format, exitCode: 2 })
            }
            if (!hasPat && !hasUserPwd && !headerAuth) {
              return error("INVALID_ARGUMENTS", "Provide either --pat, both --username and --password, or --header Cookie=...", { format, exitCode: 2 })
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
              ...(argv["analysis-agent-endpoint"] ? { analysis_agent_endpoint: argv["analysis-agent-endpoint"] } : {}),
            }
            if (hasPat) {
              profileObj.pat = argv.pat!
            } else if (hasUserPwd) {
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
            if (!argv["skip-verify"] && !headerAuth) {
              try {
                const verifyCfg: import("@clickzetta/sdk").ConnectionConfig = {
                  pat: String(profileObj.pat ?? ""),
                  username: String(profileObj.username ?? ""),
                  password: String(profileObj.password ?? ""),
                  service: String(profileObj.service ?? "dev-api.clickzetta.com"),
                  protocol: String(profileObj.protocol ?? "https"),
                  instance: String(profileObj.instance ?? ""),
                  workspace: String(profileObj.workspace ?? ""),
                  schema: String(profileObj.schema ?? "public"),
                  vcluster: String(profileObj.vcluster ?? "default"),
                }
                const { getToken: getTokenSdk, toServiceUrl: toSvcUrl } = await import("@clickzetta/sdk")
                const token = await getTokenSdk(verifyCfg)
                const clientOpts = {
                  baseUrl: toSvcUrl(verifyCfg.service, verifyCfg.protocol),
                  token: token.token,
                  customHeaders: { instanceName: verifyCfg.instance },
                }
                const r = await execSql({ config: verifyCfg, token, clientOpts }, "SELECT 1", { timeoutMs: 30000 })
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
        "login-url [name]",
        "Show the web login URL for a profile",
        (y) =>
          y
            .positional("name", { type: "string", describe: "Profile name (defaults to default_profile)" })
            .option("tenant-name", { type: "string", describe: "Explicit tenant/account display name" })
            .option("resolve", { type: "boolean", default: false, describe: "Resolve tenant name remotely; use --no-resolve to disable" })
            .option("open", { type: "boolean", default: false, describe: "Open the login URL in the system browser" }),
        async (argv) => {
          const format = argv.format
          try {
            const data = loadFullFile()
            const selected = selectedProfile(data, argv.name as string | undefined)
            if (!selected) {
              return error("PROFILE_NOT_FOUND", argv.name ? `Profile '${argv.name}' not found` : "No profile found", { format })
            }
            const service = String(selected.profile.service ?? "").trim()
            const protocol = String(selected.profile.protocol ?? "https").trim() || "https"
            const normalizedService = service ? (await import("@clickzetta/sdk")).toServiceUrl(service, protocol) : ""
            let tenantName = String(argv["tenant-name"] ?? "").trim()
            let tenantNameSource = tenantName ? "arg" : ""
            if (!tenantName) {
              tenantName = cachedTenantName(selected.profile)
              tenantNameSource = tenantName ? "profile" : ""
            }
            if (!tenantName && argv.resolve) {
              const resolved = await resolveTenantNameRemotely(selected.profile)
              tenantName = resolved.tenantName
              tenantNameSource = resolved.source
            }
            if (!tenantName) {
              return error("TENANT_NAME_REQUIRED", "Tenant name is unavailable. Pass --tenant-name or enable --resolve.", { format })
            }
            const webLoginUrl = accountLoginUrlForService(normalizedService || service, tenantName)
            const opened = argv.open ? openBrowserBestEffort(webLoginUrl) : false
            logOperation("profile login-url", { ok: true })
            success({
              profile: selected.name,
              service: normalizedService || service,
              instance: String(selected.profile.instance ?? ""),
              tenant_name: tenantName,
              tenant_name_source: tenantNameSource,
              web_login_url: webLoginUrl,
              opened,
            }, { format })
          } catch (err) {
            error("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "update <name> <key> <value>",
        `Update a profile field. Valid keys: pat, username, password, service, protocol, instance, workspace, schema, vcluster, analysis_agent_endpoint, header.<NAME>`,
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true, describe: "Profile name" })
            .positional("key", { type: "string", demandOption: true, describe: "Field to update: pat | username | password | service | protocol | instance | workspace | schema | vcluster | analysis_agent_endpoint | header.<NAME>" })
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
            if (data.default_profile === name) {
              const remaining = Object.keys(profiles)
              if (remaining.length > 0) data.default_profile = remaining[0]
              else delete data.default_profile
            }
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
              const verifyCfg: import("@clickzetta/sdk").ConnectionConfig = {
                pat: String(profileObj.pat ?? ""),
                username: "",
                password: "",
                service: String(profileObj.service ?? "dev-api.clickzetta.com"),
                protocol: String(profileObj.protocol ?? "https"),
                instance: String(profileObj.instance ?? ""),
                workspace: String(profileObj.workspace ?? ""),
                schema: String(profileObj.schema ?? "public"),
                vcluster: String(profileObj.vcluster ?? "default"),
              }
              const { getToken: getTokenSdk, toServiceUrl: toSvcUrl } = await import("@clickzetta/sdk")
              const token = await getTokenSdk(verifyCfg)
              const clientOpts = {
                baseUrl: toSvcUrl(verifyCfg.service, verifyCfg.protocol),
                token: token.token,
                customHeaders: { instanceName: verifyCfg.instance },
              }
              const r = await execSql({ config: verifyCfg, token, clientOpts }, "SELECT 1", { timeoutMs: 30000 })
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
