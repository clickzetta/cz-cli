/** @jsxImportSource @opentui/solid */
// cz_change: show ClickZetta account balance + AI-gateway token quota in the
// prompt's top-right corner, next to the agent and model labels.
//
// Rendered through opencode's PUBLIC slot API (home_prompt_right /
// session_prompt_right, declared in packages/plugin/src/tui.ts and passed to
// Prompt as its `right` prop), so packages/tui and packages/opencode stay
// pristine — same approach as the home_logo brand plugin next door.
//
// The split across four files is deliberate: only this file may contain JSX,
// because it has to ship as raw .tsx (the host compiles it at import time and
// binds solid to its own singleton — a pre-bundled copy would carry a second
// @opentui/core and get dropped at load). Everything else is bundled and
// unit-tested behind one bundling entry, tui-quota-runtime.ts: tui-quota-data.ts
// (fetch), tui-quota-format.ts (presentation), tui-quota-controller.ts (refresh).
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createEffect, createSignal, createMemo, For, Show } from "solid-js"
import {
  createQuotaController,
  fetchQuotaSnapshot,
  quotaSegments,
  readRecentProviders,
  selectDisplayedProvider,
  type QuotaSnapshot,
  type QuotaTone,
} from "./tui-quota-runtime.js"

function View(props: {
  api: TuiPluginApi
  snapshot: () => QuotaSnapshot | undefined
  onContext: (key: string) => void
}) {
  const theme = () => props.api.theme.current
  const segments = createMemo(() => quotaSegments(props.snapshot()))
  const color = (tone: QuotaTone) => theme()[tone]

  // The provider list arrives with sync, well after plugins load, and attributing
  // usage needs it. This effect lives in the slot component because that is the
  // only place with a reactive owner — plugin init runs outside any Solid root, so
  // an effect created there is never scheduled.
  createEffect(() => {
    const sessionID = currentSessionID(props.api) ?? ""
    props.onContext(`${props.api.route.current.name}:${sessionID}:${displayedProviderID(props.api) ?? ""}`)
  })

  // No segments = nothing worth showing (non-ClickZetta provider, or no reading
  // yet). Render an empty fragment rather than a placeholder: the slot sits in
  // the prompt header and any filler would look like real data.
  return (
    <Show when={segments().length > 0}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <For each={segments()}>
          {(segment, index) => (
            <>
              <Show when={index() > 0}>
                <text fg={theme().textMuted} selectable={false}>
                  ·
                </text>
              </Show>
              <text fg={color(segment.tone)} selectable={false} wrapMode="none">
                {segment.text}
              </text>
            </>
          )}
        </For>
      </box>
    </Show>
  )
}

export function installQuotaIndicator(api: TuiPluginApi) {
  const [snapshot, setSnapshot] = createSignal<QuotaSnapshot | undefined>(undefined)
  const observed = new Map<string, string>()

  const controller = createQuotaController({
    load: () => {
      const sessionID = currentSessionID(api)
      return fetchQuotaSnapshot({
        providerID: (sessionID ? observed.get(sessionID) : undefined) ?? displayedProviderID(api),
        signal: api.lifecycle.signal,
      })
    },
    onSnapshot: setSnapshot,
  })

  const unsubscribe = [
    api.event.on("session.status", (event) => {
      controller.observeStatus(event.properties.sessionID, event.properties.status)
    }),
    // An assistant message carries the provider that actually served it — the
    // ground truth for auto-selected models.
    api.event.on("message.updated", (event) => {
      const message = event.properties.info
      if (message.role !== "assistant") return
      if (typeof message.providerID !== "string") return
      if (message.providerID === observed.get(message.sessionID)) return
      observed.set(message.sessionID, message.providerID)
      if (message.sessionID !== currentSessionID(api)) return
      controller.refresh()
    }),
    // Switching model mid-session can switch tenant, which changes both the key
    // and the portal to read it from.
    api.event.on("session.next.model.switched", (event) => {
      const next = event.properties.model.providerID
      if (next === observed.get(event.properties.sessionID)) return
      observed.set(event.properties.sessionID, next)
      if (event.properties.sessionID !== currentSessionID(api)) return
      controller.refresh()
    }),
  ]

  api.lifecycle.onDispose(() => {
    for (const off of unsubscribe) off()
    observed.clear()
    controller.dispose()
  })

  // Provider sync and route changes both alter the provider the prompt displays.
  // Refresh once per distinct context; the controller coalesces remounts while a
  // request is already in flight.
  let context = ""
  const onContext = (key: string) => {
    if (key === context) return
    context = key
    controller.refresh()
  }

  api.slots.register({
    order: 100,
    slots: {
      home_prompt_right() {
        return <View api={api} snapshot={snapshot} onContext={onContext} />
      },
      session_prompt_right() {
        return <View api={api} snapshot={snapshot} onContext={onContext} />
      },
    },
  })

  // Kick off the first read here, unawaited: the loader awaits tui(), so blocking
  // on the portal would delay the TUI's first paint. This runs before the provider
  // list has synced, so the read may resolve nothing — the slot's own effect
  // retries once providers arrive. Starting here anyway means the common case (a
  // single ClickZetta entry, resolvable with no provider list at all) paints
  // without waiting on sync.
  controller.refresh()
}

/**
 * The provider the prompt will show next to the model name, worked out the way
 * the TUI itself works it out: pinned model, else recent-model history, else the
 * first available provider.
 *
 * Reading `config.model` alone is not enough — it is unset unless the user ran
 * `cz-cli agent llm use`, and the auto-selected provider is often a different
 * one from the launch profile. Reporting the launch profile's quota while the
 * prompt names another provider would show a number for a key the session isn't
 * spending. Once a message lands, the assistant's own providerID supersedes this.
 */
function displayedProviderID(api: TuiPluginApi): string | undefined {
  return selectDisplayedProvider({
    configModel: typeof api.state.config.model === "string" ? api.state.config.model : undefined,
    recent: readRecentProviders(api.state.path.state),
    providers: api.state.provider.map((item) => ({ id: item.id, models: item.models })),
  })
}

function currentSessionID(api: TuiPluginApi) {
  const route = api.route.current
  if (route.name !== "session" || !route.params || typeof route.params.sessionID !== "string") return undefined
  return route.params.sessionID
}

const tui: TuiPlugin = async (api) => {
  installQuotaIndicator(api)
}

export default { id: "clickzetta.tui-quota", tui }
