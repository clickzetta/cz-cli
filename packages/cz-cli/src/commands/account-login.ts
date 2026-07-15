import { constants, publicEncrypt } from "node:crypto"
import { toServiceUrl } from "@clickzetta/sdk"

interface AccountConsoleMeta {
  apiGateway: string
  encryptKey: string
}

interface AccountSiteLoginResult {
  accountLoginUrl: string
  data: Record<string, unknown>
  payload: Record<string, unknown>
  serviceHost: string
  serviceUrl: string
  token: string
}

export function splitEndpoint(value: string): { host: string; protocol: string } {
  const raw = value.trim()
  if (!raw) return { host: "", protocol: "https" }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const parsed = new URL(raw)
    return { host: parsed.host.toLowerCase(), protocol: parsed.protocol.replace(/:$/, "") || "https" }
  }
  return { host: raw.replace(/^\/+|\/+$/g, "").split("/")[0]!.toLowerCase(), protocol: "https" }
}

export function stripProtocol(value: string): string {
  return splitEndpoint(value).host
}

export function extractRootDomain(host: string): string {
  for (const suffix of [".clickzetta.com", ".singdata.com", ".clickzetta-inc.com"]) {
    if (host.endsWith(suffix)) return suffix.slice(1)
  }
  const parts = host.split(".")
  return parts.length >= 2 ? parts.slice(-2).join(".") : host
}

function serviceHostFromEnv(env: string, rootDomain: string): string {
  if (!env) return `api.${rootDomain}`
  return ["dev", "sit", "uat"].includes(env) ? `${env}-api.${rootDomain}` : `${env}.api.${rootDomain}`
}

function isAccountConsoleHost(host: string): boolean {
  return host.startsWith("accounts.")
    || host.includes(".accounts.")
    || host.includes("-accounts.")
}

function bareAccountConsoleHost(host: string): string {
  if (host.startsWith("accounts.")) return host
  const accountSpecific = host.match(/^[^.]+\.(accounts\..+)$/)
  if (accountSpecific) return accountSpecific[1]!
  const envSpecific = host.match(/^[^.]+\.([^.]+-accounts\..+)$/)
  if (envSpecific) return envSpecific[1]!
  const dottedEnv = host.match(/^[^.]+\.([^.]+\.accounts\..+)$/)
  if (dottedEnv) return dottedEnv[1]!
  return host
}

function serviceHostFromAccountConsoleHost(host: string): string {
  const bareHost = bareAccountConsoleHost(host)
  const rootDomain = extractRootDomain(bareHost)
  if (bareHost.startsWith("accounts.")) return `api.${rootDomain}`
  const envHyphen = bareHost.match(/^([^.]+)-accounts\./)
  if (envHyphen?.[1]) return serviceHostFromEnv(envHyphen[1], rootDomain)
  const envDotted = bareHost.match(/^([^.]+)\.accounts\./)
  if (envDotted?.[1]) return serviceHostFromEnv(envDotted[1], rootDomain)
  return bareHost
}

function serviceHostFromInput(host: string): string {
  if (isAccountConsoleHost(host)) return serviceHostFromAccountConsoleHost(host)
  return host
}

export function serviceEnvFromApiHost(host: string): string {
  const hyphenEnv = host.match(/^([^.]+)-api\./)
  if (hyphenEnv?.[1]) return hyphenEnv[1]
  const dottedEnv = host.match(/^([^.]+)\.api\./)
  if (dottedEnv?.[1]) return dottedEnv[1]
  return ""
}

function normalizedAccountConsoleHost(host: string, accountName: string): string {
  const bareHost = bareAccountConsoleHost(host)
  return bareHost === host ? `${accountName}.${bareHost}` : `${accountName}.${bareHost}`
}

export function accountLoginUrlForService(service: string, accountName: string): string {
  const { host, protocol } = splitEndpoint(service)
  if (isAccountConsoleHost(host)) {
    return `${protocol}://${normalizedAccountConsoleHost(host, accountName)}`
  }
  const rootDomain = extractRootDomain(host)
  const env = serviceEnvFromApiHost(host)
  const accountHost = env ? `${accountName}.${env}-accounts.${rootDomain}` : `${accountName}.accounts.${rootDomain}`
  return `${protocol}://${accountHost}`
}

function extractAssignedJsonObject(script: string, globalVarName: string): string {
  const marker = `${globalVarName} =`
  const start = script.indexOf(marker)
  if (start < 0) throw new Error(`Missing ${globalVarName} in config script`)
  const braceStart = script.indexOf("{", start)
  if (braceStart < 0) throw new Error(`Missing JSON object for ${globalVarName}`)
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = braceStart; index < script.length; index++) {
    const char = script[index]!
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === "\"") inString = false
      continue
    }
    if (char === "\"") {
      inString = true
      continue
    }
    if (char === "{") {
      depth += 1
      continue
    }
    if (char !== "}") continue
    depth -= 1
    if (depth === 0) return script.slice(braceStart, index + 1)
  }
  throw new Error(`Unterminated JSON object for ${globalVarName}`)
}

export function parseAccountConsoleMeta(script: string): AccountConsoleMeta {
  const parsed = JSON.parse(extractAssignedJsonObject(script, "__clickzettaFeConsoleMeta__")) as Record<string, unknown>
  return {
    apiGateway: String(parsed.apiGateway ?? "").trim(),
    encryptKey: String(parsed.encryptKey ?? "").trim(),
  }
}

function publicKeyToPem(base64Key: string): string {
  const body = base64Key.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? ""
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`
}

function encryptPassword(password: string, encryptKey: string): string {
  return publicEncrypt(
    {
      key: publicKeyToPem(encryptKey),
      padding: constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(password, "utf-8"),
  ).toString("base64")
}

function extractJwtFromResponse(headers: Headers, payload: Record<string, unknown>): string {
  const data = (payload.data ?? {}) as Record<string, unknown>
  const setCookie = headers.get("set-cookie") || ""
  const cookieMatch = setCookie.match(/(?:X-ClickZetta-Token|x-clickzetta-token)=([^;]+)/)
  return [
    headers.get("x-refresh-jwt") || "",
    headers.get("x-clickzetta-token") || "",
    String(data.token ?? ""),
    String(data.jwt ?? ""),
    String(data.accessToken ?? ""),
    String(payload.token ?? ""),
    cookieMatch?.[1] ?? "",
  ].find((value) => value.trim())?.trim() ?? ""
}

async function loadAccountConsoleMeta(accountLoginUrl: string): Promise<AccountConsoleMeta | null> {
  const response = await fetch(
    `${accountLoginUrl}/one-combo-api/configCenter/script/getApolloConfig?dataId=clickzetta-fe-console&globalVarName=__clickzettaFeConsoleMeta__`,
    {
      headers: { accept: "*/*" },
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (!response.ok) return null
  return parseAccountConsoleMeta(await response.text())
}

export async function loginByAccountSite(
  accountName: string,
  username: string,
  password: string,
  serviceOrHost: string,
  timeoutMs = 20_000,
  accountLoginUrlOverride?: string,
): Promise<AccountSiteLoginResult> {
  const accountLoginUrl = accountLoginUrlOverride || accountLoginUrlForService(serviceOrHost, accountName)
  const meta = await loadAccountConsoleMeta(accountLoginUrl)
  const fallbackServiceHost = serviceHostFromInput(accountLoginUrlOverride ? stripProtocol(accountLoginUrlOverride) : stripProtocol(serviceOrHost))
  const serviceHost = stripProtocol(meta?.apiGateway || "") || fallbackServiceHost
  const payloadPassword = meta?.encryptKey ? encryptPassword(password, meta.encryptKey) : password
  const response = await fetch(`${accountLoginUrl}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
    },
    body: JSON.stringify({ username, password: payloadPassword, accountDisplayName: accountName }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`ACCOUNT_LOGIN_FAILED: HTTP ${response.status}`)
  const payload = await response.json() as Record<string, unknown>
  const code = String(payload.code ?? "")
  if (!["0", "200"].includes(code)) {
    throw new Error(`ACCOUNT_LOGIN_FAILED: ${String(payload.message ?? "login failed")}`)
  }
  const token = extractJwtFromResponse(response.headers, payload)
  if (!token) throw new Error("ACCOUNT_LOGIN_FAILED: token not found in login response")
  return {
    accountLoginUrl,
    token,
    payload,
    data: (payload.data ?? {}) as Record<string, unknown>,
    serviceHost,
    serviceUrl: toServiceUrl(serviceHost),
  }
}
