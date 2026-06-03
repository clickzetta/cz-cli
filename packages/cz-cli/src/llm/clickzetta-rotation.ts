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
export const CLICKZETTA_ROTATION_PROMPT = "免费额度已用尽。是否用当前 profile 自动创建新的虚拟 key 并切换？"
export const CLICKZETTA_ROTATION_HEADER = "免费额度"
export const CLICKZETTA_ROTATION_CONFIRM_LABEL = "创建并切换"
export const CLICKZETTA_ROTATION_CANCEL_LABEL = "保持原样"

type Dict = Record<string, unknown>

type RotateOptions = {
  entryName?: string
  provider?: string
  status?: number
  detail?: string | null
  baseUrl?: string
  approval: "prompt" | "auto" | "never"
}

export type ClickZettaRotationResult = {
  rotated: true
  entryName: string
  alias: string
  apiKey: string
  sourceProfile: string
}

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

function clickzettaBaseUrl(base: string) {
  const trimmed = base.replace(/\/+$/, "")
  const withGateway = /\/gateway(\/|$)/.test(trimmed) ? trimmed : trimmed + "/gateway"
  return /\/v\d+(\/|$)/.test(withGateway) ? withGateway : withGateway + "/v1"
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

function currentClickzettaEntry() {
  const data = loadToml()
  if (typeof data.default_llm !== "string") return
  return readClickzettaEntry(data.default_llm, data)
}

function readClickzettaEntry(entryName: string, data = loadToml()) {
  const llm = isRecord(data.llm) ? data.llm : {}
  const rawEntry = llm[entryName]
  const entry = isRecord(rawEntry) ? rawEntry : undefined
  if (!entry || entry.provider !== "clickzetta" || typeof entry.api_key !== "string") return
  const boundSourceProfile = typeof entry.source_profile === "string" ? entry.source_profile : undefined
  const sourceProfile =
    boundSourceProfile
      ? boundSourceProfile
      : process.env.CZ_PROFILE || (typeof data.default_profile === "string" ? data.default_profile : "default")
  return {
    entryName,
    apiKey: entry.api_key,
    baseUrl: typeof entry.base_url === "string" ? entry.base_url : undefined,
    boundSourceProfile,
    sourceProfile,
  }
}

function writeRotatedKey(input: {
  entryName: string
  apiKey: string
  baseUrl?: string
  serviceBaseUrl: string
  sourceProfile: string
}) {
  const data = loadToml()
  const llm = isRecord(data.llm) ? data.llm : {}
  const rawExisting = llm[input.entryName]
  const existing: Dict = isRecord(rawExisting) ? rawExisting : {}
  llm[input.entryName] = {
    ...existing,
    provider: "clickzetta",
    api_key: input.apiKey,
    base_url:
      typeof existing.base_url === "string"
        ? existing.base_url
        : input.baseUrl ?? clickzettaBaseUrl(input.serviceBaseUrl),
    ...(typeof existing.source_profile === "string" ? { source_profile: existing.source_profile } : {}),
  }
  data.llm = llm
  saveToml(data)
  return input.entryName
}

async function rotateEntry(input: {
  entryName: string
  baseUrl?: string
  interactive: boolean
  sourceProfile: string
}) {
  const sc = await getGatewayContext({ profile: input.sourceProfile })
  const alias = randomAlias()
  const saveResp = await studioRequest<number>(sc, API.SAVE, {
    vApiKeyAlias: alias,
    rateLimitConfigs: { quota_total: DEFAULT_QUOTA_TOTAL },
  })
  const id = Number(saveResp.data)
  const keyResp = await studioRequest<string>(sc, `${API.GET}?id=${id}`, {})
  const apiKey = String(keyResp.data)
  const rotatedEntryName = writeRotatedKey({
    entryName: input.entryName,
    apiKey,
    baseUrl: input.baseUrl,
    serviceBaseUrl: sc.baseUrl,
    sourceProfile: input.sourceProfile,
  })
  if (input.interactive) prompts.log.success(`已切换到新的虚拟 key: ${alias} ([llm.${rotatedEntryName}])`)
  return {
    rotated: true,
    entryName: rotatedEntryName,
    alias,
    apiKey,
    sourceProfile: input.sourceProfile,
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
  entryName?: string
  baseUrl?: string
  interactive?: boolean
  sourceProfile?: string
}) {
  const current = input.entryName ? readClickzettaEntry(input.entryName) : currentClickzettaEntry()
  const entryName = input.entryName ?? current?.entryName
  if (!entryName) return
  const sourceProfile = input.sourceProfile ?? current?.sourceProfile
  if (!sourceProfile) return
  return rotateEntry({
    entryName,
    baseUrl: input.baseUrl ?? current?.baseUrl,
    interactive: input.interactive === true,
    sourceProfile,
  })
}

export async function maybeRotateExhaustedClickzettaLlm(input: RotateOptions) {
  if (!isClickzettaQuotaExhausted(input)) return
  if (!(await promptAllowed(input.approval))) return
  return rotateClickzettaLlm({
    entryName: input.entryName,
    baseUrl: input.baseUrl,
    interactive: input.approval === "prompt",
  })
}
