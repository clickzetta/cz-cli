import { afterEach, beforeEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_CONNECTION, forceRefreshToken } from "@clickzetta/sdk"
import {
  makeProfileTokenStore,
  mutateProfilesFile,
  saveProfiles,
  saveSharedOAuthToken,
} from "../src/connection/profile-store.js"
import { provisionProfileFromOAuth } from "../src/connection/provision.js"
import { refreshOAuthToken, resolveOAuthToken } from "../src/connection/oauth-state.js"

const originalHome = process.env.CLICKZETTA_TEST_HOME
let home: string
let server: ReturnType<typeof Bun.serve>
let sent: string[]
let revoked: boolean
let respond: (token: string) => Promise<Response>
let children: ReturnType<typeof Bun.spawn>[]

function seed(refreshToken = "r0") {
  return {
    token: "a0",
    refreshToken,
    userId: 7,
    expireTimeMs: 900_000,
    obtainedAt: Date.now() - 1_000_000,
    issuer: `127.0.0.1:${server.port}`,
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cz-refresh-safety-"))
  process.env.CLICKZETTA_TEST_HOME = home
  sent = []
  revoked = false
  children = []
  respond = async (token) => {
    await Bun.sleep(40)
    return Response.json({ access_token: `a-${token}`, refresh_token: `r-${token}`, expires_in: 900 })
  }
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname.endsWith("/user/loginSingle")) {
        return Response.json({
          code: 0,
          data: { token: "portal-token", userId: 7, instanceId: 9, expireTime: 900_000 },
        })
      }
      if (!new URL(request.url).pathname.endsWith("/oauth2/token")) return new Response("not found", { status: 404 })
      const token = new URLSearchParams(await request.text()).get("refresh_token")!
      if (sent.includes(token)) revoked = true
      sent.push(token)
      if (revoked) return Response.json({ error: "invalid_grant" }, { status: 400 })
      return respond(token)
    },
  })
  saveProfiles({ p: { instance: "test", oauth: "session" } })
  saveSharedOAuthToken("session", seed())
})

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGKILL")
  }
  await Promise.all(children.map((child) => child.exited))
  server.stop(true)
  chmodSync(join(home, ".clickzetta"), 0o700)
  rmSync(home, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = originalHome
})

function worker(mode = "get", profile = "p") {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "fixtures/oauth-refresh-worker.ts"),
      home,
      `127.0.0.1:${server.port}`,
      mode,
      profile,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    },
  )
  children.push(child)
  return child
}

async function output(child: ReturnType<typeof worker>) {
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(stderr).toBe("")
  expect(code).toBe(0)
  return JSON.parse(stdout) as { token?: string; persisted?: string; code?: string; edited?: boolean }
}

async function until(predicate: () => boolean) {
  const deadline = performance.now() + 5000
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error("Timed out waiting for worker")
    await Bun.sleep(5)
  }
}

test("independent processes send one refresh and receive the same persisted replacement", async () => {
  const results = await Promise.all([output(worker()), output(worker()), output(worker())])
  expect(results.map((result) => result.token)).toEqual(["a-r0", "a-r0", "a-r0"])
  expect(results.map((result) => result.persisted)).toEqual(["a-r0", "a-r0", "a-r0"])
  expect(sent).toEqual(["r0"])
  expect(revoked).toBe(false)
})

test("copied tokens under different session names still have only one sender", async () => {
  saveProfiles({ p: { oauth: "session" }, alias: { oauth: "other-name" } })
  saveSharedOAuthToken("other-name", seed())
  const results = await Promise.all([output(worker()), output(worker("get", "alias"))])
  expect(results.every((result) => result.token === "a-r0")).toBe(true)
  expect(sent).toEqual(["r0"])
})

test("a stale TOML snapshot resolves to the latest generation without replay", async () => {
  const file = join(home, ".clickzetta/profiles.toml")
  const stale = readFileSync(file, "utf8")
  expect((await output(worker())).token).toBe("a-r0")
  expect((await output(worker("force"))).token).toBe("a-r0") // rejected a0 has already been replaced
  const store = makeProfileTokenStore("p")
  const second = await forceRefreshToken(
    { ...DEFAULT_CONNECTION, protocol: "http", service: seed().issuer, cacheKey: "second", tokenStore: store },
    "a-r0",
  )
  expect(second.token).toBe("a-r-r0")
  writeFileSync(file, stale)
  expect((await output(worker())).token).toBe("a-r-r0")
  expect(sent).toEqual(["r0", "r-r0"])
  expect(revoked).toBe(false)
})

test.skipIf(process.platform === "win32")("read-only state fails before either process sends a refresh", async () => {
  chmodSync(join(home, ".clickzetta"), 0o500)
  const results = await Promise.all([output(worker()), output(worker())])
  expect(results.every((result) => result.code === "OAUTH_STATE_UNAVAILABLE")).toBe(true)
  expect(sent).toEqual([])
})

test("a response lost after consumption is never retried by the next process", async () => {
  respond = async () => new Response('{"access_token":', { headers: { "content-type": "application/json" } })
  expect((await output(worker())).code).toBe("OAUTH_REFRESH_UNCERTAIN")
  expect((await output(worker())).code).toBe("OAUTH_REFRESH_UNCERTAIN")
  expect(sent).toEqual(["r0"])
  expect(revoked).toBe(false)
})

test("missing replacement refresh token is an uncertain outcome, never reuse the old one", async () => {
  respond = async () => Response.json({ access_token: "a1", expires_in: 900 })
  expect((await output(worker())).code).toBe("OAUTH_REFRESH_UNCERTAIN")
  expect((await output(worker())).code).toBe("OAUTH_REFRESH_UNCERTAIN")
  expect(sent).toEqual(["r0"])
})

test("a malformed successful response cannot be published as a usable credential", async () => {
  respond = async () => Response.json({ refresh_token: "r1", expires_in: 900 })
  expect((await output(worker())).code).toBe("OAUTH_REFRESH_UNCERTAIN")
  expect((await output(worker())).code).toBe("OAUTH_REFRESH_UNCERTAIN")
  expect(sent).toEqual(["r0"])
})

test("a redirect cannot make fetch resend the one-time grant", async () => {
  respond = async () =>
    new Response(null, { status: 307, headers: { location: `http://127.0.0.1:${server.port}/oauth2/token` } })
  expect((await output(worker())).code).toBe("OAUTH_REFRESH_UNCERTAIN")
  expect(sent).toEqual(["r0"])
  expect(revoked).toBe(false)
})

test("a definite rejection permits a new portal login and really persists it", async () => {
  respond = async () => Response.json({ error: "invalid_grant" }, { status: 400 })
  expect(await output(worker("fallback"))).toEqual({ token: "portal-token", persisted: "portal-token" })
  expect((await output(worker())).token).toBe("portal-token")
  expect(sent).toEqual(["r0"])
})

test.skipIf(process.platform === "win32")(
  "failure to persist a response keeps the pre-send claim durable",
  async () => {
    respond = async () => {
      chmodSync(join(home, ".clickzetta"), 0o500)
      return Response.json({ access_token: "a1", refresh_token: "r1", expires_in: 900 })
    }
    expect((await output(worker())).code).toBe("OAUTH_REFRESH_UNCERTAIN")
    chmodSync(join(home, ".clickzetta"), 0o700)
    expect((await output(worker())).code).toBe("OAUTH_REFRESH_PENDING")
    expect(sent).toEqual(["r0"])
  },
)

test("a process killed after the issuer accepted its refresh cannot be replaced by another sender", async () => {
  let finish!: () => void
  const gate = new Promise<void>((resolve) => {
    finish = resolve
  })
  respond = async () => {
    await gate
    return Response.json({ access_token: "a1", refresh_token: "r1", expires_in: 900 })
  }
  const first = worker()
  await until(() => sent.length === 1)
  first.kill("SIGKILL")
  await first.exited
  try {
    expect((await output(worker())).code).toBe("OAUTH_REFRESH_PENDING")
    expect(sent).toEqual(["r0"])
  } finally {
    finish()
  }
})

test("a crash between claiming and sending sacrifices availability instead of replay safety", async () => {
  const first = worker("crash-before-send")
  expect(await first.exited).toBe(71)
  expect((await output(worker())).code).toBe("OAUTH_REFRESH_PENDING")
  expect(sent).toEqual([])
})

test.skipIf(process.platform === "win32")(
  "a paused owner is not replaced; after resume the waiter adopts its result",
  async () => {
    let finish!: () => void
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    respond = async () => {
      await gate
      return Response.json({ access_token: "a1", refresh_token: "r1", expires_in: 900 })
    }
    const first = worker()
    await until(() => sent.length === 1)
    process.kill(first.pid, "SIGSTOP")
    try {
      expect((await output(worker())).code).toBe("OAUTH_REFRESH_PENDING")
      expect(sent).toEqual(["r0"])
    } finally {
      process.kill(first.pid, "SIGCONT")
      finish()
    }
    expect((await output(first)).token).toBe("a1")
    expect((await output(worker())).token).toBe("a1")
    expect(sent).toEqual(["r0"])
  },
)

test("an unrelated profile edit cannot hold an old document then overwrite a completed refresh", async () => {
  const editor = worker("edit")
  await until(() => existsSync(join(home, "editing")))
  const contender = await output(worker())
  expect(contender.code).toBe("LOCK_CONTENDED")
  expect(sent).toEqual([])
  expect((await output(editor)).edited).toBe(true)
  expect((await output(worker())).token).toBe("a-r0")
  expect(readFileSync(join(home, ".clickzetta/profiles.toml"), "utf8")).toContain('workspace = "edited"')
  expect(sent).toEqual(["r0"])
})

test("different token families may refresh concurrently", async () => {
  saveProfiles({ p: { oauth: "session" }, other: { oauth: "independent" } })
  saveSharedOAuthToken("independent", seed("different"))
  let finish!: () => void
  const gate = new Promise<void>((resolve) => {
    finish = resolve
  })
  respond = async (token) => {
    await gate
    return Response.json({ access_token: `a-${token}`, refresh_token: `r-${token}`, expires_in: 900 })
  }
  const first = worker()
  const second = worker("get", "other")
  try {
    await until(() => sent.length === 2)
  } finally {
    finish()
  }
  expect((await output(first)).token).toBe("a-r0")
  expect((await output(second)).token).toBe("a-different")
})

test("fresh login recovers without removing the spent-token history", async () => {
  respond = async () => new Response("broken")
  expect((await output(worker())).code).toBe("OAUTH_REFRESH_UNCERTAIN")
  saveSharedOAuthToken("session", seed("new-login"))
  respond = async (token) => Response.json({ access_token: `a-${token}`, refresh_token: `r-${token}`, expires_in: 900 })
  expect((await output(worker())).token).toBe("a-new-login")
  // Re-importing an old export must not resurrect the consumed token.
  saveSharedOAuthToken("session", seed())
  expect((await output(worker())).code).toBe("OAUTH_REFRESH_UNCERTAIN")
  expect(sent).toEqual(["r0", "new-login"])
})

test("state contains only the current token plus old fingerprints and is private", async () => {
  expect((await output(worker())).token).toBe("a-r0")
  const file = join(home, ".clickzetta/oauth-state.sqlite3")
  if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600)
  using db = new Database(file, { readonly: true })
  expect(db.query("SELECT COUNT(*) AS count FROM oauth_spent").get()).toEqual({ count: 1 })
  const row = db.query<{ token_json: string }, []>("SELECT token_json FROM oauth_families").get()!
  expect(JSON.parse(row.token_json).refreshToken).toBe("r-r0")
  expect(resolveOAuthToken(seed()).token).toBe("a-r0")
})

test.skipIf(process.platform === "win32")("the durable result survives a failed TOML projection", async () => {
  const store = makeProfileTokenStore("p")
  const previous = store.load()!
  const next = { ...previous, token: "a1", refreshToken: "r1", obtainedAt: Date.now() }
  await refreshOAuthToken(previous, async () => next)
  chmodSync(join(home, ".clickzetta"), 0o500)
  expect(store.save(next, { expected: previous })).toBe(false)
  expect(store.load()?.token).toBe("a1")
  expect(sent).toEqual([])
})

test("logout clears the runtime secret but preserves protection against re-importing a spent token", async () => {
  expect((await output(worker())).token).toBe("a-r0")
  mutateProfilesFile((data) => {
    delete data.oauth
    return data
  })
  using db = new Database(join(home, ".clickzetta/oauth-state.sqlite3"), { readonly: true })
  expect(db.query("SELECT token_json, state FROM oauth_families").get()).toEqual({
    token_json: "null",
    state: "uncertain",
  })
  saveSharedOAuthToken("session", seed())
  expect((await output(worker())).code).toBe("OAUTH_REFRESH_UNCERTAIN")
  expect(sent).toEqual(["r0"])
})

test("logout while a refresh is in flight cannot be undone by its late response", async () => {
  let finish!: () => void
  const gate = new Promise<void>((resolve) => {
    finish = resolve
  })
  respond = async () => {
    await gate
    return Response.json({ access_token: "a1", refresh_token: "r1", expires_in: 900 })
  }
  const first = worker()
  await until(() => sent.length === 1)
  mutateProfilesFile((data) => {
    delete data.oauth
    return data
  })
  finish()
  expect((await output(first)).code).toBe("OAUTH_REFRESH_UNCERTAIN")
  expect(makeProfileTokenStore("p").load()).toBeUndefined()
  expect(sent).toEqual(["r0"])
})

test.skipIf(process.platform === "win32")(
  "fresh login cannot report success when credentials could not be stored",
  () => {
    chmodSync(join(home, ".clickzetta"), 0o500)
    expect(() => saveSharedOAuthToken("session", seed("new-login"))).toThrow()
    expect(makeProfileTokenStore("p").load()?.refreshToken).toBe("r0")
  },
)

test("logout before the first refresh also prevents a stale process from importing its token", async () => {
  const previous = makeProfileTokenStore("p").load()!
  mutateProfilesFile((data) => {
    delete data.oauth
    return data
  })
  let calls = 0
  await expect(
    refreshOAuthToken(previous, async () => {
      calls += 1
      return { ...previous, refreshToken: "r1" }
    }),
  ).rejects.toMatchObject({ code: "OAUTH_REFRESH_UNCERTAIN" })
  expect(calls).toBe(0)
})

test("removing a legacy inline credential also blocks a stale refresher", async () => {
  mutateProfilesFile((data) => {
    const shared = data.oauth as Record<string, unknown>
    data.profiles = { p: { oauth: { legacy: shared.session } } }
    delete data.oauth
    return data
  })
  const previous = makeProfileTokenStore("p").load()!
  expect(previous.refreshToken).toBe("r0")
  saveProfiles({})
  let calls = 0
  await expect(
    refreshOAuthToken(previous, async () => {
      calls += 1
      return { ...previous, refreshToken: "r1" }
    }),
  ).rejects.toMatchObject({ code: "OAUTH_REFRESH_UNCERTAIN" })
  expect(calls).toBe(0)
})

test.skipIf(process.platform === "win32")("single-profile login propagates a failed credential save", () => {
  chmodSync(join(home, ".clickzetta"), 0o500)
  expect(() =>
    provisionProfileFromOAuth("p", {
      token: seed("new-login"),
      service: seed().issuer,
      protocol: "http",
      instance: "test",
    }),
  ).toThrow("Could not persist the login credentials")
  expect(makeProfileTokenStore("p").load()?.refreshToken).toBe("r0")
})
