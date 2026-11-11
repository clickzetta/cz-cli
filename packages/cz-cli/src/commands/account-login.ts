import { constants, publicEncrypt } from "node:crypto"
import { toServiceUrl } from "@clickzetta/sdk"
import { CLICKZETTA_HOST_SUFFIXES, isClickzettaHost } from "../llm/clickzetta-hosts.js"

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
  // cz_change: reads the shared suffix list rather than restating it. This site
  // and isClickzettaGatewayUrl carried identical lists until the latter fell
  // behind on `.singdata.com`. See llm/clickzetta-hosts.ts.
  for (const suffix of CLICKZETTA_HOST_SUFFIXES) {
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

/**
 * A REGION segment, not an environment: `cn-shanghai-alicloud`,
 * `ap-southeast-1-aws`, and so on. Accounts sites are global — there is no
 * `<account>.cn-shanghai-alicloud-accounts.clickzetta.com` — so a region must not
 * be carried into the accounts host the way `dev`/`uat` are.
 *
 * Verified against production: `bxhzbghd.accounts.clickzetta.com` resolves,
 * `bxhzbghd.cn-shanghai-alicloud-accounts.clickzetta.com` is NXDOMAIN.
 */
const REGION_PREFIX_RE = /^(?:cn|ap|us|eu)-/i

/**
 * The deployment environment encoded in an API host (`uat-api.…` → `uat`), or ""
 * for production. Region-prefixed hosts return "" because they ARE production.
 */
export function serviceEnvFromApiHost(host: string): string {
  const hyphenEnv = host.match(/^([^.]+)-api\./)
  if (hyphenEnv?.[1]) return REGION_PREFIX_RE.test(hyphenEnv[1]) ? "" : hyphenEnv[1]
  const dottedEnv = host.match(/^([^.]+)\.api\./)
  if (dottedEnv?.[1]) return REGION_PREFIX_RE.test(dottedEnv[1]) ? "" : dottedEnv[1]
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

/** Where the accounts console keeps the top-up form, relative to the site root. */
const TOP_UP_PATH = "/billing/balance/topUp"

/**
 * cz_change: turn an accounts-console origin into a link that lands the user ON
 * the top-up form.
 *
 * The site root is not good enough for a billing block. A user sent to
 * `https://<account>.accounts.clickzetta.com` arrives at the console home and has
 * to find the top-up form themselves — and, if not signed in, gets bounced to a
 * login page that then drops them at the home page rather than where they were
 * going. The console's own answer is the `fallback` parameter: sign in, then
 * redirect. So the link we hand out is the login route with the top-up page as its
 * fallback, which works signed-in and signed-out alike.
 *
 * Encoding matches the console's own form — the origin is percent-encoded (it
 * carries the `:` and `//` that genuinely need it) while the fallback's path stays
 * literal. `/` is legal unencoded in a query value per RFC 3986, and reproducing
 * the format the app itself emits is the safer bet against a redirect handler we
 * cannot test.
 *
 * Deliberately NOT folded into accountLoginUrlForService: that function's result
 * is a base other callers append to (`${url}/login`, the console meta endpoint in
 * loadAccountConsoleMeta) and is shown by `profile`/`setup` as the plain web login
 * URL. Returning a deep link from it would corrupt all three.
 */
export function accountTopUpUrl(siteUrl: string): string {
  const origin = siteUrl.replace(/\/+$/, "")
  return `${origin}/login?fallback=${encodeURIComponent(origin)}${TOP_UP_PATH}`
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

async function loadAccountConsoleMeta(
  accountLoginUrl: string,
  timeoutMs = 20_000,
  redirect: RequestRedirect = "follow",
): Promise<AccountConsoleMeta | null> {
  const response = await fetch(
    `${accountLoginUrl}/one-combo-api/configCenter/script/getApolloConfig?dataId=clickzetta-fe-console&globalVarName=__clickzettaFeConsoleMeta__`,
    {
      headers: { accept: "*/*" },
      redirect,
      signal: AbortSignal.timeout(timeoutMs),
    },
  )
  if (!response.ok) return null
  return parseAccountConsoleMeta(await response.text())
}

/**
 * The password was accepted but the account requires multi-factor verification.
 * Callers know the endpoint the user chose and turn this into guidance for it.
 */
export class AccountMfaRequiredError extends Error {
  constructor() {
    super(
      "ACCOUNT_MFA_REQUIRED: the password is correct but this account requires multi-factor verification. " +
        "Sign in with the browser instead: cz-cli auth login <name>",
    )
    this.name = "AccountMfaRequiredError"
  }
}

function requiresMfa(payload: Record<string, unknown>): boolean {
  const data = payload.data
  return isRecord(data) && isRecord(data.mfaStatus) && Boolean(data.mfaStatus.enable)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * The derived `<account>.accounts.<root>` site for an API endpoint, or null when
 * the endpoint is not one we may send a password to on a guess. Only ClickZetta
 * owned hosts qualify (the root-domain guess for any other host lands on a domain
 * the user never named), and only over https.
 */
export function derivedAccountSiteForService(service: string, accountName: string): string | null {
  const parsed = parseApiService(service)
  if (!isSafeAccountLabel(accountName)) return null
  if (!parsed || parsed.protocol !== "https:" || !isClickzettaHost(parsed.hostname)) return null
  // Built from the parsed host and port only, never from the raw string.
  return accountLoginUrlForService(`https://${parsed.host}`, accountName)
}

/** A single DNS label: the only shape an account name may take inside a derived host. */
export function isSafeAccountLabel(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name.toLowerCase())
}

/**
 * Last line of defense for the API-endpoint fallback, independent of how the URL
 * was built: the site that will receive the password must be exactly the origin
 * the user named, or the derived accounts host of a ClickZetta https endpoint.
 */
export function assertSafeAccountSite(accountLoginUrl: string, service: string, accountName: string): void {
  const reject = (reason: string): never => {
    throw new Error(`ACCOUNT_LOGIN_FAILED: refusing to send the password to an unexpected account site (${reason}). Pass --instance <name> to log in to a specific instance instead.`)
  }
  const site = URL.parse(accountLoginUrl)
  const own = parseApiService(service)
  if (!site || !own) return reject("invalid url")
  if (site.username || site.password || site.search || site.hash) return reject("url carries extra components")
  if (site.pathname !== "/" && site.pathname !== "") return reject("url carries a path")
  if (accountLoginUrl.replace(/\/+$/, "") !== site.origin) return reject("url is not a plain origin")
  if (site.origin === own.origin) return
  if (site.protocol !== "https:" || !isClickzettaHost(site.hostname)) return reject("not an https ClickZetta host")
  const expected = derivedAccountSiteForService(service, accountName)
  if (!expected || URL.parse(expected)?.origin !== site.origin) return reject("host is not the derived accounts host")
}

/**
 * Parse a user-supplied API service once, so every later decision (probe, derive,
 * send the password) is made on the host a URL parser resolves. `splitEndpoint`
 * only splits on `/`, so `evil?x-api.clickzetta.com` looks like a ClickZetta host
 * as a string while its real host is `evil`. Returns null when anything could move
 * the host: a query, fragment or userinfo, or an authority that the parser changed
 * (backslash, space, `?`, `#`, `@`, a default port, and so on).
 */
export function parseApiService(service: string): URL | null {
  const raw = service.trim()
  const hasScheme = /^https?:\/\//i.test(raw)
  const authority = (hasScheme ? raw.replace(/^https?:\/\//i, "") : raw).split("/")[0]!
  const parsed = URL.parse(hasScheme ? raw : `https://${raw}`)
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) return null
  if (parsed.search || parsed.hash || parsed.username || parsed.password) return null
  if (authority.toLowerCase() !== parsed.host || parsed.hostname.endsWith(".")) return null
  return parsed
}

/**
 * The accounts site that authenticates an account reached through an API endpoint,
 * or null when there is no site the password may safely go to.
 *
 * Path-style private deployments serve the console, and its root `/login`, on the
 * same host as the API (`https://studio.example.com/api` → `https://studio.example.com`).
 * Public cloud keeps it on `<account>.accounts.<root>`. The console meta script
 * only exists where a console is served, so its presence on the endpoint's own
 * origin (a host the user named) tells the two apart. Otherwise only the derived
 * host of a ClickZetta-owned endpoint is used; `derived` marks that case so the
 * caller can refuse to send the password unencrypted.
 */
export async function accountSiteForApiService(
  service: string,
  accountName: string,
): Promise<{ url: string; derived: boolean } | null> {
  const parsed = parseApiService(service)
  if (!parsed) return null
  const meta = await loadAccountConsoleMeta(parsed.origin, 5_000, "error").catch(() => null)
  if (meta) return { url: parsed.origin, derived: false }
  const derived = derivedAccountSiteForService(service, accountName)
  return derived ? { url: derived, derived: true } : null
}

export async function loginByAccountSite(
  accountName: string,
  username: string,
  password: string,
  serviceOrHost: string,
  timeoutMs = 20_000,
  accountLoginUrlOverride?: string,
  options: { requireEncryptKey?: boolean } = {},
): Promise<AccountSiteLoginResult> {
  const accountLoginUrl = accountLoginUrlOverride || accountLoginUrlForService(serviceOrHost, accountName)
  const strict = Boolean(options.requireEncryptKey)
  if (strict) assertSafeAccountSite(accountLoginUrl, serviceOrHost, accountName)
  const meta = await loadAccountConsoleMeta(accountLoginUrl, 20_000, strict ? "error" : "follow")
  const fallbackServiceHost = serviceHostFromInput(accountLoginUrlOverride ? stripProtocol(accountLoginUrlOverride) : stripProtocol(serviceOrHost))
  const serviceHost = stripProtocol(meta?.apiGateway || "") || fallbackServiceHost
  // Without a public key the password would travel in plaintext to a host the
  // user did not name; callers on a guessed host refuse that.
  if (options.requireEncryptKey && !meta?.encryptKey) {
    throw new Error(
      "ACCOUNT_LOGIN_FAILED: the account-site login needs the console's encryption key and this site did not provide one, " +
        "so the password was not sent. Pass --instance <name> to log in to a specific instance instead.",
    )
  }
  const payloadPassword = meta?.encryptKey ? encryptPassword(password, meta.encryptKey) : password
  const response = await fetch(`${accountLoginUrl}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
    },
    body: JSON.stringify({ username, password: payloadPassword, accountDisplayName: accountName }),
    redirect: strict ? "error" : "follow",
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`ACCOUNT_LOGIN_FAILED: HTTP ${response.status}`)
  const payload = await response.json() as Record<string, unknown>
  const code = String(payload.code ?? "")
  if (!["0", "200"].includes(code)) {
    throw new Error(`ACCOUNT_LOGIN_FAILED: ${String(payload.message ?? "login failed")}`)
  }
  const token = extractJwtFromResponse(response.headers, payload)
  if (!token && requiresMfa(payload)) {
    // The console answers a correct password for an MFA account with code 0, no
    // token and data.mfaStatus.enable; finishing needs an SMS/e-mail code behind an
    // image captcha, or an authenticator code, which this flow cannot collect.
    throw new AccountMfaRequiredError()
  }
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
