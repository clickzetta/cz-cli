import type { Argv } from "yargs"
import * as p from "@clack/prompts"
import { spawn } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import { JobStatus, getCurrentUser, DEFAULT_CONNECTION, getToken, listUserWorkspaces, loginWithPassword, toServiceUrl } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { setTelemetry, getTelemetry, type ProfileEntry, patchProfileUserId } from "../connection/profile-store.js"
import { parseJdbcUrl } from "../connection/jdbc.js"
import { execSql, isQueryResult } from "./exec.js"
import { accountLoginUrlForService, loginByAccountSite, stripProtocol } from "./account-login.js"
import { trackCommand, isSensitiveKey } from "../telemetry.js"

const setupStartMs = Date.now()

/** Returns the telemetry value — skips prompt if already configured. */
async function resolveTelemetry(): Promise<boolean> {
  const existing = getTelemetry()
  if (existing !== undefined) return existing
  const chosen = await askYesNo("Enable telemetry to help improve cz-cli? This shares LLM call traces and tool execution data. No code content is collected. (Y/n) ")
  setTelemetry(chosen)
  return chosen
}

function trackSetup(opts: {
  success: boolean
  error?: string
  telemetry?: boolean
  userId?: number
  collected?: Record<string, string | undefined>
  argv?: Record<string, unknown>
}): Promise<void> {
  const attrs: Record<string, string> = {}
  if (opts.userId) attrs["enduser.id"] = String(opts.userId)
  if (opts.collected?.instance) attrs["instance.name"] = opts.collected.instance
  if (opts.collected?.workspace) attrs["workspace.name"] = opts.collected.workspace
  if (opts.collected?.service) attrs["service.url"] = opts.collected.service

  const args: Record<string, string> = {}
  if (opts.argv) {
    for (const [k, v] of Object.entries(opts.argv)) {
      if (isSensitiveKey(k) || k.startsWith("$") || k === "_" || typeof v === "undefined") continue
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        args[k] = String(v)
      }
    }
  }
  if (opts.telemetry !== undefined) args["telemetry"] = String(opts.telemetry)

  return trackCommand({
    command: "setup",
    args: Object.keys(args).length > 0 ? args : undefined,
    duration_ms: Date.now() - setupStartMs,
    success: opts.success,
    error: opts.error,
    resourceAttributes: attrs,
  })
}

const REGISTER_URL_CLICKZETTA = "https://accounts.clickzetta.com/register?ref=cz-cli"

export const JDBC_EXAMPLE =
  "jdbc:clickzetta://00000000.cn-hangzhou-alicloud.api.clickzetta.com/workspace?username=<username>&password=<password>&schema=public&virtualCluster=DEFAULT"

export const SETUP_LOGIN_METHODS = [
  { label: "ClickZetta - https://accounts.clickzetta.com/login", value: "clickzetta" },
  { label: "Singdata  - https://accounts.singdata.com/login", value: "singdata" },
  { label: "Custom URL - Enter a login page URL or paste a JDBC connection string", value: "custom" },
] as const

const LOGIN_METHOD_URLS = {
  clickzetta: "https://accounts.clickzetta.com/login",
  singdata: "https://accounts.singdata.com/login",
} as const

const SERVICE_ENDPOINTS = [
  "cn-shanghai-alicloud.api.clickzetta.com",
  "cn-beijing-alicloud.api.clickzetta.com",
  "cn-hangzhou-alicloud.api.clickzetta.com",
  "ap-shanghai-tencentcloud.api.clickzetta.com",
  "ap-beijing-tencentcloud.api.clickzetta.com",
  "ap-guangzhou-tencentcloud.api.clickzetta.com",
  "cn-north-1-aws.api.clickzetta.com",
  "ap-southeast-1-alicloud.api.singdata.com",
  "ap-southeast-1-aws.api.singdata.com",
] as const

const OTHER_SERVICE = "__custom__"
const SETUP_FLOW = ["login_method", "credentials", "instance", "workspace", "schema", "vcluster", "complete"] as const
const PROFILES_DIR = join(homedir(), ".clickzetta")
const PROFILES_FILE = join(PROFILES_DIR, "profiles.toml")

type SetupLoginMethod = (typeof SETUP_LOGIN_METHODS)[number]["value"]

interface SetupAuthContext {
  token: string
  userId: number
  tenantId: number
  username: string
  password: string
  service: string
  serviceUrl: string
}

interface InstanceOption {
  label: string
  value: string
  instanceId: number
  instanceName: string
  cspId: number
  regionId: number
}

interface WorkspaceOption {
  label: string
  value: string
  workspaceId: string
  projectId: number
  workspaceName: string
  defaultSchemaName: string
  defaultVclusterName: string
}

interface NamedOption {
  label: string
  value: string
}

type ResolvedOption<T extends NamedOption> = {
  option?: T
  autoSelected: boolean
}

function cancelledError(): never {
  p.cancel("Setup cancelled.")
  process.exit(0)
}

async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  if (!process.stdin.isTTY) return true
  const result = await p.confirm({ message: question, initialValue: defaultYes })
  if (p.isCancel(result)) cancelledError()
  return result
}

async function prompt(question: string, opts?: { placeholder?: string; mask?: boolean }): Promise<string> {
  if (!process.stdin.isTTY) return ""
  if (opts?.mask) {
    const result = await p.password({ message: question })
    if (p.isCancel(result)) cancelledError()
    return result
  }
  const result = await p.text({
    message: question,
    placeholder: opts?.placeholder,
  })
  if (p.isCancel(result)) cancelledError()
  return result
}

async function promptSelect(question: string, options: NamedOption[], _footer?: string): Promise<string> {
  if (!process.stdin.isTTY) return options[0]!.value
  const result = await p.select({
    message: question,
    options: options.map((o) => ({ label: o.label, value: o.value })),
  })
  if (p.isCancel(result)) cancelledError()
  return result as string
}

function decodeCredential(credential: string): Record<string, unknown> {
  const decoded = Buffer.from(credential, "base64").toString("utf-8")
  return JSON.parse(decoded) as Record<string, unknown>
}

function saveProfile(profileName: string, profile: ProfileEntry): void {
  const data = loadFullFile()
  const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
  if (profiles[profileName]) {
    throw new Error(`Profile '${profileName}' already exists. Use --name <other> or delete it first.`)
  }
  saveFullFile({
    ...data,
    default_profile: profileName,
    profiles: {
      ...profiles,
      [profileName]: profile,
    },
  })
}

function loadFullFile(): Record<string, unknown> {
  try {
    return parseTOML(readFileSync(PROFILES_FILE, "utf-8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

function saveFullFile(data: Record<string, unknown>): void {
  mkdirSync(PROFILES_DIR, { recursive: true })
  const content = stringifyTOML(data)
  const tmp = PROFILES_FILE + ".tmp." + Date.now()
  writeFileSync(tmp, content, { encoding: "utf-8", mode: 0o600 })
  renameSync(tmp, PROFILES_FILE)
  try {
    chmodSync(PROFILES_FILE, 0o600)
  } catch {}
}

function applyCredentialToProfiles(
  existing: Record<string, unknown>,
  cred: Record<string, unknown>,
  profileName: string,
): Record<string, unknown> {
  const profiles = (existing.profiles ?? {}) as Record<string, ProfileEntry>
  const currentProfile = (profiles[profileName] ?? {}) as ProfileEntry
  const next = {
    ...existing,
    default_profile: profileName,
    profiles: {
      ...profiles,
      [profileName]: {
        ...currentProfile,
        ...(cred.username ? { username: String(cred.username) } : {}),
        ...(cred.userId != null ? { user_id: Number(cred.userId) } : {}),
        instance: String(cred.instanceName),
        workspace: String(cred.workspaceName ?? "default"),
        schema: String(cred.schema ?? "public"),
        vcluster: String(cred.virtualCluster ?? "default"),
        pat: String(cred.accessToken),
        service: String(cred.service ?? "dev-api.clickzetta.com"),
        protocol: String(cred.protocol ?? "https"),
        ...(typeof cred.analysisAgentEndpoint === "string" ? { analysis_agent_endpoint: cred.analysisAgentEndpoint } : {}),
        ...(typeof cred.aimeshEndpointBaseUrl === "string" && { ai_gateway_url: String(cred.aimeshEndpointBaseUrl) }),
      },
    },
  }
  const apiKey = typeof cred.apiKey === "string" ? cred.apiKey : undefined
  const aimeshEndpointBaseUrl =
    typeof cred.aimeshEndpointBaseUrl === "string" ? cred.aimeshEndpointBaseUrl : undefined
  if (!apiKey && !aimeshEndpointBaseUrl) return next
  const llm = (existing.llm ?? {}) as Record<string, unknown>
  const entry = (llm[profileName] ?? {}) as Record<string, unknown>
  return {
    ...next,
    ...(!existing.default_llm && { default_llm: profileName }),
    llm: {
      ...llm,
      [profileName]: {
        ...entry,
        provider: "clickzetta",
        ...(apiKey && { api_key: apiKey }),
        ...(aimeshEndpointBaseUrl && { base_url: aimeshEndpointBaseUrl }),
      },
    },
  }
}

function quoteShell(value: string): string {
  return JSON.stringify(value)
}

function buildSetupCommand(
  args: Record<string, string | undefined>,
  missingFlag?: string,
  placeholder?: string,
): string {
  const parts = ["cz-cli setup"]
  for (const [key, value] of Object.entries(args)) {
    if (!value) continue
    if (key === "password") {
      parts.push("--password <PASSWORD>")
      continue
    }
    parts.push(`--${key} ${quoteShell(value)}`)
  }
  if (missingFlag && placeholder) {
    parts.push(`--${missingFlag} ${placeholder}`)
  }
  return parts.join(" ")
}

function buildSetupCommandWithRequired(
  args: Record<string, string | undefined>,
  required: string[],
): string {
  const placeholders: Record<string, string> = {
    login: "<LOGIN_URL_OR_JDBC>",
    username: "<USERNAME>",
    password: "<PASSWORD>",
    vcluster: "<VCLUSTER>",
    "account-name": "<ACCOUNT_NAME>",
  }
  const parts = ["cz-cli setup"]
  for (const [key, value] of Object.entries(args)) {
    if (!value) continue
    if (required.includes(key)) continue
    if (key === "login-method") {
      parts.push("--login-method " + value)
      continue
    }
    if (key === "password") {
      parts.push("--password <PASSWORD>")
      continue
    }
    parts.push(`--${key} ${quoteShell(value)}`)
  }
  for (const key of required) {
    parts.push(`--${key} ${placeholders[key] ?? `<${key.toUpperCase()}>`}`)
  }
  return parts.join(" ")
}

function setupContext(argv: Record<string, unknown>) {
  return {
    loginMethod: setupValue(argv, "login-method") || undefined,
    login: setupValue(argv, "login") || undefined,
    username: setupValue(argv, "username") || undefined,
    password: setupValue(argv, "password") || undefined,
    accountName: setupValue(argv, "account-name") || undefined,
    service: setupValue(argv, "service") || undefined,
    instance: setupValue(argv, "instance") || undefined,
    workspace: setupValue(argv, "workspace") || undefined,
    schema: setupValue(argv, "schema") || undefined,
    vcluster: setupValue(argv, "vcluster") || undefined,
  }
}

function setupNeedsInput(
  format: string,
  step: string,
  message: string,
  required: string[],
  options?: NamedOption[],
  extra?: Record<string, unknown>,
): void {
  const payload = {
    step,
    status: "needs_input",
    required,
    flow: [...SETUP_FLOW],
    ...(options ? { options } : {}),
    ...extra,
  }
  error("SETUP_INPUT_REQUIRED", message, {
    format,
    extra: payload,
  })
}

function setupValue(argv: Record<string, unknown>, key: string): string {
  const direct = argv[key]
  if (typeof direct === "string") return direct.trim()
  const camel = key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
  const camelValue = argv[camel]
  return typeof camelValue === "string" ? camelValue.trim() : ""
}

export { accountLoginUrlForService }

function normalizeLoginMethod(value: string | undefined): SetupLoginMethod | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  return SETUP_LOGIN_METHODS.find((option) => option.value === normalized)?.value
}

function hasLegacySetupArgs(argv: Record<string, unknown>): boolean {
  return [
    "username",
    "password",
    "account-name",
    "service",
    "instance",
    "workspace",
    "schema",
    "vcluster",
  ].some((key) => !!setupValue(argv, key))
}

function normalizeLoginInput(input: string): string {
  const raw = input.trim()
  if (!raw) return ""
  if (raw.startsWith("jdbc:clickzetta://")) return raw
  const withProtocol = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`
  const parsed = new URL(withProtocol)
  parsed.hash = ""
  parsed.search = ""
  parsed.pathname = parsed.pathname.replace(/\/login\/?$/i, "") || "/"
  return parsed.toString().replace(/\/$/, "")
}

function appendRef(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set("ref", "cz-cli")
    return parsed.toString()
  } catch {
    return url + (url.includes("?") ? "&" : "?") + "ref=cz-cli"
  }
}

export function browserOpenCommandForPlatform(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] }
  if (platform === "win32") return { command: "cmd.exe", args: ["/c", "start", "", url] }
  return { command: "xdg-open", args: [url] }
}

function openBrowser(url: string): void {
  const opener = browserOpenCommandForPlatform(process.platform, url)
  try {
    spawn(opener.command, opener.args, { detached: true, stdio: "ignore" })
      .once("error", () => {})
      .unref()
  } catch {
    // best-effort: user has the URL printed anyway
  }
}

function loginUrlForMethod(method: SetupLoginMethod): string {
  if (method === "custom") return ""
  return normalizeLoginInput(LOGIN_METHOD_URLS[method])
}

function loginDisplayUrlForMethod(method: Exclude<SetupLoginMethod, "custom">): string {
  return LOGIN_METHOD_URLS[method]
}

function toLoginUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl)
    if (!parsed.pathname.replace(/\/$/, "").toLowerCase().endsWith("/login")) {
      parsed.pathname = (parsed.pathname.replace(/\/$/, "") || "") + "/login"
    }
    return parsed.toString()
  } catch {
    return baseUrl.replace(/\/?$/, "/login")
  }
}

function parseJdbcSetupProfile(argv: Record<string, unknown>, login: string) {
  const parsed = parseJdbcUrl(login)
  if (!parsed?.instance || !parsed.service) return undefined
  const username = setupValue(argv, "username") || parsed.username || ""
  const password = setupValue(argv, "password") || parsed.password || ""
  const workspace = setupValue(argv, "workspace") || parsed.workspace || ""
  const schema = setupValue(argv, "schema") || parsed.schema || "public"
  const vcluster = setupValue(argv, "vcluster") || parsed.vcluster || ""
  const protocol = parsed.protocol === "http" ? "http" : "https"
  const collected: Record<string, string> = {
    login_method: "custom",
    service: parsed.service,
    instance: parsed.instance,
  }
  if (workspace) collected.workspace = workspace
  if (schema) collected.schema = schema
  const missing = [
    !username ? "username" : "",
    !password ? "password" : "",
    !workspace ? "workspace" : "",
    !vcluster ? "vcluster" : "",
  ].filter(Boolean)
  return {
    collected,
    missing,
    profile: {
      username,
      password,
      service: parsed.service,
      protocol,
      instance: parsed.instance,
      workspace,
      schema,
      vcluster,
    } satisfies ProfileEntry,
  }
}

async function saveJdbcProfile(
  profileName: string,
  format: string,
  argv: Record<string, unknown>,
  telemetry: boolean,
  parsed: NonNullable<ReturnType<typeof parseJdbcSetupProfile>>,
): Promise<void> {
  saveProfile(profileName, parsed.profile)
  if (getTelemetry() === undefined) setTelemetry(telemetry)
  let userId: number | undefined
  try {
    const serviceUrl = toServiceUrl(String(parsed.profile.service ?? ""), parsed.profile.protocol === "http" ? "http" : "https")
    const token = await getToken({ ...DEFAULT_CONNECTION, username: String(parsed.profile.username ?? ""), password: String(parsed.profile.password ?? ""), instance: String(parsed.profile.instance ?? ""), service: serviceUrl })
    userId = token.userId || undefined
    if (userId) patchProfileUserId(profileName, userId)
  } catch {}
  return trackSetup({
    success: true,
    telemetry,
    userId,
    collected: {
      username: String(parsed.profile.username ?? ""),
      instance: String(parsed.profile.instance ?? ""),
      workspace: String(parsed.profile.workspace ?? ""),
      service: String(parsed.profile.service ?? ""),
    },
    argv,
  }).then(() => {
    logOperation("setup", { ok: true })
    success({
      message: `Profile '${profileName}' created successfully.`,
      step: "complete",
      profile_name: profileName,
      instance: parsed.profile.instance,
      workspace: parsed.profile.workspace,
      schema: parsed.profile.schema,
      vcluster: parsed.profile.vcluster,
    }, { format })
  })
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split(".")
    if (parts.length < 2) return {}
    const padded = parts[1]! + "=".repeat((4 - (parts[1]!.length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

function coerceInt(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : 0
}

async function loginWithExistingAccount(
  username: string,
  password: string,
  accountName: string,
  service: string,
  instanceHint?: string,
): Promise<SetupAuthContext> {
  const normalizedService = normalizeServiceValue(service)
  const candidates = Array.from(
    new Set(
      [instanceHint, accountName]
        .map((value) => value?.trim() ?? "")
        .filter(Boolean),
    ),
  )
  const errors: string[] = []

  if (!isAccountConsoleInput(normalizedService)) {
    for (const candidate of candidates) {
      try {
        return await loginWithInstanceCandidate(username, password, candidate, normalizedService)
      } catch (error) {
        errors.push(`INSTANCE_LOGIN_FAILED(${candidate}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(errors.join("; "))
  }

  try {
    const accountLoginUrl = normalizedService.startsWith("http://") || normalizedService.startsWith("https://")
      ? normalizeLoginInput(normalizedService)
      : undefined
    const { data, serviceHost, serviceUrl, token } = await loginByAccountSite(
      accountName,
      username,
      password,
      normalizedService,
      20_000,
      accountLoginUrl,
    )
    const jwt = decodeJwtPayload(token)
    const tenantId = coerceInt(jwt.accountId ?? jwt.tenantId ?? data.accountId ?? data.tenantId)
    if (!tenantId) {
      throw new Error("ACCOUNT_LOGIN_FAILED: tenant/account id not found")
    }
    return {
      token,
      userId: coerceInt(jwt.userId ?? jwt.user_id ?? data.userId ?? data.id),
      tenantId,
      username: String(jwt.userName ?? data.username ?? username),
      password,
      service: serviceHost,
      serviceUrl,
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  if (errors.length === 1) {
    throw new Error(errors[0]!)
  }
  throw new Error(errors.join("; "))
}

function isAccountConsoleInput(service: string): boolean {
  const raw = service.trim()
  const parsed = raw.startsWith("http://") || raw.startsWith("https://") ? new URL(raw) : null
  const host = stripProtocol(service)
  const path = parsed?.pathname ?? ""
  return host.startsWith("accounts.")
    || host.includes(".accounts.")
    || host.includes("-accounts.")
    || path.startsWith("/accounts/")
    || path === "/accounts"
}

async function loginWithInstanceCandidate(
  username: string,
  password: string,
  instanceName: string,
  service: string,
): Promise<SetupAuthContext> {
  const normalizedService = normalizeServiceValue(service)
  const serviceUrl = toServiceUrl(normalizedService)
  const login = await loginWithPassword(serviceUrl, username, password, instanceName)
  const jwt = decodeJwtPayload(login.token)
  let userId = coerceInt(jwt.userId ?? jwt.user_id ?? login.userId)
  let tenantId = coerceInt(jwt.accountId ?? jwt.tenantId)
  let resolvedUsername = String(jwt.userName ?? username)

  if (!tenantId) {
    const user = await getCurrentUser(serviceUrl, login.token)
    userId = userId || coerceInt(user.id)
    tenantId = coerceInt(user.accountId)
    resolvedUsername = user.name || resolvedUsername
  }
  if (!tenantId) {
    throw new Error("tenant/account id not found")
  }

  return {
    token: login.token,
    userId,
    tenantId,
    username: resolvedUsername,
    password,
    service: normalizedService,
    serviceUrl,
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`)
  }
  return await response.json() as Record<string, unknown>
}

function unwrapArray(payload: Record<string, unknown>): Record<string, unknown>[] {
  const data = payload.data ?? payload
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
  }
  if (data && typeof data === "object") {
    for (const key of ["records", "list", "items", "result"]) {
      const value = (data as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      }
    }
  }
  return []
}

function filterLakehouseInstances(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const filteredByServiceId = rows.filter((row) => coerceInt(row.serviceId) === 1)
  if (filteredByServiceId.length > 0) return filteredByServiceId
  const filtered = rows.filter((row) => {
    const haystack = [
      row.serviceType,
      row.productType,
      row.instanceType,
      row.module,
      row.category,
      row.bizType,
      row.serviceName,
      row.productName,
      row.type,
    ]
      .map((value) => String(value ?? "").toLowerCase())
      .join(" ")
    return haystack.includes("lakehouse") || haystack.includes(" lh") || haystack.startsWith("lh")
  })
  return filtered.length > 0 ? filtered : rows
}

async function listInstances(auth: SetupAuthContext): Promise<InstanceOption[]> {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "X-Clickzetta-Token": auth.token,
    "cz-lang": "zh_CN",
  }
  const getUrl = `${auth.serviceUrl}/clickzetta-portal/service/serviceInstanceList?accountId=${auth.tenantId}`
  const postUrl = `${auth.serviceUrl}/clickzetta-portal/service/listInstances`
  let rows: Record<string, unknown>[] = []
  try {
    rows = filterLakehouseInstances(unwrapArray(await requestJson(getUrl, { method: "GET", headers })))
  } catch {
    rows = filterLakehouseInstances(unwrapArray(await requestJson(postUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId: auth.tenantId }),
    })))
  }
  return rows
    .map((row) => {
      const instanceId = coerceInt(row.instanceId ?? row.id)
      const instanceName = String(row.instanceName ?? row.name ?? "")
      return instanceId && instanceName
        ? {
            label: instanceName,
            value: instanceName,
            instanceId,
            instanceName,
            cspId: coerceInt(row.cspId),
            regionId: coerceInt(row.regionId),
          }
        : null
    })
    .filter((item): item is InstanceOption => item !== null)
    .sort((left, right) => left.instanceName.localeCompare(right.instanceName))
}

async function listWorkspaces(
  auth: SetupAuthContext,
  instance: InstanceOption,
): Promise<WorkspaceOption[]> {
  const rows = await listUserWorkspaces(
    auth.serviceUrl,
    auth.token,
    auth.userId,
    auth.tenantId,
    instance.instanceId,
    instance.instanceName,
  )
  return rows
    .map((row) => {
      const rawRow = row as unknown as Record<string, unknown>
      const workspaceName = String(rawRow.workspaceName ?? rawRow.showName ?? rawRow.projectName ?? "").trim()
      const workspaceId = String(
        (Array.isArray(rawRow.workspaceIds) ? rawRow.workspaceIds[0] : undefined)
          ?? rawRow.workspaceId
          ?? "",
      ).trim()
      const projectId = coerceInt(rawRow.projectId)
      return workspaceName && workspaceId
        ? {
            label: workspaceName,
            value: workspaceName,
            workspaceId,
            projectId,
            workspaceName,
            defaultSchemaName: String(rawRow.defaultSchemaName ?? "").trim(),
            defaultVclusterName: String(rawRow.defaultVcName ?? rawRow.defaultVclusterName ?? "").trim(),
          }
        : null
    })
    .filter((item): item is WorkspaceOption => item !== null)
    .sort((left, right) => left.workspaceName.localeCompare(right.workspaceName))
}

function studioHeaders(
  auth: SetupAuthContext,
  instance: InstanceOption,
  workspace?: WorkspaceOption,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "X-Clickzetta-Token": auth.token,
    userId: String(auth.userId),
    instanceId: String(instance.instanceId),
    accountId: String(auth.tenantId),
    tenantId: String(auth.tenantId),
    instanceName: instance.instanceName,
    ...(workspace ? {
      workspaceName: workspace.workspaceName,
      workspaceId: String(workspace.workspaceId),
      projectId: String(workspace.projectId),
    } : {}),
  }
}

async function tryFetchAndSaveClickzettaApiKey(
  serviceUrl: string,
  token: string,
  instanceName: string,
): Promise<void> {
  try {
    const url = `${serviceUrl}/clickzetta-portal/user/findOrCreateApiKey?instanceName=${encodeURIComponent(instanceName)}`
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-Clickzetta-Token": token,
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return
    const payload = await response.json() as Record<string, unknown>
    if ((payload.code !== 0 && payload.code !== "0") || typeof payload.data !== "string" || !payload.data) return
    const apiKey = payload.data
    const data = loadFullFile()
    const profileName = typeof data.default_profile === "string" ? data.default_profile : "clickzetta"
    const llm = (data.llm ?? {}) as Record<string, unknown>
    const entry = (llm[profileName] ?? {}) as Record<string, unknown>
    saveFullFile({
      ...data,
      ...(!data.default_llm && { default_llm: profileName }),
      llm: {
        ...llm,
        [profileName]: {
          ...entry,
          provider: "clickzetta",
          api_key: apiKey,
        },
      },
    })
  } catch {
    // best-effort: never block setup
  }
}

function cspRegion(instance: InstanceOption): string {
  return instance.cspId > 0 && instance.regionId > 0 ? `${instance.cspId}-${instance.regionId}` : ""
}

function dedupeOptions(options: NamedOption[]): NamedOption[] {
  return Array.from(new Map(options.map((option) => [option.value, option])).values())
    .sort((left, right) => left.value.localeCompare(right.value))
}

async function listSchemasByStudioApi(
  auth: SetupAuthContext,
  instance: InstanceOption,
  workspace: WorkspaceOption,
): Promise<NamedOption[]> {
  const region = cspRegion(instance)
  if (!region) return []
  const payload = await requestJson(
    `${auth.serviceUrl}/clickzetta-groot/api/v1/entity/centre/schema/list?env=PROD`,
    {
      method: "POST",
      headers: studioHeaders(auth, instance, workspace),
      body: JSON.stringify({
        workspace: workspace.workspaceName,
        cspRegion: region,
      }),
    },
  )
  return dedupeOptions(
    unwrapArray(payload)
      .map((row) => String(row.entityName ?? row.schemaName ?? row.name ?? row.schema ?? "").trim())
      .filter(Boolean)
      .map((name) => ({ label: name, value: name })),
  )
}

async function listSchemas(
  auth: SetupAuthContext,
  instance: InstanceOption,
  workspace: WorkspaceOption,
): Promise<NamedOption[]> {
  try {
    const studioOptions = await listSchemasByStudioApi(auth, instance, workspace)
    if (studioOptions.length > 0) return studioOptions
  } catch {}
  const schemaFallback = workspace.defaultSchemaName || "public"
  const vclusterCandidates = Array.from(
    new Set(
      [
        workspace.defaultVclusterName,
        "default",
        "DEFAULT",
      ]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  )
  for (const vcluster of vclusterCandidates) {
    const config = {
      pat: "",
      username: auth.username,
      password: auth.password,
      service: auth.service,
      protocol: "https",
      instance: instance.instanceName,
      workspace: workspace.workspaceName,
      schema: schemaFallback,
      vcluster,
    }
    const token = await getToken(config)
    const result = await execSql(
      {
        config,
        token,
        clientOpts: {
          baseUrl: toServiceUrl(config.service, config.protocol),
          token: token.token,
          customHeaders: { instanceName: config.instance },
        },
      },
      "SHOW SCHEMAS",
      { timeoutMs: 20_000 },
    )
    if (!isQueryResult(result) || result.status !== JobStatus.SUCCEEDED) continue
    const options = dedupeOptions(
      result.rows
        .map((row) => String(row[0] ?? "").trim())
        .filter(Boolean)
        .map((name) => ({ label: name, value: name })),
    )
    if (options.length > 0) return options
  }
  return schemaFallback ? [{ label: schemaFallback, value: schemaFallback }] : []
}

async function listVclusters(
  auth: SetupAuthContext,
  instance: InstanceOption,
  workspace: WorkspaceOption,
): Promise<NamedOption[]> {
  const headers = studioHeaders(auth, instance, workspace)
  const body = JSON.stringify({
    instanceId: instance.instanceId,
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
    ...(cspRegion(instance) ? { cspRegion: cspRegion(instance) } : {}),
  })
  let payload: Record<string, unknown>
  try {
    payload = await requestJson(
      `${auth.serviceUrl}/clickzetta-lakeconsole/api/v1/vcluster/centre/list`,
      { method: "POST", headers, body },
    )
  } catch {
    payload = await requestJson(
      `${auth.serviceUrl}/clickzetta-lakeconsole/api/v1/vcluster/list`,
      { method: "POST", headers, body },
    )
  }
  return unwrapArray(payload)
    .map((row) => String(row.code ?? row.vcCode ?? row.name ?? row.vclusterName ?? ""))
    .filter(Boolean)
    .map((name) => ({ label: name, value: name }))
    .reduce<NamedOption[]>((acc, option) => (
      acc.some((item) => item.value === option.value) ? acc : [...acc, option]
    ), [])
    .sort((left, right) => left.value.localeCompare(right.value))
}

function resolveOption<T extends NamedOption>(
  provided: string,
  options: T[],
  field: string,
): T {
  const option = options.find((item) => item.value === provided || item.label === provided)
  if (!option) {
    throw new Error(`Invalid ${field}: ${provided}`)
  }
  return option
}

function findOption<T extends NamedOption>(provided: string | undefined, options: T[]): T | undefined {
  if (!provided) return undefined
  return options.find((item) => item.value === provided || item.label === provided)
}

function normalizeServiceValue(service: string): string {
  return service.trim().replace(/\/+$/, "")
}

export function resolveOrAutoSelectOption<T extends NamedOption>(
  provided: string | undefined,
  options: T[],
  field: string,
): ResolvedOption<T> {
  if (provided) return { option: resolveOption(provided, options, field), autoSelected: false }
  if (options.length === 1) return { option: options[0], autoSelected: true }
  return { autoSelected: false }
}

function announceAutoSelected(field: string, value: string): void {
  process.stderr.write(`Only one ${field} found, using ${value}.\n`)
}

async function chooseOptionTTY(question: string, options: NamedOption[], allowCustom = false): Promise<string> {
  const choices = allowCustom
    ? [...options, { label: "Other (enter manually)", value: OTHER_SERVICE }]
    : options
  const chosen = await promptSelect(question, choices)
  if (chosen === OTHER_SERVICE) return await prompt("Enter custom value:")
  return chosen
}


async function runLoginUrlFlowTTY(
  profileName: string,
  format: string,
  argv: Record<string, unknown>,
  loginUrl: string,
  urlLabel = "Login at:",
): Promise<void> {
  const urlWithRef = appendRef(loginUrl)
  p.note(urlWithRef, urlLabel)
  openBrowser(urlWithRef)
  const raw = await prompt("Paste your credential here:", { placeholder: "eyJ..." })
  if (!raw.trim()) {
    error("SETUP_FAILED", "No credential provided.", { format })
    return
  }
  let cred: Record<string, unknown>
  try {
    cred = decodeCredential(raw.trim())
  } catch (e) {
    error("INVALID_CREDENTIAL", `Invalid credential: ${e instanceof Error ? e.message : String(e)}`, { format })
    return
  }
  const instanceName = cred.instanceName as string | undefined
  const accessToken = cred.accessToken as string | undefined
  if (!instanceName || !accessToken) {
    error("INVALID_CREDENTIAL", "Missing required fields: instanceName, accessToken", { format })
    return
  }
  try {
    const data = loadFullFile()
    const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
    if (profiles[profileName]) {
      error("PROFILE_EXISTS", `Profile '${profileName}' already exists. Use --name <other> or delete it first.`, { format })
      return
    }
    saveFullFile(applyCredentialToProfiles(data, cred, profileName))
  } catch (e) {
    error("PROFILE_EXISTS", e instanceof Error ? e.message : String(e), { format })
    return
  }
  // Fetch userId from token for telemetry enduser.id
  let userId: number | undefined
  try {
    const serviceUrl = toServiceUrl(String(cred.service ?? ""), "https")
    const token = await getToken({ ...DEFAULT_CONNECTION, pat: accessToken, instance: instanceName, service: serviceUrl })
    userId = token.userId || undefined
    if (userId) patchProfileUserId(profileName, userId)
  } catch {}
  const telemetryEnabled = await resolveTelemetry()
  await trackSetup({
    success: true,
    telemetry: telemetryEnabled,
    userId,
    collected: {
      instance: instanceName,
      workspace: String(cred.workspaceName ?? ""),
      service: String(cred.service ?? ""),
      username: String(cred.username ?? ""),
    },
    argv: argv as Record<string, unknown>,
  })
  logOperation("setup", { ok: true })
  success({
    message: `Profile '${profileName}' created successfully.`,
    profile_name: profileName,
    instance: instanceName,
    workspace: String(cred.workspaceName ?? "default"),
    schema: String(cred.schema ?? "public"),
  }, { format })
}

async function runModernSetupFlowTTY(
  profileName: string,
  format: string,
  argv: Record<string, unknown>,
  collected: Record<string, string | undefined>,
): Promise<void> {
  p.intro("cz-cli setup")
  const isNewUser = !normalizeLoginMethod(setupValue(argv, "login-method"))
    && !setupValue(argv, "login")
    && await askYesNo("Are you a new user? (y/N) ", false)

  if (isNewUser) {
    const registerChoice = await promptSelect(
      "Choose a registration method:",
      [
        { label: "ClickZetta - https://accounts.clickzetta.com/register", value: "default" },
        { label: "Custom URL - Enter a registration page URL", value: "custom" },
      ],
    )
    let registerUrl = REGISTER_URL_CLICKZETTA
    if (registerChoice === "custom") {
      const rawUrl = await prompt("Enter account console base URL:", { placeholder: "https://accounts.your-domain.com" })
      if (!rawUrl.trim()) {
        error("SETUP_FAILED", "A registration URL is required.", { format })
        return
      }
      const trimmed = rawUrl.trim()
      const withProtocol = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`
      try {
        const parsed = new URL(withProtocol)
        parsed.hash = ""
        parsed.search = ""
        if (!parsed.pathname.replace(/\/$/, "").toLowerCase().endsWith("/register")) {
          parsed.pathname = parsed.pathname.replace(/\/$/, "") + "/register"
        }
        registerUrl = parsed.toString().replace(/\/$/, "")
      } catch {
        error("SETUP_FAILED", "Invalid registration URL.", { format })
        return
      }
    }
    await runLoginUrlFlowTTY(profileName, format, argv, registerUrl, "Register at:")
    return
  }

  const method = normalizeLoginMethod(setupValue(argv, "login-method"))
    ?? normalizeLoginMethod(await promptSelect(
        "Choose a login method:",
        SETUP_LOGIN_METHODS.map((option) => ({ ...option })),
        `Examples:\n\nJDBC:\n${JDBC_EXAMPLE}`,
      ))
  if (!method) {
    throw new Error("Invalid login method")
  }
  collected.login_method = method
  if (method === "custom") {
    const rawInput = setupValue(argv, "login")
      || await prompt("Enter a login page URL or JDBC connection string:", {
          placeholder: JDBC_EXAMPLE,
        })
    const login = normalizeLoginInput(rawInput)
    if (!login) {
      error("SETUP_FAILED", "A login page URL or JDBC connection string is required.", { format })
      return
    }
    if (login.startsWith("jdbc:clickzetta://")) {
      const parsed = parseJdbcSetupProfile(argv, login)
      if (!parsed) {
        error("SETUP_FAILED", "Invalid JDBC connection string.", { format })
        return
      }
      if (!String(parsed.profile.username ?? "").trim()) {
        parsed.profile.username = await prompt("Username:")
      }
      if (!String(parsed.profile.password ?? "").trim()) {
        parsed.profile.password = await prompt("Password:", { mask: true })
      }
      if (!String(parsed.profile.workspace ?? "").trim()) {
        parsed.profile.workspace = await prompt("Workspace:")
      }
      if (!String(parsed.profile.vcluster ?? "").trim()) {
        parsed.profile.vcluster = await prompt("Virtual cluster:", { placeholder: "DEFAULT" })
      }
      await saveJdbcProfile(
        profileName,
        format,
        argv,
        await resolveTelemetry(),
        {
          ...parsed,
          profile: {
            ...parsed.profile,
            username: String(parsed.profile.username ?? "").trim(),
            password: String(parsed.profile.password ?? "").trim(),
            workspace: String(parsed.profile.workspace ?? "").trim(),
            vcluster: String(parsed.profile.vcluster ?? "").trim(),
          },
        },
      )
      return
    }
    // custom URL (non-JDBC): normalize to base, append /login, open browser
    await runLoginUrlFlowTTY(profileName, format, argv, toLoginUrl(login))
    return
  }
  // clickzetta or singdata: show official login URL, paste credential
  const loginUrl = loginDisplayUrlForMethod(method as Exclude<SetupLoginMethod, "custom">)
  await runLoginUrlFlowTTY(profileName, format, argv, loginUrl)
}

async function runModernSetupFlowNonTTY(
  profileName: string,
  format: string,
  argv: Record<string, unknown>,
): Promise<void> {
  const context = setupContext(argv)
  const method = normalizeLoginMethod(context.loginMethod)
  if (!method) {
    setupNeedsInput(
      format,
      "login_method",
      "Choose a login method before continuing setup.",
      ["login_method"],
      SETUP_LOGIN_METHODS.map((option) => ({ ...option })),
      {
        next_steps: [
          "cz-cli setup --login-method clickzetta",
          "cz-cli setup --login-method singdata",
          "cz-cli setup --login-method custom --login <LOGIN_URL_OR_JDBC>",
        ],
      },
    )
    return
  }
  if (method === "custom") {
    const login = normalizeLoginInput(context.login ?? "")
    if (!login) {
      setupNeedsInput(
        format,
        "credentials",
        "Enter a login page URL or paste a JDBC connection string.",
        ["login"],
        undefined,
        {
          jdbc_example: JDBC_EXAMPLE,
          collected: { login_method: "custom" },
          next_steps: [
            buildSetupCommandWithRequired(
              {
                "login-method": "custom",
                login: JDBC_EXAMPLE,
              },
              [],
            ),
            "cz-cli setup --login-method custom --login <LOGIN_PAGE_URL>",
          ],
        },
      )
      return
    }
    if (login.startsWith("jdbc:clickzetta://")) {
      const parsed = parseJdbcSetupProfile(argv, login)
      if (!parsed) {
        error("SETUP_FAILED", "Invalid JDBC connection string.", { format })
        return
      }
      if (parsed.missing.length > 0) {
        setupNeedsInput(
          format,
          "credentials",
          "Fill in the missing JDBC fields before the profile can be saved.",
          parsed.missing,
          undefined,
          {
            jdbc_example: JDBC_EXAMPLE,
            collected: parsed.collected,
            next_steps: [
              buildSetupCommandWithRequired(
                {
                  "login-method": "custom",
                  login,
                  username: String(parsed.profile.username ?? "") || undefined,
                  password: String(parsed.profile.password ?? "") || undefined,
                  workspace: String(parsed.profile.workspace ?? "") || undefined,
                  vcluster: String(parsed.profile.vcluster ?? "") || undefined,
                },
                parsed.missing,
              ),
            ],
          },
        )
        return
      }
      await saveJdbcProfile(profileName, format, argv, getTelemetry() ?? true, parsed)
      return
    }
    // custom URL (non-JDBC): return login URL with /login?ref=cz-cli
    const loginUrl = toLoginUrl(login)
    setupNeedsInput(
      format,
      "credentials",
      `Log in at ${appendRef(loginUrl)} and paste your credential to continue.`,
      ["credential"],
      undefined,
      {
        login_url: appendRef(loginUrl),
        collected: { login_method: "custom" },
        next_steps: ["cz-cli setup --credential <BASE64_CREDENTIAL>"],
      },
    )
    return
  }
  // clickzetta or singdata: return login URL for user to authenticate and get credential
  const loginUrl = loginDisplayUrlForMethod(method as Exclude<SetupLoginMethod, "custom">)
  const extra: Record<string, unknown> = {
    login_url: appendRef(loginUrl),
    collected: { login_method: method },
    next_steps: ["cz-cli setup --credential <BASE64_CREDENTIAL>"],
  }
  if (method === "clickzetta") {
    extra.register_url = REGISTER_URL_CLICKZETTA
  }
  setupNeedsInput(
    format,
    "credentials",
    `Log in at ${appendRef(loginUrl)} and paste your credential to continue.`,
    ["credential"],
    undefined,
    extra,
  )
}

async function runExistingAccountFlowTTY(
  profileName: string,
  format: string,
  argv: Record<string, unknown>,
  collected: Record<string, string | undefined>,
): Promise<void> {
  p.intro("cz-cli setup")
  const username = setupValue(argv, "username") || await prompt("Username:")
  collected.username = username
  let password = setupValue(argv, "password")
  if (!password) {
    password = await prompt("Password:", { mask: true })
  }
  const accountName = setupValue(argv, "account-name") || await prompt("Account name:")
  const service = setupValue(argv, "service") || await chooseOptionTTY(
    "Choose service endpoint or account console host",
    SERVICE_ENDPOINTS.map((value) => ({ label: value, value })),
    true,
  )
  collected.service = normalizeServiceValue(service)
  let auth: SetupAuthContext
  try {
    auth = await loginWithExistingAccount(
      username,
      password,
      accountName,
      service,
      setupValue(argv, "instance") || undefined,
    )
  } catch (loginError) {
    if (!isAccountConsoleInput(normalizeServiceValue(service))) {
      process.stderr.write(
        `Login failed (${loginError instanceof Error ? loginError.message : String(loginError)}).\n` +
        "For direct API endpoints, an instance name is required to authenticate.\n",
      )
      const instanceName = await prompt("Instance name: ")
      auth = await loginWithExistingAccount(username, password, accountName, service, instanceName)
    } else {
      throw loginError
    }
  }
  const instances = await listInstances(auth)
  if (instances.length === 0) {
    error("SETUP_DISCOVERY_FAILED", "No Lakehouse instances found under the selected service.", { format })
    return
  }
  const instanceHint = setupValue(argv, "instance") || accountName
  const hintedInstance = findOption(instanceHint || undefined, instances)
  const chosenInstance = hintedInstance
    ? { option: hintedInstance, autoSelected: !setupValue(argv, "instance") }
    : resolveOrAutoSelectOption(setupValue(argv, "instance") || undefined, instances, "instance")
  const instance = chosenInstance.option
    ?? resolveOption(await chooseOptionTTY("Choose instance", instances), instances, "instance")
  collected.instance = instance.instanceName
  if (chosenInstance.autoSelected) announceAutoSelected("instance", instance.instanceName)
  const workspaces = await listWorkspaces(auth, instance)
  if (workspaces.length === 0) {
    error("SETUP_DISCOVERY_FAILED", "No workspaces found under the selected instance.", { format })
    return
  }
  const chosenWorkspace = resolveOrAutoSelectOption(
    setupValue(argv, "workspace") || undefined,
    workspaces,
    "workspace",
  )
  const workspace = chosenWorkspace.option
    ?? resolveOption(await chooseOptionTTY("Choose workspace", workspaces), workspaces, "workspace")
  collected.workspace = workspace.workspaceName
  if (chosenWorkspace.autoSelected) announceAutoSelected("workspace", workspace.workspaceName)
  const schemas = await listSchemas(auth, instance, workspace)
  const vclusters = await listVclusters(auth, instance, workspace)
  const chosenSchema = resolveOrAutoSelectOption(setupValue(argv, "schema") || undefined, schemas, "schema")
  const schema = chosenSchema.option
    ? chosenSchema.option.value
    : schemas.length
      ? await chooseOptionTTY("Choose schema", schemas, true)
      : await prompt("Schema: ")
  if (chosenSchema.autoSelected) announceAutoSelected("schema", schema)
  const chosenVcluster = resolveOrAutoSelectOption(setupValue(argv, "vcluster") || undefined, vclusters, "vcluster")
  const vcluster = chosenVcluster.option
    ? chosenVcluster.option.value
    : vclusters.length
      ? await chooseOptionTTY("Choose vcluster", vclusters, true)
      : await prompt("Vcluster: ")
  if (chosenVcluster.autoSelected) announceAutoSelected("vcluster", vcluster)
  const profile: ProfileEntry = {
    username,
    password,
    account_name: accountName,
    service: auth.service,
    protocol: "https",
    instance: instance.instanceName,
    workspace: workspace.workspaceName,
    schema,
    vcluster,
    ...(auth.userId ? { user_id: auth.userId } : {}),
  }
  saveProfile(profileName, profile)
  await tryFetchAndSaveClickzettaApiKey(auth.serviceUrl, auth.token, instance.instanceName)
  const telemetryEnabled = await resolveTelemetry()
  await trackSetup({
    success: true,
    telemetry: telemetryEnabled,
    userId: auth.userId || undefined,
    collected: { username, instance: instance.instanceName, workspace: workspace.workspaceName, service: auth.service },
    argv: argv as Record<string, unknown>,
  })
  logOperation("setup", { ok: true })
  success({
    message: `Profile '${profileName}' created successfully.`,
    profile_name: profileName,
    instance: instance.instanceName,
    workspace: workspace.workspaceName,
    schema,
    vcluster,
  }, { format })
}

async function runExistingAccountFlowNonTTY(
  profileName: string,
  format: string,
  argv: Record<string, unknown>,
): Promise<void> {
  const context = setupContext(argv)
  const username = setupValue(argv, "username")
  const password = setupValue(argv, "password")
  const accountName = setupValue(argv, "account-name")
  if (!username || !password || !accountName) {
    setupNeedsInput(
      format,
      "account_fields",
      "Setup supports two paths: use --credential for a new user, or provide username, password, and account_name for an existing ClickZetta account.",
      ["username", "password", "account_name"],
      undefined,
      {
        register_url: REGISTER_URL_CLICKZETTA,
        next_steps: [
          "cz-cli setup --credential <BASE64_CREDENTIAL>",
          buildSetupCommand(
            {
              username: context.username,
              password: context.password,
              "account-name": context.accountName,
            },
            "username",
            "<USERNAME>",
          ) + " --password <PASSWORD> --account-name <ACCOUNT_NAME>",
        ],
      },
    )
    return
  }
  const service = setupValue(argv, "service")
  if (!service) {
    setupNeedsInput(
      format,
      "service",
      "Choose a service endpoint or account console host. After that, cz-cli can log in and list available instances for you to choose from.",
      ["service"],
      [...SERVICE_ENDPOINTS.map((value) => ({ label: value, value })), { label: "Other", value: OTHER_SERVICE }],
      {
        collected: {
          username,
          account_name: accountName,
        },
        next_steps: [
          buildSetupCommand(
            {
              username,
              password,
              "account-name": accountName,
            },
            "service",
            "<SERVICE_ENDPOINT>",
          ),
        ],
      },
    )
    return
  }
  const auth = await loginWithExistingAccount(
    username,
    password,
    accountName,
    service,
    setupValue(argv, "instance") || undefined,
  )
  const instances = await listInstances(auth)
  if (instances.length === 0) {
    error("SETUP_DISCOVERY_FAILED", "No Lakehouse instances found under the selected service.", { format })
    return
  }
  const instanceName = setupValue(argv, "instance")
  const inferredInstance = findOption(instanceName || accountName, instances)
  const instance = instanceName
    ? resolveOption(instanceName, instances, "instance")
    : instances.length === 1
      ? instances[0]!
      : inferredInstance ?? null
  if (!instance) {
    setupNeedsInput(format, "instance", "Choose an instance before continuing setup.", ["instance"], instances, {
      collected: {
        username,
        account_name: accountName,
        service: normalizeServiceValue(service),
      },
      next_steps: [
        buildSetupCommand(
          {
            username,
            password,
            "account-name": accountName,
            service,
          },
          "instance",
          "<INSTANCE>",
        ),
      ],
    })
    return
  }
  const workspaces = await listWorkspaces(auth, instance)
  if (workspaces.length === 0) {
    error("SETUP_DISCOVERY_FAILED", "No workspaces found under the selected instance.", { format })
    return
  }
  const workspaceName = setupValue(argv, "workspace")
  const workspace = workspaceName
    ? resolveOption(workspaceName, workspaces, "workspace")
    : workspaces.length === 1
      ? workspaces[0]!
      : null
  if (!workspace) {
    setupNeedsInput(format, "workspace", "Choose a workspace before continuing setup.", ["workspace"], workspaces, {
      collected: {
        username,
        account_name: accountName,
        service: normalizeServiceValue(service),
        instance: instance.instanceName,
      },
      next_steps: [
        buildSetupCommand(
          {
            username,
            password,
            "account-name": accountName,
            service,
            instance: instance.instanceName,
          },
          "workspace",
          "<WORKSPACE>",
        ),
      ],
    })
    return
  }
  const schemas = await listSchemas(auth, instance, workspace)
  const schemaValue = setupValue(argv, "schema")
  const schema = schemaValue || (schemas.length === 1 ? schemas[0]!.value : "")
  if (!schema) {
    setupNeedsInput(format, "schema", "Choose a schema before continuing setup.", ["schema"], schemas, {
      collected: {
        username,
        account_name: accountName,
        service: normalizeServiceValue(service),
        instance: instance.instanceName,
        workspace: workspace.workspaceName,
      },
      next_steps: [
        buildSetupCommand(
          {
            username,
            password,
            "account-name": accountName,
            service,
            instance: instance.instanceName,
            workspace: workspace.workspaceName,
          },
          "schema",
          "<SCHEMA>",
        ),
      ],
    })
    return
  }
  const vclusters = await listVclusters(auth, instance, workspace)
  const vclusterValue = setupValue(argv, "vcluster")
  const vcluster = vclusterValue || (vclusters.length === 1 ? vclusters[0]!.value : "")
  if (!vcluster) {
    setupNeedsInput(format, "vcluster", "Choose a vcluster before continuing setup.", ["vcluster"], vclusters, {
      collected: {
        username,
        account_name: accountName,
        service: normalizeServiceValue(service),
        instance: instance.instanceName,
        workspace: workspace.workspaceName,
        schema,
      },
      next_steps: [
        buildSetupCommand(
          {
            username,
            password,
            "account-name": accountName,
            service,
            instance: instance.instanceName,
            workspace: workspace.workspaceName,
            schema,
          },
          "vcluster",
          "<VCLUSTER>",
        ),
      ],
    })
    return
  }
  const profile: ProfileEntry = {
    username,
    password,
    account_name: accountName,
    service: auth.service,
    protocol: "https",
    instance: instance.instanceName,
    workspace: workspace.workspaceName,
    schema,
    vcluster,
    ...(auth.userId ? { user_id: auth.userId } : {}),
  }
  saveProfile(profileName, profile)
  await tryFetchAndSaveClickzettaApiKey(auth.serviceUrl, auth.token, instance.instanceName)
  if (getTelemetry() === undefined) setTelemetry(true)
  await trackSetup({
    success: true,
    telemetry: getTelemetry() ?? true,
    userId: auth.userId || undefined,
    collected: { username, instance: instance.instanceName, workspace: workspace.workspaceName, service: auth.service },
    argv: argv as Record<string, unknown>,
  })
  logOperation("setup", { ok: true })
  success({
    message: `Profile '${profileName}' created successfully.`,
    step: "complete",
    profile_name: profileName,
    instance: instance.instanceName,
    workspace: workspace.workspaceName,
    schema,
    vcluster,
  }, { format })
}

/**
 * Top-level `setup` command — entry point for first-time configuration.
 */
export function registerSetupCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "setup",
    "Configure a ClickZetta or Singdata profile from a login page or JDBC connection string",
    (yargs) =>
      yargs
        .option("credential", { type: "string", describe: "Base64-encoded registration credential" })
        .option("name", { type: "string", default: "default", describe: "Profile name to create" })
        .option("login-method", {
          type: "string",
          choices: SETUP_LOGIN_METHODS.map((option) => option.value),
          describe: "Choose ClickZetta, Singdata, or a custom setup flow",
        })
        .option("login", { type: "string", describe: "Custom login page URL or JDBC connection string" })
        .option("account-name", { type: "string", describe: "Account name for existing ClickZetta users" })
        .option("skip-verify", { type: "boolean", default: false, describe: "Skip connection verification" })
        .example(
          "$0 setup --login-method clickzetta",
          "Start the ClickZetta login flow",
        )
        .example(
          "$0 setup --login-method custom --login <LOGIN_URL_OR_JDBC>",
          "Use a custom login page URL or JDBC connection string",
        )
        .epilogue(
          "Choose a login method:\n" +
          "1. ClickZetta - https://accounts.clickzetta.com/login\n" +
          "2. Singdata  - https://accounts.singdata.com/login\n" +
          "3. Custom URL - Enter a login page URL or paste a JDBC connection string\n\n" +
          "JDBC example:\n" +
          `${JDBC_EXAMPLE}\n\n` +
          "Compatibility:\n" +
          "  `cz-cli setup --credential <BASE64_CREDENTIAL>` still works if you already have a registration credential.\n\n" +
          "Non-TTY / agent mode:\n" +
          "  Re-run `cz-cli setup` with the fields requested in the JSON response until step=complete.",
        ),
    async (argv) => {
      const format = argv.format
      const profileName = argv.name as string
      if (argv.credential) {
        let cred: Record<string, unknown>
        try {
          cred = decodeCredential(argv.credential as string)
        } catch (e) {
          error("INVALID_CREDENTIAL", `Invalid base64 or JSON: ${e instanceof Error ? e.message : String(e)}`, { format })
          return
        }
        const instanceName = cred.instanceName as string | undefined
        const accessToken = cred.accessToken as string | undefined
        if (!instanceName || !accessToken) {
          error("INVALID_CREDENTIAL", "Missing required fields: instanceName, accessToken", { format })
          return
        }
        const profile: ProfileEntry = {
          instance: instanceName,
          workspace: (cred.workspaceName as string) ?? "default",
          schema: (cred.schema as string) ?? "public",
          vcluster: (cred.virtualCluster as string) ?? "default",
          pat: accessToken,
          service: (cred.service as string) ?? "dev-api.clickzetta.com",
          protocol: (cred.protocol as string) ?? "https",
          ...(typeof cred.analysisAgentEndpoint === "string" ? { analysis_agent_endpoint: cred.analysisAgentEndpoint } : {}),
        }
        try {
          const data = loadFullFile()
          const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
          if (profiles[profileName]) {
            error("PROFILE_EXISTS", `Profile '${profileName}' already exists. Use a different name or delete it first.`, { format })
            return
          }
          saveFullFile(applyCredentialToProfiles(data, cred, profileName))
        } catch (e) {
          error("PROFILE_EXISTS", e instanceof Error ? e.message : String(e), { format })
          return
        }

        const telemetryEnabled = await resolveTelemetry()
        let userId: number | undefined
        try {
          const serviceUrl = toServiceUrl(String(cred.service ?? ""), "https")
          const token = await getToken({ ...DEFAULT_CONNECTION, pat: accessToken, instance: instanceName, service: serviceUrl })
          userId = token.userId || undefined
          if (userId) patchProfileUserId(profileName, userId)
        } catch {}
        await trackSetup({
          success: true,
          telemetry: telemetryEnabled,
          userId,
          collected: { instance: instanceName, workspace: String(profile.workspace ?? ""), service: String(profile.service ?? ""), username: String(cred.username ?? "") },
          argv: argv as unknown as Record<string, unknown>,
        })
        logOperation("setup", { ok: true })
        success({
          message: `Profile '${profileName}' created successfully.`,
          profile_name: profileName,
          instance: instanceName,
          workspace: profile.workspace,
          schema: profile.schema,
        }, { format })
        return
      }

      const rawArgv = argv as unknown as Record<string, unknown>
      const shouldUseModernFlow = !!normalizeLoginMethod(setupValue(rawArgv, "login-method"))
        || !!setupValue(rawArgv, "login")
        || !hasLegacySetupArgs(rawArgv)
      if (!process.stdin.isTTY) {
        try {
          if (shouldUseModernFlow) {
            await runModernSetupFlowNonTTY(profileName, format, rawArgv)
          } else {
            await runExistingAccountFlowNonTTY(profileName, format, rawArgv)
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          await trackSetup({
            success: false,
            error: msg,
            collected: { username: setupValue(rawArgv, "username") || undefined, instance: setupValue(rawArgv, "instance") || undefined, workspace: setupValue(rawArgv, "workspace") || undefined, service: setupValue(rawArgv, "service") || undefined },
            argv: rawArgv,
          })
          error("SETUP_FAILED", msg, { format })
        }
        return
      }

      let resolvedProfileName = profileName
      {
        const data = loadFullFile()
        const profiles = (data.profiles ?? {}) as Record<string, ProfileEntry>
        if (profiles[resolvedProfileName]) {
          const existingNames = Object.keys(profiles).join(", ")
          p.note(
            `Tip: use --name <new_name> to skip this step next time (existing: ${existingNames}).`,
            `Profile '${resolvedProfileName}' already exists`,
          )
          const newName = await prompt("Enter a new profile name:", { placeholder: "my-profile" })
          if (!newName.trim()) {
            error("SETUP_FAILED", `Profile '${resolvedProfileName}' already exists. Use --name <other> to create a new profile.`, { format })
            return
          }
          resolvedProfileName = newName.trim()
        }
      }

      const ttyCollected: Record<string, string | undefined> = {}
      try {
        if (shouldUseModernFlow) {
          await runModernSetupFlowTTY(resolvedProfileName, format, rawArgv, ttyCollected)
        } else {
          await runExistingAccountFlowTTY(resolvedProfileName, format, rawArgv, ttyCollected)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await trackSetup({
          success: false,
          error: msg,
          collected: ttyCollected,
          argv: rawArgv,
        })
        error("SETUP_FAILED", msg, { format })
      }
    },
  )
}
