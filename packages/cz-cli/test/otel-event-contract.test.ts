import { expect, test, describe } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The OTel handler subscribes to runtime events by string. Nothing links those
 * strings to the schema that defines them, so when the runtime renamed
 * `v2.tool.called` to `session.next.tool.called` the handler kept compiling, kept
 * loading, and simply stopped receiving tool and step events. Agent trajectory spans
 * disappeared from telemetry for days without a single failure anywhere: every
 * span-creating branch had quietly become dead code.
 *
 * These tests are the missing link. A rename now fails here instead of silently
 * draining the trace.
 */

const ROOT = join(import.meta.dir, "..", "..", "..")
const HANDLERS = join(ROOT, "packages/cz-cli/src/opencode-plugin/otel/handlers.ts")
const SCHEMAS = [
  "packages/schema/src/session-event.ts",
  "packages/schema/src/session-v1.ts",
  "packages/schema/src/session-status-event.ts",
].map((p) => join(ROOT, p))

/**
 * Only the `case` labels inside `handleEvent` are event subscriptions. The file has other
 * switches — `serializePart` dispatches on message part types — and scanning the whole
 * source counted those as subscribed events.
 */
function subscribedEvents(): string[] {
  const source = readFileSync(HANDLERS, "utf-8")
  const start = source.indexOf("export function handleEvent(")
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf("} catch {}", start)
  expect(end).toBeGreaterThan(start)
  const body = source.slice(start, end)
  return [...body.matchAll(/case\s+"([a-z0-9._]+)"/g)].map((m) => m[1]!)
}

/**
 * Event names the schema defines. The file list is fixed on purpose: it is the set of
 * surfaces a plugin can receive, so a subscription to something outside it is the very
 * mistake this guards. A legitimate new surface means adding the file here.
 */
function publishedEvents(): Set<string> {
  const names = new Set<string>()
  for (const file of SCHEMAS) {
    const source = readFileSync(file, "utf-8")
    for (const m of source.matchAll(/type:\s*"([a-z0-9._]+)"/g)) names.add(m[1]!)
  }
  return names
}

/**
 * The surface a plugin is actually delivered, measured by instrumenting the hook on
 * 2026-08-24. "Defined in the schema" is a weaker property than "delivered here": the
 * `session.next.*` events are all real schema entries, published from the core session
 * runner, and a v1-path plugin never sees them — which is the failure this suite exists
 * for. So subscriptions are checked against this list, not only against the schema.
 */
const DELIVERED = new Set([
  "session.created",
  "session.deleted",
  "session.status",
  "session.idle",
  "session.error",
  "message.updated",
  "message.part.updated",
  "message.part.delta",
  // The one `session.next.*` name that reaches a v1-path plugin. Published from the v1
  // prompt path at prompt.ts:712, but only when the resolved model differs from the
  // session's (the guard at :707-711) — so it is a supplement, never the primary source of
  // model identity. That is `message.updated`, which fires for every assistant message.
  "session.next.model.switched",
])

describe("otel handler event contract", () => {
  test("subscribes to at least the events it needs to build a trajectory", () => {
    const subscribed = subscribedEvents()
    // Measured by instrumenting the hook on 2026-08-24: a plugin receives the v1
    // message surface, not the durable `session.next.*` bus. Spans are therefore
    // built from message parts, and losing either of these silently empties the
    // trace of every `chat` and `execute_tool` span — the state that went unnoticed
    // for days after the runtime renamed its internal events.
    // session.status is the turn anchor: it is the first signal of a turn on the v1 path,
    // and several failures are published before any part exists.
    for (const required of ["session.status", "message.part.updated", "message.updated"]) {
      expect(subscribed).toContain(required)
    }
  })

  test("every subscribed event is one the schema actually defines", () => {
    const published = publishedEvents()
    expect(published.size).toBeGreaterThan(20)
    const orphans = subscribedEvents().filter((name) => !published.has(name))
    expect(orphans).toEqual([])
  })

  test("every subscribed event is one this path actually delivers", () => {
    const undelivered = subscribedEvents().filter((name) => !DELIVERED.has(name))
    expect(undelivered).toEqual([])
  })

  test("no v2.* subscriptions survive", () => {
    const stale = subscribedEvents().filter((name) => name.startsWith("v2."))
    expect(stale).toEqual([])
  })
})
