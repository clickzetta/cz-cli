import { request, type ClientOptions } from "../client.js"
import { ClickZettaApiError } from "../types/api.js"
import type { TokenSource } from "../types/index.js"

/**
 * Auth context for a one-off portal call: the source to authenticate with, plus
 * any profile headers the endpoint needs. There is no token field — a caller
 * that only has a token string wraps it in `staticTokenSource`, which states
 * that this identity cannot self-heal.
 */
export interface CallAuth {
  tokens: TokenSource
  customHeaders?: Record<string, string>
}

interface UserInfo {
  id: number
  accountId: number
  name: string
  instanceId: number
  accountDisplayName?: string
}

/**
 * `customHeaders` carries the profile's own headers (notably `Cookie`) so
 * cookie-authenticated deployments accept this call. Without it the request
 * only proves the token, which a session-authenticating gateway may reject.
 *
 * `auth.tokens` is required for the reason spelled out on `ClientOptions.tokens`:
 * this is a preflight call on the same credential the command will use, so it must
 * be able to rotate on a 401 too. A caller holding only a token string wraps it in
 * `staticTokenSource`, which states that this identity cannot self-heal.
 */
export async function getCurrentUser(
  baseUrl: string,
  auth: CallAuth,
): Promise<UserInfo> {
  const opts: ClientOptions = { baseUrl, tokens: auth.tokens, customHeaders: auth.customHeaders }
  const resp = await request<UserInfo>(
    opts,
    "/clickzetta-portal/user/getCurrentUser",
    {},
  )
  if (resp.code !== 0 && resp.code !== "0" && resp.code !== 200 && resp.code !== "200") {
    throw new ClickZettaApiError("AUTH_FAILED", `Failed to get user: ${resp.message ?? "unknown error"}`)
  }
  return resp.data
}

export async function getInstanceByName(
  baseUrl: string,
  instanceName: string,
  auth: CallAuth,
): Promise<number> {
  const opts: ClientOptions = { baseUrl, tokens: auth.tokens, customHeaders: auth.customHeaders }
  const resp = await request<{ id: number }>(
    opts,
    `/clickzetta-portal/service/getInstanceByName?instanceName=${encodeURIComponent(instanceName)}`,
    undefined,
    "GET",
  )
  if (resp.code !== 0 && resp.code !== "0" && resp.code !== 200 && resp.code !== "200") {
    throw new ClickZettaApiError("INSTANCE_NOT_FOUND", `Instance not found: ${instanceName}`)
  }
  return resp.data.id
}
