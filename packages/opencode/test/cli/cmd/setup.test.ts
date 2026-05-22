import { describe, expect, test } from "bun:test"
import { applyCredentialToProfiles } from "../../../src/cli/cmd/setup"

describe("applyCredentialToProfiles", () => {
  test("writes clickzetta llm settings outside [profiles.*]", () => {
    const result = applyCredentialToProfiles(
      {},
      {
        instanceName: "instance-a",
        workspaceName: "workspace-a",
        service: "https://service.clickzetta.com",
        username: "alice",
        schema: "public",
        virtualCluster: "default",
        accessToken: "pat-123",
        apiKey: "ck-test",
        aimeshEndpointBaseUrl: "https://gateway.clickzetta.com",
      },
      "default",
    )

    expect(result).toEqual({
      default_profile: "default",
      default_llm: "clickzetta",
      profiles: {
        default: {
          instance: "instance-a",
          workspace: "workspace-a",
          schema: "public",
          vcluster: "default",
          pat: "pat-123",
          service: "https://service.clickzetta.com",
          protocol: "https",
          username: "alice",
        },
      },
      llm: {
        clickzetta: {
          provider: "clickzetta",
          api_key: "ck-test",
          base_url: "https://gateway.clickzetta.com",
        },
      },
    })
  })

  test("preserves an existing default_llm and removes legacy profile llm fields", () => {
    const result = applyCredentialToProfiles(
      {
        default_llm: "my-claude",
        profiles: {
          default: {
            api_key: "old-key",
            aimesh_endpoint: "https://old.clickzetta.com",
            workspace: "old-workspace",
          },
        },
        llm: {
          clickzetta: {
            provider: "clickzetta",
            model: "deepseek/deepseek-v4-pro",
          },
        },
      },
      {
        workspaceName: "workspace-b",
        service: "http://service.clickzetta.com",
        apiKey: "new-key",
        aimeshEndpointBaseUrl: "https://new.clickzetta.com",
      },
      "default",
    )

    expect(result).toEqual({
      default_llm: "my-claude",
      default_profile: "default",
      profiles: {
        default: {
          workspace: "workspace-b",
          service: "http://service.clickzetta.com",
          protocol: "http",
        },
      },
      llm: {
        clickzetta: {
          provider: "clickzetta",
          model: "deepseek/deepseek-v4-pro",
          api_key: "new-key",
          base_url: "https://new.clickzetta.com",
        },
      },
    })
  })

  test("defaults bare service hosts to https protocol", () => {
    const result = applyCredentialToProfiles(
      {},
      {
        service: "cn-shanghai-alicloud.api.clickzetta.com",
      },
      "default",
    )

    expect(result).toEqual({
      default_profile: "default",
      profiles: {
        default: {
          service: "cn-shanghai-alicloud.api.clickzetta.com",
          protocol: "https",
        },
      },
    })
  })
})
