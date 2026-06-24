import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

function data(output: string) {
  return firstJson(output).data as Record<string, unknown>
}

function errorPayload(output: string) {
  return firstJson(output).error as Record<string, unknown>
}

function jwt(payload: Record<string, unknown>) {
  return [
    "header",
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".")
}

function run(args: string[], home: string) {
  const result = spawnSync("bun", ["./src/main.ts", ...args, "--format", "json"], {
    cwd: import.meta.dir + "/..",
    encoding: "utf-8",
    env: { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { output: result.stdout ?? "", exitCode: result.status ?? 1 }
}

async function withHome<T>(name: string, run: (home: string) => Promise<T>) {
  const previousHome = process.env.HOME
  const previousTestHome = process.env.CLICKZETTA_TEST_HOME
  const home = mkdtempSync(join(tmpdir(), name))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
  try {
    return await run(home)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
    else process.env.CLICKZETTA_TEST_HOME = previousTestHome
    await Bun.$`rm -rf ${home}`
  }
}

test("profile create accepts Cookie header auth and masks it in profile detail", async () => {
  await withHome("cz-profile-cookie-create-", async (home) => {
    const token = jwt({ userId: 7, accountId: 3, instanceId: 86, exp: 4_102_444_800 })
    const cookie = `X-ClickZetta-Token=${token}; other=value`

    const create = run(["profile", "create", "cookie", "--service", "api.example.com", "--instance", "inst", "--workspace", "ws", "--header", `Cookie=${cookie}`], home)
    expect(create.exitCode).toBe(0)

    const detail = run(["profile", "detail", "cookie"], home)
    expect(detail.exitCode).toBe(0)
    expect(JSON.stringify(data(detail.output).header)).toContain("****")
    expect(JSON.stringify(data(detail.output).header)).not.toContain(token)

    const unmasked = run(["profile", "detail", "cookie", "--show-secret"], home)
    expect(unmasked.exitCode).toBe(0)
    expect(JSON.stringify(data(unmasked.output).header)).toContain(token)
  })
})

test("profile create rejects Cookie header auth without X-ClickZetta-Token", async () => {
  await withHome("cz-profile-cookie-missing-token-", async (home) => {
    const create = run(["profile", "create", "cookie", "--service", "api.example.com", "--instance", "inst", "--workspace", "ws", "--header", "Cookie=theme=light"], home)

    expect(create.exitCode).toBe(2)
    expect(errorPayload(create.output).code).toBe("INVALID_ARGUMENTS")
  })
})

test("getExecContext uses X-ClickZetta-Token from profile Cookie header", async () => {
  await withHome("cz-profile-cookie-exec-", async (home) => {
    const token = jwt({ userId: 7, accountId: 3, instanceId: 86, exp: 4_102_444_800 })
    writeFileSync(
      join(home, ".clickzetta", "profiles.toml"),
      [
        'default_profile = "cookie"',
        "",
        "[profiles.cookie]",
        'service = "api.example.com"',
        'protocol = "https"',
        'instance = "inst"',
        'workspace = "ws"',
        "",
        "[profiles.cookie.header]",
        `"Cookie" = "theme=light; X-ClickZetta-Token=${token}"`,
        "",
      ].join("\n"),
    )

    const { getExecContext } = await import(`../src/commands/exec.ts?cookie-auth-${Date.now()}`)
    const ctx = await getExecContext({})

    expect(ctx.token.token).toBe(token)
    expect(ctx.token.instanceId).toBe(86)
    expect(ctx.token.userId).toBe(7)
    expect(ctx.clientOpts.token).toBe(token)
    expect(ctx.clientOpts.customHeaders.Cookie).toContain(token)
    expect(ctx.clientOpts.customHeaders.instanceName).toBe("inst")
  })
})
