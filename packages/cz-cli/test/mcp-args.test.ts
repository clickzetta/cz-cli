/**
 * Empty-string tool arguments must mean "not provided".
 *
 * Observed from a real client: `{"agent":"","cwd":"/Users/x","model":"","profile":"","prompt":"..."}`.
 * That is schema-legal — our inputs are `z.string().optional()`, and `optional` only
 * says the KEY may be absent, so `""` passes validation — and it is normal behaviour
 * for an LLM-driven caller that fills every declared field.
 *
 * The defect was on our side, and it was an inconsistency: `profile` was read with a
 * truthiness check (so "" was correctly ignored) while `model` / `agent` / `cwd` used
 * `??`, which only falls back on null/undefined. The consequence was not cosmetic:
 * `model: ""` walked straight past checkModelResolvable's `if (!id) return undefined`
 * guard, disabling the preflight whose entire job is to explain an unresolvable model —
 * so the exact argument shape that most needed the diagnosis was the one shape that
 * could not get it.
 */
import { describe, expect, test } from "bun:test"
import { optionalArg } from "../src/commands/mcp.ts"

describe("optionalArg", () => {
  test("an empty string is absent, not a value", () => {
    expect(optionalArg("")).toBeUndefined()
  })

  test("whitespace only is absent too", () => {
    // A client that pads its placeholder must not create a session in a directory
    // named " " or select an agent named "\t".
    expect(optionalArg("   ")).toBeUndefined()
    expect(optionalArg("\t\n")).toBeUndefined()
  })

  test("a real value survives, trimmed", () => {
    expect(optionalArg("data_engineer")).toBe("data_engineer")
    expect(optionalArg("  cc-sh/qwen/qwen-plus  ")).toBe("cc-sh/qwen/qwen-plus")
  })

  test("non-strings and missing values are absent", () => {
    for (const value of [undefined, null, 0, false, {}, []]) {
      expect(optionalArg(value)).toBeUndefined()
    }
  })
})
