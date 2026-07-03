import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import { studioRequest, request, type StudioConfig, type ApiResponse } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error, isHandledCliError } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getGatewayContext, type GatewayContext } from "./studio-context.js"
import { pinAlicloudAdminHost } from "../llm/clickzetta-rotation.js"

// ── AIGW admin API paths ────────────────────────────────────────────────────
// Portal-proxied endpoints (standard portal token auth):
const PORTAL_API = {
  LIST: "/clickzetta-portal/user/listApiKeys",   // GET, params: userName
  GET: "/clickzetta-portal/user/getApiKey",      // GET, params: userName, id
}
// Direct gateway-admin endpoints (require internal JWT — used for write ops once portal wrappers exist):
const API = {
  LIST: "/llm-gateway-admin/v2/virtual-key/listWithAuth",
  SAVE: "/llm-gateway-admin/v2/virtual-key/save",
  GET: "/llm-gateway-admin/v2/virtual-key/getApiKey",
  DELETE: "/llm-gateway-admin/v2/virtual-key/delete",
  UPDATE_STATUS: "/llm-gateway-admin/v2/virtual-key/updateStatus",
  MODEL_LIST: "/llm-gateway-admin/v2/model/list",
}

const PERIOD_TO_FIELD: Record<string, string> = {
  daily: "quota_pdo", weekly: "quota_pwo", monthly: "quota_pmo", total: "quota_total",
}
const FIELD_TO_PERIOD: Record<string, string> = {
  quota_pdo: "daily", quota_pwo: "weekly", quota_pmo: "monthly", quota_total: "total",
}
const DEFAULT_QUOTA_TOTAL = 10000000
const DEFAULT_MODEL_LIMIT = 10
const DEFAULT_MODEL_PAGE_SIZE = 200

type Dict = Record<string, unknown>
function isRecord(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

let _debug = false
export function setGatewayDebug(enabled: boolean) { _debug = enabled }

/** Wrapper around studioRequest that logs roundtrip details when --debug is active. */
async function gwRequest<T>(sc: StudioConfig, path: string, body: unknown): Promise<{ data: T; code: number | string; message?: string; count?: number }> {
  // Admin virtual-key routes only exist on the Shanghai alicloud portal; pin
  // the host there for alicloud regions while keeping the original token.
  const adminSc = { ...sc, baseUrl: pinAlicloudAdminHost(sc.baseUrl) }
  if (_debug) process.stderr.write(`[debug] → POST ${path} ${JSON.stringify(body)}\n`)
  const t0 = Date.now()
  const resp = await studioRequest<T>(adminSc, path, body)
  if (_debug) process.stderr.write(`[debug] ← ${Date.now() - t0}ms code=${resp.code} data=${JSON.stringify(resp.data)}\n`)
  return resp
}

/** Try to resolve a virtual key from the default_llm entry in profiles.toml (only if provider=clickzetta). */
function resolveDefaultKey(): string | undefined {
  const data = loadFullToml()
  const name = typeof data.default_llm === "string" ? data.default_llm : undefined
  if (!name) return undefined
  const llm = isRecord(data.llm) ? data.llm : {}
  const entry = isRecord(llm[name]) ? llm[name] : undefined
  if (!entry || entry.provider !== "clickzetta") return undefined
  return typeof entry.api_key === "string" ? entry.api_key : undefined
}

function reportError(err: unknown, format: string | undefined): void {
  if (isHandledCliError(err)) return
  error("GATEWAY_ERROR", err instanceof Error ? err.message : String(err), { format })
}

/** GET request to portal endpoints with standard portal token auth. */
async function portalGet<T>(sc: StudioConfig, path: string): Promise<ApiResponse<T>> {
  return request<T>(
    {
      baseUrl: sc.baseUrl,
      token: sc.token,
      customHeaders: {
        instanceName: sc.instanceName,
        userId: String(sc.userId),
        accountId: String(sc.tenantId),
        tenantId: String(sc.tenantId),
        instanceId: String(sc.instanceId),
        ...sc.customHeaders,
      },
    },
    path,
    undefined,
    "GET",
  )
}

/** Resolve a ref (alias or vApiKey) to its numeric id. Tries alias first, then key match. */
async function resolveKeyId(sc: GatewayContext, ref: string): Promise<number> {
  // Try by alias first
  const byAlias = await gwRequest<Dict[]>(sc, API.LIST, { pageIndex: 1, pageSize: 200, vApiKeyAlias: ref })
  const aliasList = Array.isArray(byAlias.data) ? byAlias.data : []
  const aliasMatch = aliasList.find((k) => (k.vApiKeyAlias ?? k.vapiKeyAlias) === ref)
  if (aliasMatch?.id != null) return Number(aliasMatch.id)
  // Fall back to key match
  const byKey = await gwRequest<Dict[]>(sc, API.LIST, { pageIndex: 1, pageSize: 200, vApiKey: ref })
  const keyList = Array.isArray(byKey.data) ? byKey.data : []
  const prefix = ref.slice(0, 4)
  const suffix = ref.slice(-4)
  const keyMatch = keyList.find((k) => {
    const masked = String(k.vApiKeyMasked ?? k.vApiKey ?? "")
    return masked.startsWith(prefix) && masked.endsWith(suffix)
  })
  if (keyMatch?.id != null) return Number(keyMatch.id)
  throw new Error(`Virtual key '${ref}' not found by alias or key value.`)
}

function normalizeKey(k: Dict): Dict {
  const quotas: Dict[] = []
  if (Array.isArray(k.rateLimitConfigs)) {
    for (const r of k.rateLimitConfigs as Dict[]) {
      quotas.push({ type: r.rateLimitType, limit: r.rateLimitValue, usage: r.currentUsage })
    }
  } else if (k.rateLimitType) {
    quotas.push({ type: k.rateLimitType, limit: k.rateLimitValue, usage: k.usage })
  }
  const routing = isRecord(k.routingRule) ? k.routingRule : undefined
  const alias = k.vapiKeyAlias ?? k.vApiKeyAlias
  const masked = k.vapiKeyMasked ?? k.vApiKeyMasked
  const routingOut: Dict | undefined = routing ? {
    routeType: routing.routeType ?? "default",
    ...(Array.isArray(routing.providerIds) && routing.providerIds.length > 0 ? { providerIds: routing.providerIds } : {}),
    ...(routing.privateKeyOnly ? { privateKeyOnly: true } : {}),
    ...(Array.isArray(routing.privateKeyAliases) && routing.privateKeyAliases.length > 0 ? { privateKeyAliases: routing.privateKeyAliases } : {}),
    ...(routing.providerSort ? { providerSort: routing.providerSort } : {}),
  } : undefined
  return {
    id: k.id,
    ...(alias ? { alias } : {}),
    ...(masked ? { vApiKey: masked } : {}),
    status: k.status === 1 ? "enabled" : k.status === 0 ? "disabled" : k.status,
    ...(k.type ? { type: k.type } : {}),
    ...(routingOut ? { routing: routingOut } : {}),
    ...(quotas.length > 0 ? { quotas } : {}),
  }
}

// ── --add-to-llm seam: write a [llm.<name>] entry into profiles.toml ────────
function profilesFile(): string {
  return join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "profiles.toml")
}
function loadFullToml(): Dict {
  try {
    return parseTOML(readFileSync(profilesFile(), "utf-8")) as Dict
  } catch {
    return {}
  }
}
function saveFullToml(data: Dict): void {
  const file = profilesFile()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + ".tmp." + Date.now()
  writeFileSync(tmp, stringifyTOML(data) + "\n", { encoding: "utf-8", mode: 0o600 })
  renameSync(tmp, file)
  try { chmodSync(file, 0o600) } catch {}
}

function aimeshEndpoint(base: string): string {
  const trimmed = base.replace(/\/+$/, "")
  // If already explicitly set to a gateway URL, preserve it
  if (/\/gateway(\/|$)/.test(trimmed)) return trimmed
  const host = trimmed.replace(/^https?:\/\//, "").split("/")[0] ?? ""
  if (host.startsWith("uat-")) return "https://uat-aimesh.clickzetta.com"
  if (host.startsWith("dev-") || host.startsWith("localhost") || host.startsWith("0.0.0.0"))
    return "https://dev-aimesh.clickzetta.com"
  if (host.endsWith("singdata.com")) return "https://ap-southeast-1-aws-aimesh.api.singdata.com"
  if (host.endsWith("clickzetta-inc.com") || host.endsWith("kuaishou.com")) return trimmed
  if (host.endsWith("clickzetta.com") && !host.includes(".api.clickzetta.com")) return trimmed
  if (host.endsWith("clickzetta.com")) return "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com"
  return trimmed
}

function addToLlm(
  name: string,
  apiKey: string,
  serviceBaseUrl: string,
  use: boolean,
): Dict {
  const data = loadFullToml()
  const llm = isRecord(data.llm) ? data.llm : {}
  const entries = Object.entries(llm).filter(([, v]) => isRecord(v)) as [string, Dict][]
  const defaultLlm = typeof data.default_llm === "string" ? data.default_llm : undefined
  const existing = isRecord(llm[name]) ? llm[name] : {}

  const profiles = isRecord(data.profiles) ? data.profiles : {}
  const currentProfile = process.env.CZ_PROFILE || (typeof data.default_profile === "string" ? data.default_profile : "default")
  const profileEntry = isRecord(profiles[currentProfile]) ? profiles[currentProfile] : undefined
  const profileAiGatewayUrl = profileEntry && typeof profileEntry.ai_gateway_url === "string" ? profileEntry.ai_gateway_url : undefined

  const reused = profileAiGatewayUrl
    ?? (defaultLlm &&
      isRecord(llm[defaultLlm]) &&
      (llm[defaultLlm] as Dict).provider === "clickzetta" &&
      typeof (llm[defaultLlm] as Dict).base_url === "string"
        ? (llm[defaultLlm] as Dict).base_url
        : entries
          .filter(([, v]) => v.provider === "clickzetta")
          .map(([, v]) => v.base_url)
          .find((b) => typeof b === "string")) as string | undefined
  const baseUrl = reused ?? aimeshEndpoint(serviceBaseUrl)
  const hadLlm = entries.length > 0
  llm[name] = {
    ...existing,
    provider: "clickzetta",
    api_key: apiKey,
    base_url: baseUrl,
  }
  data.llm = llm
  const makeDefault = !hadLlm || use
  if (makeDefault) data.default_llm = name
  saveFullToml(data)
  return { name, base_url: baseUrl, default_llm: makeDefault }
}

function removeFromLlm(apiKey: string): string | undefined {
  const data = loadFullToml()
  const llm = isRecord(data.llm) ? data.llm : {}
  const match = Object.entries(llm).find(([, v]) => isRecord(v) && v.api_key === apiKey)
  if (!match) return undefined
  const [name] = match
  delete llm[name]
  data.llm = llm
  if (data.default_llm === name) delete data.default_llm
  saveFullToml(data)
  return name
}

function findLlmByKey(apiKey: string): string | undefined {
  const data = loadFullToml()
  const llm = isRecord(data.llm) ? data.llm : {}
  const match = Object.entries(llm).find(([, v]) => isRecord(v) && v.api_key === apiKey)
  return match?.[0]
}

function buildRoutingRule(argv: Dict): Dict | undefined {
  const rt = argv.routeType as string | undefined
  if (!rt) return undefined
  if (rt === "provider") {
    if (!Array.isArray(argv.providers) || argv.providers.length === 0) {
      throw new Error("--route-type provider requires --providers <id...>")
    }
    return { routeType: rt, providerIds: argv.providers }
  }
  if (rt === "byok") {
    if (!Array.isArray(argv.privateKeys) || argv.privateKeys.length === 0) {
      throw new Error("--route-type byok requires --private-keys <alias...>")
    }
    return { routeType: rt, privateKeyOnly: true, privateKeyAliases: argv.privateKeys }
  }
  return { routeType: rt, providerSort: argv.providerSort }
}

export function registerGatewayCommand(cli: Argv<GlobalArgs>): void {
  cli.command("ai-gateway", "Manage ClickZetta AIGW virtual keys and list available models", (yargs) => {
    yargs
      .command("key", "Manage AIGW virtual keys", (k) => {
        k
          // ── list ───────────────────────────────────────────────────────
          .command(
            "list",
            "List AIGW virtual keys",
            (y) =>
              y
                .option("alias", { type: "string", describe: "Filter by AIGW virtual key alias (fuzzy)" })
                .option("key", { type: "string", describe: "Filter by exact vApiKey" })
                .option("status", {
                  type: "number",
                  choices: [0, 1] as const,
                  describe: "Filter by status (1=enabled, 0=disabled)",
                })
                .option("mine", { type: "boolean", describe: "Only keys created by the current user" })
                .option("reveal", { type: "boolean", describe: "Show plaintext key values (calls getApiKey for each)" })
                .option("page", { type: "number", default: 1, describe: "Page number" })
                .option("page-size", { type: "number", default: 200, describe: "Items per page" }),
            async (argv) => {
              const format = argv.format
              const t0 = Date.now()
              try {
                setGatewayDebug(!!argv.debug)
                const sc = await getGatewayContext(argv)
                const resp = await gwRequest<Dict>(sc, API.LIST, {
                  pageIndex: argv.page,
                  pageSize: argv["page-size"],
                  ...(argv.alias && { vApiKeyAlias: argv.alias }),
                  ...(argv.key && { vApiKey: argv.key }),
                  ...(argv.status != null && { status: argv.status }),
                  ...(argv.mine && { creator: Number(sc.userId) }),
                })
                const list = Array.isArray(resp.data) ? (resp.data as Dict[]) : []
                const rows = list.map(normalizeKey)
                if (argv.reveal) {
                  await Promise.all(
                    rows.map(async (row) => {
                      try {
                        const keyResp = await gwRequest<string>(sc, `${API.GET}?id=${row.id}`, {})
                        row.vApiKey = String(keyResp.data)
                      } catch {}
                    }),
                  )
                }
                const total = resp.count ?? rows.length
                logOperation("gateway key list", { ok: true, rows: rows.length, timeMs: Date.now() - t0 })
                const output = rows.map(({ id: _, ...rest }) => rest)
                success(output, {
                  format,
                  timeMs: Date.now() - t0,
                  aiMessage: `Page ${argv.page}, showing ${rows.length} of ${total} virtual keys.`,
                })
              } catch (err) {
                logOperation("gateway key list", { ok: false, timeMs: Date.now() - t0 })
                reportError(err, format)
              }
            },
          )
          // ── create ─────────────────────────────────────────────────────
          .command(
            "create <alias>",
            "Create an AIGW virtual key",
            (y) =>
              y
                .positional("alias", { type: "string", demandOption: true, describe: "AIGW virtual key alias" })
                .option("period", {
                  type: "string",
                  choices: ["daily", "weekly", "monthly", "total"] as const,
                  describe: "Quota period",
                })
                .option("quota", { type: "number", describe: "Quota value for the chosen period" })
                .option("route-type", {
                  type: "string",
                  choices: ["default", "provider", "byok"] as const,
                  describe: "Routing rule type",
                })
                .option("providers", {
                  type: "string",
                  array: true,
                  describe: "Ordered provider IDs (route-type=provider)",
                })
                .option("provider-sort", {
                  type: "string",
                  choices: ["price", "throughput", "latency"] as const,
                  describe: "Provider sort (route-type=default)",
                })
                .option("private-keys", {
                  type: "string",
                  array: true,
                  describe: "BYOK private key aliases (route-type=byok)",
                })
                .option("add-to-llm", {
                  type: "string",
                  describe: "Register the new key as a [llm.<name>] entry (defaults to alias)",
                })
                .option("use", { type: "boolean", describe: "Set the registered entry as default_llm" })
                .epilogue(
                  [
                    "Examples:",
                    "  cz-cli ai-gateway key create my-key",
                    "  cz-cli ai-gateway key create my-key --period total --quota 1000000",
                    "  cz-cli ai-gateway key create my-key --add-to-llm my-key --use",
                  ].join("\n"),
                ),
            async (argv) => {
              const format = argv.format
              const t0 = Date.now()
              try {
                const routingRule = buildRoutingRule(argv as Dict)
                setGatewayDebug(!!argv.debug)
                const sc = await getGatewayContext(argv)
                // Guard: reject if alias already exists
                const checkResp = await gwRequest<Dict[]>(sc, API.LIST, {
                  pageIndex: 1,
                  pageSize: 200,
                  vApiKeyAlias: argv.alias,
                })
                const existing = Array.isArray(checkResp.data) ? checkResp.data : []
                if (existing.some((k) => k.vApiKeyAlias === argv.alias)) {
                  throw new Error(
                    `Virtual key alias '${argv.alias}' already exists (id=${existing.find((k) => k.vApiKeyAlias === argv.alias)?.id}). Use a different alias.`,
                  )
                }
                const rateLimitConfigs =
                  argv.period && argv.quota != null
                    ? { [PERIOD_TO_FIELD[argv.period as string]]: argv.quota }
                    : { quota_total: DEFAULT_QUOTA_TOTAL }
                const saveResp = await gwRequest<unknown>(sc, API.SAVE, {
                  vApiKeyAlias: argv.alias,
                  ...(routingRule && { routingRule }),
                  rateLimitConfigs,
                })
                const id = Number(saveResp.data)
                const keyResp = await gwRequest<string>(sc, `${API.GET}?id=${id}`, {})
                const vApiKey = String(keyResp.data)

                const addName =
                  argv["add-to-llm"] === "" ? (argv.alias as string) : (argv["add-to-llm"] as string | undefined)
                const registered = addName ? addToLlm(addName, vApiKey, sc.baseUrl, !!argv.use) : undefined

                const aiMessage = registered
                  ? `Virtual key created and registered as [llm.${registered.name}]${registered.default_llm ? " (now default_llm)" : ""}.`
                  : `Virtual key created. To use it with the agent run: cz-cli agent llm add ${argv.alias} --provider clickzetta --api-key <vApiKey> --base-url ${aimeshEndpoint(sc.baseUrl)} --use`
                logOperation("gateway key create", { ok: true, timeMs: Date.now() - t0 })
                success(
                  { id, alias: argv.alias, vApiKey, ...(registered && { llm: registered }) },
                  { format, timeMs: Date.now() - t0, aiMessage },
                )
              } catch (err) {
                logOperation("gateway key create", { ok: false, timeMs: Date.now() - t0 })
                reportError(err, format)
              }
            },
          )
          // ── upsert ─────────────────────────────────────────────────────
          .command(
            "upsert <alias>",
            "Create or update an AIGW virtual key (idempotent)",
            (y) =>
              y
                .positional("alias", { type: "string", demandOption: true, describe: "AIGW virtual key alias" })
                .option("period", {
                  type: "string",
                  choices: ["daily", "weekly", "monthly", "total"] as const,
                  describe: "Quota period",
                })
                .option("quota", { type: "number", describe: "Quota value for the chosen period" })
                .option("route-type", {
                  type: "string",
                  choices: ["default", "provider", "byok"] as const,
                  describe: "Routing rule type",
                })
                .option("providers", {
                  type: "string",
                  array: true,
                  describe: "Ordered provider IDs (route-type=provider)",
                })
                .option("provider-sort", {
                  type: "string",
                  choices: ["price", "throughput", "latency"] as const,
                  describe: "Provider sort (route-type=default)",
                })
                .option("private-keys", {
                  type: "string",
                  array: true,
                  describe: "BYOK private key aliases (route-type=byok)",
                })
                .option("add-to-llm", {
                  type: "string",
                  describe: "Register the key as a [llm.<name>] entry (defaults to alias)",
                })
                .option("use", { type: "boolean", describe: "Set the registered entry as default_llm" }),
            async (argv) => {
              const format = argv.format
              const t0 = Date.now()
              try {
                const routingRule = buildRoutingRule(argv as Dict)
                setGatewayDebug(!!argv.debug)
                const sc = await getGatewayContext(argv)
                const rateLimitConfigs =
                  argv.period && argv.quota != null
                    ? { [PERIOD_TO_FIELD[argv.period as string]]: argv.quota }
                    : { quota_total: DEFAULT_QUOTA_TOTAL }
                const saveResp = await gwRequest<unknown>(sc, API.SAVE, {
                  vApiKeyAlias: argv.alias,
                  ...(routingRule && { routingRule }),
                  rateLimitConfigs,
                })
                const id = Number(saveResp.data)
                const keyResp = await gwRequest<string>(sc, `${API.GET}?id=${id}`, {})
                const vApiKey = String(keyResp.data)

                const addName =
                  argv["add-to-llm"] === "" ? (argv.alias as string) : (argv["add-to-llm"] as string | undefined)
                const registered = addName ? addToLlm(addName, vApiKey, sc.baseUrl, !!argv.use) : undefined

                logOperation("gateway key upsert", { ok: true, timeMs: Date.now() - t0 })
                success(
                  { id, alias: argv.alias, vApiKey, ...(registered ? { llm: registered } : {}) },
                  { format, timeMs: Date.now() - t0 },
                )
              } catch (err) {
                logOperation("gateway key upsert", { ok: false, timeMs: Date.now() - t0 })
                reportError(err, format)
              }
            },
          )
          // ── get ────────────────────────────────────────────────────────
          .command(
            "get <ref>",
            "Get an AIGW virtual key's plaintext value (by alias or key)",
            (y) =>
              y
                .positional("ref", { type: "string", demandOption: true, describe: "Alias or AIGW virtual key value" })
                .option("add-to-llm", { type: "string", describe: "Register as a [llm.<name>] entry" })
                .option("use", { type: "boolean", describe: "Set the registered entry as default_llm" }),
            async (argv) => {
              const format = argv.format
              const t0 = Date.now()
              try {
                setGatewayDebug(!!argv.debug)
                const sc = await getGatewayContext(argv)
                const id = await resolveKeyId(sc, argv.ref as string)
                const keyResp = await gwRequest<string>(sc, `${API.GET}?id=${id}`, {})
                const vApiKey = String(keyResp.data)
                const addName =
                  argv["add-to-llm"] === "" ? (argv.ref as string) : (argv["add-to-llm"] as string | undefined)
                const registered = addName ? addToLlm(addName, vApiKey, sc.baseUrl, !!argv.use) : undefined
                logOperation("gateway key get", { ok: true, timeMs: Date.now() - t0 })
                success(
                  { id, vApiKey, ...(registered ? { llm: registered } : {}) },
                  { format, timeMs: Date.now() - t0 },
                )
              } catch (err) {
                logOperation("gateway key get", { ok: false, timeMs: Date.now() - t0 })
                reportError(err, format)
              }
            },
          )
          // ── set-quota ──────────────────────────────────────────────────
          .command(
            "set-quota <ref>",
            "Set the token usage quota for an AIGW virtual key. Quota limits how many tokens the key can consume within the specified period. Once exceeded, requests are rejected until the period resets. (by alias or key value)",
            (y) =>
              y
                .positional("ref", { type: "string", demandOption: true, describe: "Virtual key alias or key value" })
                .option("period", {
                  type: "string",
                  choices: ["daily", "weekly", "monthly", "total"] as const,
                  demandOption: true,
                  describe: "Quota reset period (daily/weekly/monthly resets automatically; total is lifetime)",
                })
                .option("quota", {
                  type: "number",
                  demandOption: true,
                  describe: "Max tokens allowed in this period (e.g. 10000000 = 10M tokens)",
                }),
            async (argv) => {
              const format = argv.format
              const t0 = Date.now()
              try {
                setGatewayDebug(!!argv.debug)
                const sc = await getGatewayContext(argv)
                const id = await resolveKeyId(sc, argv.ref as string)
                await gwRequest<unknown>(sc, API.SAVE, {
                  id,
                  rateLimitConfigs: { [PERIOD_TO_FIELD[argv.period as string]]: argv.quota },
                })
                logOperation("gateway key set-quota", { ok: true, timeMs: Date.now() - t0 })
                success({ id, period: argv.period, quota: argv.quota }, { format, timeMs: Date.now() - t0 })
              } catch (err) {
                logOperation("gateway key set-quota", { ok: false, timeMs: Date.now() - t0 })
                reportError(err, format)
              }
            },
          )
          // ── enable / disable ───────────────────────────────────────────
          .command(
            "enable <ref>",
            "Enable an AIGW virtual key (by alias or key value)",
            (y) =>
              y.positional("ref", { type: "string", demandOption: true, describe: "Alias or AIGW virtual key value" }),
            (argv) => updateStatus(argv, 1),
          )
          .command(
            "disable <ref>",
            "Disable an AIGW virtual key (by alias or key value)",
            (y) =>
              y.positional("ref", { type: "string", demandOption: true, describe: "Alias or AIGW virtual key value" }),
            (argv) => updateStatus(argv, 0),
          )
          // ── delete ─────────────────────────────────────────────────────
          .command(
            "delete <ref>",
            "Delete an AIGW virtual key (by alias or key value). Requires -y to confirm.",
            (y) =>
              y
                .positional("ref", { type: "string", demandOption: true, describe: "Alias or AIGW virtual key value" })
                .option("yes", { alias: "y", type: "boolean", describe: "Skip confirmation" })
                .option("remove-from-llm", {
                  type: "boolean",
                  describe: "Also remove the matching [llm.*] entry from profiles.toml",
                }),
            async (argv) => {
              const format = argv.format
              const t0 = Date.now()
              try {
                setGatewayDebug(!!argv.debug)
                const sc = await getGatewayContext(argv)
                const id = await resolveKeyId(sc, argv.ref as string)
                if (!argv.yes) {
                  error(
                    "USAGE_ERROR",
                    `Refusing to delete key '${argv.ref}' (id=${id}) without confirmation. Pass -y to confirm deletion.`,
                    { format, exitCode: 2 },
                  )
                  return
                }
                await gwRequest<unknown>(sc, `${API.DELETE}?id=${id}`, {})
                const removedLlm = argv["remove-from-llm"] ? removeFromLlm(argv.ref as string) : undefined
                const linkedLlm = !removedLlm ? findLlmByKey(argv.ref as string) : undefined
                const aiMessage = removedLlm
                  ? `Virtual key deleted and [llm.${removedLlm}] removed from profiles.toml.`
                  : linkedLlm
                    ? `Virtual key deleted. Note: [llm.${linkedLlm}] in profiles.toml still references this key. Remove it with: cz-cli agent llm remove ${linkedLlm}`
                    : undefined
                logOperation("gateway key delete", { ok: true, timeMs: Date.now() - t0 })
                success(
                  { id, deleted: true, ...(removedLlm && { removed_llm: removedLlm }) },
                  { format, timeMs: Date.now() - t0, aiMessage },
                )
              } catch (err) {
                logOperation("gateway key delete", { ok: false, timeMs: Date.now() - t0 })
                reportError(err, format)
              }
            },
          )
        return commandGroup(k, "ai-gateway key")
      })
      // ── model list ───────────────────────────────────────────────────────
      .command("model", "Browse AIGW models", (m) => {
        m.command(
          "list [ref]",
          "List AIGW models available to a virtual key",
          (y) =>
            y
              .positional("ref", { type: "string", describe: "Virtual key value or alias (alias auto-resolves to key value)" })
              .option("page", { type: "number", default: 1, describe: "Page number" })
              .option("page-size", { type: "number", default: DEFAULT_MODEL_PAGE_SIZE, describe: "Items per page when --no-limit is used" })
              .option("limit", { type: "number", default: DEFAULT_MODEL_LIMIT, describe: "Max models to return. Use --limit N to adjust or --no-limit to remove the default cap." }),
          async (argv) => {
            const format = argv.format
            const t0 = Date.now()
            try {
              setGatewayDebug(!!argv.debug)
              const sc = await getGatewayContext(argv)
              let key = argv.ref ?? resolveDefaultKey()
              if (!key) {
                error("USAGE_ERROR", "No virtual key provided and no clickzetta LLM configured in profiles.toml. Usage: cz-cli ai-gateway model list <key-or-alias>", { format, exitCode: 2 })
                return
              }
              // If key looks like an alias (short, no dashes pattern of real keys), resolve to plaintext value
              if (!key.startsWith("ck-") && !key.includes("*") && key.length < 40) {
                try {
                  const id = await resolveKeyId(sc, key)
                  const keyResp = await gwRequest<string>(sc, `${API.GET}?id=${id}`, {})
                  key = String(keyResp.data)
                } catch {}
              }
              if (key.includes("*")) {
                error("USAGE_ERROR", "Masked key value detected (contains ****). Use the full plaintext key, or run `cz-cli ai-gateway key get <alias>` to reveal it.", { format, exitCode: 2 })
                return
              }
              const modelLimit = Number(argv.limit)
              const pageSize = modelLimit === 0 ? Number(argv["page-size"]) : modelLimit
              const resp = await gwRequest<unknown>(sc, API.MODEL_LIST, {
                virtualKey: key,
                pageIndex: argv.page,
                pageSize,
              })
              const raw = Array.isArray(resp.data) ? resp.data as Dict[] : []
              const models = raw.map((m) => ({
                modelIdentifier: m.modelIdentifier,
                modelName: m.modelName,
                modelDesc: m.modelDesc,
              }))
              const total = typeof resp.count === "number" ? resp.count : undefined
              const aiMessage = models.length === 0
                ? "No AIGW models returned. This usually means the virtual key VALUE is wrong (did you pass the alias by mistake?). Get the actual key value via: cz-cli ai-gateway key get <alias>"
                : total !== undefined && modelLimit !== 0 && total > models.length
                  ? `Showing ${models.length} of ${total} models. Use --limit to increase the cap, or --no-limit to remove the default cap.`
                  : undefined
              logOperation("gateway model list", { ok: true, timeMs: Date.now() - t0 })
              success(models, { format, timeMs: Date.now() - t0, aiMessage })
            } catch (err) {
              logOperation("gateway model list", { ok: false, timeMs: Date.now() - t0 })
              reportError(err, format)
            }
          },
        )
        return commandGroup(m, "ai-gateway model")
      })
    return commandGroup(yargs, "ai-gateway")
  })
}

async function updateStatus(argv: GlobalArgs & { ref?: string }, status: number): Promise<void> {
  const format = argv.format
  const t0 = Date.now()
  const op = status === 1 ? "gateway key enable" : "gateway key disable"
  try {
    setGatewayDebug(!!argv.debug)
    const sc = await getGatewayContext(argv)
    const id = await resolveKeyId(sc, argv.ref as string)
    await gwRequest<unknown>(sc, `${API.UPDATE_STATUS}?id=${id}&status=${status}`, {})
    logOperation(op, { ok: true, timeMs: Date.now() - t0 })
    success({ id, status: status === 1 ? "enabled" : "disabled" }, { format, timeMs: Date.now() - t0 })
  } catch (err) {
    logOperation(op, { ok: false, timeMs: Date.now() - t0 })
    reportError(err, format)
  }
}
