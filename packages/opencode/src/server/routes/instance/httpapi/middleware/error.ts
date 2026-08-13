import { NamedError } from "@opencode-ai/core/util/error"
// cz_change: gate for the `detail` field below — see the banner in the handler.
import { Flag } from "@opencode-ai/core/flag/flag"
import { ConfigErrorV1 } from "@opencode-ai/core/v1/config/error"
import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerError, HttpServerRespondable, HttpServerResponse } from "effect/unstable/http"

// Keep typed HttpApi failures on their declared error path; this boundary only replaces defect-only empty 500s.
export const errorLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      const defect = cause.reasons.filter(Cause.isDieReason).find((reason) => {
        if (HttpServerResponse.isHttpServerResponse(reason.defect)) return false
        if (HttpServerError.isHttpServerError(reason.defect)) return false
        if (HttpServerRespondable.isRespondable(reason.defect)) return false
        return true
      })
      if (!defect) return Effect.failCause(cause)

      const error = defect.defect
      if (
        ConfigErrorV1.JsonError.isInstance(error) ||
        ConfigErrorV1.InvalidError.isInstance(error) ||
        ConfigErrorV1.FrontmatterError.isInstance(error) ||
        ConfigErrorV1.DirectoryTypoError.isInstance(error)
      ) {
        return Effect.succeed(HttpServerResponse.jsonUnsafe(error.toObject(), { status: 400 }))
      }

      const ref = `err_${crypto.randomUUID().slice(0, 8)}`
      const pretty = Cause.pretty(cause)

      //======================== cz-cli change ========================
      // Optionally put the real error in the response, not just a ref.
      //
      // This boundary swallows every defect into "Unexpected server error. Check
      // server logs for details." That is the right default for a server answering
      // network clients, but it is a dead end for a caller that IS the machine: the
      // cz-cli MCP server starts a loopback opencode server in-process and relays
      // its answers to the calling agent, so the agent got an opaque 500 for
      // everything — a ProviderModelNotFoundError from a stale `config.model` looked
      // exactly like a real crash, and diagnosing it meant correlating the ref
      // against a batched log file (Logger.toFile has a non-zero batch window, so
      // the line is not even on disk yet when the response goes out).
      //
      // `detail` carries the structured error (a NamedError keeps its own shape) plus
      // the pretty cause. Opt-in via OPENCODE_ERROR_DETAIL so nothing changes for a
      // server that faces a network; cz-cli sets it only in `mcp serve`.
      const detail = Flag.OPENCODE_ERROR_DETAIL
        ? {
            detail: {
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
                  : typeof (error as { toObject?: unknown })?.toObject === "function"
                    ? (error as { toObject: () => unknown }).toObject()
                    : String(error),
              cause: pretty,
            },
          }
        : {}
      //====================== end cz-cli change ======================

      const body = new NamedError.Unknown({
        message: "Unexpected server error. Check server logs for details.",
        ref,
      }).toObject()

      return Effect.logError("failed", { ref, error, cause: pretty }).pipe(
        Effect.as(
          HttpServerResponse.jsonUnsafe({ ...body, data: { ...body.data, ...detail } }, { status: 500 }),
        ),
      )
    }),
  ),
).layer
