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
  profileInfo: () => ReturnType<typeof readProfileInfo>
  userName: () => { profile: string; name: string } | undefined
  onContext: (key: string) => void
}) {
  // profileInfo is an ACCESSOR over installQuotaIndicator's profileInfoSignal,
  // read here (`props.profileInfo()`) rather than passed as the resolved value
  // itself. readProfileInfo() does two-to-three synchronous
  // readFileSync+TOML-parse passes with no memoization of its own, so it must
  // not run on every render — but a signal update needs a live subscriber to
  // reach this component at all. Reading the accessor inside this createMemo IS
  // that subscription: when installQuotaIndicator's `load()` calls
  // `setProfileInfoSignal(...)` on a refresh, this memo re-runs and the new
  // value actually reaches the rendered rows — a bare `let` cache written from
  // outside any reactive scope would update in memory but never repaint,
  // since Solid has no way to know a plain mutation happened.
  //
  // userName arrives separately because OAuth profiles need a portal call for
  // it, and is tagged with the profile it was resolved for: if the active
  // profile changed since that fetch started, `resolved.profile !==
  // profileInfo.profile` drops the row rather than naming the CURRENT profile
  // with the PREVIOUS profile's user — a wrong person attached to the right
  // tenant is worse than a blank row.
  const profile = createMemo(() => {
    const info = props.profileInfo()
    if (!info) return undefined
    if (info.userName) return info
    const resolved = props.userName()
    return resolved?.profile === info.profile ? { ...info, userName: resolved.name } : info
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
  const [userName, setUserName] = createSignal<{ profile: string; name: string } | undefined>(undefined)
  // Deferred until the sidebar section first mounts, not fired at install: a
  // portal round-trip (token acquisition included) here would run on every TUI
  // startup for every user, including one who never opens the sidebar — the
  // OLD prompt-corner placement's only network work was fetchQuotaSnapshot,
  // which exits before touching a token for a foreign provider. Idempotent
  // (guarded by `started`) because the sidebar can mount more than once (the
  // ≥120-column toggle, or a resize across that threshold).
  let started = false
  // A signal, not a bare `let`: passing `readProfileInfo()` inline in JSX would
  // compile (babel-preset-solid) to a getter that re-invokes the call — and re-
  // runs the file I/O — on every read, but a bare `let` behind a plain function
  // prop has the opposite problem. `View`'s `profile` memo would read it once at
  // whatever moment it first runs and then never again, since a `let` mutation
  // is invisible to Solid's reactivity — `load()` below updating it on every
  // refresh would never reach the UI at all. Only a signal makes BOTH true at
  // once: the I/O happens on refresh, not on render, AND an update after that
  // refresh actually propagates.
  const [profileInfoSignal, setProfileInfoSignal] = createSignal<ReturnType<typeof readProfileInfo> | undefined>(
    undefined,
  )
  const activeProfileInfo = () => {
    // Latched on a DEFINED result, not on attempt: readProfileInfo() returning
    // undefined (no profile resolved yet) must not stick — the same "latch on
    // success" reasoning as startUserNameFetch's `started` below, otherwise a
    // first mount that resolves nothing means the Profile section is gone for
    // the rest of the session even once a profile becomes configured.
    if (profileInfoSignal() === undefined) setProfileInfoSignal(readProfileInfo())
    return profileInfoSignal()
  }
  const startUserNameFetch = () => {
    if (started) return
    started = true
    // Latched on SUCCESS, not on attempt: fetchProfileUserName swallows every
    // failure (portal blip, expired cookie, token acquisition) and returns
    // undefined, and the quota half of this sidebar self-heals on every
    // busy→idle edge (createQuotaController.refresh) while this fetch fires
    // only once per mount. Re-arming `started` on a resultless resolve lets the
    // NEXT mount (the same ≥120-column toggle/resize this guard is for) retry,
    // instead of the user row staying gone for the rest of the session after
    // one transient failure. Not re-arming when the signal is already aborted:
    // that means the sidebar is disposing, and firing another request into a
    // dead lifecycle would just be wasted work.
    void fetchProfileUserName({ signal: api.lifecycle.signal })
      .then((resolved) => {
        if (resolved) setUserName(resolved)
        else if (!api.lifecycle.signal.aborted) started = false
      })
      .catch(() => {
        // A missing user name costs one row, never the section.
        if (!api.lifecycle.signal.aborted) started = false
      })
  }

  const controller = createQuotaController({
    // Re-reads profileInfo on the SAME busy→idle edge as the balance, rather
    // than only once per process: fetchQuotaSnapshot resolves Profile.current()
    // fresh on every refresh, so if the two disagreed — default_profile
    // rewritten by `cz-cli profile use` in another terminal is the only trigger
    // today, since nothing in this process calls Profile.set() — the Profile
    // section would keep naming the OLD profile while the balance below it is
    // the new one's. This still respects the caching comment above: the I/O
    // moves from "every render" to "every refresh", which is the same cadence
    // fetchQuotaSnapshot already pays for the network call.
    load: () => {
      setProfileInfoSignal(readProfileInfo())
      return fetchQuotaSnapshot({
        providerID: activeModel.providerID(),
        signal: api.lifecycle.signal,
      })
    },
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
        startUserNameFetch()
        return (
          <View
            api={api}
            activeModel={activeModel}
            sessionID={props.session_id}
            snapshot={snapshot}
            profileInfo={activeProfileInfo}
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
