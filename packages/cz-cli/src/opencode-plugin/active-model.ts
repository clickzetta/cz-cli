// cz_change: WHICH provider/model the TUI is actually running — one runtime
// context, shared by every consumer.
//
// `config.model` is NOT the answer, and reading it was a real bug: opencode treats
// it as the FIRST CANDIDATE only. When that model is unavailable it falls through
// to the recent-model history and then to the first available provider (the
// fallbackModel memo in packages/tui/src/context/local.tsx), so the provider
// actually serving requests is frequently a different one. The quota indicator
// learned this the hard way and tracked it locally; the AIGW key path then read
// `config.model` and swapped the exhausted key into the WRONG llm.json entry,
// leaving the erroring provider untouched. Hence one context instead of two
// answers.
//
// Ground truth, in order of authority:
//   1. the provider that served an assistant message in this session
//      (`message.updated`) — an observed fact, not a prediction
//   2. an explicit in-session switch (`session.next.model.switched`)
//   3. otherwise, mirror opencode's own auto-selection (selectDisplayedProvider)
//
// Deliberately NOT derived from error payloads. A `session.error` does carry a
// providerID, but consuming it would make each error site re-derive the answer —
// the exact duplication this module removes. Errors are events about the active
// provider; they are not a second definition of it.
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { readRecentProviders, selectDisplayedProvider } from "./tui-quota-data.js"

/** The session the user is looking at, or undefined outside a session route. */
export function currentSessionID(api: TuiPluginApi): string | undefined {
  const route = api.route.current
  if (route.name !== "session" || !route.params || typeof route.params.sessionID !== "string") return undefined
  return route.params.sessionID
}

/**
 * Mirror opencode's auto-selection to predict the provider before any message has
 * run. Used only as the fallback — once a message lands, the observed provider
 * supersedes it.
 */
function predictedProviderID(api: TuiPluginApi): string | undefined {
  return selectDisplayedProvider({
    configModel: typeof api.state.config.model === "string" ? api.state.config.model : undefined,
    recent: readRecentProviders(api.state.path.state),
    providers: api.state.provider.map((item) => ({ id: item.id, models: item.models })),
  })
}

export type ActiveModelContext = {
  /** The provider serving `sessionID`, or the current session when omitted. */
  providerID: (sessionID?: string) => string | undefined
  /** Called after the active provider for a session changes. */
  onChange: (listener: (input: { sessionID: string; providerID: string }) => void) => () => void
  /** Stop tracking. */
  dispose: () => void
}

/**
 * Start tracking the active provider per session.
 *
 * One instance per TUI process, created by the plugin entry and handed to every
 * consumer — see tui-brand.tsx. Consumers must not build their own: two trackers
 * would drift, which is how the bug above happened.
 */
export function createActiveModelContext(api: TuiPluginApi): ActiveModelContext {
  const observed = new Map<string, string>()
  const listeners = new Set<(input: { sessionID: string; providerID: string }) => void>()

  const record = (sessionID: string, providerID: string) => {
    if (observed.get(sessionID) === providerID) return
    observed.set(sessionID, providerID)
    for (const listener of listeners) {
      try {
        listener({ sessionID, providerID })
      } catch {
        // One consumer must not break the others.
      }
    }
  }

  const unsubscribe = [
    // An assistant message carries the provider that actually served it — the
    // ground truth for auto-selected models.
    api.event.on("message.updated", (event) => {
      const message = event.properties.info
      if (message.role !== "assistant") return
      if (typeof message.providerID !== "string") return
      record(message.sessionID, message.providerID)
    }),
    // Switching model mid-session can switch tenant, which changes both the key and
    // the portal to read it from.
    api.event.on("session.next.model.switched", (event) => {
      record(event.properties.sessionID, event.properties.model.providerID)
    }),
  ]

  return {
    providerID(sessionID) {
      const id = sessionID ?? currentSessionID(api)
      return (id ? observed.get(id) : undefined) ?? predictedProviderID(api)
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      for (const off of unsubscribe) off()
      listeners.clear()
      observed.clear()
    },
  }
}
