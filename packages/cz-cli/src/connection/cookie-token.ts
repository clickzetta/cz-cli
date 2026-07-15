import { toServiceUrl, type AuthToken, type ConnectionConfig } from "@clickzetta/sdk"

function getHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
}

function cookieValue(cookie: string, name: string): string | undefined {
  const lowerName = name.toLowerCase()
  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.slice(0, part.indexOf("=")).toLowerCase() === lowerName)
  return match?.slice(match.indexOf("=") + 1)
}

/**
 * Cheap, synchronous check for whether a profile carries a cookie token, used by
 * credential guards that must not trigger the network instance-id resolution
 * that {@link getCookieToken} may perform. Mirrors the header/cookie parsing
 * getCookieToken uses so the two never disagree about "has a cookie token".
 */
export function hasCookieToken(config: ConnectionConfig): boolean {
  const cookie = getHeader(config.customHeaders, "Cookie") ?? ""
  return cookieValue(cookie, "X-ClickZetta-Token") !== undefined
}

function parseJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1]
  if (!payload) return {}
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

function numeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function resolveInstanceId(
  baseUrl: string,
  token: string,
  accountId: number,
  instanceName: string,
  customHeaders?: Record<string, string>,
): Promise<number> {
  const response = await fetch(`${baseUrl}/clickzetta-portal/service/serviceInstanceList?accountId=${accountId}`, {
    headers: { ...customHeaders, "x-clickzetta-token": token, Accept: "application/json" },
  })
  if (!response.ok) return 0
  const payload = await response.json() as { data?: Array<Record<string, unknown>> }
  const match = (payload.data ?? []).find((row) =>
    String(row.name ?? row.instanceName ?? "") === instanceName
    && numeric(row.serviceId ?? 1) === 1,
  )
  return numeric(match?.id ?? match?.instanceId)
}

/**
 * Resolve an {@link AuthToken} directly from a profile's `header.Cookie`
 * `X-ClickZetta-Token` value, skipping the `loginSingle` exchange entirely.
 * The cookie token is already the wire credential, so callers use it as-is.
 * Returns `undefined` when no cookie token is present so callers can fall
 * back to PAT / username-password login.
 *
 * Shared by the SQL path (`getExecContext`) and the studio/gateway/agent
 * paths (`getStudioContext` / `getGatewayContext`) so cookie auth behaves
 * identically across every Lakehouse command.
 */
export async function getCookieToken(config: ConnectionConfig): Promise<AuthToken | undefined> {
  const cookie = getHeader(config.customHeaders, "Cookie") ?? ""
  const token = cookieValue(cookie, "X-ClickZetta-Token")
  if (!token) return undefined
  const payload = parseJwtPayload(token)
  const userId = numeric(payload.userId ?? payload.user_id)
  const accountId = numeric(payload.accountId ?? payload.tenantId ?? payload.tenant_id)
  const exp = numeric(payload.exp)
  const instanceId = numeric(payload.instanceId ?? payload.instance_id)
    || numeric(getHeader(config.customHeaders, "Instanceid"))
    || await resolveInstanceId(toServiceUrl(config.service, config.protocol), token, accountId, config.instance, config.customHeaders)
  if (!instanceId) throw new Error(`Unable to resolve instance id for '${config.instance}' from cookie auth.`)
  return {
    token,
    instanceId,
    userId,
    expireTimeMs: exp ? Math.max(0, exp * 1000 - Date.now()) : 0,
    obtainedAt: Date.now(),
  }
}
