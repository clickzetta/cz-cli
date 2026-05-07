/**
 * SKILL.md generation pipeline.
 *
 * Reads SKILL.template.md, fills in command inventory / companion skills / version info,
 * writes the generated SKILL.md, and can diff against an existing file to detect drift.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { VERSION } from "./version.js"
import { buildCommandInventory, type CommandEntry } from "./guide-builder.js"

const GUIDE_GENERATOR_VERSION = "1.0.0"

/** Default template path: src/SKILL.template.md (sibling to this file at build time). */
export const SKILL_TEMPLATE_PATH = resolve(import.meta.dirname ?? dirname(new URL(import.meta.url).pathname), "SKILL.template.md")

/** Default output path: skills/cz-cli/SKILL.md relative to repo root. */
export const SKILL_OUTPUT_PATH = resolve(import.meta.dirname ?? dirname(new URL(import.meta.url).pathname), "../../../skills/cz-cli/SKILL.md")

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function skillInventoryMarkdown(inventory: CommandEntry[]): string {
  const grouped = new Map<string, CommandEntry[]>()
  for (const item of inventory) {
    const topLevel = item.name.split(" ", 1)[0]
    if (!grouped.has(topLevel)) grouped.set(topLevel, [])
    grouped.get(topLevel)!.push(item)
  }

  const lines: string[] = []
  for (const topLevel of [...grouped.keys()].sort()) {
    lines.push(`### \`${topLevel}\``)
    const entries = grouped.get(topLevel)!.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      lines.push(`- \`${entry.name}\` - ${entry.description}`)
      if (entry.examples) {
        for (const ex of entry.examples) {
          lines.push(`  - \`${ex.cmd}\` — ${ex.desc}`)
        }
      }
    }
    lines.push("")
  }
  return lines.join("\n").trim() + "\n"
}

export interface CompanionSkill {
  name: string
  description: string
}

function companionSkillsMarkdown(companions: CompanionSkill[] | undefined): string {
  if (!companions || companions.length === 0) {
    return (
      "No additional companion skills are bundled with this installation.\n" +
      "Run `cz-cli install-skills` to check for skills from other sources (e.g. cz-mcp)."
    )
  }

  const lines: string[] = [
    "The following companion skills can be installed alongside `cz-cli` via `cz-cli install-skills`:\n",
  ]
  for (const { name, description } of [...companions].sort((a, b) => a.name.localeCompare(b.name))) {
    if (description) {
      lines.push(`- **${name}** — ${description}`)
    } else {
      lines.push(`- **${name}**`)
    }
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RenderSkillOptions {
  templateText: string
  cliVersion?: string
  companionSkills?: CompanionSkill[]
}

/**
 * Render the full SKILL.md content from template text + command inventory.
 */
export function renderSkillMarkdown(opts: RenderSkillOptions): string {
  const { templateText, cliVersion = VERSION, companionSkills } = opts
  const inventory = buildCommandInventory()
  const commandInventory = skillInventoryMarkdown(inventory)
  const companionSection = companionSkillsMarkdown(companionSkills)

  const replacements: Record<string, string> = {
    "{{CLI_VERSION}}": cliVersion,
    "{{GENERATOR_VERSION}}": GUIDE_GENERATOR_VERSION,
    "{{COMMAND_COUNT}}": String(inventory.length),
    "{{COMMAND_INVENTORY}}": commandInventory.trimEnd(),
    "{{COMPANION_SKILLS}}": companionSection,
  }

  let rendered = templateText
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(key, value)
  }
  return rendered.trimEnd() + "\n"
}

/**
 * Convenience wrapper: read template from default path and render.
 */
export function generateSkillMarkdown(opts?: {
  templatePath?: string
  cliVersion?: string
  companionSkills?: CompanionSkill[]
}): string {
  const templatePath = opts?.templatePath ?? SKILL_TEMPLATE_PATH
  const templateText = readFileSync(templatePath, "utf-8")
  return renderSkillMarkdown({
    templateText,
    cliVersion: opts?.cliVersion,
    companionSkills: opts?.companionSkills,
  })
}

/**
 * Generate and write SKILL.md to disk. Returns the resolved output path.
 */
export function writeGeneratedSkill(opts?: {
  outputPath?: string
  templatePath?: string
  cliVersion?: string
  companionSkills?: CompanionSkill[]
}): string {
  const outputPath = opts?.outputPath ?? SKILL_OUTPUT_PATH
  const rendered = generateSkillMarkdown({
    templatePath: opts?.templatePath,
    cliVersion: opts?.cliVersion,
    companionSkills: opts?.companionSkills,
  })
  const dir = dirname(outputPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(outputPath, rendered, "utf-8")
  return outputPath
}

/**
 * Compare generated SKILL.md against an existing file. Returns a unified diff
 * string if they differ, or empty string if identical.
 */
export function skillDriftDiff(opts?: {
  existingPath?: string
  templatePath?: string
  cliVersion?: string
  companionSkills?: CompanionSkill[]
}): string {
  const existingPath = opts?.existingPath ?? SKILL_OUTPUT_PATH
  const expected = generateSkillMarkdown({
    templatePath: opts?.templatePath,
    cliVersion: opts?.cliVersion,
    companionSkills: opts?.companionSkills,
  })

  let actual = ""
  if (existsSync(existingPath)) {
    actual = readFileSync(existingPath, "utf-8")
  }

  if (expected === actual) return ""

  // Simple unified diff implementation
  const expectedLines = expected.split("\n")
  const actualLines = actual.split("\n")
  return unifiedDiff(actualLines, expectedLines, existingPath, `${existingPath} (generated)`)
}

// ---------------------------------------------------------------------------
// Minimal unified diff (no external deps)
// ---------------------------------------------------------------------------

function unifiedDiff(
  fromLines: string[],
  toLines: string[],
  fromFile: string,
  toFile: string,
): string {
  const output: string[] = []
  output.push(`--- ${fromFile}`)
  output.push(`+++ ${toFile}`)

  // Simple LCS-based diff: for large files we use a chunked approach
  const hunks = computeHunks(fromLines, toLines)
  for (const hunk of hunks) {
    output.push(
      `@@ -${hunk.fromStart + 1},${hunk.fromCount} +${hunk.toStart + 1},${hunk.toCount} @@`,
    )
    for (const line of hunk.lines) {
      output.push(line)
    }
  }
  return output.join("\n")
}

interface Hunk {
  fromStart: number
  fromCount: number
  toStart: number
  toCount: number
  lines: string[]
}

function computeHunks(fromLines: string[], toLines: string[], context = 3): Hunk[] {
  // Myers-like edit script via simple O(ND) for reasonable-sized files
  const edits = myersDiff(fromLines, toLines)
  if (edits.length === 0) return []

  // Group edits into hunks with context
  const hunks: Hunk[] = []
  let i = 0
  while (i < edits.length) {
    // Find start of this hunk (with context)
    let hunkStart = i
    const startFrom = Math.max(0, edits[hunkStart].fromIdx - context)
    const startTo = Math.max(0, edits[hunkStart].toIdx - context)

    // Extend hunk to include nearby edits (within 2*context lines)
    let hunkEnd = i
    while (hunkEnd + 1 < edits.length) {
      const gap = edits[hunkEnd + 1].fromIdx - (edits[hunkEnd].fromIdx + (edits[hunkEnd].type === "delete" ? 1 : 0))
      if (gap <= context * 2) {
        hunkEnd++
      } else {
        break
      }
    }

    // Build hunk lines
    const lines: string[] = []
    let fromPos = startFrom
    let toPos = startTo

    for (let e = hunkStart; e <= hunkEnd; e++) {
      const edit = edits[e]
      // Context before this edit
      while (fromPos < edit.fromIdx && toPos < edit.toIdx) {
        lines.push(` ${fromLines[fromPos]}`)
        fromPos++
        toPos++
      }
      if (edit.type === "delete") {
        lines.push(`-${fromLines[edit.fromIdx]}`)
        fromPos++
      } else if (edit.type === "insert") {
        lines.push(`+${toLines[edit.toIdx]}`)
        toPos++
      }
    }

    // Context after last edit
    const lastEdit = edits[hunkEnd]
    const endFrom = Math.min(fromLines.length, (lastEdit.type === "delete" ? lastEdit.fromIdx + 1 : lastEdit.fromIdx) + context)
    const endTo = Math.min(toLines.length, (lastEdit.type === "insert" ? lastEdit.toIdx + 1 : lastEdit.toIdx) + context)
    while (fromPos < endFrom && toPos < endTo) {
      lines.push(` ${fromLines[fromPos]}`)
      fromPos++
      toPos++
    }

    hunks.push({
      fromStart: startFrom,
      fromCount: fromPos - startFrom,
      toStart: startTo,
      toCount: toPos - startTo,
      lines,
    })

    i = hunkEnd + 1
  }
  return hunks
}

interface Edit {
  type: "insert" | "delete"
  fromIdx: number
  toIdx: number
}

function myersDiff(a: string[], b: string[]): Edit[] {
  // For very large files, fall back to a line-by-line comparison
  // This is a simplified approach that works well for SKILL.md sized files
  const edits: Edit[] = []
  const n = a.length
  const m = b.length

  // Use LCS via dynamic programming for files under 5000 lines
  if (n * m > 25_000_000) {
    // Fallback: treat entire content as replaced
    for (let i = 0; i < n; i++) edits.push({ type: "delete", fromIdx: i, toIdx: 0 })
    for (let j = 0; j < m; j++) edits.push({ type: "insert", fromIdx: n, toIdx: j })
    return edits
  }

  // Standard LCS
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find edits
  let i = n, j = m
  const reverseEdits: Edit[] = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      j--
      reverseEdits.push({ type: "insert", fromIdx: i, toIdx: j })
    } else {
      i--
      reverseEdits.push({ type: "delete", fromIdx: i, toIdx: j })
    }
  }

  return reverseEdits.reverse()
}
