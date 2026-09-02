/**
 * Carry the header-reported quota from the process that sees it to the process
 * that shows it.
 *
 * Only this provider ever sees the gateway's response headers, and it runs inside
 * the opencode server. The sidebar indicator that displays the numbers runs in the
 * TUI process, and the TUI plugin API exposes no response-side hook — `chat.headers`
 * is outbound only, and the event bus carries a fixed set of server events with no
 * way to publish a new one. Nothing in the message surface carries it either:
 * opencode's processor hands `step-finish` metadata to Session.getUsage and then
 * drops it (packages/opencode/src/session/processor.ts).
 *
 * So the quota goes through a small file next to llm.json, and the reader is
 * triggered by an event that already exists — a `step-finish` part, one per LLM
 * request. Deliberately NOT an intrusive patch to upstream's processor: the
 * de-opencode invariant in packages/cz-cli/UPSTREAM-PATCHES.md is worth more than
 * saving this file.
 *
 * The file is a cache, never a source of truth: a miss, a stale entry, a corrupt
 * body or an unwritable home all mean "no header quota available", and the caller
 * falls back to what it showed before.
 */
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { ClickzettaQuota } from "./quota"

/** Same home resolution as cz-cli's own config readers, including the test override. */
function storePath() {
  return join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "gateway-quota.json")
}

export type GatewayQuotaEntry = {
  /** When these numbers were read off a response, epoch ms. */
  updated_at: number
  quotas: ClickzettaQuota[]
}

/**
 * Identify the (endpoint, credential) pair a reading belongs to.
 *
 * Keying on the endpoint alone is not enough — two llm.json entries routinely point
 * at the same gateway with different keys, and they would overwrite each other's
 * numbers. The key itself is hashed rather than stored: this file lives beside
 * llm.json, which holds the key in plaintext already, but that is no reason for a
 * second copy of it to exist.
 */
export function gatewayQuotaCacheKey(baseURL: string, apiKey: string) {
  return `${baseURL.replace(/\/+$/, "")}#${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`
}

/**
 * Record the quota just read from a response. Best-effort: a failure here must
 * never disturb the completion that produced it.
 *
 * Read-modify-write, so two servers finishing a request at the same instant can
 * lose one entry. The loser is restored by that key's next request, and the cost of
 * being wrong is one stale row in an ambient indicator — not worth a lock file.
 */
export function recordGatewayQuota(input: { baseURL: string; apiKey: string; quotas: ClickzettaQuota[] }) {
  const file = storePath()
  const now = Date.now()
  try {
    const entries = readStore(file)
    // Bound the file so it cannot grow across every endpoint and key the machine has ever
    // used. This is retention, not freshness — how old a reading may be before it stops
    // being SHOWN is the reader's call, and always far shorter than this window.
    for (const [key, entry] of Object.entries(entries)) {
      if (typeof entry?.updated_at !== "number" || now - entry.updated_at > RETENTION_MS) delete entries[key]
    }
    entries[gatewayQuotaCacheKey(input.baseURL, input.apiKey)] = { updated_at: now, quotas: input.quotas }
    const body = JSON.stringify({ entries }, null, 2)
    try {
      writeFileSync(file, body, "utf-8")
    } catch {
      // Only the first write of a fresh install needs the directory; paying mkdirSync on
      // every request to create something that already exists is a syscall per LLM call.
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, body, "utf-8")
    }
  } catch {
    // An unwritable home, a full disk, a racing writer: the indicator goes stale,
    // which is strictly better than failing the user's request over a cache write.
  }
}

/** How long an entry stays in the file at all. Bounds growth; see recordGatewayQuota. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The last quota recorded for this endpoint/key, with the timestamp it was taken at.
 *
 * Deliberately no freshness argument. Whether a reading is still worth showing is not one
 * question but several — a daily allowance stops being true at its reset, a lifetime one
 * never does — so the caller answers it with `updated_at` and the periods in hand. cz-cli's
 * reader does exactly that (see readHeaderQuota in tui-quota-data.ts). A `maxAgeMs` here
 * only ever duplicated the coarsest half of that decision, and once the reader took the
 * whole of it, nothing passed one.
 */
export function readGatewayQuota(input: { baseURL: string; apiKey: string }): GatewayQuotaEntry | undefined {
  const entry = readStore(storePath())[gatewayQuotaCacheKey(input.baseURL, input.apiKey)]
  if (!entry || !Array.isArray(entry.quotas) || entry.quotas.length === 0) return undefined
  if (typeof entry.updated_at !== "number") return undefined
  return entry
}

function readStore(file: string): Record<string, GatewayQuotaEntry> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"))
    if (!parsed || typeof parsed !== "object") return {}
    const entries = (parsed as { entries?: unknown }).entries
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) return {}
    return entries as Record<string, GatewayQuotaEntry>
  } catch {
    // Missing on first run, and a truncated body from an interrupted write reads the
    // same way — both mean "nothing cached", not an error worth surfacing.
    return {}
  }
}
