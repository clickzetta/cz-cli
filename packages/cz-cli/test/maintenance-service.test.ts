import { afterEach, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { ServiceStore } from "../../../scripts/maintenance/service-store"
import { codexSettings, executeCodex } from "../../../scripts/maintenance/codex-executor"

const directories: string[] = []
const stores: ServiceStore[] = []
afterEach(() => {
  stores.splice(0).forEach((store) => store.db.close())
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})
function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "maintenance-service-"))
  directories.push(directory)
  const store = new ServiceStore(directory)
  stores.push(store)
  return { directory, store }
}

test("initialization waits for a concurrent writer before changing journal mode and schema", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "maintenance-initialize-"))
  directories.push(directory)
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import {Database} from 'bun:sqlite';
const db=new Database(Bun.argv[1],{create:true});
db.exec('CREATE TABLE owner (id INTEGER PRIMARY KEY, token TEXT, pid INTEGER); BEGIN IMMEDIATE');
console.log('locked'); await Bun.sleep(300); db.exec('COMMIT'); db.close()`,
      path.join(directory, "service.sqlite"),
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  const reader = child.stdout.getReader()
  await reader.read()
  reader.releaseLock()
  const store = new ServiceStore(directory)
  stores.push(store)
  expect(await child.exited).toBe(0)
  expect(store.status().roles.length).toBe(2)
  expect(store.db.query("SELECT identity FROM owner").all()).toEqual([])
})

test("deduplicates and batches durable wakeups, while new input waits for the next run", () => {
  const data = fixture()
  data.store.enqueue("worker", "a", "first")
  data.store.enqueue("worker", "a", "duplicate")
  data.store.enqueue("worker", "b", "second")
  const reopened = new ServiceStore(data.directory)
  stores.push(reopened)
  const run = reopened.claim(10)!
  expect(run.events.map((event) => event.event_key)).toEqual(["a", "b"])
  data.store.enqueue("worker", "c", "mid-run")
  expect(data.store.claim(11)).toBeUndefined()
  reopened.finish(run.id, { success: true }, 12)
  expect(data.store.claim(13)?.events.map((event) => event.event_key)).toEqual(["c"])
})

test("timer creation, firing and missed-period coalescing survive restart without duplicate events", () => {
  const data = fixture()
  data.store.schedule("daily", "curator", 1000, "daily", 1000)
  data.store.schedule("followup-task", "worker", 2000, "check CI")
  const reopened = new ServiceStore(data.directory)
  stores.push(reopened)
  reopened.fireTimers(10000)
  reopened.fireTimers(10000)
  const curator = reopened.claim(10000)!
  expect(curator.role).toBe("curator")
  expect(curator.events.length).toBe(1)
  reopened.finish(curator.id, { success: true }, 10000)
  const worker = reopened.claim(10000)!
  expect(worker.events.length).toBe(1)
  reopened.finish(worker.id, { success: true }, 10000)
  expect(reopened.claim(10000)).toBeUndefined()
  reopened.fireTimers(11000)
  expect(reopened.claim(11000)?.role).toBe("curator")
  expect(() => reopened.schedule("daily", "worker", 1000, "different")).toThrow("different definition")
  expect(() => reopened.schedule("bad", "worker", NaN, "bad")).toThrow()
})

test("a second process cannot own a live service, and a crashed run pauses before replay", async () => {
  const data = fixture()
  const token = data.store.acquire()
  expect(() => data.store.acquire()).toThrow("already owned")
  data.store.release("another-owner")
  expect(() => data.store.acquire()).toThrow("already owned")
  data.store.release(token)
  // A real subprocess leaves both its lease and its running provider record behind.
  const script = `import {ServiceStore} from ${JSON.stringify(path.resolve(import.meta.dir, "../../../scripts/maintenance/service-store.ts"))};
    const store=new ServiceStore(Bun.argv[1]); store.acquire(); store.enqueue('worker','crash','work'); store.claim(100); process.exit(0)`
  const child = Bun.spawn([process.execPath, "-e", script, data.directory], { stdout: "pipe", stderr: "pipe" })
  expect(await child.exited).toBe(0)
  const recovery = data.store.acquire()
  expect(data.store.claim(200)).toBeUndefined()
  expect(data.store.status().runs[0].status).toBe("interrupted")
  expect(() => data.store.resume("worker", " ")).toThrow()
  data.store.resume("worker", "Confirmed all writers stopped and queried external effects")
  expect(data.store.claim(201)?.events[0].event_key).toBe("crash")
  data.store.release(recovery)
})

test("provider failures preserve input and pause requests until explicit reconciliation", () => {
  const data = fixture()
  data.store.enqueue("worker", "quota", "input")
  const run = data.store.claim(1)!
  data.store.recordThread(run.id, "thread-123")
  data.store.finish(run.id, { success: false, detail: "Quota exhausted" }, 2)
  expect(data.store.claim(3)).toBeUndefined()
  expect(data.store.claim(86_400_000)).toBeUndefined()
  expect(data.store.status().runs[0].thread_id).toBe("thread-123")
  data.store.enqueue("worker", "later", "input while paused")
  data.store.resume("worker", "Quota restored and previous effects checked")
  expect(data.store.claim(1000)?.events.length).toBe(2)
})

test("a code update defers the run without losing events, and idle tick removal keeps real input", () => {
  const data = fixture()
  data.store.enqueue("worker", "timer:worker-reconcile:1000", "poll")
  data.store.enqueue("worker", "intake:a", "feedback")
  data.store.discardIdleWorkerTicks(true)
  const run = data.store.claim(1)!
  expect(run.events.map((event) => event.event_key)).toEqual(["intake:a"])
  data.store.defer(run.id)
  expect(data.store.claim(2)?.events[0].event_key).toBe("intake:a")
})

test("source outages persist health and wake an idle worker once until recovery", () => {
  const data = fixture()
  data.store.health("github", 1)
  data.store.health("github", 2, "network")
  const reopened = new ServiceStore(data.directory)
  stores.push(reopened)
  reopened.health("github", 3, "network")
  expect(reopened.status().health).toMatchObject([{ success_at: 1, checked_at: 3, failures: 2 }])
  reopened.enqueue("worker", "timer:worker-reconcile:3", "poll")
  reopened.discardIdleWorkerTicks(true)
  const run = reopened.claim(3)!
  expect(run.role).toBe("worker")
  expect(run.events.map((event) => event.event_key)).toEqual(["intake-failure:github:2"])
  reopened.finish(run.id, { success: true }, 3)
  expect(reopened.claim(4)).toBeUndefined()
  reopened.health("github", 4)
  expect(reopened.status().health).toMatchObject([{ success_at: 4, failures: 0, detail: null }])
  reopened.health("github", 5, "network again")
  expect(reopened.claim(5)?.events.length).toBe(1)
})

async function executorFixture(mode: string) {
  const data = fixture()
  const binary = path.join(data.directory, "codex-fixture")
  await Bun.write(
    binary,
    `#!${process.execPath}\nconst args=process.argv.slice(2); const output=args[args.indexOf('--output-last-message')+1];
await Bun.stdin.text();
console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-thread'}));
${mode}
`,
    { mode: 0o700 },
  )
  chmodSync(binary, 0o700)
  return {
    root: data.directory,
    directory: data.directory,
    id: "fixture-run",
    role: "worker" as const,
    settings: { binary, home: data.directory, sandbox: "read-only" as const, timeoutSeconds: 60 },
    prompt: "read-only protocol fixture",
    signal: new AbortController().signal,
    onThread: () => {},
  }
}

test("Codex exit zero requires a completed turn and final response, and stores the transcript", async () => {
  const input = await executorFixture(
    "await Bun.write(output,'finished'); console.log(JSON.stringify({type:'turn.completed'}));",
  )
  const result = await executeCodex(input)
  expect(result.success).toBe(true)
  expect(result.thread).toBe("fixture-thread")
  expect(await Bun.file(path.join(input.directory, "control/runs/fixture-run/events.jsonl")).text()).toContain(
    "turn.completed",
  )
  const incomplete = await executorFixture("await Bun.write(output,'partial');")
  expect((await executeCodex(incomplete)).success).toBe(false)
  const failed = await executorFixture(
    "await Bun.write(output,'partial'); console.log(JSON.stringify({type:'turn.failed'}));",
  )
  expect((await executeCodex(failed)).success).toBe(false)
})

test("stopping an executor terminates it and reports an interrupted result", async () => {
  const input = await executorFixture("setInterval(()=>{},1000)")
  const signal = new AbortController()
  const promise = executeCodex({ ...input, signal: signal.signal, onThread: () => signal.abort() })
  expect((await promise).success).toBe(false)
})

test("Codex configuration rejects incomplete or implicit permission settings", () => {
  expect(() => codexSettings({ binary: "codex" })).toThrow()
  expect(() => codexSettings({ binary: "/bin/codex", home: "/private/home", timeoutSeconds: 60 })).toThrow()
  expect(() =>
    codexSettings({
      binary: "/bin/codex",
      home: "/private/home",
      timeoutSeconds: 60,
      sandbox: "read-only",
      permissionProfile: "review",
    }),
  ).toThrow()
})

test("cancelling a fired timer removes only its unclaimed wakeup", () => {
  const data = fixture()
  data.store.schedule("ci", "worker", 0, "cancel")
  data.store.schedule("ci-other", "worker", 0, "keep")
  data.store.fireTimers(1)
  data.store.cancelTimer("ci")
  expect(data.store.claim(2)?.events.map((event) => event.event_key)).toEqual(["timer:ci-other:0"])
})

test("an already aborted executor and missing executable fail without a hanging process", async () => {
  const input = await executorFixture("setInterval(()=>{},1000)")
  const signal = new AbortController()
  signal.abort()
  expect((await executeCodex({ ...input, signal: signal.signal })).success).toBe(false)
  expect(
    (await executeCodex({ ...input, id: "missing", settings: { ...input.settings, binary: "/missing/codex" } }))
      .success,
  ).toBe(false)
})

test("owner recovery distinguishes reused process IDs from the original process identity", () => {
  const data = fixture()
  const token = data.store.acquire()
  data.store.db.query("UPDATE owner SET identity=?").run("previous-boot:previous-process")
  const recovery = data.store.acquire()
  expect(recovery).not.toBe(token)
  data.store.release(recovery)
})
