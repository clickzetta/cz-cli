/**
 * Which ClickZetta llm.json entry is the session's — the ONE answer to that question.
 *
 * It lived in the TUI plugin's data module until three copies of the same chain existed
 * (here, `ai-gateway quota`, and `resolveDefaultKey`) and two of them disagreed: this one
 * refuses to pick between several ClickZetta entries, the command guessed the first. So
 * `cz-cli ai-gateway quota` reported one tenant's allowance while the sidebar, looking at
 * the same llm.json, showed nothing — and a comment in the command claimed the two "never
 * disagree about the same key". They can only not disagree if they ask the same code.
 *
 * NOT the same question as `resolveDefaultKey` in commands/ai-gateway.ts, which picks *a*
 * key to authenticate an admin call with; any usable key does there. This picks *the*
 * key the session is spending, where guessing misreports whose quota the user is seeing.
 */
import { readLlmEntries } from "./native-config.js"

/**
 * Resolve which ClickZetta LLM entry the indicator should report on.
 *
 * LLM entries and connection Profiles are independent configuration domains.
 * This resolver only selects the LLM/API key; fetchQuotaSnapshot separately uses
 * Profiles as Portal credentials and never treats the entry name as a Profile.
 *
 * Candidates, most to least specific:
 *   1. `providerID` — what the TUI currently has selected, when known.
 *   2. `config.model`'s provider prefix — set by `cz-cli agent llm use`. Often
 *      absent: with no pinned model the TUI auto-selects, so this cannot be the
 *      only source or the indicator stays blank for everyone who never ran `use`.
 *   3. The sole ClickZetta entry, if there is exactly one. Unambiguous by
 *      definition; skipped when several exist rather than guessing a tenant.
 *
 * Returns undefined when nothing resolves to a ClickZetta entry (the user is on
 * anthropic/openai/…), which is the signal to render nothing at all.
 */
export function resolveClickzettaEntry(providerID?: string): { name: string; apiKey: string } | undefined {
  const resolved = classifyClickzettaEntry(providerID)
  return resolved.kind === "clickzetta" ? { name: resolved.name, apiKey: resolved.apiKey } : undefined
}

/**
 * Why this is a three-way answer and not `entry | undefined`.
 *
 * Cash balance belongs to the connection Profile; token quota belongs to the LLM
 * key. Collapsing "not a ClickZetta key" with "user is on another provider" into
 * one `undefined` made fetchQuotaSnapshot bail before it read profiles at all, so
 * ANY failure to pin an LLM entry also silently removed the cash balance — a
 * reading that never depended on the LLM entry in the first place.
 *
 *   - `clickzetta` — a specific ClickZetta key. Report balance and quota.
 *   - `foreign`    — the session is demonstrably on a non-ClickZetta provider
 *                    (anthropic/openai/…), or there is no ClickZetta entry at all.
 *                    Report nothing; a ¥ figure next to a Claude model would name
 *                    money that model is not spending. This is the case the
 *                    original `undefined` was meant for.
 *   - `ambiguous`  — this IS a ClickZetta user, but which key is in play cannot be
 *                    pinned (several entries, none selected or pinned; or the
 *                    matched entry carries no api_key). Report the balance, skip
 *                    the quota — guessing a tenant's key would misreport usage.
 */
export type ClickzettaEntryResolution =
  | { kind: "clickzetta"; name: string; apiKey: string; baseUrl?: string }
  | { kind: "foreign" }
  | { kind: "ambiguous" }

export function classifyClickzettaEntry(providerID?: string): ClickzettaEntryResolution {
  const { llm, model } = readLlmEntries()
  const isClickzetta = (name: string | undefined) => (name ? llm[name]?.provider === "clickzetta" : false)
  const usable = (name: string | undefined): ClickzettaEntryResolution | undefined => {
    if (!name) return undefined
    const entry = llm[name]
    if (entry?.provider !== "clickzetta") return undefined
    // A ClickZetta entry with no key is still a ClickZetta user — quota is
    // unknowable, the balance is not.
    if (!entry.api_key) return { kind: "ambiguous" }
    return { kind: "clickzetta", name, apiKey: entry.api_key, ...(entry.base_url ? { baseUrl: entry.base_url } : {}) }
  }

  const selected = usable(providerID)
  if (selected) return selected

  // An explicit selection that is not a ClickZetta entry ends the search: the
  // provider may come from environment/plugin discovery and need not appear in
  // llm.json, and falling through would report the sole ClickZetta key while the
  // prompt visibly names a different provider.
  if (providerID) return { kind: "foreign" }

  const configured = typeof model === "string" && model.includes("/") ? model.slice(0, model.indexOf("/")) : undefined
  const inferred = usable(configured)
  if (inferred) return inferred

  const clickzetta = Object.entries(llm).filter(([, entry]) => entry.provider === "clickzetta" && entry.api_key)
  if (clickzetta.length === 1) {
    const [name, entry] = clickzetta[0]!
    return { kind: "clickzetta", name, apiKey: entry.api_key!, ...(entry.base_url ? { baseUrl: entry.base_url } : {}) }
  }
  // Several ClickZetta entries and nothing to choose between them is ambiguous,
  // not foreign — as is a pinned model naming a ClickZetta entry we could not use.
  if (clickzetta.length > 1 || isClickzetta(configured)) return { kind: "ambiguous" }
  return { kind: "foreign" }
}
