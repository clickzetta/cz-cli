import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
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

      if (status?.type === "busy" || status?.type === "retry") {
        const latest = await AppRuntime.runPromise(Session.Service.use((svc) => svc.latestPart(sessionID)))
        const out: Record<string, unknown> = {
          session_id: args.sessionID,
          status: status.type,
        }
        if (latest) out.progress = progressLine(latest)
        if (status.type === "retry") {
          out.retry = { attempt: status.attempt, message: status.message, next: status.next }
        }
        process.stdout.write(JSON.stringify(out) + EOL)
        return
      }

      const lastText = await AppRuntime.runPromise(Session.Service.use((svc) => svc.lastTextPart(sessionID)))
      process.stdout.write(
        JSON.stringify({
          session_id: args.sessionID,
          status: "idle",
          result: lastText?.text ?? null,
        }) + EOL,
      )
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
