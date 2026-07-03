import { describe, it, expect } from "bun:test"
import { parseConnectionUrl, generateConnectionUrl, connectionConfigFromUrl } from "../src/config/parseUrl.js"

describe("parseConnectionUrl (parse_url.py:25-98)", () => {
  it("parses a full URL", () => {
    const p = parseConnectionUrl(
      "clickzetta://user:pass@myinstance.api.clickzetta.com/myworkspace?virtualcluster=default&schema=public&protocol=https",
    )
    expect(p.instance).toBe("myinstance")
    expect(p.host).toBe("api.clickzetta.com")
    expect(p.username).toBe("user")
    expect(p.password).toBe("pass")
    expect(p.workspace).toBe("myworkspace")
    expect(p.vcluster).toBe("default")
    expect(p.schema).toBe("public")
    expect(p.protocol).toBe("https")
    expect(p.service).toBe("https://api.clickzetta.com")
  })

  it("handles virtualCluster alias", () => {
    const p = parseConnectionUrl(
      "clickzetta://u:p@inst.host/ws?virtualCluster=vc1",
    )
    expect(p.vcluster).toBe("vc1")
  })

  it("handles magic_token and token_expire_time_ms", () => {
    const p = parseConnectionUrl(
      "clickzetta://u:p@inst.host/ws?vcluster=vc&magic_token=tok&token_expire_time_ms=7200000",
    )
    expect(p.magicToken).toBe("tok")
    expect(p.tokenExpireTimeMs).toBe(7200000)
  })

  it("handles /api/ path prefix", () => {
    const p = parseConnectionUrl(
      "clickzetta://u:p@inst.host/api/ws?vcluster=vc",
    )
    expect(p.workspace).toBe("ws")
    expect(p.service).toContain("/api")
  })

  it("throws when vcluster is missing", () => {
    expect(() =>
      parseConnectionUrl("clickzetta://u:p@inst.host/ws"),
    ).toThrow(/virtualcluster/)
  })

  it("throws for unsupported protocol", () => {
    expect(() =>
      parseConnectionUrl("clickzetta://u:p@inst.host/ws?vcluster=vc&protocol=ftp"),
    ).toThrow(/http or https/)
  })
})

describe("generateConnectionUrl (parse_url.py:101-113)", () => {
  it("round-trips a basic config", () => {
    const url = generateConnectionUrl({
      username: "user",
      password: "pass",
      instance: "inst",
      service: "api.clickzetta.com",
      host: "api.clickzetta.com",
      workspace: "ws",
      vcluster: "vc",
      schema: "public",
      protocol: "https",
      pat: "",
    })
    expect(url).toContain("clickzetta://user:pass@inst.api.clickzetta.com/ws")
    expect(url).toContain("vcluster=vc")
    expect(url).toContain("schema=public")
  })
})

describe("connectionConfigFromUrl", () => {
  it("returns a ConnectionConfig", () => {
    const cfg = connectionConfigFromUrl(
      "clickzetta://u:p@inst.host/ws?vcluster=vc&schema=s1",
    )
    expect(cfg.username).toBe("u")
    expect(cfg.workspace).toBe("ws")
    expect(cfg.vcluster).toBe("vc")
    expect(cfg.schema).toBe("s1")
  })
})
