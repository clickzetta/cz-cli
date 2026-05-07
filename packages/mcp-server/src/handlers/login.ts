/**
 * login.ts — port of cz-mcp-server/cz_mcp/handlers/login_server.py
 *
 * Python → TS mapping:
 *   login_server.py:12-83   login_wrapper      → loginWrapper
 *   login_server.py:88-108  get_instance_id    → getInstanceId
 *   login_server.py:111-118 get_data           → getData
 *   login_server.py:121-160 get_user_id        → getUserId
 *   login_server.py:162-191 get_current_user   → getCurrentUser
 *   login_server.py:193-226 get_user_config    → getUserConfig
 */

import { logger } from "../logger.js"
import { PermissionException, ToolExecutionException } from "../server.js"
import { readUrl, readApi } from "../utils/config.js"

// login_server.py:12-83
export async function loginWrapper(
  instance: string,
  opts: { pat?: string; username?: string; password?: string; url?: string },
): Promise<{ token: string; instance_id: number; user_id: number; expire_time: number }> {
  const { pat, username, password, url } = opts
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "Accept": "application/json, text/plain, */*",
  }

  let jsonData: Record<string, unknown>
  let authMode: string
  if (username && password) {
    jsonData = { username, password, instanceName: instance }
    authMode = "password"
  } else if (pat) {
    jsonData = { accessToken: pat, instanceName: instance }
    authMode = "pat"
  } else {
    throw new PermissionException("Either pat or username/password must be provided for login")
  }

  const baseUrl = url ?? readUrl()
  const path = readApi("USER_LOGIN_SINGLE")
  const fullUrl = baseUrl + path

  logger.info({ fullUrl }, "Attempting login")
  if (authMode === "password") {
    logger.info({ instance, username }, "Login parameters")
  } else {
    logger.info({ instance, pat: pat ? "***" + pat.slice(-8) : "None" }, "Login parameters")
  }

  try {
    const resp = await fetch(fullUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(jsonData),
      signal: AbortSignal.timeout(10_000),
    })
    const text = await resp.text()
    const data = JSON.parse(text) as Record<string, unknown>
    const code = getData(data, "$.code")
    if (code !== 0) {
      logger.error({ response: text }, "Login failed")
      throw new ToolExecutionException(`User login failed: ${text}`)
    }
    const token = getData(data, "$.data.token") as string
    if (!token) {
      throw new PermissionException(`Token not found in login response: ${text}`)
    }
    return {
      token,
      instance_id: getData(data, "$.data.instanceId") as number,
      user_id: getData(data, "$.data.userId") as number,
      expire_time: getData(data, "$.data.expireTime") as number,
    }
  } catch (e) {
    if (e instanceof PermissionException || e instanceof ToolExecutionException) throw e
    throw new PermissionException(`Login request failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// login_server.py:88-108
export async function getInstanceId(
  token: string,
  instanceName: string,
  env?: string,
): Promise<number | null> {
  const headers: Record<string, string> = {
    "accept": "application/json, text/plain, */*",
    "x-clickzetta-token": token,
  }
  const fullUrl = `${readUrl(env)}${readApi("SERVICE_GET_INSTANCE_BY_NAME")}?instanceName=${encodeURIComponent(instanceName)}`
  const resp = await fetch(fullUrl, { headers, signal: AbortSignal.timeout(10_000) })
  const data = await resp.json() as Record<string, unknown>
  return getData(data, "$.data.id") as number | null
}

// login_server.py:111-118
export function getData(data: unknown, jsonpathExpr: string): unknown {
  try {
    // Simple dot-notation path resolver (no jsonpath_ng dependency)
    const parts = jsonpathExpr.replace(/^\$\.?/, "").split(".")
    let current: unknown = data
    for (const part of parts) {
      if (current == null || typeof current !== "object") return null
      current = (current as Record<string, unknown>)[part]
    }
    return current ?? null
  } catch {
    return null
  }
}

// login_server.py:121-160
export async function getUserId(
  opts: { url?: string; token?: string; instanceName?: string; env?: string },
): Promise<Record<string, unknown> | null> {
  const { token, instanceName, env } = opts
  const headers: Record<string, string> = {
    "accept": "application/json, text/plain, */*",
    "x-clickzetta-token": token ?? "",
  }
  const url = opts.url ?? `${readUrl(env)}/clickzetta-portal/user/getCurrentUser`
  try {
    const resp = await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(10_000) })
    resp.ok || (() => { throw new Error(`HTTP ${resp.status}`) })()
    const data = await resp.json() as Record<string, unknown>
    const dataValue = getData(data, "$.data") as Record<string, unknown> | null
    if (instanceName && dataValue) {
      const instanceId = await getInstanceId(token ?? "", instanceName, env)
      dataValue["instanceId"] = instanceId
    }
    return dataValue
  } catch (e) {
    logger.error({ err: e }, "get_user_id failed")
    return null
  }
}

// login_server.py:162-191
export async function getCurrentUser(
  token?: string,
  env?: string,
): Promise<Record<string, unknown> | null> {
  const headers: Record<string, string> = {
    "accept": "application/json, text/plain, */*",
    "x-clickzetta-token": token ?? "",
  }
  const url = readUrl(env) + readApi("USER_GET_CURRENT")
  try {
    const resp = await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(10_000) })
    resp.ok || (() => { throw new Error(`HTTP ${resp.status}`) })()
    const data = await resp.json() as Record<string, unknown>
    return getData(data, "$.data") as Record<string, unknown> | null
  } catch (e) {
    logger.error({ err: e }, "get_current_user failed")
    return null
  }
}

// login_server.py:193-226
export async function getUserConfig(
  jwt: string,
  userId: number,
  accountId: number,
  env?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "X-Clickzetta-Token": String(jwt),
    "userId": String(userId),
    "accountId": String(accountId),
    "X-real-ip": "192.168.1.100",
  }
  const url = readUrl(env) + readApi("GET_USER_CONFIG")
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "mcp" }),
      signal: AbortSignal.timeout(10_000),
    })
    resp.ok || (() => { throw new Error(`HTTP ${resp.status}`) })()
    const data = await resp.json() as Record<string, unknown>
    const dataValue = getData(data, "$.data") as Record<string, unknown> | null
    return dataValue ? (dataValue["content"] ?? null) : null
  } catch (e) {
    logger.error({ err: e }, "get_user_config failed")
    return null
  }
}
