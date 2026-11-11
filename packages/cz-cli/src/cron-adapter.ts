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

const STUDIO_WEEKDAY_NAMES: Record<string, number> = {
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
  SUN: 7,
}

function expandStudioWeekdays(value: string): string[] {
  const result: string[] = []
  for (const rawPart of value.toUpperCase().split(",")) {
    const part = rawPart.trim()
    if (!part) continue
    const toDay = (token: string) => {
      const named = STUDIO_WEEKDAY_NAMES[token]
      if (named !== undefined) return named
      const numeric = Number(token)
      return Number.isInteger(numeric) && numeric >= 1 && numeric <= 7 ? numeric : undefined
    }
    if (part.includes("-")) {
      const [rawStart, rawEnd] = part.split("-", 2)
      const start = toDay(rawStart)
      const end = toDay(rawEnd)
      if (start === undefined || end === undefined) {
        result.push(part)
        continue
      }
      if (start <= end) {
        for (let day = start; day <= end; day++) result.push(String(day))
        continue
      }
      for (let day = start; day <= 7; day++) result.push(String(day))
      for (let day = 1; day <= end; day++) result.push(String(day))
      continue
    }
    const day = toDay(part)
    result.push(day === undefined ? part : String(day))
  }
  return Array.from(new Set(result))
}

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
      if (new RegExp(`(?<![A-Z])${t}(?![A-Z])`).test(val)) return `Unsupported Quartz token: ${t} in '${val}'`
    }
  }
  return null
}

const INT = "\\d{1,2}"
const MINUTE_FORMS = [new RegExp(`^${INT}$`), /^\*$/, /^\*\/\d{1,2}$/, new RegExp(`^${INT}/\\d{1,2}$`)]
const HOUR_FORMS = [new RegExp(`^${INT}$`), /^\*$/, /^\*\/\d{1,2}$/, new RegExp(`^${INT}-${INT}$`), new RegExp(`^${INT}-${INT}/\\d{1,2}$`)]

/** Reject any field shape the Studio schedule model cannot express, instead of silently narrowing or widening it. */
function unsupportedShape(fields: CronFields): string | null {
  if (!/^0+$/.test(fields.second)) return `Unsupported second field '${fields.second}': only 0 is supported.`
  if (fields.month !== "*" && fields.month !== "?") return `Unsupported month field '${fields.month}': only * is supported (yearly/monthly-subset schedules cannot be expressed).`
  if (fields.year !== "*") return `Unsupported year field '${fields.year}': only * is supported.`
  if (!MINUTE_FORMS.some(r => r.test(fields.minute))) {
    return `Unsupported minute field '${fields.minute}': only a single value, *, */N or N/N are supported (lists and ranges cannot be expressed).`
  }
  if (!HOUR_FORMS.some(r => r.test(fields.hour))) {
    return `Unsupported hour field '${fields.hour}': only a single value, *, */N, A-B or A-B/N are supported (lists cannot be expressed).`
  }
  const minuteStepped = fields.minute === "*" || fields.minute.includes("/")
  if (minuteStepped && fields.hour.includes("/")) {
    return `Unsupported combination of minute '${fields.minute}' and hour '${fields.hour}': a step in both fields cannot be expressed.`
  }
  if (!minuteStepped && !/^\d+$/.test(fields.minute)) return `Unsupported minute field '${fields.minute}'.`
  const minuteBase = fields.minute.split("/")[0]
  if (/^\d+$/.test(minuteBase) && Number(minuteBase) > 59) return `Minute out of range in '${fields.minute}'.`
  for (const h of fields.hour.split("/")[0].split("-")) if (/^\d+$/.test(h) && Number(h) > 23) return `Hour out of range in '${fields.hour}'.`
  if (fields.hour.includes("-")) {
    const [a, b] = fields.hour.split("/")[0].split("-").map(Number)
    if (a > b) return `Unsupported hour range '${fields.hour}': start is after end.`
  }
  return null
}

function parseHourRange(token: string): { start: string; end: string; step: string | null } {
  let step: string | null = null
  let base = token
  if (token.includes("/")) { [base, step] = token.split("/", 2) }
  if (base === "*") return { start: "0", end: "23", step }
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

  const shape = unsupportedShape(fields)
  if (shape) return { param, warnings, error: shape }

  if (fields.day !== "*" && fields.day !== "?" && fields.week !== "*" && fields.week !== "?") {
    return { param, warnings, error: "Both day-of-month and day-of-week are specific." }
  }

  if (fields.day !== "*" && fields.day !== "?") {
    param.schedule = fields.day.split(",").map(d => ["daily", d])
  } else if (fields.week !== "*" && fields.week !== "?") {
    param.schedule = expandStudioWeekdays(fields.week).map(d => ["weekly", d])
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

  // Hourly: hour="*" or hour is a range without step, with fixed minute
  if (hour === "*" || (hStart !== hEnd && !hStep)) {
    param.frequency = "2"
    param.timeGap = 1
    if (hour === "*") {
      param.scheduleStartTime = `00:${pad2(parseInt(minute, 10))}`
      param.scheduleEndTime = "23:59"
    } else {
      param.scheduleStartTime = `${pad2(parseInt(hStart, 10))}:${pad2(parseInt(minute, 10))}`
      param.scheduleEndTime = `${pad2(parseInt(hEnd, 10))}:59`
    }
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
      crontab[1] = startM === 0 ? (gap === 1 ? "*" : `*/${gap}`) : `${startM}/${gap}`
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

/** Compute next N run times for a 7-field Quartz cron (sec min hr dom mon dow year). */
export function cronNextRuns(expr: string, count = 5, from?: Date): string[] {
  let fields: CronFields
  try { fields = parseCron(expr) } catch { return [] }

  const DOW_NAMES: Record<string, number> = { SUN:1,MON:2,TUE:3,WED:4,THU:5,FRI:6,SAT:7 }
  const MON_NAMES: Record<string, number> = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 }

  function normalize(field: string, nameMap: Record<string, number>): string {
    return field.replace(/[A-Z]+/g, (m) => String(nameMap[m] ?? m))
  }

  function expand(field: string, min: number, max: number, nameMap?: Record<string, number>): Set<number> {
    const f = nameMap ? normalize(field.toUpperCase(), nameMap) : field
    if (f === "*" || f === "?") {
      const s = new Set<number>()
      for (let i = min; i <= max; i++) s.add(i)
      return s
    }
    const s = new Set<number>()
    for (const part of f.split(",")) {
      if (part.includes("/")) {
        const [rangeStr, stepStr] = part.split("/")
        const step = parseInt(stepStr, 10)
        const [lo, hi] = rangeStr === "*" ? [min, max] : rangeStr.split("-").map(Number)
        for (let v = lo ?? min; v <= (hi ?? max); v += step) s.add(v)
      } else if (part.includes("-")) {
        const [lo, hi] = part.split("-").map(Number)
        for (let v = lo; v <= hi; v++) s.add(v)
      } else {
        const n = parseInt(part, 10)
        if (!isNaN(n)) s.add(n)
      }
    }
    return s
  }

  const seconds = expand(fields.second, 0, 59)
  const minutes = expand(fields.minute, 0, 59)
  const hours   = expand(fields.hour, 0, 23)
  const months  = expand(fields.month, 1, 12, MON_NAMES)
  // day-of-week: 1=Sun…7=Sat in Quartz; JS getDay(): 0=Sun…6=Sat
  const dowField = fields.week === "?" ? null : expand(fields.week, 1, 7, DOW_NAMES)
  const domField = fields.day === "?" ? null : expand(fields.day, 1, 31)

  const results: string[] = []
  // Start from next second after `from`
  const start = new Date(from ?? new Date())
  start.setMilliseconds(0)
  start.setSeconds(start.getSeconds() + 1)

  let d = new Date(start)
  const limit = new Date(start)
  limit.setFullYear(limit.getFullYear() + 2) // search max 2 years ahead

  while (results.length < count && d < limit) {
    if (!months.has(d.getMonth() + 1)) { d.setDate(1); d.setHours(0,0,0,0); d.setMonth(d.getMonth() + 1); continue }
    if (domField && !domField.has(d.getDate())) { d.setDate(d.getDate() + 1); d.setHours(0,0,0,0); continue }
    if (dowField) {
      const jsDay = d.getDay() // 0=Sun
      const quartzDay = jsDay === 0 ? 1 : jsDay + 1 // Sun=1, Mon=2…Sat=7
      if (!dowField.has(quartzDay)) { d.setDate(d.getDate() + 1); d.setHours(0,0,0,0); continue }
    }
    if (!hours.has(d.getHours())) { d.setHours(d.getHours() + 1); d.setMinutes(0,0,0); continue }
    if (!minutes.has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1); d.setSeconds(0,0); continue }
    if (!seconds.has(d.getSeconds())) { d.setSeconds(d.getSeconds() + 1); d.setMilliseconds(0); continue }
    results.push(d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC"))
    d.setSeconds(d.getSeconds() + 1)
  }
  return results
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
