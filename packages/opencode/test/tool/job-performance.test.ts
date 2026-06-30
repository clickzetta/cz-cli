import { describe, test, expect } from "bun:test"
import { serviceUrlToMcpUrl, buildAuthHeaders, pruneUndefined } from "../../src/tool/job-performance"

describe("serviceUrlToMcpUrl (central-region only)", () => {
  test("uat- prefix -> uat central", () => {
    expect(serviceUrlToMcpUrl("uat-api.clickzetta.com")).toBe("https://uat-mcp-api.clickzetta.com/mcp")
  })
  test("Volkswagen UAT host -> Volkswagen UAT MCP endpoint", () => {
    expect(serviceUrlToMcpUrl("http://lakehouse-studio.uat.cn-vw.volkswagen-cea.com/api")).toBe(
      "http://lakehouse-studio.uat.cn-vw.volkswagen-cea.com/mcp",
    )
  })
  test("dev- / localhost / 0.0.0.0 -> dev central", () => {
    expect(serviceUrlToMcpUrl("dev-api.clickzetta.com")).toBe("https://dev-mcp-api.clickzetta.com/mcp")
    expect(serviceUrlToMcpUrl("http://localhost:8080")).toBe("https://dev-mcp-api.clickzetta.com/mcp")
  })
  test("any clickzetta.com host -> cn-shanghai-alicloud central", () => {
    expect(serviceUrlToMcpUrl("cn-shanghai-alicloud.api.clickzetta.com")).toBe(
      "https://cn-shanghai-alicloud-mcp.api.clickzetta.com/mcp",
    )
    // 非中央 region 也归到中央
    expect(serviceUrlToMcpUrl("cn-beijing-alicloud.api.clickzetta.com")).toBe(
      "https://cn-shanghai-alicloud-mcp.api.clickzetta.com/mcp",
    )
  })
  test("any singdata.com host -> ap-southeast-1-alicloud central", () => {
    expect(serviceUrlToMcpUrl("ap-southeast-1-aws.api.singdata.com")).toBe(
      "https://ap-southeast-1-alicloud-mcp.api.singdata.com/mcp",
    )
  })
  test("unknown host falls back to its own -mcp transform", () => {
    expect(serviceUrlToMcpUrl("foo-api.example.com")).toBe("https://foo-mcp-api.example.com/mcp")
  })
})

describe("buildAuthHeaders", () => {
  test("uses Bearer token when PAT present", () => {
    expect(buildAuthHeaders({ pat: "xyz", username: "u" })).toEqual({ "X-Lakehouse-Token": "Bearer xyz" })
  })
  test("falls back to x-Lakehouse-* credentials (service normalized to host)", () => {
    expect(
      buildAuthHeaders({
        username: "UAT_TEST",
        password: "Abcd123456",
        service: "https://uat-api.clickzetta.com",
        instance: "jnsxwfyr",
        workspace: "datagpt_ws",
        schema: "public",
        vcluster: "DEFAULT",
      }),
    ).toEqual({
      "x-Lakehouse-Username": "UAT_TEST",
      "x-Lakehouse-Password": "Abcd123456",
      "x-Lakehouse-Service": "uat-api.clickzetta.com",
      "x-Lakehouse-Instance": "jnsxwfyr",
      "x-Lakehouse-Workspace": "datagpt_ws",
      "x-Lakehouse-Schema": "public",
      "x-Lakehouse-VCluster": "DEFAULT",
    })
  })
})

describe("pruneUndefined", () => {
  test("drops undefined params", () => {
    expect(pruneUndefined({ job_id: "j", workspace_name: undefined })).toEqual({ job_id: "j" })
  })
})
