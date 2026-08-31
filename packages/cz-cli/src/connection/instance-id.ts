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
  opts?: { customHeaders?: Record<string, string>; fallbackId?: number; debug?: boolean },
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
    const match = (payload.data ?? []).find((row) =>
      String(row.name ?? row.instanceName ?? "") === instanceName
      && numeric(row.serviceId ?? 1) === 1,
    )
    const resolved = numeric(match?.id ?? match?.instanceId)
    if (opts?.debug) {
      process.stderr.write(`[debug] resolveInstanceIdByName: name=${instanceName} matched=${resolved || "none"} fallback=${fallbackId}\n`)
    }
    return resolved || fallbackId
  } catch {
    return fallbackId
  }
}
