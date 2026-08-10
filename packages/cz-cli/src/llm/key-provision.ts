// cz_change: provision an AIGW virtual key and swap it into an EXISTING llm.json
// entry, in place — the remedy the TUI offers when a complimentary key is spent.
//
// Separate from commands/ai-gateway.ts because the prompt cannot call the yargs
// handlers (they own argv parsing, output formatting and process exit), and
// because it must be reachable from the pre-bundled tui-quota-runtime asset.
// The alias derivation is exported so `ai-gateway key` can name the same virtual
// key this flow would.
//
// Why in-place matters: the caller's `config.model` is `<entry>/<modelId>`, so
// reusing the entry name keeps that reference valid and the user's active model
// unchanged. A new entry name would orphan config.model and force a /model
// round-trip. This is the whole reason the TUI flow can be a single confirm.
import { getGatewayContext } from "../commands/studio-context.js"
import { aigwAdminHost } from "./clickzetta-gateway-host.js"
import { readLlmEntries, writeLlmEntries } from "./native-config.js"
import { studioRequest, type StudioConfig } from "@clickzetta/sdk"

const API = {
  SAVE: "/llm-gateway-admin/v2/virtual-key/save",
  GET: "/llm-gateway-admin/v2/virtual-key/getApiKey",
}

/** Matches `ai-gateway key create`'s default when no --period/--quota is given. */
const DEFAULT_QUOTA_TOTAL = 10000000

/**
 * The gateway alias for the key backing llm entry `entry`.
 *
 * Derived rather than asked: the TUI flow must not add an input step, and a
 * stable derivation makes `save` idempotent — re-running after a later
 * exhaustion updates the same virtual key instead of littering the tenant with
 * one alias per incident. Prefixed so it cannot collide with an alias the user
 * created by hand.
 *
 * Sanitized to the character set aliases are known to accept; an entry name is
 * user-chosen and may contain anything.
 */
export function gatewayAliasForEntry(entry: string): string {
  // Collapse runs so "a//b" yields one separator, not two, and trim the edges so
  // the alias never carries a leading/trailing dash.
  const safe = entry
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `cz-${safe || "agent"}`
}

export type KeyProvisionResult = {
  /** The llm.json entry whose api_key was replaced. */
  entry: string
  /** The gateway virtual-key alias that now backs it. */
  alias: string
  /** The gateway's numeric id for the virtual key. */
  id: number
}

/**
 * Create (or update) the virtual key for `entry` and write its value into that
 * entry's `api_key`, leaving `base_url`, the rest of the entry, and
 * `config.model` untouched.
 *
 * Uses the gateway's `save` endpoint, which upserts by alias — the same call
 * `ai-gateway key upsert` makes, deliberately NOT `create`'s
 * already-exists-is-an-error path, since re-provisioning the same entry must
 * succeed.
 *
 * Throws when the entry is absent (there is nothing to swap the key into) or
 * when any gateway call fails; callers surface the message.
 */
export async function provisionKeyForEntry(
  entry: string,
  options: { profile?: string; signal?: AbortSignal } = {},
): Promise<KeyProvisionResult> {
  const config = readLlmEntries()
  const existing = config.llm[entry]
  if (!existing) {
    throw new Error(`LLM entry '${entry}' is not configured, so there is no key to replace.`)
  }

  const alias = gatewayAliasForEntry(entry)
  // No profile is passed when the caller names none: getGatewayContext resolves it
  // through resolveConnectionConfig, which already honours CZ_PROFILE and falls back
  // to default_profile — so the key is minted on the tenant this process is actually
  // authenticated as. Re-deriving it here would be a second copy of that order.
  const ctx = await getGatewayContext(options.profile ? { profile: options.profile } : {})
  if (options.signal?.aborted) throw new Error("Cancelled")

  // GatewayContext IS a StudioConfig; only the host is overridden, since the admin
  // virtual-key routes live on one host per partition (see aigwAdminHost).
  const sc: StudioConfig = { ...ctx, baseUrl: aigwAdminHost(ctx.baseUrl) }

  const saveResp = await studioRequest<unknown>(sc, API.SAVE, {
    vApiKeyAlias: alias,
    rateLimitConfigs: { quota_total: DEFAULT_QUOTA_TOTAL },
  })
  const id = Number(saveResp.data)
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`Gateway did not return a virtual-key id for alias '${alias}'.`)
  }
  if (options.signal?.aborted) throw new Error("Cancelled")

  const keyResp = await studioRequest<string>(sc, `${API.GET}?id=${id}`, {})
  const vApiKey = keyResp.data ?? ""
  if (!vApiKey) throw new Error(`Gateway returned an empty key for alias '${alias}'.`)

  // Re-read: the gateway round-trip is slow enough that another process may have
  // rewritten llm.json meanwhile, and clobbering its edits would be worse than
  // losing this key (which is re-derivable from the alias).
  const latest = readLlmEntries()
  const target = latest.llm[entry]
  if (!target) {
    throw new Error(`LLM entry '${entry}' disappeared while the key was being created.`)
  }
  latest.llm[entry] = { ...target, api_key: vApiKey }
  writeLlmEntries({ llm: latest.llm })

  return { entry, alias, id }
}
