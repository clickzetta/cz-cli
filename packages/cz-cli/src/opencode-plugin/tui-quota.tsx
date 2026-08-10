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
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createEffect, createSignal, createMemo, For, Show } from "solid-js"
import {
  createQuotaController,
  currentSessionID,
  fetchQuotaSnapshot,
  quotaSegments,
  type ActiveModelContext,
  type QuotaSnapshot,
  type QuotaTone,
} from "./tui-quota-runtime.js"

function View(props: {
  api: TuiPluginApi
  activeModel: ActiveModelContext
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
    props.onContext(
      `${props.api.route.current.name}:${sessionID}:${props.activeModel.providerID(sessionID || undefined) ?? ""}`,
    )
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

export function installQuotaIndicator(api: TuiPluginApi, activeModel: ActiveModelContext) {
  const [snapshot, setSnapshot] = createSignal<QuotaSnapshot | undefined>(undefined)

  const controller = createQuotaController({
    load: () =>
      fetchQuotaSnapshot({
        providerID: activeModel.providerID(),
        signal: api.lifecycle.signal,
      }),
    onSnapshot: setSnapshot,
  })

  const unsubscribe = [
    api.event.on("session.status", (event) => {
      controller.observeStatus(event.properties.sessionID, event.properties.status)
    }),
    // Which provider is active is tracked by the shared context (see active-model
    // .ts); this only reacts to it. Quota is charged to the active provider's key,
    // so a change means the reading is for the wrong key until refreshed.
    activeModel.onChange(({ sessionID }) => {
      if (sessionID !== currentSessionID(api)) return
      controller.refresh()
    }),
  ]

  api.lifecycle.onDispose(() => {
    for (const off of unsubscribe) off()
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
        return <View api={api} activeModel={activeModel} snapshot={snapshot} onContext={onContext} />
      },
      session_prompt_right() {
        return <View api={api} activeModel={activeModel} snapshot={snapshot} onContext={onContext} />
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

// No default export / `tui` entry on purpose: this file is not loaded as a plugin
// of its own. injectClickzettaTuiConfig registers exactly ONE spec —
// tui-brand.tsx (resolveClickzettaTuiPluginSpecifier) — which calls
// installQuotaIndicator with the shared active-model context. A second entry here
// would be dead code, and if it ever did load it would create a rival context.
