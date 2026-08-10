/**
 * Print the gateway billing/quota dialogs exactly as the TUI will show them.
 *
 *   bun script/preview-gateway-prompt.ts
 *
 * The text and URLs come from the real planGatewayNotice, so this verifies the
 * shipped copy rather than a mockup of it. It also shows which conditions
 * deliberately produce NO dialog: a cycle cap no page can lift, a spent key
 * whose guidance is a set of commands, and anything the gateway gives no code for.
 *
 * A throwaway HOME keeps it off the developer's own profiles.toml; the portal is
 * never reachable here, so it exercises the offline fallback path (account name
 * read from the profile rather than getCurrentUser).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-prompt-preview-"))
mkdirSync(join(home, ".clickzetta"), { recursive: true })
writeFileSync(
  join(home, ".clickzetta", "profiles.toml"),
  [
    'default_profile = "demo"',
    "[profiles.demo]",
    'pat = "pat"',
    'service = "uat-api.clickzetta.com"',
    'account_name = "acme_corp"',
  ].join("\n"),
)
process.env.CLICKZETTA_TEST_HOME = home
delete process.env.CZ_PROFILE

const { planGatewayNotice, gatewayErrorFields } = await import("../src/opencode-plugin/gateway-prompt.js")
const { rewriteClickzettaGatewayError } = await import("../src/llm/gateway-error.js")
const gatewayFields = (e: unknown) => gatewayErrorFields(e)!

/** A session.error payload in the shape opencode publishes. */
function apiError(message: string, statusCode: number, responseBody?: string) {
  return { name: "APIError", data: { message, statusCode, responseBody, isRetryable: false } }
}

/** The live gateway's response for a key whose token allowance is spent. */
function liveKeyQuota(alias: string) {
  const message =
    "[G2] Too many request. path=/gateway/v1/chat/completions, requestId=423fb935050582439277183e1e9c8712, " +
    `virtualApiKeyAlias=${alias}, tenantId=1, detail=Virtual key total quota exceeded: limit is 10000000 tokens ` +
    `for virtual key '${alias}', current usage: 10081501 tokens`
  return apiError(message, 429, JSON.stringify({ error: { code: "GATEWAY_TOO_MANY_REQUESTS", message, source: "gateway" } }))
}

const CASES: Array<{ label: string; expect: "dialog" | "silent"; error: unknown }> = [
  {
    label: "tenant_overdue — unpaid charges block the tenant",
    expect: "dialog",
    error: apiError(
      "Request rejected",
      403,
      JSON.stringify({
        error: {
          code: "GATEWAY_TENANT_OVERDUE",
          message: "[G2] Tenant overdue. path=/v1/chat/completions, requestId=req-abc",
          source: "gateway",
          retry_history: null,
        },
      }),
    ),
  },
  {
    label: "tenant_over_quota — billing-cycle ceiling, paying would not lift it",
    expect: "silent",
    error: apiError(
      "blocked",
      403,
      JSON.stringify({ error: { code: "GATEWAY_TENANT_OVER_QUOTA", message: "[G2] Tenant over quota" } }),
    ),
  },
  {
    label: "upstream failure — not a billing condition at all",
    expect: "silent",
    error: apiError("[G2] all upstream failed. requestId=req-y", 502),
  },
  {
    // GATEWAY_TOO_MANY_REQUESTS is absent from the documented table; this payload
    // is verbatim from cn-shanghai with a spent complimentary key.
    label: "GATEWAY_TOO_MANY_REQUESTS — complimentary key spent",
    expect: "silent",
    error: liveKeyQuota("cz-code_auto_vmhmdkcc"),
  },
  {
    label: "GATEWAY_TOO_MANY_REQUESTS — user's own key spent",
    expect: "silent",
    error: liveKeyQuota("my_own_key"),
  },
]

const W = 78
const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"
const INV = "\x1b[7m"
const OFF = "\x1b[0m"

/** Pad to the frame width ignoring ANSI escapes, which have no printed width. */
function row(content: string, printed: number) {
  return `│ ${content}${" ".repeat(Math.max(0, W - 4 - printed))} │`
}

function wrap(text: string) {
  const out: string[] = []
  for (const paragraph of text.split("\n")) {
    let rest = paragraph
    while (rest.length > W - 4) {
      let cut = rest.lastIndexOf(" ", W - 4)
      if (cut < 24) cut = W - 4
      out.push(rest.slice(0, cut))
      rest = rest.slice(cut).trimStart()
    }
    out.push(rest)
  }
  return out
}

let failures = 0

for (const item of CASES) {
  const plan = await planGatewayNotice(item.error)
  const got = plan ? "dialog" : "silent"
  const ok = got === item.expect
  if (!ok) failures++

  console.log()
  console.log(`${DIM}── ${item.label}${OFF}`)
  console.log(`${DIM}   expected ${item.expect} · got ${got} ${ok ? "✓" : "✗ MISMATCH"}${OFF}`)

  if (!plan) {
    console.log(`   ${DIM}no dialog — the classifier's message is shown as-is:${OFF}`)
    const fields = gatewayFields(item.error)
    const rewrite = rewriteClickzettaGatewayError(fields)
    for (const line of wrap(rewrite?.message ?? fields.message)) {
      console.log(`   ${DIM}│${OFF} ${line}`)
    }
    continue
  }

  console.log("┌" + "─".repeat(W - 2) + "┐")
  console.log(row(`${BOLD}${plan.title}${OFF}${" ".repeat(Math.max(1, W - 4 - plan.title.length - 3))}${DIM}esc${OFF}`, W - 4))
  console.log(row("", 0))
  for (const line of wrap(plan.message)) console.log(row(line, line.length))
  console.log(row("", 0))
  console.log(row(`${" ".repeat(W - 4 - 17)}Cancel  ${INV} Confirm ${OFF}`, W - 4))
  console.log("└" + "─".repeat(W - 2) + "┘")
  console.log(`   ${DIM}code=${plan.code}  ·  Enter opens:${OFF}`)
  console.log(`   ${plan.url}`)
}

console.log()
if (failures > 0) {
  console.log(`${failures} case(s) did not match the expected outcome.`)
  process.exit(1)
}
console.log(`${DIM}All ${CASES.length} cases matched. Dialogs above are the shipped copy.${OFF}`)
