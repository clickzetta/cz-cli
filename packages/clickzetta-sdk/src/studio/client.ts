import { request, type ClientOptions } from "../client.js"
import type { StudioConfig } from "../types/index.js"

export function studioRequest<T>(
  config: StudioConfig,
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
) {
  const opts: ClientOptions = {
    baseUrl: config.baseUrl,
    token: config.token,
    customHeaders: {
      instanceName: config.instanceName,
      userId: String(config.userId),
      accountId: String(config.tenantId),
      tenantId: String(config.tenantId),
      instanceId: String(config.instanceId),
      ...config.customHeaders,
      ...extraHeaders,
    },
  }
  return request<T>(opts, path, body)
}
