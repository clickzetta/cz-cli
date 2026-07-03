import { describe, expect, test } from "bun:test"
import { buildAuthHeaders, pruneUndefined, serviceUrlToMcpUrl } from "../src/commands/job-performance"

describe("job performance MCP parity helpers", () => {
  test("maps service URLs to the same central MCP endpoint as the built-in tool", () => {
    expect(serviceUrlToMcpUrl("uat-api.clickzetta.com")).toBe("https://uat-mcp-api.clickzetta.com/mcp")
    expect(serviceUrlToMcpUrl("http://lakehouse-studio.uat.cn-vw.volkswagen-cea.com/api")).toBe(
      "http://lakehouse-studio.uat.cn-vw.volkswagen-cea.com/mcp",
    )
    expect(serviceUrlToMcpUrl("dev-api.clickzetta.com")).toBe("https://dev-mcp-api.clickzetta.com/mcp")
    expect(serviceUrlToMcpUrl("cn-beijing-alicloud.api.clickzetta.com")).toBe(
      "https://cn-shanghai-alicloud-mcp.api.clickzetta.com/mcp",
    )
    expect(serviceUrlToMcpUrl("ap-southeast-1-aws.api.singdata.com")).toBe(
      "https://ap-southeast-1-alicloud-mcp.api.singdata.com/mcp",
    )
  })

  test("builds the same auth headers as the built-in tool", () => {
    expect(buildAuthHeaders({ pat: "xyz", username: "ignored" })).toEqual({ "X-Lakehouse-Token": "Bearer xyz" })
    expect(
      buildAuthHeaders({
        username: "UAT_TEST",
        password: "pwd",
        service: "https://uat-api.clickzetta.com",
        instance: "jnsxwfyr",
        workspace: "wanxin_test_04",
        schema: "public",
        vcluster: "DEFAULT",
      }),
    ).toEqual({
      "x-Lakehouse-Username": "UAT_TEST",
      "x-Lakehouse-Password": "pwd",
      "x-Lakehouse-Service": "uat-api.clickzetta.com",
      "x-Lakehouse-Instance": "jnsxwfyr",
      "x-Lakehouse-Workspace": "wanxin_test_04",
      "x-Lakehouse-Schema": "public",
      "x-Lakehouse-VCluster": "DEFAULT",
    })
  })

  test("drops undefined MCP params", () => {
    expect(pruneUndefined({ job_id: "job", workspace_name: undefined, analysis_mode: "quick" })).toEqual({
      job_id: "job",
      analysis_mode: "quick",
    })
  })
})
