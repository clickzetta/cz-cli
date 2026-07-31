import { describe, expect, test } from "bun:test"
import { createQuotaController } from "../src/opencode-plugin/tui-quota-controller"
import type { QuotaSnapshot } from "../src/opencode-plugin/tui-quota-data"

function makeController(load: () => Promise<QuotaSnapshot | undefined>) {
  const seen: Array<QuotaSnapshot | undefined> = []
  let calls = 0
  const controller = createQuotaController({
    load: () => {
      calls += 1
      return load()
    },
    onSnapshot: (snapshot) => seen.push(snapshot),
  })
  return { controller, seen, count: () => calls }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("createQuotaController", () => {
  test("delivers a loaded snapshot", async () => {
    const { controller, seen } = makeController(async () => ({ cash: 1 }))
    controller.refresh()
    await Promise.resolve()
    await Promise.resolve()
    expect(seen).toEqual([{ cash: 1 }])
  })

  // A refresh is triggered by session traffic, so bursts are normal. Keep at most
  // one trailing read so a provider switch is not lost behind an older request.
  test("coalesces in-flight refreshes into one trailing load", async () => {
    const first = deferred<QuotaSnapshot>()
    const second = deferred<QuotaSnapshot>()
    const { controller, count, seen } = makeController(() => count() === 1 ? first.promise : second.promise)
    controller.refresh()
    controller.refresh()
    controller.refresh()
    expect(count()).toBe(1)
    first.resolve({ cash: 1 })
    await Bun.sleep(1)
    expect(count()).toBe(2)
    expect(seen).toEqual([])
    second.resolve({ cash: 2 })
    await Bun.sleep(1)
    expect(seen).toEqual([{ cash: 2 }])
  })

  test("accepts a new refresh once the previous one settles", async () => {
    const { controller, count } = makeController(async () => ({ cash: 1 }))
    controller.refresh()
    await Bun.sleep(1)
    controller.refresh()
    await Bun.sleep(1)
    expect(count()).toBe(2)
  })

  // The reading on screen is better than no reading: a portal blip must not blank
  // a number the user is looking at, and must never surface as an error.
  test("keeps the last good value when a load fails", async () => {
    let attempt = 0
    const { controller, seen } = makeController(async () => {
      attempt += 1
      if (attempt === 2) throw new Error("portal down")
      return { cash: attempt }
    })
    controller.refresh()
    await Bun.sleep(1)
    controller.refresh()
    await Bun.sleep(1)
    expect(seen).toEqual([{ cash: 1 }])
  })

  test("passes through an undefined snapshot (non-clickzetta provider)", async () => {
    const { controller, seen } = makeController(async () => undefined)
    controller.refresh()
    await Bun.sleep(1)
    expect(seen).toEqual([undefined])
  })

  describe("observeStatus", () => {
    test("refreshes on the busy → idle edge", async () => {
      const { controller, count } = makeController(async () => ({ cash: 1 }))
      controller.observeStatus("s1", { type: "busy" })
      await Bun.sleep(1)
      expect(count()).toBe(0)
      controller.observeStatus("s1", { type: "idle" })
      expect(count()).toBe(1)
    })

    test("also treats retry as in-flight so a recovered turn still refreshes", async () => {
      const { controller, count } = makeController(async () => ({ cash: 1 }))
      controller.observeStatus("s1", { type: "retry" })
      controller.observeStatus("s1", { type: "idle" })
      expect(count()).toBe(1)
    })

    // Status is hydrated on connect and re-emitted, so an unconditional idle check
    // would fire on startup and on every repeat.
    test("ignores idle for a session it never saw working", () => {
      const { controller, count } = makeController(async () => ({ cash: 1 }))
      controller.observeStatus("s1", { type: "idle" })
      controller.observeStatus("s1", { type: "idle" })
      expect(count()).toBe(0)
    })

    test("does not refresh twice for one turn", async () => {
      const { controller, count } = makeController(async () => ({ cash: 1 }))
      controller.observeStatus("s1", { type: "busy" })
      controller.observeStatus("s1", { type: "idle" })
      await Bun.sleep(1)
      controller.observeStatus("s1", { type: "idle" })
      expect(count()).toBe(1)
    })

    test("tracks sessions independently", async () => {
      const { controller, count } = makeController(async () => ({ cash: 1 }))
      controller.observeStatus("s1", { type: "busy" })
      controller.observeStatus("s2", { type: "idle" })
      expect(count()).toBe(0)
      controller.observeStatus("s1", { type: "idle" })
      expect(count()).toBe(1)
    })
  })

  describe("dispose", () => {
    test("stops accepting refreshes", () => {
      const { controller, count } = makeController(async () => ({ cash: 1 }))
      controller.dispose()
      controller.refresh()
      controller.observeStatus("s1", { type: "busy" })
      controller.observeStatus("s1", { type: "idle" })
      expect(count()).toBe(0)
    })

    // Solid signals are torn down on dispose, so a late write would target a dead
    // scope.
    test("ignores a load that resolves after teardown", async () => {
      const gate = deferred<QuotaSnapshot>()
      const { controller, seen } = makeController(() => gate.promise)
      controller.refresh()
      controller.dispose()
      gate.resolve({ cash: 1 })
      await Bun.sleep(1)
      expect(seen).toEqual([])
    })
  })
})
