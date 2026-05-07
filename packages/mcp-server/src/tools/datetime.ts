/**
 * DateTime tools — port of cz-mcp-server/cz_mcp/tools/datetime_tools.py
 *
 * Python → TS mapping:
 *   datetime_tools.py:20-89   handle_get_current_datetime → handleGetCurrentDatetime()
 *   datetime_tools.py:92-232  handle_parse_datetime       → handleParseDatetime()
 *   datetime_tools.py:235-275 get_current_datetime_tool() → (tool definition in registerDatetimeTools)
 *   datetime_tools.py:278-337 parse_datetime_tool()       → (tool definition in registerDatetimeTools)
 *   datetime_tools.py:340-345 get_datetime_tools()        → registerDatetimeTools()
 */

import { logger } from "../logger.js"
import type { ToolRegistry, ToolDefinition } from "../tool-registry.js"
import type { LakehouseDB } from "../server.js"

// ---------------------------------------------------------------------------
// Timezone helper — replaces Python's ZoneInfo
// ---------------------------------------------------------------------------

/** Resolve an IANA timezone string to a JS Intl.DateTimeFormat-compatible name.
 *  Falls back to 'Asia/Shanghai' on invalid input, matching Python behaviour. */
function resolveTimezone(timezone: string): string {
  try {
    // Validate by constructing a formatter — throws RangeError on bad tz
    Intl.DateTimeFormat("en", { timeZone: timezone })
    return timezone
  } catch {
    logger.warn({ timezone }, "Invalid timezone, falling back to Asia/Shanghai")
    return "Asia/Shanghai"
  }
}

/** Get a Date object representing "now" in the given IANA timezone.
 *  JS Date is always UTC internally; we use Intl to extract local components. */
function nowInTimezone(tz: string): { date: Date; parts: Record<string, number | string> } {
  const date = new Date()
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "long",
  })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value
  }
  return { date, parts }
}

/** Format a Date in a given timezone as 'YYYY-MM-DD HH:MM:SS' */
function formatMysqlDatetime(date: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = part.value
  }
  return `${p["year"]!}-${p["month"]!}-${p["day"]!} ${p["hour"]!}:${p["minute"]!}:${p["second"]!}`
}

/** Format a Date in a given timezone as 'YYYY-MM-DD' */
function formatMysqlDate(date: Date, tz: string): string {
  return formatMysqlDatetime(date, tz).slice(0, 10)
}

/** Format a Date in a given timezone as 'HH:MM:SS' */
function formatMysqlTime(date: Date, tz: string): string {
  return formatMysqlDatetime(date, tz).slice(11)
}

/** Get ISO 8601 string with timezone offset for a given tz */
function formatIso(date: Date, tz: string): string {
  // Use Intl to get offset
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value
  }
  const offset = parts["timeZoneName"] ?? "UTC"
  // offset looks like "GMT+8" or "GMT-5:30"
  const offsetStr = offset.replace("GMT", "").replace(/^([+-])(\d):/, "$10$2:")
  const sign = offsetStr.startsWith("-") ? "" : (offsetStr.startsWith("+") ? "" : "+")
  const normalised = offsetStr.match(/^[+-]/) ? offsetStr : `+${offsetStr}`
  const padded = normalised.replace(/^([+-])(\d):/, "$10$2:")
  return `${parts["year"]!}-${parts["month"]!}-${parts["day"]!}T${parts["hour"]!}:${parts["minute"]!}:${parts["second"]!}${padded}`
}

// ---------------------------------------------------------------------------
// handleGetCurrentDatetime — datetime_tools.py:20-89
// ---------------------------------------------------------------------------
async function handleGetCurrentDatetime(
  arguments_: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    // datetime_tools.py:36-37
    let timezone = (arguments_["timezone"] as string | undefined) ?? "Asia/Shanghai"
    const formatType = (arguments_["format"] as string | undefined) ?? "all"

    // datetime_tools.py:40-45 — validate timezone
    timezone = resolveTimezone(timezone)

    const now = new Date()

    // datetime_tools.py:50-52
    const result: Record<string, unknown> = { timezone }

    // datetime_tools.py:54-57
    if (formatType === "all" || formatType === "timestamp") {
      result["timestamp"] = Math.floor(now.getTime() / 1000)
      result["timestamp_ms"] = now.getTime()
    }

    // datetime_tools.py:59-62
    if (formatType === "all" || formatType === "mysql") {
      result["mysql_datetime"] = formatMysqlDatetime(now, timezone)
      result["mysql_date"] = formatMysqlDate(now, timezone)
      result["mysql_time"] = formatMysqlTime(now, timezone)
    }

    // datetime_tools.py:64-65
    if (formatType === "all" || formatType === "iso") {
      result["iso_format"] = formatIso(now, timezone)
    }

    // datetime_tools.py:67-74
    if (formatType === "all" || formatType === "components") {
      const { parts } = nowInTimezone(timezone)
      result["year"] = Number(parts["year"])
      result["month"] = Number(parts["month"])
      result["day"] = Number(parts["day"])
      result["hour"] = Number(parts["hour"])
      result["minute"] = Number(parts["minute"])
      result["second"] = Number(parts["second"])
      result["weekday"] = parts["weekday"]
    }

    logger.info({ timezone, result }, "Generated current datetime")

    return {
      status: "success",
      data: result,
      message: `Current datetime in ${timezone}`,
    }
  } catch (e) {
    logger.error({ err: e }, "Failed to get current datetime")
    return {
      success: false,
      message: `Failed to get current datetime: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// handleParseDatetime — datetime_tools.py:92-232
// ---------------------------------------------------------------------------
async function handleParseDatetime(
  arguments_: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const inputValue = arguments_["input_value"]
    let inputType = (arguments_["input_type"] as string | undefined) ?? "auto"
    const outputFormat = (arguments_["output_format"] as string | undefined) ?? "all"
    let timezone = (arguments_["timezone"] as string | undefined) ?? "Asia/Shanghai"

    // datetime_tools.py:113-117
    if (!inputValue && inputValue !== 0) {
      return { status: "error", message: "input_value is required" }
    }

    // datetime_tools.py:120-125
    timezone = resolveTimezone(timezone)

    // datetime_tools.py:128 — dt: Optional[datetime] = None
    let dt: Date | null = null

    // datetime_tools.py:130-163 — auto detection
    if (inputType === "auto") {
      // Try timestamp
      const strVal = String(inputValue)
      if (
        typeof inputValue === "number" ||
        typeof inputValue === "bigint" ||
        /^\d+(\.\d+)?$/.test(strVal)
      ) {
        try {
          let ts = parseFloat(strVal)
          if (ts > 1e11) ts = ts / 1000 // milliseconds → seconds
          dt = new Date(ts * 1000)
          if (!isNaN(dt.getTime())) {
            inputType = "timestamp"
          } else {
            dt = null
          }
        } catch {
          dt = null
        }
      }

      // Try datetime string formats
      if (dt === null) {
        const formatsToTry = [
          /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
          /^(\d{4})-(\d{2})-(\d{2})$/,
          /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
          /^(\d{4})\/(\d{2})\/(\d{2})$/,
          /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/,
          /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.\d+$/,
        ]
        const s = String(inputValue)
        for (const fmt of formatsToTry) {
          if (fmt.test(s)) {
            // Parse as local time in the given timezone by treating as UTC offset
            const parsed = new Date(s.replace(" ", "T"))
            if (!isNaN(parsed.getTime())) {
              dt = parsed
              inputType = "datetime_string"
              break
            }
          }
        }
      }
    } else if (inputType === "timestamp") {
      // datetime_tools.py:165-169
      let ts = parseFloat(String(inputValue))
      if (ts > 1e11) ts = ts / 1000
      dt = new Date(ts * 1000)
    } else if (inputType === "mysql_datetime") {
      // datetime_tools.py:171-173
      dt = new Date(String(inputValue).replace(" ", "T"))
    } else if (inputType === "mysql_date") {
      // datetime_tools.py:175-177
      dt = new Date(String(inputValue) + "T00:00:00")
    } else if (inputType === "iso") {
      // datetime_tools.py:179-182
      dt = new Date(String(inputValue))
    }

    // datetime_tools.py:184-188
    if (dt === null || isNaN(dt.getTime())) {
      return {
        status: "error",
        message: `Failed to parse input_value: ${inputValue}. Please specify input_type or use a supported format.`,
      }
    }

    // datetime_tools.py:190-195
    const result: Record<string, unknown> = {
      input_value: inputValue,
      detected_input_type: inputType,
      timezone,
    }

    // datetime_tools.py:198-200
    if (outputFormat === "all" || outputFormat === "timestamp") {
      result["timestamp"] = Math.floor(dt.getTime() / 1000)
      result["timestamp_ms"] = dt.getTime()
    }

    // datetime_tools.py:202-205
    if (outputFormat === "all" || outputFormat === "mysql") {
      result["mysql_datetime"] = formatMysqlDatetime(dt, timezone)
      result["mysql_date"] = formatMysqlDate(dt, timezone)
      result["mysql_time"] = formatMysqlTime(dt, timezone)
    }

    // datetime_tools.py:207-208
    if (outputFormat === "all" || outputFormat === "iso") {
      result["iso_format"] = formatIso(dt, timezone)
    }

    // datetime_tools.py:210-217
    if (outputFormat === "all" || outputFormat === "components") {
      const { parts } = nowInTimezone(timezone)
      // Re-derive parts from dt, not now
      const dtFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        weekday: "long",
      })
      const dtParts: Record<string, string> = {}
      for (const p of dtFmt.formatToParts(dt)) {
        if (p.type !== "literal") dtParts[p.type] = p.value
      }
      result["year"] = Number(dtParts["year"])
      result["month"] = Number(dtParts["month"])
      result["day"] = Number(dtParts["day"])
      result["hour"] = Number(dtParts["hour"])
      result["minute"] = Number(dtParts["minute"])
      result["second"] = Number(dtParts["second"])
      result["weekday"] = dtParts["weekday"]
      void parts // suppress unused warning
    }

    logger.info({ result }, "Parsed datetime")

    return {
      status: "success",
      data: result,
      message: "Successfully parsed datetime",
    }
  } catch (e) {
    logger.error({ err: e }, "Failed to parse datetime")
    return {
      success: false,
      message: `Failed to parse datetime: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// registerDatetimeTools — datetime_tools.py:340-345
// ---------------------------------------------------------------------------
export function registerDatetimeTools(registry: ToolRegistry, _db: LakehouseDB): void {
  // datetime_tools.py:235-275 — get_current_datetime_tool()
  // datetime_tools.py:278-337 — parse_datetime_tool()
  const tools: ToolDefinition[] = [
    {
      name: "get_current_datetime",
      description: (
        "Get current date and time in various formats. " +
        "Returns timestamp (Unix epoch in seconds and milliseconds), " +
        "MySQL datetime format (YYYY-MM-DD HH:MM:SS), " +
        "ISO format, and individual date/time components. " +
        "Supports multiple timezones."
      ),
      inputSchema: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: (
              "Timezone for the datetime (e.g., 'Asia/Shanghai', 'UTC', 'America/New_York'). " +
              "Defaults to 'Asia/Shanghai'."
            ),
            default: "Asia/Shanghai",
          },
          format: {
            type: "string",
            enum: ["all", "timestamp", "mysql", "iso", "components"],
            description: (
              "Output format type:\n" +
              "- all: Return all available formats\n" +
              "- timestamp: Return Unix timestamp (seconds and milliseconds)\n" +
              "- mysql: Return MySQL datetime formats (datetime, date, time)\n" +
              "- iso: Return ISO 8601 format\n" +
              "- components: Return individual date/time components (year, month, day, etc.)"
            ),
            default: "all",
          },
        },
        required: [],
      },
      handler: async (args: Record<string, unknown>) => handleGetCurrentDatetime(args),
      tags: ["datetime", "utility"],
      samples: [],
    },
    {
      name: "parse_datetime",
      description: (
        "Parse and convert datetime between different formats. " +
        "Supports automatic detection of input format or explicit specification. " +
        "Can convert between Unix timestamp, MySQL datetime, ISO format, and extract components. " +
        "Handles both seconds and milliseconds timestamps."
      ),
      inputSchema: {
        type: "object",
        properties: {
          input_value: {
            type: "string",
            description: (
              "The datetime value to parse. Can be:\n" +
              "- Unix timestamp (seconds or milliseconds, e.g., 1609459200 or 1609459200000)\n" +
              "- MySQL datetime (e.g., '2021-01-01 00:00:00')\n" +
              "- MySQL date (e.g., '2021-01-01')\n" +
              "- ISO format (e.g., '2021-01-01T00:00:00')\n" +
              "- Other common datetime string formats"
            ),
          },
          input_type: {
            type: "string",
            enum: ["auto", "timestamp", "mysql_datetime", "mysql_date", "iso"],
            description: (
              "Type of the input value. Use 'auto' for automatic detection. " +
              "Explicit types: timestamp, mysql_datetime, mysql_date, iso"
            ),
            default: "auto",
          },
          output_format: {
            type: "string",
            enum: ["all", "timestamp", "mysql", "iso", "components"],
            description: (
              "Output format type:\n" +
              "- all: Return all available formats\n" +
              "- timestamp: Return Unix timestamp (seconds and milliseconds)\n" +
              "- mysql: Return MySQL datetime formats (datetime, date, time)\n" +
              "- iso: Return ISO 8601 format\n" +
              "- components: Return individual date/time components"
            ),
            default: "all",
          },
          timezone: {
            type: "string",
            description: (
              "Timezone for the datetime interpretation (e.g., 'Asia/Shanghai', 'UTC'). " +
              "Defaults to 'Asia/Shanghai'."
            ),
            default: "Asia/Shanghai",
          },
        },
        required: ["input_value"],
      },
      handler: async (args: Record<string, unknown>) => handleParseDatetime(args),
      tags: ["datetime", "utility", "parser"],
      samples: [],
    },
  ]

  logger.info({ count: tools.length }, "Registering datetime tools")
  registry.registerTools(tools)
}
