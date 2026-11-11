import { describe, expect, test } from "bun:test"
import { convertAgentCron } from "../src/cron-adapter"

describe("convertAgentCron minute-gap encoding", () => {
  test("preserves a non-zero start minute with a minute gap", () => {
    // every 10 minutes starting at minute 15 must stay 15/10, not */10
    const r = convertAgentCron("0 15/10 * * * ?")
    expect(r.ok).toBe(true)
    expect(r.outputCron).toBe("0 15/10 * * * ? *")
    expect(r.uiParam.scheduleStartTime).toBe("00:15")
    expect(r.uiParam.timeGap).toBe("10m")
  })

  test("start minute 0 with a gap stays */gap", () => {
    expect(convertAgentCron("0 0/10 * * * ?").outputCron).toBe("0 */10 * * * ? *")
  })

  test("every minute encodes as *", () => {
    expect(convertAgentCron("0 * * * * ?").outputCron).toBe("0 * * * * ? *")
  })

  test("non-zero start minute round-trips through decode/encode", () => {
    const out = convertAgentCron("0 15/10 * * * ?").outputCron!
    expect(convertAgentCron(out).outputCron).toBe(out)
  })
})

describe("convertAgentCron hour=* with fixed minute (hourly)", () => {
  test("0 00 * * * ? * is hourly at minute 0", () => {
    const r = convertAgentCron("0 00 * * * ? *")
    expect(r.ok).toBe(true)
    expect(r.outputCron).toBe("0 00 * * * ? *")
    expect(r.uiParam.frequency).toBe("2")
    expect(r.uiParam.timeGap).toBe(1)
    expect(r.uiParam.scheduleStartTime).toBe("00:00")
    expect(r.uiParam.scheduleEndTime).toBe("23:59")
  })

  test("0 10 * * * ? * is hourly at minute 10", () => {
    const r = convertAgentCron("0 10 * * * ? *")
    expect(r.ok).toBe(true)
    expect(r.outputCron).toBe("0 10 * * * ? *")
    expect(r.uiParam.frequency).toBe("2")
    expect(r.uiParam.timeGap).toBe(1)
    expect(r.uiParam.scheduleStartTime).toBe("00:10")
    expect(r.uiParam.scheduleEndTime).toBe("23:59")
  })

  test("0 30 8-18 * * ? * is hourly at :30 within 8-18", () => {
    const r = convertAgentCron("0 30 8-18 * * ? *")
    expect(r.ok).toBe(true)
    expect(r.outputCron).toBe("0 30 08-18/1 * * ? *")
    expect(r.uiParam.frequency).toBe("2")
    expect(r.uiParam.timeGap).toBe(1)
    expect(r.uiParam.scheduleStartTime).toBe("08:30")
    expect(r.uiParam.scheduleEndTime).toBe("18:59")
  })

  test("MON,WED,FRI is converted to Studio weekly numeric days", () => {
    const r = convertAgentCron("0 0 9 ? * MON,WED,FRI *")
    expect(r.ok).toBe(true)
    expect(r.outputCron).toBe("0 00 09 ? * 1,3,5 *")
    expect(r.uiParam.schedule).toEqual([
      ["weekly", "1"],
      ["weekly", "3"],
      ["weekly", "5"],
    ])
  })

  test("MON-FRI is expanded to Studio weekly numeric days", () => {
    const r = convertAgentCron("0 00 07 ? * MON-FRI *")
    expect(r.ok).toBe(true)
    expect(r.outputCron).toBe("0 00 07 ? * 1,2,3,4,5 *")
    expect(r.uiParam.frequency).toBe("1")
    expect(r.uiParam.scheduleStartTime).toBe("07:00")
    expect(r.uiParam.schedule).toEqual([
      ["weekly", "1"],
      ["weekly", "2"],
      ["weekly", "3"],
      ["weekly", "4"],
      ["weekly", "5"],
    ])
  })

  test("roundtrip stability for hour-range expressions", () => {
    const r1 = convertAgentCron("0 30 8-18 * * ? *")
    const r2 = convertAgentCron(r1.outputCron!)
    expect(r2.outputCron).toBe(r1.outputCron)
  })
})

describe("convertAgentCron rejects fields it cannot express (#178)", () => {
  const rejected: Array<[string, string]> = [
    ["0 8,12 * * *", "hour field '8,12'"],
    ["0,30 9 * * *", "minute field '0,30'"],
    ["0 0 1 1 *", "month field '1'"],
    ["0 0 * * * ? 2030", "year field '2030'"],
    ["30 0 9 * * ? *", "second field '30'"],
    ["*/5 */2 * * *", "step in both fields"],
    ["0 18-9 * * *", "start is after end"],
    ["0 99 * * *", "out of range"],
  ]
  for (const [input, part] of rejected) {
    test(`rejects ${input}`, () => {
      const r = convertAgentCron(input)
      expect(r.ok).toBe(false)
      expect(r.outputCron).toBeNull()
      expect(r.error).toContain(part)
    })
  }

  test("0 */2 * * * converts faithfully instead of producing NaN", () => {
    const r = convertAgentCron("0 */2 * * *")
    expect(r.ok).toBe(true)
    expect(r.outputCron).toBe("0 00 00-23/2 * * ? *")
    expect(r.outputCron).not.toContain("NaN")
  })

  test("normal expressions keep working", () => {
    expect(convertAgentCron("0 0 * * *").outputCron).toBe("0 00 00 * * ? *")
    expect(convertAgentCron("30 2 * * 1").outputCron).toBe("0 30 02 ? * 1 *")
    expect(convertAgentCron("*/5 * * * *").outputCron).toBe("0 */5 * * * ? *")
    expect(convertAgentCron("0 0 1 * *").outputCron).toBe("0 00 00 1 * ? *")
    expect(convertAgentCron("0 30 9 * * ? *").outputCron).toBe("0 30 09 * * ? *")
  })
})

describe("convertAgentCron review follow-ups (#192)", () => {
  const old: Array<[string, string]> = [
    ["0-59/5 * * * *", "0 */5 * * * ? *"],
    ["0-59/10 * * * *", "0 */10 * * * ? *"],
    ["0-59/2 * * * *", "0 */2 * * * ? *"],
    ["0-59/15 * * * *", "0 */15 * * * ? *"],
    ["0-55/5 * * * *", "0 */5 * * * ? *"],
    ["10-50/10 * * * *", "0 10/10 * * * ? *"],
  ]
  for (const [input, out] of old) {
    test(`minute range step ${input} keeps old output`, () => {
      const r = convertAgentCron(input)
      expect(r.ok).toBe(true)
      expect(r.outputCron).toBe(out)
    })
  }

  test("minute range step that is not equivalent to a start/step is rejected", () => {
    expect(convertAgentCron("0-20/15 * * * *").ok).toBe(false)
  })

  for (const month of ["*", "1-12", "*/1", "1,2,3,4,5,6,7,8,9,10,11,12", "JAN-DEC"]) {
    test(`month ${month} normalises to *`, () => {
      const r = convertAgentCron(`0 0 * ${month} *`)
      expect(r.ok).toBe(true)
      expect(r.outputCron).toBe("0 00 00 * * ? *")
    })
  }
  test("partial month sets stay rejected", () => {
    expect(convertAgentCron("0 0 * 1-6 *").ok).toBe(false)
    expect(convertAgentCron("0 0 * */2 *").ok).toBe(false)
  })

  test("day-of-month is validated", () => {
    for (const d of ["32", "0", "*/2", "1-5", "abc"]) {
      const r = convertAgentCron(`0 0 ${d} * *`)
      expect(r.ok).toBe(false)
      expect(r.error).toContain("day-of-month")
    }
    expect(convertAgentCron("0 0 1,15 * *").outputCron).toBe("0 00 00 1,15 * ? *")
  })

  test("day-of-week is validated; Unix 0 is rejected, 7/names accepted", () => {
    const zero = convertAgentCron("0 9 * * 0")
    expect(zero.ok).toBe(false)
    expect(zero.error).toContain("day-of-week")
    expect(convertAgentCron("0 9 * * 8").ok).toBe(false)
    expect(convertAgentCron("0 9 * * 7").outputCron).toBe("0 00 09 ? * 7 *")
    expect(convertAgentCron("0 9 * * MON-FRI").outputCron).toBe("0 00 09 ? * 1,2,3,4,5 *")
  })

  test("Quartz N/S hour means N-23/S", () => {
    const r = convertAgentCron("0 0 8/2 * * ? *")
    expect(r.ok).toBe(true)
    expect(r.outputCron).toBe("0 00 08-23/2 * * ? *")
  })
})
