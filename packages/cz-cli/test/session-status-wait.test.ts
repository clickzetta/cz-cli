import { describe, expect, test } from "bun:test"
import { deriveBusyFromLatestMessage, extractNewParts, partWaitKey, waitLoop } from "../src/agent-cmd/session-status"
import { MessageID, PartID, SessionID } from "opencode/session/schema"
import type { Part, TextPart, ToolPart } from "@opencode-ai/core/v1/session"

const sid = SessionID.make("ses_test")
const mid = MessageID.make("msg_test")

function textPart(id: string, text = "hi"): TextPart {
  return {
    id: (id as unknown as PartID),
    sessionID: sid,
    messageID: mid,
    type: "text",
    text,
  } as TextPart
}

function bashTool(id: string, status: "pending" | "running" | "completed", command = "ls"): ToolPart {
  const time = status === "pending" ? undefined : status === "running" ? { start: 1 } : { start: 1, end: 2 }
  return {
    id: (id as unknown as PartID),
    sessionID: sid,
    messageID: mid,
    type: "tool",
    callID: `call_${id}`,
    tool: "bash",
    state: {
      status,
      input: { command },
      ...(status === "completed" ? { output: "ok", title: command, metadata: {} } : {}),
      ...(time ? { time } : {}),
    },
  } as ToolPart
}

function stepStart(id: string): Part {
  return {
    id: (id as unknown as PartID),
    sessionID: sid,
    messageID: mid,
    type: "step-start",
  } as Part
}

describe("partWaitKey", () => {
  test("text parts key on id+type plus milestone bucket", () => {
    expect(partWaitKey(textPart("p1"))).toBe("p1:text:0")
  })
  test("tool parts key on id+state.status so transitions emit", () => {
    expect(partWaitKey(bashTool("p1", "running"))).toBe("p1:running")
    expect(partWaitKey(bashTool("p1", "completed"))).toBe("p1:completed")
  })
  test("text parts key on length milestones so real text growth can emit again", () => {
    expect(partWaitKey(textPart("p1", "short"))).toBe("p1:text:0")
    expect(partWaitKey(textPart("p1", "x".repeat(121)))).toBe("p1:text:1")
    expect(partWaitKey(textPart("p1", "x".repeat(241)))).toBe("p1:text:2")
  })
})

describe("extractNewParts", () => {
  test("returns oldest→newest, drops non-informative, dedupes by key", () => {
    const recent: Part[] = [bashTool("p3", "completed"), stepStart("p2"), bashTool("p1", "running")]
    const seen = new Set<string>()
    const got = extractNewParts(recent, seen)
    expect(got.map((p) => p.id as string)).toEqual(["p1", "p3"])
    expect(seen.has("p1:running")).toBe(true)
    expect(seen.has("p3:completed")).toBe(true)
    expect(seen.has("p2:step-start")).toBe(false)
  })

  test("status transition on the same part emits a new event", () => {
    const seen = new Set<string>()
    expect(extractNewParts([bashTool("p1", "running")], seen).map((p) => partWaitKey(p))).toEqual(["p1:running"])
    expect(extractNewParts([bashTool("p1", "completed"), bashTool("p1", "running")], seen).map((p) => partWaitKey(p))).toEqual([
      "p1:completed",
    ])
  })

  test("pending bash without command is dropped (non-informative)", () => {
    const pending: ToolPart = {
      id: ("p1" as unknown as PartID),
      sessionID: sid,
      messageID: mid,
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "pending", input: {} },
    } as ToolPart
    expect(extractNewParts([pending], new Set())).toEqual([])
  })

  test("empty text parts are dropped until there is real content", () => {
    expect(extractNewParts([textPart("p1", "")], new Set())).toEqual([])
  })

  test("text growth beyond a milestone on the same part emits again", () => {
    const seen = new Set<string>()
    expect(extractNewParts([textPart("p1", "hello")], seen).map((p) => partWaitKey(p))).toEqual(["p1:text:0"])
    expect(extractNewParts([textPart("p1", "x".repeat(130))], seen).map((p) => partWaitKey(p))).toEqual(["p1:text:1"])
  })
})

describe("deriveBusyFromLatestMessage", () => {
  test("treats assistant tool-calls finish as still busy", () => {
    const msg = {
      info: {
        id: mid,
        sessionID: sid,
        role: "assistant",
        time: { created: 1, completed: 2 },
        parentID: MessageID.make("msg_parent"),
        modelID: "test",
        providerID: "test",
        mode: "build",
        agent: "build",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "tool-calls",
      },
      parts: [textPart("p1", "intermediate text")],
    } as any
    expect(deriveBusyFromLatestMessage(msg, 10)).toBe(true)
  })

  test("treats assistant unknown finish as still busy", () => {
    const msg = {
      info: {
        id: mid,
        sessionID: sid,
        role: "assistant",
        time: { created: 1, completed: 2 },
        parentID: MessageID.make("msg_parent"),
        modelID: "test",
        providerID: "test",
        mode: "build",
        agent: "build",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "unknown",
      },
      parts: [],
    } as any
    expect(deriveBusyFromLatestMessage(msg, 10)).toBe(true)
  })

  test("treats finished assistant stop as idle", () => {
    const msg = {
      info: {
        id: mid,
        sessionID: sid,
        role: "assistant",
        time: { created: 1, completed: 2 },
        parentID: MessageID.make("msg_parent"),
        modelID: "test",
        providerID: "test",
        mode: "build",
        agent: "build",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
      },
      parts: [textPart("p1", "final")],
    } as any
    expect(deriveBusyFromLatestMessage(msg, 10)).toBe(false)
  })
})

describe("waitLoop", () => {
  type Tick = {
    dv: number
    snap: any
    parts?: { part: Part; timeUpdated: number }[]
  }

  function fakeDeps(ticks: Tick[]) {
    let i = 0
    let nowMs = 0
    let snapshotCalls = 0
    let partsSinceCalls = 0
    const sleeps: number[] = []
    const emitted: Record<string, unknown>[] = []
    const cur = () => ticks[Math.min(i, ticks.length - 1)]
    return {
      emitted,
      sleeps,
      get snapshotCalls() {
        return snapshotCalls
      },
      get partsSinceCalls() {
        return partsSinceCalls
      },
      sleep: async (ms: number) => {
        sleeps.push(ms)
        nowMs += ms
        // sleep is the once-per-iteration anchor: advance the script here
        i++
      },
      now: () => nowMs,
      dataVersion: () => cur().dv,
      snapshot: async () => {
        snapshotCalls++
        return cur().snap
      },
      partsSince: async (_sid: SessionID, cursor: number) => {
        partsSinceCalls++
        const all = cur().parts ?? []
        return all.filter((u) => u.timeUpdated > cursor)
      },
      // deterministic jitter — defaults to interval unchanged (random=0.5 → 1.0× factor)
      random: () => 0.5,
      emit: (line: Record<string, unknown>) => {
        emitted.push(line)
      },
    }
  }

  test("idle on first poll → emits result, exit 0", async () => {
    const deps = fakeDeps([{ dv: 1, snap: { kind: "idle", result: "done" } }])
    const res = await waitLoop(sid, { intervalMs: 1000, timeoutMs: 0 }, deps)
    expect(res.exitCode).toBe(0)
    expect(deps.emitted).toEqual([{ session_id: sid, status: "idle", result: "done" }])
  })

  test("not_found → emits error, exit 1", async () => {
    const deps = fakeDeps([{ dv: 1, snap: { kind: "not_found" } }])
    const res = await waitLoop(sid, { intervalMs: 1000, timeoutMs: 0 }, deps)
    expect(res.exitCode).toBe(1)
    expect(deps.emitted).toEqual([{ session_id: sid, error: "Session not found" }])
  })

  test("data_version unchanged → snapshot/partsSince NOT called, just backoff", async () => {
    // First tick: dv=1, busy. Then 3 unchanged ticks (dv stays 1). Then dv=2, idle.
    const deps = fakeDeps([
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] }, // unchanged — should be skipped
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] }, // unchanged
      { dv: 2, snap: { kind: "idle", result: "done" } },
    ])
    const res = await waitLoop(sid, { intervalMs: 2000, timeoutMs: 0 }, deps)
    expect(res.exitCode).toBe(0)
    // 1st tick: dv=1 (first read, not gated) → snapshot+partsSince called
    // 2nd tick: dv=1, gated → no snapshot/partsSince
    // 3rd tick: still dv=1, gated
    // 4th tick: dv=2, snapshot+nothing (idle)
    expect(deps.snapshotCalls).toBe(2)
    // partsSince only called when busy (1st tick)
    expect(deps.partsSinceCalls).toBe(1)
  })

  test("adaptive interval: hit resets to MIN, miss grows ×1.5 capped at maxInterval", async () => {
    // 1st: busy with new part → hit, next sleep should be 150ms (MIN)
    // 2nd: dv unchanged → miss, sleep 150*1.5=225ms
    // 3rd: dv unchanged → miss, sleep 225*1.5=337.5≈338ms
    // 4th: dv unchanged → miss, sleep min(338*1.5, 500)=500ms (capped)
    // 5th: idle, exit
    const deps = fakeDeps([
      {
        dv: 1,
        snap: { kind: "busy", type: "busy" },
        parts: [{ part: textPart("p1", "hello"), timeUpdated: 100 }],
      },
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
      { dv: 2, snap: { kind: "idle", result: "done" } },
    ])
    const res = await waitLoop(sid, { intervalMs: 500, timeoutMs: 0 }, deps)
    expect(res.exitCode).toBe(0)
    // sleeps[0] = after first hit — should be MIN_WAIT_INTERVAL_MS = 150
    expect(deps.sleeps[0]).toBe(150)
    // sleeps[1] = after first miss — 150 * 1.5 = 225
    expect(deps.sleeps[1]).toBe(225)
    // sleeps[2] = 225 * 1.5 = 337 or 338 (rounded)
    expect(deps.sleeps[2]).toBeGreaterThanOrEqual(337)
    expect(deps.sleeps[2]).toBeLessThanOrEqual(338)
    // sleeps[3] capped at maxInterval = 500ms
    expect(deps.sleeps[3]).toBe(500)
  })

  test("cursor advances on each tick; partsSince filters by cursor", async () => {
    const deps = fakeDeps([
      {
        dv: 1,
        snap: { kind: "busy", type: "busy" },
        parts: [
          { part: textPart("p1", "a"), timeUpdated: 100 },
          { part: textPart("p2", "b"), timeUpdated: 200 },
        ],
      },
      // dv changes; partsSince script returns p3 at t=300 PLUS p2 at t=200 (already seen — filtered by cursor)
      {
        dv: 2,
        snap: { kind: "busy", type: "busy" },
        parts: [
          { part: textPart("p2", "b"), timeUpdated: 200 }, // cursor will exclude this
          { part: textPart("p3", "c"), timeUpdated: 300 },
        ],
      },
      { dv: 3, snap: { kind: "idle", result: null } },
    ])
    const res = await waitLoop(sid, { intervalMs: 1000, timeoutMs: 0 }, deps)
    expect(res.exitCode).toBe(0)
    const partLines = deps.emitted.filter((l) => l.part_id != null)
    expect(partLines.map((l) => l.part_id)).toEqual(["p1", "p2", "p3"])
  })

  test("status transition on same part emits a new event via dedupe key", async () => {
    const deps = fakeDeps([
      {
        dv: 1,
        snap: { kind: "busy", type: "busy" },
        parts: [{ part: bashTool("t1", "running"), timeUpdated: 100 }],
      },
      // tool finishes — same part_id, time_updated bumps; partWaitKey distinguishes status
      {
        dv: 2,
        snap: { kind: "busy", type: "busy" },
        parts: [{ part: bashTool("t1", "completed"), timeUpdated: 250 }],
      },
      { dv: 3, snap: { kind: "idle", result: null } },
    ])
    const res = await waitLoop(sid, { intervalMs: 1000, timeoutMs: 0 }, deps)
    expect(res.exitCode).toBe(0)
    const toolLines = deps.emitted.filter((l) => l.tool != null)
    expect(toolLines.map((l) => l.tool_status)).toEqual(["running", "completed"])
  })

  test("busy → retry transition emits status line", async () => {
    const deps = fakeDeps([
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
      {
        dv: 2,
        snap: { kind: "busy", type: "retry", retry: { attempt: 2, message: "rate limit", next: 1000 } },
        parts: [],
      },
      { dv: 3, snap: { kind: "idle", result: null } },
    ])
    const res = await waitLoop(sid, { intervalMs: 1000, timeoutMs: 0 }, deps)
    expect(res.exitCode).toBe(0)
    expect(deps.emitted[0]).toEqual({ session_id: sid, status: "busy" })
    expect(deps.emitted[1]).toEqual({
      session_id: sid,
      status: "retry",
      retry: { attempt: 2, message: "rate limit", next: 1000 },
    })
  })

  test("timeout → emits timeout line, exit 124", async () => {
    // Stick on dv=1 forever; gating will keep adaptive backoff growing until timeout fires.
    const deps = fakeDeps([
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
    ])
    const res = await waitLoop(sid, { intervalMs: 0.2, timeoutMs: 0.5 }, deps)
    expect(res.exitCode).toBe(124)
    const last = deps.emitted[deps.emitted.length - 1]
    expect(last).toEqual({ session_id: sid, status: "timeout" })
  })

  test("jitter is bounded to ±10% of the planned interval", async () => {
    // random=0 → 0.9× interval; random=0.999 → ~1.1× interval
    const deps = fakeDeps([
      {
        dv: 1,
        snap: { kind: "busy", type: "busy" },
        parts: [{ part: textPart("p1"), timeUpdated: 1 }],
      },
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
      { dv: 2, snap: { kind: "idle", result: null } },
    ])
    deps.random = () => 0
    const res = await waitLoop(sid, { intervalMs: 5000, timeoutMs: 0 }, deps)
    expect(res.exitCode).toBe(0)
    // First sleep after hit: 150ms × 0.9 = 135ms
    expect(deps.sleeps[0]).toBe(135)
    // Second sleep after miss: 150*1.5=225, then × 0.9 jitter
    expect(deps.sleeps[1]).toBe(Math.round(225 * 0.9))
  })

  test("quiet-timeout fires when cursor doesn't advance for 5 minutes", async () => {
    // First tick: dv=1, busy, no parts → cursor stays 0, lastSessionActivityMs frozen at start.
    // Subsequent ticks: dv=1 (gated). With max interval 60s, ~5+ ticks elapse 5 min wall time
    // since each gated sleep adds maxInterval=60000ms.
    const deps = fakeDeps([
      { dv: 1, snap: { kind: "busy", type: "busy" }, parts: [] },
      ...Array.from({ length: 10 }, () => ({
        dv: 1 as number,
        snap: { kind: "busy", type: "busy" } as any,
        parts: [],
      })),
    ])
    const res = await waitLoop(sid, { intervalMs: 60_000, timeoutMs: 0 }, deps)
    expect(res.exitCode).toBe(124)
    const last = deps.emitted[deps.emitted.length - 1] as Record<string, any>
    expect(last.status).toBe("timeout")
    expect(last.quiet_for_seconds).toBeGreaterThanOrEqual(300)
  })

  test("ongoing part activity keeps quiet-timeout from firing", async () => {
    // Each tick advances cursor → lastSessionActivityMs reset → never times out.
    const ticks = Array.from({ length: 8 }, (_, i) => ({
      dv: i + 1,
      snap: { kind: "busy", type: "busy" } as any,
      parts: [{ part: textPart(`p${i}`, "x"), timeUpdated: (i + 1) * 100_000 }],
    }))
    ticks.push({ dv: 99, snap: { kind: "idle", result: "done" } as any, parts: [] })
    const deps = fakeDeps(ticks)
    const res = await waitLoop(sid, { intervalMs: 60_000, timeoutMs: 0 }, deps)
    expect(res.exitCode).toBe(0)
    expect(deps.emitted[deps.emitted.length - 1]).toEqual({ session_id: sid, status: "idle", result: "done" })
  })

  test("does not emit idle on an intermediate assistant text before later progress arrives", async () => {
    const deps = fakeDeps([
      {
        dv: 1,
        snap: { kind: "busy", type: "busy" },
        parts: [{ part: textPart("p1", "Now let me read the test files:"), timeUpdated: 100 }],
      },
      {
        dv: 2,
        snap: { kind: "busy", type: "busy" },
        parts: [{ part: bashTool("t1", "completed", "cat session-status-wait.test.ts"), timeUpdated: 200 }],
      },
      { dv: 3, snap: { kind: "idle", result: "final analysis" } },
    ])
    const res = await waitLoop(sid, { intervalMs: 1000, timeoutMs: 0 }, deps)
    expect(res.exitCode).toBe(0)
    expect(deps.emitted).toEqual([
      { session_id: sid, status: "busy" },
      {
        session_id: sid,
        status: "busy",
        part_id: "p1",
        part_type: "text",
        progress: "✏ Now let me read the test files:",
        text_preview: "Now let me read the test files:",
      },
      {
        session_id: sid,
        status: "busy",
        part_id: "t1",
        part_type: "tool",
        progress: "$ cat session-status-wait.test.ts",
        tool: "bash",
        tool_status: "completed",
      },
      { session_id: sid, status: "idle", result: "final analysis" },
    ])
  })
})
