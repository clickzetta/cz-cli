import type { Argv } from "yargs"
import { createInterface } from "node:readline"
import { listUserWorkspaces, toServiceUrl } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { loadProfiles, saveProfiles, setTelemetry, type ProfileEntry } from "../connection/profile-store.js"

const REGISTER_URLS = [
  "https://accounts.clickzetta.com/register?ref=cz-cli",
  "https://accounts.singdata.com/register?ref=cz-cli",
]

const SERVICE_ENDPOINTS = [
  "cn-shanghai-alicloud.api.clickzetta.com",
  "cn-beijing-alicloud.api.clickzetta.com",
  "cn-hangzhou-alicloud.api.clickzetta.com",
  "ap-shanghai-tencentcloud.api.clickzetta.com",
  "ap-beijing-tencentcloud.api.clickzetta.com",
  "ap-guangzhou-tencentcloud.api.clickzetta.com",
  "cn-north-1-aws.api.clickzetta.com",
  "ap-southeast-1-alicloud.api.singdata.com",
  "ap-southeast-1-aws.api.singdata.com",
] as const

const OTHER_SERVICE = "__custom__"
const SETUP_FLOW = ["account_fields", "service", "instance", "workspace", "schema", "vcluster", "complete"] as const

interface SetupAuthContext {
  token: string
  userId: number
  tenantId: number
  username: string
  service: string
  serviceUrl: string
}

interface InstanceOption {
  label: string
  value: string
  instanceId: number
  instanceName: string
}

interface WorkspaceOption {
  label: string
  value: string
  workspaceId: number
  projectId: number
  workspaceName: string
}

interface NamedOption {
  label: string
  value: string
}

function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(true)
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() !== "n")
    })
  })
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function promptSelect(question: string, options: NamedOption[]): Promise<string> {
  process.stderr.write(`\n${question}\n`)
  options.forEach((option, index) => {
    process.stderr.write(`  ${index + 1}) ${option.label}\n`)
  })
  for (;;) {
    const answer = await prompt("Enter choice (number): ")
    const index = Number.parseInt(answer, 10) - 1
    if (index >= 0 && index < options.length) return options[index]!.value
    process.stderr.write("Invalid choice. Try again.\n")
  }
}

function decodeCredential(credential: string): Record<string, unknown> {
  const decoded = Buffer.from(credential, "base64").toString("utf-8")
  return JSON.parse(decoded) as Record<string, unknown>
}

function saveProfile(profileName: string, profile: ProfileEntry): void {
  const profiles = loadProfiles()
  if (profiles[profileName]) {
    throw new Error(`Profile '${profileName}' already exists. Use --name <other> or delete it first.`)
  }
  profiles[profileName] = profile
  saveProfiles(profiles)
}

function quoteShell(value: string): string {
  return JSON.stringify(value)
}

function buildSetupCommand(
  args: Record<string, string | undefined>,
  missingFlag?: string,
  placeholder?: string,
): string {
  const parts = ["cz-cli setup"]
  for (const [key, value] of Object.entries(args)) {
    if (!value) continue
    if (key === "password") {
      parts.push("--password <PASSWORD>")
      continue
    }
    parts.push(`--${key} ${quoteShell(value)}`)
  }
  if (missingFlag && placeholder) {
    parts.push(`--${missingFlag} ${placeholder}`)
  }
  return parts.join(" ")
}

function setupContext(argv: Record<string, unknown>) {
  return {
    username: setupValue(argv, "username") || undefined,
    password: setupValue(argv, "password") || undefined,
    accountName: setupValue(argv, "account-name") || undefined,
    service: setupValue(argv, "service") || undefined,
    instance: setupValue(argv, "instance") || undefined,
    workspace: setupValue(argv, "workspace") || undefined,
    schema: setupValue(argv, "schema") || undefined,
    vcluster: setupValue(argv, "vcluster") || undefined,
  }
}

function setupNeedsInput(
  format: string,
  step: string,
  message: string,
  required: string[],
  options?: NamedOption[],
  extra?: Record<string, unknown>,
): void {
  const payload = {
    step,
    status: "needs_input",
    required,
    flow: [...SETUP_FLOW],
    ...(options ? { options } : {}),
    ...extra,
  }
  error("SETUP_INPUT_REQUIRED", message, {
    format,
    extra: payload,
  })
}

function setupValue(argv: Record<string, unknown>, key: string): string {
  const direct = argv[key]
  if (typeof direct === "string") return direct.trim()
  const camel = key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
  const camelValue = argv[camel]
  return typeof camelValue === "string" ? camelValue.trim() : ""
}

function stripProtocol(value: string): string {
  return value.replace(/^https?:\/\//, "")
}

function extractRootDomain(host: string): string {
  for (const suffix of [".clickzetta.com", ".singdata.com", ".clickzetta-inc.com"]) {
    if (host.endsWith(suffix)) return suffix.slice(1)
  }
  const parts = host.split(".")
  return parts.length >= 2 ? parts.slice(-2).join(".") : host
}

function detectServiceEnv(host: string): string {
  const clean = stripProtocol(host)
  if (clean === "api.clickzetta.com" || clean === "api.singdata.com") return ""
  const match = clean.match(/^([^.]+)-api\./) ?? clean.match(/^([^.]+)\.api\./)
  return match?.[1] ?? ""
}

export function accountLoginUrlForService(service: string, accountName: string): string {
  const host = stripProtocol(service)
  const rootDomain = extractRootDomain(host)
  const env = detectServiceEnv(host)
  return env
    ? `https://${accountName}.${env}-accounts.${rootDomain}`
    : `https://${accountName}.accounts.${rootDomain}`
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split(".")
    if (parts.length < 2) return {}
    const padded = parts[1]! + "=".repeat((4 - (parts[1]!.length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

function coerceInt(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : 0
}

function extractJwtFromResponse(headers: Headers, payload: Record<string, unknown>): string {
  const data = (payload.data ?? {}) as Record<string, unknown>
  const setCookie = headers.get("set-cookie") || ""
  const cookieMatch = setCookie.match(/(?:X-ClickZetta-Token|x-clickzetta-token)=([^;]+)/)
  const token = [
    headers.get("x-refresh-jwt") || "",
    headers.get("x-clickzetta-token") || "",
    String(data.token ?? ""),
    String(data.jwt ?? ""),
    String(data.accessToken ?? ""),
    String(payload.token ?? ""),
    cookieMatch?.[1] ?? "",
  ].find((item) => item.trim())
  return token?.trim() ?? ""
}

async function loginWithExistingAccount(
  username: string,
  password: string,
  accountName: string,
  service: string,
): Promise<SetupAuthContext> {
  const loginUrl = `${accountLoginUrlForService(service, accountName)}/login`
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
    },
    body: JSON.stringify({ username, password, accountDisplayName: accountName }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    throw new Error(`ACCOUNT_LOGIN_FAILED: HTTP ${response.status}`)
  }
  const payload = await response.json() as Record<string, unknown>
  const code = String(payload.code ?? "")
  if (!["0", "200"].includes(code)) {
    throw new Error(`ACCOUNT_LOGIN_FAILED: ${String(payload.message ?? "login failed")}`)
  }
  const token = extractJwtFromResponse(response.headers, payload)
  if (!token) throw new Error("ACCOUNT_LOGIN_FAILED: token not found in login response")
  const data = (payload.data ?? {}) as Record<string, unknown>
  const jwt = decodeJwtPayload(token)
  const serviceUrl = toServiceUrl(stripProtocol(service))
  const tenantId = coerceInt(jwt.accountId ?? jwt.tenantId ?? data.accountId ?? data.tenantId)
  if (!tenantId) {
    throw new Error("ACCOUNT_LOGIN_FAILED: tenant/account id not found")
  }
  return {
    token,
    userId: coerceInt(jwt.userId ?? jwt.user_id ?? data.userId ?? data.id),
    tenantId,
    username: String(jwt.userName ?? data.username ?? username),
    service: stripProtocol(service),
    serviceUrl,
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`)
  }
  return await response.json() as Record<string, unknown>
}

function unwrapArray(payload: Record<string, unknown>): Record<string, unknown>[] {
  const data = payload.data ?? payload
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
  }
  if (data && typeof data === "object") {
    for (const key of ["records", "list", "items", "result"]) {
      const value = (data as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      }
    }
  }
  return []
}

function filterLakehouseInstances(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const filtered = rows.filter((row) => {
    const haystack = [
      row.serviceType,
      row.productType,
      row.instanceType,
      row.module,
      row.category,
      row.bizType,
      row.serviceName,
      row.productName,
      row.type,
    ]
      .map((value) => String(value ?? "").toLowerCase())
      .join(" ")
    return haystack.includes("lakehouse") || haystack.includes(" lh") || haystack.startsWith("lh")
  })
  return filtered.length > 0 ? filtered : rows
}

async function listInstances(auth: SetupAuthContext): Promise<InstanceOption[]> {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "X-Clickzetta-Token": auth.token,
    "cz-lang": "zh_CN",
  }
  const getUrl = `${auth.serviceUrl}/clickzetta-portal/service/serviceInstanceList?accountId=${auth.tenantId}`
  const postUrl = `${auth.serviceUrl}/clickzetta-portal/service/listInstances`
  let rows: Record<string, unknown>[] = []
  try {
    rows = filterLakehouseInstances(unwrapArray(await requestJson(getUrl, { method: "GET", headers })))
  } catch {
    rows = filterLakehouseInstances(unwrapArray(await requestJson(postUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId: auth.tenantId }),
    })))
  }
  return rows
    .map((row) => {
      const instanceId = coerceInt(row.instanceId ?? row.id)
      const instanceName = String(row.instanceName ?? row.name ?? "")
      return instanceId && instanceName
        ? {
            label: instanceName,
            value: instanceName,
            instanceId,
            instanceName,
          }
        : null
    })
    .filter((item): item is InstanceOption => item !== null)
    .sort((left, right) => left.instanceName.localeCompare(right.instanceName))
}

async function listWorkspaces(
  auth: SetupAuthContext,
  instance: InstanceOption,
): Promise<WorkspaceOption[]> {
  const rows = await listUserWorkspaces(
    auth.serviceUrl,
    auth.token,
    auth.userId,
    auth.tenantId,
    instance.instanceId,
    instance.instanceName,
  )
  return rows
    .map((row) => ({
      label: row.workspaceName,
      value: row.workspaceName,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      workspaceName: row.workspaceName,
    }))
    .sort((left, right) => left.workspaceName.localeCompare(right.workspaceName))
}

function studioHeaders(
  auth: SetupAuthContext,
  instance: InstanceOption,
  workspace?: WorkspaceOption,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "X-Clickzetta-Token": auth.token,
    "x-clickzetta-token": auth.token,
    userId: String(auth.userId),
    instanceId: String(instance.instanceId),
    accountId: String(auth.tenantId),
    tenantId: String(auth.tenantId),
    instanceName: instance.instanceName,
    ...(workspace ? {
      workspaceName: workspace.workspaceName,
      workspaceId: String(workspace.workspaceId),
      projectId: String(workspace.projectId),
    } : {}),
  }
}

async function listSchemas(
  auth: SetupAuthContext,
  instance: InstanceOption,
  workspace: WorkspaceOption,
): Promise<NamedOption[]> {
  const payload = await requestJson(
    `${auth.serviceUrl}/clickzetta-groot/api/v1/entity/centre/schema/list?env=PROD`,
    { method: "GET", headers: studioHeaders(auth, instance, workspace) },
  )
  return unwrapArray(payload)
    .map((row) => String(row.schemaName ?? row.name ?? row.schema ?? ""))
    .filter(Boolean)
    .map((name) => ({ label: name, value: name }))
    .sort((left, right) => left.value.localeCompare(right.value))
}

async function listVclusters(
  auth: SetupAuthContext,
  instance: InstanceOption,
  workspace: WorkspaceOption,
): Promise<NamedOption[]> {
  const headers = studioHeaders(auth, instance, workspace)
  const body = JSON.stringify({
    instanceId: instance.instanceId,
    workspaceId: String(workspace.workspaceId),
  })
  let payload: Record<string, unknown>
  try {
    payload = await requestJson(
      `${auth.serviceUrl}/clickzetta-lakeconsole/api/v1/vcluster/centre/list`,
      { method: "POST", headers, body },
    )
  } catch {
    payload = await requestJson(
      `${auth.serviceUrl}/clickzetta-lakeconsole/api/v1/vcluster/list`,
      { method: "POST", headers, body },
    )
  }
  return unwrapArray(payload)
    .map((row) => String(row.code ?? row.vcCode ?? row.name ?? row.vclusterName ?? ""))
    .filter(Boolean)
    .map((name) => ({ label: name, value: name }))
    .sort((left, right) => left.value.localeCompare(right.value))
}

function resolveOption<T extends NamedOption>(
  provided: string,
  options: T[],
  field: string,
): T {
  const option = options.find((item) => item.value === provided || item.label === provided)
  if (!option) {
    throw new Error(`Invalid ${field}: ${provided}`)
  }
  return option
}

async function chooseOptionTTY(question: string, options: NamedOption[], allowCustom = false): Promise<string> {
  const choices = allowCustom ? [...options, { label: "Other", value: OTHER_SERVICE }] : options
  const chosen = await promptSelect(question, choices)
  if (chosen === OTHER_SERVICE) return await prompt("Enter custom value: ")
  return chosen
}

async function runExistingAccountFlowTTY(
  profileName: string,
  format: string,
  argv: Record<string, unknown>,
): Promise<void> {
  const username = setupValue(argv, "username") || await prompt("Username: ")
  const password = setupValue(argv, "password") || await prompt("Password: ")
  const accountName = setupValue(argv, "account-name") || await prompt("Account name: ")
  const service = setupValue(argv, "service") || await chooseOptionTTY(
    "Choose service endpoint",
    SERVICE_ENDPOINTS.map((value) => ({ label: value, value })),
    true,
  )
  const auth = await loginWithExistingAccount(username, password, accountName, service)
  const instances = await listInstances(auth)
  if (instances.length === 0) {
    error("SETUP_DISCOVERY_FAILED", "No Lakehouse instances found under the selected service.", { format })
    return
  }
  const instanceName = setupValue(argv, "instance") || await chooseOptionTTY("Choose instance", instances)
  const instance = resolveOption(instanceName, instances, "instance")
  const workspaces = await listWorkspaces(auth, instance)
  if (workspaces.length === 0) {
    error("SETUP_DISCOVERY_FAILED", "No workspaces found under the selected instance.", { format })
    return
  }
  const workspaceName = setupValue(argv, "workspace") || await chooseOptionTTY("Choose workspace", workspaces)
  const workspace = resolveOption(workspaceName, workspaces, "workspace")
  const schemas = await listSchemas(auth, instance, workspace)
  const vclusters = await listVclusters(auth, instance, workspace)
  const schema = setupValue(argv, "schema") || (
    schemas.length ? await chooseOptionTTY("Choose schema", schemas, true) : await prompt("Schema: ")
  )
  const vcluster = setupValue(argv, "vcluster") || (
    vclusters.length ? await chooseOptionTTY("Choose vcluster", vclusters, true) : await prompt("Vcluster: ")
  )
  const profile: ProfileEntry = {
    username,
    password,
    service: stripProtocol(service),
    protocol: "https",
    instance: instance.instanceName,
    workspace: workspace.workspaceName,
    schema,
    vcluster,
  }
  saveProfile(profileName, profile)
  const telemetryEnabled = await askYesNo("Enable anonymous telemetry to help improve cz-cli? (Y/n) ")
  setTelemetry(telemetryEnabled)
  logOperation("setup", { ok: true })
  success({
    message: `Profile '${profileName}' created successfully.`,
    profile_name: profileName,
    instance: instance.instanceName,
    workspace: workspace.workspaceName,
    schema,
    vcluster,
  }, { format })
}

async function runExistingAccountFlowNonTTY(
  profileName: string,
  format: string,
  argv: Record<string, unknown>,
): Promise<void> {
  const context = setupContext(argv)
  const username = setupValue(argv, "username")
  const password = setupValue(argv, "password")
  const accountName = setupValue(argv, "account-name")
  if (!username || !password || !accountName) {
    setupNeedsInput(
      format,
      "account_fields",
      "Setup supports two paths: use --credential for a new user, or provide username, password, and account_name for an existing ClickZetta account.",
      ["username", "password", "account_name"],
      undefined,
      {
        register_urls: REGISTER_URLS,
        next_steps: [
          "cz-cli setup --credential <BASE64_CREDENTIAL>",
          buildSetupCommand(
            {
              username: context.username,
              password: context.password,
              "account-name": context.accountName,
            },
            "username",
            "<USERNAME>",
          ) + " --password <PASSWORD> --account-name <ACCOUNT_NAME>",
        ],
      },
    )
    return
  }
  const service = setupValue(argv, "service")
  if (!service) {
    setupNeedsInput(
      format,
      "service",
      "Choose a service endpoint. After that, cz-cli can log in and list available instances for you to choose from.",
      ["service"],
      [...SERVICE_ENDPOINTS.map((value) => ({ label: value, value })), { label: "Other", value: OTHER_SERVICE }],
      {
        collected: {
          username,
          account_name: accountName,
        },
        next_steps: [
          buildSetupCommand(
            {
              username,
              password,
              "account-name": accountName,
            },
            "service",
            "<SERVICE_ENDPOINT>",
          ),
        ],
      },
    )
    return
  }
  const auth = await loginWithExistingAccount(username, password, accountName, service)
  const instances = await listInstances(auth)
  if (instances.length === 0) {
    error("SETUP_DISCOVERY_FAILED", "No Lakehouse instances found under the selected service.", { format })
    return
  }
  const instanceName = setupValue(argv, "instance")
  const instance = instanceName
    ? resolveOption(instanceName, instances, "instance")
    : instances.length === 1
      ? instances[0]!
      : null
  if (!instance) {
    setupNeedsInput(format, "instance", "Choose an instance before continuing setup.", ["instance"], instances, {
      collected: {
        username,
        account_name: accountName,
        service: stripProtocol(service),
      },
      next_steps: [
        buildSetupCommand(
          {
            username,
            password,
            "account-name": accountName,
            service,
          },
          "instance",
          "<INSTANCE>",
        ),
      ],
    })
    return
  }
  const workspaces = await listWorkspaces(auth, instance)
  if (workspaces.length === 0) {
    error("SETUP_DISCOVERY_FAILED", "No workspaces found under the selected instance.", { format })
    return
  }
  const workspaceName = setupValue(argv, "workspace")
  const workspace = workspaceName
    ? resolveOption(workspaceName, workspaces, "workspace")
    : workspaces.length === 1
      ? workspaces[0]!
      : null
  if (!workspace) {
    setupNeedsInput(format, "workspace", "Choose a workspace before continuing setup.", ["workspace"], workspaces, {
      collected: {
        username,
        account_name: accountName,
        service: stripProtocol(service),
        instance: instance.instanceName,
      },
      next_steps: [
        buildSetupCommand(
          {
            username,
            password,
            "account-name": accountName,
            service,
            instance: instance.instanceName,
          },
          "workspace",
          "<WORKSPACE>",
        ),
      ],
    })
    return
  }
  const schemas = await listSchemas(auth, instance, workspace)
  const schemaValue = setupValue(argv, "schema")
  const schema = schemaValue || (schemas.length === 1 ? schemas[0]!.value : "")
  if (!schema) {
    setupNeedsInput(format, "schema", "Choose a schema before continuing setup.", ["schema"], schemas, {
      collected: {
        username,
        account_name: accountName,
        service: stripProtocol(service),
        instance: instance.instanceName,
        workspace: workspace.workspaceName,
      },
      next_steps: [
        buildSetupCommand(
          {
            username,
            password,
            "account-name": accountName,
            service,
            instance: instance.instanceName,
            workspace: workspace.workspaceName,
          },
          "schema",
          "<SCHEMA>",
        ),
      ],
    })
    return
  }
  const vclusters = await listVclusters(auth, instance, workspace)
  const vclusterValue = setupValue(argv, "vcluster")
  const vcluster = vclusterValue || (vclusters.length === 1 ? vclusters[0]!.value : "")
  if (!vcluster) {
    setupNeedsInput(format, "vcluster", "Choose a vcluster before continuing setup.", ["vcluster"], vclusters, {
      collected: {
        username,
        account_name: accountName,
        service: stripProtocol(service),
        instance: instance.instanceName,
        workspace: workspace.workspaceName,
        schema,
      },
      next_steps: [
        buildSetupCommand(
          {
            username,
            password,
            "account-name": accountName,
            service,
            instance: instance.instanceName,
            workspace: workspace.workspaceName,
            schema,
          },
          "vcluster",
          "<VCLUSTER>",
        ),
      ],
    })
    return
  }
  const profile: ProfileEntry = {
    username,
    password,
    service: stripProtocol(service),
    protocol: "https",
    instance: instance.instanceName,
    workspace: workspace.workspaceName,
    schema,
    vcluster,
  }
  saveProfile(profileName, profile)
  setTelemetry(true)
  logOperation("setup", { ok: true })
  success({
    message: `Profile '${profileName}' created successfully.`,
    step: "complete",
    profile_name: profileName,
    instance: instance.instanceName,
    workspace: workspace.workspaceName,
    schema,
    vcluster,
  }, { format })
}

/**
 * Top-level `setup` command — entry point for first-time configuration.
 */
export function registerSetupCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "setup",
    "Configure a ClickZetta profile for either a new user or an existing account",
    (yargs) =>
      yargs
        .option("credential", { type: "string", describe: "Base64-encoded registration credential" })
        .option("name", { type: "string", default: "default", describe: "Profile name to create" })
        .option("account-name", { type: "string", describe: "Account name for existing ClickZetta users" })
        .option("skip-verify", { type: "boolean", default: false, describe: "Skip connection verification" })
        .example(
          "$0 setup --credential <BASE64_CREDENTIAL>",
          "New user: create a profile directly from the registration credential",
        )
        .example(
          "$0 setup --username <USERNAME> --password <PASSWORD> --account-name <ACCOUNT_NAME> --service <SERVICE_ENDPOINT>",
          "Existing user: start with account login, then let cz-cli list instance/workspace/schema/vcluster step by step",
        )
        .epilogue(
          "Setup flows:\n" +
          "  New user:\n" +
          "    1. Register and get a base64 credential\n" +
          "    2. Run `cz-cli setup --credential <BASE64_CREDENTIAL>`\n\n" +
          "  Already have ClickZetta account:\n" +
          "    1. Provide username, password, and account name\n" +
          "    2. Choose a service endpoint\n" +
          "    3. cz-cli lists instance -> workspace -> schema -> vcluster\n" +
          "    4. Confirm selections and save the profile\n\n" +
          "  Non-TTY / agent mode:\n" +
          "    Re-run `cz-cli setup` with the fields requested in the JSON response until step=complete.",
        ),
    async (argv) => {
      const format = argv.output
      const profileName = argv.name as string
      if (argv.credential) {
        let cred: Record<string, unknown>
        try {
          cred = decodeCredential(argv.credential as string)
        } catch (e) {
          error("INVALID_CREDENTIAL", `Invalid base64 or JSON: ${e instanceof Error ? e.message : String(e)}`, { format })
          return
        }
        const instanceName = cred.instanceName as string | undefined
        const accessToken = cred.accessToken as string | undefined
        if (!instanceName || !accessToken) {
          error("INVALID_CREDENTIAL", "Missing required fields: instanceName, accessToken", { format })
          return
        }
        const profile: ProfileEntry = {
          instance: instanceName,
          workspace: (cred.workspaceName as string) ?? "default",
          schema: (cred.schema as string) ?? "public",
          vcluster: (cred.virtualCluster as string) ?? "default",
          pat: accessToken,
          service: (cred.service as string) ?? "dev-api.clickzetta.com",
          protocol: (cred.protocol as string) ?? "https",
        }
        try {
          saveProfile(profileName, profile)
        } catch (e) {
          error("PROFILE_EXISTS", e instanceof Error ? e.message : String(e), { format })
          return
        }

        const telemetryEnabled = await askYesNo("Enable telemetry to help improve cz-cli? This shares LLM call traces and tool execution data. No code content is collected. (Y/n) ")
        setTelemetry(telemetryEnabled)
        logOperation("setup", { ok: true })
        success({
          message: `Profile '${profileName}' created successfully.`,
          profile_name: profileName,
          instance: instanceName,
          workspace: profile.workspace,
          schema: profile.schema,
        }, { format })
        return
      }

      const rawArgv = argv as unknown as Record<string, unknown>
      if (!process.stdin.isTTY) {
        try {
          await runExistingAccountFlowNonTTY(profileName, format, rawArgv)
        } catch (e) {
          error("SETUP_FAILED", e instanceof Error ? e.message : String(e), { format })
        }
        return
      }

      const mode = await promptSelect("Choose setup mode", [
        { label: "New user", value: "new" },
        { label: "Already have ClickZetta account", value: "existing" },
      ])
      if (mode === "new") {
        process.stderr.write(`\nRegister at one of the following URLs:\n  - ${REGISTER_URLS[0]}\n  - ${REGISTER_URLS[1]}\n\n`)
        const credential = await prompt("Paste your base64 credential: ")
        if (!credential) {
          error("NO_CREDENTIAL", "No credential provided.", {
            format,
            extra: { register_urls: REGISTER_URLS, next_step: "cz-cli setup --credential <YOUR_CREDENTIAL>" },
          })
          return
        }
        let cred: Record<string, unknown>
        try {
          cred = decodeCredential(credential)
        } catch (e) {
          error("INVALID_CREDENTIAL", `Invalid base64 or JSON: ${e instanceof Error ? e.message : String(e)}`, { format })
          return
        }
        const instanceName = cred.instanceName as string | undefined
        const accessToken = cred.accessToken as string | undefined
        if (!instanceName || !accessToken) {
          error("INVALID_CREDENTIAL", "Missing required fields: instanceName, accessToken", { format })
          return
        }
        const profile: ProfileEntry = {
          instance: instanceName,
          workspace: (cred.workspaceName as string) ?? "default",
          schema: (cred.schema as string) ?? "public",
          vcluster: (cred.virtualCluster as string) ?? "default",
          pat: accessToken,
          service: (cred.service as string) ?? "dev-api.clickzetta.com",
          protocol: (cred.protocol as string) ?? "https",
        }
        try {
          saveProfile(profileName, profile)
        } catch (e) {
          error("PROFILE_EXISTS", e instanceof Error ? e.message : String(e), { format })
          return
        }
        const telemetryEnabled = await askYesNo("Enable anonymous telemetry to help improve cz-cli? (Y/n) ")
        setTelemetry(telemetryEnabled)
        logOperation("setup", { ok: true })
        success({
          message: `Profile '${profileName}' created successfully.`,
          profile_name: profileName,
          instance: instanceName,
          workspace: profile.workspace,
          schema: profile.schema,
        }, { format })
        return
      }

      process.stderr.write(
        "\nExisting account flow:\n" +
        "  1. Enter username, password, and account name\n" +
        "  2. Choose a service endpoint\n" +
        "  3. Choose instance -> workspace -> schema -> vcluster\n\n",
      )

      try {
        await runExistingAccountFlowTTY(profileName, format, rawArgv)
      } catch (e) {
        error("SETUP_FAILED", e instanceof Error ? e.message : String(e), { format })
      }
    },
  )
}
