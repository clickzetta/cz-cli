/** @jsxImportSource @opentui/solid */
// cz_change: surface an actionable remedy when the AI gateway refuses a call for
// billing or quota reasons. Classification and URL derivation live in
// gateway-prompt.ts; this file is only the UI, and exists separately because it
// must ship as raw .tsx (the host compiles it so solid binds to its own singleton
// — see tui-quota.tsx).
//
// Rendered IN PLACE OF the prompt (the `session_prompt` replace slot), not as a
// modal and not beside the prompt. A modal steals focus and has to be dismissed
// before the user can read the error or copy the request id; rendering beside the
// prompt leaves the textarea mounted and focused, so the digits and arrows this
// chooser needs would land in the message box instead. Replacing it is what
// opencode's own question flow does — see the slot registration below.
//
// Keys go through a keymap layer scoped to NOTICE_MODE rather than raw input, so
// every binding here — digits, arrows, return, escape — exists only while the
// chooser is up and is gone the moment it closes.
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createSignal, For, Show } from "solid-js"
import { spawn } from "node:child_process"
import {
  browserOpenCommandForPlatform,
  planGatewayNotice,
  provisionKeyForEntry,
  type ActiveModelContext,
  type GatewayNoticePlan,
} from "./tui-quota-runtime.js"

/**
 * Best-effort browser open. Failures are swallowed: the URL is in the notice text
 * the user just read, so they can open it by hand.
 */
function openBrowser(url: string) {
  const opener = browserOpenCommandForPlatform(process.platform, url)
  try {
    spawn(opener.command, opener.args, { detached: true, stdio: "ignore" })
      .once("error", () => {})
      .unref()
  } catch {
    // best-effort
  }
}

type Choice = { label: string }

/** The choices offered for a spent complimentary key, in display order. */
const CHOICES: readonly Choice[] = [
  { label: "Create a ClickZetta key & switch to it" },
  { label: "Use your own provider key" },
]

/**
 * The billing case: open the page, or don't.
 *
 * The negative is a real row rather than only `esc`, because a one-row list reads
 * as "this is the sole option" — and declining IS a normal answer here (the user
 * may already know the account is overdue, or not be the one who pays). Same
 * numbered shape as CHOICES so the two cases share one interaction vocabulary.
 */
const URL_CHOICES: readonly Choice[] = [{ label: "Open the billing page" }, { label: "Not now" }]

/**
 * What `cz-cli agent llm add` needs to be told, shown when the user picks their own
 * provider.
 *
 * Deliberately instructions rather than an in-TUI form: registering a provider
 * needs an npm package, a base URL and a model list, and the CLI already has the
 * validation and the per-provider defaults for all of it. Reimplementing that as
 * TUI prompts would be a second, weaker copy — so the notice hands over the exact
 * command instead and stays honest about the restart.
 */
function ownKeyInstructions() {
  return (
    "Register any provider with the CLI, then restart the agent:\n\n" +
    "  cz-cli agent llm add my-key --provider anthropic --api-key <API_KEY>\n" +
    "  cz-cli agent llm models my-key\n" +
    "  cz-cli agent llm use my-key/<MODEL_ID>\n\n" +
    "Providers: clickzetta, anthropic, openai, openai-compatible, google, azure,\n" +
    "openrouter. For an OpenAI-compatible relay add --base-url <URL>.\n\n" +
    "Run `cz-cli agent llm add --help` for the full option list."
  )
}

/**
 * Mint the user's own ClickZetta key into the exhausted entry, then make the
 * running session pick it up.
 *
 * Reusing the SAME entry name is what lets this be a single keypress: `config.model`
 * is `<entry>/<modelId>`, so the reference stays valid and the user's model
 * selection survives untouched — no re-pick, no /model round-trip.
 */
async function provisionKey(api: TuiPluginApi, entry: string, isClosed: () => boolean): Promise<boolean> {
  api.ui.toast({ variant: "info", message: "Creating API key..." })
  try {
    const result = await provisionKeyForEntry(entry, { signal: api.lifecycle.signal })
    // Dispose is the whole mechanism: providers are built when the instance starts,
    // so a rewritten llm.json is invisible until the instance is rebuilt. The TUI
    // re-syncs itself on `server.instance.disposed` (context/sync.tsx), and the
    // handler invalidates the cached global config first, so the rebuild reads the
    // new key. No explicit refresh call is needed — upstream's /connect only awaits
    // bootstrap because it must open a dialog once the data has landed.
    await api.client.instance.dispose()
    if (isClosed()) return true
    api.ui.toast({
      variant: "success",
      message: `Key "${result.alias}" is now active. Usage is billed to your account.`,
    })
    return true
  } catch (err) {
    // Teardown mid-flight aborts the in-progress request, so the rejection here is
    // the shutdown itself, not something the user should be told about — and the UI
    // it would render is already gone.
    if (isClosed() || api.lifecycle.signal.aborted) return false
    const reason = err instanceof Error ? err.message : String(err)
    api.ui.dialog.replace(() => (
      <api.ui.DialogAlert
        title="Could not create API key"
        message={
          `${reason}\n\n` +
          "You can create one manually:\n" +
          `  cz-cli ai-gateway key create ${entry} --add-to-llm ${entry}`
        }
      />
    ))
    return false
  }
}

/**
 * The chooser, shaped after opencode's own QuestionPrompt (routes/session/question
 * .tsx): a numbered list where the current row is highlighted, driven by
 * up/down + return with the digits as shortcuts.
 *
 * Deliberately the same shape as the native question UI — this appears in the same
 * place, for the same reason (the session is waiting on the user), so it should not
 * introduce a second interaction vocabulary.
 */
function NoticeChooser(props: {
  api: TuiPluginApi
  plan: () => GatewayNoticePlan | undefined
  selected: () => number
  busy: () => boolean
  onHover: (index: number) => void
  onPick: () => void
}) {
  const theme = () => props.api.theme.current
  const choices = () => (props.plan()?.action.kind === "provision-key" ? CHOICES : URL_CHOICES)

  return (
    <Show when={props.plan()}>
      {(current) => (
        <box
          backgroundColor={theme().backgroundPanel}
          border={["left"]}
          borderColor={theme().accent}
          flexShrink={0}
        >
          <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
            <box>
              <text fg={theme().warning} selectable={false}>
                {current().title}
              </text>
              <text fg={theme().text}>{current().message}</text>
            </box>
            <Show
              when={!props.busy()}
              fallback={
                <text fg={theme().textMuted} selectable={false}>
                  Creating API key...
                </text>
              }
            >
              <box>
                <For each={choices()}>
                  {(choice, index) => {
                    const active = () => index() === props.selected()
                    return (
                      <box
                        flexDirection="row"
                        onMouseOver={() => props.onHover(index())}
                        onMouseDown={() => props.onHover(index())}
                        onMouseUp={() => props.onPick()}
                      >
                        <box
                          backgroundColor={active() ? theme().backgroundElement : undefined}
                          paddingRight={1}
                        >
                          <text fg={active() ? theme().secondary : theme().textMuted}>{`${index() + 1}.`}</text>
                        </box>
                        <box backgroundColor={active() ? theme().backgroundElement : undefined}>
                          <text fg={active() ? theme().secondary : theme().text}>{choice.label}</text>
                        </box>
                      </box>
                    )
                  }}
                </For>
              </box>
              <text fg={theme().textMuted} selectable={false} wrapMode="none">
                ↑/↓ select · enter confirm · esc dismiss
              </text>
            </Show>
          </box>
        </box>
      )}
    </Show>
  )
}

/** Keys are scoped to this mode, so they cannot reach the prompt while typing. */
const NOTICE_MODE = "clickzetta-gateway-notice"

export function installGatewayPrompt(api: TuiPluginApi, activeModel: ActiveModelContext) {
  // One notice per session per gateway code. A session can emit session.error more
  // than once (each turn re-hits the same wall), and re-raising the chooser every
  // time would fight the user. Keyed by code so a session blocked by one condition
  // and later by another still gets the second notice.
  const prompted = new Set<string>()
  const [plan, setPlan] = createSignal<GatewayNoticePlan | undefined>(undefined)
  const [selected, setSelected] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  let promptKey: string | undefined
  let closed = false
  let popMode: (() => void) | undefined

  const count = () => (plan()?.action.kind === "provision-key" ? CHOICES.length : URL_CHOICES.length)
  const move = (delta: number) => setSelected((current) => (current + delta + count()) % count())

  /**
   * Take the chooser down, releasing the key scope with it.
   *
   * `forget` decides whether the offer can come back and MUST be called before
   * this, since clearing promptKey is what makes the guard unreachable.
   */
  const dismiss = () => {
    setPlan(undefined)
    setSelected(0)
    promptKey = undefined
    popMode?.()
    popMode = undefined
  }

  /**
   * Release the once-per-code guard so the next failed turn re-raises the chooser.
   * Without this a user who dismissed or hit an error would be left with a dead
   * session and no way back to the offer.
   */
  const forget = () => {
    if (promptKey) prompted.delete(promptKey)
  }

  /** Hand off to the CLI, which owns provider registration (see ownKeyInstructions). */
  const useOwnKey = () => {
    // Nothing has changed yet, so the next turn should still offer this.
    forget()
    dismiss()
    api.ui.dialog.replace(() => (
      <api.ui.DialogAlert title="Use your own provider key" message={ownKeyInstructions()} />
    ))
  }

  const createKey = (entry: string) => {
    const key = promptKey
    setBusy(true)
    void provisionKey(api, entry, () => closed).then((ok) => {
      setBusy(false)
      dismiss()
      // Success keeps the guard: the key is in place, so a later error is a
      // different condition and deserves its own notice.
      if (!ok && key) prompted.delete(key)
    })
  }

  const pick = () => {
    const current = plan()
    if (!current || busy()) return
    if (current.action.kind === "open-url") {
      // "Not now" is the same non-decision as esc: nothing was paid, so the next
      // failed turn should offer the page again rather than leave a dead session.
      if (selected() === 1) {
        forget()
        dismiss()
        return
      }
      openBrowser(current.action.url)
      dismiss()
      return
    }
    if (selected() === 1) {
      useOwnKey()
      return
    }
    // Left up while the key is minted so the "Creating API key..." state has
    // somewhere to render; createKey dismisses when it settles.
    createKey(current.action.entry)
  }

  // session_prompt is a REPLACE slot: returning content swaps out the prompt
  // entirely, returning null leaves the real one in place (verified in
  // @opentui/solid — replace falls back when no plugin produced output).
  //
  // This is the mechanism, not a detail. Rendering ALONGSIDE the prompt (e.g. in
  // app_bottom) leaves the textarea mounted and focused, so every keystroke —
  // including the digits and arrows this chooser wants — goes into the message box
  // instead. opencode's own question flow works the same way: `visible()` in
  // routes/session/index.tsx goes false while a question is pending, unmounting the
  // prompt rather than covering it.
  api.slots.register({
    order: 100,
    slots: {
      session_prompt() {
        if (!plan()) return null
        return (
          <NoticeChooser
            api={api}
            plan={plan}
            selected={selected}
            busy={busy}
            onHover={setSelected}
            onPick={pick}
          />
        )
      },
    },
  })

  // Bound once for the whole session, but scoped to NOTICE_MODE — the mode is only
  // pushed while the chooser is up, so these never shadow input the prompt should
  // get. This is how opencode's own QuestionPrompt keeps its digit shortcuts from
  // leaking (routes/session/question.tsx).
  const offKeys = api.keymap.registerLayer({
    mode: NOTICE_MODE,
    commands: [
      {
        name: "clickzetta.gateway_notice.pick",
        title: "Gateway notice: confirm choice",
        category: "ClickZetta",
        run: pick,
      },
      {
        name: "clickzetta.gateway_notice.dismiss",
        title: "Gateway notice: dismiss",
        category: "ClickZetta",
        run: () => {
          // Dismissing is not a decision, so the offer returns on the next failure.
          forget()
          dismiss()
        },
      },
    ],
    bindings: [
      { key: "up", desc: "Previous choice", group: "ClickZetta", cmd: () => move(-1) },
      { key: "k", desc: "Previous choice", group: "ClickZetta", cmd: () => move(-1) },
      { key: "down", desc: "Next choice", group: "ClickZetta", cmd: () => move(1) },
      { key: "j", desc: "Next choice", group: "ClickZetta", cmd: () => move(1) },
      // Digits jump straight to a row and take it, matching the numbering shown.
      { key: "1", desc: "First choice", group: "ClickZetta", cmd: () => { setSelected(0); pick() } },
      { key: "2", desc: "Second choice", group: "ClickZetta", cmd: () => { if (count() > 1) { setSelected(1); pick() } } },
      { key: "return", desc: "Confirm choice", group: "ClickZetta", cmd: "clickzetta.gateway_notice.pick" },
      { key: "escape", desc: "Dismiss the notice", group: "ClickZetta", cmd: "clickzetta.gateway_notice.dismiss" },
    ],
  })

  const off = api.event.on("session.error", (event) => {
    const sessionID = event.properties.sessionID
    const error = event.properties.error
    if (!error) return
    // The provider that actually served the failing turn, from the shared runtime
    // context — it names the llm.json entry whose key gets replaced.
    const activeProviderID = activeModel.providerID(sessionID ?? undefined)
    void planGatewayNotice(error, {
      signal: api.lifecycle.signal,
      ...(activeProviderID ? { activeProviderID } : {}),
    }).then((next) => {
      if (!next || closed) return
      const key = `${sessionID ?? ""}:${next.code}`
      if (prompted.has(key)) return
      prompted.add(key)
      promptKey = key
      setSelected(0)
      setPlan(next)
      // Push last: entering the mode is what arms the keys, so everything the
      // handlers read is already in place.
      popMode = api.mode.push(NOTICE_MODE)
    })
  })

  api.lifecycle.onDispose(() => {
    closed = true
    off()
    offKeys()
    popMode?.()
    popMode = undefined
    prompted.clear()
    setPlan(undefined)
  })
}

