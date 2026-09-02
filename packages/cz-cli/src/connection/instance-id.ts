import { requestRaw, type TokenSource } from "@clickzetta/sdk"
function numeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Resolve a Lakehouse instance id by name via `serviceInstanceList`.
 *
 * Single implementation shared by the cookie-token path and the studio /
 * gateway contexts — they used to carry two copies and only one of them
 * forwarded `customHeaders`, so cookie-authenticated profiles silently lost
 * their `Cookie` on the studio path.
 *
 * Returns `fallbackId` (default 0) when the instance cannot be resolved,
 * including on network errors: callers decide what a missing id means.
 */
export async function resolveInstanceIdByName(
  baseUrl: string,
  tokens: TokenSource,
  accountId: number,
  instanceName: string,
  opts?: {
    customHeaders?: Record<string, string>
    fallbackId?: number
    debug?: boolean
    /**
     * Called when the lookup FAILED, as opposed to succeeding with no match. Without it
     * both collapse into `fallbackId` and a caller cannot tell "this account does not have
     * that instance" from "the portal was unreachable" — so a transient blip silently
     * looked like a definitive answer.
     */
    onError?: (err: unknown) => void
    /**
     * Called when the lookup SUCCEEDED and no row matched the name. Distinct from onError
     * on purpose: "this account does not own an instance by that name" is a definitive
     * answer and the more serious one, while a failed request says nothing at all. Folding
     * both into `fallbackId` let the definitive case be the quiet one.
     */
    onNotFound?: () => void
  },
): Promise<number> {
  const fallbackId = opts?.fallbackId ?? 0
  try {
    // Goes through the SDK transport like every other authenticated call, so a
    // rejected credential rotates here instead of the request simply failing.
    // A failure that rotation cannot fix STILL degrades to `fallbackId` (the
    // catch below) — callers decide what a missing id means, and that contract
    // predates this change.
    const payload = await requestRaw<{ data?: Array<Record<string, unknown>> }>(
      { baseUrl, tokens, customHeaders: opts?.customHeaders },
      `/clickzetta-portal/service/serviceInstanceList?accountId=${accountId}`,
      undefined,
      "GET",
    )
    // serviceId 1 is the Lakehouse instance, which is the only kind a job can run on — so
    // narrowing here is right even though login-time discovery (login-browser.ts) lists every
    // instance: that enumeration builds the profile matrix, this resolves the id a JobID needs.
    const match = (payload.data ?? []).find((row) =>
      String(row.name ?? row.instanceName ?? "") === instanceName
      && numeric(row.serviceId ?? 1) === 1,
    )
    // Only "no row matched" is a statement about what the account owns. A row that matched
    // but carried no usable id is a malformed payload, and reporting THAT as not-owned would
    // hand the caller a definitive answer it has no basis for — the caller turns this into a
    // hard failure.
    if (!match) opts?.onNotFound?.()
    const resolved = numeric(match?.id ?? match?.instanceId)
    if (opts?.debug) {
      process.stderr.write(`[debug] resolveInstanceIdByName: name=${instanceName} matched=${resolved || "none"} fallback=${fallbackId}\n`)
    }
    return resolved || fallbackId
  } catch (err) {
    opts?.onError?.(err)
    return fallbackId
  }
}
