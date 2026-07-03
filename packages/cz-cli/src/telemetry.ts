import { readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { OTEL_DEFAULTS } from "./otel-defaults.js"
import { VERSION } from "./version.js"
import { currentTraceContext } from "./trace.js"

/**
 * CLI flag names whose values must never be exfiltrated via telemetry.
 * Comparison is case-insensitive; entries are stored lowercase.
 */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "credential",
  "password",
  "pat",
  "token",
  "secret",
  "api-key",
  "apikey",
  "access-token",
  "auth",
  "authorization",
])

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase())
}

/**
 * Parse raw CLI args into positional tokens and a flag map suitable for telemetry.
 * Expects args already sliced to user-visible tokens (i.e. process.argv.slice(2) or hideBin output).
 */
export function parseTrackingArgs(rawArgs: string[]): {
  positional: string[]
  args: Record<string, string>
} {
  const positional = rawArgs.filter((arg) => !arg.startsWith("-"))
  const args: Record<string, string> = {}

  if (positional.length > 2) {
    args["_positional"] = positional.slice(2).join(" ")
  }

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]
    if (!arg.startsWith("-")) continue
    const eqIdx = arg.indexOf("=")
    if (eqIdx > 0) {
      const key = arg.slice(0, eqIdx).replace(/^-+/, "")
      args[key] = isSensitiveKey(key) ? "<redacted>" : arg.slice(eqIdx + 1)
      continue
    }
    const next = rawArgs[i + 1]
    const key = arg.replace(/^-+/, "")
    if (next && !next.startsWith("-")) {
      args[key] = isSensitiveKey(key) ? "<redacted>" : next
      i++
      continue
    }
    args[key] = "true"
  }

  return { positional, args }
}

interface CommandEvent {
  command: string
  subcommand?: string
  args?: Record<string, string | number | boolean>
  duration_ms: number
  success: boolean
  error?: string
  response_bytes?: number
  resourceAttributes?: Record<string, string>
}

type OtlpValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }

function otlpValue(value: string | number | boolean): OtlpValue {
  if (typeof value === "string") return { stringValue: value }
  if (typeof value === "boolean") return { boolValue: value }
  if (Number.isInteger(value)) return { intValue: String(value) }
  return { doubleValue: value }
}

function commandName(event: CommandEvent) {
  return event.subcommand ? `${event.command} ${event.subcommand}` : event.command
}

function commandBody(event: CommandEvent) {
  return `Command ${commandName(event)} ${event.success ? "completed" : "failed"}`
}

function commandAttributes(event: CommandEvent) {
  return [
    { key: "event.name", value: { stringValue: "cz_cli.command.execution" } },
    { key: "cz_cli.command.name", value: { stringValue: event.command } },
    ...(event.subcommand ? [{ key: "cz_cli.command.subcommand", value: { stringValue: event.subcommand } }] : []),
    ...(event.args
      ? Object.entries(event.args).map(([key, value]) => ({
          key: `cz_cli.command.arg.${key}`,
          value: otlpValue(value),
        }))
      : []),
    { key: "cz_cli.command.duration_ms", value: { intValue: String(Math.round(event.duration_ms)) } },
    ...(event.response_bytes != null
      ? [{ key: "cz_cli.command.response_bytes", value: { intValue: String(event.response_bytes) } }]
      : []),
    ...(event.error ? [{ key: "cz_cli.command.error", value: { stringValue: event.error } }] : []),
  ]
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
    const userId = get("user_id")
    const instance = get("instance")
    const workspace = get("workspace")
    const service = get("service")
    if (userId) attrs["enduser.id"] = userId
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
  if (!OTEL_DEFAULTS.endpoint) return Promise.resolve()
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
            body: { stringValue: commandBody(event) },
            attributes: commandAttributes(event),
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
