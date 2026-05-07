/**
 * hornhub-client.ts — port of cz-mcp-server/cz_mcp/core/hornhub_client.py
 *
 * HornhubClient validates Bearer tokens against the Hornhub auth service.
 * Used by the HTTP transport's bearer auth middleware when a server address
 * is configured (as opposed to static token comparison).
 *
 * Python → TS mapping:
 *   hornhub_client.py:8-12   CheckAccessTokenRequest → CheckAccessTokenRequest
 *   hornhub_client.py:13-22  HornhubResponse         → HornhubResponse
 *   hornhub_client.py:23-36  BaseUser                → BaseUser
 *   hornhub_client.py:37-52  ServiceInstance         → ServiceInstance
 *   hornhub_client.py:53-55  HornhubError            → HornhubError
 *   hornhub_client.py:57-105 HornhubClient           → HornhubClient
 */

import { createHash } from "node:crypto"

// hornhub_client.py:8-12
interface CheckAccessTokenRequest {
  tokenHash: string
}

// hornhub_client.py:13-22
interface HornhubResponse<T = unknown> {
  code: number
  message?: string
  data: T
}

// hornhub_client.py:23-36
export interface BaseUser {
  id: number
  name: string
  email?: string
  accountId?: number
  instanceId?: number
}

// hornhub_client.py:37-52
export interface ServiceInstance {
  id: number
  name: string
  serviceAddress?: string
  region?: string
}

// hornhub_client.py:53-55
export class HornhubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HornhubError"
  }
}

// hornhub_client.py:57-105
export class HornhubClient {
  // hornhub_client.py:65-66
  static readonly CHECK_ACCESS_TOKEN_PATH = "/clickzetta-hornhub/hornhub/user/checkUserByAccessToken"
  static readonly GET_INSTANCE_PATH = "/clickzetta-hornhub/hornhub/service/getInstanceOnlyByName"

  private readonly baseUrl: string
  private readonly timeout: number

  // hornhub_client.py:68-75
  constructor(serverAddress: string, timeoutMs = 10_000) {
    this.baseUrl = serverAddress.includes("://") ? serverAddress : `http://${serverAddress}`
    this.timeout = timeoutMs
  }

  // hornhub_client.py:81-87
  async checkAccessToken(token: string): Promise<BaseUser> {
    const tokenHash = HornhubClient.generateTokenHash(token)
    const body: CheckAccessTokenRequest = { tokenHash }
    const data = await this._post<BaseUser>(HornhubClient.CHECK_ACCESS_TOKEN_PATH, body)
    return data
  }

  // hornhub_client.py:89-93
  async getInstance(instanceName: string): Promise<ServiceInstance> {
    const url = `${this.baseUrl}${HornhubClient.GET_INSTANCE_PATH}?instanceName=${encodeURIComponent(instanceName)}`
    const resp = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(this.timeout),
    })
    resp.ok || (() => { throw new HornhubError(`HTTP ${resp.status}`) })()
    const json = await resp.json() as HornhubResponse<ServiceInstance>
    if (json.code !== 0) throw new HornhubError(`Request failed: ${json.message ?? json.code}`)
    return json.data
  }

  // hornhub_client.py:95-97
  static generateTokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex")
  }

  // hornhub_client.py:99-105
  private async _post<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    })
    if (!resp.ok) throw new HornhubError(`HTTP ${resp.status}`)
    const json = await resp.json() as HornhubResponse<T>
    if (json.code !== 0) throw new HornhubError(`Request failed: ${json.message ?? json.code}`)
    return json.data
  }
}
