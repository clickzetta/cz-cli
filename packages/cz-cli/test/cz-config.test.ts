import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { czConfigCandidates, parseCzConfigText, readCzConfig, czConfigBool } from "../src/config/cz-config.js"
import { loadBootstrapConfig } from "../src/bootstrap/update.js"

// The config file reader was extracted from bootstrap/update.ts (where `autoupdate`
// was the only key) so a second switch could share it. These tests pin the two
// things that extraction must not change: WHICH files are read, in what order, and
// HOW their text is parsed — plus loadBootstrapConfig still resolving through it.

let home = ""

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cz-config-"))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function write(relative: string, content: string): void {
  const file = join(home, relative)
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, content)
}

test("candidates are lowest-precedence first, czcli.json canonical", () => {
  expect(czConfigCandidates(home, {})).toEqual([
    join(home, ".clickzetta", "czcli.json"),
    join(home, ".clickzetta", "czcli.jsonc"),
    join(home, ".config", "clickzetta", "opencode.jsonc"),
    join(home, ".config", "clickzetta", "opencode.json"),
    join(home, ".config", "clickzetta", "config.json"),
  ])
})

test("XDG_CONFIG_HOME relocates the xdg candidates only", () => {
  const candidates = czConfigCandidates(home, { XDG_CONFIG_HOME: "/xdg" })
  expect(candidates[0]).toBe(join(home, ".clickzetta", "czcli.json"))
  expect(candidates.slice(2)).toEqual([
    join("/xdg", "clickzetta", "opencode.jsonc"),
    join("/xdg", "clickzetta", "opencode.json"),
    join("/xdg", "clickzetta", "config.json"),
  ])
})

test("parses json, jsonc with comments, and toml", () => {
  expect(parseCzConfigText('{"autoupdate": false}')).toEqual({ autoupdate: false })
  expect(parseCzConfigText('{\n // why\n "autoupdate": "notify",\n}')).toEqual({ autoupdate: "notify" })
  expect(parseCzConfigText("autoupdate = false\n")).toEqual({ autoupdate: false })
})

test("unparseable or non-object text yields an empty config, never throws", () => {
  expect(parseCzConfigText("{ not json at all")).toEqual({})
  expect(parseCzConfigText("[1, 2, 3]")).toEqual({})
  expect(parseCzConfigText("")).toEqual({})
})

test("a later candidate overrides an earlier key, others are kept", async () => {
  write(".clickzetta/czcli.json", '{"autoupdate": false, "sql_split": false}')
  write(".config/clickzetta/config.json", '{"autoupdate": true}')
  expect(await readCzConfig({ home, env: {} })).toEqual({ autoupdate: true, sql_split: false })
})

test("czConfigBool accepts real booleans and their quoted spellings", async () => {
  write(".clickzetta/czcli.json", '{"a": false, "b": "false", "c": true, "d": "nope"}')
  const env = {}
  expect(await czConfigBool("a", { home, env })).toBe(false)
  expect(await czConfigBool("b", { home, env })).toBe(false)
  expect(await czConfigBool("c", { home, env })).toBe(true)
  expect(await czConfigBool("d", { home, env })).toBeUndefined()
  expect(await czConfigBool("missing", { home, env })).toBeUndefined()
})

test("loadBootstrapConfig still reads autoupdate through the shared reader", async () => {
  write(".clickzetta/czcli.json", '{"autoupdate": "notify"}')
  const config = await loadBootstrapConfig({ home, env: { CLICKZETTA_TEST_MANAGED_CONFIG_DIR: join(home, "managed") } })
  expect(config.autoupdate).toBe("notify")
})
