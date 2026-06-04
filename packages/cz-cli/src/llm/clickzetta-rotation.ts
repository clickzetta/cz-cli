import * as prompts from "@clack/prompts"
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"
import { studioRequest } from "@clickzetta/sdk"
import { getGatewayContext } from "../commands/studio-context.js"

const DEFAULT_QUOTA_TOTAL = 10000000
const API = {
  SAVE: "/llm-gateway-admin/v2/virtual-key/save",
  GET: "/llm-gateway-admin/v2/virtual-key/getApiKey",
}
const QUOTA_EXHAUSTED_PATTERN = /virtual key total quota exceeded/i
const ALIAS_PREFIX = "cz-code_auto_"
const ALIAS_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
export const CLICKZETTA_ROTATION_PROMPT = "Free quota exhausted. Create a new virtual key with the current profile and switch?"
export const CLICKZETTA_ROTATION_HEADER = "Quota"
export const CLICKZETTA_ROTATION_CONFIRM_LABEL = "Create & switch"
export const CLICKZETTA_ROTATION_CANCEL_LABEL = "Keep current"

type Dict = Record<string, unknown>

type RotateOptions = {
  provider?: string
  status?: number
  detail?: string | null
  approval: "prompt" | "auto" | "never"
}

export type ClickZettaRotationResult = {
  rotated: true
  entryName: string
  alias: string
  apiKey: string
  profile: string
}

export type RotationFailure = { failed: true; reason: string }

function profilesFile() {
  return join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "profiles.toml")
}

function isRecord(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function loadToml(): Dict {
  try {
    const parsed = parseToml(readFileSync(profilesFile(), "utf-8"))
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function saveToml(data: Dict) {
  const file = profilesFile()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + ".tmp." + Date.now()
  writeFileSync(tmp, stringifyToml(data) + "\n", { encoding: "utf-8", mode: 0o600 })
  renameSync(tmp, file)
  try {
    chmodSync(file, 0o600)
  } catch {}
}

export function inferAiGatewayUrl(profile: { service?: string; instance?: string }): string | undefined {
  if (!profile.service) return undefined
  const base = profile.service.replace(/\/+$/, "")
  if (/\/gateway(\/|$)/.test(base)) return base
  const host = base.replace(/^https?:\/\//, "").split("/")[0] ?? ""
  if (host.startsWith("uat-")) return "https://uat-aimesh.clickzetta.com"
  if (host.startsWith("dev-") || host.startsWith("localhost") || host.startsWith("0.0.0.0"))
    return "https://dev-aimesh.clickzetta.com"
  if (host.endsWith("singdata.com")) return "https://ap-southeast-1-aws-aimesh.api.singdata.com"
  if (host.endsWith("clickzetta-inc.com") || host.endsWith("kuaishou.com")) return base
  if (host.endsWith("clickzetta.com") && !host.includes(".api.clickzetta.com")) return base
  if (host.endsWith("clickzetta.com")) return "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com"
  return undefined
}

function randomAlias() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return ALIAS_PREFIX + Array.from(bytes, (byte) => ALIAS_ALPHABET[byte % ALIAS_ALPHABET.length]).join("")
}

function quotaExhausted(detail?: string | null) {
  return typeof detail === "string" && QUOTA_EXHAUSTED_PATTERN.test(detail)
}

function promptAllowed(approval: RotateOptions["approval"]) {
  if (approval === "auto") return Promise.resolve(true)
  if (approval === "never") return Promise.resolve(false)
  return prompts.confirm({ message: CLICKZETTA_ROTATION_PROMPT, initialValue: true }).then((result) => !prompts.isCancel(result) && result === true)
}

function resolveCurrentProfile(data: Dict): string {
  return process.env.CZ_PROFILE || (typeof data.default_profile === "string" ? data.default_profile : "default")
}

function getProfileEntry(data: Dict, profileName: string): Dict | undefined {
  const profiles = isRecord(data.profiles) ? data.profiles : {}
  const entry = profiles[profileName]
  return isRecord(entry) ? entry : undefined
}

function normalizeGatewayUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "")
  if (/\/gateway\/v\d+(\/|$)/.test(trimmed)) return trimmed
  if (/\/gateway(\/|$)/.test(trimmed)) return trimmed + "/v1"
  return trimmed + "/gateway/v1"
}

function resolveAiGatewayUrl(profileEntry: Dict | undefined): string | undefined {
  if (profileEntry && typeof profileEntry.ai_gateway_url === "string") return normalizeGatewayUrl(profileEntry.ai_gateway_url)
  if (!profileEntry) return undefined
  const inferred = inferAiGatewayUrl({
    service: typeof profileEntry.service === "string" ? profileEntry.service : undefined,
    instance: typeof profileEntry.instance === "string" ? profileEntry.instance : undefined,
  })
  return inferred ? normalizeGatewayUrl(inferred) : undefined
}

function currentClickzettaEntry() {
  const data = loadToml()
  const profile = resolveCurrentProfile(data)
  const profileEntry = getProfileEntry(data, profile)
  const aiGatewayUrl = resolveAiGatewayUrl(profileEntry)
  return { profile, baseUrl: aiGatewayUrl }
}

function writeRotatedKey(input: {
  apiKey: string
  baseUrl: string
  profile: string
}) {
  const data = loadToml()
  const llm = isRecord(data.llm) ? data.llm : {}
  let entryName = input.profile
  let seq = 1
  while (entryName in llm) {
    entryName = `${input.profile}_${seq}`
    seq++
  }
  llm[entryName] = {
    provider: "clickzetta",
    api_key: input.apiKey,
    base_url: input.baseUrl,
  }
  data.llm = llm
  data.default_llm = entryName
  saveToml(data)
  return entryName
}

async function rotateEntry(input: {
  baseUrl: string
  interactive: boolean
  profile: string
}) {
  const sc = await getGatewayContext({ profile: input.profile })
  const alias = randomAlias()
  const saveResp = await studioRequest<number>(sc, API.SAVE, {
    vApiKeyAlias: alias,
    rateLimitConfigs: { quota_total: DEFAULT_QUOTA_TOTAL },
  })
  const id = Number(saveResp.data)
  const keyResp = await studioRequest<string>(sc, `${API.GET}?id=${id}`, {})
  const apiKey = String(keyResp.data)
  const entryName = writeRotatedKey({
    apiKey,
    baseUrl: input.baseUrl,
    profile: input.profile,
  })
  if (input.interactive) prompts.log.success(`Switched to new virtual key: ${alias} ([llm.${entryName}])`)
  return {
    rotated: true,
    entryName,
    alias,
    apiKey,
    profile: input.profile,
  } satisfies ClickZettaRotationResult
}

export function isClickzettaQuotaExhausted(input: {
  provider?: string
  status?: number
  detail?: string | null
}) {
  return input.provider === "clickzetta" && input.status === 429 && quotaExhausted(input.detail)
}

export async function rotateClickzettaLlm(input: {
  baseUrl?: string
  interactive?: boolean
  profile?: string
}): Promise<ClickZettaRotationResult | RotationFailure | undefined> {
  const current = currentClickzettaEntry()
  const profile = input.profile ?? current.profile
  const baseUrl = input.baseUrl ?? current.baseUrl
  if (!baseUrl) return { failed: true, reason: "no ai_gateway_url configured in profile and could not infer from service URL" }
  try {
    return await rotateEntry({
      baseUrl,
      interactive: input.interactive === true,
      profile,
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    if (input.interactive) prompts.log.warn(`Key rotation failed: ${reason}`)
    return { failed: true, reason }
  }
}

export async function maybeRotateExhaustedClickzettaLlm(input: RotateOptions) {
  if (!isClickzettaQuotaExhausted(input)) return
  if (!(await promptAllowed(input.approval))) return
  return rotateClickzettaLlm({
    interactive: input.approval === "prompt",
  })
}
