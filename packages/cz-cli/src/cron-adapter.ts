/**
 * Cron expression adapter — port of cz-mcp-server/cz_mcp/utils/cron_expression_adapter.py
 * Validates, normalizes, and converts cron expressions to Studio-compatible format.
 */

const ALLOWED_MINUTE_GAPS = new Set([1, 2, 3, 5, 10, 15, 20, 30])
const UNSUPPORTED_TOKENS = ["L", "W", "#", "C"]

interface CronFields {
  second: string; minute: string; hour: string
  day: string; month: string; week: string; year: string
}

interface UiParam {
  schedule: string[][]
  frequency: "1" | "2"
  scheduleStartTime: string
  scheduleEndTime: string | null
  timeGap: string | number | null
}

export interface CronResult {
  ok: boolean
  inputCron: string
  outputCron: string | null
  uiParam: UiParam
  warnings: string[]
  error?: string
}

function pad2(v: number): string { return v.toString().padStart(2, "0") }

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length === 5) {
    const [minute, hour, day, month, week] = parts
    return { second: "0", minute, hour, day, month, week: week === "*" ? "?" : week, year: "*" }
  }
  if (parts.length === 6) {
    const [second, minute, hour, day, month, week] = parts
    return { second, minute, hour, day, month, week, year: "*" }
  }
  if (parts.length === 7) {
    const [second, minute, hour, day, month, week, year] = parts
    return { second, minute, hour, day, month, week, year }
  }
  throw new Error(`Unsupported cron field count: ${parts.length}. Expected 5, 6, or 7.`)
}

function hasUnsupportedToken(fields: CronFields): string | null {
  for (const val of Object.values(fields)) {
    for (const t of UNSUPPORTED_TOKENS) {
      if (val.includes(t)) return `Unsupported Quartz token: ${t} in '${val}'`
    }
  }
  return null
}

function parseHourRange(token: string): { start: string; end: string; step: string | null } {
  let step: string | null = null
  let base = token
  if (token.includes("/")) { [base, step] = token.split("/", 2) }
  if (base.includes("-")) {
    const [start, end] = base.split("-", 2)
    return { start, end, step }
  }
  return { start: base, end: base, step }
}

function decodeToUi(fields: CronFields): { param: UiParam; warnings: string[]; error?: string } {
  const warnings: string[] = []
  const param: UiParam = { schedule: [["everyday"]], frequency: "1", scheduleStartTime: "00:00", scheduleEndTime: null, timeGap: null }

  const unsupported = hasUnsupportedToken(fields)
  if (unsupported) return { param, warnings, error: unsupported }

  if (fields.day !== "*" && fields.day !== "?" && fields.week !== "*" && fields.week !== "?") {
    return { param, warnings, error: "Both day-of-month and day-of-week are specific." }
  }

  if (fields.day !== "*" && fields.day !== "?") {
    param.schedule = fields.day.split(",").map(d => ["daily", d])
  } else if (fields.week !== "*" && fields.week !== "?") {
    param.schedule = fields.week.split(",").map(d => ["weekly", d])
  }

  const { minute, hour } = fields

  // Minute step
  if (minute.includes("/") || minute === "*") {
    param.frequency = "2"
    let startMinute = 0
    if (minute === "*") {
      param.timeGap = "1m"
    } else {
      const [base, step] = minute.split("/", 2)
      param.timeGap = `${step}m`
      startMinute = base === "*" ? 0 : parseInt(base, 10)
    }
    if (hour === "*") {
      param.scheduleStartTime = `00:${pad2(startMinute)}`
      param.scheduleEndTime = "23:59"
    } else {
      const { start, end } = parseHourRange(hour)
      param.scheduleStartTime = `${pad2(parseInt(start, 10))}:${pad2(startMinute)}`
      param.scheduleEndTime = `${pad2(parseInt(end, 10))}:59`
    }
    return { param, warnings }
  }

  // Hour step
  const { start: hStart, end: hEnd, step: hStep } = parseHourRange(hour)
  if (hStep) {
    param.frequency = "2"
    param.timeGap = parseInt(hStep, 10)
    param.scheduleStartTime = `${pad2(parseInt(hStart, 10))}:${pad2(parseInt(minute, 10))}`
    param.scheduleEndTime = `${pad2(parseInt(hEnd, 10))}:59`
    return { param, warnings }
  }

  // Once daily
  param.frequency = "1"
  param.scheduleStartTime = `${pad2(parseInt(hour, 10))}:${pad2(parseInt(minute, 10))}`
  param.scheduleEndTime = null
  param.timeGap = null
  return { param, warnings }
}

function encodeFromUi(param: UiParam): string {
  const crontab = ["0", "0", "*", "*", "*", "?", "*"]
  const [startH, startM] = param.scheduleStartTime.split(":").map(Number)
  const schedule = param.schedule.length ? param.schedule : [["everyday"]]
  const scheduleType = schedule[0][0]
  const scheduleValues = schedule.filter(s => s.length > 1).map(s => s[1])

  if (scheduleType === "daily" || scheduleType === "monthly") {
    crontab[3] = scheduleValues.join(",")
  } else if (scheduleType === "weekly") {
    crontab[3] = "?"
    crontab[5] = scheduleValues.join(",")
  }

  if (param.frequency === "2" && param.timeGap != null) {
    let endH = 23
    if (param.scheduleEndTime) endH = parseInt(param.scheduleEndTime.split(":")[0], 10)

    const gapText = String(param.timeGap)
    if (gapText.endsWith("m")) {
      const gap = parseInt(gapText.replace("m", ""), 10)
      if (!ALLOWED_MINUTE_GAPS.has(gap)) {
        throw new Error(`Unsupported minute gap: ${gap}. Allowed: ${[...ALLOWED_MINUTE_GAPS].sort((a, b) => a - b).join(",")}`)
      }
      crontab[1] = startM === 0 && gap === 1 ? "*" : `*/${gap}`
      crontab[2] = startH === 0 && endH === 23 ? "*" : `${pad2(startH)}-${pad2(endH)}`
    } else {
      const hourGap = parseInt(gapText, 10)
      if (hourGap < 1 || hourGap > 12) {
        throw new Error(`Unsupported hour gap: ${hourGap}. Allowed: 1-12`)
      }
      crontab[1] = pad2(startM)
      crontab[2] = startH === 0 && endH === 23 && hourGap === 1 ? "*" : `${pad2(startH)}-${pad2(endH)}/${hourGap}`
    }
  } else {
    crontab[1] = pad2(startM)
    crontab[2] = pad2(startH)
  }

  return crontab.join(" ")
}

/**
 * Convert agent cron expression to Studio-compatible format.
 * Validates, decodes to UI params, re-encodes with constraints.
 */
export function convertAgentCron(expr: string): CronResult {
  const inputCron = expr.trim().replace(/\s+/g, " ")
  try {
    const fields = parseCron(expr)
    const { param, warnings, error: decodeErr } = decodeToUi(fields)
    if (decodeErr) {
      return { ok: false, inputCron, outputCron: null, uiParam: param, warnings, error: decodeErr }
    }
    const outputCron = encodeFromUi(param)
    return { ok: true, inputCron, outputCron, uiParam: param, warnings }
  } catch (e) {
    return {
      ok: false, inputCron, outputCron: null,
      uiParam: { schedule: [["everyday"]], frequency: "1", scheduleStartTime: "00:00", scheduleEndTime: null, timeGap: null },
      warnings: [], error: e instanceof Error ? e.message : String(e),
    }
  }
}
