/** @jsxImportSource @opentui/solid */
// cz_change: offer a browser jump when the AI gateway refuses a call for billing
// or key-quota reasons — the two cases where a page exists that the user can act
// on. Classification and URL derivation live in gateway-prompt.ts; this file is
// only the dialog, and exists separately because it must ship as raw .tsx (the
// host compiles it so solid binds to its own singleton — see tui-quota.tsx).
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { spawn } from "node:child_process"
import {
  browserOpenCommandForPlatform,
  planGatewayPrompt,
  type GatewayPromptPlan,
} from "./tui-quota-runtime.js"

/**
 * Best-effort browser open. Failures are swallowed: the URL is in the dialog text
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

export function installGatewayPrompt(api: TuiPluginApi) {
  // One prompt per session per gateway code. A session can emit session.error
  // more than once (each turn re-hits the same wall), and re-opening the dialog
  // every time would trap the user in it. Keyed by code so a session blocked by
  // one condition and later by another still gets the second prompt.
  const prompted = new Set<string>()
  let closed = false

  // DialogConfirm focuses "confirm" by default and clears itself on either
  // choice, so Enter opens the page and esc dismisses — no extra wiring needed.
  const show = (plan: GatewayPromptPlan) => {
    if (closed) return
    api.ui.dialog.replace(() => (
      <api.ui.DialogConfirm title={plan.title} message={plan.message} onConfirm={() => openBrowser(plan.url)} />
    ))
  }

  const off = api.event.on("session.error", (event) => {
    const sessionID = event.properties.sessionID
    const error = event.properties.error
    if (!error) return
    void planGatewayPrompt(error, { signal: api.lifecycle.signal }).then((plan) => {
      if (!plan || closed) return
      const key = `${sessionID ?? ""}:${plan.code}`
      if (prompted.has(key)) return
      prompted.add(key)
      show(plan)
    })
  })

  api.lifecycle.onDispose(() => {
    closed = true
    off()
    prompted.clear()
  })
}
