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
