import { request, type ClientOptions } from "../client.js"
import type { AuthToken } from "../types/index.js"

interface LoginResponse {
  token: string
  instanceId: number
  userId: number
  expireTime: number
}

export async function loginWithPat(
  baseUrl: string,
  pat: string,
  instanceName: string,
): Promise<AuthToken> {
  const opts: ClientOptions = { baseUrl, timeout: 10000 }
  const resp = await request<LoginResponse>(
    opts,
    "/clickzetta-portal/user/loginSingle",
    { accessToken: pat, instanceName },
  )
  if (resp.code !== 0) {
    throw new Error(`Login failed: ${resp.message ?? JSON.stringify(resp)}`)
  }
  return {
    token: resp.data.token,
    instanceId: resp.data.instanceId,
    userId: resp.data.userId,
    expireTimeMs: resp.data.expireTime,
    obtainedAt: Date.now(),
  }
}

export async function loginWithPassword(
  baseUrl: string,
  username: string,
  password: string,
  instanceName: string,
): Promise<AuthToken> {
  const opts: ClientOptions = { baseUrl, timeout: 10000 }
  const resp = await request<LoginResponse>(
    opts,
    "/clickzetta-portal/user/loginSingle",
    { username, password, instanceName },
  )
  if (resp.code !== 0) {
    throw new Error(`Login failed: ${resp.message ?? JSON.stringify(resp)}`)
  }
  return {
    token: resp.data.token,
    instanceId: resp.data.instanceId,
    userId: resp.data.userId,
    expireTimeMs: resp.data.expireTime,
    obtainedAt: Date.now(),
  }
}
