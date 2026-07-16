import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import { z } from "zod/v4"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { withNetworkOptions, resolveNetworkOptionsNoConfig } from "opencode/cli/network"
import { ServerAuth } from "opencode/server/auth"
import { parseModelSelection, type ConfigOptionProvider, type ModelSelection } from "opencode/acp/config-option"
import { applyClickZettaProfile } from "../bootstrap/profile-env.js"
import { runMcpInit, type McpInitArgs } from "./mcp-init.js"
import { loadProfiles } from "../connection/profile-store.js"
import { readLlmEntries } from "../llm/native-config.js"
import { VERSION } from "../version.js"
import type { GlobalArgs } from "../cli.js"

// The MCP SDK's registerTool expects a Zod raw shape, but cz-cli imports `zod/v4`
// while the SDK resolves its own zod copy. The two are structurally identical at
// runtime; the `as any` casts at the registerTool boundary absorb the
// duplicate-type friction without changing behavior.

// CZ_* connection env is process-global, so overlapping tool calls that carry
// different `profile` values would otherwise clobber each other mid-flight.
// Serialize the profile-sensitive create -> prompt span through a promise chain
// so each call sees a stable environment. v1: strict FIFO, no parallelism for
// the profiled section.
let queue: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn) as Promise<T>
  // Keep the chain alive regardless of individual failures.
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

// A prompt response is `{ data: { parts: [...] } }`; the assistant's reply text
// is the concatenation of every text part.
function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((p): p is { type: string; text: string } => {
      return !!p && typeof p === "object" && (p as { type?: unknown }).type === "text" && typeof (p as { text?: unknown }).text === "string"
    })
    .map((p) => p.text)
    .join("")
}

// Safety-net timeout after prompt() resolves: the session's `idle` status event
// normally lands right after the final part, but if the stream stalls we must
// not hang the tool result. prompt() already returned the authoritative answer,
// so timing out here only means we stop draining progress a little early.
const IDLE_TIMEOUT_MS = 5000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Run one agent turn (create-then-prompt or reply) and return the final answer
// text. When `progressToken` is set, also mirror the agent's intermediate
// reasoning / tool activity to the client as `notifications/progress` while the
// turn runs — matching codex's dual-channel MCP behavior. The final tool result
// still comes from prompt()'s own parts (authoritative, no stream race).
//
// Without a progressToken this is byte-identical to the old blocking path: no
// subscription, no loop, just prompt() + extractText(). Fully backward compatible.
async function runAgentTurn(params: {
  client: ReturnType<typeof createOpencodeClient>
  sessionID: string
  directory?: string
  agent?: string
  model?: ModelSelection
  prompt: string
  progressToken?: string | number
  sendNotification: (n: unknown) => Promise<void>
}): Promise<string> {
  const { client, sessionID, directory, agent, model, progressToken } = params
  const streaming = progressToken !== undefined

  const promptArgs = {
    sessionID,
    directory,
    agent,
    model: model?.model,
    variant: model?.variant,
    parts: [{ type: "text" as const, text: params.prompt }],
  }

  if (!streaming) {
    const res = await client.session.prompt(promptArgs, { throwOnError: true })
    return extractText(res.data.parts)
  }

  // Subscribe BEFORE prompting so no early events are missed. The event stream
  // is workspace-global, so every branch filters by this session's ID.
  const controller = new AbortController()
  const events = await client.event.subscribe({ directory }, { signal: controller.signal })

  let progress = 0
  // A dead notification channel must not stall the turn — swallow send errors.
  const notify = (message: string) =>
    params
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken, progress: ++progress, message },
      })
      .catch(() => {})

  // Dedup key for `task` tool "running" notices (part.id fires repeatedly).
  const startedTools = new Set<string>()

  async function loop() {
    for await (const event of events.stream) {
      if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (part.sessionID !== sessionID) continue

        // Finalized reasoning only (time.end set) — mirror run.ts's filter.
        if (part.type === "reasoning" && part.time?.end) {
          const text = part.text.trim()
          if (text) await notify("🧠 " + text)
          continue
        }

        if (part.type === "tool") {
          const state = part.state
          if (state.status === "running" && part.tool === "task") {
            if (startedTools.has(part.id)) continue
            startedTools.add(part.id)
            await notify("🔧 " + part.tool + ": " + (state.title ?? "running"))
          } else if (state.status === "completed") {
            await notify("✓ " + part.tool + ": " + (state.title ?? "done"))
          } else if (state.status === "error") {
            await notify("✗ " + part.tool + ": " + (state.error ?? "error"))
          }
          continue
        }
        // text parts: final answer comes from extractText — skip to avoid dup.
        // step-start / step-finish: skip to keep the progress stream simple.
      }

      if (event.type === "session.error") {
        const props = event.properties
        if (props.sessionID !== sessionID || !props.error) continue
        let err = String(props.error.name)
        if ("data" in props.error && props.error.data && "message" in props.error.data) {
          err = String(props.error.data.message)
        }
        await notify("⚠️ " + err)
        // Accumulate but do not break — the turn ends on `idle`.
        continue
      }

      if (
        event.type === "session.status" &&
        event.properties.sessionID === sessionID &&
        event.properties.status.type === "idle"
      ) {
        return
      }
    }
  }

  // Fire-and-forget: the loop drains progress in the background. The final
  // answer and turn completion are governed by prompt() below, not the loop.
  const loopPromise = loop().catch(() => {})

  let res
  try {
    res = await client.session.prompt(promptArgs, { throwOnError: true })
  } catch (err) {
    // prompt() failed: tear down the stream so the loop unwinds, then rethrow
    // for the caller's errorResult().
    controller.abort()
    await loopPromise
    throw err
  }

  // prompt() resolved with the authoritative answer. Give the loop a brief
  // window to drain the trailing `idle` event, then force it closed.
  await Promise.race([loopPromise, sleep(IDLE_TIMEOUT_MS)])
  controller.abort()
  await loopPromise

  return extractText(res.data.parts)
}

function errorResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  return { isError: true, content: [{ type: "text" as const, text: msg }] }
}

// A structured, agent-actionable error for the calling client (Claude Code etc.)
// so it can guide the user through setup/login instead of surfacing an opaque
// 503 from the in-process agent server.
function notConfiguredResult(reason: "no_profile" | "no_llm") {
  const text =
    reason === "no_profile"
      ? "cz-cli is not configured: no ClickZetta profile found. Ask the user to run `cz-cli setup` (or `cz-cli login` for browser OAuth) to create one, then retry."
      : "cz-cli has no agent LLM configured. Ask the user to run `cz-cli agent llm add` (or `cz-cli setup`) to configure one, then retry."
  return { isError: true, content: [{ type: "text" as const, text: `NOT_CONFIGURED (${reason}): ${text}` }] }
}

// Preflight both required pieces before creating a session: a ClickZetta profile
// (which instance/credentials to use) and an agent LLM (the model the agent runs
// on). Returns a NOT_CONFIGURED result to surface, or undefined when ready.
// The profile arg (per-call or server default) is applied by the caller first.
function checkConfigured(): ReturnType<typeof notConfiguredResult> | undefined {
  try {
    if (Object.keys(loadProfiles()).length === 0) return notConfiguredResult("no_profile")
  } catch {
    return notConfiguredResult("no_profile")
  }
  try {
    const { llm, default_llm } = readLlmEntries()
    const active = default_llm && llm[default_llm]
    if (!active || !active.provider || !active.api_key) return notConfiguredResult("no_llm")
  } catch {
    return notConfiguredResult("no_llm")
  }
  return undefined
}

interface McpServeArgs extends GlobalArgs {
  hostname: string
  port: number
  mdns: boolean
  "mdns-domain": string
  cors: string[]
  cwd?: string
  agent?: string
  model?: string
}

async function runMcpServe(argv: McpServeArgs): Promise<void> {
  // Start an in-process loopback opencode server (port 0 -> auto), exactly like
  // acp.ts does, but from a plain async handler (no Effect runtime): both
  // Server.listen and resolveNetworkOptionsNoConfig have non-Effect entry points.
  const { Server } = await import("opencode/server/server")
  const net = resolveNetworkOptionsNoConfig({
    hostname: argv.hostname,
    port: argv.port,
    mdns: argv.mdns,
    "mdns-domain": argv["mdns-domain"],
    cors: argv.cors,
  })
  const server = await Server.listen({
    hostname: net.hostname,
    port: net.port,
    mdns: net.mdns,
    mdnsDomain: net.mdnsDomain,
    cors: net.cors,
  })

  const client = createOpencodeClient({
    baseUrl: `http://${server.hostname}:${server.port}`,
    headers: ServerAuth.headers(),
  })

  // Startup `--profile` (already applied to CZ_* by run-cli.ts before we get
  // here) plus --cwd/--agent/--model are the per-server defaults; a tool call
  // may override profile/model per invocation.
  const defaults = {
    cwd: argv.cwd,
    agent: argv.agent,
    model: argv.model,
  }

  // parseModelSelection needs the provider list; fetch once and cache.
  let providersPromise: Promise<ConfigOptionProvider[]> | undefined
  function getProviders(): Promise<ConfigOptionProvider[]> {
    if (!providersPromise) {
      providersPromise = client.config
        .providers({}, { throwOnError: true })
        .then((res) => (res.data.providers ?? []) as unknown as ConfigOptionProvider[])
    }
    return providersPromise
  }

  async function resolveModel(model?: string) {
    const id = model ?? defaults.model
    if (!id) return undefined
    return parseModelSelection(id, await getProviders())
  }

  const mcp = new McpServer({ name: "cz-cli", version: VERSION })

  const czInputSchema = {
    prompt: z.string().describe("Natural-language request for the ClickZetta agent"),
    model: z.string().optional().describe("Model as provider/model or provider/model/variant (defaults to the server's model)"),
    agent: z.string().optional().describe("Agent to use (defaults to the server's agent)"),
    cwd: z.string().optional().describe("Working directory for the session (defaults to the server's cwd)"),
    profile: z.string().optional().describe("ClickZetta profile to apply for this call (defaults to the server's profile)"),
  }

  mcp.registerTool(
    "cz",
    {
      description:
        "Start a new ClickZetta agent session with a natural-language prompt. Returns the sessionID (for follow-ups via cz-reply) and the agent's reply.",
      inputSchema: czInputSchema as any,
    },
    (async (
      args: { prompt: string; model?: string; agent?: string; cwd?: string; profile?: string },
      extra: { _meta?: { progressToken?: string | number }; sendNotification: (n: unknown) => Promise<void> },
    ) => {
      return serialize(async () => {
        try {
          if (args.profile) applyClickZettaProfile(args.profile)
          const preflight = checkConfigured()
          if (preflight) return preflight
          const directory = args.cwd ?? defaults.cwd
          const agent = args.agent ?? defaults.agent
          const created = await client.session.create({ directory, agent, title: "mcp" }, { throwOnError: true })
          const sessionID = created.data.id
          const modelArg = await resolveModel(args.model)
          const text = await runAgentTurn({
            client,
            sessionID,
            directory,
            agent,
            model: modelArg,
            prompt: args.prompt,
            progressToken: extra?._meta?.progressToken,
            sendNotification: extra.sendNotification,
          })
          return { content: [{ type: "text" as const, text: `sessionID: ${sessionID}\n\n${text}` }] }
        } catch (err) {
          return errorResult(err)
        }
      })
    }) as unknown as Parameters<typeof mcp.registerTool>[2],
  )

  const czReplyInputSchema = {
    sessionID: z.string().describe("Session ID returned by a prior cz call"),
    prompt: z.string().describe("Follow-up natural-language request"),
    model: z.string().optional().describe("Model as provider/model or provider/model/variant (defaults to the server's model)"),
    profile: z.string().optional().describe("ClickZetta profile to apply for this call (defaults to the server's profile)"),
  }

  mcp.registerTool(
    "cz-reply",
    {
      description: "Continue an existing ClickZetta agent session. Requires a sessionID from a prior cz call.",
      inputSchema: czReplyInputSchema as any,
    },
    (async (
      args: { sessionID: string; prompt: string; model?: string; profile?: string },
      extra: { _meta?: { progressToken?: string | number }; sendNotification: (n: unknown) => Promise<void> },
    ) => {
      return serialize(async () => {
        try {
          if (args.profile) applyClickZettaProfile(args.profile)
          const preflight = checkConfigured()
          if (preflight) return preflight
          const directory = defaults.cwd
          const agent = defaults.agent
          const modelArg = await resolveModel(args.model)
          const text = await runAgentTurn({
            client,
            sessionID: args.sessionID,
            directory,
            agent,
            model: modelArg,
            prompt: args.prompt,
            progressToken: extra?._meta?.progressToken,
            sendNotification: extra.sendNotification,
          })
          return { content: [{ type: "text" as const, text }] }
        } catch (err) {
          return errorResult(err)
        }
      })
    }) as unknown as Parameters<typeof mcp.registerTool>[2],
  )

  const transport = new StdioServerTransport()
  await mcp.connect(transport)

  // Keep the process alive on stdin the same way acp.ts does; exit cleanly when
  // the client closes stdin, then stop the in-process server.
  process.stdin.resume()
  await new Promise<void>((resolve) => {
    process.stdin.on("end", () => resolve())
    process.stdin.on("close", () => resolve())
    process.stdin.on("error", () => resolve())
  })
  await server.stop(true).catch(() => {})
}

export function registerMcpCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "mcp",
    "Expose cz-cli as an MCP server so external clients (Claude Code, Cursor, Codex) can call it",
    (yargs) => {
      yargs
        .command(
          "serve",
          "Serve cz-cli over MCP on stdio",
          (y) =>
            withNetworkOptions(y as any)
              .option("cwd", { type: "string", describe: "Default working directory for sessions", default: process.cwd() })
              .option("agent", { type: "string", describe: "Default agent to use" })
              .option("model", { type: "string", describe: "Default model as provider/model or provider/model/variant" })
              .example("cz-cli mcp serve", "Serve on stdio with default profile")
              .example("cz-cli mcp serve --profile staging", "Serve with the staging ClickZetta profile as default")
              .example("cz-cli mcp serve --model clickzetta/deepseek/deepseek-3.2", "Serve with a default model"),
          (argv) => runMcpServe(argv as unknown as McpServeArgs),
        )
        .command(
          "init",
          "Register cz-cli as an MCP server in external AI clients (Claude Code, Cursor, Codex)",
          (y) =>
            y
              .option("client", {
                alias: "a",
                type: "string",
                array: true,
                describe: "Target client(s): claude, cursor, codex (repeatable). Omit to auto-detect.",
              })
              .option("all", { type: "boolean", describe: "Configure all supported clients", default: false })
              .option("global", {
                alias: "g",
                type: "boolean",
                describe: "Write to the user-level (global) config instead of the project config",
                default: true,
              })
              .option("yes", { alias: "y", type: "boolean", describe: "Skip interactive selection", default: false })
              .example("cz-cli mcp init", "Auto-detect installed clients and configure them")
              .example("cz-cli mcp init -a claude -a codex", "Configure Claude Code and Codex")
              .example("cz-cli mcp init --all --profile staging", "Configure all clients with the staging profile"),
          (argv) => runMcpInit(argv as unknown as McpInitArgs),
        )
      // Wrap so a bare `cz-cli mcp` renders help and a typo'd subcommand
      // (`cz-cli mcp serv`) returns USAGE_ERROR with a suggestion, instead of
      // silently passing. See subcommand-help.ts.
      return commandGroup(yargs, "mcp")
    },
  )
}
