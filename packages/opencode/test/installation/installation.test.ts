import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { Installation } from "../../src/installation"

describe("installation", () => {
  const fetchSnapshot = globalThis.fetch
  const envSnapshot = { ...process.env }
  let tempHome: string | undefined

  beforeEach(() => {
    globalThis.fetch = fetchSnapshot
    Object.assign(process.env, envSnapshot)
    tempHome = undefined
  })

  afterEach(async () => {
    globalThis.fetch = fetchSnapshot
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) delete process.env[key]
    }
    Object.assign(process.env, envSnapshot)
    if (tempHome) {
      await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {})
    }
  })

  test("reads stable version for curl installs", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ version: "1.2.3" }), {
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch

    const result = await Effect.runPromise(
      Installation.Service.use((svc) => svc.latest("curl")).pipe(Effect.provide(Installation.layer)),
    )
    expect(result).toBe("1.2.3")
  })

  test("resolves npm-family installs from the cz-cli.ai stable channel, not the npm registry", async () => {
    const urls: string[] = []
    globalThis.fetch = mock(async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ version: "1.5.0" }), {
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    const result = await Effect.runPromise(
      Installation.Service.use((svc) => svc.latest("npm")).pipe(Effect.provide(Installation.layer)),
    )
    expect(result).toBe("1.5.0")
    expect(urls).toEqual(["https://cz-cli.ai/api/stable"])
    expect(urls.some((u) => u.includes("registry.npmjs.org"))).toBe(false)
  })

  test("ignores install method from ~/.clickzetta/install.json", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-install-home-"))
    tempHome = home
    process.env.CLICKZETTA_TEST_HOME = home
    await fs.mkdir(path.join(home, ".clickzetta"), { recursive: true })
    await fs.writeFile(
      path.join(home, ".clickzetta", "install.json"),
      JSON.stringify({
        version: 1,
        method: "pnpm",
        installed_path: "/tmp/cz-cli",
      }),
    )

    const result = await Effect.runPromise(
      Installation.Service.use((svc) => svc.method()).pipe(Effect.provide(Installation.layer)),
    )
    expect(result).toBe("unknown")
  })
})
