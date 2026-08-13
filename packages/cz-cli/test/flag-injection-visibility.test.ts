/**
 * The enforcement for UPSTREAM-PATCHES.md INTRUSIVE #5 (lazy flag reads).
 *
 * cz-cli configures opencode by writing process.env from inside main()
 * (bootstrap/opencode-injection.ts), which is always AFTER opencode's module graph is
 * loaded. That only works if upstream's `Flag` reads env at access time. Upstream used
 * to snapshot most entries at import, and the consequences were invisible: the TUI kept
 * working (its server runs in a Bun Worker, fresh module registry, env already set)
 * while every in-process opencode call silently ran against a config that never loaded
 * llm.json — `agent llm models <entry>` failed for healthy gateway entries,
 * `agent llm show` resolved a default model from a provider set with zero llm.json
 * entries, and `agent run --model <entry>/<id>` answered "Model not found".
 *
 * A ledger entry alone cannot protect that: the ledger's own history says intrusive
 * patches get dropped by re-baselines, silently. This test is what makes such a drop
 * loud. It imports the flag module FIRST — mirroring the real load order — and only
 * then writes env, so it fails on exactly the regression that hurt us.
 *
 * If this goes red after a baseline bump, re-apply the flag.ts patch. Do NOT "fix" it
 * by writing env earlier: the whole point is that callers should not need that
 * discipline.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"

// Every env var cz-cli injects, with a probe value and how to read it back through
// Flag. Keep in sync with opencode-injection.ts's REGISTRY.
const INJECTED = [
  { env: "OPENCODE_CONFIG", value: "/tmp/cz-flag-probe/llm.json", read: () => Flag.OPENCODE_CONFIG as unknown },
  {
    env: "OPENCODE_CONFIG_CONTENT",
    value: '{"$schema":"https://opencode.ai/config.json"}',
    read: () => Flag.OPENCODE_CONFIG_CONTENT as unknown,
  },
  { env: "OPENCODE_TUI_CONFIG", value: "/tmp/cz-flag-probe/tui.json", read: () => Flag.OPENCODE_TUI_CONFIG as unknown },
  { env: "OPENCODE_DISABLE_AUTOUPDATE", value: "1", read: () => Flag.OPENCODE_DISABLE_AUTOUPDATE as unknown },
  {
    env: "OPENCODE_DISABLE_PROJECT_CONFIG",
    value: "1",
    read: () => Flag.OPENCODE_DISABLE_PROJECT_CONFIG as unknown,
  },
] as const

const ORIGINAL = new Map(INJECTED.map((item) => [item.env, process.env[item.env]] as const))

afterAll(() => {
  for (const [key, value] of ORIGINAL) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("Flag reflects env written after the module is loaded", () => {
  for (const item of INJECTED) {
    test(item.env, () => {
      delete process.env[item.env]
      // Read once BEFORE writing: with an eager snapshot this is the value Flag would
      // be stuck at forever.
      const before = item.read()
      process.env[item.env] = item.value
      const after = item.read()
      expect(after, `${item.env} must be read at access time, not at module load`).not.toEqual(before)
      // Booleans come back as booleans; string flags come back verbatim.
      if (typeof after === "boolean") expect(after).toBe(true)
      else expect(after).toBe(item.value)
    })
  }
})

describe("every flag some caller assigns to is writable", () => {
  // The first version of the flag.ts patch made everything getter-only and broke
  // opencode/test/server/httpapi-listen.test.ts with "Attempted to assign to readonly
  // property" — upstream assigns to several flags as mutable slots. Rather than trust a
  // hand-kept list, scan the tree for `Flag.<NAME> =` and require each one to be
  // writable. A new assignment upstream then fails HERE, with the fix spelled out,
  // instead of at some unrelated test's first line.
  test("no assigned flag is getter-only", async () => {
    const { spawnSync } = await import("node:child_process")
    const root = new URL("../../..", import.meta.url).pathname
    const found = spawnSync(
      "sh",
      [
        "-c",
        `find packages -name '*.ts' -o -name '*.tsx' | grep -v node_modules | grep -v /dist/ | ` +
          `xargs grep -hoE 'Flag\\.[A-Z_]+ *=[^=]' 2>/dev/null | sed -E 's/ *=.*//' | sort -u`,
      ],
      { cwd: root, encoding: "utf-8" },
    )
    const names = (found.stdout ?? "")
      .split("\n")
      .map((line) => line.trim().replace(/^Flag\./, ""))
      .filter(Boolean)
    // Guard against the scan silently finding nothing (e.g. a layout change).
    expect(names.length, "the assignment scan found no `Flag.X =` sites at all").toBeGreaterThan(0)
    const readonly = names.filter((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(Flag, name)
      return descriptor !== undefined && descriptor.get !== undefined && descriptor.set === undefined
    })
    expect(readonly, "these flags are assigned somewhere but have no setter in flag.ts").toEqual([])
  })

  // Spot-checks that the write-through actually reaches process.env.
  test("OPENCODE_DB round-trips through the setter", () => {
    const previous = Flag.OPENCODE_DB
    Flag.OPENCODE_DB = "/tmp/cz-flag-probe/opencode.sqlite"
    expect(Flag.OPENCODE_DB).toBe("/tmp/cz-flag-probe/opencode.sqlite")
    expect(process.env.OPENCODE_DB).toBe("/tmp/cz-flag-probe/opencode.sqlite")
    Flag.OPENCODE_DB = previous
    expect(Flag.OPENCODE_DB).toBe(previous)
  })

  test("OPENCODE_MODELS_PATH and OPENCODE_DISABLE_MODELS_FETCH round-trip", () => {
    const path = Flag.OPENCODE_MODELS_PATH
    const disabled = Flag.OPENCODE_DISABLE_MODELS_FETCH
    Flag.OPENCODE_MODELS_PATH = "/tmp/cz-flag-probe/models-dev.json"
    Flag.OPENCODE_DISABLE_MODELS_FETCH = true
    expect(Flag.OPENCODE_MODELS_PATH).toBe("/tmp/cz-flag-probe/models-dev.json")
    expect(Flag.OPENCODE_DISABLE_MODELS_FETCH).toBe(true)
    Flag.OPENCODE_MODELS_PATH = path
    Flag.OPENCODE_DISABLE_MODELS_FETCH = disabled
    expect(Flag.OPENCODE_MODELS_PATH).toBe(path)
    expect(Flag.OPENCODE_DISABLE_MODELS_FETCH).toBe(disabled)
  })
})
