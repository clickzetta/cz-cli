import type { Argv } from "yargs"
import type { GlobalArgs } from "../cli.js"
import { commandGroup } from "../command-group.js"
import { success, error } from "../output/index.js"
import { SemanticViewError } from "../semantic-view/error.js"

const commands = [
  "capabilities",
  "read",
  "describe",
  "list",
  "search",
  "write",
  "edit",
  "compile",
  "plan",
  "validate",
  "deploy",
  "recover",
  "generate",
  "query",
  "audit",
  "suggest",
  "import",
  "backend",
  "optimize",
] as const
export type SvArgs = GlobalArgs & {
  name?: string
  fqn?: string
  source?: string
  filePath?: string
  outPath?: string
  yamlContent?: string
  sourceObject?: string
  operations?: string
  operationsFile?: string
  parameters?: string
  tool?: string
  mode?: string
  write?: boolean
  baseline?: string
  query?: string
  limit?: number
  timeout?: number
  dimensions?: string[]
  metrics?: string[]
  facts?: string[]
  filters?: string[]
  where?: string
  execute?: boolean
  question?: string
  model?: string
  llm?: string
  kind?: string
  data?: boolean
  criteria?: string
  action?: string
  id?: string
  iterations?: number
  stateRoot?: string
  foreground?: boolean
  historyFile?: string
  allowLossy?: boolean
  semanticChanges?: boolean
  evaluate?: boolean
}

export function registerSvCommand(cli: Argv<GlobalArgs>) {
  cli.command("sv", "Create, inspect, edit, validate and deploy ClickZetta semantic views", (y) => {
    commands.forEach((command) =>
      y.command(
        `${command} [name]`,
        descriptions[command],
        (args) =>
          args
            .positional("name", { type: "string" })
            .option("fqn", { type: "string", describe: "Target workspace.schema.view" })
            .option("source", { type: "string", choices: ["remote", "workspace"], default: "remote" })
            .option("file-path", { type: "string", describe: "Input file, or output file for write" })
            .option("out-path", { type: "string", describe: "Save response/model to this path" })
            .option("yaml-content", { type: "string", describe: "Inline model YAML; prefer files for larger inputs" })
            .option("source-object", { type: "string" })
            .option("operations", { type: "string", describe: "JSON operation array; [] lists supported edits" })
            .option("operations-file", { type: "string" })
            .option("parameters", { type: "string", describe: "Backend/import JSON parameters" })
            .option("tool", { type: "string" })
            .option("mode", { type: "string", choices: ["local", "remote", "queries", "all"], default: "local" })
            .option("write", { type: "boolean", default: false, describe: "Execute an authorized remote deployment" })
            .option("baseline", { type: "string", describe: "Expected remote fingerprint, or absent" })
            .option("query", { type: "string" })
            .option("limit", { type: "number", default: 20 })
            .option("timeout", {
              type: "number",
              default: 300,
              describe: "SQL job polling timeout in seconds (default: 300)",
            })
            .option("dimensions", { type: "array", string: true })
            .option("metrics", { type: "array", string: true })
            .option("facts", { type: "array", string: true })
            .option("filters", { type: "array", string: true })
            .option("where", { type: "string" })
            .option("execute", { type: "boolean", default: false })
            .option("question", { type: "string" })
            .option("model", { type: "string" })
            .option("llm", { type: "string" })
            .option("kind", { type: "string" })
            .option("data", { type: "boolean", default: false })
            .option("criteria", { type: "string" })
            .option("action", { type: "string", choices: ["start", "get", "list", "cancel", "run"], default: "start" })
            .option("id", { type: "string" })
            .option("iterations", { type: "number", default: 3 })
            .option("state-root", { type: "string" })
            .option("foreground", { type: "boolean", default: false })
            .option("semantic-changes", {
              type: "boolean",
              default: false,
              describe: "Evaluate structural candidates in disposable server views; requires --evaluate --write",
            })
            .option("evaluate", {
              type: "boolean",
              default: false,
              describe: "Measure held-out VQR query accuracy using actual readonly results",
            })
            .option("history-file", { type: "string" })
            .option("allow-lossy", { type: "boolean", default: false }),
        async (argv) => {
          try {
            const { runSv } = await import("../semantic-view/commands.js")
            const result = await runSv(command, argv as SvArgs)
            success(result, { format: argv.format })
          } catch (e) {
            error(e instanceof SemanticViewError ? e.code : "SV_ERROR", e instanceof Error ? e.message : String(e), {
              format: argv.format,
              ...(e instanceof SemanticViewError ? { extra: { details: e.details } } : {}),
            })
          }
        },
      ),
    )
    return commandGroup(y, "sv")
  })
}
const descriptions: Record<(typeof commands)[number], string> = {
  capabilities: "Describe supported native and managed semantics",
  read: "Read remote or workspace model",
  describe: "Read a remote semantic view",
  list: "List semantic views",
  search: "Search view metadata",
  write: "Atomically save a model locally",
  edit: "Apply structured model edits atomically",
  compile: "Compile model to native SQL without deployment",
  plan: "Read target baseline and validate candidate DDL",
  validate: "Validate model, remote DDL or verified queries",
  deploy: "Deploy model, restore properties and verify readback",
  recover: "Recover a recorded partial deployment",
  generate: "Generate a model using configured LLM and supplied metadata",
  query: "Build or generate a query; execute only with --execute",
  audit: "Audit model quality and optionally source data",
  suggest: "Suggest relationships, metrics, filters, descriptions or VQRs",
  import: "Analyze or convert OSI semantic models",
  backend: "Invoke a semantic workflow tool",
  optimize: "Start, inspect, cancel or run a persistent optimization job",
}
