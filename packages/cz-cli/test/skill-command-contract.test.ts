import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { KNOWN_GLOBAL_FLAGS, KNOWN_TOP_COMMANDS, createCli } from "../src/cli.js"
import { registerCommands } from "../src/register-commands.js"

const VALUELESS_GLOBALS = new Set(["debug", "d", "help", "h", "version", "v"])
const AGENT_RUNTIME_SUBCOMMANDS = new Set(["run", "llm", "session", "stats", "export"])

function extractSkillInvocations(markdown: string): string[][] {
  const lines = markdown.split("\n")
  const invocations: string[][] = []
  const state = { inShellFence: false, continuation: "" }

  lines.forEach((rawLine) => {
    const trimmed = rawLine.trim()
    if (/^```(?:bash|sh)?\s*$/.test(trimmed)) {
      state.inShellFence = !state.inShellFence
      state.continuation = ""
      return
    }
    if (trimmed.startsWith("```")) {
      state.inShellFence = false
      state.continuation = ""
      return
    }

    if (state.inShellFence) {
      if (!trimmed || trimmed.startsWith("#")) return
      if (state.continuation) {
        const piece = trimmed.endsWith("\\") ? trimmed.slice(0, -1).trim() : trimmed
        state.continuation = `${state.continuation} ${piece}`
        if (!trimmed.endsWith("\\")) {
          collectFromCommandString(state.continuation, invocations)
          state.continuation = ""
        }
        return
      }
      if (trimmed.includes("cz-cli ") && trimmed.endsWith("\\")) {
        state.continuation = trimmed.slice(0, -1).trim()
        return
      }
      collectFromCommandString(trimmed, invocations)
      return
    }

    // Outside shell fences, extract inline backtick spans (`cz-cli ...`) and JSON progress command strings ("$ cz-cli ...").
    for (const span of rawLine.matchAll(/`cz-cli\s+([^`]+)`/g)) {
      collectFromCommandString(`cz-cli ${span[1]}`, invocations)
    }
    for (const quoted of rawLine.matchAll(/"\$\s*cz-cli\s+([^"]+)"/g)) {
      collectFromCommandString(`cz-cli ${quoted[1]}`, invocations)
    }
  })

  return invocations
}

function collectFromCommandString(commandLine: string, out: string[][]) {
  const match = /(?:^|[($\s])cz-cli\s+([^\n|)]+)/.exec(commandLine)
  if (!match?.[1]) return
  const raw = match[1].replace(/\s+#.*$/, "").trim()
  if (!raw) return
  const tokens = raw
    .split(/\s+/)
    .map((tok) => tok.replace(/[,.;:]+$/, ""))
    .filter(Boolean)
  if (tokens.length > 0) out.push(tokens)
}

function resolveFirstPositionalAfterGlobals(tokens: string[]): { command?: string; rest: string[] } {
  const knownGlobals = new Set(KNOWN_GLOBAL_FLAGS)
  const cursor = { index: 0 }
  while (cursor.index < tokens.length) {
    const token = tokens[cursor.index]!
    cursor.index += 1
    if (token.startsWith("<") || token.startsWith("[") || token === "...") continue
    if (token.startsWith("--")) {
      const flagName = token.slice(2).split("=", 1)[0]!
      if (!token.includes("=") && knownGlobals.has(flagName) && !VALUELESS_GLOBALS.has(flagName)) {
        cursor.index += 1
      }
      continue
    }
    if (token.startsWith("-") && token.length > 1) {
      const shortName = token.slice(1, 2)
      if (token.length === 2 && knownGlobals.has(shortName) && !VALUELESS_GLOBALS.has(shortName)) {
        cursor.index += 1
      }
      continue
    }
    return { command: token, rest: tokens.slice(cursor.index) }
  }
  return { rest: [] }
}

test("every cz-cli command and subcommand documented in skills/cz-cli/SKILL.md exists and avoids removed -o/--output flags", async () => {
  const skillPath = path.resolve(import.meta.dir, "../../../skills/cz-cli/SKILL.md")
  const skillText = readFileSync(skillPath, "utf8")
  const invocations = extractSkillInvocations(skillText)
  expect(invocations.length).toBeGreaterThan(15)

  const knownTop = new Set(KNOWN_TOP_COMMANDS)
  const helpCache = new Map<string, string>()
  const readHelp = async (cmdPath: string[]) => {
    const key = cmdPath.join(" ")
    if (!helpCache.has(key)) {
      const help = await registerCommands(createCli([...cmdPath, "--help"])).getHelp()
      helpCache.set(key, help)
    }
    return helpCache.get(key)!
  }

  for (const tokens of invocations) {
    // Removed legacy output flags (-o / --output) must never appear in SKILL.md examples.
    expect(tokens.includes("-o") || tokens.includes("--output")).toBe(false)

    const { command, rest } = resolveFirstPositionalAfterGlobals(tokens)
    if (!command) continue
    expect(knownTop.has(command)).toBe(true)

    const sub = rest[0]
    if (!sub || sub.startsWith("-") || sub.startsWith("<") || sub.startsWith("[") || sub.startsWith('"') || sub === "...") {
      continue
    }

    if (command === "agent") {
      expect(AGENT_RUNTIME_SUBCOMMANDS.has(sub)).toBe(true)
      continue
    }

    const groupHelp = await readHelp([command])
    // If the command group lists subcommands (e.g. task, profile, auth), verify the documented subcommand appears in its help output.
    if (groupHelp.includes(`cz-cli ${command} `)) {
      expect(groupHelp).toContain(`cz-cli ${command} ${sub}`)
    }

    // Verify nested third-level command groups (such as `task integration setup` or `task cdc tables`).
    const nested = rest[1]
    if (
      nested &&
      !nested.startsWith("-") &&
      !nested.startsWith("<") &&
      !nested.startsWith("[") &&
      (sub === "integration" || sub === "cdc" || sub === "flow")
    ) {
      const subHelp = await readHelp([command, sub])
      expect(subHelp).toContain(`cz-cli ${command} ${sub} ${nested}`)
    }
  }
})
