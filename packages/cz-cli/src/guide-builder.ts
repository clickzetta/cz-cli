import { VERSION } from "./version.js"

const GUIDE_GENERATOR_VERSION = "1.0.0"
const DEFAULT_BUDGET_CHARS = 40000

export interface CommandEntry {
  name: string
  kind: "command" | "group"
  description: string
  usage?: string
  options?: OptionEntry[]
  arguments?: ArgumentEntry[]
  shell_quote_hint?: string
  examples?: { cmd: string; desc: string }[]
}

interface OptionEntry {
  flags: string
  required: boolean
  takes_value: boolean
  help?: string
  default?: unknown
}

interface ArgumentEntry {
  name: string
  required: boolean
}

interface GuidePayload {
  name: string
  version: string
  guide_generator_version: string
  description: string
  global_options: Record<string, unknown>
  recommended_workflow: string[]
  commands: Record<string, unknown>[]
  output_format: Record<string, unknown>
  safety: Record<string, string>
  exit_codes: Record<string, string>
  tips: Record<string, string>
  truncation?: Record<string, unknown>
}

const commandRegistry: CommandEntry[] = []

export function registerCommand(entry: CommandEntry): void {
  commandRegistry.push(entry)
}

export function registerCommands(entries: CommandEntry[]): void {
  for (const e of entries) commandRegistry.push(e)
}

function serializePayloadLength(payload: Record<string, unknown>): number {
  return JSON.stringify(payload, null, 2).length
}

function dropOptionHelpAndDefault(payload: Record<string, unknown>): boolean {
  let changed = false
  for (const cmd of (payload.commands ?? []) as Record<string, unknown>[]) {
    for (const opt of (cmd.options ?? []) as Record<string, unknown>[]) {
      if ("help" in opt) { delete opt.help; changed = true }
      if ("default" in opt) { delete opt.default; changed = true }
    }
  }
  return changed
}

function dropParameterDetails(payload: Record<string, unknown>): boolean {
  let changed = false
  for (const cmd of (payload.commands ?? []) as Record<string, unknown>[]) {
    if (cmd.options) { delete cmd.options; changed = true }
    if (cmd.arguments) { delete cmd.arguments; changed = true }
  }
  return changed
}

function dropCommandExamples(payload: Record<string, unknown>): boolean {
  let changed = false
  for (const cmd of (payload.commands ?? []) as Record<string, unknown>[]) {
    if (cmd.examples) { delete cmd.examples; changed = true }
  }
  if (payload.command_examples) { delete payload.command_examples; changed = true }
  return changed
}

function dropGlobalExamples(payload: Record<string, unknown>): boolean {
  const go = payload.global_options as Record<string, unknown> | undefined
  if (!go || !("examples" in go)) return false
  delete go.examples
  return true
}

function dropRecommendedWorkflow(payload: Record<string, unknown>): boolean {
  if (!("recommended_workflow" in payload)) return false
  delete payload.recommended_workflow
  return true
}

function dropTips(payload: Record<string, unknown>): boolean {
  if (!("tips" in payload)) return false
  delete payload.tips
  return true
}

function dropDescriptions(payload: Record<string, unknown>): boolean {
  let changed = false
  for (const cmd of (payload.commands ?? []) as Record<string, unknown>[]) {
    if (cmd.description) { delete cmd.description; changed = true }
  }
  return changed
}

function applyBudget(payload: Record<string, unknown>, budgetChars: number): Record<string, unknown> {
  const beforeChars = serializePayloadLength(payload)
  const appliedSteps: string[] = []

  if (beforeChars <= budgetChars) {
    payload.truncation = {
      applied: false,
      budget_chars: budgetChars,
      estimated_chars_before: beforeChars,
      estimated_chars_after: beforeChars,
      steps_applied: [],
    }
    return payload
  }

  const steps: [string, (p: Record<string, unknown>) => boolean][] = [
    ["drop_option_help_and_default", dropOptionHelpAndDefault],
    ["drop_parameter_details", dropParameterDetails],
    ["drop_command_examples", dropCommandExamples],
    ["drop_global_examples", dropGlobalExamples],
    ["drop_recommended_workflow", dropRecommendedWorkflow],
    ["drop_tips", dropTips],
    ["drop_command_descriptions", dropDescriptions],
  ]

  for (const [name, fn] of steps) {
    if (fn(payload)) appliedSteps.push(name)
    if (serializePayloadLength(payload) <= budgetChars) break
  }

  payload.truncation = {
    applied: true,
    budget_chars: budgetChars,
    estimated_chars_before: beforeChars,
    estimated_chars_after: serializePayloadLength(payload),
    steps_applied: appliedSteps,
    mandatory_sections: ["global_options", "recommended_workflow", "output_format", "safety", "exit_codes"],
  }
  return payload
}

function resolveBudget(budgetChars: number | undefined, wide: boolean): number {
  if (budgetChars !== undefined) return Math.max(2000, budgetChars)
  const env = process.env.CZ_AI_GUIDE_BUDGET?.trim()
  if (env) {
    const parsed = parseInt(env, 10)
    if (!isNaN(parsed)) return Math.max(2000, parsed)
  }
  return wide ? 300000 : DEFAULT_BUDGET_CHARS
}

export function buildToonPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(payload)
  const commandsFlat: Record<string, unknown>[] = []
  const commandExamples: Record<string, unknown> = {}
  const commandHints: Record<string, string> = {}

  for (const cmd of (result.commands ?? []) as Record<string, unknown>[]) {
    const flat: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(cmd)) {
      if (k !== "examples" && k !== "shell_quote_hint") flat[k] = v
    }
    commandsFlat.push(flat)
    if (cmd.examples) commandExamples[cmd.name as string] = cmd.examples
    if (cmd.shell_quote_hint) commandHints[cmd.name as string] = cmd.shell_quote_hint as string
  }

  result.commands = commandsFlat
  if (Object.keys(commandExamples).length > 0) result.command_examples = commandExamples
  if (Object.keys(commandHints).length > 0) result.command_hints = commandHints
  return result
}

export function buildAiGuide(options?: { wide?: boolean; budgetChars?: number }): GuidePayload {
  const wide = options?.wide ?? false
  const cliName = "cz-cli"

  const sorted = [...commandRegistry].sort((a, b) => a.name.localeCompare(b.name))
  const commandsDicts = sorted.map((e) => {
    const d: Record<string, unknown> = { name: e.name, kind: e.kind, description: e.description }
    if (e.usage) d.usage = e.usage
    if (e.options && e.options.length > 0) d.options = e.options
    if (e.arguments && e.arguments.length > 0) d.arguments = e.arguments
    if (e.shell_quote_hint) d.shell_quote_hint = e.shell_quote_hint
    if (e.examples && e.examples.length > 0) d.examples = e.examples
    return d
  })

  const payload: Record<string, unknown> = {
    name: cliName,
    version: VERSION,
    guide_generator_version: GUIDE_GENERATOR_VERSION,
    description: "AI-Agent-friendly CLI for ClickZetta Lakehouse",
    global_options: {
      order: "Global options must appear before subcommand.",
      usage_pattern: `${cliName} [GLOBAL_OPTIONS] <subcommand> [args] (or run ${cliName} <subcommand> [args] --format pretty)`,
      entry_commands: ["cz-cli", "clickzetta-cli"],
      options: [
        { flags: "--profile, -p", required: false, takes_value: true, help: "Profile name" },
        { flags: "--format", required: false, takes_value: true, help: "Output format", default: "json" },
        { flags: "--debug, -d", required: false, takes_value: false, help: "Debug mode" },
      ],
      examples: [
        `${cliName} --profile dev sql "SELECT 1"`,
        `${cliName} --format table task list --limit 5`,
        `${cliName} runs list --task my_task --run-type REFILL --limit 1`,
      ],
    },
    recommended_workflow: [
      `${cliName} profile create <name> --username ... --password ... --instance ... --workspace ...`,
      `${cliName} schema list`,
      `${cliName} table list --schema public`,
      `${cliName} sql "SELECT ... LIMIT 20"`,
    ],
    commands: commandsDicts,
    output_format: {
      success: { ok: true, data: "...", time_ms: "N" },
      error: { ok: false, error: { code: "...", message: "..." } },
      note: "Use --format pretty for colorized human-friendly JSON output.",
    },
    safety: {
      write_protection: "Write operations require --write. DELETE/UPDATE without WHERE are blocked.",
      confirmation: "task online/offline, runs stop/refill, executions stop require confirmation unless -y.",
      pagination: "task list / runs list / executions list default to page 1; use --page/--page-size or --limit.",
    },
    exit_codes: { "0": "success", "1": "business error", "2": "usage error" },
    tips: {
      help: `Run '${cliName} <subcommand> --help' to inspect exact parameter contracts.`,
      profile: "Use --profile for reusable connection config; protocol can be overridden per profile.",
    },
  }

  if (!wide) dropParameterDetails(payload)

  return applyBudget(structuredClone(payload), resolveBudget(options?.budgetChars, wide)) as unknown as GuidePayload
}

export function registerStaticCommands(): void {
  registerCommands([
    { name: "sql", kind: "command", description: "Execute SQL against ClickZetta",
      options: [
        { flags: "--write", required: false, takes_value: false, help: "Allow write operations" },
        { flags: "-e, --execute", required: false, takes_value: true, help: "SQL string" },
        { flags: "-f, --file", required: false, takes_value: true, help: "Read SQL from file" },
        { flags: "--sync", required: false, takes_value: false, help: "Wait for result" },
        { flags: "--no-limit", required: false, takes_value: false, help: "Disable LIMIT guard" },
        { flags: "-N, --no-header", required: false, takes_value: false, help: "Omit column headers" },
      ],
      arguments: [{ name: "statement", required: false }],
      shell_quote_hint: "Shell tip: wrap SQL statement in quotes, or pass -f/--file for complex statements.",
      examples: [
        { cmd: 'cz-cli sql "SELECT 1"', desc: "Run a simple query" },
        { cmd: 'cz-cli sql -e "SELECT * FROM t LIMIT 10" --sync', desc: "Synchronous query" },
        { cmd: "cz-cli sql -f query.sql --write", desc: "Execute write SQL from file" },
      ],
    },
    { name: "schema", kind: "group", description: "Manage schemas" },
    { name: "schema list", kind: "command", description: "List schemas" },
    { name: "schema describe", kind: "command", description: "Describe a schema",
      arguments: [{ name: "name", required: true }] },
    { name: "schema create", kind: "command", description: "Create a schema",
      arguments: [{ name: "name", required: true }] },
    { name: "schema drop", kind: "command", description: "Drop a schema",
      arguments: [{ name: "name", required: true }] },
    { name: "table", kind: "group", description: "Manage tables" },
    { name: "table list", kind: "command", description: "List tables" },
    { name: "table describe", kind: "command", description: "Describe a table",
      arguments: [{ name: "name", required: true }] },
    { name: "table preview", kind: "command", description: "Preview table data",
      arguments: [{ name: "name", required: true }] },
    { name: "table stats", kind: "command", description: "Get table row count",
      arguments: [{ name: "name", required: true }] },
    { name: "table history", kind: "command", description: "Show table history",
      arguments: [{ name: "name", required: false }] },
    { name: "table create", kind: "command", description: "Create a table from DDL",
      arguments: [{ name: "ddl", required: true }],
      shell_quote_hint: 'Shell tip: wrap DDL in quotes (e.g. "CREATE TABLE ...") or use --from-file.',
    },
    { name: "table drop", kind: "command", description: "Drop a table",
      arguments: [{ name: "name", required: true }] },
    { name: "workspace", kind: "group", description: "Manage workspaces" },
    { name: "workspace list", kind: "command", description: "List workspaces" },
    { name: "workspace current", kind: "command", description: "Show current workspace" },
    { name: "profile", kind: "group", description: "Manage connection profiles" },
    { name: "profile list", kind: "command", description: "List profiles" },
    { name: "profile detail", kind: "command", description: "Show profile details",
      arguments: [{ name: "name", required: true }] },
    { name: "profile create", kind: "command", description: "Create a profile",
      arguments: [{ name: "name", required: true }] },
    { name: "profile update", kind: "command", description: "Update a profile",
      arguments: [{ name: "name", required: true }] },
    { name: "profile delete", kind: "command", description: "Delete a profile",
      arguments: [{ name: "name", required: true }] },
    { name: "profile use", kind: "command", description: "Set default profile",
      arguments: [{ name: "name", required: true }] },
    { name: "task", kind: "group", description: "Manage Studio tasks" },
    { name: "task list", kind: "command", description: "List tasks" },
    { name: "task create", kind: "command", description: "Create a new task",
      arguments: [{ name: "name", required: true }] },
    { name: "task content", kind: "command", description: "Get task content",
      arguments: [{ name: "id", required: true }] },
    { name: "task save-content", kind: "command", description: "Save task script",
      arguments: [{ name: "id", required: true }] },
    { name: "task save-config", kind: "command", description: "Save task schedule config",
      arguments: [{ name: "id", required: true }] },
    { name: "task execute", kind: "command", description: "Execute a task ad-hoc",
      arguments: [{ name: "id", required: true }] },
    { name: "task online", kind: "command", description: "Publish a task",
      arguments: [{ name: "id", required: true }] },
    { name: "task offline", kind: "command", description: "Take a task offline",
      arguments: [{ name: "id", required: true }] },
    { name: "task deps", kind: "command", description: "Show task dependencies",
      arguments: [{ name: "id", required: true }] },
    { name: "runs", kind: "group", description: "Manage task run instances" },
    { name: "runs list", kind: "command", description: "List run instances" },
    { name: "runs detail", kind: "command", description: "Get run detail",
      arguments: [{ name: "id", required: true }] },
    { name: "runs wait", kind: "command", description: "Poll until run completes",
      arguments: [{ name: "id", required: true }] },
    { name: "runs logs", kind: "command", description: "Get run logs",
      arguments: [{ name: "id", required: true }] },
    { name: "runs deps", kind: "command", description: "View run dependencies",
      arguments: [{ name: "id", required: true }] },
    { name: "runs stop", kind: "command", description: "Stop a running instance",
      arguments: [{ name: "id", required: true }] },
    { name: "runs rerun", kind: "command", description: "Rerun a failed instance",
      arguments: [{ name: "id", required: true }] },
    { name: "runs refill", kind: "command", description: "Submit backfill job" },
    { name: "runs stats", kind: "command", description: "Get run statistics summary" },
    { name: "attempts", kind: "group", description: "Manage attempt records" },
    { name: "attempts list", kind: "command", description: "List attempts for a run" },
    { name: "attempts log", kind: "command", description: "Get attempt log" },
    { name: "job", kind: "group", description: "Job performance tools" },
    { name: "job status", kind: "command", description: "Check status/summary of a SQL job",
      arguments: [{ name: "job-id", required: true }] },
    { name: "job result", kind: "command", description: "Fetch result set of a SQL job",
      arguments: [{ name: "job-id", required: true }] },
    { name: "job profile", kind: "command", description: "Show flattened job profile basics from getJobProfile",
      arguments: [{ name: "job-id", required: true }],
      options: [
        { flags: "--raw", required: false, takes_value: false, help: "Show raw profile content" },
        { flags: "--limit", required: false, takes_value: false, help: "Limit raw profile output; use --no-limit to show the full payload" },
        { flags: "--path <file>", required: false, takes_value: true, help: "Write the full raw profile payload to a file" },
      ] },
  ])
}

/**
 * Return the sorted command inventory. Ensures static commands are registered first.
 */
export function buildCommandInventory(): CommandEntry[] {
  if (commandRegistry.length === 0) registerStaticCommands()
  return [...commandRegistry].sort((a, b) => a.name.localeCompare(b.name))
}
