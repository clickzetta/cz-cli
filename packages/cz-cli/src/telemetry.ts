import { readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { OTEL_DEFAULTS } from "./otel-defaults.js"
import { VERSION } from "./version.js"
import { currentTraceContext } from "./trace.js"
import { redactSql } from "./logger.js"

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
  // Header spellings, for the KEY=VALUE values `--header` carries (see isSensitiveValue).
  "cookie",
  "x-api-key",
  "x-auth-token",
  // Both take a JDBC connection string, and connection/jdbc.ts reads a `password=`
  // parameter straight out of it. Neither value is a dimension anyone could act on in
  // analytics, so the whole string goes rather than one parameter of it.
  "login",
  "jdbc",
])

/**
 * Values that are credentials whatever flag carries them.
 *
 * `--header Cookie=<session>` is a credential in flag clothing — cookie auth is one of
 * the four ways this CLI authenticates — but `header` cannot be a sensitive NAME: it is
 * KEY=VALUE on `profile create` and a boolean on `sql` (`--no-header`), so redacting by
 * name swallowed the neighbouring SQL statement. Matching the value is what the reported
 * hazard actually needs.
 *
 * Keyed off the same SENSITIVE_KEYS list rather than a second, narrower one, because
 * `--header` is a generic repeatable KEY=VALUE: `Authorization=Bearer …` and
 * `X-Api-Key=…` are the same hazard as `Cookie=…`. `eqIdx > 0` keeps a SQL statement
 * intact — in `select * from t where id=1` the part before `=` is not a credential name.
 */
export function isSensitiveValue(value: string): boolean {
  const eqIdx = value.indexOf("=")
  return eqIdx > 0 && isSensitiveKey(value.slice(0, eqIdx).trim())
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase())
}

/**
 * Flags that take NO value, so the token after them is a positional rather than
 * their own — `cz-cli sql --batch "select …"` is the statement, not `--batch`'s
 * value. Without this the statement was recorded under the flag's key, and the
 * masking below only covers literals that LOOK like PII, so table names, columns and
 * predicates still left the machine.
 *
 * Enumerated rather than derived because this runs before yargs parses anything, and
 * generated from the tree's `type: "boolean"` declarations plus the value-less
 * globals. A flag missing from here degrades to the old behavior (its neighbour is
 * recorded, masked by redactSql) rather than to a wrong value, so drift is visible
 * as noise in analytics, not as a leak of the whole statement.
 */
export const VALUELESS_FLAGS: ReadonlySet<string> = new Set([
  // value-less globals (and yargs' own)
  "debug", "d", "help", "h", "version", "v",
  // every option declared `type: "boolean"` across the tree, and only those:
  // `--header` (boolean on sql, KEY=VALUE on profile create) and `--limit`
  // (boolean via --no-limit, number on sql) are declared BOTH ways, so they stay
  // out — treating them as value-less would drop a real value, and for --header
  // that value can be `Authorization=Bearer …`. Same for the alias `-a`: it is
  // `--all` (boolean) on `agent session list` but `--client` (string) on `mcp init`,
  // whose own example is `mcp init -a claude -a codex`.
  "N", "all", "allow-timeout", "async", "auto-lineage", "batch", "B", "browser",
  "continue", "c", "dangerously-skip-permissions", "dimension", "dry-run", "force",
  "fork", "global", "hidden", "include-columns", "include-preview", "include-secret",
  "index", "keep-profiles", "mine", "open", "partitioned", "persist", "raw", "refresh",
  "refresh-llm", "remove-from-llm", "rerun", "resolve", "reveal", "sanitize",
  "save-params", "show-secret", "skip-check", "skip-verify", "snapshot", "stdin",
  "summary", "sync", "thinking", "truncate", "use", "validate-only", "verbose", "wait",
  "with-detail", "with-downstream", "with-schema", "with-tables", "write", "yes", "y",
])

function takesNoValue(key: string): boolean {
  const name = key.toLowerCase()
  // `--no-x` is yargs' negation and never carries a value, whatever `x` is declared
  // as — `--no-limit` on a number option yields 0. No declared option in this tree is
  // literally named `no-…`, so the prefix is unambiguous.
  return VALUELESS_FLAGS.has(name) || name.startsWith("no-")
}

/**
 * Parse raw CLI args into positional tokens and a flag map suitable for telemetry.
 * Expects args already sliced to user-visible tokens (i.e. process.argv.slice(2) or hideBin output).
 *
 * Recorded values additionally pass through `redactSql`, the same masking the local
 * SQL history applies — defence in depth, since it only rewrites literals that look
 * like PII. What keeps a whole statement out of the flag map is VALUELESS_FLAGS
 * above: a flag that takes no value no longer claims the token after it.
 */
export function parseTrackingArgs(rawArgs: string[]): {
  positional: string[]
  args: Record<string, string>
} {
  // The token after a SENSITIVE flag is that flag's value, not a positional. Filtering
  // purely on "does not start with -" put it in `_positional`, where the flag map's
  // `<redacted>` no longer protected it: `cz-cli auth login mysession --pat czt_secret`
  // recorded `_positional = "mysession czt_secret"`.
  //
  // Deliberately limited to the sensitive flags rather than every value-taking one:
  // without a spec of which flags take values, a boolean flag followed by a real
  // positional (`sql --debug "select 1"`) is indistinguishable by shape, and dropping
  // those would quietly change what the existing analytics see. Secrets are the part
  // that must not be recorded at all.
  const secretValues = new Set<number>()
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]
    if (!arg || !arg.startsWith("-") || arg.includes("=")) continue
    const key = arg.replace(/^-+/, "").toLowerCase()
    const next = rawArgs[i + 1]
    if (!next) continue
    // The VALUE being a credential (`Cookie=…`, `Authorization=Bearer …`) keeps it out
    // of _positional regardless of which flag precedes it. Only the flag-NAME half of
    // the test is skipped for a value-less flag, since such a flag has no value to
    // claim in the first place.
    const valueIsSecret = isSensitiveValue(next)
    if (!valueIsSecret && (takesNoValue(key) || !isSensitiveKey(key))) continue
    secretValues.add(i + 1)
  }
  const positional = rawArgs.filter((arg, i) => !arg.startsWith("-") && !secretValues.has(i))
  const args: Record<string, string> = {}

  if (positional.length > 2) {
    args["_positional"] = redactSql(positional.slice(2).join(" "))
  }

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]
    if (!arg.startsWith("-")) continue
    const eqIdx = arg.indexOf("=")
    if (eqIdx > 0) {
      const key = arg.slice(0, eqIdx).replace(/^-+/, "")
      const inlineValue = arg.slice(eqIdx + 1)
      args[key] = isSensitiveKey(key) || isSensitiveValue(inlineValue) ? "<redacted>" : redactSql(inlineValue)
      continue
    }
    const next = rawArgs[i + 1]
    const key = arg.replace(/^-+/, "")
    // A sensitive flag claims its neighbour even when it starts with `-`: otherwise
    // `--password -h7Kq…` left the value unclaimed, the next iteration read it as a flag
    // name, and the secret was recorded as an attribute KEY — harder to scrub downstream
    // than a value. `secretValues` marks the same index, so it stays out of _positional.
    const claimsNext =
      !takesNoValue(key) && next !== undefined && (!next.startsWith("-") || secretValues.has(i + 1))
    if (claimsNext) {
      args[key] = isSensitiveKey(key) || isSensitiveValue(next!) ? "<redacted>" : redactSql(next!)
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
