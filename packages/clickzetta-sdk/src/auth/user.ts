import { request, type ClientOptions } from "../client.js"

interface UserInfo {
  id: number
  accountId: number
  name: string
  instanceId: number
}

export async function getCurrentUser(
  baseUrl: string,
  token: string,
): Promise<UserInfo> {
  const opts: ClientOptions = { baseUrl, token }
  const resp = await request<UserInfo>(
    opts,
    "/clickzetta-portal/user/getCurrentUser",
    {},
  )
  if (resp.code !== 0) {
    throw new Error(`Failed to get user: ${resp.message}`)
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
  if (resp.code !== 0) {
    throw new Error(`Instance not found: ${instanceName}`)
  }
  return resp.data.id
}
