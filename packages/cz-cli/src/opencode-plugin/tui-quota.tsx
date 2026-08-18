/** @jsxImportSource @opentui/solid */
// cz_change: show ClickZetta account balance + AI-gateway token quota as a
// "Quota" section in the session sidebar, directly under "Context".
//
// It started on one line in the prompt's top-right corner and moved here because
// that line already carries the agent name, the model id and the provider: at 80
// columns the layout shrank the balance away entirely. The sidebar is the right
// home on the merits too — the Context section next to it reports tokens, percent
// used and dollars spent in exactly this vertical, one-figure-per-line shape, and
// this is the same kind of information about the same session.
//
// Rendered through opencode's PUBLIC slot API (sidebar_content, declared in
// packages/plugin/src/tui.ts), so packages/tui and packages/opencode stay pristine
// — same approach as the home_logo brand plugin next door. sidebar_content is an
// append slot, so this composes with upstream's own sections instead of displacing
// any of them.
//
// The sidebar is session-only and auto-opens above 120 columns (sidebarVisible in
// packages/tui/src/routes/session/index.tsx); narrower terminals reach it with the
// toggle. That is upstream's layout policy and deliberately not fought here.
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
  quotaRows,
  type ActiveModelContext,
  type QuotaSnapshot,
  type QuotaTone,
} from "./tui-quota-runtime.js"

function View(props: {
  api: TuiPluginApi
  activeModel: ActiveModelContext
  sessionID: string
  snapshot: () => QuotaSnapshot | undefined
  onContext: (key: string) => void
}) {
  const theme = () => props.api.theme.current
  const rows = createMemo(() => quotaRows(props.snapshot()))
  const color = (tone: QuotaTone) => theme()[tone]

  // The provider list arrives with sync, well after plugins load, and attributing
  // usage needs it. This effect lives in the slot component because that is the
  // only place with a reactive owner — plugin init runs outside any Solid root, so
  // an effect created there is never scheduled.
  createEffect(() => {
    props.onContext(`${props.sessionID}:${props.activeModel.providerID(props.sessionID) ?? ""}`)
  })

  // No rows = nothing worth showing (non-ClickZetta provider, or no reading yet).
  // Draw no section at all rather than a "Quota" heading over blanks, which would
  // read as "your quota is zero".
  return (
    <Show when={rows().length > 0}>
      <box>
        <text fg={theme().text}>
          <b>Quota</b>
        </text>
        <For each={rows()}>
          {(row) => (
            <text fg={color(row.tone)} selectable={false}>
              {row.text}
            </text>
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

  // order 150 puts Quota immediately after upstream's Context section (order 100)
  // and ahead of MCP/LSP/Todo/Files (200/300/400/500) — the two usage readouts read
  // as one group, which is the point of moving here.
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_ctx, props) {
        return (
          <View
            api={api}
            activeModel={activeModel}
            sessionID={props.session_id}
            snapshot={snapshot}
            onContext={onContext}
          />
        )
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
