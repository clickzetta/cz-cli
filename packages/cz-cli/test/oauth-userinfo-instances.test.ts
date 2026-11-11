import { describe, expect, test } from "bun:test"

import { parseInstances, parseUserInfo } from "../src/commands/oauth-userinfo"

// gatewayMapping is keyed "<cspId>-<regionId>", so a wrong instance pick shows up
// as a wrong region host too — which is why every test here checks `service`
// alongside the id.
const GATEWAY_MAPPING = JSON.stringify({
  "1-1": "https://cn-shanghai-alicloud.api.clickzetta.com",
  "2-7": "https://us-east-1-aws.api.clickzetta.com",
})

const LAKEHOUSE = { cspId: 1, regionId: 1, serviceId: 1, id: 159973, name: "lakehouse-a" }
const LAKEHOUSE_OTHER_REGION = { cspId: 2, regionId: 7, serviceId: 1, id: 200002, name: "lakehouse-b" }
// A different product's instance on the same account. The CLI cannot connect to
// it: it serves no workspace listing.
const NOT_LAKEHOUSE = { cspId: 2, regionId: 7, serviceId: 4, id: 999001, name: "other-product" }

function body(instanceList: unknown[], extra: Record<string, unknown> = {}) {
  return {
    userId: 110000011361,
    accountName: "wynptmks",
    account_id: 112407,
    gatewayMapping: GATEWAY_MAPPING,
    instanceList,
    ...extra,
  }
}

describe("parseUserInfo picks the default instance", () => {
  // The regression this guards: instanceList[0] was taken verbatim, so an account
  // whose other product happens to sort first got that instance's id AND its
  // region gateway.
  test("skips a non-Lakehouse instance that comes first", () => {
    const parsed = parseUserInfo(body([NOT_LAKEHOUSE, LAKEHOUSE]))

    expect(parsed?.instanceId).toBe(159973)
    expect(parsed?.instanceName).toBe("lakehouse-a")
    expect(parsed?.service).toBe("cn-shanghai-alicloud.api.clickzetta.com")
  })

  test("takes the first Lakehouse row when several are present", () => {
    const parsed = parseUserInfo(body([NOT_LAKEHOUSE, LAKEHOUSE_OTHER_REGION, LAKEHOUSE]))

    expect(parsed?.instanceId).toBe(200002)
    // Its own region, not the first mapping entry.
    expect(parsed?.service).toBe("us-east-1-aws.api.clickzetta.com")
  })

  // Older userinfo bodies omit serviceId and only ever listed Lakehouse. Reading
  // the absence as a mismatch would leave those accounts with no instance.
  test("treats a missing serviceId as Lakehouse", () => {
    const { serviceId: _omitted, ...noServiceId } = LAKEHOUSE
    const parsed = parseUserInfo(body([noServiceId]))

    expect(parsed?.instanceId).toBe(159973)
    expect(parsed?.service).toBe("cn-shanghai-alicloud.api.clickzetta.com")
  })

  // The field arrives as a JSON number on the routes we have seen, but a numeric
  // STRING would have slipped past a `typeof === "number"` test into the
  // absent-value default and been read as Lakehouse. Coerce, don't type-check.
  test("coerces a numeric string serviceId instead of defaulting it", () => {
    const parsed = parseUserInfo(body([{ ...NOT_LAKEHOUSE, serviceId: "4" }, { ...LAKEHOUSE, serviceId: "1" }]))

    expect(parsed?.instanceId).toBe(159973)
    expect(parsed?.service).toBe("cn-shanghai-alicloud.api.clickzetta.com")
  })

  // Same shape as an empty instanceList: the identity is real, there is just
  // nothing here this CLI can connect to. It must not fail the login.
  test("reports no instance when the account has no Lakehouse at all", () => {
    const parsed = parseUserInfo(body([NOT_LAKEHOUSE]))

    expect(parsed?.instanceId).toBe(0)
    expect(parsed?.instanceName).toBeUndefined()
    expect(parsed?.service).toBeUndefined()
    // Identity still came through.
    expect(parsed?.userId).toBe(110000011361)
    expect(parsed?.accountName).toBe("wynptmks")
  })

  // `instanceName` at the top level is the account's own default and outranks the
  // list, so filtering must not disturb it.
  test("leaves an explicit top-level instanceName alone", () => {
    const parsed = parseUserInfo(body([NOT_LAKEHOUSE, LAKEHOUSE], { instanceName: "explicit" }))

    expect(parsed?.instanceName).toBe("explicit")
    expect(parsed?.instanceId).toBe(159973)
  })
})

describe("parseInstances enumerates only Lakehouse", () => {
  // Has to agree with parseUserInfo: a profile generated for another product's
  // instance would point at a service that cannot list a workspace.
  test("drops instances of other products", () => {
    expect(parseInstances(body([NOT_LAKEHOUSE, LAKEHOUSE, LAKEHOUSE_OTHER_REGION]))).toEqual([
      { instanceId: 159973, instanceName: "lakehouse-a", service: "cn-shanghai-alicloud.api.clickzetta.com" },
      { instanceId: 200002, instanceName: "lakehouse-b", service: "us-east-1-aws.api.clickzetta.com" },
    ])
  })

  test("keeps rows whose serviceId is absent", () => {
    const { serviceId: _omitted, ...noServiceId } = LAKEHOUSE
    expect(parseInstances(body([noServiceId])).map((i) => i.instanceId)).toEqual([159973])
  })

  test("returns nothing when the account has no Lakehouse", () => {
    expect(parseInstances(body([NOT_LAKEHOUSE]))).toEqual([])
  })

  test("drops a numeric-string serviceId that names another product", () => {
    expect(parseInstances(body([{ ...NOT_LAKEHOUSE, serviceId: "4" }]))).toEqual([])
    expect(parseInstances(body([{ ...LAKEHOUSE, serviceId: "1" }])).map((i) => i.instanceId)).toEqual([159973])
  })

  // The default instance parseUserInfo reports must itself be in the enumerated
  // list, or the login would provision profiles that exclude the one it named.
  test("contains the instance parseUserInfo chose as default", () => {
    const raw = body([NOT_LAKEHOUSE, LAKEHOUSE_OTHER_REGION, LAKEHOUSE])
    const chosen = parseUserInfo(raw)?.instanceId

    expect(parseInstances(raw).map((i) => i.instanceId)).toContain(chosen)
  })
})
