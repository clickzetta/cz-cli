import { readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { OTEL_DEFAULTS } from "./otel-defaults.js"
import { VERSION } from "./version.js"
import { currentTraceContext } from "./trace.js"

interface CommandEvent {
  command: string
  subcommand?: string
  args?: Record<string, string>
  duration_ms: number
  success: boolean
  error?: string
  response_bytes?: number
  resourceAttributes?: Record<string, string>
}

function getResourceAttributes(): Record<string, string> {
  try {
    const toml = readFileSync(join(homedir(), ".clickzetta", "profiles.toml"), "utf-8")
    const defaultMatch = toml.match(/^default_profile\s*=\s*"?([^"\n]+)"?/m)
    const profileName = defaultMatch?.[1]?.trim() ?? "default"
    const sectionHeader = `[profiles.${profileName}]`
    const sectionIdx = toml.indexOf(sectionHeader)
    if (sectionIdx < 0) return {}
    const afterHeader = toml.slice(sectionIdx + sectionHeader.length)
    const nextSection = afterHeader.indexOf("\n[")
    const block = nextSection >= 0 ? afterHeader.slice(0, nextSection) : afterHeader
    const get = (key: string) => block.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n]+)"?`, "m"))?.[1]?.trim()
    const attrs: Record<string, string> = {}
    const username = get("username")
    const instance = get("instance")
    const workspace = get("workspace")
    const service = get("service")
    if (username) attrs["user.id"] = username
    if (instance) attrs["instance.name"] = instance
    if (workspace) attrs["workspace.name"] = workspace
    if (service) attrs["service.url"] = service
    return attrs
  } catch {
    return {}
  }
}

/**
 * Fire-and-forget: send a command execution event to the OTLP collector.
 * Never throws, never blocks CLI exit.
 */
export function trackCommand(event: CommandEvent): Promise<void> {
  try {
    const resourceAttrs = event.resourceAttributes ?? getResourceAttributes()
    const now = Date.now()
    const traceContext = currentTraceContext()
    const body = {
      resourceLogs: [{
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "cz-cli" } },
            { key: "service.version", value: { stringValue: VERSION } },
            ...Object.entries(resourceAttrs).map(([k, v]) => ({ key: k, value: { stringValue: v } })),
          ],
        },
        scopeLogs: [{
          scope: { name: "cz-cli.command" },
          logRecords: [{
            traceId: traceContext.traceId,
            spanId: traceContext.spanId,
            timeUnixNano: String(now * 1_000_000),
            observedTimeUnixNano: String(now * 1_000_000),
            severityNumber: event.success ? 9 : 17, // INFO : ERROR
            severityText: event.success ? "INFO" : "ERROR",
            body: { stringValue: "command_executed" },
            attributes: [
              { key: "event.name", value: { stringValue: "command_executed" } },
              { key: "command", value: { stringValue: event.command } },
              ...(event.subcommand ? [{ key: "subcommand", value: { stringValue: event.subcommand } }] : []),
              ...(event.args ? [{ key: "args", value: { stringValue: JSON.stringify(event.args) } }] : []),
              { key: "duration_ms", value: { intValue: String(Math.round(event.duration_ms)) } },
              { key: "success", value: { boolValue: event.success } },
              ...(event.error ? [{ key: "error", value: { stringValue: event.error } }] : []),
              ...(event.response_bytes != null ? [{ key: "response_bytes", value: { intValue: String(event.response_bytes) } }] : []),
            ],
          }],
        }],
      }],
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" }
    for (const part of OTEL_DEFAULTS.headers.split(",")) {
      const eqIdx = part.indexOf("=")
      if (eqIdx > 0) headers[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim()
    }

    return fetch(`${OTEL_DEFAULTS.endpoint}/v1/logs`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    }).then(() => {}).catch(() => {})
  } catch {
    return Promise.resolve()
  }
}
