/**
 * instance.ts — port of cz-mcp-server/cz_mcp/handlers/instance_service.py
 *
 * Python → TS mapping:
 *   instance_service.py:10-29   service_csp_list           → serviceCspList
 *   instance_service.py:32-55   service_instance_list      → serviceInstanceList
 *   instance_service.py:58-76   service_region_list        → serviceRegionList
 *   instance_service.py:79-111  get_instance_by_csp_id     → getInstanceByCspId
 *   instance_service.py:114-120 get_instance_by_region_id  → getInstanceByRegionId
 */

import { logger } from "../logger.js"
import { readUrl, readApi } from "../utils/config.js"

// instance_service.py:10-29
export async function serviceCspList(
  jwt: string,
  env: string,
  workspaceName?: string,
): Promise<unknown[]> {
  const url = readUrl(env) + readApi("SERVICE_CSP_LIST")
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "X-Clickzetta-Token": String(jwt),
    "cz-lang": "zh_CN",
  }
  if (workspaceName) headers["workspaceName"] = workspaceName
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
  if (!resp.ok) {
    logger.error({ status: resp.status }, "Failed to fetch csp")
    throw new Error(`Failed to fetch service csp list: HTTP ${resp.status}`)
  }
  const data = await resp.json() as Record<string, unknown>
  return (data["data"] as unknown[]) ?? []
}

// instance_service.py:32-55
export async function serviceInstanceList(
  accountId: number,
  jwt: string,
  env: string,
  workspaceName?: string,
): Promise<unknown[]> {
  const url = readUrl(env) + readApi("SERVICE_INSTANCE_LIST")
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "X-Clickzetta-Token": String(jwt),
    "cz-lang": "zh_CN",
  }
  if (workspaceName) headers["workspaceName"] = workspaceName
  const resp = await fetch(`${url}?accountId=${accountId}`, { headers, signal: AbortSignal.timeout(10_000) })
  if (!resp.ok) {
    logger.error({ status: resp.status }, "Failed to fetch instance list")
    throw new Error(`Failed to fetch service instance list: HTTP ${resp.status}`)
  }
  const data = await resp.json() as Record<string, unknown>
  return (data["data"] as unknown[]) ?? []
}

// instance_service.py:58-76
export async function serviceRegionList(
  jwt: string,
  env: string,
  cspId: number,
): Promise<unknown[]> {
  const url = readUrl(env) + readApi("SERVICE_REGION_LIST")
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "X-Clickzetta-Token": String(jwt),
    "cz-lang": "zh_CN",
  }
  const resp = await fetch(`${url}?cspId=${cspId}`, { headers, signal: AbortSignal.timeout(10_000) })
  if (!resp.ok) {
    logger.error({ status: resp.status }, "Failed to fetch region list")
    throw new Error(`Failed to fetch service region list: HTTP ${resp.status}`)
  }
  const data = await resp.json() as Record<string, unknown>
  return (data["data"] as unknown[]) ?? []
}

// instance_service.py:79-111
export async function getInstanceByCspId(
  accountId: number,
  jwt: string,
  env: string,
  cspId: number,
): Promise<Record<string, unknown> | null> {
  const regions = await serviceRegionList(jwt, env, cspId)
  if (!regions.length) {
    logger.error({ cspId }, "No regions found")
    return null
  }
  const matchingRegion = regions.find(
    (r) => (r as Record<string, unknown>)["cregionId"] === env,
  ) as Record<string, unknown> | undefined
  if (!matchingRegion) {
    logger.error({ env, cspId }, "No region found with cregionId")
    return null
  }
  const regionId = matchingRegion["id"]
  if (!regionId) {
    logger.error({ matchingRegion }, "Region missing id field")
    return null
  }
  const instances = await serviceInstanceList(accountId, jwt, env)
  const found = instances.find(
    (i) => (i as Record<string, unknown>)["regionId"] === regionId,
  ) as Record<string, unknown> | undefined
  if (!found) {
    logger.error({ regionId }, "No instance found for region_id")
    return null
  }
  return found
}

// instance_service.py:114-120
export async function getInstanceByRegionId(
  accountId: number,
  jwt: string,
  env: string,
  regionId: number,
): Promise<Record<string, unknown> | null> {
  const instances = await serviceInstanceList(accountId, jwt, env)
  return (instances.find(
    (i) => (i as Record<string, unknown>)["regionId"] === regionId,
  ) as Record<string, unknown> | undefined) ?? null
}
