/**
 * Programmatic execution of cz-cli commands.
 * Captures stdout and exit code without calling process.exit().
 */
import { createCli } from "./cli.js"
import { registerSqlCommand } from "./commands/sql.js"
import { registerSchemaCommand } from "./commands/schema.js"
import { registerTableCommand } from "./commands/table.js"
import { registerWorkspaceCommand } from "./commands/workspace.js"
import { registerStatusCommand } from "./commands/status.js"
import { registerProfileCommand } from "./commands/profile.js"
import { registerTaskCommand } from "./commands/task.js"
import { registerRunsCommand } from "./commands/runs.js"
import { registerAttemptsCommand } from "./commands/attempts.js"
import { registerAgentCommand } from "./commands/agent.js"
import { registerJobCommand } from "./commands/job.js"
import { registerAiGuideCommand } from "./commands/ai-guide.js"
import { registerInstallSkillsCommand } from "./commands/install-skills.js"
import { registerSetupCommand } from "./commands/setup.js"

export interface ExecuteResult {
  exitCode: number
  output: string
}

class ExitCapture extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`)
  }
}

// Mutex to prevent concurrent execute() calls from conflicting on process.stdout/exit hijacking
let executing: Promise<ExecuteResult> | null = null

export async function execute(command: string, extraArgs?: string[]): Promise<ExecuteResult> {
  // Serialize concurrent calls
  while (executing) await executing
  const p = executeInternal(command, extraArgs)
  executing = p
  try {
    return await p
  } finally {
    executing = null
  }
}

async function executeInternal(command: string, extraArgs?: string[]): Promise<ExecuteResult> {
  const args = splitArgs(command)
  if (extraArgs) args.push(...extraArgs)
  args.push("--output", "json")

  const chunks: string[] = []
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  const originalExit = process.exit

  // Capture stdout + stderr (matches old behavior of capturing combined output)
  process.stdout.write = ((chunk: any, ...rest: any[]) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as any

  process.stderr.write = ((chunk: any, ...rest: any[]) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as any

  // Capture process.exit
  process.exit = ((code?: number) => {
    throw new ExitCapture(code ?? 0)
  }) as never

  let exitCode = 0
  try {
    const cli = createCli(args)
    registerSqlCommand(cli)
    registerSchemaCommand(cli)
    registerTableCommand(cli)
    registerWorkspaceCommand(cli)
    registerStatusCommand(cli)
    registerProfileCommand(cli)
    registerTaskCommand(cli)
    registerRunsCommand(cli)
    registerAttemptsCommand(cli)
    registerAgentCommand(cli)
    registerJobCommand(cli)
    registerAiGuideCommand(cli)
    registerInstallSkillsCommand(cli)
    registerSetupCommand(cli)
    await cli.demandCommand(1, "").help().parseAsync()
  } catch (e) {
    if (e instanceof ExitCapture) {
      exitCode = e.code
    } else {
      exitCode = 1
      chunks.push(JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: String(e) } }))
    }
  } finally {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exit = originalExit
  }

  return { exitCode, output: chunks.join("") }
}

function splitArgs(input: string): string[] {
  const args: string[] = []
  let current = ""
  let quote = ""
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = ""
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === " " || ch === "\t") {
      if (current) { args.push(current); current = "" }
    } else {
      current += ch
    }
  }
  if (current) args.push(current)
  return args
}
