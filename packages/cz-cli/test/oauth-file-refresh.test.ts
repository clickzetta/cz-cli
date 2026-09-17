import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_CONNECTION, forceRefreshToken, getToken, type AuthToken } from "@clickzetta/sdk"
import { parse } from "smol-toml"
import {
  loadProfiles,
  makeProfileTokenStore,
  saveProfiles,
  saveSharedOAuthToken,
} from "../src/connection/profile-store.js"

const originalHome = process.env.CLICKZETTA_TEST_HOME
let home: string
let handler: (request: Request) => Response | Promise<Response>
let server: ReturnType<typeof Bun.serve>
const children: ReturnType<typeof Bun.spawn>[] = []
const sent: string[] = []

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cz-oauth-files-"))
  process.env.CLICKZETTA_TEST_HOME = home
  sent.length = 0
  handler = () => Response.json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 })
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      sent.push(new URLSearchParams(await request.clone().text()).get("refresh_token") ?? "")
      return handler(request)
    },
  })
  saveProfiles({
    first: { oauth: "session", service: `127.0.0.1:${server.port}`, protocol: "http", instance: "i" },
    second: { oauth: "session", service: `127.0.0.1:${server.port}`, protocol: "http", instance: "i" },
  })
})

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  server.stop(true)
  if (originalHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = originalHome
  rmSync(home, { recursive: true, force: true })
})

function seed(overrides: Partial<AuthToken> = {}) {
  const token = {
    token: "access-0",
    refreshToken: "refresh-0",
    userId: 7,
    obtainedAt: 0,
    expireTimeMs: 1000,
    issuer: `127.0.0.1:${server.port}`,
    ...overrides,
  }
  saveSharedOAuthToken("session", token)
  return token
}

type Reply = { ready?: boolean; token?: AuthToken; error?: string }
async function worker(profile = "first") {
  const ready = Promise.withResolvers<void>()
  const replies: ((reply: Reply) => void)[] = []
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/oauth-file-worker.ts"), profile], {
    env: { ...process.env, CLICKZETTA_TEST_HOME: home },
    stdout: "ignore",
    stderr: "inherit",
    ipc(reply: Reply) {
      if (reply.ready) ready.resolve()
      else replies.shift()?.(reply)
    },
  })
  children.push(child)
  await ready.promise
  return async (command: { force?: boolean; rejected?: string } = {}) => {
    const result = new Promise<Reply>((resolve) => replies.push(resolve))
    child.send(command)
    const reply = await result
    if (reply.error) throw new Error(reply.error)
    if (!reply.token) throw new Error("Worker returned no token")
    return reply.token
  }
}

test("B reloads A's replacement after its in-memory access token reaches the refresh threshold", async () => {
  const token = seed({ obtainedAt: Date.now(), expireTimeMs: 5000 })
  const a = await worker()
  const b = await worker("second")
  expect((await b()).token).toBe("access-0")
  expect((await a({ force: true, rejected: "access-0" })).token).toBe("access-1")
  await Bun.sleep(Math.max(0, token.obtainedAt + token.expireTimeMs * 0.8 + 20 - Date.now()))
  expect((await b()).token).toBe("access-1")
  expect(sent).toEqual(["refresh-0"])
}, 10000)

test("simultaneous processes refresh without a lock and persist the server's common successor", async () => {
  seed()
  const release = Promise.withResolvers<void>()
  handler = async () => {
    if (sent.length === 2) release.resolve()
    await release.promise
    return Response.json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 })
  }
  const before = parse(readFileSync(join(home, ".clickzetta/profiles.toml"), "utf8"))
  const a = await worker()
  const b = await worker("second")
  const results = await Promise.all([a(), b()])
  expect(sent).toEqual(["refresh-0", "refresh-0"])
  expect(results.map((token) => token.refreshToken)).toEqual(["refresh-1", "refresh-1"])
  expect(makeProfileTokenStore("first").load()?.refreshToken).toBe("refresh-1")
  const file = join(home, ".clickzetta/profiles.toml")
  const after = parse(readFileSync(file, "utf8"))
  expect(after.profiles).toEqual(before.profiles)
  expect(after.oauth).toMatchObject({ session: { access_token: "access-1", refresh_token: "refresh-1" } })
  expect(readdirSync(join(home, ".clickzetta"))).toEqual(["profiles.toml"])
  if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600)
}, 10000)

test("a 401 for the old access token adopts the peer's valid replacement", async () => {
  seed({ obtainedAt: Date.now(), expireTimeMs: 3600_000 })
  const a = await worker()
  const b = await worker("second")
  await b()
  await a({ force: true, rejected: "access-0" })
  expect((await b({ force: true, rejected: "access-0" })).token).toBe("access-1")
  expect(sent).toEqual(["refresh-0"])
})

test("a transient failure leaves the file usable for the next attempt", async () => {
  seed()
  const a = await worker()
  handler = () => Response.json({ error: "temporarily_unavailable" }, { status: 503 })
  await expect(a()).rejects.toThrow()
  expect(makeProfileTokenStore("first").load()?.refreshToken).toBe("refresh-0")
  handler = () => Response.json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 })
  expect((await a()).refreshToken).toBe("refresh-1")
  expect(sent).toEqual(["refresh-0", "refresh-0"])
})

test("concurrent callers in one process share normal and forced refreshes", async () => {
  seed()
  const config = {
    ...DEFAULT_CONNECTION,
    protocol: "http",
    service: `127.0.0.1:${server.port}`,
    tokenStore: makeProfileTokenStore("first"),
    cacheKey: "session",
  }
  await Promise.all(Array.from({ length: 12 }, () => getToken(config)))
  expect(sent).toEqual(["refresh-0"])
  handler = () => Response.json({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 })
  const results = await Promise.all(Array.from({ length: 12 }, () => forceRefreshToken(config, "access-1")))
  expect(sent).toEqual(["refresh-0", "refresh-1"])
  expect(results.every((token) => token.token === "access-2")).toBe(true)
})

test("another session's refresh and logout leave this session's credentials alone", async () => {
  const token = seed()
  saveProfiles({ ...loadProfiles(), third: { oauth: "other", instance: "i", service: "s" } })
  saveSharedOAuthToken("other", { ...token, token: "other-access", refreshToken: "other-refresh" })
  makeProfileTokenStore("first").save({ ...token, token: "access-1", refreshToken: "refresh-1" })
  expect(makeProfileTokenStore("third").load()?.refreshToken).toBe("other-refresh")
  const { execute } = await import("../src/execute.js")
  const result = await execute("auth logout session --keep-profiles")
  expect(result.exitCode).toBe(0)
  expect(parse(readFileSync(join(home, ".clickzetta/profiles.toml"), "utf8")).oauth).not.toHaveProperty("session")
  expect(makeProfileTokenStore("first").load()).toBeUndefined()
  expect(makeProfileTokenStore("third").load()?.refreshToken).toBe("other-refresh")
})
