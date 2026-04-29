import type { Argv } from "yargs"
import { existsSync, mkdirSync, readdirSync, cpSync, rmSync, statSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { homedir } from "node:os"
import { createInterface } from "node:readline"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"

const TOOL_CONFIGS: Record<string, string> = {
  "Claude Code": "~/.claude/skills",
  "OpenClaw": "~/.openclaw/workspace/skills",
  "Cursor": "~/.cursor/skills",
  "Kiro": "~/.kiro/skills",
  "Codex": "~/.codex/skills",
  "OpenCode": "~/.opencode/skills",
  "GitHub Copilot": "~/.github/skills",
  "Qoder": "~/.qoder/skills",
  "Trae": "~/.trae/skills",
  "Singclaw": "~/.singclaw/workspace/skills",
}

function expandPath(p: string): string {
  if (p.startsWith("~")) return join(homedir(), p.slice(1))
  return resolve(p)
}

function getPackageSkillsDir(): string {
  const candidates = [
    join(dirname(new URL(import.meta.url).pathname), "..", "..", "skills"),
    join(dirname(new URL(import.meta.url).pathname), "..", "skills"),
    join(process.cwd(), "skills"),
  ]
  for (const dir of candidates) {
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir
  }
  throw new Error("Could not find skills directory. Ensure cz-tool is properly installed.")
}

function discoverSkills(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return []
  return readdirSync(skillsDir).filter((name) => {
    if (name.startsWith("__") || name === "__pycache__") return false
    const full = join(skillsDir, name)
    return existsSync(full) && statSync(full).isDirectory()
  }).sort()
}

function copySkill(sourceDir: string, targetDir: string, skillName: string): boolean {
  const target = join(targetDir, skillName)
  try {
    if (existsSync(target)) rmSync(target, { recursive: true })
    mkdirSync(targetDir, { recursive: true })
    cpSync(join(sourceDir, skillName), target, { recursive: true })
    return true
  } catch {
    return false
  }
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export function registerInstallSkillsCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "install-skills",
    "Install AI skills to coding tools",
    (yargs) =>
      yargs
        .option("global", { alias: "g", type: "boolean", default: false, describe: "Install to Claude Code global skills" })
        .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip prompts, install all" })
        .option("silent", { type: "boolean", default: false, describe: "Suppress output" }),
    async (argv) => {
      const format = argv.output
      const silent = argv.silent
      const yes = argv.yes || silent

      try {
        const skillsDir = getPackageSkillsDir()
        const skillNames = discoverSkills(skillsDir)
        if (skillNames.length === 0) {
          error("NO_SKILLS", "No skills found in package.", { format })
        }

        let selectedTools: string[]
        if (yes) {
          selectedTools = Object.keys(TOOL_CONFIGS)
        } else if (argv.global) {
          selectedTools = ["Claude Code"]
        } else {
          const toolList = Object.keys(TOOL_CONFIGS)
          if (!process.stdin.isTTY) {
            selectedTools = ["Claude Code"]
          } else {
            process.stderr.write("Available tools:\n")
            toolList.forEach((t, i) => process.stderr.write(`  ${i + 1}. ${t}\n`))
            const answer = await prompt(`Select tool (1-${toolList.length}, default 1): `)
            const idx = answer ? parseInt(answer, 10) - 1 : 0
            selectedTools = [toolList[Math.max(0, Math.min(idx, toolList.length - 1))]]
          }
        }

        const installed: { tool: string; skill: string; path: string }[] = []
        const failed: { tool: string; skill: string }[] = []

        for (const tool of selectedTools) {
          const targetPath = expandPath(TOOL_CONFIGS[tool])
          for (const skill of skillNames) {
            if (copySkill(skillsDir, targetPath, skill)) {
              installed.push({ tool, skill, path: join(targetPath, skill) })
            } else {
              failed.push({ tool, skill })
            }
          }
        }

        logOperation("install-skills", { ok: true })
        success({ installed, failed, skills_source: skillsDir }, { format })
      } catch (err) {
        error("INSTALL_ERROR", err instanceof Error ? err.message : String(err), { format })
      }
    },
  )
}
