import { request, type ClientOptions } from "../client.js"
import { ClickZettaApiError } from "../types/api.js"
import type { StudioConfig } from "../types/index.js"

const SAVE_FILE_CONFIGURATION = "/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration"
const FILE_DETAIL = "/ide-admin/v1/dataFile/getDetail"
const PARAMETER_FIELDS = new Set(["paramValueList", "inputParamValueList", "outputParamValueList"])

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
  // Draft reads and saves can return parameter values even in failure responses.
  const sensitiveResponse = path === FILE_DETAIL || path === SAVE_FILE_CONFIGURATION
  const opts: ClientOptions = {
    baseUrl: config.baseUrl,
    tokens: config.tokens,
    omitResponseBodyInErrors: sensitiveResponse,
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
    const debugBody = path === SAVE_FILE_CONFIGURATION && body && typeof body === "object"
      ? Object.fromEntries(Object.entries(body).map(([key, value]) => [key, PARAMETER_FIELDS.has(key) ? "[redacted]" : value]))
      : body
    process.stderr.write(`[debug] studioRequest: ${method} ${config.baseUrl}${path} body=${debugString(debugBody)} headers=${debugString(debugHeaders)}\n`)
  }
  const resp = await request<T>(opts, path, body, method)
  const code = sensitiveResponse ? resp?.code : resp.code
  const diagnosticCode = sensitiveResponse && !(typeof code === "number" || (typeof code === "string" && /^-?\d+$/.test(code)))
    ? "INVALID_RESPONSE"
    : String(code)
  if (config.debug) {
    process.stderr.write(`[debug] studioRequest: ${path} code=${diagnosticCode}\n`)
  }
  if (code !== 0 && code !== "0" && code !== "200" && code !== 200) {
    throw new ClickZettaApiError(
      diagnosticCode,
      (sensitiveResponse ? undefined : resp.message) ?? `Studio API error (code=${diagnosticCode})`,
    )
  }
  return resp
}
