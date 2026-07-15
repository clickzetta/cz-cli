import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import { z } from "zod/v4"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { withNetworkOptions, resolveNetworkOptionsNoConfig } from "opencode/cli/network"
import { ServerAuth } from "opencode/server/auth"
import { parseModelSelection, type ConfigOptionProvider } from "opencode/acp/config-option"
import { applyClickZettaProfile } from "../bootstrap/profile-env.js"
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

function errorResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  return { isError: true, content: [{ type: "text" as const, text: msg }] }
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
    (async (args: { prompt: string; model?: string; agent?: string; cwd?: string; profile?: string }) => {
      return serialize(async () => {
        try {
          if (args.profile) applyClickZettaProfile(args.profile)
          const directory = args.cwd ?? defaults.cwd
          const agent = args.agent ?? defaults.agent
          const created = await client.session.create({ directory, agent, title: "mcp" }, { throwOnError: true })
          const sessionID = created.data.id
          const modelArg = await resolveModel(args.model)
          const res = await client.session.prompt(
            {
              sessionID,
              directory,
              agent,
              model: modelArg?.model,
              variant: modelArg?.variant,
              parts: [{ type: "text", text: args.prompt }],
            },
            { throwOnError: true },
          )
          const text = extractText(res.data.parts)
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
    (async (args: { sessionID: string; prompt: string; model?: string; profile?: string }) => {
      return serialize(async () => {
        try {
          if (args.profile) applyClickZettaProfile(args.profile)
          const directory = defaults.cwd
          const agent = defaults.agent
          const modelArg = await resolveModel(args.model)
          const res = await client.session.prompt(
            {
              sessionID: args.sessionID,
              directory,
              agent,
              model: modelArg?.model,
              variant: modelArg?.variant,
              parts: [{ type: "text", text: args.prompt }],
            },
            { throwOnError: true },
          )
          const text = extractText(res.data.parts)
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
      // Wrap so a bare `cz-cli mcp` renders help and a typo'd subcommand
      // (`cz-cli mcp serv`) returns USAGE_ERROR with a suggestion, instead of
      // silently passing. See subcommand-help.ts.
      return commandGroup(yargs, "mcp")
    },
  )
}
