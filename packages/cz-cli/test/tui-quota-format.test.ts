import { describe, expect, test } from "bun:test"
import {
  abbreviate,
  cashTone,
  formatCash,
  periodLabel,
  quotaSegments,
  quotaTone,
  remainingRatio,
} from "../src/opencode-plugin/tui-quota-format"

describe("abbreviate", () => {
  test("abbreviates millions and thousands like the prompt's context counter", () => {
    expect(abbreviate(10_082_801)).toBe("10.1M")
    expect(abbreviate(10_000_000)).toBe("10.0M")
    expect(abbreviate(1_500)).toBe("1.5K")
  })

  test("leaves small counts exact", () => {
    expect(abbreviate(0)).toBe("0")
    expect(abbreviate(999)).toBe("999")
  })

  test("does not emit NaN for a non-finite count", () => {
    expect(abbreviate(Number.NaN)).toBe("?")
    expect(abbreviate(Number.POSITIVE_INFINITY)).toBe("?")
  })
})

describe("formatCash", () => {
  test("renders two decimals with a yuan sign", () => {
    expect(formatCash(51.2772)).toBe("¥51.28")
    expect(formatCash(0)).toBe("¥0.00")
  })
})

describe("periodLabel", () => {
  test("marks a windowed cap and leaves a lifetime cap bare", () => {
    expect(periodLabel("daily")).toBe("today ")
    expect(periodLabel("monthly")).toBe("month ")
    expect(periodLabel("total")).toBe("")
    expect(periodLabel(undefined)).toBe("")
  })
})

describe("remainingRatio", () => {
  test("reports the unused fraction", () => {
    expect(remainingRatio(0, 10)).toBe(1)
    expect(remainingRatio(5, 10)).toBe(0.5)
  })

  // A complimentary key can be billed past its ceiling, which would otherwise
  // produce a negative ratio and make the threshold comparisons unreliable.
  test("clamps an over-quota key to zero rather than going negative", () => {
    expect(remainingRatio(10_082_801, 10_000_000)).toBe(0)
  })

  test("treats a missing ceiling as exhausted, not as infinite headroom", () => {
    expect(remainingRatio(5, 0)).toBe(0)
  })
})

describe("quotaTone", () => {
  test("turns red only in the last tenth", () => {
    expect(quotaTone(0)).toBe("error")
    expect(quotaTone(0.09)).toBe("error")
    expect(quotaTone(0.1)).not.toBe("error")
  })

  test("warns through the next quarter, then stays neutral", () => {
    expect(quotaTone(0.2)).toBe("warning")
    expect(quotaTone(0.25)).toBe("textMuted")
    expect(quotaTone(1)).toBe("textMuted")
  })
})

describe("cashTone", () => {
  test("flags an owed balance even when cash remains", () => {
    expect(cashTone(100, 5)).toBe("error")
  })

  test("flags an empty balance and warns on a thin one", () => {
    expect(cashTone(0)).toBe("error")
    expect(cashTone(5)).toBe("warning")
    expect(cashTone(51.2772)).toBe("textMuted")
  })
})

describe("quotaSegments", () => {
  test("renders balance and used/total for a healthy account", () => {
    expect(quotaSegments({ cash: 51.2772, owe: 0, used: 1_000_000, limit: 10_000_000, period: "total" })).toEqual([
      { text: "¥51.28", tone: "textMuted" },
      { text: "1.0M/10.0M", tone: "textMuted" },
    ])
  })

  test("marks an over-quota key red while keeping both numbers visible", () => {
    const segments = quotaSegments({ cash: 51.2772, used: 10_082_801, limit: 10_000_000, period: "total" })
    expect(segments[1]).toEqual({ text: "10.1M/10.0M", tone: "error" })
  })

  test("distinguishes a daily cap from a lifetime one", () => {
    expect(quotaSegments({ used: 0, limit: 10_000_000, period: "daily" })).toEqual([
      { text: "today 0/10.0M", tone: "textMuted" },
    ])
    expect(quotaSegments({ used: 0, limit: 10_000_000, period: "total" })).toEqual([
      { text: "0/10.0M", tone: "textMuted" },
    ])
  })

  // The indicator shares a row with the agent and model labels, so anything it
  // cannot substantiate has to occupy no space at all.
  test("renders nothing when there is no snapshot", () => {
    expect(quotaSegments(undefined)).toEqual([])
  })

  test("renders nothing when the key could not be matched and billing is absent", () => {
    expect(quotaSegments({})).toEqual([])
  })

  test("still shows the balance when the key could not be matched", () => {
    expect(quotaSegments({ cash: 51.2772 })).toEqual([{ text: "¥51.28", tone: "textMuted" }])
  })

  test("omits the quota when the ceiling is unusable", () => {
    expect(quotaSegments({ cash: 1, used: 5, limit: 0 })).toEqual([{ text: "¥1.00", tone: "warning" }])
  })
})
