/**
 * Pins the region → API-host table, and the rule that a region's partition is not
 * derivable from its name.
 * Run: bun test test/region-api-hosts.test.ts
 *
 * Why this exists. The region-probe loop used to format its own hosts as
 * `${region}.api.clickzetta.com` for every entry in PROD_REGIONS, ignoring the
 * table that already recorded the right partition per region. DNS says that host
 * does not exist for the intl AWS region:
 *
 *   ap-southeast-1-aws.api.clickzetta.com      → NXDOMAIN
 *   ap-southeast-1-aws.api.singdata.com        → resolves
 *   ap-southeast-1-alicloud.api.<either>       → both resolve
 *   cn-shanghai-alicloud.api.singdata.com      → NXDOMAIN
 *
 * So auto-detection could never find that region: every probe went to a hostname
 * with no DNS record. These assertions are offline — the DNS facts above are what
 * justify the expected values, not something the suite re-checks.
 */
import { describe, expect, test } from "bun:test"
import { PROD_REGIONS, REGION_API_HOSTS } from "../src/commands/profile-bootstrap"

describe("region → API host table", () => {
  test("every probed region has an entry", () => {
    // A region absent from the table is skipped by the probe loop, so it would be
    // silently undetectable — the same end result as the bug this replaced.
    const missing = PROD_REGIONS.filter((region) => !REGION_API_HOSTS[region])
    expect(missing).toEqual([])
  })

  test("the intl regions live on singdata.com, not clickzetta.com", () => {
    // The bug in one line: formatting `${region}.api.clickzetta.com` for these
    // yields NXDOMAIN.
    expect(REGION_API_HOSTS["ap-southeast-1-aws"]).toBe("ap-southeast-1-aws.api.singdata.com")
    expect(REGION_API_HOSTS["ap-southeast-1-alicloud"]).toBe("ap-southeast-1-alicloud.api.singdata.com")
  })

  test("domestic regions live on clickzetta.com", () => {
    for (const region of [
      "cn-shanghai-alicloud",
      "cn-north-1-aws",
      "ap-shanghai-tencentcloud",
      "ap-beijing-tencentcloud",
      "ap-guangzhou-tencentcloud",
    ]) {
      expect(REGION_API_HOSTS[region]).toBe(`${region}.api.clickzetta.com`)
    }
  })

  test("a region's partition cannot be guessed from its name", () => {
    // `ap-` prefixes both a domestic tencentcloud region and the intl AWS one, so
    // no rule over the region string could pick the partition — which is why the
    // table has to be the authority rather than a format string.
    expect(REGION_API_HOSTS["ap-shanghai-tencentcloud"]).toContain(".clickzetta.com")
    expect(REGION_API_HOSTS["ap-southeast-1-aws"]).toContain(".singdata.com")
  })

  test("environment entries keep the hyphen form", () => {
    // Environments are a prefix on `api` (`uat-api.…`); regions are a label before
    // it (`<region>.api.…`). Conflating the two is the wider bug class here.
    expect(REGION_API_HOSTS["uat"]).toBe("uat-api.clickzetta.com")
    expect(REGION_API_HOSTS["dev"]).toBe("dev-api.clickzetta.com")
    expect(REGION_API_HOSTS["sit"]).toBe("sit-api.clickzetta.com")
  })

  test("enterprise deployments keep their own hosts and /api path", () => {
    expect(REGION_API_HOSTS["kuaishou"]).toBe("cz-account.corp.kuaishou.com/api")
    expect(REGION_API_HOSTS["kuaishou-sgp"]).toBe("cz-sgp-account.corp.kuaishou.com/api")
    expect(REGION_API_HOSTS["gaotu-ap-beijing-tencentcloud"]).toBe("studio-bj-gaotu.clickzetta-inc.com/api")
  })

  test("no entry carries a scheme or trailing slash", () => {
    // Callers pass these through toServiceUrl, which prepends the scheme.
    for (const [region, host] of Object.entries(REGION_API_HOSTS)) {
      expect(host, region).not.toContain("://")
      expect(host, region).not.toEndWith("/")
    }
  })
})
