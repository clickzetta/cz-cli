import { request, type ClientOptions } from "../client.js"
import { ClickZettaApiError } from "../types/api.js"
import type { StudioConfig } from "../types/index.js"

function debugString(value: unknown): string {
  const text = JSON.stringify(value)
  return text.length > 2000 ? `${text.slice(0, 2000)}...<truncated>` : text
}

export async function studioRequest<T>(
  config: StudioConfig,
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
  method: string = "POST",
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
  if (config.debug) {
    const customHeaders = opts.customHeaders ?? {}
    const debugHeaders = {
      instanceid: customHeaders.instanceid,
      instancename: customHeaders.instanceName,
      workspaceName: customHeaders.workspaceName,
      env: customHeaders.env,
      ...extraHeaders,
    }
    process.stderr.write(`[debug] studioRequest: ${method} ${config.baseUrl}${path} body=${debugString(body)} headers=${debugString(debugHeaders)}\n`)
  }
  const resp = await request<T>(opts, path, body, method)
  if (config.debug) {
    process.stderr.write(`[debug] studioRequest: ${path} code=${String(resp.code)}\n`)
  }
  const code = resp.code
  if (code !== 0 && code !== "0" && code !== "200" && code !== 200) {
    throw new ClickZettaApiError(
      String(code),
      resp.message ?? `Studio API error (code=${code})`,
    )
  }
  return resp
}
