import { describe, expect, test } from "bun:test"
import {
  abbreviate,
  cashTone,
  formatCash,
  formatPercentLeft,
  periodSuffix,
  profileRows,
  quotaRows,
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

describe("periodSuffix", () => {
  test("marks a windowed cap and leaves a lifetime cap bare", () => {
    expect(periodSuffix("daily")).toBe(" today")
    expect(periodSuffix("monthly")).toBe(" this month")
    expect(periodSuffix("total")).toBe("")
    expect(periodSuffix(undefined)).toBe("")
  })
})

describe("formatPercentLeft", () => {
  test("reports whole percentages", () => {
    expect(formatPercentLeft(1)).toBe("100%")
    expect(formatPercentLeft(0.5)).toBe("50%")
    expect(formatPercentLeft(0)).toBe("0%")
  })

  // Rounding up here would report "1% left" for a quota that is all but gone, which
  // is the one direction the figure must not err in.
  test("floors rather than rounds, so a nearly-spent quota reads as 0%", () => {
    expect(formatPercentLeft(0.004)).toBe("0%")
    expect(formatPercentLeft(0.999)).toBe("99%")
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

describe("profileRows", () => {
  const info = {
    profile: "xh_0",
    authType: "oauth",
    accountName: "xxjrdhjr",
    userName: "xh123",
    env: "uat",
    instance: "0e824e33",
    workspace: "quick_start",
  }

  test("leads with the profile and lists identity then connection target", () => {
    expect(profileRows(info)).toEqual([
      { text: "xh_0 · oauth", tone: "text" },
      { text: "xxjrdhjr account", tone: "textMuted" },
      { text: "xh123 user", tone: "textMuted" },
      { text: "uat env", tone: "textMuted" },
      { text: "0e824e33 instance", tone: "textMuted" },
      { text: "quick_start workspace", tone: "textMuted" },
    ])
  })

  // env and region are different facts (see tui-quota-data.ts's knownEnv/
  // knownRegion) and get their own rows so neither is mislabelled as the other.
  test("renders region on its own row, distinct from env", () => {
    expect(profileRows({ profile: "p1", region: "ap-shanghai-tencentcloud" })).toEqual([
      { text: "p1", tone: "text" },
      { text: "ap-shanghai-tencentcloud region", tone: "textMuted" },
    ])
  })

  // Account and user look alike (a tenant handle vs a person) and must not be
  // collapsed into one line where either could be read as the other.
  test("keeps account and user on separate labelled rows", () => {
    const rows = profileRows(info).map((row) => row.text)
    expect(rows).toContain("xxjrdhjr account")
    expect(rows).toContain("xh123 user")
  })

  // userName arrives from the portal after the rest is already painted, so its row
  // must simply be absent rather than showing a placeholder.
  test("drops rows for fields that are not known yet", () => {
    expect(profileRows({ profile: "p1", accountName: "acct" })).toEqual([
      { text: "p1", tone: "text" },
      { text: "acct account", tone: "textMuted" },
    ])
  })

  test("renders nothing without a profile", () => {
    expect(profileRows(undefined)).toEqual([])
  })
})

describe("quotaRows", () => {
  test("renders balance, used/total and remaining for a healthy account", () => {
    expect(quotaRows({ cash: 51.2772, owe: 0, used: 1_000_000, limit: 10_000_000, period: "total" })).toEqual([
      { text: "¥51.28 balance", tone: "textMuted" },
      { text: "1.0M / 10.0M tokens", tone: "textMuted" },
      { text: "90% left", tone: "textMuted" },
    ])
  })

  test("marks an over-quota key red while keeping both numbers visible", () => {
    expect(quotaRows({ cash: 51.2772, used: 10_082_801, limit: 10_000_000, period: "total" }).slice(1)).toEqual([
      { text: "10.1M / 10.0M tokens", tone: "error" },
      { text: "0% left", tone: "error" },
    ])
  })

  test("distinguishes a daily cap from a lifetime one", () => {
    expect(quotaRows({ used: 0, limit: 10_000_000, period: "daily" })[0]).toEqual({
      text: "0 / 10.0M tokens today",
      tone: "textMuted",
    })
    expect(quotaRows({ used: 0, limit: 10_000_000, period: "total" })[0]).toEqual({
      text: "0 / 10.0M tokens",
      tone: "textMuted",
    })
  })

  // No rows means the renderer draws no section — better than a "Quota" heading
  // over blanks, which would read as "your quota is zero".
  test("renders nothing when there is no snapshot", () => {
    expect(quotaRows(undefined)).toEqual([])
  })

  test("renders nothing when the key could not be matched and billing is absent", () => {
    expect(quotaRows({})).toEqual([])
  })

  // The observed real case: balance resolves, the virtual key does not.
  test("still shows the balance when the key could not be matched", () => {
    expect(quotaRows({ cash: 51.2772 })).toEqual([{ text: "¥51.28 balance", tone: "textMuted" }])
  })

  test("omits the quota rows when the ceiling is unusable", () => {
    expect(quotaRows({ cash: 1, used: 5, limit: 0 })).toEqual([{ text: "¥1.00 balance", tone: "warning" }])
  })
})
