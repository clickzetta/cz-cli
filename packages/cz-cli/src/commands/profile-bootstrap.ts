import type { Argv } from "yargs"
import {
  loginWithPassword, getCurrentUser,
  listUserWorkspaces, detectEnv, toServiceUrl,
} from "@clickzetta/sdk"
import { createInterface } from "node:readline"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { loadProfiles, saveProfiles, type ProfileEntry } from "../connection/profile-store.js"
import { loginByAccountSite } from "./account-login.js"

// ---------------------------------------------------------------------------
// Data interfaces
// ---------------------------------------------------------------------------

interface StudioUrlInfo {
  rawUrl: string
  host: string
  path: string
  urlType: "account" | "app" | "api" | "unknown"
  accountDisplayName: string | null
  instanceName: string | null
  envToken: string | null
  rootDomain: string
  serviceHost: string
  serviceUrl: string
  accountLoginUrl: string | null
  centerRegion: string
}

interface AuthResult {
  token: string
  userId: number
  tenantId: number
  instanceId: number
  username: string
  accountDisplayName: string | null
  serviceUrl: string
  centerRegion: string
}

// ---------------------------------------------------------------------------
// URL parsing helpers
// ---------------------------------------------------------------------------

function extractRootDomain(host: string): string {
  for (const suffix of [".clickzetta.com", ".singdata.com", ".clickzetta-inc.com"]) {
    if (host.endsWith(suffix)) return suffix.slice(1)
  }
  const parts = host.split(".")
  return parts.length >= 2 ? parts.slice(-2).join(".") : host
}

function serviceFromEnv(envToken: string | null, rootDomain: string): string {
  if (!envToken) return `api.${rootDomain}`
  const env = envToken.trim().toLowerCase()
  if (["dev", "sit", "uat"].includes(env)) return `${env}-api.${rootDomain}`
  return `${env}.api.${rootDomain}`
}

function normalizeStudioUrl(studioUrl: string): string {
  let raw = (studioUrl || "").trim()
  if (!raw) throw new Error("studio_url is required")
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) raw = `https://${raw}`
  return raw
}

function inferModeFromPath(path: string): [string, string | null, string | null] {
  const segments = (path || "").split("/").filter(Boolean)
  if (segments.length && segments[0].toLowerCase() === "api") return ["api", null, null]
  if (segments.length >= 2 && segments[0].toLowerCase() === "accounts") return ["account", segments[1], null]
  if (segments.length >= 2 && segments[0].toLowerCase() === "app") return ["app", null, segments[1]]
  if (segments.length === 1) {
    const s = segments[0].toLowerCase()
    if (s === "accounts") return ["account", null, null]
    if (s === "app") return ["app", null, null]
  }
  return ["unknown", null, null]
}

function appHostToApiHost(host: string): string {
  let rest = host.replace(/^[a-z0-9-]+\./, "")
  rest = rest.replace(/-app\./, "-api.")
  rest = rest.replace(/\.app\./, ".api.")
  rest = rest.replace(/^app\./, "api.")
  return rest
}

function extractInstanceFromFallback(query: string): string | null {
  const params = new URLSearchParams(query)
  const fb = (params.get("fallback") || "").trim()
  if (!fb) return null
  try {
    const fbHost = new URL(fb).hostname.toLowerCase()
    const m = fbHost.match(/^([a-z0-9-]+)\.(?:[a-z0-9-]+-)?app\.[a-z0-9.-]+$/)
    return m ? m[1] : null
  } catch { return null }
}

function getRegionByAlias(alias: string): string {
  // Map common env aliases to region keys (matching Python's get_region_by_alias)
  const map: Record<string, string> = {
    dev: "dev",
    sit: "sit",
    uat: "uat",
    prod: "cn-shanghai-alicloud",
  }
  return map[alias.toLowerCase()] || ""
}

function parseStudioUrl(studioUrl: string, serviceOverride?: string): StudioUrlInfo {
  const raw = normalizeStudioUrl(studioUrl)
  const parsed = new URL(raw)
  const host = (parsed.hostname || "").toLowerCase()
  if (!host) throw new Error(`invalid studio_url: ${studioUrl}`)

  const rootDomain = extractRootDomain(host)
  const path = parsed.pathname || "/"

  let urlType: StudioUrlInfo["urlType"] = "unknown"
  let accountDisplayName: string | null = null
  let instanceName: string | null = null
  let envToken: string | null = null
  let routeAccountPrefix: string | null = null
  let isRouteStyle = false

  type Pattern = [RegExp, string, number | null, number | null, number | null]
  const patterns: Pattern[] = [
    // api: <env>-api.<domain> | <env>.api.<domain> | api.<domain>
    [/^([a-z0-9-]+)-api\.[a-z0-9.-]+$/, "api", null, 1, null],
    [/^([a-z0-9-]+)\.api\.[a-z0-9.-]+$/, "api", null, 1, null],
    [/^api\.[a-z0-9.-]+$/, "api", null, null, null],
    // account: <acct>.<env>-accounts.<domain> | <acct>.<env>.accounts.<domain> | <acct>.accounts.<domain>
    [/^([a-z0-9-]+)\.([a-z0-9-]+)-accounts\.[a-z0-9.-]+$/, "account", 1, 2, null],
    [/^([a-z0-9-]+)\.([a-z0-9-]+)\.accounts\.[a-z0-9.-]+$/, "account", 1, 2, null],
    [/^([a-z0-9-]+)\.accounts\.[a-z0-9.-]+$/, "account", 1, null, null],
    // account (bare): <env>-accounts.<domain> | accounts.<domain>
    [/^([a-z0-9-]+)-accounts\.[a-z0-9.-]+$/, "account", null, 1, null],
    [/^accounts\.[a-z0-9.-]+$/, "account", null, null, null],
    // app: <inst>.<env>-app.<domain> | <inst>.<env>.app.<domain> | <inst>.app.<domain>
    [/^([a-z0-9-]+)\.([a-z0-9-]+)-app\.[a-z0-9.-]+$/, "app", null, 2, 1],
    [/^([a-z0-9-]+)\.([a-z0-9-]+)\.app\.[a-z0-9.-]+$/, "app", null, 2, 1],
    [/^([a-z0-9-]+)\.app\.[a-z0-9.-]+$/, "app", null, null, 1],
  ]
  for (const [pat, utype, acctGrp, envGrp, instGrp] of patterns) {
    const m = host.match(pat)
    if (m) {
      urlType = utype as StudioUrlInfo["urlType"]
      if (acctGrp) accountDisplayName = m[acctGrp]
      if (envGrp) envToken = m[envGrp]
      if (instGrp) instanceName = m[instGrp]
      break
    }
  }

  if (urlType === "unknown") {
    const [pathType, pathAccount, pathInstance] = inferModeFromPath(path)
    if (pathType !== "unknown") {
      urlType = pathType as StudioUrlInfo["urlType"]
      isRouteStyle = true
      if (pathAccount) {
        accountDisplayName = pathAccount
        routeAccountPrefix = `${parsed.protocol}//${host}/accounts/${pathAccount}`
      }
      if (pathInstance) instanceName = pathInstance
    }
  } else {
    const [, pathAccount, pathInstance] = inferModeFromPath(path)
    if (urlType === "account" && !accountDisplayName && pathAccount) {
      accountDisplayName = pathAccount
      routeAccountPrefix = `${parsed.protocol}//${host}/accounts/${pathAccount}`
    }
    if (!instanceName && pathInstance) instanceName = pathInstance
  }

  // For account URLs, extract instance from ?fallback=<app-url> if present
  if (urlType === "account" && !instanceName && parsed.search) {
    instanceName = extractInstanceFromFallback(parsed.search.slice(1))
  }

  let serviceHost: string
  if (serviceOverride) {
    serviceHost = serviceOverride.trim()
  } else if (urlType === "api") {
    const pathSegments = path.split("/").filter(Boolean)
    serviceHost = pathSegments.length && pathSegments[0].toLowerCase() === "api" ? `${host}/api` : host
  } else if (urlType === "app") {
    serviceHost = isRouteStyle ? `${host}/api` : appHostToApiHost(host)
  } else if (urlType === "account" && isRouteStyle) {
    serviceHost = `${host}/api`
  } else if (urlType === "account" && instanceName && envToken) {
    serviceHost = serviceFromEnv(envToken, rootDomain)
  } else {
    serviceHost = ""
  }

  const serviceUrl = serviceHost ? toServiceUrl(serviceHost) : ""

  let accountLoginUrl: string | null = null
  if (routeAccountPrefix) {
    accountLoginUrl = routeAccountPrefix
  } else if (urlType === "account" && accountDisplayName) {
    accountLoginUrl = envToken
      ? `https://${accountDisplayName}.${envToken}-accounts.${rootDomain}`
      : `https://${accountDisplayName}.accounts.${rootDomain}`
  }

  // Resolve center region
  let centerRegion = getRegionByAlias(envToken || "")
  if (!centerRegion && serviceHost) {
    try { centerRegion = detectEnv(serviceHost) } catch { /* ignore */ }
  }
  if (!centerRegion) centerRegion = "dev"

  return {
    rawUrl: raw, host, path, urlType, accountDisplayName, instanceName,
    envToken, rootDomain, serviceHost, serviceUrl, accountLoginUrl, centerRegion,
  }
}

// ---------------------------------------------------------------------------
// Authentication helpers
// ---------------------------------------------------------------------------

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split(".")
    if (parts.length < 2) return {}
    const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, "base64").toString())
  } catch { return {} }
}

function coerceInt(value: unknown, fallback = 0): number {
  try {
    const n = Number(value)
    return Number.isFinite(n) ? Math.trunc(n) : fallback
  } catch { return fallback }
}

async function loginWithPasswordRaw(
  instance: string, username: string, password: string, accountLoginUrl: string, timeoutSeconds = 20,
): Promise<{ token: string; data: Record<string, unknown>; serviceHost: string; serviceUrl: string }> {
  const login = await loginByAccountSite(instance, username, password, accountLoginUrl, timeoutSeconds * 1000, accountLoginUrl)
  return {
    token: login.token,
    data: login.data,
    serviceHost: login.serviceHost,
    serviceUrl: login.serviceUrl,
  }
}

async function loginByAccount(
  info: StudioUrlInfo, username: string, password: string, timeout: number,
): Promise<AuthResult> {
  if (!info.accountLoginUrl || !info.accountDisplayName) {
    throw new Error("account login requires account URL")
  }
  const { token, data, serviceUrl } = await loginWithPasswordRaw(
    info.accountDisplayName, username, password,
    info.accountLoginUrl, timeout,
  )
  const jp = decodeJwtPayload(token)
  return {
    token,
    userId: coerceInt(jp.userId ?? jp.user_id ?? data.userId ?? data.id),
    tenantId: coerceInt(jp.accountId ?? jp.tenantId ?? data.accountId ?? data.tenantId),
    instanceId: 0,
    username: String(jp.userName ?? data.username ?? username),
    accountDisplayName: info.accountDisplayName,
    serviceUrl: info.serviceUrl || serviceUrl,
    centerRegion: info.centerRegion,
  }
}

async function loginByInstance(
  info: StudioUrlInfo, username: string, password: string, instanceName: string,
): Promise<AuthResult> {
  const baseUrl = info.serviceUrl
  if (!baseUrl) throw new Error("service URL is required for instance login")
  const loginData = await loginWithPassword(baseUrl, username, password, instanceName)
  const jwt = loginData.token
  if (!jwt) throw new Error("INSTANCE_LOGIN_FAILED: jwt token missing")
  const jp = decodeJwtPayload(jwt)
  let userId = coerceInt(jp.userId ?? jp.user_id ?? loginData.userId)
  let tenantId = coerceInt(jp.accountId ?? jp.tenantId)
  let userName = String(jp.userName ?? username)

  if (!tenantId) {
    try {
      const user = await getCurrentUser(baseUrl, jwt)
      userId = userId || coerceInt(user.id)
      tenantId = coerceInt(user.accountId)
      userName = user.name || userName
    } catch { /* ignore */ }
  }
  if (!tenantId) throw new Error("INSTANCE_LOGIN_FAILED: tenant/account id not found")

  return {
    token: jwt,
    userId,
    tenantId,
    instanceId: loginData.instanceId,
    username: userName,
    accountDisplayName: info.accountDisplayName,
    serviceUrl: baseUrl,
    centerRegion: info.centerRegion,
  }
}

async function authenticate(
  info: StudioUrlInfo, username: string, password: string,
  instanceName: string | null, timeout: number,
): Promise<AuthResult> {
  if (info.urlType === "account") {
    const resolved = (instanceName || info.instanceName || "").trim()
    if (resolved && info.serviceUrl) {
      try { return await loginByInstance(info, username, password, resolved) } catch { /* fall through */ }
    }
    return loginByAccount(info, username, password, timeout)
  }
  if (info.urlType === "app") {
    const inst = (instanceName || info.instanceName || "").trim()
    if (!inst) throw new Error("instance_name is required for app URL")
    return loginByInstance(info, username, password, inst)
  }
  if (info.urlType === "api") {
    const inst = (instanceName || "").trim()
    if (inst) return loginByInstance(info, username, password, inst)
    // Fallback: use env_token as account for account-level login
    if (info.envToken) {
      const accountLoginUrl = `https://${info.envToken}.accounts.${info.rootDomain}`
      const { token, data, serviceUrl } = await loginWithPasswordRaw(
        info.envToken, username, password, accountLoginUrl, timeout,
      )
      const jp = decodeJwtPayload(token)
      return {
        token,
        userId: coerceInt(jp.userId ?? jp.user_id),
        tenantId: coerceInt(jp.accountId ?? jp.tenantId),
        instanceId: 0,
        username: String(jp.userName ?? data.username ?? username),
        accountDisplayName: info.envToken,
        serviceUrl: info.serviceUrl || serviceUrl,
        centerRegion: info.centerRegion,
      }
    }
    throw new Error("instance_name is required for api URL")
  }
  const inst = (instanceName || "").trim()
  if (inst) return loginByInstance(info, username, password, inst)
  throw new Error("unable to infer login mode from studio_url")
}

// ---------------------------------------------------------------------------
// Region / instance / workspace helpers
// ---------------------------------------------------------------------------

const PROD_REGIONS = [
  "cn-shanghai-alicloud", "ap-shanghai-tencentcloud", "ap-beijing-tencentcloud",
  "ap-guangzhou-tencentcloud", "ap-southeast-1-alicloud", "ap-southeast-1-aws",
  "kuaishou", "kuaishou-sgp", "gaotu-ap-beijing-tencentcloud",
]

interface CspItem { id: number; code: string; name: string }
interface RegionItem { region_id: number; region_key: string; region_name: string; csp_id: number; csp_code: string; csp_name: string }
interface InstanceItem { instance_id: number; instance_name: string; region_id: number; region_key?: string; region_name?: string }

async function apiGet<T>(baseUrl: string, token: string, path: string, timeout = 20000): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Clickzetta-Token": token,
    },
    signal: AbortSignal.timeout(timeout),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`)
  const body = await resp.json() as Record<string, unknown>
  return (body.data ?? body) as T
}

async function apiPost<T>(baseUrl: string, token: string, path: string, payload: unknown, timeout = 20000): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Clickzetta-Token": token,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeout),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`)
  const body = await resp.json() as Record<string, unknown>
  return (body.data ?? body) as T
}

async function loadRegionsForEnv(jwt: string, serviceUrl: string): Promise<RegionItem[]> {
  const regions: RegionItem[] = []
  try {
    const csps = await apiGet<CspItem[]>(serviceUrl, jwt, "/clickzetta-portal/csp/list")
    for (const csp of csps || []) {
      if (!csp.id) continue
      try {
        const rList = await apiGet<Record<string, unknown>[]>(
          serviceUrl, jwt,
          `/clickzetta-portal/region/list?cspId=${csp.id}`,
        )
        for (const r of rList || []) {
          regions.push({
            region_id: coerceInt(r.id),
            region_key: String(r.cregionId ?? ""),
            region_name: String(r.name ?? ""),
            csp_id: coerceInt(csp.id),
            csp_code: (csp.code || "").toUpperCase(),
            csp_name: csp.name || "",
          })
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return regions
}

async function loadRegions(auth: AuthResult): Promise<{ regions: RegionItem[]; resolvedEnv: string }> {
  let resolvedEnv = auth.centerRegion
  let regions = await loadRegionsForEnv(auth.token, auth.serviceUrl)

  if (!regions.length && ["dev", "sit", "uat"].includes(auth.centerRegion)) {
    // Probe prod regions as fallback
    for (const env of PROD_REGIONS) {
      const serviceUrl = toServiceUrl(serviceFromEnv(env, "clickzetta.com"))
      const found = await loadRegionsForEnv(auth.token, serviceUrl)
      if (found.length) {
        regions = found
        resolvedEnv = env
        break
      }
    }
  }

  // Deduplicate by region_id
  const seen = new Set<number>()
  const deduped = regions.filter((r) => {
    if (!r.region_id || seen.has(r.region_id)) return false
    seen.add(r.region_id)
    return true
  })
  return {
    regions: deduped.sort((a, b) => a.region_key.localeCompare(b.region_key) || a.region_id - b.region_id),
    resolvedEnv,
  }
}

async function loadInstances(auth: AuthResult): Promise<InstanceItem[]> {
  try {
    const data = await apiPost<Record<string, unknown>[]>(
      auth.serviceUrl, auth.token,
      "/clickzetta-portal/service/listInstances",
      { accountId: auth.tenantId },
    )
    return (data || [])
      .filter((item) => coerceInt(item.serviceId) === 1)
      .map((item) => ({
        instance_id: coerceInt(item.id),
        instance_name: String(item.name ?? ""),
        region_id: coerceInt(item.regionId),
      }))
      .sort((a, b) => a.instance_name.localeCompare(b.instance_name) || a.instance_id - b.instance_id)
  } catch { return [] }
}

function resolveRegion(hint: string, regions: RegionItem[]): RegionItem | undefined {
  const raw = hint.trim()
  if (!raw) return undefined
  if (/^\d+$/.test(raw)) {
    const rid = parseInt(raw, 10)
    return regions.find((r) => r.region_id === rid)
  }
  const alias = getRegionByAlias(raw) || raw
  const lower = alias.toLowerCase()
  return regions.find((r) => r.region_key.toLowerCase() === lower)
    ?? regions.find((r) => r.region_name.toLowerCase() === raw.toLowerCase())
}

async function ensureIdentity(auth: AuthResult): Promise<AuthResult> {
  if (auth.userId && auth.tenantId) return auth
  const baseUrl = (auth.serviceUrl || "").replace(/\/$/, "")
  if (!baseUrl) throw new Error("failed to resolve tenant/account id")
  const user = await getCurrentUser(baseUrl, auth.token)
  const userId = auth.userId || coerceInt(user.id)
  const tenantId = auth.tenantId || coerceInt(user.accountId)
  if (!tenantId) throw new Error("failed to resolve tenant/account id")
  return { ...auth, userId, tenantId, username: user.name || auth.username }
}

// PLACEHOLDER_CHUNK_4

async function listWorkspacesForInstance(
  auth: AuthResult, instanceName: string, instanceId: number, regionKey: string,
): Promise<{ workspace_name: string; workspace_id: string; project_id: number }[]> {
  const fixed = await ensureIdentity(auth)
  const rows = await listUserWorkspaces(
    fixed.serviceUrl, fixed.token, fixed.userId, fixed.tenantId,
    instanceId, instanceName,
  )
  return (rows || [])
    .map((row) => {
      const rawRow = row as unknown as Record<string, unknown>
      const workspace_name = String(rawRow.workspaceName ?? rawRow.showName ?? rawRow.projectName ?? "").trim()
      const workspace_id = String(
        (Array.isArray(rawRow.workspaceIds) ? rawRow.workspaceIds[0] : undefined)
          ?? rawRow.workspaceId
          ?? "",
      ).trim()
      const project_id = coerceInt(rawRow.projectId)
      return workspace_name && workspace_id ? { workspace_name, workspace_id, project_id } : null
    })
    .filter((item): item is { workspace_name: string; workspace_id: string; project_id: number } => item !== null)
    .sort((a, b) => a.workspace_name.localeCompare(b.workspace_name))
}

function resolveServiceHost(serviceHost: string, regionKey: string): string {
  if (serviceHost) return serviceHost.replace(/^https?:\/\//, "")
  // Fallback: derive service URL from region key (matching Python's read_url from config.ini)
  const REGION_URL_MAP: Record<string, string> = {
    dev: "dev-api.clickzetta.com",
    sit: "sit-api.clickzetta.com",
    uat: "uat-api.clickzetta.com",
    "cn-shanghai-alicloud": "cn-shanghai-alicloud.api.clickzetta.com",
    "ap-southeast-1-alicloud": "ap-southeast-1-alicloud.api.singdata.com",
    "ap-shanghai-tencentcloud": "ap-shanghai-tencentcloud.api.clickzetta.com",
    "ap-beijing-tencentcloud": "ap-beijing-tencentcloud.api.clickzetta.com",
    "ap-guangzhou-tencentcloud": "ap-guangzhou-tencentcloud.api.clickzetta.com",
    "cn-north-1-aws": "cn-north-1-aws.api.clickzetta.com",
    "ap-southeast-1-aws": "ap-southeast-1-aws.api.singdata.com",
    kuaishou: "cz-account.corp.kuaishou.com/api",
    "kuaishou-sgp": "cz-sgp-account.corp.kuaishou.com/api",
    gaotu: "studio-bj-gaotu.clickzetta-inc.com/api",
    "gaotu-ap-beijing-tencentcloud": "studio-bj-gaotu.clickzetta-inc.com/api",
  }
  if (regionKey && regionKey in REGION_URL_MAP) return REGION_URL_MAP[regionKey]
  // Generic pattern: {regionKey}.api.clickzetta.com
  if (regionKey) return `${regionKey}.api.clickzetta.com`
  return ""
}

// ---------------------------------------------------------------------------
// Quickstart — decode base64 credential string and create a profile
// ---------------------------------------------------------------------------

const REGISTER_URLS = [
  "https://accounts.clickzetta.com/register?ref=cz-cli (China)",
  "https://accounts.singdata.com/register?ref=cz-cli (International)",
]

const INTERACTIVE_TIMEOUT_MS = 180_000 // 3 minutes

const QUICKSTART_EXEMPT_COMMANDS = new Set([
  "profile", "--help", "--version",
])

function shouldSkipQuickstart(args: string[]): boolean {
  if (args.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v")) {
    return true
  }
  for (const arg of args) {
    if (QUICKSTART_EXEMPT_COMMANDS.has(arg)) return true
    if (!arg.startsWith("-")) break
  }
  return false
}

function decodeCredentialString(encoded: string): Record<string, unknown> {
  const raw = encoded.trim()
  let decoded: string
  try {
    decoded = Buffer.from(raw, "base64").toString("utf-8")
  } catch (e) {
    throw new Error(`Invalid base64 string: ${e instanceof Error ? e.message : String(e)}`)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(decoded)
  } catch (e) {
    throw new Error(`Decoded content is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }

  const requiredKeys = ["instanceName", "accessToken"]
  const missing = requiredKeys.filter((k) => !payload[k])
  if (missing.length) {
    throw new Error(`Missing required fields in credential: ${missing.join(", ")}`)
  }
  return payload
}

function credentialToProfile(cred: Record<string, unknown>): ProfileEntry {
  const profile: ProfileEntry = {
    instance: String(cred.instanceName),
    workspace: String(cred.workspaceName ?? "default"),
    schema: String(cred.schema ?? "public"),
    vcluster: String(cred.virtualCluster ?? "default"),
    pat: String(cred.accessToken),
    service: String(cred.service ?? "dev-api.clickzetta.com"),
    protocol: String(cred.protocol ?? "https"),
  }
  if (cred.username) profile.username = String(cred.username)
  return profile
}

function saveCredentialAsProfile(
  credentialStr: string, profileName = "default", _skipVerify = false,
): Record<string, unknown> {
  const cred = decodeCredentialString(credentialStr)
  const profileData = credentialToProfile(cred)

  const profiles = loadProfiles()
  if (profiles[profileName]) {
    throw new Error(`Profile '${profileName}' already exists. Use a different name or delete it first.`)
  }

  profiles[profileName] = profileData
  saveProfiles(profiles)

  return {
    profile: profileName,
    instance: profileData.instance,
    workspace: profileData.workspace,
    schema: profileData.schema,
    vcluster: profileData.vcluster,
    is_default: Object.keys(profiles).length === 1,
  }
}

// ---------------------------------------------------------------------------
// Interactive quickstart
// ---------------------------------------------------------------------------

function hasAnyProfile(): boolean {
  const profiles = loadProfiles()
  return Object.keys(profiles).length > 0
}

// PLACEHOLDER_CHUNK_5

async function prompt(message: string): Promise<string | null> {
  if (!process.stdin.isTTY) return null
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        rl.close()
        reject(new Error("timeout"))
      }, INTERACTIVE_TIMEOUT_MS)
      rl.question(message, (answer) => {
        clearTimeout(timer)
        resolve(answer)
      })
    })
  } finally {
    rl.close()
  }
}

async function promptSelect(message: string, choices: { label: string; value: string }[]): Promise<string | null> {
  if (!process.stdin.isTTY) return null
  process.stderr.write(`\n${message}\n`)
  for (let i = 0; i < choices.length; i++) {
    process.stderr.write(`  ${i + 1}) ${choices[i].label}\n`)
  }
  const answer = await prompt("Enter choice (number): ")
  if (answer === null) return null
  const idx = parseInt(answer.trim(), 10) - 1
  if (idx >= 0 && idx < choices.length) return choices[idx].value
  return null
}

async function interactiveQuickstart(): Promise<boolean> {
  process.stderr.write("\nWelcome to cz-cli! No connection profile found.\n")
  process.stderr.write("Let's set one up so you can start using ClickZetta Lakehouse.\n\n")

  const hasAccount = await promptSelect(
    "Do you already have a ClickZetta Lakehouse account?",
    [
      { label: "Yes, I have an account", value: "yes" },
      { label: "No, I need to register", value: "no" },
      { label: "Skip for now", value: "skip" },
    ],
  )

  if (hasAccount === null) return false

  if (hasAccount === "skip") {
    process.stderr.write("\nSetup skipped. You can run `cz-cli setup` later to configure your connection.\n")
    return false
  }

  if (hasAccount === "no") {
    process.stderr.write("\nPlease register at one of the following URLs:\n\n")
    for (const url of REGISTER_URLS) {
      process.stderr.write(`  * ${url}\n`)
    }
    process.stderr.write("\nAfter registration you will receive a base64-encoded credential string.\n\n")
  }

  const credentialStr = await prompt("Paste your base64-encoded credential string: ")
  if (!credentialStr || !credentialStr.trim()) {
    process.stderr.write("No credential provided. You can run this later with:\n")
    process.stderr.write("  cz-cli profile quickstart --credential <YOUR_CREDENTIAL_STRING>\n")
    return false
  }

  try {
    const result = saveCredentialAsProfile(credentialStr.trim(), "default", true)
    process.stderr.write(`\nProfile 'default' created successfully!\n`)
    process.stderr.write(`  Instance:  ${result.instance}\n`)
    process.stderr.write(`  Workspace: ${result.workspace}\n`)
    process.stderr.write(`  Schema:    ${result.schema}\n\n`)
    return true
  } catch (e) {
    process.stderr.write(`\nError: ${e instanceof Error ? e.message : String(e)}\n`)
    process.stderr.write("Please check your credential string and try again with:\n")
    process.stderr.write("  cz-cli profile quickstart --credential <YOUR_CREDENTIAL_STRING>\n")
    return false
  }
}

/**
 * Check if profiles exist; if not, run interactive quickstart or emit error.
 * Called from the CLI entry point before dispatching subcommands.
 * Returns true if the quickstart ran (whether successful or not).
 */
export function maybeRunQuickstart(args: string[]): boolean {
  if (shouldSkipQuickstart(args)) return false

  if (hasAnyProfile()) return false

  // Non-interactive: emit structured error for AI agents
  if (!process.stdin.isTTY) {
    error(
      "NO_PROFILE",
      "No connection profile found. " +
      "Create one first by running: " +
      "cz-cli profile quickstart --credential <BASE64_CREDENTIAL_STRING>  " +
      "The credential string is a base64-encoded JSON containing: " +
      "instanceName, workspaceName, schema, virtualCluster, accessToken. " +
      "If the user does not have a Lakehouse account, direct them to register at: " +
      "https://accounts.clickzetta.com/register?ref=cz-cli (China) or " +
      "https://accounts.singdata.com/register?ref=cz-cli (International)",
      { format: "json" },
    )
    // error() calls process.exit, but TS doesn't know that
    return true
  }

  // Interactive TTY: run the guided flow (async, but we need sync return)
  // The caller should use maybeRunQuickstartAsync instead for proper async handling
  return true
}

/**
 * Async version of maybeRunQuickstart for use in async CLI entry points.
 */
export async function maybeRunQuickstartAsync(args: string[]): Promise<boolean> {
  if (shouldSkipQuickstart(args)) return false

  if (hasAnyProfile()) return false

  if (!process.stdin.isTTY) {
    error(
      "NO_PROFILE",
      "No connection profile found. " +
      "Create one first by running: " +
      "cz-cli profile quickstart --credential <BASE64_CREDENTIAL_STRING>  " +
      "The credential string is a base64-encoded JSON containing: " +
      "instanceName, workspaceName, schema, virtualCluster, accessToken. " +
      "If the user does not have a Lakehouse account, direct them to register at: " +
      "https://accounts.clickzetta.com/register?ref=cz-cli (China) or " +
      "https://accounts.singdata.com/register?ref=cz-cli (International)",
      { format: "json" },
    )
    return true
  }

  const ok = await interactiveQuickstart()
  if (!ok) process.exit(1)
  return true
}

// ---------------------------------------------------------------------------
// Common options builder
// ---------------------------------------------------------------------------

function bootstrapOptions<T>(y: Argv<T>) {
  return y
    .option("studio-url", { type: "string", demandOption: true, describe: "Studio URL (account, app, or api URL)" })
    .option("username", { type: "string", demandOption: true, describe: "Studio username" })
    .option("password", { type: "string", demandOption: true, describe: "Studio password" })
    .option("service", { type: "string", default: "", describe: "Service host override" })
    .option("instance", { type: "string", default: "", describe: "Explicit instance name" })
    .option("timeout", { type: "number", default: 20, describe: "HTTP timeout seconds" })
}

async function authFromOpts(argv: Record<string, unknown>): Promise<{ info: StudioUrlInfo; auth: AuthResult }> {
  const info = parseStudioUrl(
    argv["studio-url"] as string,
    (argv.service as string) || undefined,
  )
  const auth = await authenticate(
    info,
    argv.username as string,
    argv.password as string,
    (argv.instance as string) || null,
    argv.timeout as number,
  )
  return { info, auth }
}

// ---------------------------------------------------------------------------
// Yargs sub-commands
// ---------------------------------------------------------------------------

export function registerBootstrapCommands(yargs: Argv<GlobalArgs>): void {
  yargs
    .command(
      "discover",
      "Authenticate via Studio URL and discover regions + instances",
      (y) => bootstrapOptions(y),
      async (argv) => {
        const format = argv.format
        try {
          const { info, auth } = await authFromOpts(argv)
          const authMode = info.urlType === "account" ? "account_login"
            : ["app", "api"].includes(info.urlType) ? "login_single" : "unknown"

          const { regions, resolvedEnv } = await loadRegions(auth)
          const regionById = new Map(regions.map((r) => [r.region_id, r]))

          let instances: InstanceItem[] = []
          let instancesNote: string | undefined
          if (auth.tenantId) {
            try {
              instances = await loadInstances(auth)
              for (const item of instances) {
                const region = regionById.get(item.region_id)
                if (region) {
                  item.region_key = region.region_key
                  item.region_name = region.region_name
                }
              }
            } catch (e) {
              instancesNote = e instanceof Error ? e.message : String(e)
            }
          } else {
            instancesNote = "tenant_id unavailable; select a region then use list-workspaces"
          }

          const result: Record<string, unknown> = {
            url_info: {
              url_type: info.urlType, auth_mode: authMode,
              studio_host: info.host,
              account_display_name: info.accountDisplayName,
              instance_from_url: info.instanceName,
              service: info.serviceHost || null,
              center_region: resolvedEnv,
            },
            auth: { user_id: auth.userId, tenant_id: auth.tenantId, username: auth.username },
            regions, instances,
            defaults: { schema: "public", vcluster: "default" },
          }
          if (instancesNote) result.instances_note = instancesNote
          logOperation("profile discover", { ok: true })
          success(result, { format })
        } catch (err) {
          logOperation("profile discover", { ok: false, errorCode: "BOOTSTRAP_ERROR" })
          error("BOOTSTRAP_ERROR", err instanceof Error ? err.message : String(err), { format })
        }
      },
    )
    .command(
      "list-workspaces",
      "List workspaces for a region",
      (y) => bootstrapOptions(y).option("region", { type: "string", demandOption: true, describe: "Region id or alias" }),
      async (argv) => {
        const format = argv.format
        try {
          const { info, auth } = await authFromOpts(argv)
          const { regions, resolvedEnv } = await loadRegions(auth)
          const target = resolveRegion(argv.region as string, regions)
          if (!target) throw new Error(`region '${argv.region}' not found`)

          const regionKey = target.region_key || resolvedEnv
          const resolvedService = resolveServiceHost(info.serviceHost, regionKey)
          let fixedAuth = auth
          if (resolvedService && !auth.serviceUrl) {
            fixedAuth = { ...auth, serviceUrl: toServiceUrl(resolvedService) }
          }

          const instances = await loadInstances(fixedAuth)
          let targetInstances = instances.filter((i) => i.region_id === target.region_id)
          const instFilter = (argv.instance as string || "").trim()
          if (instFilter) targetInstances = targetInstances.filter((i) => i.instance_name === instFilter)

          const workspacesByInstance: Record<string, unknown[]> = {}
          for (const inst of targetInstances) {
            if (!inst.instance_name || !inst.instance_id) continue
            try {
              workspacesByInstance[inst.instance_name] = await listWorkspacesForInstance(
                fixedAuth, inst.instance_name, inst.instance_id, regionKey,
              )
            } catch { workspacesByInstance[inst.instance_name] = [] }
          }

          logOperation("profile list-workspaces", { ok: true })
          success({ region: target, instances: targetInstances, workspaces_by_instance: workspacesByInstance }, { format })
        } catch (err) {
          logOperation("profile list-workspaces", { ok: false, errorCode: "BOOTSTRAP_ERROR" })
          error("BOOTSTRAP_ERROR", err instanceof Error ? err.message : String(err), { format })
        }
      },
    )
    .command(
      "render-command",
      "Generate a `cz-cli profile create` command from discovered metadata",
      (y) =>
        bootstrapOptions(y)
          .option("region", { type: "string", demandOption: true, describe: "Region id or alias" })
          .option("workspace", { type: "string", demandOption: true, describe: "Workspace name" })
          .option("profile-name", { type: "string", default: "default", describe: "Profile name to create" })
          .option("schema", { type: "string", default: "public", describe: "Schema" })
          .option("vcluster", { type: "string", default: "default", describe: "Virtual cluster" })
          .option("include-secret", { type: "boolean", default: false, describe: "Include plain password" }),
      async (argv) => {
        const format = argv.format
        try {
          const { info, auth } = await authFromOpts(argv)
          const { regions, resolvedEnv } = await loadRegions(auth)
          const target = resolveRegion(argv.region as string, regions)
          if (!target) throw new Error(`region '${argv.region}' not found`)

          const instances = await loadInstances(auth)
          let targetInstances = instances.filter((i) => i.region_id === target.region_id)
          const instFilter = (argv.instance as string || "").trim()
          if (instFilter) targetInstances = targetInstances.filter((i) => i.instance_name === instFilter)
          if (!targetInstances.length) throw new Error("no instance found for selected region")
          if (targetInstances.length > 1 && !instFilter) {
            const names = targetInstances.map((i) => i.instance_name).join(", ")
            throw new Error(`multiple instances found, pass --instance explicitly: ${names}`)
          }

          const inst = targetInstances[0]
          const regionKey = target.region_key || resolvedEnv
          const resolvedService = resolveServiceHost(info.serviceHost, regionKey)
          const profileName = argv["profile-name"] as string
          const workspace = argv.workspace as string
          const schema = argv.schema as string
          const vcluster = argv.vcluster as string
          const pw = argv["include-secret"] ? quote(argv.password as string) : "<YOUR_PASSWORD>"

          const cmd = [
            `cz-cli profile create ${quote(profileName)}`,
            `--username ${quote(argv.username as string)}`,
            `--password ${pw}`,
            `--instance ${quote(inst.instance_name)}`,
            `--workspace ${quote(workspace)}`,
            `--service ${quote(resolvedService)}`,
            `--schema ${quote(schema)}`,
            `--vcluster ${quote(vcluster)}`,
          ].join(" ")

          logOperation("profile render-command", { ok: true })
          success({
            profile: profileName, service: resolvedService,
            region: target,
            instance: { instance_name: inst.instance_name, instance_id: inst.instance_id },
            workspace, schema, vcluster, command: cmd,
          }, { format })
        } catch (err) {
          logOperation("profile render-command", { ok: false, errorCode: "BOOTSTRAP_ERROR" })
          error("BOOTSTRAP_ERROR", err instanceof Error ? err.message : String(err), { format })
        }
      },
    )
    .command(
      "quickstart",
      "First-time onboarding: decode a Lakehouse credential string and create a profile",
      (y) => y
        .option("credential", { type: "string", describe: "Base64-encoded credential string from Lakehouse registration" })
        .option("profile-name", { type: "string", default: "default", describe: "Profile name to create" })
        .option("skip-verify", { type: "boolean", default: false, describe: "Skip connection verification" }),
      async (argv) => {
        const format = argv.format
        const credentialStr = argv.credential as string | undefined
        const profileName = argv["profile-name"] as string
        const skipVerify = argv["skip-verify"] as boolean

        // No credential provided: show registration guidance
        if (!credentialStr) {
          const result = {
            message: "No Lakehouse credential provided. Please register for an account first.",
            register_urls: REGISTER_URLS,
            next_step: "After registration you will receive a base64-encoded credential string. " +
              "Run: cz-cli profile quickstart --credential <YOUR_CREDENTIAL_STRING>",
          }
          logOperation("profile quickstart", { ok: true })
          success(result, { format })
          return
        }

        // Decode and create profile
        try {
          const result = saveCredentialAsProfile(credentialStr, profileName, skipVerify)
          logOperation("profile quickstart", { ok: true })
          success({
            message: `Profile '${profileName}' created successfully from credential string.`,
            ...result,
          }, { format })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg.includes("already exists")) {
            logOperation("profile quickstart", { ok: false, errorCode: "PROFILE_EXISTS" })
            error("PROFILE_EXISTS", msg, { format })
          } else if (msg.includes("Invalid base64") || msg.includes("not valid JSON") || msg.includes("Missing required")) {
            logOperation("profile quickstart", { ok: false, errorCode: "INVALID_CREDENTIAL" })
            error("INVALID_CREDENTIAL", msg, { format })
          } else {
            logOperation("profile quickstart", { ok: false, errorCode: "INTERNAL_ERROR" })
            error("INTERNAL_ERROR", msg, { format })
          }
        }
      },
    )
}

// ---------------------------------------------------------------------------
// Top-level setup command — preferred entry point for first-time onboarding
// ---------------------------------------------------------------------------

export function registerSetupCommand(yargs: Argv<GlobalArgs>): void {
  yargs.command(
    "setup",
    "First-time setup: create a Lakehouse connection profile",
    (y) => y
      .option("credential", { type: "string", describe: "Base64-encoded credential string from Lakehouse registration" })
      .option("profile-name", { type: "string", default: "default", describe: "Profile name to create" })
      .option("skip-verify", { type: "boolean", default: false, describe: "Skip connection verification" }),
    async (argv) => {
      const format = argv.format
      const credentialStr = argv.credential as string | undefined
      const profileName = argv["profile-name"] as string
      const skipVerify = argv["skip-verify"] as boolean

      // Branch 1: credential provided — decode and create profile directly
      if (credentialStr) {
        try {
          const result = saveCredentialAsProfile(credentialStr, profileName, skipVerify)
          logOperation("setup", { ok: true })
          success({
            message: `Profile '${profileName}' created successfully from credential string.`,
            ...result,
          }, { format })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg.includes("already exists")) {
            logOperation("setup", { ok: false, errorCode: "PROFILE_EXISTS" })
            error("PROFILE_EXISTS", msg, { format })
          } else if (msg.includes("Invalid base64") || msg.includes("not valid JSON") || msg.includes("Missing required")) {
            logOperation("setup", { ok: false, errorCode: "INVALID_CREDENTIAL" })
            error("INVALID_CREDENTIAL", msg, { format })
          } else {
            logOperation("setup", { ok: false, errorCode: "INTERNAL_ERROR" })
            error("INTERNAL_ERROR", msg, { format })
          }
        }
        return
      }

      // Branch 2: interactive TTY — run guided onboarding
      if (process.stdin.isTTY) {
        const ok = await interactiveQuickstart()
        if (!ok) process.exit(1)
        return
      }

      // Branch 3: non-TTY without credential — output guidance JSON and exit
      logOperation("setup", { ok: false, errorCode: "NO_CREDENTIAL" })
      error("NO_CREDENTIAL", "Non-interactive environment detected. Provide --credential to create a profile.", {
        format,
        extra: {
          register_urls: REGISTER_URLS,
          next_step: "cz-cli setup --credential <BASE64_CREDENTIAL_STRING>",
        },
      })
      process.exit(1)
    },
  )
}

function quote(s: string): string {
  if (/^[a-zA-Z0-9._/-]+$/.test(s)) return s
  return `'${s.replace(/'/g, "'\\''")}'`
}
