/**
 * cron-expression-adapter.ts — port of cz_mcp/utils/cron_expression_adapter.py
 * Converts between cron expressions and UI schedule parameters.
 */

const SUPPORTED_SPECIAL_TOKENS = ["L", "W", "#", "C"]
const ALLOWED_MINUTE_GAPS = new Set([1, 2, 3, 5, 10, 15, 20, 30])
const ALLOWED_HOUR_GAP_MIN = 1
const ALLOWED_HOUR_GAP_MAX = 12

export interface CronFields {
  second: string; minute: string; hour: string
  day: string; month: string; week: string; year: string
}

export interface UiScheduleParam {
  schedule: string[][]
  frequency: "1" | "2"
  schedule_start_time: string
  schedule_end_time: string | null
  time_gap: string | number | null
}

export interface DecodeResult {
  param: UiScheduleParam
  warnings: string[]
  unsupported_reason: string | null
  lossless: boolean
}

function defaultUiParam(): UiScheduleParam {
  return { schedule: [["everyday"]], frequency: "1", schedule_start_time: "00:00", schedule_end_time: null, time_gap: null }
}

export function normalizeCron(expr: string): string {
  return expr.trim().split(/\s+/).join(" ")
}

export function parseCron(expr: string): CronFields {
  const parts = normalizeCron(expr).split(" ")
  if (parts.length === 6) parts.push("*")
  if (parts.length !== 7) throw new Error(`Unsupported cron parts count: ${parts.length}`)
  return { second: parts[0], minute: parts[1], hour: parts[2], day: parts[3], month: parts[4], week: parts[5], year: parts[6] }
}

function containsUnsupportedToken(token: string): boolean {
  return SUPPORTED_SPECIAL_TOKENS.some((s) => token.includes(s))
}

function pad2(v: number): string { return v.toString().padStart(2, "0") }

function parseHourRange(token: string): [string, string, string | null] {
  let step: string | null = null
  let base = token
  if (token.includes("/")) { [base, step] = token.split("/", 2) }
  if (base.includes("-")) { const [s, e] = base.split("-", 2); return [s, e, step] }
  return [base, base, step]
}

function parseMinuteStep(token: string): [number | null, number] {
  const [base, step] = token.split("/", 2)
  return [base === "*" ? null : parseInt(base), parseInt(step)]
}

export function decodeToUi(fields: CronFields): DecodeResult {
  const warnings: string[] = []
  let lossless = true

  for (const token of [fields.second, fields.minute, fields.hour, fields.day, fields.month, fields.week, fields.year]) {
    if (containsUnsupportedToken(token)) {
      return { param: defaultUiParam(), warnings, unsupported_reason: `Unsupported Quartz token in field: ${token}`, lossless: false }
    }
  }

  if (fields.day !== "*" && fields.day !== "?" && fields.week !== "*" && fields.week !== "?") {
    return { param: defaultUiParam(), warnings, unsupported_reason: "Both day-of-month and day-of-week are specific.", lossless: false }
  }

  const param = defaultUiParam()
  if (fields.day !== "*" && fields.day !== "?") {
    param.schedule = fields.day.split(",").map((d) => ["daily", d])
  } else if (fields.week !== "*" && fields.week !== "?") {
    param.schedule = fields.week.split(",").map((d) => ["weekly", d])
  }

  const { minute, hour } = fields

  // minute step
  if (minute.includes("/") || minute === "*") {
    param.frequency = "2"
    let startMinute: number
    if (minute === "*") { param.time_gap = "1m"; startMinute = 0 }
    else { const [sm, step] = parseMinuteStep(minute); param.time_gap = `${step}m`; startMinute = sm ?? 0 }

    const [hStart, hEnd] = parseHourRange(hour)
    if (hour === "*") { param.schedule_start_time = `00:${pad2(startMinute)}`; param.schedule_end_time = "23:59" }
    else {
      param.schedule_start_time = `${pad2(parseInt(hStart))}:${pad2(startMinute)}`
      param.schedule_end_time = `${pad2(parseInt(hEnd))}:59`
      if (minute.startsWith("*/")) { warnings.push("Cron minute step '*/N' does not contain explicit start-minute anchor; inferred as :00."); lossless = false }
    }
    return { param, warnings, unsupported_reason: null, lossless }
  }

  // hour step
  const [hStart, hEnd, hStep] = parseHourRange(hour)
  if (hStep !== null) {
    param.frequency = "2"
    param.time_gap = parseInt(hStep)
    param.schedule_start_time = `${pad2(parseInt(hStart))}:${pad2(parseInt(minute))}`
    param.schedule_end_time = `${pad2(parseInt(hEnd))}:59`
    return { param, warnings, unsupported_reason: null, lossless }
  }

  // once daily
  param.frequency = "1"
  param.schedule_start_time = `${pad2(parseInt(hour))}:${pad2(parseInt(minute))}`
  param.schedule_end_time = null
  param.time_gap = null
  return { param, warnings, unsupported_reason: null, lossless }
}

function minuteAnchorValues(startMinute: number, gap: number): number[] {
  const values: number[] = []; const seen = new Set<number>()
  let current = startMinute
  for (let i = 0; i < 60; i++) {
    const mod = current % 60
    if (seen.has(mod)) break
    seen.add(mod); values.push(mod); current += gap
  }
  return values.sort((a, b) => a - b)
}

export function encodeFromUi(param: UiScheduleParam, mode: "business" | "classic" = "classic"): string {
  const crontab = ["0", "0", "*", "*", "*", "?", "*"]
  const [startH, startM] = param.schedule_start_time.split(":").map(Number)
  const schedule = param.schedule || [["everyday"]]
  const scheduleType = schedule[0][0]
  const scheduleValues = schedule.filter((item) => item.length > 1).map((item) => item[1])

  if (scheduleType === "daily" || scheduleType === "monthly") crontab[3] = scheduleValues.join(",")
  else if (scheduleType === "weekly") { crontab[3] = "?"; crontab[5] = scheduleValues.join(",") }

  if (param.frequency === "2" && param.time_gap != null) {
    let endH = 23
    if (param.schedule_end_time) endH = parseInt(param.schedule_end_time.split(":")[0])

    const gapText = String(param.time_gap)
    if (gapText.endsWith("m")) {
      const gap = parseInt(gapText.replace("m", ""))
      if (!ALLOWED_MINUTE_GAPS.has(gap)) throw new Error(`Unsupported minute gap: ${gap}. Allowed: ${[...ALLOWED_MINUTE_GAPS].sort((a, b) => a - b).join(",")}`)
      if (mode === "business") { crontab[1] = minuteAnchorValues(startM, gap).join(",") }
      else if (startM === 0 && gap === 1) crontab[1] = "*"
      else crontab[1] = `*/${gap}`
      crontab[2] = (startH === 0 && endH === 23) ? "*" : `${pad2(startH)}-${pad2(endH)}`
    } else {
      const hourGap = parseInt(gapText)
      if (hourGap < ALLOWED_HOUR_GAP_MIN || hourGap > ALLOWED_HOUR_GAP_MAX) throw new Error(`Unsupported hour gap: ${hourGap}`)
      crontab[1] = pad2(startM)
      crontab[2] = (startH === 0 && endH === 23 && hourGap === 1) ? "*" : `${pad2(startH)}-${pad2(endH)}/${hourGap}`
    }
  } else {
    crontab[1] = pad2(startM)
    crontab[2] = pad2(startH)
  }
  return crontab.join(" ")
}

export function roundtrip(expr: string, mode: "business" | "classic" = "classic"): Record<string, unknown> {
  const fields = parseCron(expr)
  const decoded = decodeToUi(fields)
  if (decoded.unsupported_reason) return { ui_param: decoded.param, rebuilt_cron: null, warnings: decoded.warnings, unsupported_reason: decoded.unsupported_reason, lossless: false }
  const rebuilt = encodeFromUi(decoded.param, mode)
  return { ui_param: decoded.param, rebuilt_cron: rebuilt, warnings: decoded.warnings, unsupported_reason: null, lossless: decoded.lossless }
}

export function convertAgentCron(expr: string, scheduleStartTime?: string | null, scheduleEndTime?: string | null, mode: "business" | "classic" = "classic"): Record<string, unknown> {
  const fields = parseCron(expr)
  const decoded = decodeToUi(fields)
  if (decoded.unsupported_reason) return { ok: false, input_cron: normalizeCron(expr), output_cron: null, ui_param: decoded.param, warnings: decoded.warnings, unsupported_reason: decoded.unsupported_reason, lossless: false }

  const param = decoded.param
  if (scheduleStartTime != null) { param.schedule_start_time = scheduleStartTime; decoded.warnings.push("schedule_start_time overridden by caller."); decoded.lossless = false }
  if (scheduleEndTime != null) { param.schedule_end_time = scheduleEndTime; decoded.warnings.push("schedule_end_time overridden by caller."); decoded.lossless = false }

  try {
    const outputCron = encodeFromUi(param, mode)
    return { ok: true, input_cron: normalizeCron(expr), output_cron: outputCron, ui_param: param, warnings: decoded.warnings, unsupported_reason: null, lossless: decoded.lossless }
  } catch (e) {
    return { ok: false, input_cron: normalizeCron(expr), output_cron: null, ui_param: param, warnings: decoded.warnings, unsupported_reason: String(e), lossless: false }
  }
}
