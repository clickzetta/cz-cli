import { request, type ClientOptions } from "../client.js"
import { ClickZettaApiError } from "../types/api.js"

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
 */
export async function getCurrentUser(
  baseUrl: string,
  token: string,
  customHeaders?: Record<string, string>,
): Promise<UserInfo> {
  const opts: ClientOptions = { baseUrl, token, customHeaders }
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
  token: string,
  instanceName: string,
): Promise<number> {
  const opts: ClientOptions = { baseUrl, token }
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
