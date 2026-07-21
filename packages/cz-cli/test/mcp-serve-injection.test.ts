// Locks the root-cause fix for "MCP session boots as bare upstream opencode".
//
// `cz-cli mcp serve` runs on the plain CLI path (agentRuntime=false), so
// runtime.main()'s agent-runtime branch never injects the cz runtime. runMcpServe
// therefore calls applyAgentRuntimeInjection() itself, right before Server.listen,
// and defaults the session agent to the injected default_agent (data_engineer).
//
// These tests guard the two invariants that make the MCP session a real cz session:
//   1. applyAgentRuntimeInjection() sets OPENCODE_CONFIG_CONTENT.default_agent, and
//      injectedDefaultAgent() reads it back (so session.create gets the cz agent).
//   2. Injection is idempotent — calling it again (e.g. if a future caller already
//      injected) keeps default_agent and doesn't drop previously-merged fields.
import { afterEach, beforeEach, expect, test } from "bun:test"
import { applyAgentRuntimeInjection } from "../src/bootstrap/opencode-injection.ts"
import { injectedDefaultAgent, assertNoTurnError } from "../src/commands/mcp.ts"

let prev: string | undefined

beforeEach(() => {
  prev = process.env.OPENCODE_CONFIG_CONTENT
  delete process.env.OPENCODE_CONFIG_CONTENT
})

afterEach(() => {
  if (prev === undefined) delete process.env.OPENCODE_CONFIG_CONTENT
  else process.env.OPENCODE_CONFIG_CONTENT = prev
})

test("injectedDefaultAgent() returns undefined before any injection", () => {
  delete process.env.OPENCODE_CONFIG_CONTENT
  expect(injectedDefaultAgent()).toBeUndefined()
})

test("applyAgentRuntimeInjection sets a cz default_agent that injectedDefaultAgent reads back", () => {
  applyAgentRuntimeInjection()
  const raw = process.env.OPENCODE_CONFIG_CONTENT
  expect(raw).toBeTruthy()
  const parsed = JSON.parse(raw!)
  // opencode-injection.ts owns the name; assert it's the cz agent, not opencode's.
  expect(parsed.default_agent).toBe("data_engineer")
  expect(injectedDefaultAgent()).toBe("data_engineer")
})

test("injection is idempotent: re-running keeps default_agent and prior fields", () => {
  applyAgentRuntimeInjection()
  const first = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT!)
  // A field a hypothetical earlier caller merged in must survive re-injection.
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ ...first, marker: "keep-me" })
  applyAgentRuntimeInjection()
  const second = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT!)
  expect(second.default_agent).toBe("data_engineer")
  expect(second.marker).toBe("keep-me")
  expect(injectedDefaultAgent()).toBe("data_engineer")
})

test("injectedDefaultAgent() tolerates malformed config content", () => {
  process.env.OPENCODE_CONFIG_CONTENT = "{not valid json"
  expect(injectedDefaultAgent()).toBeUndefined()
})

// A turn can fail without session.prompt() rejecting: the error rides in
// data.info.error with empty parts. assertNoTurnError must turn that into a
// thrown Error so the tool surfaces a precise message instead of a blank reply.
test("assertNoTurnError throws the embedded provider error (empty parts case)", () => {
  const data = {
    info: {
      error: {
        name: "APIError",
        data: { message: "Invalid API key. The provided API key is not valid or has been disabled." },
      },
    },
    parts: [],
  }
  expect(() => assertNoTurnError(data)).toThrow("Invalid API key")
})

test("assertNoTurnError falls back to the error name when no message", () => {
  expect(() => assertNoTurnError({ info: { error: { name: "TimeoutError" } } })).toThrow("TimeoutError")
})

test("assertNoTurnError is a no-op for a successful turn", () => {
  expect(() => assertNoTurnError({ info: {}, parts: [{ type: "text", text: "hi" }] })).not.toThrow()
  expect(() => assertNoTurnError(undefined)).not.toThrow()
  expect(() => assertNoTurnError({})).not.toThrow()
})
