import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import os from "os"
import path from "path"
import readline from "readline"
import { xdgData } from "xdg-basedir"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import { cmd } from "./cmd"

export const SetupCommand = cmd({
  command: "setup",
  describe: "configure ClickZetta profile from a registration credential",
  builder: (yargs) =>
    yargs
      .usage("cz-cli setup")
      .option("credential", {
        type: "string",
        describe: "base64-encoded credential string from the registration page",
      })
      .option("profile-name", {
        type: "string",
        describe: "profile name to write (default: 'default')",
        default: "default",
      })
      .example("cz-cli setup --credential <base64>", "configure from registration token")
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
}

function parseCredential(base64: string): Credential {
  return JSON.parse(Buffer.from(base64, "base64").toString("utf-8"))
}

function writeProfile(cred: Credential, profileName: string): void {
  mkdirSync(CLICKZETTA_DIR, { recursive: true })

  let existing: Record<string, unknown> = {}
  if (existsSync(PROFILES_PATH)) {
    try { existing = parseTOML(readFileSync(PROFILES_PATH, "utf-8")) as Record<string, unknown> } catch {}
  }

  const profiles = ((existing.profiles ?? {}) as Record<string, Record<string, unknown>>)
  profiles[profileName] = {
    ...(cred.instanceName && { instance: cred.instanceName }),
    ...(cred.workspaceName && { workspace: cred.workspaceName }),
    ...(cred.schema && { schema: cred.schema }),
    ...(cred.virtualCluster && { vcluster: cred.virtualCluster }),
    ...(cred.accessToken && { pat: cred.accessToken }),
    ...(cred.service && { service: cred.service }),
    protocol: cred.service?.startsWith("https") ? "https" : "http",
    ...(cred.username && { username: cred.username }),
    ...(cred.apiKey && { api_key: cred.apiKey }),
    ...(cred.aimeshEndpointBaseUrl && { aimesh_endpoint: cred.aimeshEndpointBaseUrl }),
  }

  existing.default_profile = profileName
  existing.profiles = profiles
  writeFileSync(PROFILES_PATH, stringifyTOML(existing))
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
  const credIdx = args.indexOf("--credential")
  const nameIdx = args.indexOf("--profile-name")
  const profileName = nameIdx >= 0 && nameIdx + 1 < args.length ? args[nameIdx + 1] : "default"

  let base64: string

  if (credIdx >= 0 && credIdx + 1 < args.length) {
    base64 = args[credIdx + 1]
  } else if (process.stdin.isTTY) {
    process.stderr.write("\n  ClickZetta Lakehouse Setup\n\n")
    process.stderr.write("  Paste your credential string (base64) from the registration page:\n\n")
    base64 = await prompt("  credential: ")
    if (!base64) {
      process.stderr.write("\n  No credential provided. Register at:\n")
      process.stderr.write("    https://accounts.clickzetta.com/register?ref=cz-cli (China)\n")
      process.stderr.write("    https://accounts.singdata.com/register?ref=cz-cli (International)\n\n")
      process.exit(1)
    }
  } else {
    process.stdout.write(JSON.stringify({
      error: {
        code: "NO_CREDENTIAL",
        message: "No credential provided. Use: cz-cli setup --credential <base64_string>",
        register_urls: [
          "https://accounts.clickzetta.com/register?ref=cz-cli",
          "https://accounts.singdata.com/register?ref=cz-cli",
        ],
      },
    }) + "\n")
    process.exit(1)
  }

  let cred: Credential
  try {
    cred = parseCredential(base64)
  } catch {
    process.stderr.write("  Error: invalid credential string (not valid base64 JSON)\n")
    process.stderr.write("  Get a valid credential from:\n")
    process.stderr.write("    https://accounts.clickzetta.com/register?ref=cz-cli (China)\n")
    process.stderr.write("    https://accounts.singdata.com/register?ref=cz-cli (International)\n\n")
    process.exit(1)
  }

  if (!cred.instanceName && !cred.service) {
    process.stderr.write("  Error: credential missing required fields (instanceName or service)\n")
    process.stderr.write("  Get a valid credential from:\n")
    process.stderr.write("    https://accounts.clickzetta.com/register?ref=cz-cli (China)\n")
    process.stderr.write("    https://accounts.singdata.com/register?ref=cz-cli (International)\n\n")
    process.exit(1)
  }

  writeProfile(cred, profileName)
  if (cred.apiKey) writeAuth(cred.apiKey)

  if (process.stdin.isTTY) {
    process.stderr.write(`\n  ✓ Profile '${profileName}' created\n`)
    process.stderr.write(`    instance:  ${cred.instanceName ?? "-"}\n`)
    process.stderr.write(`    workspace: ${cred.workspaceName ?? "-"}\n`)
    process.stderr.write(`    service:   ${cred.service ?? "-"}\n`)
    process.stderr.write(`    user:      ${cred.username ?? "-"}\n\n`)
  } else {
    process.stdout.write(JSON.stringify({
      data: {
        message: `Profile '${profileName}' created successfully.`,
        profile: profileName,
        instance: cred.instanceName,
        workspace: cred.workspaceName,
        schema: cred.schema,
        vcluster: cred.virtualCluster,
      },
    }) + "\n")
  }

  process.exit(0)
}
