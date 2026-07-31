import { describe, expect, test } from "bun:test"
import { partitionEntryHost, resolveLoginTarget } from "../src/connection/login-target"

describe("partitionEntryHost", () => {
  // Region hosts, NOT the central api.<root>: the central hosts cannot serve as
  // OAuth issuers (api.clickzetta.com returns 200 but declares a region issuer,
  // which RFC 8414 §3.3 forbids; api.singdata.com has no DNS record at all).
  test("maps customer partitions to region OAuth entries", () => {
    expect(partitionEntryHost("cn")).toBe("cn-shanghai-alicloud.api.clickzetta.com")
    expect(partitionEntryHost("intl")).toBe("ap-southeast-1-alicloud.api.singdata.com")
  })

  test("never returns a central host, whose discovery issuer does not self-reference", () => {
    for (const p of ["cn", "intl"] as const) {
      expect(partitionEntryHost(p)).not.toBe("api.clickzetta.com")
      expect(partitionEntryHost(p)).not.toBe("api.singdata.com")
    }
  })
})

describe("resolveLoginTarget", () => {
  test("--oauth-url is used VERBATIM (no region stripping, no rewriting)", async () => {
    // A region host is NOT rewritten to a central entry — the caller owns their
    // input. If it doesn't serve OAuth, it fails loudly rather than being "fixed".
    const t = await resolveLoginTarget({ oauthUrl: "cn-shanghai-alicloud.api.clickzetta.com" })
    expect(t.entryHost).toBe("cn-shanghai-alicloud.api.clickzetta.com")
    expect(t.protocol).toBe("https")
  })

  test("--oauth-url keeps protocol and strips only scheme/path via splitEndpoint", async () => {
    const t = await resolveLoginTarget({ oauthUrl: "http://uat-api.clickzetta.com" })
    expect(t.entryHost).toBe("uat-api.clickzetta.com")
    expect(t.protocol).toBe("http")
  })

  test("--oauth-url with a custom domain is kept as its host", async () => {
    const t = await resolveLoginTarget({ oauthUrl: "https://czstudio.devops.xiaohongshu.com/api" })
    expect(t.entryHost).toBe("czstudio.devops.xiaohongshu.com")
  })

  test("--partition cn/intl map to prod region entries", async () => {
    const cn = "cn-shanghai-alicloud.api.clickzetta.com"
    const intl = "ap-southeast-1-alicloud.api.singdata.com"
    expect((await resolveLoginTarget({ partition: "cn" })).entryHost).toBe(cn)
    expect((await resolveLoginTarget({ partition: "intl" })).entryHost).toBe(intl)
    expect((await resolveLoginTarget({ partition: "China" })).entryHost).toBe(cn)
    expect((await resolveLoginTarget({ partition: "international" })).entryHost).toBe(intl)
  })

  test("--oauth-url takes precedence over partition", async () => {
    const t = await resolveLoginTarget({ oauthUrl: "api.singdata.com", partition: "cn" })
    expect(t.entryHost).toBe("api.singdata.com")
  })

  test("no target in a non-interactive context throws (never falls back to a profile)", async () => {
    const wasTTY = process.stdin.isTTY
    try {
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true })
      await expect(resolveLoginTarget({})).rejects.toThrow("LOGIN_TARGET_REQUIRED")
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: wasTTY, configurable: true })
    }
  })
})
