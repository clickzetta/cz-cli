/**
 * Snapshot of the command/option surface the current tree actually declares.
 *
 * Built by walking yargs' own command registry rather than by parsing src/ or
 * scraping --help: the registry is what the parser will really enforce, so a
 * surface built from it can never drift from behaviour. Each node's builder is
 * applied to a throwaway yargs instance, which is safe because builders only
 * declare (`.option`/`.positional`/`.command`) — nothing in src/commands runs
 * I/O at build time (verified: zero `.middleware(` and a single `.check(` in the
 * whole tree).
 *
 * Two consumers, which is why this lives in test/support rather than inside
 * either one:
 *   - script/export-history-matrix.ts uses the command-name set to whitelist
 *     which historical `_positional` tokens are safe to persist (a token is kept
 *     only when it is literally a subcommand name declared in our own source).
 *   - history-replay.ts uses positional declarations to synthesize the arguments
 *     a historical invocation needs, and option declarations to pick a value
 *     shape yargs will accept.
 */
import yargs, { type Argv } from "yargs"
import { createCli } from "../../src/cli.js"
import { registerCommands } from "../../src/register-commands.js"

export type OptionType = "boolean" | "number" | "string" | "array" | "unknown"

export interface DeclaredOption {
  key: string
  aliases: string[]
  type: OptionType
  choices?: string[]
  demanded: boolean
}

export interface DeclaredPositional {
  name: string
  required: boolean
  variadic: boolean
}

export interface DeclaredCommand {
  /** Full path from the root, e.g. ["task", "cdc", "start-table"]. */
  path: string[]
  /** Raw yargs declaration, e.g. "start-table <task>". */
  original: string
  positionals: DeclaredPositional[]
  /** Options declared on this node (excluding inherited globals). */
  options: DeclaredOption[]
  /** True when the node has child commands of its own. */
  isGroup: boolean
  /**
   * Alternative names this command answers to. Command aliases live in the
   * command instance's `aliasMap`, not in the handler registry, so a surface
   * built from handlers alone reports `profile show` and `task detail` as
   * removed when they are just aliases of `detail` and `content`.
   */
  aliases: string[]
}

export interface Surface {
  /** Global options declared on the root instance (--profile, --format, …). */
  globals: DeclaredOption[]
  commands: DeclaredCommand[]
  byPath: Map<string, DeclaredCommand>
  /** Every declared command token, at any depth — the `_positional` whitelist. */
  commandTokens: Set<string>
  /** Option keys (and aliases) that carry `choices`, unioned across the tree. */
  choicesByKey: Map<string, Set<string>>
}

const YARGS_BUILTIN_OPTIONS = new Set(["help", "version"])

/** Parse the positional part of a yargs command string ("create <name> [dir..]"). */
export function parsePositionals(original: string): DeclaredPositional[] {
  const out: DeclaredPositional[] = []
  for (const match of original.matchAll(/([<[])([^>\]]+)([>\]])/g)) {
    const required = match[1] === "<"
    let name = match[2]!.trim()
    const variadic = name.endsWith("..")
    if (variadic) name = name.slice(0, -2)
    out.push({ name, required, variadic })
  }
  return out
}

function optionsOf(instance: Argv<any>, skip: Set<string>): DeclaredOption[] {
  const raw = (instance as any).getOptions() as {
    key: Record<string, unknown>
    alias: Record<string, string[]>
    boolean: string[]
    number: string[]
    string: string[]
    array: string[]
    choices: Record<string, unknown[]>
    demandedOptions: Record<string, unknown>
  }
  const out: DeclaredOption[] = []
  for (const key of Object.keys(raw.key ?? {})) {
    if (YARGS_BUILTIN_OPTIONS.has(key) || skip.has(key)) continue
    const aliases = raw.alias?.[key] ?? []
    // An alias is registered as its own key too; keep only the canonical name.
    if (Object.entries(raw.alias ?? {}).some(([k, list]) => k !== key && list.includes(key))) continue
    const type: OptionType = raw.array?.includes(key)
      ? "array"
      : raw.boolean?.includes(key)
        ? "boolean"
        : raw.number?.includes(key)
          ? "number"
          : raw.string?.includes(key)
            ? "string"
            : "unknown"
    const choices = raw.choices?.[key]
    out.push({
      key,
      aliases,
      type,
      choices: choices ? choices.map((c) => String(c)) : undefined,
      demanded: Object.prototype.hasOwnProperty.call(raw.demandedOptions ?? {}, key),
    })
  }
  return out
}

function commandInstance(instance: Argv<any>): any {
  try {
    return (instance as any).getInternalMethods().getCommandInstance()
  } catch {
    return undefined
  }
}

function childHandlers(instance: Argv<any>): Record<string, { original: string; builder?: unknown }> {
  return commandInstance(instance)?.getCommandHandlers() ?? {}
}

/** Primary command name -> its aliases, inverted from yargs' alias -> primary map. */
function childAliases(instance: Argv<any>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const map = commandInstance(instance)?.aliasMap as Record<string, string> | undefined
  for (const [alias, primary] of Object.entries(map ?? {})) {
    out.set(primary, [...(out.get(primary) ?? []), alias])
  }
  return out
}

const MAX_DEPTH = 6

export function buildSurface(): Surface {
  const root = registerCommands(createCli([]))
  const globals = optionsOf(root, new Set())
  const globalKeys = new Set(globals.flatMap((o) => [o.key, ...o.aliases]))
  const commands: DeclaredCommand[] = []

  const walk = (instance: Argv<any>, path: string[], depth: number) => {
    const aliases = childAliases(instance)
    for (const [name, handler] of Object.entries(childHandlers(instance))) {
      const original = handler.original ?? name
      const positionals = parsePositionals(original)
      const child = yargs([]).exitProcess(false)
      if (typeof handler.builder === "function") {
        try {
          ;(handler.builder as (y: Argv<any>) => unknown)(child)
        } catch {
          // A builder that cannot run standalone contributes no options; its
          // declaration string is still recorded above.
        }
      }
      const skip = new Set([...globalKeys, ...positionals.flatMap((p) => [p.name, camelCase(p.name)])])
      const grandchildren = childHandlers(child)
      const node: DeclaredCommand = {
        path: [...path, name],
        original,
        positionals,
        options: optionsOf(child, skip),
        isGroup: Object.keys(grandchildren).length > 0,
        aliases: aliases.get(name) ?? [],
      }
      commands.push(node)
      if (depth < MAX_DEPTH) walk(child, node.path, depth + 1)
    }
  }
  walk(root, [], 0)

  const byPath = new Map<string, DeclaredCommand>()
  for (const c of commands) {
    byPath.set(c.path.join(" "), c)
    // An alias resolves to the same node, so a historical invocation that used it
    // resolves to the same declaration (positionals included).
    for (const alias of c.aliases) byPath.set([...c.path.slice(0, -1), alias].join(" "), c)
  }
  const commandTokens = new Set<string>()
  for (const c of commands) {
    for (const token of c.path) commandTokens.add(token)
    for (const alias of c.aliases) commandTokens.add(alias)
  }
  commandTokens.delete("$0")

  const choicesByKey = new Map<string, Set<string>>()
  const addChoices = (o: DeclaredOption) => {
    if (!o.choices) return
    for (const name of [o.key, ...o.aliases]) {
      const set = choicesByKey.get(name) ?? new Set<string>()
      for (const c of o.choices) set.add(c)
      choicesByKey.set(name, set)
    }
  }
  for (const o of globals) addChoices(o)
  for (const c of commands) for (const o of c.options) addChoices(o)

  return { globals, commands, byPath, commandTokens, choicesByKey }
}

export function camelCase(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

/**
 * Resolve the deepest declared command matching a token path, plus the tokens
 * that did not match. `sql` resolves to its `$0` default child so that callers
 * see the options and positionals the parser will actually apply.
 */
export function resolveCommand(surface: Surface, tokens: string[]): {
  node?: DeclaredCommand
  matched: string[]
  rest: string[]
} {
  const matched: string[] = []
  let node: DeclaredCommand | undefined
  for (const token of tokens) {
    const candidate = surface.byPath.get([...matched, token].join(" "))
    if (!candidate) break
    matched.push(token)
    node = candidate
  }
  const rest = tokens.slice(matched.length)
  const fallback = node && surface.byPath.get([...matched, "$0"].join(" "))
  return { node: fallback && !node?.positionals.length ? fallback : node, matched, rest }
}

/** Effective options for a command path: root globals plus every node on the path. */
export function effectiveOptions(surface: Surface, path: string[]): Map<string, DeclaredOption> {
  const out = new Map<string, DeclaredOption>()
  for (const o of surface.globals) out.set(o.key, o)
  for (let i = 1; i <= path.length; i++) {
    const node = surface.byPath.get(path.slice(0, i).join(" "))
    if (!node) continue
    for (const o of node.options) out.set(o.key, o)
  }
  const dollar = surface.byPath.get([...path, "$0"].join(" "))
  if (dollar) for (const o of dollar.options) out.set(o.key, o)
  return out
}
