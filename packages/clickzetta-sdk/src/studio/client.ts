import { request, type ClientOptions } from "../client.js"
import { ClickZettaApiError } from "../types/api.js"
import type { StudioConfig } from "../types/index.js"

export async function studioRequest<T>(
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
      instanceid: String(config.instanceId),
      userId: String(config.userId),
      accountId: String(config.tenantId),
      tenantId: String(config.tenantId),
      workspaceName: config.workspaceName,
      env: "prod",
      ...config.customHeaders,
      ...extraHeaders,
    },
  }
  const resp = await request<T>(opts, path, body)
  const code = resp.code
  if (code !== 0 && code !== "0" && code !== "200" && code !== 200) {
    throw new ClickZettaApiError(
      String(code),
      resp.message ?? `Studio API error (code=${code})`,
    )
  }
  return resp
}
