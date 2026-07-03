import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import os from "os"
import path from "path"
import readline from "readline"
import { xdgData } from "xdg-basedir"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import { createCli, registerSetupCommand } from "@clickzetta/cli"
import { upsertProvider, readLlmConfig } from "../../clickzetta/native-config"
import { cmd } from "./cmd"

export const SetupCommand = cmd({
  command: "setup",
  describe: "configure a ClickZetta or Singdata profile from a login page or JDBC connection string",
  builder: (yargs) =>
    yargs
      .usage("cz-cli setup")
      .option("credential", {
        type: "string",
        describe: "base64-encoded registration credential (compatibility path)",
      })
      .option("profile-name", {
        type: "string",
        describe: "profile name to write (default: 'default')",
        default: "default",
      })
      .example("cz-cli setup --login-method clickzetta", "start the ClickZetta login flow")
      .example("cz-cli setup --login-method custom --login <LOGIN_URL_OR_JDBC>", "use a custom login page URL or JDBC connection string")
      .example("cz-cli setup", "interactive setup (TTY only)"),
  handler: async (args) => {
    const argv: string[] = []
    if (args.credential) argv.push("--credential", args.credential)
    if (args["profile-name"] && args["profile-name"] !== "default")
      argv.push("--profile-name", args["profile-name"])
    await setup(argv)
  },
})

const CLICKZETTA_DIR = path.join(os.homedir(), ".clickzetta")
const PROFILES_PATH = path.join(CLICKZETTA_DIR, "profiles.toml")
// auth.json lives in the XDG data dir, same as Global.Path.data
const AUTH_PATH = path.join(xdgData ?? path.join(os.homedir(), ".local", "share"), "clickzetta", "auth.json")

interface Credential {
  instanceName?: string
  workspaceName?: string
  service?: string
  username?: string
  schema?: string
  virtualCluster?: string
  accessToken?: string
  apiKey?: string
  aimeshEndpointBaseUrl?: string
  analysisAgentEndpoint?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseCredential(base64: string): Credential {
  return JSON.parse(Buffer.from(base64, "base64").toString("utf-8"))
}

export function applyCredentialToProfiles(
  existing: Record<string, unknown>,
  cred: Credential,
  profileName: string,
): Record<string, unknown> {
  const profiles = isRecord(existing.profiles) ? { ...existing.profiles } : {}
  const currentProfile = isRecord(profiles[profileName]) ? { ...profiles[profileName] } : {}
  delete currentProfile.api_key
  delete currentProfile.aimesh_endpoint
  profiles[profileName] = {
    ...currentProfile,
    ...(cred.instanceName && { instance: cred.instanceName }),
    ...(cred.workspaceName && { workspace: cred.workspaceName }),
    ...(cred.schema && { schema: cred.schema }),
    ...(cred.virtualCluster && { vcluster: cred.virtualCluster }),
    ...(cred.accessToken && { pat: cred.accessToken }),
    ...(cred.service && { service: cred.service }),
    protocol: cred.service?.startsWith("http://") ? "http" : "https",
    ...(cred.username && { username: cred.username }),
    ...(typeof cred.analysisAgentEndpoint === "string" && { analysis_agent_endpoint: cred.analysisAgentEndpoint }),
    ...(cred.aimeshEndpointBaseUrl && { ai_gateway_url: cred.aimeshEndpointBaseUrl }),
  }

  const next = {
    ...existing,
    default_profile: profileName,
    profiles,
  }
  // cz_change: LLM provider config is written to native llm.json by writeProfile
  // via upsertProvider; this profile object holds connection fields only.
  return next
}

function writeProfile(cred: Credential, profileName: string): void {
  mkdirSync(CLICKZETTA_DIR, { recursive: true })

  let existing: Record<string, unknown> = {}
  if (existsSync(PROFILES_PATH)) {
    try { existing = parseTOML(readFileSync(PROFILES_PATH, "utf-8")) as Record<string, unknown> } catch {}
  }

  writeFileSync(PROFILES_PATH, stringifyTOML(applyCredentialToProfiles(existing, cred, profileName)))

  // cz_change: write the ClickZetta LLM provider into native llm.json.
  if (cred.apiKey || cred.aimeshEndpointBaseUrl) {
    const hadDefault = typeof readLlmConfig().model === "string"
    upsertProvider({
      name: profileName,
      provider: "clickzetta",
      apiKey: cred.apiKey ?? "",
      baseURL: cred.aimeshEndpointBaseUrl,
      setDefault: !hadDefault,
    })
  }
}

function writeAuth(apiKey: string): void {
  mkdirSync(path.dirname(AUTH_PATH), { recursive: true })
  let existing: Record<string, unknown> = {}
  if (existsSync(AUTH_PATH)) {
    try {
      existing = JSON.parse(readFileSync(AUTH_PATH, "utf-8"))
    } catch {}
  }
  existing["clickzetta"] = { type: "api", key: apiKey }
  writeFileSync(AUTH_PATH, JSON.stringify(existing, null, 2), { mode: 0o600 })
}

function writeTelemetry(enabled: boolean): void {
  mkdirSync(CLICKZETTA_DIR, { recursive: true })
  let existing: Record<string, unknown> = {}
  if (existsSync(PROFILES_PATH)) {
    try { existing = parseTOML(readFileSync(PROFILES_PATH, "utf-8")) as Record<string, unknown> } catch {}
  }
  existing.telemetry = enabled
  writeFileSync(PROFILES_PATH, stringifyTOML(existing))
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export async function setup(args: readonly string[]): Promise<never> {
  const normalized = args.flatMap((arg, index) => {
    if (arg !== "--profile-name") return [arg]
    if (index + 1 >= args.length) return ["--name"]
    return ["--name"]
  })
  const cli = createCli(["setup", ...normalized])
  registerSetupCommand(cli)
  await cli.demandCommand(1, "").help().parseAsync()
  process.exit(process.exitCode ?? 0)
}
