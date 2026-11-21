import { requestRaw, type TokenSource } from "@clickzetta/sdk"
function numeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Is this `serviceId` a Lakehouse instance? Lakehouse is 1; every other value
 * names a product this CLI cannot connect to.
 *
 * An ABSENT value counts as Lakehouse. Older `serviceInstanceList` and userinfo
 * bodies omit the field entirely and only ever listed Lakehouse instances, so
 * treating absence as a mismatch would strand those accounts with no instance.
 *
 * The value is COERCED, not type-checked. The field arrives as a JSON number on
 * some routes and as a numeric string on others, and a `typeof === "number"`
 * test would fall through to the absent-value default and accept `"2"` as
 * Lakehouse — resolving not just the wrong instance but the wrong region gateway,
 * since callers read cspId/regionId off the row they picked.
 *
 * Exported so the userinfo path (oauth-userinfo.ts) and bootstrap's
 * `listInstances` filter apply the same judgement: they must agree about what is
 * connectable, or one of them generates a profile another cannot serve. setup.ts's
 * `filterLakehouseInstances` is deliberately NOT a caller — see the note on
 * `isLakehouseInstance` in oauth-userinfo.ts.
 */
export function isLakehouseServiceId(value: unknown): boolean {
  return numeric(value ?? 1) === 1
}

/**
 * Look up a Lakehouse instance id by name via `serviceInstanceList`.
 *
 * Single implementation shared by the cookie-token path and the studio /
 * gateway contexts — they used to carry two copies and only one of them
 * forwarded `customHeaders`, so cookie-authenticated profiles silently lost
 * their `Cookie` on the studio path.
 *
 * Returns `undefined` when the instance cannot be resolved, including on network errors.
 * Deliberately no `fallbackId` parameter: this is a lookup, not a decision, and a caller
 * that wants a number no matter what would be asking it to invent one. Whether a missing
 * id is fatal belongs to the caller — see resolveInstance in context.ts, which is the only
 * place that decides.
 */
export async function resolveInstanceIdByName(
  baseUrl: string,
  tokens: TokenSource,
  accountId: number,
  instanceName: string,
  opts?: {
    customHeaders?: Record<string, string>
    debug?: boolean
    /**
     * Called when the lookup FAILED, as opposed to succeeding with no match. Without it both
     * collapse into `undefined` and a caller cannot tell "this account does not have that
     * instance" from "the portal was unreachable" — so a transient blip would read as a
     * definitive answer.
     */
    onError?: (err: unknown) => void
    /**
     * Called when the lookup SUCCEEDED and no row matched the name. Distinct from onError on
     * purpose: "this account does not own an instance by that name" is a definitive answer
     * and the more serious one, while a failed request says nothing at all.
     */
    onNotFound?: () => void
  },
): Promise<number | undefined> {
  try {
    // Goes through the SDK transport like every other authenticated call, so a
    // rejected credential rotates here instead of the request simply failing.
    // A failure that rotation cannot fix STILL returns `undefined` (the catch below) —
    // callers decide what a missing id means.
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
      && isLakehouseServiceId(row.serviceId),
    )
    // Only "no row matched" is a statement about what the account owns. A row that matched
    // but carried no usable id is a malformed payload, and reporting THAT as not-owned would
    // hand the caller a definitive answer it has no basis for — the caller turns this into a
    // hard failure.
    if (!match) opts?.onNotFound?.()
    const resolved = numeric(match?.id ?? match?.instanceId)
    if (opts?.debug) {
      process.stderr.write(`[debug] resolveInstanceIdByName: name=${instanceName} matched=${resolved || "none"}\n`)
    }
    return resolved || undefined
  } catch (err) {
    opts?.onError?.(err)
    return undefined
  }
}
