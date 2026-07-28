import { describe, expect, test } from "bun:test"
import { normalizeClickzettaGatewayUrl } from "../src/url"

describe("normalizeClickzettaGatewayUrl", () => {
  test("adds the gateway API path to a service root", () => {
    expect(normalizeClickzettaGatewayUrl("https://aimesh.example.com/")).toBe(
      "https://aimesh.example.com/gateway/v1",
    )
  })

  test("adds the version to a gateway path", () => {
    expect(normalizeClickzettaGatewayUrl("https://aimesh.example.com/gateway")).toBe(
      "https://aimesh.example.com/gateway/v1",
    )
  })

  test("preserves an already normalized gateway path", () => {
    expect(normalizeClickzettaGatewayUrl("https://aimesh.example.com/gateway/v2/")).toBe(
      "https://aimesh.example.com/gateway/v2",
    )
  })

  test("repairs a legacy root version path", () => {
    expect(normalizeClickzettaGatewayUrl("https://aimesh.example.com/v1")).toBe(
      "https://aimesh.example.com/gateway/v1",
    )
  })
})
