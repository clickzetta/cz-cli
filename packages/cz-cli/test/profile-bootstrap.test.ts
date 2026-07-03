import { describe, expect, test } from "bun:test"
import { resolveServiceHost } from "../src/commands/profile-bootstrap"
import { SERVICE_ENDPOINTS } from "../src/commands/setup"

describe("profile bootstrap region service mapping", () => {
  test("maps Volkswagen UAT region to its Studio API endpoint", () => {
    expect(resolveServiceHost("", "uat-cn-shanghai-alicloud")).toBe(
      "lakehouse-studio.uat.cn-vw.volkswagen-cea.com/api",
    )
    expect(SERVICE_ENDPOINTS).toContain("lakehouse-studio.uat.cn-vw.volkswagen-cea.com/api")
  })

  test("keeps generic fallback for unknown region keys", () => {
    expect(resolveServiceHost("", "unknown-region")).toBe("unknown-region.api.clickzetta.com")
  })
})
