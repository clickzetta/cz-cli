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
  const selfDir = dirname(new URL(import.meta.url).pathname)
  const exeDir = dirname(resolve(process.execPath))
  const candidates = [
    // Installed location: ~/.clickzetta/skills
    join(homedir(), ".clickzetta", "skills"),
    // Compiled binary: skills/ is sibling to the binary
    join(exeDir, "skills"),
    join(selfDir, "skills"),
    // Dev mode: from src/commands/ → ../../skills (repo root skills/)
    join(selfDir, "..", "..", "..", "..", "skills"),
    // Dev mode: from src/commands/ → ../skills
    join(selfDir, "..", "..", "skills"),
    join(selfDir, "..", "skills"),
    // Fallback: cwd
    join(process.cwd(), "skills"),
  ]
  for (const dir of candidates) {
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir
  }
  throw new Error("Could not find skills directory. Ensure cz-cli is properly installed.")
}

function getMcpSkillsDir(): string | null {
  const candidates: string[] = []

  const envPath = process.env.CZ_MCP_SERVER_PATH?.trim()
  if (envPath) {
    const raw = expandPath(envPath)
    candidates.push(join(raw, "cz_mcp", "skills"), join(raw, "skills"))
  }

  const selfDir = dirname(new URL(import.meta.url).pathname)
  const repoRoot = resolve(selfDir, "..", "..", "..")
  candidates.push(join(repoRoot, "..", "claude-skills-mcp", "cz-mcp-server", "cz_mcp", "skills"))

  for (const p of candidates) {
    if (existsSync(p) && statSync(p).isDirectory()) return p
  }
  return null
}

function listSkillNames(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return []
  return readdirSync(skillsDir).filter((name) => {
    if (name.startsWith("__") || name === "__pycache__") return false
    const full = join(skillsDir, name)
    return existsSync(full) && statSync(full).isDirectory()
  }).sort()
}

interface DiscoveredSkills {
  skillSources: Map<string, string>
  sourceDirs: Map<string, string>
  duplicates: string[]
}

function discoverAllSkills(): DiscoveredSkills {
  const sourceDirs = new Map<string, string>()
  sourceDirs.set("cz-cli", getPackageSkillsDir())
  const mcpDir = getMcpSkillsDir()
  if (mcpDir) sourceDirs.set("cz-mcp", mcpDir)

  const skillSources = new Map<string, string>()
  const duplicates: string[] = []

  for (const [, baseDir] of sourceDirs) {
    for (const name of listSkillNames(baseDir)) {
      if (skillSources.has(name)) {
        duplicates.push(name)
        continue
      }
      skillSources.set(name, join(baseDir, name))
    }
  }
  return { skillSources, sourceDirs, duplicates }
}

function prioritizeSkillNames(names: string[]): string[] {
  const primary = names.filter((n) => n === "czcli")
  const rest = names.filter((n) => n !== "czcli").sort()
  return [...primary, ...rest]
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
        const { skillSources, sourceDirs, duplicates } = discoverAllSkills()
        if (skillSources.size === 0) {
          error("NO_SKILLS", "No skills found in package.", { format })
        }

        if (duplicates.length > 0 && !silent) {
          process.stderr.write(`Warning: duplicate skills ignored from lower-priority sources: ${duplicates.join(", ")}\n`)
        }

        const skillNames = prioritizeSkillNames([...skillSources.keys()])

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

        let selectedSkills: string[]
        if (yes) {
          selectedSkills = skillNames
        } else if (!process.stdin.isTTY) {
          selectedSkills = skillNames
        } else {
          const allAnswer = await prompt("Install all available skills? (Y/n): ")
          if (!allAnswer || allAnswer.toLowerCase() === "y" || allAnswer.toLowerCase() === "yes") {
            selectedSkills = skillNames
          } else {
            process.stderr.write("Available skills:\n")
            skillNames.forEach((s, i) => process.stderr.write(`  ${i + 1}. ${s}\n`))
            const answer = await prompt("Select skills (comma-separated numbers, e.g. 1,3): ")
            const indices = answer.split(",").map((s) => parseInt(s.trim(), 10) - 1).filter((i) => i >= 0 && i < skillNames.length)
            selectedSkills = indices.length > 0 ? indices.map((i) => skillNames[i]) : skillNames
          }
        }

        const installed: { tool: string; skill: string; path: string }[] = []
        const failed: { tool: string; skill: string }[] = []

        for (const tool of selectedTools) {
          const targetPath = expandPath(TOOL_CONFIGS[tool])
          for (const skill of selectedSkills) {
            const sourceDir = skillSources.get(skill)
            if (!sourceDir) continue
            const sourceDirParent = dirname(sourceDir)
            if (copySkill(sourceDirParent, targetPath, skill)) {
              installed.push({ tool, skill, path: join(targetPath, skill) })
            } else {
              failed.push({ tool, skill })
            }
          }
        }

        const sourceLabels = [...sourceDirs.entries()].map(([label, dir]) => `${label}: ${dir}`)
        logOperation("install-skills", { ok: true })
        success({ installed, failed, skills_sources: sourceLabels, duplicates_ignored: duplicates }, { format })
      } catch (err) {
        error("INSTALL_ERROR", err instanceof Error ? err.message : String(err), { format })
      }
    },
  )
}
