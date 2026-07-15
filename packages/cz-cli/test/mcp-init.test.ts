import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseTOML } from "smol-toml"
import { CLIENTS, writeClient } from "../src/commands/mcp-init.ts"

const prevHome = process.env.CLICKZETTA_TEST_HOME
let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cz-mcp-init-"))
  process.env.CLICKZETTA_TEST_HOME = home
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = prevHome
  rmSync(home, { recursive: true, force: true })
})

test("claude: creates ~/.claude.json with cz-cli server entry", () => {
  const path = writeClient(CLIENTS.claude, true, home, "staging")
  expect(path).toBe(join(home, ".claude.json"))
  const doc = JSON.parse(readFileSync(path, "utf-8"))
  expect(doc.mcpServers["cz-cli"].command).toBe(process.execPath)
  expect(doc.mcpServers["cz-cli"].args).toEqual(["mcp", "serve", "--profile", "staging"])
})

test("claude: merges into existing config, preserving other servers", () => {
  const file = join(home, ".claude.json")
  writeFileSync(file, JSON.stringify({ mcpServers: { foo: { command: "foo-bin" } }, other: 1 }))
  writeClient(CLIENTS.claude, true, home)
  const doc = JSON.parse(readFileSync(file, "utf-8"))
  expect(doc.mcpServers.foo.command).toBe("foo-bin") // untouched
  expect(doc.mcpServers["cz-cli"].command).toBe(process.execPath)
  expect(doc.other).toBe(1) // unrelated top-level field kept
})

test("no profile: omits --profile from args", () => {
  writeClient(CLIENTS.claude, true, home)
  const doc = JSON.parse(readFileSync(join(home, ".claude.json"), "utf-8"))
  expect(doc.mcpServers["cz-cli"].args).toEqual(["mcp", "serve"])
})

test("codex: writes [mcp_servers.cz-cli] TOML, preserving existing tables", () => {
  const dir = join(home, ".codex")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "config.toml"), '[mcp_servers.other]\ncommand = "x"\n\n[misc]\nkey = "v"\n')
  const path = writeClient(CLIENTS.codex, true, home, "prod")
  expect(path).toBe(join(dir, "config.toml"))
  const doc = parseTOML(readFileSync(path, "utf-8")) as any
  expect(doc.mcp_servers.other.command).toBe("x") // preserved
  expect(doc.mcp_servers["cz-cli"].command).toBe(process.execPath)
  expect(doc.mcp_servers["cz-cli"].args).toEqual(["mcp", "serve", "--profile", "prod"])
  expect(doc.misc.key).toBe("v") // other tables kept
})

test("cursor: project scope writes <cwd>/.cursor/mcp.json", () => {
  const proj = mkdtempSync(join(tmpdir(), "cz-proj-"))
  try {
    const path = writeClient(CLIENTS.cursor, false, proj)
    expect(path).toBe(join(proj, ".cursor", "mcp.json"))
    const doc = JSON.parse(readFileSync(path, "utf-8"))
    expect(doc.mcpServers["cz-cli"].command).toBe(process.execPath)
  } finally {
    rmSync(proj, { recursive: true, force: true })
  }
})

test("idempotent: writing twice yields a single cz-cli entry", () => {
  writeClient(CLIENTS.claude, true, home, "s1")
  writeClient(CLIENTS.claude, true, home, "s2")
  const doc = JSON.parse(readFileSync(join(home, ".claude.json"), "utf-8"))
  expect(Object.keys(doc.mcpServers)).toEqual(["cz-cli"])
  expect(doc.mcpServers["cz-cli"].args).toEqual(["mcp", "serve", "--profile", "s2"]) // last wins
})

test("malformed existing JSON throws (does not clobber)", () => {
  const file = join(home, ".claude.json")
  writeFileSync(file, "{ not json ")
  expect(() => writeClient(CLIENTS.claude, true, home)).toThrow()
  expect(readFileSync(file, "utf-8")).toBe("{ not json ") // left intact
})

test("detect: reports installed clients by config presence", () => {
  expect(CLIENTS.claude.detect(true, home)).toBe(false)
  writeFileSync(join(home, ".claude.json"), "{}")
  expect(CLIENTS.claude.detect(true, home)).toBe(true)
})
