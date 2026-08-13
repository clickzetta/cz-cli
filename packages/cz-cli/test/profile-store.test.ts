import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const previousHome = process.env.HOME
const previousTestHome = process.env.CLICKZETTA_TEST_HOME

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = previousTestHome
})

function writeProfilesToml(content: string) {
  const home = mkdtempSync(path.join(tmpdir(), "cz-cli-profile-store-"))
  const clickzettaDir = path.join(home, ".clickzetta")
  mkdirSync(clickzettaDir, { recursive: true })
  writeFileSync(path.join(clickzettaDir, "profiles.toml"), content)
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
}

describe("readAgentEndpoint", () => {
  test("prefers profiles.<name>.analysis_agent_endpoint", async () => {
    writeProfilesToml([
      'default_profile = "default"',
      "",
      "[profiles.default]",
      'analysis_agent_endpoint = "https://analysis-agent.clickzetta.com"',
      "[profiles.default.agent]",
      'endpoint = "https://legacy-agent.clickzetta.com"',
      "",
    ].join("\n"))

    const { readAgentEndpoint } = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    expect(readAgentEndpoint()).toBe("https://analysis-agent.clickzetta.com")
  })

  test("falls back to profiles.<name>.agent.endpoint", async () => {
    writeProfilesToml([
      'default_profile = "default"',
      "",
      "[profiles.default]",
      'service = "uat-api.clickzetta.com"',
      "[profiles.default.agent]",
      'endpoint = "https://legacy-agent.clickzetta.com"',
      "",
    ].join("\n"))

    const { readAgentEndpoint } = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    expect(readAgentEndpoint()).toBe("https://legacy-agent.clickzetta.com")
  })

  test("infers endpoint from profile service when explicit endpoint is missing", async () => {
    writeProfilesToml([
      'default_profile = "default"',
      "",
      "[profiles.default]",
      'service = "uat-api.clickzetta.com"',
      'protocol = "https"',
      "",
    ].join("\n"))

    const { readAgentEndpoint } = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    expect(readAgentEndpoint()).toBe("https://uat-api.clickzetta.com/clickzetta-campaign-data")
  })

  test("infers endpoint from full service URL without duplicating protocol", async () => {
    writeProfilesToml([
      'default_profile = "default"',
      "",
      "[profiles.default]",
      'service = "http://127.0.0.1:3000/api/"',
      'protocol = "https"',
      "",
    ].join("\n"))

    const { readAgentEndpoint } = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    expect(readAgentEndpoint()).toBe("http://127.0.0.1:3000/api/clickzetta-campaign-data")
  })
})
