import type { Argv, ArgumentsCamelCase } from "yargs"
import path from "node:path"
import { EOL } from "os"
import { Effect } from "effect"
import { cmd } from "opencode/cli/cmd/cmd"
import { RunCommand as UpstreamRunCommand } from "opencode/cli/cmd/run"
import { AppRuntime } from "opencode/effect/app-runtime"
import { InstanceStore } from "opencode/project/instance-store"
import { InstanceRef } from "opencode/effect/instance-ref"
import { Session } from "opencode/session/session"
import type { SessionID } from "opencode/session/schema"
import { NotFoundError } from "opencode/storage/storage"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"

/**
 * cz-cli-owned `agent run` command — wraps the pristine upstream RunCommand and
 * re-applies the two ClickZetta customizations that lived in origin/main's
 * opencode/cli/cmd/run.ts and were dropped when a2 rebased onto pure upstream:
 *
 *   1. `--async` — print the session id first, then run to completion in-process
 *      (upstream has no async concept). Matches origin semantics: resolve/create
 *      the session, print {session_id, status:"running"} as the first stdout
 *      line, then delegate to the pristine sync handler in the SAME process
 *      (create+resume same-process is the verified path; cross-process resume of
 *      a bare-created session fails, and origin never fire-and-forget-exited —
 *      its in-process server blocked until idle too). For fire-and-forget,
 *      background with `&` and poll `agent session status <id> --wait`.
 *   2. `--session <name>` create-if-missing — origin created a session titled
 *      with the string when it wasn't an existing id; upstream errors
 *      "Session not found". Restored for the documented named-session workflow.
 *
 * The sync path delegates to UpstreamRunCommand.handler verbatim (it re-enters
 * full Effect context — see opencode runMini), so opencode stays pristine.
 */

const SES_PREFIX = "ses_"

type RunArgs = ArgumentsCamelCase<Record<string, unknown>> & {
  message?: string[]
  session?: string
  continue?: boolean
  title?: string
  model?: string
  agent?: string
  file?: string | string[]
  thinking?: boolean
  timeout?: number
  profile?: string
  async?: boolean
  dir?: string
  attach?: string
  "dangerously-skip-permissions"?: boolean
  "--"?: string[]
}

function permissionRules(skip: boolean): PermissionV1.Ruleset {
  return skip
    ? [{ permission: "*", action: "allow", pattern: "*" }]
    : [
        { permission: "question", action: "deny", pattern: "*" },
        { permission: "plan_enter", action: "deny", pattern: "*" },
        { permission: "plan_exit", action: "deny", pattern: "*" },
      ]
}
function runDirectory(args: RunArgs): string {
  const root = process.env.PWD ?? process.cwd()
  if (!args.dir || args.attach) return root
  return path.isAbsolute(args.dir) ? args.dir : path.join(root, args.dir)
}

// Run an effect under a loaded instance (mirrors effectCmd: load → provide
// InstanceRef → dispose on every exit). Session.Service.create/get need this.
async function withInstance<A, R>(
  directory: string,
  effect: Effect.Effect<A, never, R>,
): Promise<A> {
  const { store, ctx } = await AppRuntime.runPromise(
    InstanceStore.Service.use((s) => s.load({ directory }).pipe(Effect.map((c) => ({ store: s, ctx: c })))),
  )
  try {
    const provided = (effect as Effect.Effect<A, never, never>).pipe(
      Effect.provideService(InstanceRef, ctx),
    ) as Effect.Effect<A, never, never>
    return await AppRuntime.runPromise(provided)
  } finally {
    await AppRuntime.runPromise(store.dispose(ctx))
  }
}

async function createNamedSession(directory: string, title: string, skipPerms: boolean): Promise<string> {
  return withInstance(
    directory,
    Effect.gen(function* () {
      const info = yield* Session.Service.use((svc) =>
        svc.create({ title, permission: permissionRules(skipPerms) }),
      )
      return info.id as string
    }),
  )
}

// Resolve the session id for async mode across the three cases (--session /
// --continue / fresh), creating one where needed so we can print it up-front.
async function resolveAsyncSessionId(args: RunArgs, directory: string): Promise<string> {
  const skip = Boolean(args["dangerously-skip-permissions"])
  if (args.session) {
    if (args.session.startsWith(SES_PREFIX)) {
      const found = await withInstance(
        directory,
        Effect.gen(function* () {
          return yield* Session.Service.use((svc) => svc.get(args.session as SessionID)).pipe(
            Effect.map(() => true),
            Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(false)),
          )
        }),
      )
      if (found) return args.session
    }
    return createNamedSession(directory, args.session, skip)
  }
  if (args.continue) {
    const root = await withInstance(
      directory,
      Effect.gen(function* () {
        const list = yield* Session.Service.use((svc) => svc.list())
        return list.find((s) => !s.parentID)?.id as string | undefined
      }),
    )
    if (root) return root
  }
  const title = args.title !== undefined && args.title !== "" ? args.title : undefined
  return createNamedSession(directory, title ?? "async session", skip)
}

export const RunCommand = cmd({
  command: UpstreamRunCommand.command!,
  describe: UpstreamRunCommand.describe!,
  builder: (yargs: Argv) =>
    (UpstreamRunCommand.builder as (y: Argv) => Argv)(yargs).option("async", {
      type: "boolean",
      describe: "Print the session ID first, then run to completion (background with & + poll `agent session status <id> --wait`)",
      default: false,
    }),
  async handler(raw) {
    const args = raw as unknown as RunArgs
    const directory = runDirectory(args)

    // --async: resolve/create the session up-front and print its id as the FIRST
    // stdout line, then delegate to the upstream handler in the SAME process
    // (create+resume same-process is the verified-working path; cross-process
    // resume of a bare-created session fails). Matches origin semantics: id first,
    // then block until idle. For fire-and-forget, background with `&` and poll
    // `agent session status <id> --wait`.
    if (args.async) {
      const sessionID = await resolveAsyncSessionId(args, directory)
      process.stdout.write(JSON.stringify({ session_id: sessionID, status: "running" }) + EOL)
      args.session = sessionID
      ;(args as Record<string, unknown>).s = sessionID
      delete args.async
      delete args.continue // already resolved into sessionID; avoid double-resolution
      await (UpstreamRunCommand.handler as (a: unknown) => Promise<void>)(args)
      return
    }

    // --session <name> create-if-missing: only for non-ses_ strings (a real
    // ses_ id is left to upstream, which validates + errors if truly absent).
    if (args.session && !args.session.startsWith(SES_PREFIX)) {
      const newId = await createNamedSession(directory, args.session, Boolean(args["dangerously-skip-permissions"]))
      args.session = newId
      ;(args as Record<string, unknown>).s = newId
    }

    // Sync path: delegate to pristine upstream verbatim (re-enters full context).
    await (UpstreamRunCommand.handler as (a: unknown) => Promise<void>)(args)
  },
})

