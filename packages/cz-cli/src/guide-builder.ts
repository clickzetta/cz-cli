import type { Argv } from "yargs"
import { VERSION } from "./version.js"

const GUIDE_GENERATOR_VERSION = "1.0.0"
const DEFAULT_BUDGET_CHARS = 40000

interface CommandEntry {
  name: string
  kind: "command" | "group"
  description: string
  options?: OptionEntry[]
  arguments?: ArgumentEntry[]
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

function dropParameterDetails(commands: Record<string, unknown>[]): boolean {
  let changed = false
  for (const cmd of commands) {
    if (cmd.options) { delete cmd.options; changed = true }
    if (cmd.arguments) { delete cmd.arguments; changed = true }
  }
  return changed
}

function dropDescriptions(commands: Record<string, unknown>[]): boolean {
  let changed = false
  for (const cmd of commands) {
    if (cmd.description) { delete cmd.description; changed = true }
  }
  return changed
}

function applyBudget(payload: Record<string, unknown>, budgetChars: number): Record<string, unknown> {
  const commands = payload.commands as Record<string, unknown>[]
  const beforeChars = serializePayloadLength(payload)
  const appliedSteps: string[] = []

  if (beforeChars <= budgetChars) {
    payload.truncation = { applied: false, budget_chars: budgetChars, estimated_chars: beforeChars }
    return payload
  }

  const steps: [string, () => boolean][] = [
    ["drop_parameter_details", () => dropParameterDetails(commands)],
    ["drop_descriptions", () => dropDescriptions(commands)],
  ]

  for (const [name, fn] of steps) {
    if (fn()) appliedSteps.push(name)
    if (serializePayloadLength(payload) <= budgetChars) break
  }

  payload.truncation = {
    applied: true,
    budget_chars: budgetChars,
    estimated_chars_before: beforeChars,
    estimated_chars_after: serializePayloadLength(payload),
    steps_applied: appliedSteps,
  }
  return payload
}

export function buildAiGuide(options?: { wide?: boolean; budgetChars?: number }): GuidePayload {
  const wide = options?.wide ?? false
  const budgetChars = options?.budgetChars ?? (wide ? 300000 : DEFAULT_BUDGET_CHARS)
  const cliName = "cz-tool"

  const sorted = [...commandRegistry].sort((a, b) => a.name.localeCompare(b.name))
  const commandsDicts = sorted.map((e) => {
    const d: Record<string, unknown> = { name: e.name, kind: e.kind, description: e.description }
    if (e.options && e.options.length > 0) d.options = e.options
    if (e.arguments && e.arguments.length > 0) d.arguments = e.arguments
    return d
  })

  const payload: Record<string, unknown> = {
    name: cliName,
    version: VERSION,
    guide_generator_version: GUIDE_GENERATOR_VERSION,
    description: "AI-Agent-friendly CLI for ClickZetta Lakehouse",
    global_options: {
      order: "Global options must appear before subcommand.",
      usage_pattern: `${cliName} [GLOBAL_OPTIONS] <subcommand> [args]`,
      options: [
        { flags: "--profile, -p", required: false, takes_value: true, help: "Profile name" },
        { flags: "--output, -o", required: false, takes_value: true, help: "Output format", default: "json" },
        { flags: "--debug, -d", required: false, takes_value: false, help: "Debug mode" },
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
    },
    safety: {
      write_protection: "Write operations require --write. DELETE/UPDATE without WHERE are blocked.",
      pagination: "List commands default to page 1; use --page/--page-size or --limit.",
    },
    exit_codes: { "0": "success", "1": "business error", "2": "usage error" },
    tips: {
      help: `Run '${cliName} <subcommand> --help' for parameter details.`,
      profile: "Use --profile for reusable connection config.",
    },
  }

  if (!wide) dropParameterDetails(commandsDicts)

  return applyBudget(structuredClone(payload), budgetChars) as unknown as GuidePayload
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
    { name: "table history", kind: "command", description: "Show table history" },
    { name: "table create", kind: "command", description: "Create a table from DDL",
      arguments: [{ name: "ddl", required: true }] },
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
    { name: "agent", kind: "group", description: "AI Agent commands" },
    { name: "agent status", kind: "command", description: "Check AI Agent health" },
    { name: "agent ask", kind: "command", description: "Send question to AI Agent",
      arguments: [{ name: "question", required: true }] },
    { name: "status", kind: "command", description: "Check connection status" },
    { name: "ai-guide", kind: "command", description: "Generate AI-friendly command reference" },
  ])
}
