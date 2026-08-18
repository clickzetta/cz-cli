/** @jsxImportSource @opentui/solid */
// Shows which profile the session is connected as, plus ClickZetta account
// balance + AI-gateway token quota, as "Profile" and "Quota" sections in the
// session sidebar, directly under "Context".
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
  fetchProfileUserName,
  fetchQuotaSnapshot,
  profileRows,
  quotaRows,
  readProfileInfo,
  type ActiveModelContext,
  type QuotaRow,
  type QuotaSnapshot,
} from "./tui-quota-runtime.js"

/** One sidebar section: a bold heading over labelled rows, matching upstream's. */
function Section(props: { api: TuiPluginApi; title: string; rows: () => QuotaRow[] }) {
  const theme = () => props.api.theme.current
  // No rows = nothing worth showing. Draw no section at all rather than a heading
  // over blanks, which for "Quota" would read as "your quota is zero".
  return (
    <Show when={props.rows().length > 0}>
      <box>
        <text fg={theme().text}>
          <b>{props.title}</b>
        </text>
        <For each={props.rows()}>
          {(row) => (
            <text fg={theme()[row.tone]} selectable={false}>
              {row.text}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

function View(props: {
  api: TuiPluginApi
  activeModel: ActiveModelContext
  sessionID: string
  snapshot: () => QuotaSnapshot | undefined
  userName: () => string | undefined
  onContext: (key: string) => void
}) {
  // Resolved once per mount, not live: readProfileInfo() is a plain file read with
  // no reactive dependency, so this memo only recomputes if props.userName() later
  // changes (the OAuth path below). A `cz-cli profile use` run in another shell —
  // or an in-process Profile.set(), which nothing under opencode-plugin calls today
  // — is picked up only if the sidebar section remounts, not while it stays open.
  // userName arrives separately because OAuth profiles need a portal call for it.
  const profile = createMemo(() => {
    const info = readProfileInfo()
    if (!info) return undefined
    return info.userName ? info : { ...info, userName: props.userName() }
  })
  const identityRows = createMemo(() => profileRows(profile()))
  const usageRows = createMemo(() => quotaRows(props.snapshot()))

  // The provider list arrives with sync, well after plugins load, and attributing
  // usage needs it. This effect lives in the slot component because that is the
  // only place with a reactive owner — plugin init runs outside any Solid root, so
  // an effect created there is never scheduled.
  createEffect(() => {
    props.onContext(`${props.sessionID}:${props.activeModel.providerID(props.sessionID) ?? ""}`)
  })

  return (
    <>
      <Section api={props.api} title="Profile" rows={identityRows} />
      <Section api={props.api} title="Quota" rows={usageRows} />
    </>
  )
}

export function installQuotaIndicator(api: TuiPluginApi, activeModel: ActiveModelContext) {
  const [snapshot, setSnapshot] = createSignal<QuotaSnapshot | undefined>(undefined)
  // Resolved once, unawaited: identity is fixed for the session, and the rest of
  // the Profile section is already on screen from profiles.toml without it.
  const [userName, setUserName] = createSignal<string | undefined>(undefined)
  void fetchProfileUserName({ signal: api.lifecycle.signal })
    .then((name) => {
      if (name) setUserName(name)
    })
    .catch(() => {
      // A missing user name costs one row, never the section.
    })

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
            userName={userName}
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
