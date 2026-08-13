/**
 * What an MCP tool call reports when the agent server fails.
 *
 * The bug this pins: `cz` and `cz-reply` returned nothing but "Unexpected server
 * error. Check server logs for details." for every failure — a stale `config.model`,
 * an overdue tenant and a genuine crash were indistinguishable. Two things caused it:
 * the server's defect boundary replaced the real error with a ref, and cz's formatter
 * ran `err instanceof Error ? err.message : String(err)` on a value that is neither —
 * the SDK's throwOnError throws the PARSED RESPONSE BODY, so a 500 stringified to
 * "[object Object]".
 *
 * `runMcpServe` now sets OPENCODE_ERROR_DETAIL=1 (loopback server, single local
 * client), so the boundary attaches the real error and cause as `data.detail`.
 */
import { describe, expect, test } from "bun:test"
import { formatToolError } from "../src/commands/mcp.ts"

describe("formatToolError", () => {
  test("a 500 body with detail names the real cause, not just the ref", () => {
    // Exactly the shape middleware/error.ts produces with OPENCODE_ERROR_DETAIL=1.
    const text = formatToolError({
      name: "UnknownError",
      data: {
        message: "Unexpected server error. Check server logs for details.",
        ref: "err_1b84ae7b",
        detail: {
          error: {
            name: "ProviderModelNotFoundError",
            data: { providerID: "cc-sh", modelID: "qwen/qwen3-coder-plus" },
          },
          cause: "ProviderModelNotFoundError: model not found\n    at getModel",
        },
      },
    })
    expect(text).toContain("err_1b84ae7b")
    expect(text).toContain("ProviderModelNotFoundError")
    // The model that could not be resolved must be visible — that is the actionable bit.
    expect(text).toContain("qwen/qwen3-coder-plus")
    expect(text).toContain("at getModel")
  })

  test("a 500 body without detail still reports name, message and ref", () => {
    // OPENCODE_ERROR_DETAIL off (e.g. `cz-cli serve`), or an older server.
    const text = formatToolError({
      name: "UnknownError",
      data: { message: "Unexpected server error. Check server logs for details.", ref: "err_5af37bb6" },
    })
    expect(text).toBe("UnknownError: Unexpected server error. Check server logs for details.\nref: err_5af37bb6")
  })

  test("never renders an object as [object Object]", () => {
    // The regression that hid every server-side failure.
    for (const value of [{ name: "X", data: { message: "boom" } }, { weird: true }, {}]) {
      expect(formatToolError(value)).not.toContain("[object Object]")
    }
  })

  test("an Error keeps its stack when it has one", () => {
    const err = new Error("connect ECONNREFUSED")
    expect(formatToolError(err)).toContain("connect ECONNREFUSED")
  })

  test("an Error without a stack still reads name: message", () => {
    const err = new Error("no stack here")
    err.stack = undefined
    expect(formatToolError(err)).toBe("Error: no stack here")
  })

  test("strings and non-objects pass through", () => {
    expect(formatToolError("plain failure")).toBe("plain failure")
    expect(formatToolError(undefined)).toBe("undefined")
  })

  test("a typed API failure keeps its fields when it carries no message", () => {
    // Typed HttpApi failures skip the defect boundary entirely and arrive as their own
    // body; the formatter must not drop their data.
    const text = formatToolError({ name: "ProviderNotFoundError", data: { providerID: "cc-sh" } })
    expect(text).toContain("ProviderNotFoundError")
    expect(text).toContain("cc-sh")
  })
})
