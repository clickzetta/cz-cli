import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { CLICKZETTA_HOST_SUFFIXES, isClickzettaHost } from "../src/llm/clickzetta-hosts.js"
import { isClickzettaGatewayUrl } from "../src/llm/clickzetta-provider.js"
import { extractRootDomain } from "../src/commands/account-login.js"
import { readLlmEntries } from "../src/llm/native-config.js"

/**
 * Guards the single ClickZetta host list.
 *
 * The list was duplicated across five modules and drifted: isClickzettaGatewayUrl
 * accepted only `.clickzetta.com` while four other sites also accepted
 * `.singdata.com` (the intl partition). Because an llm.json entry declared as a
 * generic `@ai-sdk/openai-compatible` provider is recognized as ClickZetta ONLY by
 * sniffing its baseURL, intl users' entries failed that test and the TUI quota
 * indicator rendered nothing — no token quota and no cash balance either. Chat kept
 * working (it uses the api_key directly), which made the failure look unrelated to
 * host configuration and cost real time to find.
 *
 * These tests pin every partition against every consumer, so adding a partition to
 * the shared list is enough and a sixth private copy fails here.
 */

const HOME = join(tmpdir(), `cz-hosts-${process.pid}-${Date.now()}`)
const orig = process.env.CLICKZETTA_TEST_HOME

beforeEach(() => {
  mkdirSync(join(HOME, ".clickzetta"), { recursive: true })
  process.env.CLICKZETTA_TEST_HOME = HOME
})

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true })
  if (orig === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = orig
})

// The intl partition is the one that was missing; keep it named explicitly so a
// regression is legible rather than hiding inside a loop over the constant.
const PARTITIONS = ["clickzetta.com", "singdata.com", "clickzetta-inc.com"] as const

describe("isClickzettaHost", () => {
  test("accepts every partition, as apex and as subdomain", () => {
    for (const root of PARTITIONS) {
      expect(isClickzettaHost(root)).toBe(true)
      expect(isClickzettaHost(`cn-shanghai-alicloud-aimesh.api.${root}`)).toBe(true)
    }
  })

  test("is case-insensitive", () => {
    expect(isClickzettaHost("API.SingData.com")).toBe(true)
  })

  test("rejects foreign hosts, including lookalikes", () => {
    for (const host of ["example.com", "api.anthropic.com", "notclickzetta.com", "singdata.com.evil.net", "", undefined]) {
      expect(isClickzettaHost(host)).toBe(false)
    }
  })

  test("the exported suffix list stays in sync with the partitions asserted here", () => {
    expect([...CLICKZETTA_HOST_SUFFIXES].sort()).toEqual(PARTITIONS.map((p) => `.${p}`).sort())
  })
})

describe("isClickzettaGatewayUrl", () => {
  test("accepts a gateway URL in every partition", () => {
    for (const root of PARTITIONS) {
      expect(isClickzettaGatewayUrl(`https://cn-shanghai-alicloud-aimesh.api.${root}/gateway/v1`)).toBe(true)
    }
  })

  test("rejects foreign and malformed URLs", () => {
    expect(isClickzettaGatewayUrl("https://your-gateway.example.com/v1")).toBe(false)
    expect(isClickzettaGatewayUrl("not a url")).toBe(false)
    expect(isClickzettaGatewayUrl(undefined)).toBe(false)
  })
})

describe("extractRootDomain", () => {
  test("maps every partition host back to its root", () => {
    for (const root of PARTITIONS) {
      expect(extractRootDomain(`dev-api.${root}`)).toBe(root)
    }
  })
})

// The end-to-end shape that actually broke: an openai-compatible entry pointing at
// a ClickZetta gateway must be classified as `clickzetta`, because that is what
// gates the quota indicator (see resolveClickzettaEntry).
describe("openai-compatible entry on a ClickZetta gateway", () => {
  test("is recognized as a ClickZetta provider in every partition", () => {
    for (const root of PARTITIONS) {
      writeFileSync(
        join(HOME, ".clickzetta", "llm.json"),
        JSON.stringify({
          provider: {
            aigw: {
              name: "aigw",
              npm: "@ai-sdk/openai-compatible",
              options: { apiKey: "k".repeat(32), baseURL: `https://ap-southeast-1-alicloud-aimesh.api.${root}/` },
            },
          },
        }),
      )
      expect(readLlmEntries().llm.aigw?.provider).toBe("clickzetta")
    }
  })

  test("a genuinely foreign relay stays openai-compatible", () => {
    writeFileSync(
      join(HOME, ".clickzetta", "llm.json"),
      JSON.stringify({
        provider: {
          relay: {
            npm: "@ai-sdk/openai-compatible",
            options: { apiKey: "k".repeat(32), baseURL: "https://your-gateway.example.com/v1" },
          },
        },
      }),
    )
    expect(readLlmEntries().llm.relay?.provider).toBe("openai-compatible")
  })
})
