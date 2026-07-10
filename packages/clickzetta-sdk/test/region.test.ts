import { describe, expect, test } from "bun:test"
import { detectEnv, toServiceUrl } from "../src/config/region"

describe("region helpers", () => {
  test("preserves full base urls including api paths", () => {
    expect(toServiceUrl("https://fumi-cn-south-1-huaweicloud.clickzetta.com/api")).toBe(
      "https://fumi-cn-south-1-huaweicloud.clickzetta.com/api",
    )
    expect(toServiceUrl("http://127.0.0.1:3000/api/")).toBe("http://127.0.0.1:3000/api")
  })

  test("detects env from urls with paths", () => {
    expect(detectEnv("https://dev-api.clickzetta.com/api")).toBe("dev")
    expect(detectEnv("https://fumi-cn-south-1-huaweicloud.clickzetta.com/api")).toBe("prod")
  })
})
