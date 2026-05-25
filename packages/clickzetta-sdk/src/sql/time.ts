function trimTrailingZeroMillis(value: string) {
  return value.replace(".000", "")
}

function formatDateTime(date: Date, timezone?: string) {
  try {
    const options: Intl.DateTimeFormatOptions & { fractionalSecondDigits?: number } = {
      ...(timezone ? { timeZone: timezone } : {}),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    }
    const parts = new Intl.DateTimeFormat("sv-SE", options).formatToParts(date)
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}.${get("fractionalSecond")}`
  } catch {
    return date.toISOString()
  }
}

function toDate(value: unknown) {
  if (typeof value === "number") return new Date(value)
  if (typeof value === "bigint") return new Date(Number(value) / 1_000_000)
  if (value instanceof Date) return value
  if (typeof value === "string") {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date
  }
}

export function resolveResultTimezone(metadataTimezone?: string, timezoneHint?: string) {
  const metadata = metadataTimezone?.trim()
  if (metadata) return metadata
  const hint = timezoneHint?.trim()
  if (hint) return hint
}

export function normaliseTimestampText(value: string, typeCategory: string, timezone?: string) {
  const iso = value.trim().replace(" ", "T")
  if (typeCategory === "TIMESTAMP_NTZ") return iso
  if (typeCategory !== "TIMESTAMP_LTZ" && typeCategory !== "TIMESTAMP") return iso
  if (!timezone) return iso
  const date = toDate(iso)
  if (!date || Number.isNaN(date.getTime())) return iso
  return trimTrailingZeroMillis(formatDateTime(date, timezone))
}

export function normaliseTimestampValue(value: unknown, typeCategory: string, timezone?: string) {
  const date = toDate(value)
  if (!date || Number.isNaN(date.getTime())) return String(value)
  if (typeCategory === "TIMESTAMP_NTZ") {
    return trimTrailingZeroMillis(date.toISOString().replace("Z", ""))
  }
  if ((typeCategory === "TIMESTAMP_LTZ" || typeCategory === "TIMESTAMP") && timezone) {
    return trimTrailingZeroMillis(formatDateTime(date, timezone))
  }
  return trimTrailingZeroMillis(date.toISOString())
}
