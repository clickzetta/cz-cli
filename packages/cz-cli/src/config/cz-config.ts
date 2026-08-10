// cz_change: cz-cli's own user config file — the switches that change how the CLI
// behaves. Deliberately NOT profiles.toml: that file is the credential store, one
// entry per environment, and a behaviour switch is neither a credential nor
// per-connection.
//
// The candidate list and the parser used to live inside bootstrap/update.ts, whose
// only key was `autoupdate`. They moved here so the next switch does not have to
// re-derive WHERE the config file is or HOW to read it — one list, one parser, one
// file for the user to edit.

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse as parseToml } from "smol-toml"
import { jsonc } from "opencode/config/parse"
import { parseBoolish } from "../util/boolish.js"

const CLICKZETTA_DIR = ".clickzetta"

/** The path we document and point users at. */
export const CZ_CONFIG_FILE = `~/${CLICKZETTA_DIR}/czcli.json`

function homeDirectory(home?: string, env: NodeJS.ProcessEnv = process.env) {
  return home ?? env.CLICKZETTA_TEST_HOME ?? os.homedir()
}

/**
 * Every path cz-cli reads its config from, LOWEST precedence first: a later file
 * that defines a key overrides an earlier one.
 *
 * `~/.clickzetta/czcli.json` is the canonical location. The XDG paths are honoured
 * too because a user who already keeps an agent config there reasonably expects
 * CLI settings to work from the same file.
 */
export function czConfigCandidates(home?: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const root = homeDirectory(home, env)
  const xdg = env.XDG_CONFIG_HOME ?? path.join(root, ".config")
  return [
    path.join(root, CLICKZETTA_DIR, "czcli.json"),
    path.join(root, CLICKZETTA_DIR, "czcli.jsonc"),
    path.join(xdg, "clickzetta", "opencode.jsonc"),
    path.join(xdg, "clickzetta", "opencode.json"),
    path.join(xdg, "clickzetta", "config.json"),
  ]
}

/**
 * Parse config text: JSONC first — a superset of JSON, so plain `.json`, comments
 * and trailing commas all land there — then TOML.
 *
 * An unparseable file yields {} instead of throwing. A hand-edited config with one
 * stray comma must not take down every command that reads a switch; the cost is
 * that the file is silently ignored, which the user sees as "my setting did nothing".
 */
export function parseCzConfigText(text: string): Record<string, unknown> {
  for (const parse of [jsonc, parseToml] as const) {
    try {
      const parsed = parse(text, CZ_CONFIG_FILE)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // try the next format
    }
  }
  return {}
}

/** Merged config across all candidates, later files winning key by key. */
export async function readCzConfig(
  input: { home?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<Record<string, unknown>> {
  const merged: Record<string, unknown> = {}
  for (const file of czConfigCandidates(input.home, input.env ?? process.env)) {
    const text = await fs.readFile(file, "utf-8").catch(() => undefined)
    if (text) Object.assign(merged, parseCzConfigText(text))
  }
  return merged
}

/**
 * Read a boolean switch. Returns undefined when unset OR unrecognised, so the
 * caller keeps its own default instead of flipping behaviour on a typo — see
 * {@link parseBoolish}, which also accepts the quoted spellings a TOML/JSON file
 * gets hand-written with.
 */
export async function czConfigBool(
  key: string,
  input: { home?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<boolean | undefined> {
  return parseBoolish((await readCzConfig(input))[key])
}
