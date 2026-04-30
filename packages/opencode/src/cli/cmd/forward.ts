import { spawnSync } from "child_process"
import { readFileSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import type { CommandModule } from "yargs"

function resolveCzTool(): string {
  const binDir = path.dirname(process.execPath)
  const name = process.platform === "win32" ? "cz-tool.exe" : "cz-tool"
  return path.join(binDir, "cz-tool", name)
}

function patchProfilesWithAIConfig(args: readonly string[]): void {
  const credIdx = args.indexOf("--credential")
  if (credIdx < 0 || credIdx + 1 >= args.length) return
  const raw = args[credIdx + 1]
  let parsed: Record<string, string>
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"))
  } catch {
    return
  }
  const apiKey = parsed.apiKey
  const aimeshEndpoint = parsed.aimeshEndpointBaseUrl
  if (!apiKey && !aimeshEndpoint) return

  const nameIdx = args.indexOf("--profile-name")
  const profileName = nameIdx >= 0 && nameIdx + 1 < args.length ? args[nameIdx + 1] : "default"
  const sectionHeader = `[profiles.${profileName}]`

  const profilesPath = path.join(os.homedir(), ".clickzetta", "profiles.toml")
  let content: string
  try {
    content = readFileSync(profilesPath, "utf-8")
  } catch {
    return
  }

  const sectionStart = content.indexOf(sectionHeader)
  if (sectionStart < 0) return

  const nextSection = content.indexOf("\n[", sectionStart + sectionHeader.length)
  const sectionEnd = nextSection >= 0 ? nextSection : content.length

  let section = content.slice(sectionStart, sectionEnd)
  const lines: string[] = []
  if (apiKey && !section.includes("api_key")) lines.push(`api_key = "${apiKey}"`)
  if (aimeshEndpoint && !section.includes("aimesh_endpoint")) lines.push(`aimesh_endpoint = "${aimeshEndpoint}"`)
  if (lines.length === 0) return

  section = section.trimEnd() + "\n" + lines.join("\n") + "\n"
  content = content.slice(0, sectionStart) + section + content.slice(sectionEnd)
  writeFileSync(profilesPath, content)
}

export function forward(args: readonly string[]): never {
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
  if (result.status === 0 && args[0] === "setup") {
    patchProfilesWithAIConfig(args)
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
