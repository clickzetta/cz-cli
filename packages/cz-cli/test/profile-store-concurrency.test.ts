import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseTOML } from "smol-toml"

import { makeProfileTokenStore, saveProfiles, updateProfiles } from "../src/connection/profile-store.ts"

/**
 * profiles.toml is read-modify-write, and everything that talks to ClickZetta
 * writes to it at once: an interactive `cz-cli`, the agent TUI, the opencode
 * plugin, `mcp serve`, and every `cz-cli` the agent shells out to. Unlocked, two
 * of them interleave and one update is dropped — and when the dropped one is a
 * rotated OAuth token, the survivor puts a refresh token the server has already
 * invalidated back on disk.
 *
 * Real subprocesses, because that is the only way to exercise the lock rather than
 * the event loop's own serialization of synchronous code.
 */

const previousTestHome = process.env.CLICKZETTA_TEST_HOME
let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cz-profiles-conc-"))
  process.env.CLICKZETTA_TEST_HOME = home
})

afterEach(() => {
  if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = previousTestHome
  rmSync(home, { recursive: true, force: true })
})

const STORE_MODULE = join(import.meta.dir, "..", "src", "connection", "profile-store.ts")

function writer(body: string) {
  return Bun.spawn(["bun", "-e", `
    import * as Store from ${JSON.stringify(STORE_MODULE)}
    ${body}
  `], { env: { ...process.env, CLICKZETTA_TEST_HOME: home }, stdout: "pipe", stderr: "pipe" })
}

function readDoc(): Record<string, any> {
  return parseTOML(readFileSync(join(home, ".clickzetta", "profiles.toml"), "utf-8")) as Record<string, any>
}

test("concurrent OAuth token writes from separate processes all survive", async () => {
  saveProfiles({ p0: { instance: "i", oauth: "s0" }, p1: { instance: "i", oauth: "s1" }, p2: { instance: "i", oauth: "s2" }, p3: { instance: "i", oauth: "s3" } })

  const procs = [0, 1, 2, 3].map((n) =>
    writer(`Store.saveSharedOAuthToken("s${n}", {
      token: "access-${n}", refreshToken: "refresh-${n}",
      expireTimeMs: 900000, obtainedAt: 1700000000000, userId: 7,
    })`),
  )
  expect(await Promise.all(procs.map((p) => p.exited))).toEqual([0, 0, 0, 0])

  // Unlocked, the last writer's document is whatever it parsed BEFORE the others
  // wrote, so sections it never saw are gone.
  const oauth = readDoc().oauth
  expect(Object.keys(oauth).sort()).toEqual(["s0", "s1", "s2", "s3"])
  for (const n of [0, 1, 2, 3]) expect(oauth[`s${n}`].refresh_token).toBe(`refresh-${n}`)
})

test("a concurrent profile edit and token write do not drop each other", async () => {
  saveProfiles({ czcli: { instance: "i", oauth: "sess" } })

  const procs = [
    writer(`Store.saveSharedOAuthToken("sess", {
      token: "a", refreshToken: "r", expireTimeMs: 900000, obtainedAt: 1700000000000, userId: 7,
    })`),
    writer(`Store.patchProfileConnection("czcli", { workspace: "ws", instanceId: 4242 })`),
    writer(`Store.setDefaultProfile("czcli")`),
  ]
  expect(await Promise.all(procs.map((p) => p.exited))).toEqual([0, 0, 0])

  const doc = readDoc()
  expect(doc.oauth.sess.refresh_token).toBe("r")
  expect(doc.profiles.czcli.workspace).toBe("ws")
  expect(doc.profiles.czcli.instance_id).toBe(4242)
  expect(doc.default_profile).toBe("czcli")
})

test("a whole-table edit made from a locked read keeps a peer's concurrent field", async () => {
  // `loadProfiles()` → edit one field → `saveProfiles()` replaces the WHOLE table with a
  // snapshot taken before the lock, so a peer's `oauth` pointer or `instance_id` written
  // in between is gone. `updateProfiles` reads inside the lock instead. This is the shape
  // `workspace use` and every profile-materializing step of a login had.
  saveProfiles({ czcli: { instance: "i" } })

  const procs = [
    // Holds the lock briefly, then records an OAuth pointer — a login's write.
    writer(`Store.updateProfiles((p) => { p.czcli.oauth = "sess"; p.czcli.instance_id = 4242 })`),
    // Concurrently edits a different field of the same row.
    writer(`Store.updateProfiles((p) => { p.czcli.workspace = "ws" })`),
  ]
  expect(await Promise.all(procs.map((p) => p.exited))).toEqual([0, 0])

  const row = readDoc().profiles.czcli
  expect(row.oauth).toBe("sess")
  expect(row.instance_id).toBe(4242)
  expect(row.workspace).toBe("ws")
})

test("updateProfiles writing nothing leaves the document untouched", () => {
  saveProfiles({ czcli: { instance: "i" } })
  const before = readFileSync(join(home, ".clickzetta", "profiles.toml"), "utf-8")
  updateProfiles(() => false)
  expect(readFileSync(join(home, ".clickzetta", "profiles.toml"), "utf-8")).toBe(before)
})

test("a profile row is never replaced by a racing creator", async () => {
  // `profile create` and `setup` check for the name, then write — with an awaited
  // connection check in between for `create`. Unless the check happens inside the lock,
  // two racing creates both pass it and the loser's credential row is overwritten.
  saveProfiles({})
  const procs = ["first", "second"].map((tag) =>
    writer(`
      try {
        Store.updateProfiles((p) => {
          if (p.czcli) { console.log("EXISTS"); return false }
          p.czcli = { instance: "i", pat: "${tag}" }
        })
      } catch (e) { console.log("ERR") }
    `),
  )
  const outs = await Promise.all(procs.map(async (p) => (await new Response(p.stdout).text()).trim()))
  expect(await Promise.all(procs.map((p) => p.exited))).toEqual([0, 0])

  // Exactly one created it; the other saw it already there rather than replacing it.
  expect(outs.filter((o) => o === "EXISTS")).toHaveLength(1)
  expect(["first", "second"]).toContain(readDoc().profiles.czcli.pat)
})

test("an OAuth refresh does not block an unrelated profile write", async () => {
  // The reason the refresh lock is a separate file: it is held across a network round trip
  // (up to 30 s), and on the profiles.toml write lock that made every unrelated edit —
  // `workspace use`, an instance-id backfill — queue behind a token exchange.
  saveProfiles({ czcli: { instance: "i", oauth: "sess" } })

  const store = makeProfileTokenStore("czcli")
  let editMs = -1
  await store.withLock(async () => {
    const started = Date.now()
    // A different process editing the file while the refresh lock is held.
    const editor = writer(`Store.patchProfileConnection("czcli", { workspace: "ws" })`)
    expect(await editor.exited).toBe(0)
    editMs = Date.now() - started
    await new Promise((r) => setTimeout(r, 300)) // the "network call" continues
  })

  expect(readDoc().profiles.czcli.workspace).toBe("ws")
  expect(editMs).toBeLessThan(300) // it did not wait for the refresh to finish
})

test("two sessions refresh concurrently instead of serializing on one file", async () => {
  saveProfiles({ a: { instance: "i", oauth: "sess-a" }, b: { instance: "i", oauth: "sess-b" } })
  let overlapped = false
  let inA = false

  await Promise.all([
    makeProfileTokenStore("a").withLock(async () => {
      inA = true
      await new Promise((r) => setTimeout(r, 200))
      inA = false
    }),
    makeProfileTokenStore("b").withLock(async () => {
      await new Promise((r) => setTimeout(r, 50))
      overlapped = inA
    }),
  ])

  expect(overlapped).toBe(true)
})
