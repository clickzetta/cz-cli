import { spawnSync } from "child_process"
import path from "path"
import type { CommandModule } from "yargs"

function resolveCzTool(): string {
  const binDir = path.dirname(process.execPath)
  const name = process.platform === "win32" ? "cz-tool.exe" : "cz-tool"
  return path.join(binDir, "cz-tool", name)
}

function forward(args: readonly string[]): never {
  const bin = resolveCzTool()
  const result = spawnSync(bin, args as string[], {
    stdio: "inherit",
    env: process.env,
  })
  if (result.error) {
    const msg =
      (result.error as NodeJS.ErrnoException).code === "ENOENT"
        ? `cz-tool not found at ${bin}. Is it bundled correctly?`
        : `Failed to run cz-tool: ${result.error.message}`
    process.stderr.write(msg + "\n")
    process.exit(127)
  }
  process.exit(result.status ?? 1)
}

function createForwardCommand(command: string, describe: string): CommandModule {
  return {
    command: `${command}`,
    describe,
    builder: (yargs) => yargs.help(false).version(false).strict(false).parserConfiguration({ "unknown-options-as-args": true }),
    handler: () => {
      const idx = process.argv.indexOf(command)
      const rawArgs = idx >= 0 ? process.argv.slice(idx) : [command]
      forward(rawArgs)
    },
  }
}

export const SqlForward = createForwardCommand("sql", "execute SQL queries")
export const TaskForward = createForwardCommand("task", "manage Studio tasks")
export const RunsForward = createForwardCommand("runs", "manage task runs")
export const TableForward = createForwardCommand("table", "manage tables")
export const SchemaForward = createForwardCommand("schema", "manage schemas")
export const WorkspaceForward = createForwardCommand("workspace", "manage workspaces")
export const JobForward = createForwardCommand("job", "job performance analysis")
export const AttemptsForward = createForwardCommand("attempts", "manage attempt records")
export const StatusForward = createForwardCommand("status", "show connection status")
export const AiGuideForward = createForwardCommand("ai-guide", "output AI agent usage guide")
export const InstallSkillsForward = createForwardCommand("install-skills", "install AI skills")
export const ProfileForward = createForwardCommand("profile", "manage connection profiles")

export { resolveCzTool }
