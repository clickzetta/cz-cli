import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import * as p from "@clack/prompts"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import { getDefaultProfileName } from "../connection/profile-store.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"

// The MCP server name written into every client config. `cz-cli mcp serve` is
// the stdio entrypoint clients spawn.
const SERVER_NAME = "cz-cli"

export type ClientId = "claude" | "cursor" | "codex"
export const ALL_CLIENTS: ClientId[] = ["claude", "cursor", "codex"]

type ConfigFormat = "json" | "toml"

interface ClientTarget {
  id: ClientId
  label: string
  format: ConfigFormat
  // Top-level key holding the server map. JSON clients use camelCase
  // "mcpServers"; Codex TOML uses "mcp_servers".
  key: "mcpServers" | "mcp_servers"
  // Resolve the config file path for the requested scope.
  path: (global: boolean, cwd: string) => string
  // Whether this client looks "installed" for auto-detection.
  detect: (global: boolean, cwd: string) => boolean
}

// Resolved lazily so tests can override CLICKZETTA_TEST_HOME per case.
function czHome(): string {
  return process.env.CLICKZETTA_TEST_HOME || homedir()
}

export const CLIENTS: Record<ClientId, ClientTarget> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    format: "json",
    key: "mcpServers",
    path: (global, cwd) => (global ? join(czHome(), ".claude.json") : join(cwd, ".mcp.json")),
    detect: (global, cwd) => existsSync(global ? join(czHome(), ".claude.json") : join(cwd, ".mcp.json")),
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    format: "json",
    key: "mcpServers",
    path: (global, cwd) => (global ? join(czHome(), ".cursor", "mcp.json") : join(cwd, ".cursor", "mcp.json")),
    detect: (global, cwd) => existsSync(global ? join(czHome(), ".cursor") : join(cwd, ".cursor")),
  },
  codex: {
    id: "codex",
    label: "Codex",
    format: "toml",
    key: "mcp_servers",
    path: (global, cwd) => (global ? join(czHome(), ".codex", "config.toml") : join(cwd, ".codex", "config.toml")),
    detect: (global, cwd) => existsSync(global ? join(czHome(), ".codex") : join(cwd, ".codex")),
  },
}

// Build the args array for `cz-cli mcp serve`, baking in the resolved profile
// so the server connects to the same ClickZetta profile the user installed.
function serveArgs(profile?: string): string[] {
  const args = ["mcp", "serve"]
  if (profile) args.push("--profile", profile)
  return args
}

// The server entry every client gets. `command` is the running binary's real
// path (process.execPath); under Bun single-file builds argv[1] is a virtual
// /$bunfs path, so execPath is the only reliable value.
function serverEntry(profile?: string): { command: string; args: string[] } {
  return { command: process.execPath, args: serveArgs(profile) }
}

// Atomically write text via tmp+rename so a crash never leaves a half-written
// client config. Unlike profiles.toml these are not secret, so default mode.
function atomicWrite(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + ".tmp." + Date.now()
  writeFileSync(tmp, content, { encoding: "utf-8" })
  renameSync(tmp, file)
}

// Merge the cz-cli server entry into a JSON client config, preserving every
// other server and top-level field. Returns the serialized document.
function mergeJson(existing: string | undefined, key: string, profile?: string): string {
  let doc: Record<string, unknown> = {}
  if (existing && existing.trim()) {
    try {
      doc = JSON.parse(existing) as Record<string, unknown>
    } catch {
      // Malformed config: surface as an error rather than clobbering it.
      throw new Error("existing config is not valid JSON")
    }
  }
  const servers = (doc[key] && typeof doc[key] === "object" ? doc[key] : {}) as Record<string, unknown>
  servers[SERVER_NAME] = serverEntry(profile)
  doc[key] = servers
  return JSON.stringify(doc, null, 2) + "\n"
}

// Merge into a Codex TOML config; upsert [mcp_servers.cz-cli].
function mergeToml(existing: string | undefined, key: string, profile?: string): string {
  let doc: Record<string, unknown> = {}
  if (existing && existing.trim()) {
    try {
      doc = parseTOML(existing) as Record<string, unknown>
    } catch {
      throw new Error("existing config is not valid TOML")
    }
  }
  const servers = (doc[key] && typeof doc[key] === "object" ? doc[key] : {}) as Record<string, unknown>
  servers[SERVER_NAME] = serverEntry(profile)
  doc[key] = servers
  return stringifyTOML(doc) + "\n"
}

// Write cz-cli into one client's config. Throws on failure so the caller can
// record a per-client result without aborting the others.
export function writeClient(target: ClientTarget, global: boolean, cwd: string, profile?: string): string {
  const file = target.path(global, cwd)
  const existing = existsSync(file) ? readFileSync(file, "utf-8") : undefined
  const merged = target.format === "json" ? mergeJson(existing, target.key, profile) : mergeToml(existing, target.key, profile)
  atomicWrite(file, merged)
  return file
}

// Interactive client picker. Uses @clack/prompts (same TUI as `cz-cli login` /
// `setup`) so the whole CLI shares one interaction style. Detected clients are
// pre-checked; a cancel (Esc/Ctrl-C) exits cleanly with a "cancelled" notice.
async function promptSelection(detected: ClientId[]): Promise<ClientId[]> {
  const result = await p.multiselect({
    message: "Configure which clients? (detected clients are pre-selected)",
    options: ALL_CLIENTS.map((id) => ({
      value: id,
      label: CLIENTS[id].label,
      ...(detected.includes(id) ? { hint: "detected" } : {}),
    })),
    initialValues: detected.length ? detected : [...ALL_CLIENTS],
    required: false,
  })
  if (p.isCancel(result)) {
    p.cancel("mcp init cancelled.")
    process.exit(0)
  }
  return result as ClientId[]
}

export interface McpInitArgs {
  client?: string[]
  all?: boolean
  global?: boolean
  yes?: boolean
  profile?: string
  format: string
  cwd?: string
}

export async function runMcpInit(argv: McpInitArgs): Promise<void> {
  const format = argv.format
  const global = argv.global ?? true
  const cwd = argv.cwd ?? process.cwd()
  const profile = argv.profile ?? getDefaultProfileName()

  try {
    // Resolve which clients to configure.
    let selected: ClientId[]
    if (argv.all) {
      selected = [...ALL_CLIENTS]
    } else if (argv.client && argv.client.length) {
      const invalid = argv.client.filter((c) => !ALL_CLIENTS.includes(c as ClientId))
      if (invalid.length) {
        return error("INVALID_ARGUMENTS", `unknown client(s): ${invalid.join(", ")}. Valid: ${ALL_CLIENTS.join(", ")}`, {
          format,
          exitCode: 2,
        })
      }
      selected = [...new Set(argv.client as ClientId[])]
    } else {
      const detected = ALL_CLIENTS.filter((id) => CLIENTS[id].detect(global, cwd))
      const interactive = !argv.yes && process.stdin.isTTY && process.stdout.isTTY
      if (interactive) {
        selected = await promptSelection(detected)
      } else if (detected.length) {
        selected = detected
      } else {
        return error(
          "INVALID_ARGUMENTS",
          "no client specified and none auto-detected. Pass --client <claude|cursor|codex> or --all.",
          { format, exitCode: 2 },
        )
      }
    }

    if (!selected.length) {
      return error("INVALID_ARGUMENTS", "no clients selected", { format, exitCode: 2 })
    }

    // Write each; a per-client failure must not abort the rest.
    const results = selected.map((id) => {
      try {
        const path = writeClient(CLIENTS[id], global, cwd, profile)
        return { client: id, ok: true, path }
      } catch (err) {
        return { client: id, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })

    const okCount = results.filter((r) => r.ok).length
    logOperation("mcp init", { ok: okCount > 0, rows: okCount })
    success(results, {
      format,
      aiMessage:
        okCount > 0
          ? `Registered cz-cli MCP server in ${okCount} client config(s). Restart the client to load it.`
          : "No client configs were written.",
    })
  } catch (err) {
    return error("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), { format })
  }
}

