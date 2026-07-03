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
