/**
 * Programmatic execution of cz-cli commands.
 * Reuses the same top-level argument classification as the real CLI, but captures output and exit code.
 */
import { defaultFormat, outputState } from "./output/index.js"
import { createCli } from "./cli.js"
import { registerCommands } from "./register-commands.js"
import { classifyCliArgs, emitNoProfile } from "./run-cli.js"
import { SubcommandHelpShown } from "./subcommand-help.js"
import { trackCommand } from "./telemetry.js"

export interface ExecuteResult {
  exitCode: number
  output: string
}

// Mutex to prevent concurrent execute() calls from conflicting on stdout hijacking
let executing: Promise<ExecuteResult> | null = null

export async function execute(command: string, extraArgs?: string[]): Promise<ExecuteResult> {
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
  const startMs = Date.now()
  const args = splitArgs(command)
  if (extraArgs) args.push(...extraArgs)
  if (!args.includes("--format") && !args.some((arg) => arg.startsWith("--format="))) {
    args.push("--format", defaultFormat())
  }

  const chunks: string[] = []
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  const savedExitCode = process.exitCode

  process.stdout.write = ((chunk: any) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as any

  process.stderr.write = ((chunk: any) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as any

  process.exitCode = 0
  try {
    const normalized = classifyCliArgs(args)
    if (normalized.shouldDelegateToAgentRuntime) {
      chunks.push(JSON.stringify({
        error: {
          code: "UNSUPPORTED_PROGRAMMATIC_AGENT_RUNTIME",
          message: "Programmatic execute() cannot run agent runtime commands. Invoke the cz-cli binary instead.",
        },
      }))
      process.exitCode = 1
    } else {
      // Profile gate runs as post-validation middleware: yargs reports syntax
      // errors (unknown command/option) before NO_PROFILE, matching runCli.
      const cli = registerCommands(createCli(normalized.args)).demandCommand(1, "").help()
      if (normalized.requiresProfile) {
        cli.middleware(() => {
          emitNoProfile({
            stdout: { write: process.stdout.write, isTTY: process.stdout.isTTY },
            stderr: { write: process.stderr.write, isTTY: process.stderr.isTTY },
            exit: (code) => {
              process.exitCode = code
              throw new ControlledExit(code)
            },
          })
        }, false)
      }
      await cli.parseAsync()
    }
  } catch (e) {
    if (e instanceof ControlledExit) {
      process.exitCode = e.code
    } else if (e instanceof SubcommandHelpShown) {
      // A bare command group already rendered its help via its fail handler,
      // which wrote into the hijacked stdout (captured in chunks) during
      // parseAsync. Treat it as a successful help request (exit 0), not an
      // error. See subcommand-help.ts.
      process.exitCode = 0
    } else {
      if (!process.exitCode) process.exitCode = 1
      if (!chunks.length) {
        chunks.push(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: String(e) } }))
      }
    }
  }

  const exitCode = process.exitCode ?? 0
  process.stdout.write = originalStdoutWrite
  process.stderr.write = originalStderrWrite
  process.exitCode = savedExitCode ?? 0
  outputState.field = undefined

  const output = chunks.join("")
  const positional = args.filter(a => !a.startsWith("-"))
  const lastError = (process as unknown as Record<string, unknown>).lastError as string | undefined
  if (positional[0] !== "setup") {
    await trackCommand({
      command: positional[0] ?? "unknown",
      subcommand: positional[1],
      duration_ms: Date.now() - startMs,
      success: !exitCode,
      error: exitCode ? lastError ?? `exit_code=${exitCode}` : undefined,
      response_bytes: !exitCode ? Buffer.byteLength(output, "utf-8") : undefined,
    })
  }

  return { exitCode, output }
}

class ControlledExit extends Error {
  constructor(readonly code: number) {
    super(`controlled exit ${code}`)
  }
}

export function splitArgs(input: string): string[] {
  const args: string[] = []
  let current = ""
  let quote = ""
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quote) {
      if (quote === '"' && ch === "\\" && i + 1 < input.length) {
        const next = input[i + 1]
        if (next === '"' || next === "\\") {
          current += next
          i++
          continue
        }
      }
      if (ch === quote) quote = ""
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === "\\" && i + 1 < input.length) {
      current += input[i + 1]
      i++
    } else if (ch === " " || ch === "\t") {
      if (current) { args.push(current); current = "" }
    } else {
      current += ch
    }
  }
  if (current) args.push(current)
  return args
}
