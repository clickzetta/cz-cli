/**
 * Read a virtual key's token quota off the AI gateway's response headers.
 *
 * Every `/gateway/v1/chat/completions` response — streamed or not — carries the
 * key's allowance for each configured period:
 *
 *   x-czgw-ratelimit-api-key-token-period:    PDO
 *   x-czgw-ratelimit-api-key-token-limit:     10000000
 *   x-czgw-ratelimit-api-key-token-used:      238
 *   x-czgw-ratelimit-api-key-token-remaining: 9999762
 *
 * This is the only quota source a plain API key can reach. The admin API
 * (`cz-cli ai-gateway key list`) reports the same numbers but needs a portal
 * token and the caller's ownership of the key, so it cannot answer "how much is
 * left on the key I am using right now".
 *
 * Two shapes to survive:
 *
 * 1. A key with several periods repeats all four headers, once per period. Both
 *    `Headers` and the AI SDK's `SharedV3Headers` (`Record<string, string>`)
 *    collapse duplicates into one comma-joined value, so the lists are zipped
 *    positionally — index i of each list describes the same period.
 * 2. The headers are absent on any error response, 429 included: a spent key
 *    reports its ceiling only through the error body, which gateway-error.ts
 *    already classifies. They are also absent on a 200 from a gateway that
 *    predates the feature — measured 2026-09-01, uat-aimesh sends them and
 *    cn-shanghai-alicloud-aimesh sends none even while enforcing a quota. So
 *    `undefined` here means "not reported", never "zero" and never "no limit".
 */

/** `x-czgw-ratelimit-<scope>-token-<field>`; scope is `api-key` on everything observed so far. */
const QUOTA_HEADER = /^x-czgw-ratelimit-(.+)-token-(period|limit|used|remaining)$/

/** The gateway's period codes, matching the admin API's quota_pdo/pwo/pmo/total fields. */
const PERIODS: Record<string, ClickzettaQuotaPeriod> = {
  PDO: "daily",
  PWO: "weekly",
  PMO: "monthly",
  PTO: "total",
}

export type ClickzettaQuotaPeriod = "daily" | "weekly" | "monthly" | "total"

export type ClickzettaQuota = {
  /** Which allowance this is — `undefined` when the gateway sent a code we don't know. */
  period?: ClickzettaQuotaPeriod
  /** The gateway's raw code (`PDO`, `PTO`, …), kept so an unmapped period is still reportable. */
  periodCode: string
  /** What the key is limited to, in tokens. */
  limit?: number
  /**
   * Tokens spent in this period. Counted as of when the request was admitted, so
   * the current call's own tokens are not included yet.
   */
  used?: number
  remaining?: number
  /** Which limiter the numbers came from; `api-key` for a virtual key's own allowance. */
  scope: string
}

/**
 * Both shapes a response's headers actually arrive in here: a `Headers` from fetch (the two
 * CLI call sites) and the AI SDK's `SharedV3Headers`, which is a plain `Record<string,
 * string>` (the provider). Not an array-valued record — node's raw-headers shape — because
 * nothing passes one, and carrying a branch for it meant carrying a test that only ever
 * proved the branch existed.
 */
type HeaderSource = Headers | Record<string, string | undefined>

/**
 * Parse every quota the headers report, one entry per period.
 *
 * Returns `undefined` when the response carried no quota headers at all, so a
 * caller can tell "the gateway said nothing" from "the gateway said zero".
 */
export function parseClickzettaQuota(headers: HeaderSource | undefined): ClickzettaQuota[] | undefined {
  if (!headers) return undefined

  // scope -> field -> per-period values
  const scopes = new Map<string, Map<string, string[]>>()
  for (const [name, value] of headerEntries(headers)) {
    const match = QUOTA_HEADER.exec(name.toLowerCase())
    if (!match || value === undefined) continue
    const fields = scopes.get(match[1]!) ?? new Map<string, string[]>()
    scopes.set(match[1]!, fields)
    // A repeated header is already comma-joined by the time it reaches us, in both source
    // shapes — so splitting on the comma is what turns one header into its per-period list.
    fields.set(
      match[2]!,
      (fields.get(match[2]!) ?? []).concat(value.split(",").map((part) => part.trim())),
    )
  }
  if (scopes.size === 0) return undefined

  const quotas = [...scopes].flatMap(([scope, fields]) => {
    const codes = fields.get("period") ?? []
    const count = Math.max(codes.length, ...["limit", "used", "remaining"].map((f) => fields.get(f)?.length ?? 0))
    return Array.from({ length: count }, (_, index) => {
      const periodCode = codes[index] ?? ""
      return {
        ...(PERIODS[periodCode.toUpperCase()] ? { period: PERIODS[periodCode.toUpperCase()] } : {}),
        periodCode,
        ...numeric(fields.get("limit")?.[index], "limit"),
        ...numeric(fields.get("used")?.[index], "used"),
        ...numeric(fields.get("remaining")?.[index], "remaining"),
        scope,
      }
    })
  })
  // All four headers present but empty-valued yields nothing worth reporting. `used`
  // counts: a reading that knows only the spend is still a reading, and
  // formatClickzettaQuota has a branch for exactly that shape.
  const reported = quotas.filter(
    (q) => q.periodCode !== "" || q.limit !== undefined || q.used !== undefined || q.remaining !== undefined,
  )
  return reported.length === 0 ? undefined : reported
}

/** One quota as a line a human reads: `total: 21,306,417 / 1,000,000,000 tokens (978,693,343 left)`. */
export function formatClickzettaQuota(quota: ClickzettaQuota) {
  const label = quota.period ?? (quota.periodCode || quota.scope)
  const spend =
    quota.used !== undefined && quota.limit !== undefined
      ? `${quota.used.toLocaleString("en-US")} / ${quota.limit.toLocaleString("en-US")} tokens`
      : quota.limit !== undefined
        ? `limit ${quota.limit.toLocaleString("en-US")} tokens`
        : quota.used !== undefined
          ? `${quota.used.toLocaleString("en-US")} tokens used`
          : "no numbers reported"
  if (quota.remaining === undefined) return `${label}: ${spend}`
  return `${label}: ${spend} (${quota.remaining.toLocaleString("en-US")} left)`
}

function headerEntries(headers: HeaderSource): Iterable<[string, string | undefined]> {
  if (typeof (headers as Headers).forEach === "function" && typeof (headers as Headers).get === "function") {
    const out: [string, string][] = []
    ;(headers as Headers).forEach((value, name) => out.push([name, value]))
    return out
  }
  return Object.entries(headers as Record<string, string | undefined>)
}

/** Return type is spelled out so a spread of the empty case keeps the field optional, not absent. */
function numeric(
  value: string | undefined,
  field: "limit" | "used" | "remaining",
): Partial<Pick<ClickzettaQuota, "limit" | "used" | "remaining">> {
  if (value === undefined || value === "") return {}
  const parsed = Number(value)
  return Number.isFinite(parsed) ? { [field]: parsed } : {}
}
