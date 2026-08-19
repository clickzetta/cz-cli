import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createTraceparent } from "@clickzetta/sdk"
import { injectAgentMcp } from "./agent-mcp.js"
import { createCli } from "./cli.js"
import { CLICKZETTA_PROFILE_OPTION_NAMES } from "./clickzetta-profile-option.js"
import { ConnectionEnv } from "./connection/env.js"
import { resolveConnectionConfig, type CliArgs } from "./connection/config.js"
import { migrateInlineOAuthTokens, pruneOrphanOAuthSections } from "./connection/profile-store.js"
import { parseOutputArgs, renderOutput } from "./output/index.js"
import { registerCommands } from "./register-commands.js"
import { SubcommandHelpShown } from "./subcommand-help.js"
import { trackCommand, parseTrackingArgs } from "./telemetry.js"

interface CliRuntime {
  stdout: Pick<typeof process.stdout, "write" | "isTTY">
  stderr: Pick<typeof process.stderr, "write" | "isTTY">
  exit: (code: number) => never
}

const defaultRuntime: CliRuntime = {
  stdout: process.stdout,
  stderr: process.stderr,
  exit: (code) => process.exit(code),
}

const PROFILE_REQUIRED_COMMANDS = new Set([
  "sql",
  "schema",
  "table",
  "workspace",
  "status",
  "task",
  "runs",
  "attempts",
  "job",
  "datasource",
  "analytics-agent",
  "workspace-param",
])

const LLM_ONBOARDING = {
  next_steps: [
    "cz-cli agent llm add <NAME> --provider <PROVIDER> --api-key <API_KEY>",
  ],
  clickzetta_builtin: [
    "cz-cli auth login <name> --credential <base64_string>",
  ],
  external_llm: [
    "cz-cli agent llm add my-openai --provider openai --api-key <OPENAI_API_KEY>",
    "cz-cli agent llm add my-relay --provider openai-compatible --base-url https://your-gateway.example.com/v1 --api-key <API_KEY>",
  ],
  optional_checks: [
    "cz-cli agent llm show",
    "cz-cli agent llm test <NAME>",
    "cz-cli agent llm models <NAME>",
  ],
  optional_default: [
    "cz-cli agent llm use <NAME>/<MODEL_ID>",
  ],
  lakehouse_setup: [
    "cz-cli auth login <name>",
    "cz-cli auth login <name> --username <username> --password <password> --account-name <account_name>",
  ],
} as const

const AGENT_FLAGS = new Set(["debug", "d", "help", "h", "version", "v"])

// Upstream opencode's value-taking short flags on the agent command tree
// (run/tui/attach/session/agent/upgrade: -m model, -c continue, -f file, -s
// session, -n max-count, -u username, -g global). The agent-path scanner must
// know these consume a following value, or it mistakes the VALUE for the
// subcommand: `agent -m fake/m run hi` read "fake/m" as the subcommand, failed
// the AGENT_RUNTIME_SUBCOMMANDS test, never delegated to the agent runtime, and
// exited 0 having done nothing at all.
//
// -c is boolean upstream (--continue), so it is deliberately NOT here; it is
// listed in AGENT_FLAGS-style value-less handling via the scanner's default.
const UPSTREAM_AGENT_VALUE_FLAGS = ["m", "f", "n", "u", "g"] as const

// Upstream's value-taking network options, from the `options` object in
// packages/opencode/src/cli/network.ts. withNetworkOptions() mixes them into the
// $0 TUI command — that is, bare `cz-cli agent` — so they legally appear BEFORE
// any subcommand, exactly where this scanner looks. Keep in sync on re-baseline.
//
// Missing, they reproduced the UPSTREAM_AGENT_VALUE_FLAGS bug verbatim, and worse:
// `agent --port 8080` read "8080" as the subcommand, missed
// AGENT_RUNTIME_SUBCOMMANDS, never delegated, and printed the `agent` group help
// with exit 0 — no server, no diagnostic. Adding a subcommand only made it audible:
// `agent --port 8080 run hi` exited 2 on "Unknown argument: port".
//
// --mdns is deliberately NOT here: it is boolean, so listing it would swallow the
// following token and stop `agent --mdns run hi` from delegating. --cors is
// `array: true`, so yargs consumes its values greedily where this scanner skips
// exactly one; the divergence is harmless because both readings still delegate, and
// the runtime re-parses the raw args with the real parser.
const UPSTREAM_NETWORK_VALUE_FLAGS = ["port", "hostname", "mdns-domain", "cors"] as const

// The remaining value-taking options the $0 TUI command declares
// (packages/opencode/src/cli/cmd/tui.ts); --model/--session are already covered
// above. Same pre-subcommand position, same silent exit 0 without them.
// --replay-limit belongs here even though agent-cmd/tui.ts rejects the --mini
// family: delegating is what lets the user reach that purposeful error instead of
// unexplained group help. Booleans (--continue/--fork/--mini/--replay/--no-replay/
// --demo) are excluded for the same reason as --mdns.
const UPSTREAM_TUI_VALUE_FLAGS = ["prompt", "agent", "replay-limit"] as const

const AGENT_FLAGS_WITH_VALUES = new Set([
  ...CLICKZETTA_PROFILE_OPTION_NAMES,
  ...UPSTREAM_AGENT_VALUE_FLAGS,
  ...UPSTREAM_NETWORK_VALUE_FLAGS,
  ...UPSTREAM_TUI_VALUE_FLAGS,
  // cz's own agent-level option (bootstrap/runtime.ts), alongside the boolean
  // --print-logs/--pure, which take no value and so stay out.
  "log-level",
  "jdbc",
  "pat",
  "username",
  "password",
  "service",
  "protocol",
  "instance",
  "workspace",
  "schema",
  "s",
  "session",
  "model",
  "vcluster",
  // "v" is deliberately absent: -v is --version (boolean), so it consumes no value.
  "format",
  "field",
])
// -v joins the value-less set: it is --version, a boolean, in both parser trees.
const GLOBAL_FLAGS = new Set(["debug", "d", "help", "h", "version", "v"])
const GLOBAL_FLAGS_WITH_VALUES = new Set([
  ...CLICKZETTA_PROFILE_OPTION_NAMES,
  "jdbc",
  "pat",
  "username",
  "password",
  "service",
  "protocol",
  "instance",
  "workspace",
  "schema",
  "s",
  "vcluster",
  "format",
  "field",
])

const RUNTIME_COMMANDS = new Set(["run", "llm", "serve"])
const AGENT_RUNTIME_SUBCOMMANDS = new Set(["run", "llm", "session", "stats", "export"])

function usageErrorPayload(message: string) {
  return {
    error: { code: "USAGE_ERROR", message },
    ai_message: "Run the command with --help to see available options and usage.",
  }
}

function stripLegacyOutputFlag(args: string[]): { found: boolean; remaining: string[] } {
  let found = false
  const remaining: string[] = []
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (value === "-o" || value === "--output") {
      found = true
      index++ // skip the value
      continue
    }
    if (value?.startsWith("-o=") || value?.startsWith("--output=")) {
      found = true
      continue
    }
    remaining.push(value!)
  }
  return { found, remaining }
}

function runtimeOutputFlagMessage(command: string) {
  return `-o/--output is no longer supported. Use --format instead: cz-cli ${command} --format <value>`
}

function extractGlobalFormatArgs(args: string[]) {
  const formatArgs: string[] = []
  const remaining: string[] = []

  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    // cz_change: stop at `--`. Everything after it belongs to the command being
    // wrapped, so hoisting a `--format` out of there both stole a pass-through
    // token and moved it in front of the separator, where it changed cz's own
    // output instead. canonicalizeProfileShortFlag already stops here for the
    // same reason.
    if (value === "--") {
      remaining.push(...args.slice(index))
      break
    }
    if (value === "--format") {
      formatArgs.push(value)
      const next = args[index + 1]
      if (next !== undefined) {
        formatArgs.push(next)
        index++
      }
      continue
    }
    if (value?.startsWith("--format=")) {
      formatArgs.push(value)
      continue
    }
    remaining.push(value)
  }

  return { formatArgs, remaining }
}

function noProfilePayload() {
  return {
    error: {
      code: "NO_PROFILE",
      message: "No ClickZetta profile configured.",
      next_step: "cz-cli auth login <name>",
      next_steps: [
        "cz-cli auth login <name>",
        "cz-cli auth login <name> --credential <base64_string>",
        "cz-cli auth login <name> --username <username> --password <password> --account-name <account_name>",
      ],
      register_urls: [
        "https://accounts.clickzetta.com/register?ref=cz-cli",
        "https://accounts.singdata.com/register?ref=cz-cli",
      ],
      llm_help: "cz-cli agent llm --help",
    },
  }
}

function noLlmConfiguredPayload() {
  return {
    error: {
      code: "NO_LLM_CONFIGURED",
      message: "No usable LLM API configuration was found. Register one first; a default model is optional.",
      ...LLM_ONBOARDING,
    },
  }
}

function noProfileTtyMessage() {
  return (
    "\n  No ClickZetta profile configured.\n" +
    "  Run one of the following:\n\n" +
    "    cz-cli auth login <name>\n" +
    "      Recommended. Browser sign-in; <name> labels this login (e.g. company-prod).\n" +
    "      Discovers your instances/workspaces and creates a profile for each.\n\n" +
    "    cz-cli auth login <name> --credential <base64_string>\n" +
    "      New-user fast path from a registration token\n\n" +
    "    cz-cli auth login <name> --username <username> --password <password> --account-name <account_name>\n" +
    "      Existing-account non-TTY flow; cz-cli will tell you the next required step\n\n" +
    "  Register at:\n" +
    "    https://accounts.clickzetta.com/register?ref=cz-cli (China)\n" +
    "    https://accounts.singdata.com/register?ref=cz-cli (International)\n\n" +
    "  LLM configuration is separate:\n" +
    "    cz-cli agent llm --help\n\n"
  )
}

function noLlmConfiguredTtyMessage() {
  return (
    "\n  No usable LLM API configuration was found.\n" +
    "  Register one first:\n\n" +
    "  ClickZetta built-in LLM:\n" +
    "    cz-cli auth login <name> --credential <base64_string>\n\n" +
    "  External LLMs:\n" +
    "    cz-cli agent llm add my-openai --provider openai --api-key <OPENAI_API_KEY>\n" +
    "    cz-cli agent llm add my-relay --provider openai-compatible --base-url https://your-gateway.example.com/v1 --api-key <API_KEY>\n\n" +
    "  Optional checks after registration:\n" +
    "    cz-cli agent llm test <NAME>\n" +
    "    cz-cli agent llm models <NAME>\n" +
    "  To pin the default model (otherwise the first available one is used):\n" +
    "    cz-cli agent llm use <NAME>/<MODEL_ID>\n\n" +
    "  Lakehouse sign-in is separate:\n" +
    "    cz-cli auth login <name>   (see `cz-cli auth login --help` for all methods)\n\n"
  )
}

function hasConfiguredProfile() {
  try {
    return /^\[profiles\./m.test(readFileSync(join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "profiles.toml"), "utf-8"))
  } catch {
    return false
  }
}

// cz_change: dynamic import to keep llm/native-config off the startup path of
// commands that never touch LLM config. Best-effort — a failed migration must
// never block the CLI (llm.json stays the source of truth either way).
async function migrateProfilesLlm() {
  try {
    const { migrateProfilesLlmToJson } = await import("./llm/native-config.js")
    migrateProfilesLlmToJson()
  } catch {}
}

async function hasConfiguredLlm() {
  try {
    const { readLlmEntries } = await import("./llm/native-config.js")
    const { llm } = readLlmEntries()
    return Object.values(llm).some((entry) => entry.provider && entry.api_key)
  } catch {
    return false
  }
}

export function emitNoProfile(runtime: CliRuntime, rawArgs?: string[]): never {
  if (runtime.stderr.isTTY) {
    runtime.stderr.write(noProfileTtyMessage())
  } else {
    const outputArgs = parseOutputArgs(rawArgs ?? [])
    runtime.stdout.write(renderOutput(noProfilePayload(), outputArgs.format, outputArgs.field) + "\n")
  }
  return runtime.exit(1)
}

export function emitNoLlmConfigured(runtime: CliRuntime, rawArgs?: string[]): never {
  if (runtime.stderr.isTTY) {
    runtime.stderr.write(noLlmConfiguredTtyMessage())
  } else {
    const outputArgs = parseOutputArgs(rawArgs ?? [])
    runtime.stdout.write(renderOutput(noLlmConfiguredPayload(), outputArgs.format, outputArgs.field) + "\n")
  }
  return runtime.exit(1)
}

export function emitUsageError(runtime: CliRuntime, message: string): never {
  runtime.stdout.write(JSON.stringify(usageErrorPayload(message)) + "\n")
  return runtime.exit(2)
}

async function delegateToAgentRuntime(rawArgs: string[]): Promise<never> {
  // The agent-runtime phase is in-process state. Pass it as an argument rather
  // than via process.env, which would be inherited by child processes (e.g. the
  // bash tool's subprocesses) and make a nested cz-cli re-enter the agent runtime.
  process.env.CLICKZETTA_TRACEPARENT = createTraceparent(process.env.CLICKZETTA_TRACEPARENT)
  const { main } = await import("./bootstrap/runtime.ts")
  const code = await main(rawArgs, true)
  process.exit(code)
}

async function parseRegisteredCommands(args: string[], onValidated?: () => void): Promise<void> {
  const cli = registerCommands(createCli(args)).demandCommand(1, "").help()
  // Run the profile gate as middleware (applyBeforeValidation=false) so it fires
  // AFTER yargs validates command/option syntax but BEFORE the handler runs.
  // This way a mistyped command or unknown option surfaces a USAGE_ERROR instead
  // of being masked by NO_PROFILE on a machine without a configured profile.
  if (onValidated) cli.middleware(() => onValidated(), false)
  try {
    await cli.parseAsync()
  } catch (err) {
    // A bare command group already rendered its help in its fail handler and
    // threw this sentinel (before the profile middleware ran). Not an error —
    // exit stays 0. See subcommand-help.ts.
    if (!(err instanceof SubcommandHelpShown)) throw err
  }
}

function agentSubcommand(args: string[], commandIndex: number) {
  const index = subcommandIndex(args, commandIndex)
  return index < 0 ? undefined : args[index]
}

/**
 * Position of the agent subcommand token, or -1. Same scan as agentSubcommand —
 * kept as one walk so the token and its index can never disagree, which is what
 * the --format re-insertion depends on.
 */
function subcommandIndex(args: string[], commandIndex: number): number {
  for (let index = commandIndex + 1; index < args.length; index++) {
    const value = args[index]
    if (!value) continue
    if (value === "--") return -1
    if (!value.startsWith("-")) return index
    const flag = value.replace(/^-+/, "").split("=")[0]
    if (!flag || AGENT_FLAGS.has(flag) || value.includes("=")) continue
    if (AGENT_FLAGS_WITH_VALUES.has(flag)) index++
  }
  return -1
}

// cz_change: `-p` is the cz-cli global short alias for `--profile`, but upstream
// opencode binds `-p` to `--password` (basic auth against a headless server) on
// run/attach/providers — a concept cz-cli does not expose at all. On the agent
// runtime path that collision was silent and wrong: `agent run "x" -p staging`
// parsed "staging" as a server password, left --profile unset, and the runtime
// middleware then reset CZ_* back to default_profile — so the run silently hit
// the WRONG lakehouse. Canonicalize the short form to `--profile` before any
// parser sees it, so `-p` can never be reinterpreted downstream. Stops at `--`
// so pass-through args keep their original meaning.
function canonicalizeProfileShortFlag(args: string[]): string[] {
  const result: string[] = []
  let passthrough = false
  for (const value of args) {
    if (passthrough || value === undefined) {
      result.push(value!)
      continue
    }
    if (value === "--") {
      passthrough = true
      result.push(value)
      continue
    }
    if (value === "-p") {
      result.push("--profile")
      continue
    }
    if (value.startsWith("-p=")) {
      result.push(`--profile=${value.slice("-p=".length)}`)
      continue
    }
    result.push(value)
  }
  return result
}

function normalizeCliArgs(rawArgs: string[]) {
  const initialArgs = canonicalizeProfileShortFlag(rawArgs.length === 0 ? ["--help"] : rawArgs)
  const { formatArgs, remaining } = extractGlobalFormatArgs(initialArgs)
  const commandArgs = remaining
  let command = ""
  let commandIndex = -1
  for (let index = 0; index < commandArgs.length; index++) {
    const value = commandArgs[index]
    if (!value) continue
    if (value === "--") break
    if (!value.startsWith("-")) {
      command = value
      commandIndex = index
      break
    }
    const flag = value.replace(/^-+/, "").split("=")[0]
    if (!flag || GLOBAL_FLAGS.has(flag) || value.includes("=")) continue
    if (GLOBAL_FLAGS_WITH_VALUES.has(flag)) index++
  }
  const isHelpRequest = initialArgs.includes("--help") || initialArgs.includes("-h")
  const subcommand = command === "agent" ? agentSubcommand(commandArgs, commandIndex) : undefined
  const bareAgentInvocation = command === "agent" && !subcommand
  // cz_change: re-insert --format AFTER the full command path, not after the
  // first word. bootstrap/runtime.ts dispatches on fixed positions (`args[0] ===
  // "agent" && args[1] === "llm"`), and the old splice put the flag at args[1],
  // so `agent llm show --format json` became `agent --format json llm show` and
  // stopped matching — the flag then reached a parser that never declared it and
  // was rejected as unknown. `agent run` only worked by accident: it has no
  // deeper dispatch key to displace. Insert past the subcommand as well so every
  // agent-path command sees the same args shape.
  const formatInsertAt = commandIndex < 0
    ? -1
    : subcommand
      ? subcommandIndex(commandArgs, commandIndex) + 1
      : commandIndex + 1
  const runtimeArgs = formatArgs.length === 0 || formatInsertAt < 0
    ? commandArgs
    : [...commandArgs.slice(0, formatInsertAt), ...formatArgs, ...commandArgs.slice(formatInsertAt)]
  return {
    args: initialArgs,
    runtimeArgs,
    command,
    isHelpRequest,
    subcommand,
    shouldDelegateToAgentRuntime:
      RUNTIME_COMMANDS.has(command) ||
      (command === "agent" &&
        !isHelpRequest &&
        (bareAgentInvocation || AGENT_RUNTIME_SUBCOMMANDS.has(subcommand ?? ""))),
  }
}

function profileOverrideFromArgs(args: string[]) {
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (value === "--profile" || value === "-p") return args[index + 1]
    if (value?.startsWith("--profile=")) return value.slice("--profile=".length)
    if (value?.startsWith("-p=")) return value.slice(3)
  }
}

// Flags that upstream opencode already owns on the agent command tree, so the cz
// connection scanner must not ALSO read them there:
//   -s  upstream --session  (run/tui/attach)   vs cz --schema
//   -m  upstream --model, -f --file, -c --continue, -n --max-count
//   -u/--username, -p/--password  upstream server basic auth  vs cz lakehouse creds
//
// Claiming these on the agent path made one token mean two things at once:
// `agent run x -s ses_1` selected the session AND set CZ_SCHEMA=ses_1.
//
// -v is NOT here: it is --version in both trees now (see cli.ts), so there is
// nothing to contest. -d is not here either: upstream's only -d is `uninstall
// --keep-data`, a sibling of `agent`, never in scope for these args.
//
// Long forms stay available where the runtime implements them; upstream defines no
// --schema/--vcluster/--instance, so those never collide. The cz-native path
// (sql/schema/table/…) is untouched — nothing upstream parses those args.
const AGENT_CONTESTED_FLAGS = new Set(["s", "username", "password", "u", "m", "c", "f", "n"])

function connectionOverridesFromArgs(args: string[], agentPath = false): Partial<CliArgs> {
  const overrides: Partial<CliArgs> = {}
  const flagMap: Record<string, keyof CliArgs> = {
    profile: "profile",
    p: "profile",
    jdbc: "jdbcUrl",
    pat: "pat",
    username: "username",
    password: "password",
    service: "service",
    protocol: "protocol",
    instance: "instance",
    workspace: "workspace",
    schema: "schema",
    s: "schema",
    vcluster: "vcluster",
    // No `v` entry: -v is --version, never --vcluster. Mapping it here made
    // `-v <x>` set CZ_VCLUSTER while the parser read -v as --version.
  }

  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (!value?.startsWith("-")) continue
    if (value === "--") break
    const match = /^--?([^=]+)(?:=(.*))?$/.exec(value)
    if (!match) continue
    if (agentPath && AGENT_CONTESTED_FLAGS.has(match[1]!)) {
      // Upstream owns this flag here; skip it AND its value so a following
      // token is not misread as another flag's value.
      if (match[2] === undefined && args[index + 1] && !args[index + 1]!.startsWith("-")) index++
      continue
    }
    const key = flagMap[match[1]!]
    if (!key) continue
    const flagValue = match[2] ?? args[index + 1]
    if (!flagValue || flagValue.startsWith("-")) continue
    overrides[key] = flagValue
    if (match[2] === undefined) index++
  }

  return overrides
}

/**
 * Expand the connection flags of this invocation into the `CZ_*` layer, so the
 * agent runtime and any child process it spawns see the same connection the
 * flags selected.
 *
 * `resolved` (resolveConnectionConfig's output) is NOT one provenance: most of
 * it can be the ACTIVE PROFILE's own TOML fields, expanded here only because
 * `overrides` happened to include `--profile` — e.g. `cz-cli mcp serve
 * --profile a` resolves entirely from profile a, with no credential flag at
 * all. Writing that wholesale through ConnectionEnv.applyUser (as an earlier
 * version of this function did) mislabelled the profile's OWN values as the
 * user's, making them permanently un-clearable: commands/mcp.ts's per-call
 * `applyClickZettaProfile("b")` — a `.apply()` expanding a DIFFERENT profile —
 * skips any name already marked user-owned, so the session kept authenticating
 * as `a`. That is the exact "`--profile B` authenticates as A" failure
 * connection/env.ts's module docblock describes.
 *
 * So the two provenances are split here, not decided by `.apply()`'s
 * skip-if-user-owns-it check after the fact:
 *   - a value LITERALLY supplied by a flag on `overrides` — the user speaking
 *     now, same as a hand-set `CZ_SCHEMA=x` — goes through `.applyUser()`,
 *     never marked derived, so it survives a later per-profile `.apply()`.
 *   - everything else `resolved` produced (i.e. from the profile, JDBC, or a
 *     lower env tier) goes through `.apply()`, marked derived under
 *     `overrides.profile`, so the SAME later per-profile `.apply()` correctly
 *     replaces it on a switch instead of leaving it stuck.
 *
 * The credential (pat vs. username+password) follows config.ts's own
 * `explicitCredential` line: only a flag-pat, or a flag pair with BOTH
 * username AND password present on `overrides`, counts as fully the user's.
 * A lone `--username` with the password filled from the profile is still
 * mostly the profile speaking, so it takes the derived path — same reasoning
 * as why that case does not suppress the OAuth token store in config.ts.
 */
const NON_AUTH_CONNECTION_KEYS = ["service", "protocol", "instance", "workspace", "schema", "vcluster"] as const

/**
 * Pure split of `resolveConnectionConfig`'s output into the two provenance
 * layers `applyAgentConnectionEnv` writes. Exported so a test can assert the
 * split ITSELF — the two decisions that can regress silently (`credentialIsFlag`
 * reading `overrides.*` rather than `resolved.*`, and which non-auth keys land
 * in which layer) — rather than only the behaviour `ConnectionEnv` produces
 * given an already-correct split. This formula has been wrong twice: once
 * writing `resolved` wholesale through `applyUser`, mislabelling every
 * profile-sourced field as the user's own.
 */
export function splitConnectionEnv(
  overrides: Partial<CliArgs>,
  resolved: Partial<ConnectionEnv.Fields> & { pat?: string; username?: string; password?: string },
): { userFields: ConnectionEnv.Fields; derivedFields: ConnectionEnv.Fields } {
  const userFields: ConnectionEnv.Fields = {}
  for (const key of NON_AUTH_CONNECTION_KEYS) {
    if (overrides[key]) userFields[key] = overrides[key]
  }
  // A flag being PRESENT on overrides does not mean it WON: pickCredential's
  // tier order is flag pat > env pat > profile pat > flag username/password
  // (config.ts), so `--username u --password p` against a profile that also
  // stores a pat resolves to that profile's pat, not the flag pair — resolved
  // and overrides can name DIFFERENT kinds. Checking presence on overrides
  // alone (as an earlier version of this function did) would then promote
  // resolved.pat — the PROFILE's value — into userFields, mislabelling it as
  // the user's. Requiring the VALUE to match what overrides supplied, not just
  // the field being present, is what keeps the two in agreement: only a
  // flag-pat whose value resolveConnectionConfig actually kept, or a flag pair
  // whose BOTH values it actually kept, counts as fully the user's. A lone
  // `--username` with the password filled from the profile is still mostly the
  // profile speaking (same reasoning as why that case does not suppress the
  // OAuth token store in config.ts), and now so is any flag credential that
  // simply lost its priority tier to the profile's own.
  const credentialIsFlag =
    (overrides.pat !== undefined && resolved.pat === overrides.pat) ||
    (overrides.username !== undefined &&
      overrides.password !== undefined &&
      resolved.username === overrides.username &&
      resolved.password === overrides.password)
  if (credentialIsFlag) {
    if (resolved.pat) userFields.pat = resolved.pat
    else if (resolved.username && resolved.password) {
      userFields.username = resolved.username
      userFields.password = resolved.password
    }
  }

  const derivedFields: ConnectionEnv.Fields = {}
  for (const key of NON_AUTH_CONNECTION_KEYS) {
    if (!overrides[key] && resolved[key]) derivedFields[key] = resolved[key]
  }
  if (!credentialIsFlag) {
    if (resolved.pat) derivedFields.pat = resolved.pat
    else if (resolved.username && resolved.password) {
      derivedFields.username = resolved.username
      derivedFields.password = resolved.password
    }
  }
  return { userFields, derivedFields }
}

function applyAgentConnectionEnv(overrides: Partial<CliArgs>) {
  if (Object.keys(overrides).length === 0) return overrides
  const resolved = resolveConnectionConfig(overrides)
  const { userFields, derivedFields } = splitConnectionEnv(overrides, resolved)
  ConnectionEnv.applyUser(userFields)
  ConnectionEnv.apply(derivedFields, overrides.profile)
  return overrides
}

export function classifyCliArgs(rawArgs: string[]) {
  const normalized = normalizeCliArgs(rawArgs)
  return {
    ...normalized,
    requiresProfile:
      PROFILE_REQUIRED_COMMANDS.has(normalized.command) &&
      !normalized.isHelpRequest &&
      !hasConfiguredProfile(),
  }
}

export async function runCli(rawArgs: string[], runtime: CliRuntime = defaultRuntime): Promise<void> {
  // One-time, idempotent migration of legacy inline [profiles.x.oauth.y] tokens
  // to the shared [oauth.<id>] layout. Best-effort; never throws.
  migrateInlineOAuthTokens()
  // Then sweep [oauth.<id>] sections no profile points at — the residue of the
  // fixed over-attachment bug, which filed non-OAuth login tokens under random
  // ids. Runs AFTER the migration so its fresh pointers count as references.
  pruneOrphanOAuthSections()
  // cz_change: lift origin/main's `[llm.*]` tables out of profiles.toml into
  // llm.json. This is a config-layer migration and must run HERE, before any
  // gate — it used to live only in the agent runtime (bootstrap/runtime.ts),
  // downstream of the NO_LLM_CONFIGURED gate below. hasConfiguredLlm() reads
  // only llm.json, so an upgraded user whose LLM config was still in
  // profiles.toml was rejected on `cz-cli agent` / `agent run` and the
  // migration never got the chance to run — the error even told them to
  // re-add entries they already had. Idempotent; no-ops without `[llm.*]`.
  await migrateProfilesLlm()
  const normalized = normalizeCliArgs(rawArgs)
  // On the agent path, upstream opencode owns several of these short flags; tell
  // the scanner so it does not also read them as cz connection overrides. See
  // AGENT_CONTESTED_FLAGS.
  const agentConnectionOverrides = applyAgentConnectionEnv(
    connectionOverridesFromArgs(normalized.args, normalized.shouldDelegateToAgentRuntime),
  )
  const profileOverride = agentConnectionOverrides.profile ?? profileOverrideFromArgs(normalized.args)
  if (profileOverride) ConnectionEnv.pin(profileOverride)
  const isAgentSessionEntry =
    !normalized.isHelpRequest &&
    (
      normalized.command === "run" ||
      (normalized.command === "agent" && (!normalized.subcommand || normalized.subcommand === "run"))
    )

  const legacy = stripLegacyOutputFlag(normalized.args)
  if (legacy.found) {
    const stripped = normalizeCliArgs(legacy.remaining)
    const label = stripped.command === "agent" ? `agent ${stripped.subcommand ?? ""}`.trim() : stripped.command || "cz-cli"
    const message = runtimeOutputFlagMessage(label)
    const aiMessage = `-o/--output was removed. Replace with --format. Valid choices: ${label.startsWith("agent") ? "default, json" : "json, pretty, table, csv, text, jsonl, toon"}.`
    runtime.stdout.write(JSON.stringify({ error: { code: "USAGE_ERROR", message }, ai_message: aiMessage }) + "\n")
    return runtime.exit(2)
  }

  if (isAgentSessionEntry && !process.env.CLICKZETTA_PID && !(await hasConfiguredLlm())) {
    return emitNoLlmConfigured(runtime, rawArgs)
  }

  if (normalized.shouldDelegateToAgentRuntime) {
    await injectAgentMcp(agentConnectionOverrides)
    await delegateToAgentRuntime(normalized.runtimeArgs)
  }

  const requiresProfile =
    PROFILE_REQUIRED_COMMANDS.has(normalized.command) &&
    !normalized.isHelpRequest

  // Gate runs as post-validation middleware inside parseRegisteredCommands, so
  // yargs reports syntax errors (unknown command/option, missing positional)
  // before NO_PROFILE. hasConfiguredProfile() is re-checked here (not above) so
  // it only fires once the command syntax is known to be valid.
  await parseRegisteredCommands(
    normalized.args,
    requiresProfile
      ? () => {
          if (!hasConfiguredProfile()) emitNoProfile(runtime, rawArgs)
        }
      : undefined,
  )
}

/**
 * Binary entry point wrapper: runs the CLI and emits a command telemetry event on completion.
 *
 * Use this instead of runCli() when the caller is the compiled binary entry point
 * (`src/bootstrap/boot.ts`). Do NOT use inside execute.ts or other programmatic callers —
 * those paths have their own trackCommand calls and would double-track.
 *
 * Expects rawArgs = hideBin(process.argv) (i.e. process.argv.slice(2)).
 *
 * Note: agent/run commands call delegateToAgentRuntime() → process.exit() inside runCli(),
 * so they never reach the track() call here. That is intentional — agent commands are
 * tracked separately by the opencode session telemetry pipeline.
 */
export async function runCliWithTracking(rawArgs: string[]): Promise<void> {
  const startMs = Date.now()
  const { positional, args } = parseTrackingArgs(rawArgs)

  const track = (success: boolean, error?: string) =>
    trackCommand({
      command: positional[0] ?? "unknown",
      subcommand: positional[1],
      args: Object.keys(args).length > 0 ? args : undefined,
      duration_ms: Date.now() - startMs,
      success,
      error,
      response_bytes: (process as unknown as Record<string, unknown>).responseBytes as number | undefined,
    })

  try {
    await runCli(rawArgs)
    const lastError = (process as unknown as Record<string, unknown>).lastError as string | undefined
    if (positional[0] !== "setup") {
      await track(!process.exitCode, process.exitCode ? lastError ?? `exit_code=${process.exitCode}` : undefined)
    }
  } catch (error) {
    if (positional[0] !== "setup") {
      await track(false, error instanceof Error ? error.message : `exit_code=${process.exitCode ?? 1}`)
    }
    if (!process.exitCode) throw error
  }
}
