import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-runs-window-"))
const requests: string[] = []
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    requests.push(new URL(request.url).pathname)
    return Response.json({ success: true, data: {} })
  },
})
await Bun.write(join(home, ".clickzetta", "profiles.toml"), `
[profiles.test]
service = "http://127.0.0.1:${server.port}"
protocol = "http"
instance = "test"
workspace = "ws"
schema = "public"
`)

afterAll(() => {
  server.stop(true)
  rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  requests.length = 0
})

const cwd = join(import.meta.dir, "..")

async function run(args: string[], tz: string) {
  const child = Bun.spawn([process.execPath, "src/main.ts", ...args, "--profile", "test"], {
    cwd,
    env: { ...process.env, TZ: tz, CLICKZETTA_TEST_HOME: home, CZ_WORKSPACE: "", CZ_SCHEMA: "", CZ_PROFILE: "" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [output, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { code, output, stderr }
}

// Evaluates the real parser in a fresh process so the TZ env var is applied at startup.
async function parse(tz: string, value: string, endOfDay: boolean) {
  const script = `import { parseWindowBoundary } from "./src/commands/runs.ts"; console.log(parseWindowBoundary(${JSON.stringify(value)}, ${endOfDay}))`
  const child = Bun.spawn([process.execPath, "-e", script], { cwd, env: { ...process.env, TZ: tz }, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(code, err).toBe(0)
  return Number(out.trim())
}

describe("runs window parsing", () => {
  test("date-only is local start/end of day in Asia/Shanghai", async () => {
    expect(await parse("Asia/Shanghai", "2026-11-10", false)).toBe(Date.UTC(2026, 10, 9, 16, 0, 0))
    expect(await parse("Asia/Shanghai", "2026-11-10", true)).toBe(Date.UTC(2026, 10, 10, 15, 59, 59, 999))
  })

  test("date-only is local start/end of day in America/Los_Angeles", async () => {
    expect(await parse("America/Los_Angeles", "2026-11-10", false)).toBe(Date.UTC(2026, 10, 10, 8, 0, 0))
    expect(await parse("America/Los_Angeles", "2026-11-10", true)).toBe(Date.UTC(2026, 10, 11, 7, 59, 59, 999))
  })

  test("end of day on the DST change day still ends at local 23:59:59.999", async () => {
    // 2026-11-01 is 25 hours long in Los Angeles; PST (UTC-8) applies at the end of the day.
    expect(await parse("America/Los_Angeles", "2026-11-01", true)).toBe(Date.UTC(2026, 10, 2, 7, 59, 59, 999))
  })

  test("datetime without offset is local, with offset or Z is absolute", async () => {
    expect(await parse("Asia/Shanghai", "2026-11-10T09:30:00", false)).toBe(Date.UTC(2026, 10, 10, 1, 30, 0))
    expect(await parse("America/Los_Angeles", "2026-11-10T09:30:00", true)).toBe(Date.UTC(2026, 10, 10, 17, 30, 0))
    expect(await parse("America/Los_Angeles", "2026-11-10T09:30:00+08:00", false)).toBe(Date.UTC(2026, 10, 10, 1, 30, 0))
    expect(await parse("Asia/Shanghai", "2026-11-10T09:30:00Z", false)).toBe(Date.UTC(2026, 10, 10, 9, 30, 0))
  })
})

describe("runs invalid window is a usage error before any request", () => {
  test.each([
    ["runs list --from 2026/13/45", "Asia/Shanghai"],
    ["runs list --to not-a-date", "America/Los_Angeles"],
    ["runs stats --from 2026-02-30", "Asia/Shanghai"],
    ["runs refill 123 --from 2026-13-01 --to 2026-11-10 -y", "Asia/Shanghai"],
    ["runs refill 123 --from 2026-11-10 --to 2026-11-10T25:00:00 -y", "Asia/Shanghai"],
    ...["+99:99", "+0060", "+2360", "-99:00"].flatMap((off) => [
      [`runs list --from 2026-11-10T08:00:00${off}`, "Asia/Shanghai"],
      [`runs stats --to 2026-11-10T08:00:00${off}`, "America/Los_Angeles"],
      [`runs refill 4242 --from 2026-11-10T08:00:00${off} --to 2026-11-10 -y`, "Asia/Shanghai"],
    ]),
  ])("%s (%s)", async (command, tz) => {
    const result = await run(command.split(" "), tz)
    const json = JSON.parse(result.output.trim().split("\n")[0] ?? "{}")
    expect(result.code, result.output + result.stderr).toBe(2)
    expect(json.error.code).toBe("INVALID_ARGUMENTS")
    expect(requests).toEqual([])
  })

  test("refill with only --from is rejected before the confirmation prompt and requests", async () => {
    const result = await run(["runs", "refill", "123", "--from", "2026-11-10"], "Asia/Shanghai")
    expect(result.code, result.output + result.stderr).toBe(2)
    expect(JSON.parse(result.output.trim().split("\n")[0] ?? "{}").error.message).toContain("provided together")
    expect(requests).toEqual([])
  })
})
