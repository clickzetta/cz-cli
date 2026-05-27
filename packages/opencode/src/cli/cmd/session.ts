import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { SessionID } from "../../session/schema"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Locale } from "../../util"
import { Flag } from "../../flag/flag"
import { Filesystem } from "../../util"
import { Process } from "../../util"
import { EOL } from "os"
import path from "path"
import { which } from "../../util/which"
import { AppRuntime } from "@/effect/app-runtime"
import { commandGroup } from "@clickzetta/cli/command-group"
import { SessionStatus } from "../../session/status"
import { progressLine } from "../../session/render"
import { Cause } from "effect"
import { NotFoundError } from "../../storage"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = which("less")
  if (lessOnPath) {
    if (Filesystem.stat(lessOnPath)?.size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.CLICKZETTA_GIT_BASH_PATH) {
    const less = path.join(Flag.CLICKZETTA_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  const git = which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

/**
 * A part is "informative" if it describes a real activity the user can read.
 * Boundary markers (step-start, step-finish) and tools whose input hasn't
 * streamed in yet are skipped so `progress` reflects what's actually happening
 * instead of "Step done" repeated four times in a row.
 */
function isInformativePart(part: MessageV2.Part): boolean {
  if (part.type === "step-start" || part.type === "step-finish") return false
  if (part.type === "tool") {
    const state = part.state
    if (state.status === "pending") {
      const input = ("input" in state ? state.input : undefined) as Record<string, unknown> | undefined
      if (!input || Object.keys(input).length === 0) return false
      // For known tools, require the primary identifying input field to exist.
      const hasField = (k: string) => typeof input[k] === "string" && (input[k] as string).length > 0
      switch (part.tool) {
        case "bash":
          return hasField("command")
        case "read":
        case "write":
        case "edit":
          return hasField("filePath")
        case "glob":
        case "grep":
          return hasField("pattern")
        case "webfetch":
          return hasField("url")
        case "codesearch":
        case "websearch":
          return hasField("query")
        case "skill":
          return hasField("name")
        default:
          return true
      }
    }
  }
  return true
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) =>
    commandGroup(yargs.command(SessionListCommand).command(SessionDeleteCommand).command(SessionStatusCommand), "agent session"),
  async handler() {},
})

export const SessionDeleteCommand = cmd({
  command: "delete <sessionID>",
  describe: "delete a session",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionID = SessionID.make(args.sessionID)
      try {
        await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID)))
      } catch (err) {
        const actual = Cause.squash((err as any).cause ?? err)
        if (NotFoundError.isInstance(actual)) {
          UI.error(`Session not found: ${args.sessionID}`)
          process.exit(1)
        }
        throw err
      }
      await AppRuntime.runPromise(Session.Service.use((svc) => svc.remove(sessionID)))
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
    })
  },
})

export const SessionStatusCommand = cmd({
  command: "status <sessionID>",
  describe: "get session status (idle/busy)",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session ID to check",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionID = SessionID.make(args.sessionID)

      try {
        await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID)))
      } catch (err) {
        const actual = Cause.squash((err as any).cause ?? err)
        if (NotFoundError.isInstance(actual)) {
          process.stdout.write(JSON.stringify({ session_id: args.sessionID, error: "Session not found" }) + EOL)
          process.exit(1)
        }
        throw err
      }

      const status = await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.get(sessionID)))

      // Cross-process busy detection: in-memory SessionStatus.Service is per-process,
      // so when polling from a separate CLI invocation it always reads "idle" by default.
      // Derive busy state from data: if the latest message is an assistant in-progress
      // (no finish, no error) OR the latest message is still a user message within an
      // LLM timeout window, treat the session as busy.
      const lastMsg = await AppRuntime.runPromise(Session.Service.use((svc) => svc.latestMessage(sessionID)))
      // 30s covers normal LLM first-byte latency. Beyond that, if no assistant message
      // has appeared, the LLM call most likely failed before message creation
      // (e.g. ProviderModelNotFoundError, auth errors). Faster failure detection wins
      // over correctness for slow first-byte cases since the in-memory status would
      // catch those when polled in-process.
      const BUSY_USER_WINDOW_MS = 30 * 1000
      const derivedBusy =
        lastMsg !== undefined &&
        ((lastMsg.info.role === "assistant" && !lastMsg.info.finish && !lastMsg.info.error) ||
          (lastMsg.info.role === "user" && Date.now() - lastMsg.info.time.created < BUSY_USER_WINDOW_MS))

      const effectiveStatus =
        status?.type === "busy" || status?.type === "retry"
          ? status
          : derivedBusy
            ? ({ type: "busy" } as const)
            : status

      if (effectiveStatus?.type === "busy" || effectiveStatus?.type === "retry") {
        // Walk back through recent parts and pick the most informative one.
        // Skip step boundaries and tools that haven't streamed input yet so the
        // progress field reflects the actual current activity instead of
        // empty placeholders or repeated "Step done" markers.
        const recent = await AppRuntime.runPromise(Session.Service.use((svc) => svc.recentParts(sessionID, 20)))
        const informative = recent.find((p) => isInformativePart(p)) ?? recent[0]
        const out: Record<string, unknown> = {
          session_id: args.sessionID,
          status: effectiveStatus.type,
        }
        if (informative) out.progress = progressLine(informative)
        if (effectiveStatus.type === "retry") {
          out.retry = {
            attempt: effectiveStatus.attempt,
            message: effectiveStatus.message,
            next: effectiveStatus.next,
          }
        }
        process.stdout.write(JSON.stringify(out) + EOL)
        return
      }

      const out: Record<string, unknown> = {
        session_id: args.sessionID,
        status: "idle",
      }
      if (!lastMsg) {
        out.result = null
      } else if (lastMsg.info.role === "assistant") {
        const err = lastMsg.info.error
        if (err) {
          out.error = {
            name: err.name,
            message: ("data" in err && err.data && typeof err.data === "object" && "message" in err.data
              ? String((err.data as { message?: unknown }).message)
              : null) ?? err.name,
          }
        } else {
          const text = lastMsg.parts
            .filter((p): p is MessageV2.TextPart => p.type === "text")
            .map((p) => p.text.trim())
            .filter((t) => t.length > 0)
            .join("\n")
          out.result = text || null
        }
      } else {
        // Latest message is a user message older than the busy window — LLM never produced
        // an assistant response. This typically indicates a pre-message failure (provider
        // not found, auth error, etc.).
        out.error = {
          name: "NoAssistantResponse",
          message: "Session ended without an assistant response (likely an LLM call failure)",
        }
      }
      process.stdout.write(JSON.stringify(out) + EOL)
    })
  },
})

export const SessionListCommand = cmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs: Argv) => {
    return yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("all", {
        alias: "a",
        describe: "list sessions from all directories",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = args.all
        ? [...Session.listGlobal({ roots: true, limit: args.maxCount })]
        : [...Session.list({ roots: true, limit: args.maxCount })]

      if (sessions.length === 0) {
        return
      }

      let output: string
      if (args.format === "json") {
        output = formatSessionJSON(sessions)
      } else {
        output = formatSessionTable(sessions)
      }

      const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

      if (shouldPaginate) {
        const proc = Process.spawn(pagerCmd(), {
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        if (!proc.stdin) {
          console.log(output)
          return
        }

        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
      } else {
        console.log(output)
      }
    })
  },
})

function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}
