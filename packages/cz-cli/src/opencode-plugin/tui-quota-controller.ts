// cz_change: refresh scheduling for the TUI quota indicator. Split out of
// tui-quota.tsx so the edge detection and the overlap guard are unit-testable
// without a TUI or the JSX runtime.
import type { QuotaSnapshot } from "./tui-quota-data.js"

export interface QuotaControllerInput {
  /** Loads a fresh snapshot. Rejections are swallowed by the controller. */
  load: () => Promise<QuotaSnapshot | undefined>
  /** Receives every successful reading, including `undefined` (not ClickZetta). */
  onSnapshot: (snapshot: QuotaSnapshot | undefined) => void
}

export interface QuotaController {
  /** Request a refresh. Coalesces while one is already in flight. */
  refresh: () => void
  /** Feed a session.status event; refreshes on the busy → idle edge. */
  observeStatus: (sessionID: string, status: { type: string }) => void
  /** Stop accepting refreshes and ignore any in-flight result. */
  dispose: () => void
}

/**
 * A load is only ever started when none is outstanding, and a failed load leaves
 * the last good snapshot in place: a transient portal blip should not blank a
 * number the user is reading, and must never surface as a TUI error.
 */
export function createQuotaController(input: QuotaControllerInput): QuotaController {
  // Sessions observed mid-turn. Refreshing on a bare `type === "idle"` would also
  // fire on the initial status hydration and on every idle→idle repeat, so we
  // refresh only for a session we actually saw working.
  const active = new Set<string>()
  let inFlight = false
  let disposed = false
  let requested = 0

  function refresh() {
    if (disposed) return
    requested += 1
    if (inFlight) return
    load()
  }

  function load() {
    inFlight = true
    const generation = requested
    input
      .load()
      .then((snapshot) => {
        if (disposed || generation !== requested) return
        input.onSnapshot(snapshot)
      })
      .catch(() => {
        // Keep the previous reading. The indicator is ambient; a failure here is
        // not worth a toast, and definitely not worth breaking the prompt.
      })
      .finally(() => {
        inFlight = false
        if (!disposed && generation !== requested) load()
      })
  }

  function observeStatus(sessionID: string, status: { type: string }) {
    if (disposed) return
    if (status.type === "busy" || status.type === "retry") {
      active.add(sessionID)
      return
    }
    if (status.type !== "idle") return
    if (!active.delete(sessionID)) return
    // A turn just finished, so usage has moved — this is the one moment the
    // numbers are guaranteed stale.
    refresh()
  }

  return {
    refresh,
    observeStatus,
    dispose() {
      disposed = true
      requested = 0
      active.clear()
    },
  }
}
