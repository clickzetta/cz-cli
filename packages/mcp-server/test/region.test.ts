import { describe, it, expect } from "bun:test"
import {
  getRegionByAlias,
  getRegionByServiceUrl,
  getRegionCodeByCregionId,
  getAvailableRegions,
  Region,
} from "../src/config/region.js"

describe("getRegionByAlias", () => {
  it("returns the canonical region for English aliases", () => {
    expect(getRegionByAlias("aliyun")).toBe(Region.CN_SHANGHAI_ALICLOUD)
    expect(getRegionByAlias("tencent")).toBe(Region.AP_SHANGHAI_TENCENTCLOUD)
    expect(getRegionByAlias("kuaishou")).toBe(Region.KUAISHOU)
  })

  it("returns the canonical region for Chinese aliases", () => {
    expect(getRegionByAlias("阿里云")).toBe(Region.CN_SHANGHAI_ALICLOUD)
    expect(getRegionByAlias("腾讯云北京")).toBe(Region.AP_BEIJING_TENCENTCLOUD)
    expect(getRegionByAlias("高途")).toBe(Region.GAOTU)
  })

  it("is case-insensitive", () => {
    expect(getRegionByAlias("Aliyun")).toBe(Region.CN_SHANGHAI_ALICLOUD)
    expect(getRegionByAlias("UAT")).toBe(Region.UAT)
  })

  it("returns default when alias is empty or unknown", () => {
    expect(getRegionByAlias("", "fallback")).toBe("fallback")
    expect(getRegionByAlias(null, "fallback")).toBe("fallback")
    expect(getRegionByAlias("unknown-region", "fallback")).toBe("fallback")
  })

  it("returns undefined when unknown and no default given", () => {
    expect(getRegionByAlias("unknown-region")).toBeUndefined()
  })
})

describe("getRegionByServiceUrl", () => {
  it("matches known URL tables", () => {
    const table = {
      [Region.CN_SHANGHAI_ALICLOUD]: "https://api.clickzetta.com",
      [Region.UAT]: "https://uat-api.clickzetta.com",
    }
    expect(
      getRegionByServiceUrl("https://api.clickzetta.com", table),
    ).toBe(Region.CN_SHANGHAI_ALICLOUD)
    expect(
      getRegionByServiceUrl("uat-api.clickzetta.com", table),
    ).toBe(Region.UAT)
  })

  it("returns default when no match", () => {
    const table = { dev: "https://dev.example.com" }
    expect(
      getRegionByServiceUrl("other.example.com", table, "fallback"),
    ).toBe("fallback")
  })

  it("returns default when no url table given", () => {
    expect(
      getRegionByServiceUrl("api.clickzetta.com", null, "fallback"),
    ).toBe("fallback")
  })
})

describe("getRegionCodeByCregionId", () => {
  it("maps test envs to alicloud", () => {
    expect(getRegionCodeByCregionId("dev")).toBe("alicloud")
    expect(getRegionCodeByCregionId("sit")).toBe("alicloud")
    expect(getRegionCodeByCregionId("uat")).toBe("alicloud")
  })

  it("returns upper-cased provider suffix for cloud regions", () => {
    expect(getRegionCodeByCregionId("cn-shanghai-alicloud")).toBe("ALICLOUD")
    expect(getRegionCodeByCregionId("ap-shanghai-tencentcloud")).toBe("TENCENTCLOUD")
    expect(getRegionCodeByCregionId("ap-southeast-1-aws")).toBe("AWS")
  })

  it("returns undefined for empty input", () => {
    expect(getRegionCodeByCregionId("")).toBeUndefined()
  })
})

describe("getAvailableRegions", () => {
  it("lists all enum values", () => {
    const regions = getAvailableRegions()
    expect(regions[Region.DEV]?.name).toBe("dev")
    expect(regions[Region.CN_SHANGHAI_ALICLOUD]?.name).toBe("cn-shanghai-alicloud")
    expect(Object.keys(regions).length).toBeGreaterThanOrEqual(12)
  })
})
